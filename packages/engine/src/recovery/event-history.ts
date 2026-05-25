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

      // Find the most recent plan:build:failed event for this run
      const failedStmt = db.prepare(
        `SELECT id, plan_id as planId, agent, data, timestamp FROM events WHERE run_id = ? AND type = 'plan:build:failed' ORDER BY id DESC LIMIT 1`,
      );
      const failedEvent = failedStmt.get(runId) as EventHistoryRow | undefined;

      let failingPlan: FailingPlanEntry;
      let plans: PlanSummaryEntry[];
      let failedAt: string;

      if (failedEvent) {
        const failingPlanId = failedEvent.planId ?? 'unknown';
        const parsed = parseEventData(failedEvent.data);
        const errorMessage = typeof parsed.error === 'string' ? parsed.error : undefined;
        const terminalSubtype = typeof parsed.terminalSubtype === 'string'
          ? parsed.terminalSubtype
          : terminalSubtypeFromMessage(errorMessage);

        failingPlan = {
          planId: failingPlanId,
          errorMessage,
          ...(terminalSubtype && { terminalSubtype }),
        };

        plans = [{
          planId: failingPlanId,
          status: 'failed',
          error: errorMessage,
          ...(terminalSubtype && { terminalSubtype }),
        }];
        failedAt = failedEvent.timestamp;
      } else {
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
        // Check for an acceptance-validation failure before falling back to the compile/agent:stop path.
        // A failed phase:end that was preceded by acceptance_validation:complete with passed=false
        // is a terminal acceptance-validation rejection, not a code-level crash.
        const acceptanceStmt = db.prepare(
          `SELECT id, plan_id as planId, agent, data, timestamp FROM events WHERE run_id = ? AND type = 'acceptance_validation:complete' AND id <= ? ORDER BY id DESC LIMIT 1`,
        );
        const acceptanceRow = acceptanceStmt.get(runId, failedPhase.id) as EventHistoryRow | undefined;

        if (acceptanceRow) {
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

            // Gather validation command results (all passing commands feed the PRD validator prompt)
            const cmdStmt = db.prepare(
              `SELECT data FROM events WHERE run_id = ? AND type = 'validation:command:complete' AND id <= ? ORDER BY id`,
            );
            const cmdRows = cmdStmt.all(runId, failedPhase.id) as { data: string }[];
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

            // Gather landing evidence (landing:skipped or stack:landing:update)
            const landingStmt = db.prepare(
              `SELECT data FROM events WHERE run_id = ? AND (type = 'landing:skipped' OR type = 'stack:landing:update') AND id <= ? ORDER BY id DESC LIMIT 1`,
            );
            const landingRow = landingStmt.get(runId, failedPhase.id) as { data: string } | undefined;
            let landingInfo: { status: string; action?: string; reason?: string } | undefined;
            if (landingRow) {
              const parsedLanding = parseEventData(landingRow.data);
              if (typeof parsedLanding.status === 'string') {
                landingInfo = {
                  status: parsedLanding.status,
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

        failingPlan = {
          planId: 'compile',
          agentId,
          agentRole,
          errorMessage,
          ...(terminalSubtype && { terminalSubtype }),
        };
        plans = [{
          planId: 'compile',
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
