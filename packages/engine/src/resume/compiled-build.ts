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
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildFailureSummary } from '../recovery/failure-summary.js';
import { tryReadRecoverySidecarProjection } from '../recovery/sidecar-read.js';
import type { BuildFailureSummary } from '../events.js';

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

// Resume projection, state-seeding, and formatting helpers live in a sibling
// module to keep this file under the implementation size cap. Re-exported here
// so existing import sites keep resolving from `./resume/compiled-build.js`.
export {
  deriveResumeSeedState,
  buildResumeArtifactsProjection,
  formatResumeContext,
  getPlanMarkdownPath,
} from './resume-projection.js';
export type { ResumeStatus, ResumeSeedState, ResumeArtifactsProjection } from './resume-projection.js';
export { resolveResumePrdContent } from './prd-content.js';
export type { ResolvedResumePrdContent, ResumePrdContentSource } from './prd-content.js';
export { prepareFailedPrdForQueuedCompiledResume, resolveQueuedCompiledResumeMetadata } from './queued-resume.js';
export type { PrepareQueuedCompiledResumeResult, QueuedCompiledResumeMetadata } from './queued-resume.js';

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
  featureBranch?: string;
  baseBranch?: string;
}): Promise<ResumeEligibilityResult> {
  const { cwd, setName, prdId, mergeWorktreePath, outputDir, dbPath, trunkBranch } = opts;
  const featureBranch = opts.featureBranch ?? `eforge/${setName}`;

  // 0. Reject set names carrying Git revision syntax before interpolating them
  //    into refs handed to rev-parse/worktree add/cat-file/rev-list.
  if (!isGitRevisionSafeSetName(setName)) {
    return {
      eligible: false,
      reason: `invalid set name ${setName} — contains characters that are not allowed in a branch ref`,
    };
  }
  if (!isGitRevisionSafeSetName(featureBranch) || (opts.baseBranch !== undefined && !isGitRevisionSafeSetName(opts.baseBranch))) {
    return {
      eligible: false,
      reason: `invalid resume branch metadata — contains characters that are not allowed in a branch ref`,
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
    summary = await buildFailureSummary({ setName, prdId, cwd, dbPath, trunkBranch: opts.baseBranch ?? trunkBranch, featureBranch, baseBranch: opts.baseBranch });
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
 * Resolve the plan-set name for a resume. Reads top-level `setName` from the
 * current v3 recovery sidecar when one exists, otherwise falls back to `prdId`.
 * Missing sidecars use `prdId`; malformed current sidecars throw validation errors.
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
  const projection = await tryReadRecoverySidecarProjection(opts.failedDir, opts.prdId);
  return typeof projection?.sidecar.setName === 'string' && projection.sidecar.setName.length > 0
    ? projection.sidecar.setName
    : opts.prdId;
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
  featureBranch?: string;
  baseBranch?: string;
}): Promise<ResumeEligibilityProjection> {
  const { cwd, setName, prdId, mergeWorktreePath, outputDir, dbPath, trunkBranch } = opts;
  const featureBranch = opts.featureBranch ?? `eforge/${setName}`;
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
  if (!isGitRevisionSafeSetName(featureBranch) || (opts.baseBranch !== undefined && !isGitRevisionSafeSetName(opts.baseBranch))) {
    return {
      eligible: false,
      featureBranch,
      reason: `invalid resume branch metadata — contains characters that are not allowed in a branch ref`,
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
    summary = await buildFailureSummary({ setName, prdId, cwd, dbPath, trunkBranch: opts.baseBranch ?? trunkBranch, featureBranch, baseBranch: opts.baseBranch });
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


