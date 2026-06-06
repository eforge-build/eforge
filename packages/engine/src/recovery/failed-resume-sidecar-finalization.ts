import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { AgentRuntimeRegistry } from '../agent-runtime-registry.js';
import type { EforgeConfig } from '../config.js';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';
import { runRecoveryAnalyst } from '../agents/recovery-analyst.js';
import { resolveAgentConfig } from '../pipeline.js';
import { buildFailureSummary } from './failure-summary.js';
import { determineRecoveryRecommendation, selectFinalVerdict } from './recommendation.js';
import { projectRecoverySidecarResumeEvidence } from './resume-sidecar.js';
import { writeRecoverySidecar } from './sidecar.js';

export interface FailedQueuedResumeSidecarFinalizationOptions {
  cwd: string;
  queueDir?: string;
  prdId: string;
  setName: string;
  featureBranch: string;
  baseBranch: string;
  trunkBranch?: string;
  agentRuntimes: AgentRuntimeRegistry;
  config: EforgeConfig;
  verbose?: boolean;
  abortController?: AbortController;
  activationReached?: boolean;
  degradedReason?: string;
  resumeRunId?: string;
  resumeSessionId?: string;
}

export type FailedQueuedResumeSidecarFinalizationResult =
  | { status: 'refreshed'; mdPath: string; jsonPath: string }
  | { status: 'degraded'; mdPath: string; jsonPath: string }
  | { status: 'invalidated'; reason: string }
  | { status: 'preserved'; reason: string };

interface FailedResumeEvidence {
  hasFailedResumeRun: boolean;
  hasActivationEvidence: boolean;
  hasSummarizableEvidence: boolean;
  runId?: string;
  inspectionError?: string;
}

export async function finalizeFailedQueuedResumeSidecars(options: FailedQueuedResumeSidecarFinalizationOptions): Promise<FailedQueuedResumeSidecarFinalizationResult> {
  const queueDir = resolve(options.cwd, options.queueDir ?? '.eforge/queue');
  const failedPrdDir = resolve(queueDir, 'failed');
  const dbPath = resolve(options.cwd, '.eforge', 'monitor.db');
  const evidence = inspectFailedResumeEvidence(dbPath, options.setName, options.resumeRunId, options.resumeSessionId);
  const activationReached = options.activationReached === true || evidence.hasActivationEvidence || options.degradedReason !== undefined || evidence.inspectionError !== undefined;

  if (options.degradedReason === undefined && evidence.hasFailedResumeRun && evidence.hasSummarizableEvidence && activationReached) {
    const summary = await buildFailureSummary({
      setName: options.setName,
      prdId: options.prdId,
      cwd: options.cwd,
      dbPath,
      trunkBranch: options.trunkBranch,
      featureBranch: options.featureBranch,
      baseBranch: options.baseBranch,
      runId: options.resumeRunId ?? evidence.runId,
    });
    if (isTrustworthyResumeSummary(summary)) {
      return writeCurrentSidecar({ ...options, failedPrdDir, summary });
    }
  }

  if (!activationReached) {
    return { status: 'preserved', reason: 'No failed resume activation evidence was found; preserving existing recovery sidecars.' };
  }

  const degradedReason = options.degradedReason ?? (evidence.inspectionError !== undefined
    ? `Failed queued resume evidence inspection failed: ${evidence.inspectionError}`
    : 'Failed queued resume reached activation, but current resume failure evidence was incomplete or not summarizable.');
  return writeDegradedSidecar({ ...options, failedPrdDir, reason: degradedReason });
}

function isTrustworthyResumeSummary(summary: BuildFailureSummary): boolean {
  return summary.failingPlan.planId !== 'unknown' || summary.plans.length > 0;
}

async function writeCurrentSidecar(options: FailedQueuedResumeSidecarFinalizationOptions & { failedPrdDir: string; summary: BuildFailureSummary }): Promise<FailedQueuedResumeSidecarFinalizationResult> {
  const prdContent = await readPrdContent(options.failedPrdDir, options.prdId);
  const deterministicRecommendation = determineRecoveryRecommendation(options.summary);
  const agentConfig = resolveAgentConfig('recovery-analyst', options.config);
  let analystVerdict: RecoveryVerdict | null = null;
  let analystError: string | undefined;
  let parseError: string | undefined;
  const recoveryAbort = new AbortController();
  const timer = setTimeout(() => recoveryAbort.abort(), 90_000);
  const abortForwarder = (): void => recoveryAbort.abort();
  options.abortController?.signal.addEventListener('abort', abortForwarder, { once: true });
  try {
    try {
      for await (const event of runRecoveryAnalyst({ ...agentConfig, harness: options.agentRuntimes.forRole('recovery-analyst'), prdContent, summary: options.summary, prdId: options.prdId, cwd: options.cwd, verbose: options.verbose, abortController: recoveryAbort, phase: 'standalone' })) {
        if (event.type === 'recovery:complete') analystVerdict = event.verdict;
        if (event.type === 'recovery:error') parseError = event.error;
      }
    } catch (err) {
      analystError = err instanceof Error ? err.message : String(err);
    }
    const verdict = selectFinalVerdict({ deterministicRecommendation, analystVerdict, analystError, parseError, summary: options.summary });
    return await writeSidecarOrInvalidate(options, options.summary, verdict, 'refreshed');
  } finally {
    clearTimeout(timer);
    options.abortController?.signal.removeEventListener('abort', abortForwarder);
  }
}

async function writeDegradedSidecar(options: FailedQueuedResumeSidecarFinalizationOptions & { failedPrdDir: string; reason: string }): Promise<FailedQueuedResumeSidecarFinalizationResult> {
  const summary: BuildFailureSummary = {
    prdId: options.prdId,
    setName: options.setName,
    featureBranch: options.featureBranch,
    baseBranch: options.baseBranch,
    plans: [],
    failingPlan: { planId: 'unknown', errorMessage: options.reason },
    landedCommits: [],
    diffStat: '',
    modelsUsed: [],
    failedAt: new Date().toISOString(),
    partial: true,
    terminalFailure: { scope: 'unknown', message: options.reason, authoritative: false },
  };
  const verdict: RecoveryVerdict = {
    verdict: 'manual',
    confidence: 'low',
    rationale: options.reason,
    completedWork: [],
    remainingWork: ['Review the failed queued resume and decide whether to retry, split, or abandon the PRD.'],
    risks: ['Current resumed-run evidence was incomplete; stale pre-resume recovery sidecars are not authoritative.'],
    partial: true,
    recoveryError: options.reason,
    recommendationSource: 'manual-fallback',
    recommendationRationale: 'Failed queued-resume recovery sidecar finalization used a degraded manual fallback.',
  };
  return writeSidecarOrInvalidate(options, summary, verdict, 'degraded');
}

async function writeSidecarOrInvalidate(
  options: FailedQueuedResumeSidecarFinalizationOptions & { failedPrdDir: string },
  summary: BuildFailureSummary,
  verdict: RecoveryVerdict,
  status: 'refreshed' | 'degraded',
): Promise<FailedQueuedResumeSidecarFinalizationResult> {
  try {
    const resumeEvidence = await projectRecoverySidecarResumeEvidence({
      cwd: options.cwd,
      setName: options.setName,
      prdId: options.prdId,
      outputDir: options.config.plan.outputDir,
      ...(options.trunkBranch !== undefined ? { trunkBranch: options.trunkBranch } : {}),
      featureBranch: summary.featureBranch,
      baseBranch: summary.baseBranch,
      dbPath: resolve(options.cwd, '.eforge', 'monitor.db'),
    });
    const { mdPath, jsonPath } = await writeRecoverySidecar({ failedPrdDir: options.failedPrdDir, prdId: options.prdId, summary, verdict, resumeEvidence });
    return { status, mdPath, jsonPath };
  } catch (err) {
    await removeRecoverySidecars(options.failedPrdDir, options.prdId);
    return { status: 'invalidated', reason: err instanceof Error ? err.message : String(err) };
  }
}

async function readPrdContent(failedPrdDir: string, prdId: string): Promise<string> {
  try {
    return await readFile(join(failedPrdDir, `${prdId}.md`), 'utf-8');
  } catch {
    return '';
  }
}

async function removeRecoverySidecars(failedPrdDir: string, prdId: string): Promise<void> {
  await Promise.all([
    rm(join(failedPrdDir, `${prdId}.recovery.md`), { force: true }),
    rm(join(failedPrdDir, `${prdId}.recovery.json`), { force: true }),
  ]);
}

function inspectFailedResumeEvidence(dbPath: string, setName: string, resumeRunId?: string, resumeSessionId?: string): FailedResumeEvidence {
  if (!existsSync(dbPath)) return { hasFailedResumeRun: false, hasActivationEvidence: false, hasSummarizableEvidence: false };
  try {
    const db = new DatabaseSync(dbPath);
    try {
      const run = resumeRunId !== undefined
        ? db.prepare(`SELECT id FROM runs WHERE id = ? AND plan_set = ? AND command = 'resume' AND status IN ('running', 'failed') LIMIT 1`).get(resumeRunId, setName) as { id: string } | undefined
        : resumeSessionId !== undefined
          ? db.prepare(`SELECT id FROM runs WHERE session_id = ? AND plan_set = ? AND command = 'resume' AND status IN ('running', 'failed') ORDER BY started_at DESC, id DESC LIMIT 1`).get(resumeSessionId, setName) as { id: string } | undefined
          : db.prepare(`SELECT id FROM runs WHERE plan_set = ? AND command = 'resume' AND status = 'failed' ORDER BY started_at DESC, id DESC LIMIT 1`).get(setName) as { id: string } | undefined;
      if (!run) return { hasFailedResumeRun: false, hasActivationEvidence: false, hasSummarizableEvidence: false };
      const eventCounts = db.prepare(`SELECT
        SUM(CASE WHEN type IN ('build:resume:start', 'build:resume:artifacts') THEN 1 ELSE 0 END) AS activationCount,
        SUM(CASE WHEN type IN ('plan:status:change', 'plan:build:failed', 'plan:merge:complete') THEN 1 ELSE 0 END) AS summaryCount
        FROM events WHERE run_id = ?`).get(run.id) as { activationCount: number | null; summaryCount: number | null } | undefined;
      return {
        hasFailedResumeRun: true,
        hasActivationEvidence: (eventCounts?.activationCount ?? 0) > 0,
        hasSummarizableEvidence: (eventCounts?.summaryCount ?? 0) > 0,
        runId: run.id,
      };
    } finally {
      db.close();
    }
  } catch (err) {
    return { hasFailedResumeRun: false, hasActivationEvidence: false, hasSummarizableEvidence: false, inspectionError: err instanceof Error ? err.message : String(err) };
  }
}
