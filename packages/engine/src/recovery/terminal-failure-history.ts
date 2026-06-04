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
import type { AcceptanceCriteriaConflict, AcceptanceCriterionVerdict, BuildFailureSummary, FailingPlanEntry, LandedCommit, PlanSummaryEntry, ReviewIssue } from '../events.js';

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
      (r.hunk === undefined || Number.isInteger(r.hunk)) &&
      (r.issueOutcome === undefined || typeof r.issueOutcome === 'string') &&
      (r.retryGuidance === undefined || typeof r.retryGuidance === 'string');
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
  sourceEventId?: number;
  sourceEventTimestamp?: string;
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
  const sourceEventId = Number.isInteger(failure.sourceEventId) ? failure.sourceEventId as number : undefined;
  const sourceEventTimestamp = typeof failure.sourceEventTimestamp === 'string' ? failure.sourceEventTimestamp : undefined;
  const landingRaw = failure.landing && typeof failure.landing === 'object' ? failure.landing as Record<string, unknown> : undefined;
  const landing = landingRaw && typeof landingRaw.status === 'string'
    ? { status: landingRaw.status, ...(typeof landingRaw.action === 'string' ? { action: landingRaw.action } : {}), ...(typeof landingRaw.reason === 'string' ? { reason: landingRaw.reason } : {}) }
    : undefined;
  return {
    id: row.id, timestamp: row.timestamp, scope, message,
    ...(planId !== undefined ? { planId } : {}),
    ...(sourceEventType !== undefined ? { sourceEventType } : {}),
    ...(sourceEventId !== undefined ? { sourceEventId } : {}),
    ...(sourceEventTimestamp !== undefined ? { sourceEventTimestamp } : {}),
    ...(landing !== undefined ? { landing } : {}),
    ...(typeof failure.validationPassed === 'boolean' ? { validationPassed: failure.validationPassed } : {}),
    ...(typeof failure.prdValidationPassed === 'boolean' ? { prdValidationPassed: failure.prdValidationPassed } : {}),
    ...(typeof failure.acceptanceValidationPassed === 'boolean' ? { acceptanceValidationPassed: failure.acceptanceValidationPassed } : {}),
  };
}

// ---------------------------------------------------------------------------
// Acceptance validation evidence extraction
// ---------------------------------------------------------------------------


type AcceptanceValidationSummary = NonNullable<BuildFailureSummary['acceptanceValidation']>;

type AcceptanceValidationParseResult =
  | { ok: true; acceptanceValidation: AcceptanceValidationSummary }
  | { ok: false; reason: string };

function isAcceptanceVerdict(value: unknown): value is AcceptanceCriterionVerdict {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.criterion === 'string' && record.criterion.length > 0 &&
    (record.verdict === 'pass' || record.verdict === 'fail' || record.verdict === 'unknown') &&
    typeof record.evidence === 'string' && record.evidence.length > 0;
}

function isAcceptanceConflict(value: unknown): value is AcceptanceCriteriaConflict {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.criterion === 'string' && record.criterion.length > 0 &&
    typeof record.evidence === 'string' && record.evidence.length > 0 &&
    typeof record.conflictsWith === 'string' && record.conflictsWith.length > 0 &&
    (record.scope === 'narrow' || record.scope === 'broad' || record.scope === 'unknown') &&
    (record.recommendedAction === 'revise_acceptance_criteria' || record.recommendedAction === 'manual_review');
}

export function parseAcceptanceValidationPayload(data: string, options: { legacyCompatible?: boolean } = {}): AcceptanceValidationParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'payload is not an object' };
  const record = parsed as Record<string, unknown>;
  if (record.passed !== false) return { ok: false, reason: 'payload passed is not false' };
  if (!Array.isArray(record.verdicts)) return { ok: false, reason: 'payload verdicts is not an array' };

  const verdicts = options.legacyCompatible
    ? record.verdicts.flatMap((verdict): AcceptanceCriterionVerdict[] => {
      if (!verdict || typeof verdict !== 'object') return [];
      const r = verdict as Record<string, unknown>;
      if (typeof r.criterion !== 'string' || r.criterion.length === 0 || typeof r.evidence !== 'string' || r.evidence.length === 0) return [];
      const normalizedVerdict = r.verdict === 'pass' || r.verdict === 'fail' || r.verdict === 'unknown'
        ? r.verdict
        : 'unknown';
      return [{ criterion: r.criterion, verdict: normalizedVerdict, evidence: r.evidence }];
    })
    : record.verdicts.filter(isAcceptanceVerdict);
  if (verdicts.length === 0) return { ok: false, reason: 'payload contains zero schema-valid verdicts' };

  const pass = verdicts.filter((verdict) => verdict.verdict === 'pass').length;
  const fail = verdicts.filter((verdict) => verdict.verdict === 'fail').length;
  const unknown = verdicts.filter((verdict) => verdict.verdict === 'unknown').length;
  const waivers = Array.isArray(record.waivers)
    ? record.waivers.filter((waiver): waiver is string => typeof waiver === 'string' && waiver.trim().length > 0)
    : [];
  const conflicts = Array.isArray(record.acceptanceConflicts)
    ? record.acceptanceConflicts.filter(isAcceptanceConflict)
    : [];

  return {
    ok: true,
    acceptanceValidation: {
      passed: false,
      total: verdicts.length,
      pass,
      fail,
      unknown,
      verdicts,
      ...(waivers.length > 0 ? { waivers } : {}),
      ...(conflicts.length > 0 ? { conflicts } : {}),
    },
  };
}

function buildAcceptanceLookupPlaceholder(
  runId: string,
  terminal: AuthoritativeTerminalEvent,
  reason: string,
  sourceRow?: { id: number; timestamp: string; type: string },
): AcceptanceValidationSummary {
  const terminalSourceParts = [
    terminal.sourceEventType ? `terminal source event type=${terminal.sourceEventType}` : undefined,
    terminal.sourceEventId !== undefined ? `terminal source event id=${terminal.sourceEventId}` : undefined,
    terminal.sourceEventTimestamp ? `terminal source event timestamp=${terminal.sourceEventTimestamp}` : undefined,
  ].filter((part): part is string => part !== undefined);
  const terminalSourceDetails = terminalSourceParts.length > 0 ? terminalSourceParts.join(', ') : 'terminal source details were not present';
  const selectedSourceDetails = sourceRow
    ? `selected source row type=${sourceRow.type}, selected source row id=${sourceRow.id}, selected source row timestamp=${sourceRow.timestamp}`
    : 'no source event row was found';
  const evidence = `Acceptance validation evidence lookup failed for run_id=${runId}; build:terminal-failure event id=${terminal.id}; attempted latest acceptance_validation:complete where run_id=${runId} and id <= ${terminal.id}; ${terminalSourceDetails}; ${selectedSourceDetails}; reason=${reason}; inspect monitor.db events for this run manually.`;
  return {
    passed: false,
    total: 1,
    pass: 0,
    fail: 0,
    unknown: 1,
    verdicts: [{ criterion: 'Acceptance validation evidence lookup failed', verdict: 'unknown', evidence }],
  };
}

export function extractAuthoritativeAcceptanceValidation(
  db: DatabaseSync,
  runId: string,
  terminal: AuthoritativeTerminalEvent,
): AcceptanceValidationSummary {
  const row = db.prepare(
    `SELECT id, type, data, timestamp FROM events WHERE run_id = ? AND type = 'acceptance_validation:complete' AND id <= ? ORDER BY id DESC LIMIT 1`,
  ).get(runId, terminal.id) as { id: number; type: string; data: string; timestamp: string } | undefined;
  if (!row) return buildAcceptanceLookupPlaceholder(runId, terminal, 'no acceptance_validation:complete row found at or before terminal event id');

  const parsed = parseAcceptanceValidationPayload(row.data);
  if (parsed.ok) return parsed.acceptanceValidation;
  return buildAcceptanceLookupPlaceholder(runId, terminal, parsed.reason, row);
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

export type PlanErrorEntry = { error?: string; terminalSubtype?: string };

export function buildPlanSummaries(
  allPlanIds: Set<string>,
  maps: PlanStatusMaps,
  planErrorMap: Map<string, PlanErrorEntry>,
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

export function extractPlanErrorMap(
  db: DatabaseSync,
  runId: string,
  upToId: number,
): Map<string, PlanErrorEntry> {
  const rows = db.prepare(
    `SELECT plan_id as planId, type, data FROM events WHERE run_id = ? AND type IN ('plan:error:set', 'plan:error:clear') AND plan_id IS NOT NULL AND id <= ? ORDER BY id ASC`,
  ).all(runId, upToId) as Array<{ planId: string; type: string; data: string }>;
  const planErrorMap = new Map<string, PlanErrorEntry>();
  for (const row of rows) {
    if (row.type === 'plan:error:clear') {
      planErrorMap.delete(row.planId);
      continue;
    }
    const parsed = parseData(row.data);
    const err = typeof parsed.error === 'string' ? parsed.error : undefined;
    const sub = typeof parsed.terminalSubtype === 'string' ? parsed.terminalSubtype : undefined;
    planErrorMap.set(row.planId, {
      ...(err !== undefined ? { error: err } : {}),
      ...(sub ? { terminalSubtype: sub } : {}),
    });
  }
  return planErrorMap;
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
  lifecyclePlanErrorMap: Map<string, PlanErrorEntry> = new Map(),
  options: { acceptanceValidation?: BuildFailureSummary['acceptanceValidation'] } = {},
): Partial<BuildFailureSummary> {
  // failingPlan: use planId for plan-scoped failures; synthetic compat ID for others
  const failingPlanId = terminal.planId ?? (terminal.scope !== 'plan' ? terminal.scope : 'unknown');
  const allPlanIds = new Set([...maps.planStatusMap.keys(), ...lifecyclePlanErrorMap.keys()]);
  if (failingPlanId !== 'unknown') allPlanIds.add(failingPlanId);

  const planErrorMap = new Map(lifecyclePlanErrorMap);
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
      ...(terminal.sourceEventId !== undefined ? { sourceEventId: terminal.sourceEventId } : {}),
      ...(terminal.sourceEventTimestamp ? { sourceEventTimestamp: terminal.sourceEventTimestamp } : {}),
      ...(terminal.landing ? { landing: terminal.landing } : {}),
      ...(landingInfo && !terminal.landing ? { landing: landingInfo } : {}),
    },
    ...(validationCommands && validationCommands.length > 0 ? { validationCommands } : {}),
    ...(terminal.landing ? { landing: terminal.landing } : {}),
    ...(landingInfo && !terminal.landing ? { landing: landingInfo } : {}),
    ...(reviewFailure !== undefined ? { reviewFailure } : {}),
    ...(options.acceptanceValidation !== undefined ? { acceptanceValidation: options.acceptanceValidation } : {}),
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
