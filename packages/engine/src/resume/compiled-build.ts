/**
 * Compiled-build resume helpers.
 *
 * Provides eligibility checks, plan-state seed derivation from monitor DB and
 * git history, changed-file/diff-stat extraction, and resume prompt-context
 * formatting for the engine resume primitive.
 *
 * All helpers are pure functions or thin async wrappers — no global state.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildFailureSummary } from '../recovery/failure-summary.js';
import type { BuildFailureSummary, PlanSummaryEntry } from '../events.js';

const exec = promisify(execFile);

// --- eforge:region plan-01-engine-resume ---

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ineligibility reason emitted in build:resume:ineligible events. */
export interface ResumeIneligibleResult {
  eligible: false;
  reason: string;
  /** Optional filesystem path checked during the eligibility test. */
  checkedPath?: string;
}

/** Successful eligibility check with loaded failure summary. */
export interface ResumeEligibleResult {
  eligible: true;
  summary: BuildFailureSummary;
  /** The diffStat from the feature branch (may be empty string). */
  diffStat: string;
}

export type ResumeEligibilityResult = ResumeIneligibleResult | ResumeEligibleResult;

/** Seeded plan status for orchestrator initialization. */
export type ResumeStatus = 'merged' | 'pending';

/** Seeded state derived from the failure summary. */
export interface ResumeSeedState {
  /** Plans with merge-complete evidence — treated as dependency-satisfied. */
  seededMerged: string[];
  /** Plans that are pending (failed, blocked, completed-without-merge, or unknown). */
  seededPending: string[];
}

// ---------------------------------------------------------------------------
// Eligibility checks
// ---------------------------------------------------------------------------

/**
 * Check whether a compiled-build resume is eligible.
 *
 * Eligibility requires:
 * 1. The feature branch `eforge/<setName>` exists.
 * 2. The orchestration.yaml artifact exists in the merge worktree.
 * 3. There is failure evidence in the monitor DB or the summary is partial
 *    (git-only evidence still counts when a branch and plan artifacts exist).
 *
 * Returns the full BuildFailureSummary on success so callers can derive
 * seeded state without a second DB query.
 */
export async function checkResumeEligibility(opts: {
  cwd: string;
  setName: string;
  prdId: string;
  mergeWorktreePath: string;
  outputDir: string;
  dbPath?: string;
  trunkBranch?: string;
}): Promise<ResumeEligibilityResult> {
  const { cwd, setName, prdId, mergeWorktreePath, outputDir, dbPath, trunkBranch } = opts;
  const featureBranch = `eforge/${setName}`;

  // 1. Feature branch must exist.
  try {
    await exec('git', ['rev-parse', '--verify', featureBranch], { cwd });
  } catch {
    return {
      eligible: false,
      reason: `feature branch ${featureBranch} not found — compiled artifacts cannot be located without the feature branch`,
    };
  }

  // 2. orchestration.yaml must exist in the merge worktree.
  const orchPath = resolve(mergeWorktreePath, outputDir, setName, 'orchestration.yaml');
  if (!existsSync(orchPath)) {
    return {
      eligible: false,
      reason: `orchestration.yaml not found — compiled plan artifacts are missing or the merge worktree was not preserved`,
      checkedPath: orchPath,
    };
  }

  // 3. Build failure summary (from monitor DB + git history).
  let summary: BuildFailureSummary;
  try {
    summary = await buildFailureSummary({ setName, prdId, cwd, dbPath, trunkBranch });
  } catch {
    return {
      eligible: false,
      reason: `failed to reconstruct build failure summary — no monitor DB or git evidence available for ${setName}`,
    };
  }

  // Require at least one piece of evidence: either a non-partial summary (has DB events)
  // or landed commits on the feature branch (the build ran something before failing).
  const hasEvidence = !summary.partial || summary.landedCommits.length > 0;
  if (!hasEvidence) {
    return {
      eligible: false,
      reason: `no failed-run evidence found for ${setName} — check that monitor.db exists and the feature branch has landed commits`,
    };
  }

  return {
    eligible: true,
    summary,
    diffStat: summary.diffStat,
  };
}

// ---------------------------------------------------------------------------
// State seeding
// ---------------------------------------------------------------------------

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

// --- eforge:endregion plan-01-engine-resume ---
