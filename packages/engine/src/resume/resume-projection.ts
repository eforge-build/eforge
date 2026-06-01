/**
 * Compiled-build resume projection & formatting helpers.
 *
 * Pure functions (and thin read-only async wrappers) that derive seeded plan
 * state, project resume artifacts, format resume prompt context, and check plan
 * markdown existence. Split out of `compiled-build.ts` to keep each module under
 * the implementation size cap.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { BuildFailureSummary, PlanSummaryEntry, OrchestrationConfig, PlanFile, BuildResumeArtifactsEvent } from '../events.js';

// ---------------------------------------------------------------------------
// State seeding
// ---------------------------------------------------------------------------

/** Seeded plan status for orchestrator initialization. */
export type ResumeStatus = 'merged' | 'pending';

/** Seeded state derived from the failure summary. */
export interface ResumeSeedState {
  /** Plans with merge-complete evidence — treated as dependency-satisfied. */
  seededMerged: string[];
  /** Plans that are pending (failed, blocked, completed-without-merge, or unknown). */
  seededPending: string[];
}

/**
 * Derive the seeded plan statuses from the failure summary.
 *
 * Rules:
 * - Plans with a `plan:merge:complete` event (`mergedAt` present in PlanSummaryEntry)
 *   are seeded as `merged` — they are treated as dependency-satisfied.
 * - All other observed plans (failed, blocked, completed-without-merge, running, unknown)
 *   are reset to `pending` so the scheduler can run them.
 * - Plans not observed in the failure summary (no status:change events) are left
 *   at their default `pending` state (initialized fresh by initializeState).
 *
 * Returns lists of planIds in each bucket for the build:resume:state event.
 */
export function deriveResumeSeedState(plans: PlanSummaryEntry[]): ResumeSeedState {
  const seededMerged: string[] = [];
  const seededPending: string[] = [];

  for (const plan of plans) {
    // mergedAt is the canonical merge-complete evidence.
    const hasMergeEvidence = typeof plan.mergedAt === 'string' && plan.mergedAt.trim().length > 0;
    if (hasMergeEvidence) {
      seededMerged.push(plan.planId);
    } else {
      seededPending.push(plan.planId);
    }
  }

  return { seededMerged, seededPending };
}

// ---------------------------------------------------------------------------
// Resume artifact projection
// ---------------------------------------------------------------------------

export type ResumeArtifactsProjection = Omit<BuildResumeArtifactsEvent, 'type' | 'timestamp' | 'sessionId' | 'runId'>;

async function resolveResumeSource(opts: {
  cwd: string;
  prdId: string;
  summary: BuildFailureSummary;
}): Promise<BuildResumeArtifactsEvent['source']> {
  if (opts.summary.prdContent !== undefined) {
    return { label: `PRD ${opts.prdId}`, content: opts.summary.prdContent };
  }

  const candidates = [
    join(opts.cwd, '.eforge', 'queue', 'failed', `${opts.prdId}.md`),
    join(opts.cwd, '.eforge', 'queue', `${opts.prdId}.md`),
  ];

  for (const path of candidates) {
    try {
      return {
        label: path.startsWith(opts.cwd) ? path.slice(opts.cwd.length + 1) : path,
        path,
        content: await readFile(path, 'utf-8'),
      };
    } catch {
      // Try the next best-effort source path.
    }
  }

  return { label: `PRD ${opts.prdId}` };
}

export async function buildResumeArtifactsProjection(opts: {
  cwd: string;
  prdId: string;
  setName: string;
  featureBranch: string;
  artifactSource: 'merge-worktree' | 'branch-history';
  artifactCommit?: string;
  summary: BuildFailureSummary;
  orchConfig: OrchestrationConfig;
  planFileMap: Map<string, PlanFile>;
}): Promise<ResumeArtifactsProjection> {
  const source = await resolveResumeSource({ cwd: opts.cwd, prdId: opts.prdId, summary: opts.summary });

  return {
    prdId: opts.prdId,
    setName: opts.setName,
    featureBranch: opts.featureBranch,
    artifactSource: opts.artifactSource,
    ...(opts.artifactCommit !== undefined ? { artifactCommit: opts.artifactCommit } : {}),
    source,
    orchestration: opts.orchConfig,
    plans: opts.orchConfig.plans.map((plan) => {
      const planFile = opts.planFileMap.get(plan.id);
      return {
        id: plan.id,
        name: plan.name,
        body: planFile?.body ?? '',
        dependsOn: plan.dependsOn,
        ...(plan.branch ? { branch: plan.branch } : {}),
        build: plan.build,
        review: plan.review,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Resume context formatting
// ---------------------------------------------------------------------------

/**
 * Build compact resume context text to inject into builder prompts.
 *
 * Includes:
 * - Prior terminal failure message (when available)
 * - Feature branch name
 * - Number of landed commits and diffStat (when available)
 * - Prior plan status (seeded as merged vs. pending)
 *
 * Kept intentionally compact to avoid consuming excessive prompt space.
 */
export function formatResumeContext(opts: {
  planId: string;
  summary: BuildFailureSummary;
  seededMerged: string[];
  seededPending: string[];
}): string {
  const { planId, summary, seededMerged, seededPending } = opts;
  const lines: string[] = [];

  lines.push('## Resume Context');
  lines.push('');
  lines.push('This plan is being resumed from a previous failed build. Do not start from scratch.');
  lines.push(`Feature branch: ${summary.featureBranch}`);

  if (summary.landedCommits.length > 0) {
    lines.push(`Prior landed commits: ${summary.landedCommits.length}`);
  }

  if (summary.diffStat) {
    lines.push(`Changed files (prior attempt):\n${summary.diffStat}`);
  }

  const terminalMsg = summary.terminalFailure?.message ?? summary.failingPlan?.errorMessage;
  if (terminalMsg) {
    lines.push(`Prior failure message: ${terminalMsg}`);
  }

  if (seededMerged.length > 0) {
    lines.push(`Plans already merged (dependency-satisfied): ${seededMerged.join(', ')}`);
  }

  const thisWasFailing = seededPending.includes(planId) ||
    summary.failingPlan?.planId === planId ||
    (summary.failingPlans ?? []).some((fp) => fp.planId === planId);

  if (thisWasFailing) {
    lines.push(`This plan (${planId}) previously failed. Continue/repair the preserved work on the feature branch rather than restarting from scratch.`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Plan markdown existence check
// ---------------------------------------------------------------------------

/**
 * Verify that the plan markdown file for a given plan ID exists in the merge
 * worktree's compiled output directory.
 *
 * Returns the resolved path when the file exists, or undefined when it is missing.
 */
export async function getPlanMarkdownPath(opts: {
  mergeWorktreePath: string;
  outputDir: string;
  setName: string;
  planId: string;
}): Promise<string | undefined> {
  const { mergeWorktreePath, outputDir, setName, planId } = opts;
  const mdPath = join(mergeWorktreePath, outputDir, setName, `${planId}.md`);
  try {
    await readFile(mdPath, 'utf-8');
    return mdPath;
  } catch {
    return undefined;
  }
}
