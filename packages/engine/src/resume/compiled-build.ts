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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildFailureSummary } from '../recovery/failure-summary.js';
import type { BuildFailureSummary, PlanSummaryEntry, OrchestrationConfig, PlanFile, BuildResumeArtifactsEvent } from '../events.js';

const exec = promisify(execFile);


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
  /** Filesystem root that contains the compiled plan artifacts to read. */
  artifactBasePath: string;
  /** Where the artifacts were recovered from. */
  artifactSource: 'merge-worktree' | 'branch-history';
  /** Commit used when artifacts had to be recovered from branch history. */
  artifactCommit?: string;
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

async function ensureMergeWorktreeFromBranch(opts: {
  cwd: string;
  featureBranch: string;
  mergeWorktreePath: string;
}): Promise<void> {
  if (existsSync(opts.mergeWorktreePath)) return;

  await mkdir(dirname(opts.mergeWorktreePath), { recursive: true });
  await exec('git', ['worktree', 'add', opts.mergeWorktreePath, opts.featureBranch], { cwd: opts.cwd });
}

/**
 * Find the newest commit on the feature branch that still carries the
 * orchestration.yaml artifact (the tip may be a cleanup deletion). Read-only.
 */
async function findOrchestrationCommitInHistory(opts: {
  cwd: string;
  featureBranch: string;
  orchRelPath: string;
}): Promise<string | undefined> {
  const { stdout: commitsOut } = await exec(
    'git',
    ['rev-list', opts.featureBranch, '--', opts.orchRelPath],
    { cwd: opts.cwd },
  );
  const candidateCommits = commitsOut.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const candidate of candidateCommits) {
    try {
      await exec('git', ['cat-file', '-e', `${candidate}:${opts.orchRelPath}`], { cwd: opts.cwd });
      return candidate;
    } catch {
      // The latest path-touching commit may be a cleanup deletion; keep walking.
    }
  }
  return undefined;
}

async function recoverArtifactsFromBranchHistory(opts: {
  cwd: string;
  featureBranch: string;
  mergeWorktreePath: string;
  outputDir: string;
  setName: string;
}): Promise<{ artifactBasePath: string; artifactCommit: string } | undefined> {
  const planSetPath = join(opts.outputDir, opts.setName);
  const orchRelPath = join(planSetPath, 'orchestration.yaml');

  const artifactCommit = await findOrchestrationCommitInHistory({
    cwd: opts.cwd,
    featureBranch: opts.featureBranch,
    orchRelPath,
  });
  if (!artifactCommit) return undefined;

  const { stdout: filesOut } = await exec(
    'git',
    ['ls-tree', '-r', '--name-only', artifactCommit, '--', planSetPath],
    { cwd: opts.cwd },
  );
  const files = filesOut.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!files.includes(orchRelPath)) return undefined;

  const artifactBasePath = join(dirname(opts.mergeWorktreePath), '__resume_artifacts__');
  const targetPlanSetDir = join(artifactBasePath, planSetPath);
  await rm(targetPlanSetDir, { recursive: true, force: true });

  for (const relPath of files) {
    const { stdout } = await exec('git', ['show', `${artifactCommit}:${relPath}`], { cwd: opts.cwd });
    const targetPath = join(artifactBasePath, relPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, stdout, 'utf-8');
  }

  return { artifactBasePath, artifactCommit };
}

async function resolveCompiledArtifactSource(opts: {
  cwd: string;
  featureBranch: string;
  mergeWorktreePath: string;
  outputDir: string;
  setName: string;
}): Promise<
  | { ok: true; artifactBasePath: string; artifactSource: 'merge-worktree' | 'branch-history'; artifactCommit?: string }
  | { ok: false; checkedPath: string }
> {
  await ensureMergeWorktreeFromBranch(opts);

  const orchPath = resolve(opts.mergeWorktreePath, opts.outputDir, opts.setName, 'orchestration.yaml');
  if (existsSync(orchPath)) {
    return { ok: true, artifactBasePath: opts.mergeWorktreePath, artifactSource: 'merge-worktree' };
  }

  const recovered = await recoverArtifactsFromBranchHistory(opts);
  if (recovered) {
    return { ok: true, artifactBasePath: recovered.artifactBasePath, artifactSource: 'branch-history', artifactCommit: recovered.artifactCommit };
  }

  return { ok: false, checkedPath: orchPath };
}

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

  // 0. Reject set names carrying Git revision syntax before interpolating them
  //    into refs handed to rev-parse/worktree add/cat-file/rev-list.
  if (!isGitRevisionSafeSetName(setName)) {
    return {
      eligible: false,
      reason: `invalid set name ${setName} — contains characters that are not allowed in a branch ref`,
    };
  }

  // 1. Feature branch must exist.
  try {
    await exec('git', ['rev-parse', '--verify', '--end-of-options', featureBranch], { cwd });
  } catch {
    return {
      eligible: false,
      reason: `feature branch ${featureBranch} not found — compiled artifacts cannot be located without the feature branch`,
    };
  }

  // 2. orchestration.yaml must be available from the merge worktree, the
  //    feature branch tip, or the feature branch history. Worktrees are
  //    disposable scratch; the branch is the durable artifact store.
  let artifactSource: Awaited<ReturnType<typeof resolveCompiledArtifactSource>>;
  try {
    artifactSource = await resolveCompiledArtifactSource({ cwd, featureBranch, mergeWorktreePath, outputDir, setName });
  } catch (err) {
    return {
      eligible: false,
      reason: `failed to recreate merge worktree for ${featureBranch}: ${(err as Error).message}`,
    };
  }

  if (!artifactSource.ok) {
    return {
      eligible: false,
      reason: `orchestration.yaml not found — compiled plan artifacts are missing from the preserved branch and its history`,
      checkedPath: artifactSource.checkedPath,
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
    artifactBasePath: artifactSource.artifactBasePath,
    artifactSource: artifactSource.artifactSource,
    ...(artifactSource.artifactCommit !== undefined ? { artifactCommit: artifactSource.artifactCommit } : {}),
  };
}

/**
 * Resolve the plan-set name for a resume. Reads `summary.setName` from
 * `<failedDir>/<prdId>.recovery.json` when a valid sidecar exists, otherwise
 * falls back to `prdId`. Never throws — missing/malformed sidecars use `prdId`.
 */
export async function resolveResumeSetName(opts: {
  prdId: string;
  /** Directory holding `<prdId>.recovery.json` (typically `.eforge/queue/failed`). */
  failedDir: string;
}): Promise<string> {
  // Reject unsafe prdId path segments before building any filesystem path, so an
  // untrusted caller cannot traverse outside failedDir to read an arbitrary sidecar.
  if (
    !opts.prdId ||
    opts.prdId.includes('/') ||
    opts.prdId.includes('\\') ||
    opts.prdId.includes('..')
  ) {
    return opts.prdId;
  }
  try {
    const sidecarPath = join(opts.failedDir, `${opts.prdId}.recovery.json`);
    const parsed = JSON.parse(await readFile(sidecarPath, 'utf-8')) as { summary?: { setName?: string } };
    return typeof parsed.summary?.setName === 'string' && parsed.summary.setName.length > 0
      ? parsed.summary.setName
      : opts.prdId;
  } catch {
    return opts.prdId;
  }
}

// ---------------------------------------------------------------------------
// Read-only resume eligibility projection
// ---------------------------------------------------------------------------

/** Where compiled-build resume artifacts can be sourced from. */
export type ResumeArtifactAvailability = 'merge-worktree' | 'feature-branch' | 'branch-history';

/**
 * Read-only resume eligibility projection result. Unlike
 * {@link ResumeEligibilityResult}, it never recreates worktrees or materializes
 * `__resume_artifacts__` — safe for UI preflight polling.
 */
export type ResumeEligibilityProjection =
  | {
      eligible: true;
      featureBranch: string;
      artifactAvailability: ResumeArtifactAvailability;
      artifactCommit?: string;
      landedCommitCount: number;
      diffStat: string;
      failingPlanId?: string;
      partial?: boolean;
    }
  | {
      eligible: false;
      featureBranch: string;
      reason: string;
      checkedPath?: string;
    };

async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await exec('git', ['rev-parse', '--verify', '--end-of-options', ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reject plan-set names that contain Git revision metacharacters before they
 * are interpolated into a ref like `eforge/<setName>` and handed to
 * rev-parse/cat-file/rev-list. Path-segment validation upstream only blocks
 * traversal sequences, so characters such as `~ ^ : ? * [ \\ { } @` and
 * whitespace could otherwise let Git resolve a revision expression instead of
 * the intended branch ref. Mirrors the conservative subset of
 * `git check-ref-format` that matters for safe interpolation.
 */
function isGitRevisionSafeSetName(setName: string): boolean {
  return (
    setName.length > 0 &&
    !/[\x00-\x20~^:?*[\\{}@]/.test(setName) &&
    !setName.includes('..')
  );
}

async function orchestrationExistsAtRef(cwd: string, ref: string, orchRelPath: string): Promise<boolean> {
  try {
    await exec('git', ['cat-file', '-e', `${ref}:${orchRelPath}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compute resume eligibility without side effects: the read-only counterpart to
 * {@link checkResumeEligibility}. Inspects git refs/history, existing filesystem
 * paths, and monitor DB + git failure evidence (via `buildFailureSummary`).
 * Never creates worktrees, copies artifacts, deletes files, or spawns workers.
 */
export async function projectResumeEligibility(opts: {
  cwd: string;
  setName: string;
  prdId: string;
  mergeWorktreePath: string;
  outputDir: string;
  dbPath?: string;
  trunkBranch?: string;
}): Promise<ResumeEligibilityProjection> {
  const { cwd, setName, prdId, mergeWorktreePath, outputDir, dbPath, trunkBranch } = opts;
  const featureBranch = `eforge/${setName}`;
  const orchRelPath = join(outputDir, setName, 'orchestration.yaml');

  // 0. Reject set names carrying Git revision syntax before interpolating them
  //    into refs handed to rev-parse/cat-file/rev-list.
  if (!isGitRevisionSafeSetName(setName)) {
    return {
      eligible: false,
      featureBranch,
      reason: `invalid set name ${setName} — contains characters that are not allowed in a branch ref`,
    };
  }

  // 1. Feature branch must exist. Read-only: never create worktrees.
  if (!(await gitRefExists(cwd, featureBranch))) {
    return {
      eligible: false,
      featureBranch,
      reason: `feature branch ${featureBranch} not found — compiled artifacts cannot be located without the feature branch`,
    };
  }

  // 2. Locate orchestration.yaml without creating worktrees or copying files:
  //    prefer an existing merge worktree, then the branch tip, then history.
  const mergeOrchPath = resolve(mergeWorktreePath, outputDir, setName, 'orchestration.yaml');
  let artifactAvailability: ResumeArtifactAvailability | undefined;
  let artifactCommit: string | undefined;

  if (existsSync(mergeOrchPath)) {
    artifactAvailability = 'merge-worktree';
  } else if (await orchestrationExistsAtRef(cwd, featureBranch, orchRelPath)) {
    artifactAvailability = 'feature-branch';
  } else {
    const historyCommit = await findOrchestrationCommitInHistory({ cwd, featureBranch, orchRelPath }).catch(() => undefined);
    if (historyCommit) {
      artifactAvailability = 'branch-history';
      artifactCommit = historyCommit;
    }
  }

  if (!artifactAvailability) {
    return {
      eligible: false,
      featureBranch,
      reason: `orchestration.yaml not found — compiled plan artifacts are missing from the preserved branch and its history`,
      checkedPath: mergeOrchPath,
    };
  }

  // 3. Failure evidence from monitor DB + git history (read-only).
  let summary: BuildFailureSummary;
  try {
    summary = await buildFailureSummary({ setName, prdId, cwd, dbPath, trunkBranch });
  } catch {
    return {
      eligible: false,
      featureBranch,
      reason: `failed to reconstruct build failure summary — no monitor DB or git evidence available for ${setName}`,
    };
  }

  const hasEvidence = !summary.partial || summary.landedCommits.length > 0;
  if (!hasEvidence) {
    return {
      eligible: false,
      featureBranch,
      reason: `no failed-run evidence found for ${setName} — check that monitor.db exists and the feature branch has landed commits`,
    };
  }

  const failingPlanId = summary.failingPlan?.planId;

  return {
    eligible: true,
    featureBranch,
    artifactAvailability,
    ...(artifactCommit !== undefined ? { artifactCommit } : {}),
    landedCommitCount: summary.landedCommits.length,
    diffStat: summary.diffStat,
    ...(failingPlanId && failingPlanId !== 'unknown' ? { failingPlanId } : {}),
    ...(summary.partial !== undefined ? { partial: summary.partial } : {}),
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

