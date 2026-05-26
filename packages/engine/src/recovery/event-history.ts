/**
 * Synthesize a partial BuildFailureSummary from monitor.db event history.
 *
 * Used when state.json is unavailable (e.g. when running manual recovery
 * after the build process has already cleaned up). Opens the SQLite DB
 * read-only and queries recent plan:build:failed + agent:start events.
 *
 * Never throws — returns null on any error or when no relevant events exist.
 */

import { DatabaseSync } from 'node:sqlite';
import type { BuildFailureSummary, FailingPlanEntry, PlanSummaryEntry, LandedCommit, AcceptanceCriterionVerdict } from '../events.js';
import { classifyAgentTerminalSubtype } from '../harness.js';

export interface SynthesizeOptions {
  setName: string;
  prdId: string;
  dbPath?: string;
}

// --- eforge:region plan-01-transport-resilience ---
interface EventHistoryRow {
  id: number;
  planId: string | null;
  agent: string | null;
  data: string;
  timestamp: string;
}

function parseEventData(data: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function terminalSubtypeFromMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return classifyAgentTerminalSubtype(new Error(message));
}
// --- eforge:endregion plan-01-transport-resilience ---

/**
 * Synthesize a partial BuildFailureSummary fragment from monitor.db event history.
 *
 * @param options.setName - The plan set name (matches runs.plan_set)
 * @param options.prdId - The PRD identifier being recovered
 * @param options.dbPath - Path to the monitor SQLite database (optional)
 * @returns A partial BuildFailureSummary, or null when no data is findable
 */
export function synthesizeFromEvents(options: SynthesizeOptions): Partial<BuildFailureSummary> | null {
  const { setName, prdId, dbPath } = options;
  if (!dbPath) return null;

  try {
    const db = new DatabaseSync(dbPath);
    try {
      // Find the most recent run for this setName
      const runStmt = db.prepare(
        `SELECT id, command, started_at as startedAt FROM runs WHERE plan_set = ? ORDER BY started_at DESC LIMIT 1`,
      );
      const run = runStmt.get(setName) as { id: string; command: string; startedAt: string } | undefined;

      if (!run) return null;

      const runId = run.id;

      // Find agent:start events to extract model IDs
      const agentStmt = db.prepare(
        `SELECT data FROM events WHERE run_id = ? AND type = 'agent:start' ORDER BY id`,
      );
      const agentEvents = agentStmt.all(runId) as { data: string }[];

      const modelSet = new Set<string>();
      for (const ae of agentEvents) {
        const parsed = parseEventData(ae.data);
        const model = parsed.model;
        if (typeof model === 'string' && model) {
          modelSet.add(model);
        }
      }
      const modelsUsed = [...modelSet].sort();

      let failingPlan: FailingPlanEntry;
      let plans: PlanSummaryEntry[];
      let failedAt: string;
      let failingPlans: FailingPlanEntry[] | undefined;

      // --- eforge:region plan-01-recovery-summary-reconstruction ---
      // Query ALL plan:build:failed events for the run (ordered by id ASC; latest = last element).
      const allFailedStmt = db.prepare(
        `SELECT id, plan_id as planId, agent, data, timestamp FROM events WHERE run_id = ? AND type = 'plan:build:failed' ORDER BY id ASC`,
      );
      const allFailedEvents = allFailedStmt.all(runId) as unknown as EventHistoryRow[];

      if (allFailedEvents.length > 0) {
        // Latest failed event is the last one (highest id) — preserve for backward compat.
        const latestFailedEvent = allFailedEvents[allFailedEvents.length - 1]!;
        failedAt = latestFailedEvent.timestamp;

        const latestParsed = parseEventData(latestFailedEvent.data);
        const latestError = typeof latestParsed.error === 'string' ? latestParsed.error : undefined;
        const latestSubtype = typeof latestParsed.terminalSubtype === 'string'
          ? latestParsed.terminalSubtype
          : terminalSubtypeFromMessage(latestError);

        failingPlan = {
          planId: latestFailedEvent.planId ?? 'unknown',
          ...(latestError !== undefined ? { errorMessage: latestError } : {}),
          ...(latestSubtype ? { terminalSubtype: latestSubtype } : {}),
        };

        // Build per-plan error map from all plan:build:failed events.
        const planErrorMap = new Map<string, { error?: string; terminalSubtype?: string }>();
        for (const row of allFailedEvents) {
          if (!row.planId) continue;
          const parsed = parseEventData(row.data);
          const err = typeof parsed.error === 'string' ? parsed.error : undefined;
          const sub = typeof parsed.terminalSubtype === 'string'
            ? parsed.terminalSubtype
            : terminalSubtypeFromMessage(err);
          planErrorMap.set(row.planId, {
            ...(err !== undefined ? { error: err } : {}),
            ...(sub ? { terminalSubtype: sub } : {}),
          });
        }

        // Enrich planErrorMap from plan:error:set / plan:error:clear for plans
        // that have no plan:build:failed row. Process ASC so the latest row wins.
        const errorSetStmt = db.prepare(
          `SELECT id, plan_id as planId, type, data FROM events WHERE run_id = ? AND type IN ('plan:error:set', 'plan:error:clear') AND plan_id IS NOT NULL ORDER BY id ASC`,
        );
        const errorSetRows = errorSetStmt.all(runId) as unknown as Array<{ id: number; planId: string; type: string; data: string }>;
        const derivedErrorMap = new Map<string, { error?: string; terminalSubtype?: string } | null>();
        for (const row of errorSetRows) {
          if (row.type === 'plan:error:clear') {
            derivedErrorMap.set(row.planId, null);
          } else {
            const parsed = parseEventData(row.data);
            const err = typeof parsed.error === 'string' ? parsed.error : undefined;
            const sub = typeof parsed.terminalSubtype === 'string'
              ? parsed.terminalSubtype
              : terminalSubtypeFromMessage(err);
            derivedErrorMap.set(row.planId, {
              ...(err !== undefined ? { error: err } : {}),
              ...(sub ? { terminalSubtype: sub } : {}),
            });
          }
        }
        // Only fill in error details for plans not already covered by plan:build:failed.
        for (const [planId, errorEntry] of derivedErrorMap) {
          if (!planErrorMap.has(planId) && errorEntry !== null) {
            planErrorMap.set(planId, errorEntry);
          }
        }

        // Reconstruct latest status per plan from plan:status:change events (ASC → last wins).
        const statusChangeStmt = db.prepare(
          `SELECT id, plan_id as planId, data, timestamp FROM events WHERE run_id = ? AND type = 'plan:status:change' AND plan_id IS NOT NULL ORDER BY id ASC`,
        );
        const statusChangeEvents = statusChangeStmt.all(runId) as unknown as EventHistoryRow[];
        const planStatusMap = new Map<string, string>();
        const planStatusTimestampMap = new Map<string, string>();
        for (const row of statusChangeEvents) {
          if (!row.planId) continue;
          const parsed = parseEventData(row.data);
          const status = typeof parsed.status === 'string' ? parsed.status : 'unknown';
          planStatusMap.set(row.planId, status);
          planStatusTimestampMap.set(row.planId, row.timestamp);
        }

        // Enrich with plan:merge:complete (commitSha, mergedAt timestamp).
        const mergeCompleteStmt = db.prepare(
          `SELECT plan_id as planId, data, timestamp FROM events WHERE run_id = ? AND type = 'plan:merge:complete' AND plan_id IS NOT NULL ORDER BY id ASC`,
        );
        const mergeCompleteRows = mergeCompleteStmt.all(runId) as unknown as Array<{ planId: string; data: string; timestamp: string }>;
        const mergeCompleteMap = new Map<string, { commitSha?: string; mergedAt: string }>();
        for (const row of mergeCompleteRows) {
          const parsed = parseEventData(row.data);
          mergeCompleteMap.set(row.planId, {
            mergedAt: row.timestamp,
            ...(typeof parsed.commitSha === 'string' ? { commitSha: parsed.commitSha } : {}),
          });
        }

        // Enrich with plan:build:test:complete (testPassed, testFailed).
        const testCompleteStmt = db.prepare(
          `SELECT plan_id as planId, data FROM events WHERE run_id = ? AND type = 'plan:build:test:complete' AND plan_id IS NOT NULL ORDER BY id ASC`,
        );
        const testCompleteRows = testCompleteStmt.all(runId) as unknown as Array<{ planId: string; data: string }>;
        const testCompleteMap = new Map<string, { testPassed: number; testFailed: number }>();
        for (const row of testCompleteRows) {
          const parsed = parseEventData(row.data);
          const p = typeof parsed.passed === 'number' ? parsed.passed : undefined;
          const f = typeof parsed.failed === 'number' ? parsed.failed : undefined;
          if (p !== undefined && f !== undefined) {
            testCompleteMap.set(row.planId, { testPassed: p, testFailed: f });
          }
        }

        // Count agent:tool_use events per planId.
        const toolUseCountStmt = db.prepare(
          `SELECT plan_id as planId, COUNT(*) as count FROM events WHERE run_id = ? AND type = 'agent:tool_use' AND plan_id IS NOT NULL GROUP BY plan_id`,
        );
        const toolUseCountRows = toolUseCountStmt.all(runId) as unknown as Array<{ planId: string; count: number }>;
        const toolUseMap = new Map<string, number>();
        for (const row of toolUseCountRows) {
          toolUseMap.set(row.planId, row.count);
        }

        // Enrich failingPlan with toolUseCount from the tool-use map.
        const failingPlanTuCount = toolUseMap.get(failingPlan.planId);
        if (failingPlanTuCount !== undefined) {
          failingPlan = { ...failingPlan, toolUseCount: failingPlanTuCount };
        }

        // Union of all plan IDs observed: plan:status:change ∪ plan:build:failed.
        const allPlanIds = new Set<string>([...planStatusMap.keys(), ...planErrorMap.keys()]);
        plans = [...allPlanIds].map(planId => {
          const status = planStatusMap.get(planId) ?? 'failed';
          const errEntry = planErrorMap.get(planId);
          const mergeEntry = mergeCompleteMap.get(planId);
          const testEntry = testCompleteMap.get(planId);

          const planTuCount = toolUseMap.get(planId);
          const statusTs = planStatusTimestampMap.get(planId);
          return {
            planId,
            status,
            ...(mergeEntry?.mergedAt ? { mergedAt: mergeEntry.mergedAt } : {}),
            ...(errEntry?.error !== undefined ? { error: errEntry.error } : {}),
            ...(errEntry?.terminalSubtype ? { terminalSubtype: errEntry.terminalSubtype } : {}),
            ...(mergeEntry?.commitSha ? { commitSha: mergeEntry.commitSha } : {}),
            ...(testEntry !== undefined ? { testPassed: testEntry.testPassed, testFailed: testEntry.testFailed } : {}),
            ...(planTuCount !== undefined ? { toolUseCount: planTuCount } : {}),
            ...(status === 'completed' && statusTs ? { completedAt: statusTs } : {}),
          };
        });

        // Build failingPlans: deduplicated by planId (latest event per plan wins), with toolUseCount when available.
        // allFailedEvents is ordered ASC by id, so iterating in order means the last write per planId wins.
        const failingPlanMap = new Map<string, { planId: string; errorMessage?: string; terminalSubtype?: string; toolUseCount?: number }>();
        for (const row of allFailedEvents) {
          const planId = row.planId ?? 'unknown';
          const parsed = parseEventData(row.data);
          const err = typeof parsed.error === 'string' ? parsed.error : undefined;
          const sub = typeof parsed.terminalSubtype === 'string'
            ? parsed.terminalSubtype
            : terminalSubtypeFromMessage(err);
          const tuCount = toolUseMap.get(planId);

          return {
            planId,
            ...(err !== undefined ? { errorMessage: err } : {}),
            ...(sub ? { terminalSubtype: sub } : {}),
            ...(tuCount !== undefined ? { toolUseCount: tuCount } : {}),
          };
        });
      }
      // --- eforge:endregion plan-01-recovery-summary-reconstruction ---
      else {
        // --- eforge:region plan-01-transport-resilience ---
        const phaseStmt = db.prepare(
          `SELECT id, plan_id as planId, agent, data, timestamp FROM events WHERE run_id = ? AND type = 'phase:end' ORDER BY id DESC LIMIT 20`,
        );
        const phaseEvents = phaseStmt.all(runId) as unknown as EventHistoryRow[];
        const failedPhase = phaseEvents.find((event) => {
          const parsed = parseEventData(event.data);
          const result = parsed.result;
          return Boolean(
            result &&
            typeof result === 'object' &&
            (result as Record<string, unknown>).status === 'failed',
          );
        });
        if (!failedPhase) return null;

        const failedPhaseData = parseEventData(failedPhase.data);
        const phaseResult = failedPhaseData.result && typeof failedPhaseData.result === 'object'
          ? failedPhaseData.result as Record<string, unknown>
          : {};
        const phaseSummary = typeof phaseResult.summary === 'string' ? phaseResult.summary : undefined;
        const phaseStatus = typeof phaseResult.status === 'string' ? phaseResult.status : undefined;

        // --- eforge:region plan-01-recovery-and-acceptance-reporting ---
        // Prefer PRD-validation terminal failures over acceptance failures. runPrdValidator
        // can emit acceptance_validation:complete even when PRD validation failed; reporting
        // those runs as acceptance-validation failures hides the real terminal gate.
        const prdValidationStmt = db.prepare(
          `SELECT id, plan_id as planId, agent, data, timestamp FROM events WHERE run_id = ? AND type = 'prd_validation:complete' AND id <= ? ORDER BY id DESC LIMIT 1`,
        );
        const prdValidationRow = prdValidationStmt.get(runId, failedPhase.id) as EventHistoryRow | undefined;
        const parsedPrdValidation = prdValidationRow ? parseEventData(prdValidationRow.data) : undefined;
        const prdValidationGaps = parsedPrdValidation && Array.isArray(parsedPrdValidation.gaps)
          ? parsedPrdValidation.gaps
          : [];
        const prdValidationPassedCleanly = Boolean(
          parsedPrdValidation?.passed === true && prdValidationGaps.length === 0,
        );

        if (parsedPrdValidation?.passed === false) {
          const gapCount = prdValidationGaps.length;
          const errorMessage = `PRD validation failed: ${gapCount} gap(s) found`;
          return {
            prdId,
            setName,
            featureBranch: `eforge/${setName}`,
            baseBranch: 'main',
            plans: [{ planId: 'prd-validation', status: 'failed', error: errorMessage }],
            failingPlan: { planId: 'prd-validation', errorMessage },
            landedCommits: [] as LandedCommit[],
            diffStat: '',
            modelsUsed,
            failedAt: failedPhase.timestamp,
            partial: true,
            terminalFailure: {
              stage: 'prd-validation',
              ...(phaseSummary !== undefined ? { phaseSummary } : {}),
              ...(phaseStatus !== undefined ? { phaseStatus } : {}),
              eventType: 'prd_validation:complete',
            },
          };
        }

        // Check for an acceptance-validation failure before falling back to the agent:stop path.
        // Only synthesize an acceptance-validation terminal rejection when the latest PRD
        // validation completed cleanly first; otherwise the PRD gate is still unresolved.
        const acceptanceStmt = db.prepare(
          `SELECT id, plan_id as planId, agent, data, timestamp FROM events WHERE run_id = ? AND type = 'acceptance_validation:complete' AND id <= ? ORDER BY id DESC LIMIT 1`,
        );
        const acceptanceRow = acceptanceStmt.get(runId, failedPhase.id) as EventHistoryRow | undefined;

        if (acceptanceRow && prdValidationPassedCleanly) {
          const parsedAcc = parseEventData(acceptanceRow.data);
          if (parsedAcc.passed === false) {
            // Extract verdicts (fail-safe: filter out malformed entries)
            const rawVerdicts = Array.isArray(parsedAcc.verdicts) ? parsedAcc.verdicts : [];
            const verdicts: AcceptanceCriterionVerdict[] = rawVerdicts.filter(
              (v): v is AcceptanceCriterionVerdict =>
                typeof v === 'object' && v !== null &&
                typeof (v as Record<string, unknown>).criterion === 'string' &&
                typeof (v as Record<string, unknown>).verdict === 'string' &&
                typeof (v as Record<string, unknown>).evidence === 'string',
            );
            const passCount = verdicts.filter((v) => v.verdict === 'pass').length;
            const failCount = verdicts.filter((v) => v.verdict === 'fail').length;
            const unknownCount = verdicts.filter((v) => v.verdict !== 'pass' && v.verdict !== 'fail').length;

            // Gather validation command results from the final validation attempt only.
            // Find the latest validation:start before the acceptance event to bound the window.
            const finalValidationStartStmt = db.prepare(
              `SELECT id FROM events WHERE run_id = ? AND type = 'validation:start' AND id <= ? ORDER BY id DESC LIMIT 1`,
            );
            const finalValidationStart = finalValidationStartStmt.get(runId, acceptanceRow.id) as { id: number } | undefined;
            const validationWindowStart = finalValidationStart ? finalValidationStart.id : 0;
            const cmdStmt = db.prepare(
              `SELECT data FROM events WHERE run_id = ? AND type = 'validation:command:complete' AND id > ? AND id <= ? ORDER BY id`,
            );
            const cmdRows = cmdStmt.all(runId, validationWindowStart, failedPhase.id) as { data: string }[];
            const validationCommands: Array<{ command: string; exitCode: number; output?: string }> = [];
            for (const ce of cmdRows) {
              const parsedCmd = parseEventData(ce.data);
              if (typeof parsedCmd.command === 'string' && typeof parsedCmd.exitCode === 'number') {
                validationCommands.push({
                  command: parsedCmd.command,
                  exitCode: parsedCmd.exitCode,
                  ...(typeof parsedCmd.output === 'string' ? { output: parsedCmd.output } : {}),
                });
              }
            }

            // Gather landing evidence (landing:skipped or stack:landing:update).
            // landing:skipped has no status field in the schema; infer it from the event type.
            const landingStmt = db.prepare(
              `SELECT type, data FROM events WHERE run_id = ? AND (type = 'landing:skipped' OR type = 'stack:landing:update') AND id <= ? ORDER BY id DESC LIMIT 1`,
            );
            const landingRow = landingStmt.get(runId, failedPhase.id) as { type: string; data: string } | undefined;
            let landingInfo: { status: string; action?: string; reason?: string } | undefined;
            if (landingRow) {
              const parsedLanding = parseEventData(landingRow.data);
              const landingStatus = landingRow.type === 'landing:skipped'
                ? 'skipped'
                : (typeof parsedLanding.status === 'string' ? parsedLanding.status : undefined);
              if (landingStatus !== undefined) {
                landingInfo = {
                  status: landingStatus,
                  ...(typeof parsedLanding.action === 'string' ? { action: parsedLanding.action } : {}),
                  ...(typeof parsedLanding.reason === 'string' ? { reason: parsedLanding.reason } : {}),
                };
              }
            }

            return {
              prdId,
              setName,
              featureBranch: `eforge/${setName}`,
              baseBranch: 'main',
              plans: [{ planId: 'acceptance-validation', status: 'failed', error: 'Acceptance criteria validation failed' }],
              failingPlan: { planId: 'acceptance-validation' },
              landedCommits: [] as LandedCommit[],
              diffStat: '',
              modelsUsed,
              failedAt: failedPhase.timestamp,
              partial: true,
              terminalFailure: {
                stage: 'acceptance-validation',
                ...(phaseSummary !== undefined ? { phaseSummary } : {}),
                ...(phaseStatus !== undefined ? { phaseStatus } : {}),
                eventType: 'acceptance_validation:complete',
              },
              acceptanceValidation: {
                passed: false,
                total: verdicts.length,
                pass: passCount,
                fail: failCount,
                unknown: unknownCount,
                verdicts,
              },
              ...(validationCommands.length > 0 ? { validationCommands } : {}),
              ...(landingInfo !== undefined ? { landing: landingInfo } : {}),
            };
          }
        }
        // --- eforge:endregion plan-01-recovery-and-acceptance-reporting ---

        const stopStmt = db.prepare(
          `SELECT id, plan_id as planId, agent, data, timestamp FROM events WHERE run_id = ? AND type = 'agent:stop' AND id <= ? ORDER BY id DESC LIMIT 20`,
        );
        const stopEvents = stopStmt.all(runId, failedPhase.id) as unknown as EventHistoryRow[];
        const failedStop = stopEvents.find((event) => {
          const parsed = parseEventData(event.data);
          return typeof parsed.error === 'string' && parsed.error.length > 0;
        });
        if (!failedStop) return null;

        const parsedStop = parseEventData(failedStop.data);
        const errorMessage = typeof parsedStop.error === 'string' ? parsedStop.error : undefined;
        const agentId = typeof parsedStop.agentId === 'string' ? parsedStop.agentId : undefined;
        const agentRole = typeof parsedStop.agent === 'string'
          ? parsedStop.agent
          : failedStop.agent ?? undefined;
        const terminalSubtype = terminalSubtypeFromMessage(errorMessage);

        const fallbackPlanId = failedStop.planId ?? (run.command === 'compile' ? 'compile' : agentRole ?? run.command);
        failingPlan = {
          planId: fallbackPlanId,
          agentId,
          agentRole,
          errorMessage,
          ...(terminalSubtype && { terminalSubtype }),
        };
        plans = [{
          planId: fallbackPlanId,
          status: 'failed',
          error: errorMessage,
          ...(terminalSubtype && { terminalSubtype }),
        }];
        failedAt = failedPhase.timestamp;
        // --- eforge:endregion plan-01-transport-resilience ---
      }

      return {
        prdId,
        setName,
        featureBranch: `eforge/${setName}`,
        baseBranch: 'main',
        plans,
        failingPlan,
        // --- eforge:region plan-01-recovery-summary-reconstruction ---
        ...(failingPlans !== undefined ? { failingPlans } : {}),
        // --- eforge:endregion plan-01-recovery-summary-reconstruction ---
        landedCommits: [] as LandedCommit[],
        diffStat: '',
        modelsUsed,
        failedAt,
        partial: true,
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
