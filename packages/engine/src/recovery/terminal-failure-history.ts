/**
 * Monitor DB reconstruction helpers for authoritative terminal failure lookup.
 *
 * These helpers query the monitor.db to find `build:terminal-failure` events
 * (the authoritative source), extract plan statuses, validation commands,
 * landing evidence, and support stale agent-stop filtering.
 *
 * All helpers accept a raw DatabaseSync instance and return typed data.
 * The caller (synthesizeFromEvents) opens and closes the DB.
 */

import { DatabaseSync } from 'node:sqlite';
import type { BuildFailureSummary, FailingPlanEntry, LandedCommit, PlanSummaryEntry, ReviewIssue } from '../events.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface EventRow {
  id: number;
  planId: string | null;
  agent: string | null;
  data: string;
  timestamp: string;
}

function parseData(data: string): Record<string, unknown> {
  try {
    const p = JSON.parse(data);
    return p && typeof p === 'object' ? p as Record<string, unknown> : {};
  } catch { return {}; }
}

type ReviewFailureDetails = NonNullable<BuildFailureSummary['reviewFailure']>;
type ReviewFailureEvaluation = NonNullable<ReviewFailureDetails['evaluation']>;
type ReviewFailureEvaluationVerdict = ReviewFailureEvaluation['verdicts'][number];

function parseReviewIssues(raw: unknown): ReviewIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((issue): issue is ReviewIssue => {
    if (!issue || typeof issue !== 'object') return false;
    const r = issue as Record<string, unknown>;
    return (r.severity === 'critical' || r.severity === 'warning' || r.severity === 'suggestion') &&
      typeof r.category === 'string' &&
      typeof r.file === 'string' &&
      (r.line === undefined || typeof r.line === 'number') &&
      typeof r.description === 'string' &&
      (r.fix === undefined || typeof r.fix === 'string');
  });
}

function parseEvaluationVerdicts(raw: unknown): ReviewFailureEvaluationVerdict[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((verdict): verdict is ReviewFailureEvaluationVerdict => {
    if (!verdict || typeof verdict !== 'object') return false;
    const r = verdict as Record<string, unknown>;
    return typeof r.file === 'string' &&
      (r.action === 'accept' || r.action === 'reject' || r.action === 'review') &&
      typeof r.reason === 'string' &&
      (r.hunk === undefined || Number.isInteger(r.hunk));
  });
}

// ---------------------------------------------------------------------------
// Authoritative terminal event lookup
// ---------------------------------------------------------------------------

export interface AuthoritativeTerminalEvent {
  id: number;
  timestamp: string;
  scope: string;
  message: string;
  planId?: string;
  sourceEventType?: string;
  landing?: { status: string; action?: string; reason?: string };
  validationPassed?: boolean;
  prdValidationPassed?: boolean;
  acceptanceValidationPassed?: boolean;
}

/**
 * Find the latest `build:terminal-failure` event for the run at or before
 * the failed phase:end. Returns undefined if none found.
 */
export function findAuthoritativeTerminalEvent(
  db: DatabaseSync,
  runId: string,
  failedPhaseId: number,
): AuthoritativeTerminalEvent | undefined {
  const stmt = db.prepare(
    `SELECT id, data, timestamp FROM events WHERE run_id = ? AND type = 'build:terminal-failure' AND id <= ? ORDER BY id DESC LIMIT 1`,
  );
  const row = stmt.get(runId, failedPhaseId) as { id: number; data: string; timestamp: string } | undefined;
  if (!row) return undefined;
  const d = parseData(row.data);
  const failure = d.failure && typeof d.failure === 'object' ? d.failure as Record<string, unknown> : {};
  // Only treat this row as authoritative if failure.authoritative is explicitly true.
  if (failure.authoritative !== true) return undefined;
  const scope = typeof failure.scope === 'string' ? failure.scope : 'unknown';
  const message = typeof failure.message === 'string' ? failure.message : '';
  const planId = typeof failure.planId === 'string' ? failure.planId : undefined;
  const sourceEventType = typeof failure.sourceEventType === 'string' ? failure.sourceEventType : undefined;
  const landingRaw = failure.landing && typeof failure.landing === 'object' ? failure.landing as Record<string, unknown> : undefined;
  const landing = landingRaw && typeof landingRaw.status === 'string'
    ? { status: landingRaw.status, action: typeof landingRaw.action === 'string' ? landingRaw.action : undefined, reason: typeof landingRaw.reason === 'string' ? landingRaw.reason : undefined }
    : undefined;
  return {
    id: row.id, timestamp: row.timestamp, scope, message, planId, sourceEventType, landing,
    ...(typeof failure.validationPassed === 'boolean' ? { validationPassed: failure.validationPassed } : {}),
    ...(typeof failure.prdValidationPassed === 'boolean' ? { prdValidationPassed: failure.prdValidationPassed } : {}),
    ...(typeof failure.acceptanceValidationPassed === 'boolean' ? { acceptanceValidationPassed: failure.acceptanceValidationPassed } : {}),
  };
}

// ---------------------------------------------------------------------------
// Plan status reconstruction (shared between authoritative and fallback paths)
// ---------------------------------------------------------------------------

export interface PlanStatusMaps {
  planStatusMap: Map<string, string>;
  planStatusTimestampMap: Map<string, string>;
  /** Event id of the latest plan:status:change entry per plan (for ordering-based stale stop filtering). */
  planStatusIdMap: Map<string, number>;
  mergeCompleteMap: Map<string, { commitSha?: string; mergedAt: string }>;
  testCompleteMap: Map<string, { testPassed: number; testFailed: number }>;
  toolUseMap: Map<string, number>;
}

export function reconstructPlanMaps(db: DatabaseSync, runId: string): PlanStatusMaps {
  const planStatusMap = new Map<string, string>();
  const planStatusTimestampMap = new Map<string, string>();
  const planStatusIdMap = new Map<string, number>();
  const mergeCompleteMap = new Map<string, { commitSha?: string; mergedAt: string }>();
  const testCompleteMap = new Map<string, { testPassed: number; testFailed: number }>();
  const toolUseMap = new Map<string, number>();

  const statusRows = db.prepare(
    `SELECT id, plan_id as planId, data, timestamp FROM events WHERE run_id = ? AND type = 'plan:status:change' AND plan_id IS NOT NULL ORDER BY id ASC`,
  ).all(runId) as Array<{ id: number; planId: string; data: string; timestamp: string }>;
  for (const r of statusRows) {
    const d = parseData(r.data);
    planStatusMap.set(r.planId, typeof d.status === 'string' ? d.status : 'unknown');
    planStatusTimestampMap.set(r.planId, r.timestamp);
    planStatusIdMap.set(r.planId, r.id);
  }

  const mergeRows = db.prepare(
    `SELECT plan_id as planId, data, timestamp FROM events WHERE run_id = ? AND type = 'plan:merge:complete' AND plan_id IS NOT NULL ORDER BY id ASC`,
  ).all(runId) as Array<{ planId: string; data: string; timestamp: string }>;
  for (const r of mergeRows) {
    const d = parseData(r.data);
    mergeCompleteMap.set(r.planId, { mergedAt: r.timestamp, ...(typeof d.commitSha === 'string' ? { commitSha: d.commitSha } : {}) });
  }

  const testRows = db.prepare(
    `SELECT plan_id as planId, data FROM events WHERE run_id = ? AND type = 'plan:build:test:complete' AND plan_id IS NOT NULL ORDER BY id ASC`,
  ).all(runId) as Array<{ planId: string; data: string }>;
  for (const r of testRows) {
    const d = parseData(r.data);
    if (typeof d.passed === 'number' && typeof d.failed === 'number') testCompleteMap.set(r.planId, { testPassed: d.passed, testFailed: d.failed });
  }

  const toolUseRows = db.prepare(
    `SELECT plan_id as planId, COUNT(*) as count FROM events WHERE run_id = ? AND type = 'agent:tool_use' AND plan_id IS NOT NULL GROUP BY plan_id`,
  ).all(runId) as Array<{ planId: string; count: number }>;
  for (const r of toolUseRows) toolUseMap.set(r.planId, r.count);

  return { planStatusMap, planStatusTimestampMap, planStatusIdMap, mergeCompleteMap, testCompleteMap, toolUseMap };
}

// ---------------------------------------------------------------------------
// Build PlanSummaryEntry[] from maps
// ---------------------------------------------------------------------------

export function buildPlanSummaries(
  allPlanIds: Set<string>,
  maps: PlanStatusMaps,
  planErrorMap: Map<string, { error?: string; terminalSubtype?: string }>,
): PlanSummaryEntry[] {
  return [...allPlanIds].map(planId => {
    const status = maps.planStatusMap.get(planId) ?? 'failed';
    const errEntry = planErrorMap.get(planId);
    const mergeEntry = maps.mergeCompleteMap.get(planId);
    const testEntry = maps.testCompleteMap.get(planId);
    const tuCount = maps.toolUseMap.get(planId);
    const statusTs = maps.planStatusTimestampMap.get(planId);
    return {
      planId, status,
      ...(mergeEntry?.mergedAt ? { mergedAt: mergeEntry.mergedAt } : {}),
      ...(errEntry?.error !== undefined ? { error: errEntry.error } : {}),
      ...(errEntry?.terminalSubtype ? { terminalSubtype: errEntry.terminalSubtype } : {}),
      ...(mergeEntry?.commitSha ? { commitSha: mergeEntry.commitSha } : {}),
      ...(testEntry !== undefined ? { testPassed: testEntry.testPassed, testFailed: testEntry.testFailed } : {}),
      ...(tuCount !== undefined ? { toolUseCount: tuCount } : {}),
      ...(status === 'completed' && statusTs ? { completedAt: statusTs } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Validation command extraction for a build window
// ---------------------------------------------------------------------------

export function extractValidationCommands(
  db: DatabaseSync,
  runId: string,
  windowStartId: number,
  windowEndId: number,
): Array<{ command: string; exitCode: number; output?: string }> {
  const rows = db.prepare(
    `SELECT data FROM events WHERE run_id = ? AND type = 'validation:command:complete' AND id > ? AND id <= ? ORDER BY id`,
  ).all(runId, windowStartId, windowEndId) as { data: string }[];
  const result: Array<{ command: string; exitCode: number; output?: string }> = [];
  for (const r of rows) {
    const d = parseData(r.data);
    if (typeof d.command === 'string' && typeof d.exitCode === 'number') {
      result.push({ command: d.command, exitCode: d.exitCode, ...(typeof d.output === 'string' ? { output: d.output } : {}) });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Landing evidence extraction
// ---------------------------------------------------------------------------

export function extractLandingInfo(
  db: DatabaseSync,
  runId: string,
  upToId: number,
): { status: string; action?: string; reason?: string } | undefined {
  const row = db.prepare(
    `SELECT type, data FROM events WHERE run_id = ? AND (type = 'landing:skipped' OR type = 'stack:landing:update') AND id <= ? ORDER BY id DESC LIMIT 1`,
  ).get(runId, upToId) as { type: string; data: string } | undefined;
  if (!row) return undefined;
  const d = parseData(row.data);
  const status = row.type === 'landing:skipped' ? 'skipped' : (typeof d.status === 'string' ? d.status : undefined);
  if (!status) return undefined;
  return { status, ...(typeof d.action === 'string' ? { action: d.action } : {}), ...(typeof d.reason === 'string' ? { reason: d.reason } : {}) };
}

export function extractReviewFailureDetails(
  db: DatabaseSync,
  runId: string,
  planId: string,
  upToId: number,
): ReviewFailureDetails | undefined {
  const reviewRow = db.prepare(
    `SELECT data FROM events WHERE run_id = ? AND type = 'plan:build:review:complete' AND plan_id = ? AND id <= ? ORDER BY id DESC LIMIT 1`,
  ).get(runId, planId, upToId) as { data: string } | undefined;
  const reviewIssues = reviewRow ? parseReviewIssues(parseData(reviewRow.data).issues) : [];

  const evalRow = db.prepare(
    `SELECT data FROM events WHERE run_id = ? AND type = 'plan:build:evaluate:complete' AND plan_id = ? AND id <= ? ORDER BY id DESC LIMIT 1`,
  ).get(runId, planId, upToId) as { data: string } | undefined;
  let evaluation: ReviewFailureEvaluation | undefined;
  if (evalRow) {
    const parsed = parseData(evalRow.data);
    const verdicts = parseEvaluationVerdicts(parsed.verdicts);
    const accepted = typeof parsed.accepted === 'number'
      ? parsed.accepted
      : verdicts.filter(v => v.action === 'accept').length;
    const rejected = typeof parsed.rejected === 'number'
      ? parsed.rejected
      : verdicts.filter(v => v.action === 'reject').length;
    const review = verdicts.filter(v => v.action === 'review').length;
    evaluation = { accepted, rejected, review, verdicts };
  }

  if (reviewIssues.length === 0 && evaluation === undefined) return undefined;
  return {
    planId,
    issues: reviewIssues,
    ...(evaluation !== undefined ? { evaluation } : {}),
  };
}

// ---------------------------------------------------------------------------
// Build authoritative BuildFailureSummary fragment from terminal event
// ---------------------------------------------------------------------------

export function buildAuthoritativeFragment(
  terminal: AuthoritativeTerminalEvent,
  maps: PlanStatusMaps,
  prdId: string,
  setName: string,
  modelsUsed: string[],
  failedPhaseTimestamp: string,
  validationCommands?: Array<{ command: string; exitCode: number; output?: string }>,
  landingInfo?: { status: string; action?: string; reason?: string },
  reviewFailure?: ReviewFailureDetails,
): Partial<BuildFailureSummary> {
  // failingPlan: use planId for plan-scoped failures; synthetic compat ID for others
  const failingPlanId = terminal.planId ?? (terminal.scope !== 'plan' ? terminal.scope : 'unknown');
  const allPlanIds = new Set(maps.planStatusMap.keys());
  if (failingPlanId !== 'unknown') allPlanIds.add(failingPlanId);

  const planErrorMap = new Map<string, { error?: string; terminalSubtype?: string }>();
  if (terminal.scope === 'plan' && failingPlanId !== 'unknown') {
    planErrorMap.set(failingPlanId, { error: terminal.message });
  }
  const plans = buildPlanSummaries(allPlanIds, maps, planErrorMap);

  const toolUseCount = maps.toolUseMap.get(failingPlanId);
  const failingPlan: FailingPlanEntry = {
    planId: failingPlanId,
    ...(terminal.scope === 'plan' ? { errorMessage: terminal.message } : {}),
    ...(toolUseCount !== undefined ? { toolUseCount } : {}),
  };
  const failingPlans = terminal.scope === 'plan' && failingPlanId !== 'unknown' ? [failingPlan] : undefined;

  return {
    prdId, setName,
    featureBranch: `eforge/${setName}`,
    baseBranch: 'main',
    plans,
    failingPlan,
    ...(failingPlans !== undefined ? { failingPlans } : {}),
    landedCommits: [],
    diffStat: '',
    modelsUsed,
    failedAt: failedPhaseTimestamp,
    terminalFailure: {
      scope: terminal.scope as import('../events.js').TerminalFailureScope,
      message: terminal.message,
      authoritative: true,
      ...(terminal.planId ? { planId: terminal.planId } : {}),
      ...(terminal.sourceEventType ? { sourceEventType: terminal.sourceEventType } : {}),
      ...(terminal.landing ? { landing: terminal.landing } : {}),
      ...(landingInfo && !terminal.landing ? { landing: landingInfo } : {}),
    },
    ...(validationCommands && validationCommands.length > 0 ? { validationCommands } : {}),
    ...(terminal.landing ? { landing: terminal.landing } : {}),
    ...(landingInfo && !terminal.landing ? { landing: landingInfo } : {}),
    ...(reviewFailure !== undefined ? { reviewFailure } : {}),
  };
}

// ---------------------------------------------------------------------------
// Legacy fallback fragment detection (no authoritative build:terminal-failure)
// Detects artifact-recording, landing, and post-merge-validation failures.
// ---------------------------------------------------------------------------

/** Base fields common to all legacy fallback fragments. */
function makeLegacyBase(
  prdId: string, setName: string, modelsUsed: string[], failedAt: string,
  failingPlanId: string, failingPlanMsg: string,
): Partial<BuildFailureSummary> {
  return {
    prdId, setName, featureBranch: `eforge/${setName}`, baseBranch: 'main',
    plans: [{ planId: failingPlanId, status: 'failed', error: failingPlanMsg }],
    failingPlan: { planId: failingPlanId, errorMessage: failingPlanMsg },
    landedCommits: [] as LandedCommit[], diffStat: '', modelsUsed,
    failedAt, partial: true,
  };
}

/**
 * Probe the DB for well-known non-plan terminal failure patterns that predate
 * the authoritative build:terminal-failure event. Returns a synthesized fragment
 * or undefined if none of the patterns match.
 *
 * Order: artifact-recording > landing > post-merge-validation
 */
export function detectLegacyFallbackFragment(
  db: DatabaseSync,
  runId: string,
  failedPhaseId: number,
  failedPhaseTimestamp: string,
  prdId: string,
  setName: string,
  modelsUsed: string[],
  phaseSummary: string | undefined,
  phaseStatus: string | undefined,
): Partial<BuildFailureSummary> | undefined {
  const phaseFields = { ...(phaseSummary !== undefined ? { phaseSummary } : {}), ...(phaseStatus !== undefined ? { phaseStatus } : {}) };

  // --- artifact-recording: daemon:error with source=stack:artifact-recording ---
  const artifactRows = db.prepare(
    `SELECT id, data FROM events WHERE run_id = ? AND type = 'daemon:error' AND id <= ? ORDER BY id DESC LIMIT 20`,
  ).all(runId, failedPhaseId) as { id: number; data: string }[];
  const artifactRow = artifactRows.find((r) => { const d = parseData(r.data); return d.source === 'stack:artifact-recording'; });
  if (artifactRow) {
    const d = parseData(artifactRow.data);
    const msg = typeof d.message === 'string' ? d.message : 'Failed to record stack artifact';
    const valStart = db.prepare(`SELECT id FROM events WHERE run_id = ? AND type = 'validation:start' AND id <= ? ORDER BY id DESC LIMIT 1`).get(runId, artifactRow.id) as { id: number } | undefined;
    const valCmds = extractValidationCommands(db, runId, valStart?.id ?? 0, failedPhaseId);
    const landing = extractLandingInfo(db, runId, failedPhaseId);
    return {
      ...makeLegacyBase(prdId, setName, modelsUsed, failedPhaseTimestamp, 'artifact-recording', msg),
      terminalFailure: { stage: 'artifact-recording', scope: 'artifact-recording', message: msg, authoritative: false, ...phaseFields, eventType: 'daemon:error', sourceEventType: 'daemon:error' },
      ...(valCmds.length > 0 ? { validationCommands: valCmds } : {}),
      ...(landing !== undefined ? { landing } : {}),
    };
  }

  // --- landing: landing:skipped or stack:landing:update with status=failed/skipped ---
  const landingRow = db.prepare(
    `SELECT type, data FROM events WHERE run_id = ? AND (type = 'landing:skipped' OR type = 'stack:landing:update') AND id <= ? ORDER BY id DESC LIMIT 1`,
  ).get(runId, failedPhaseId) as { type: string; data: string } | undefined;
  if (landingRow) {
    const d = parseData(landingRow.data);
    const status = landingRow.type === 'landing:skipped' ? 'skipped' : (typeof d.status === 'string' ? d.status : undefined);
    if (status === 'failed' || status === 'skipped') {
      const msg = landingRow.type === 'landing:skipped'
        ? (typeof d.reason === 'string' ? d.reason : 'Landing skipped')
        : (typeof d.reason === 'string' ? `Stack landing failed: ${d.reason}` : 'Stack landing failed');
      const landingInfo = { status, ...(typeof d.action === 'string' ? { action: d.action } : {}), ...(typeof d.reason === 'string' ? { reason: d.reason } : {}) };
      return {
        ...makeLegacyBase(prdId, setName, modelsUsed, failedPhaseTimestamp, 'landing', msg),
        terminalFailure: { stage: 'landing', scope: 'landing', message: msg, authoritative: false, ...phaseFields, eventType: landingRow.type, sourceEventType: landingRow.type },
        landing: landingInfo,
      };
    }
  }

  // --- post-merge-validation: validation:complete with passed=false ---
  const valRow = db.prepare(
    `SELECT id, data FROM events WHERE run_id = ? AND type = 'validation:complete' AND id <= ? ORDER BY id DESC LIMIT 1`,
  ).get(runId, failedPhaseId) as { id: number; data: string } | undefined;
  if (valRow && parseData(valRow.data).passed === false) {
    const msg = 'Post-merge validation failed';
    const valStart = db.prepare(`SELECT id FROM events WHERE run_id = ? AND type = 'validation:start' AND id <= ? ORDER BY id DESC LIMIT 1`).get(runId, valRow.id) as { id: number } | undefined;
    const valCmds = extractValidationCommands(db, runId, valStart?.id ?? 0, failedPhaseId);
    return {
      ...makeLegacyBase(prdId, setName, modelsUsed, failedPhaseTimestamp, 'post-merge-validation', msg),
      terminalFailure: { stage: 'post-merge-validation', scope: 'post-merge-validation', message: msg, authoritative: false, ...phaseFields, eventType: 'validation:complete', sourceEventType: 'validation:complete' },
      ...(valCmds.length > 0 ? { validationCommands: valCmds } : {}),
    };
  }

  return undefined;
}
