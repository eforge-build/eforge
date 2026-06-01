/**
 * PRD queue loading, parsing, ordering, and status updates.
 * Scans a directory for .md files with YAML frontmatter, parses them
 * into QueuedPrd records, and resolves execution order using the
 * same dependency graph algorithm as plan orchestration.
 */

import { readFile, readdir, writeFile, mkdir, rm, open, rename } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { resolve, basename } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod/v4';
import { resolveDependencyGraph } from './plan.js';
import { forgeCommit, retryOnLock } from './git.js';
import { composeCommitMessage } from './model-tracker.js';
import type { ModelTracker } from './model-tracker.js';
import { writeRecoverySidecar } from './recovery/sidecar.js';
import type { BuildFailureSummary, RecoveryVerdict } from './events.js';
import { loadArtifactRegistry, hasUsableArtifact } from './artifacts/registry.js';
import { loadCompletionRegistry, lookupCompletion } from './artifacts/completions.js';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Frontmatter schema
// ---------------------------------------------------------------------------

const prdFrontmatterSchema = z.object({
  title: z.string(),
  created: z.string().optional(),
  priority: z.number().int().optional(),
  depends_on: z.array(z.string()).optional(),
  skip_reason: z.string().optional(),
  profile: z.string().optional(),
  stack_id: z.string().optional(),
  stack_parent: z.string().optional(),
  stack_provider: z.literal('git-spice').optional(),
  landing: z.enum(['pr', 'merge', 'leave']).optional(),
  landing_auto_merge: z.boolean().optional(),
  recovery_from: z.string().min(1).optional(),
  recovery_set_name: z.string().min(1).optional(),
  recovery_feature_branch: z.string().min(1).optional(),
  recovery_base_branch: z.string().min(1).optional(),
});

export type PrdFrontmatter = z.output<typeof prdFrontmatterSchema>;

export interface RecoveryContinuationFrontmatter {
  sourcePrdId: string;
  setName: string;
  featureBranch: string;
  baseBranch: string;
}

export function getRecoveryContinuationFrontmatter(frontmatter: PrdFrontmatter): RecoveryContinuationFrontmatter | undefined {
  const fields = {
    recovery_from: frontmatter.recovery_from,
    recovery_set_name: frontmatter.recovery_set_name,
    recovery_feature_branch: frontmatter.recovery_feature_branch,
    recovery_base_branch: frontmatter.recovery_base_branch,
  };
  const present = Object.values(fields).filter((value) => value !== undefined);
  if (present.length === 0) return undefined;
  if (present.length !== 4) {
    const missing = Object.entries(fields)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key)
      .join(', ');
    throw new Error(`Incomplete recovery continuation frontmatter; missing: ${missing}`);
  }
  return {
    sourcePrdId: fields.recovery_from,
    setName: fields.recovery_set_name,
    featureBranch: fields.recovery_feature_branch,
    baseBranch: fields.recovery_base_branch,
  } as RecoveryContinuationFrontmatter;
}

export interface QueuedPrd {
  /** Filename without extension — used as the PRD id */
  id: string;
  /** Absolute path to the PRD file */
  filePath: string;
  /** Parsed frontmatter */
  frontmatter: PrdFrontmatter;
  /** Full file content (frontmatter + body) */
  content: string;
  /** Last commit hash touching this file (empty string if untracked) */
  lastCommitHash: string;
  /** Last commit date for this file (empty string if untracked) */
  lastCommitDate: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract YAML frontmatter from a markdown file.
 * Returns the parsed object or null if no frontmatter found.
 */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  // Simple YAML key-value parser (avoids full YAML dep for frontmatter)
  const lines = match[1].split('\n');
  const result: Record<string, unknown> = {};

  for (const line of lines) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;
    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();

    // Handle arrays (inline [a, b] syntax)
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')) : [];
    }
    // Handle numbers
    else if (/^-?\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    }
    // Handle booleans
    else if (value === 'true' || value === 'false') {
      result[key] = value === 'true';
    }
    // Handle quoted strings
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
    }
    // Plain string
    else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Validate PRD frontmatter against the Zod schema.
 * Returns success/error result from safeParse.
 * Rejects the legacy `onSuccess` field with a migration error.
 */
export function validatePrdFrontmatter(data: unknown): z.ZodSafeParseResult<PrdFrontmatter> {
  if (data && typeof data === 'object' && 'onSuccess' in (data as object)) {
    return {
      success: false as const,
      error: new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ['onSuccess'],
        message:
          'PRD frontmatter "onSuccess" is removed. Use "landing: pr|merge|leave" instead. ' +
          'Replace onSuccess: merge-to-base-branch → landing: merge, ' +
          'onSuccess: issue-pr → landing: pr, ' +
          'onSuccess: leave-branch → landing: leave.',
      }]),
    } as z.ZodSafeParseResult<PrdFrontmatter>;
  }
  return prdFrontmatterSchema.safeParse(data);
}

// ---------------------------------------------------------------------------
// Queue loading
// ---------------------------------------------------------------------------

/**
 * Load all PRD files from a directory, parsing frontmatter and
 * fetching git metadata for each file.
 */
export async function loadQueue(dir: string, cwd: string): Promise<QueuedPrd[]> {
  const absDir = resolve(cwd, dir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return []; // Directory doesn't exist — empty queue
  }

  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();
  const prds: QueuedPrd[] = [];

  for (const file of mdFiles) {
    const filePath = resolve(absDir, file);
    const content = await readFile(filePath, 'utf-8');
    const rawFrontmatter = parseFrontmatter(content);
    if (!rawFrontmatter) continue; // Skip files without frontmatter

    const parseResult = validatePrdFrontmatter(rawFrontmatter);
    if (!parseResult.success) {
      const hasLegacyOnSuccess = parseResult.error.issues.some((issue) => issue.path[0] === 'onSuccess');
      if (hasLegacyOnSuccess) {
        throw new Error(`Invalid PRD frontmatter in ${file}: ${z.prettifyError(parseResult.error)}`);
      }
      continue; // Skip files with invalid frontmatter
    }

    const frontmatter = parseResult.data;
    const id = basename(file, '.md');

    // Get git metadata
    let lastCommitHash = '';
    let lastCommitDate = '';
    try {
      const { stdout } = await exec('git', ['log', '-1', '--format=%H %ci', '--', filePath], { cwd });
      const trimmed = stdout.trim();
      if (trimmed) {
        const spaceIdx = trimmed.indexOf(' ');
        lastCommitHash = trimmed.slice(0, spaceIdx);
        lastCommitDate = trimmed.slice(spaceIdx + 1);
      }
    } catch {
      // Not a git repo or file untracked — leave empty
    }

    prds.push({
      id,
      filePath,
      frontmatter,
      content,
      lastCommitHash,
      lastCommitDate,
    });
  }

  return prds;
}

// ---------------------------------------------------------------------------
// Queue ordering
// ---------------------------------------------------------------------------

/**
 * Resolve execution order for PRDs.
 * All PRDs in the queue directory are pending by definition (file-location state model).
 * Uses the same topological sort as plan orchestration for dependency ordering.
 * Within each wave, sorts by priority (ascending, nulls last) then created (ascending).
 */
export function resolveQueueOrder(prds: QueuedPrd[]): QueuedPrd[] {
  if (prds.length === 0) return [];

  // Build lookup of all PRD ids for dependency filtering
  const allIds = new Set(prds.map((p) => p.id));

  // Build plans-like structure for dependency resolution.
  // Filter out dependsOn entries that reference non-pending PRDs (e.g., completed)
  // since resolveDependencyGraph throws on unknown ids, and completed deps are
  // already satisfied.
  const plans = prds.map((p) => ({
    id: p.id,
    name: p.frontmatter.title,
    dependsOn: (p.frontmatter.depends_on ?? []).filter((dep) => allIds.has(dep)),
    branch: '', // Not used for queue ordering
  }));

  const { waves } = resolveDependencyGraph(plans);

  // Build lookup for sorting within waves
  const prdMap = new Map(prds.map((p) => [p.id, p]));

  const ordered: QueuedPrd[] = [];
  for (const wave of waves) {
    // Sort within wave: priority ascending (nulls last), then created ascending
    const wavePrds = wave
      .map((id) => prdMap.get(id))
      .filter((p): p is QueuedPrd => p !== undefined)
      .sort((a, b) => {
        const aPri = a.frontmatter.priority;
        const bPri = b.frontmatter.priority;
        // Priority: ascending, nulls last
        if (aPri !== undefined && bPri !== undefined) {
          if (aPri !== bPri) return aPri - bPri;
        } else if (aPri !== undefined) {
          return -1;
        } else if (bPri !== undefined) {
          return 1;
        }
        // Created: ascending
        const aCreated = a.frontmatter.created ?? '';
        const bCreated = b.frontmatter.created ?? '';
        return aCreated.localeCompare(bCreated);
      });
    ordered.push(...wavePrds);
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Get the current HEAD commit hash.
 * Returns empty string if not a git repo.
 */
export async function getHeadHash(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    return stdout.trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Git diff summary
// ---------------------------------------------------------------------------

/**
 * Get a git diff --stat summary between a commit hash and HEAD.
 * Returns empty string if hash is empty or diff fails.
 */
export async function getPrdDiffSummary(hash: string, cwd: string): Promise<string> {
  if (!hash) return '';
  try {
    const { stdout } = await exec('git', ['diff', '--stat', hash, 'HEAD'], { cwd });
    return stdout.trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// PRD provenance artifact
// ---------------------------------------------------------------------------

/**
 * Materialize a temporary PRD provenance artifact on the eforge work branch.
 *
 * Writes `eforge/prds/{prdId}.md` in the merge worktree, stages it, and commits
 * it via `forgeCommit` with message `build({prdId}): record PRD provenance`.
 * The artifact is committed early in the eforge work branch history so it
 * appears in every PR diff window before cleanup runs.
 *
 * @returns The relative path to the created artifact (`eforge/prds/{prdId}.md`),
 *          which callers should pass to `cleanupPlanFiles` so cleanup removes it.
 */
export async function materializePrdArtifact(options: {
  mergeWorktreePath: string;
  prdId: string;
  prdContent: string;
  modelTracker?: ModelTracker;
}): Promise<{ artifactRelPath: string }> {
  const { mergeWorktreePath, prdId, prdContent, modelTracker } = options;

  const artifactRelPath = `eforge/prds/${prdId}.md`;
  const artifactAbsPath = resolve(mergeWorktreePath, artifactRelPath);
  const artifactDir = resolve(mergeWorktreePath, 'eforge', 'prds');

  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactAbsPath, prdContent, 'utf-8');

  await retryOnLock(
    () => exec('git', ['add', '--', artifactAbsPath], { cwd: mergeWorktreePath }),
    mergeWorktreePath,
  );
  await forgeCommit(
    mergeWorktreePath,
    composeCommitMessage(`build(${prdId}): record PRD provenance`, modelTracker),
    { paths: [artifactAbsPath] },
  );

  return { artifactRelPath };
}

// ---------------------------------------------------------------------------
// PRD removal
// ---------------------------------------------------------------------------

/**
 * Remove a completed PRD file from disk.
 * Filesystem-only — queue state is runtime, not tracked in git.
 */
export async function cleanupCompletedPrd(filePath: string, queueDir: string, cwd: string): Promise<void> {
  // Guard: filePath must reside within the queue directory
  const absFilePath = resolve(filePath);
  const absQueueDir = resolve(cwd, queueDir);
  if (!absFilePath.startsWith(absQueueDir + '/')) {
    throw new Error(`filePath ${filePath} is outside queue directory ${absQueueDir}`);
  }

  await rm(absFilePath, { force: true });
}

// ---------------------------------------------------------------------------
// File-location state helpers
// ---------------------------------------------------------------------------

/**
 * Move a PRD file to a subdirectory (e.g. `failed/` or `skipped/`) via filesystem rename.
 * Filesystem-only — queue state is runtime, not tracked in git.
 */
export async function movePrdToSubdir(filePath: string, subdir: string, _cwd: string): Promise<void> {
  const dir = resolve(filePath, '..');
  const destDir = resolve(dir, subdir);
  await mkdir(destDir, { recursive: true });

  const destPath = resolve(destDir, basename(filePath));
  await rename(filePath, destPath);
}

/**
 * Move a failed PRD to `failed/` and write both recovery sidecar files
 * (`.recovery.md` + `.recovery.json`). Filesystem-only — queue state is
 * runtime, not tracked in git. Sidecars live alongside the failed PRD
 * under `.eforge/queue/failed/` as runtime state.
 *
 * @returns Absolute paths to the moved PRD and the two sidecar files.
 */
export async function moveFailedWithSidecar(
  filePath: string,
  summary: BuildFailureSummary,
  verdict: RecoveryVerdict,
  _modelTracker: ModelTracker | undefined,
  _cwd: string,
): Promise<{ mdPath: string; jsonPath: string; destPath: string }> {
  const dir = resolve(filePath, '..');
  const destDir = resolve(dir, 'failed');
  await mkdir(destDir, { recursive: true });

  const destPath = resolve(destDir, basename(filePath));
  const prdId = basename(filePath, '.md');

  // Filesystem-only: move PRD file to failed/
  await rename(filePath, destPath);

  // Write both sidecar files (atomic temp-then-rename inside writeRecoverySidecar)
  const { mdPath, jsonPath } = await writeRecoverySidecar({
    failedPrdDir: destDir,
    prdId,
    summary,
    verdict,
  });

  return { mdPath, jsonPath, destPath };
}

/**
 * Check whether a PRD is currently being processed by looking for its lock file.
 */
export async function isPrdRunning(prdId: string, cwd: string): Promise<boolean> {
  const lockPath = resolve(cwd, '.eforge', 'queue-locks', `${prdId}.lock`);
  try {
    await readFile(lockPath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lock status classification
// ---------------------------------------------------------------------------

export type PrdLockStatus =
  | { state: 'absent' }
  | { state: 'live'; pid: number }
  | { state: 'stale'; pid: number }
  | { state: 'corrupt' };

/**
 * Read and classify the lock file state for a root-queue PRD.
 *
 * - `absent`: no lock file exists
 * - `live`: lock file contains a valid PID that is currently alive
 * - `stale`: lock file contains a valid PID whose process is no longer alive
 * - `corrupt`: lock file content is empty, non-numeric, non-finite, or non-positive
 *
 * PID liveness uses `process.kill(pid, 0)`: no-throw means alive, ESRCH means
 * dead, EPERM means alive-but-unpermissioned.
 */
export async function readPrdLockStatus(prdId: string, cwd: string): Promise<PrdLockStatus> {
  const lockPath = resolve(cwd, '.eforge', 'queue-locks', `${prdId}.lock`);
  let content: string;
  try {
    content = await readFile(lockPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'absent' };
    }
    throw err;
  }

  // Validate: must be non-empty, decimal integer content, finite, safe, and positive.
  const trimmed = content.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return { state: 'corrupt' };
  }
  const pid = Number(trimmed);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { state: 'corrupt' };
  }

  // Check PID liveness via signal 0
  try {
    process.kill(pid, 0);
    return { state: 'live', pid };
  } catch (err: unknown) {
    const errCode = (err as NodeJS.ErrnoException).code;
    if (errCode === 'EPERM') {
      // Process exists but we lack permission to signal it — it is alive
      return { state: 'live', pid };
    }
    // ESRCH or any other error means the process is gone
    return { state: 'stale', pid };
  }
}

// ---------------------------------------------------------------------------
// Subprocess-per-build exit code contract
// ---------------------------------------------------------------------------

/**
 * Exit codes for the `eforge queue exec <prdId>` subprocess, used by the
 * queue scheduler to determine how to clean up after the child exits.
 *
 * The scheduler spawns one child process per PRD; this is the sole channel
 * by which the child tells the parent what happened and what cleanup is
 * needed. Any exit code not listed here (or signal kill) is treated as
 * `Failed` and the parent performs the safety-net cleanup (release lock,
 * move PRD to failed/).
 */
export const QueueExecExitCode = {
  /** PRD built successfully; file already deleted during build. */
  Completed: 0,
  /** Build failed; parent should release lock and move PRD to failed/. */
  Failed: 1,
  /** Skipped (e.g. obsolete); parent should release lock and move PRD to skipped/. */
  Skipped: 2,
  /** PRD not found in queue (bad prdId). */
  NotFound: 127,
  /** Skipped because another process holds the claim; parent must NOT release the lock and must NOT move the file. */
  SkippedAlreadyClaimed: 10,
  /** Skipped because the PRD needs manual revision; parent should release the lock but leave the file in queue/. */
  SkippedNeedsRevision: 11,
} as const;

export type QueueExecExit = typeof QueueExecExitCode[keyof typeof QueueExecExitCode];

/**
 * Canonical skip reasons emitted on `queue:prd:skip` events.
 *
 * These strings are load-bearing: they are how the subprocess entry point
 * communicates *why* a PRD was skipped back through the exit code, and in
 * turn how the parent scheduler decides whether to release the lock and/or
 * move the PRD file. Do not inline the literals — always reference this
 * const so emitter and interpreter can't drift.
 */
export const QueueSkipReason = {
  AlreadyClaimed: 'claimed by another process',
  NeedsRevision: 'needs revision',
  Obsolete: 'obsolete',
} as const;

export type QueueSkipReasonValue = typeof QueueSkipReason[keyof typeof QueueSkipReason];

/**
 * Map a terminal `queue:prd:complete` status (+ skip reason, if any) to the
 * exit code the child should return. Called by the subprocess entry point
 * after events drain.
 */
export function queueExecExitCode(
  completionStatus: 'completed' | 'failed' | 'skipped' | undefined,
  skipReason: string | undefined,
): number {
  if (completionStatus === 'completed') return QueueExecExitCode.Completed;
  if (completionStatus === 'failed') return QueueExecExitCode.Failed;
  if (completionStatus === 'skipped') {
    if (skipReason === QueueSkipReason.AlreadyClaimed) return QueueExecExitCode.SkippedAlreadyClaimed;
    if (skipReason === QueueSkipReason.NeedsRevision) return QueueExecExitCode.SkippedNeedsRevision;
    return QueueExecExitCode.Skipped;
  }
  // No terminal event was emitted — treat as failed so the parent cleans up.
  return QueueExecExitCode.Failed;
}

// ---------------------------------------------------------------------------
// Lockfile-based PRD claim
// ---------------------------------------------------------------------------

/**
 * Atomically claim a PRD by creating an exclusive lock file.
 * Uses O_CREAT | O_EXCL flags so only one process can create the file.
 * Writes the current PID into the lock file for debugging.
 * Returns `true` if the claim succeeded, `false` if another process holds it.
 */
export async function claimPrd(prdId: string, cwd: string): Promise<boolean> {
  const lockDir = resolve(cwd, '.eforge', 'queue-locks');
  await mkdir(lockDir, { recursive: true });
  const lockPath = resolve(lockDir, `${prdId}.lock`);
  try {
    const fd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await fd.writeFile(String(process.pid), 'utf-8');
    await fd.close();
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Lock is held by another process. Stale locks (owning PID dead) are
      // the startup reconciler's job, not ours — we assume a live lock means
      // a live owner.
      return false;
    }
    throw err;
  }
}

/**
 * Release a PRD claim by removing the lock file.
 * Best-effort and non-throwing — if the lock file is already gone, that's fine.
 */
export async function releasePrd(prdId: string, cwd: string): Promise<void> {
  const lockPath = resolve(cwd, '.eforge', 'queue-locks', `${prdId}.lock`);
  try {
    await rm(lockPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Title inference
// ---------------------------------------------------------------------------

/**
 * Infer a title from PRD content.
 * Extracts the first `# ` heading if present, otherwise deslugifies
 * a filename-like string (e.g., "my-feature" -> "My Feature").
 */
export function inferTitle(content: string, fallbackSlug?: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  if (fallbackSlug) {
    return fallbackSlug
      .replace(/\.md$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return 'Untitled PRD';
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueuePrdOptions {
  /** Formatted PRD body content */
  body: string;
  /** PRD title */
  title: string;
  /** Queue directory (absolute or relative to cwd) */
  queueDir: string;
  /** Working directory for resolving relative paths */
  cwd: string;
  /** Optional priority (lower = higher priority) */
  priority?: number;
  /** Optional dependency list */
  depends_on?: string[];
  /** If true, write to waiting/ subdirectory (for piggybacked PRDs awaiting upstream completion) */
  intoWaiting?: boolean;
  /** Commands to run after the build merges (forwarded from playbook frontmatter) */
  postMerge?: string[];
  /** Override profile name to persist in frontmatter for per-build profile binding. */
  profile?: string;
  /** Landing action to persist in PRD frontmatter (canonical: pr | merge | leave). */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** Per-run PR auto-merge intent to persist in PRD frontmatter. */
  landingAutoMerge?: boolean;
  /** Logical stack identifier to persist in PRD frontmatter. */
  stack_id?: string;
  /** Parent PRD id for this stack layer, if any. */
  stack_parent?: string;
  /** Stack provider override for this PRD. */
  stack_provider?: 'git-spice';
  /** Failed PRD id that produced this recovery continuation. */
  recovery_from?: string;
  /** Failed build set name that produced this recovery continuation. */
  recovery_set_name?: string;
  /** Preserved failed feature branch to use as the successor worktree base. */
  recovery_feature_branch?: string;
  /** Original logical base branch for orchestration and landing. */
  recovery_base_branch?: string;
}

export interface EnqueuePrdResult {
  /** Slug-based id (filename without extension) */
  id: string;
  /** Absolute path to the written file */
  filePath: string;
  /** The frontmatter that was written */
  frontmatter: PrdFrontmatter;
}

/**
 * Generate a URL-safe slug from a title.
 * Lowercases, replaces non-alphanumeric chars with hyphens,
 * collapses consecutive hyphens, trims leading/trailing hyphens.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Write a formatted PRD to the queue directory with YAML frontmatter.
 *
 * Pure file I/O - no agent calls, no events. Handles:
 * - Frontmatter generation (title, created=today, status=pending)
 * - Slug generation from title
 * - Duplicate slug handling (-2, -3 suffix)
 * - Queue directory auto-creation
 * - Optional `intoWaiting` flag to write to the waiting/ subdirectory
 */
export async function enqueuePrd(options: EnqueuePrdOptions): Promise<EnqueuePrdResult> {
  const {
    body,
    title,
    queueDir,
    cwd,
    priority,
    depends_on,
    intoWaiting,
    postMerge,
    profile,
    landingAction,
    landingAutoMerge,
    stack_id,
    stack_parent,
    stack_provider,
    recovery_from,
    recovery_set_name,
    recovery_feature_branch,
    recovery_base_branch,
  } = options;

  // Use waiting/ subdirectory when the PRD has unsatisfied upstream deps
  const targetSubdir = intoWaiting ? 'waiting' : undefined;
  const absDir = targetSubdir
    ? resolve(cwd, queueDir, targetSubdir)
    : resolve(cwd, queueDir);

  // Create queue dir if needed
  await mkdir(absDir, { recursive: true });

  // Generate slug and handle duplicates
  const baseSlug = slugify(title) || 'untitled';
  let slug = baseSlug;
  let suffix = 1;

  // Read existing files to check for duplicates
  let existing: string[];
  try {
    existing = await readdir(absDir);
  } catch {
    existing = [];
  }

  const existingSet = new Set(existing.map((f) => basename(f, '.md')));
  while (existingSet.has(slug)) {
    suffix++;
    slug = `${baseSlug}-${suffix}`;
  }

  // Build frontmatter
  const created = new Date().toISOString().split('T')[0];
  const frontmatter: PrdFrontmatter = {
    title,
    created,
    ...(priority !== undefined && { priority }),
    ...(depends_on !== undefined && depends_on.length > 0 && { depends_on }),
    ...(profile !== undefined && { profile }),
    ...(stack_id !== undefined && { stack_id }),
    ...(stack_parent !== undefined && { stack_parent }),
    ...(stack_provider !== undefined && { stack_provider }),
    ...(landingAction !== undefined && { landing: landingAction }),
    ...(landingAutoMerge !== undefined && { landing_auto_merge: landingAutoMerge }),
    ...(recovery_from !== undefined && { recovery_from }),
    ...(recovery_set_name !== undefined && { recovery_set_name }),
    ...(recovery_feature_branch !== undefined && { recovery_feature_branch }),
    ...(recovery_base_branch !== undefined && { recovery_base_branch }),
  };
  const frontmatterResult = prdFrontmatterSchema.safeParse(frontmatter);
  if (!frontmatterResult.success) {
    throw new Error(`Invalid PRD frontmatter: ${z.prettifyError(frontmatterResult.error)}`);
  }

  // Serialize frontmatter
  const fmLines: string[] = [
    `title: ${title}`,
    `created: ${created}`,
  ];
  if (priority !== undefined) {
    fmLines.push(`priority: ${priority}`);
  }
  if (depends_on !== undefined && depends_on.length > 0) {
    fmLines.push(`depends_on: [${depends_on.map((d) => `"${d}"`).join(', ')}]`);
  }
  if (postMerge !== undefined && postMerge.length > 0) {
    fmLines.push(`postMerge:\n${postMerge.map((cmd) => `  - ${cmd}`).join('\n')}`);
  }
  if (profile !== undefined) {
    fmLines.push(`profile: ${profile}`);
  }
  if (stack_id !== undefined) {
    fmLines.push(`stack_id: ${stack_id}`);
  }
  if (stack_parent !== undefined) {
    fmLines.push(`stack_parent: ${stack_parent}`);
  }
  if (stack_provider !== undefined) {
    fmLines.push(`stack_provider: ${stack_provider}`);
  }
  if (landingAction !== undefined) {
    fmLines.push(`landing: ${landingAction}`);
  }
  if (landingAutoMerge !== undefined) {
    fmLines.push(`landing_auto_merge: ${landingAutoMerge}`);
  }
  if (recovery_from !== undefined) {
    fmLines.push(`recovery_from: ${recovery_from}`);
  }
  if (recovery_set_name !== undefined) {
    fmLines.push(`recovery_set_name: ${recovery_set_name}`);
  }
  if (recovery_feature_branch !== undefined) {
    fmLines.push(`recovery_feature_branch: ${recovery_feature_branch}`);
  }
  if (recovery_base_branch !== undefined) {
    fmLines.push(`recovery_base_branch: ${recovery_base_branch}`);
  }

  const fileContent = `---\n${fmLines.join('\n')}\n---\n\n${body}\n`;
  const filePath = resolve(absDir, `${slug}.md`);
  await writeFile(filePath, fileContent, 'utf-8');

  return {
    id: slug,
    filePath,
    frontmatter: frontmatterResult.data,
  };
}

// ---------------------------------------------------------------------------
// Routed profile persistence (EXTEND_09)
// ---------------------------------------------------------------------------

/**
 * Rewrite the `profile:` frontmatter field in a queued PRD file to the given
 * profile name. Filesystem-only — queue state is runtime, not tracked in git.
 *
 * - Adds the `profile:` line if absent from the frontmatter block.
 * - Replaces the existing `profile:` line if already present.
 * - All other frontmatter fields are preserved unchanged.
 *
 * Returns a new `QueuedPrd` with `frontmatter.profile` set to the routed value.
 * Throws on read/write failure; callers must handle and fall back to
 * the in-memory `routedProfileOverride` path.
 */
export async function setQueuedPrdProfile(
  prd: QueuedPrd,
  profile: string,
  _cwd: string,
): Promise<QueuedPrd> {
  const updated = await setQueuedPrdFrontmatterString(prd, 'profile', profile);
  return {
    ...updated,
    frontmatter: { ...updated.frontmatter, profile },
  };
}

async function setQueuedPrdFrontmatterString(
  prd: QueuedPrd,
  field: string,
  value: string,
): Promise<QueuedPrd> {
  const content = prd.content;

  // Locate the frontmatter block
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`PRD file '${prd.filePath}' has no valid frontmatter block`);
  }

  const [, openDelim, fmBody, closeDelim, bodyPart] = fmMatch;

  let newFmBody: string;
  const fieldLineRegex = new RegExp(`^${field}\\s*:.*$`, 'm');
  if (fieldLineRegex.test(fmBody)) {
    newFmBody = fmBody.replace(fieldLineRegex, `${field}: ${value}`);
  } else {
    newFmBody = fmBody.trimEnd() + `\n${field}: ${value}`;
  }

  const newContent = `${openDelim}${newFmBody}${closeDelim}${bodyPart}`;
  await writeFile(prd.filePath, newContent, 'utf-8');

  return {
    ...prd,
    content: newContent,
  };
}

export async function setQueuedPrdStackParent(
  prd: QueuedPrd,
  stackParent: string,
  _cwd: string,
): Promise<QueuedPrd> {
  const updated = await setQueuedPrdFrontmatterString(prd, 'stack_parent', stackParent);
  return {
    ...updated,
    frontmatter: { ...updated.frontmatter, stack_parent: stackParent },
  };
}

// ---------------------------------------------------------------------------
// Piggyback scheduling helpers
// ---------------------------------------------------------------------------

/**
 * Result of classifying an explicit `afterQueueId` dependency.
 */
export interface AfterQueueClassification {
  /** The dependency list to persist in PRD frontmatter (`depends_on`). */
  dependsOn: string[];
  /**
   * Whether the new PRD should be placed in `.eforge/queue/waiting/`.
   * True when the upstream is still active (pending, running, waiting).
   * False when the upstream is already completed with a usable artifact.
   */
  intoWaiting: boolean;
}

/**
 * Classify an explicit `afterQueueId` and return placement metadata.
 *
 * Classification rules (evaluated in order):
 * 1. Active root queue item (pending/running) → `intoWaiting: true`
 * 2. Active waiting queue item → `intoWaiting: true`
 * 3. Live running upstream (lock file alive) → `intoWaiting: true`
 * 4. Failed or skipped queue directory → throw with id in message
 * 5. Completion registry: failed/skipped/completed-without-artifact → throw with id in message
 * 6. Completed upstream with usable artifact → `intoWaiting: false`
 * 7. Unknown id → throw with id in message
 *
 * Throws an `Error` whose message contains the `afterQueueId` value for all
 * invalid or non-actionable upstream states.
 */
export async function classifyAfterQueueId(
  afterQueueId: string,
  queueDir: string,
  cwd: string,
): Promise<AfterQueueClassification> {
  // 1 & 2: Check active root/waiting queue items
  const [pendingPrds, waitingPrds] = await Promise.all([
    loadQueue(queueDir, cwd).catch((): QueuedPrd[] => []),
    loadQueue(`${queueDir}/waiting`, cwd).catch((): QueuedPrd[] => []),
  ]);

  if (pendingPrds.some((p) => p.id === afterQueueId)) {
    return { dependsOn: [afterQueueId], intoWaiting: true };
  }
  if (waitingPrds.some((p) => p.id === afterQueueId)) {
    return { dependsOn: [afterQueueId], intoWaiting: true };
  }

  // 3: Check live running upstream (lock file alive) - handles race where PRD
  // file may have been consumed but lock is still live at classification time
  const lockStatus = await readPrdLockStatus(afterQueueId, cwd);
  if (lockStatus.state === 'live') {
    return { dependsOn: [afterQueueId], intoWaiting: true };
  }

  // 4: Check terminal state directories (failed, skipped) — must come before
  // artifact registry so a stale usable-artifact record cannot mask a failed
  // or skipped upstream.
  const [failedPrds, skippedPrds] = await Promise.all([
    loadQueue(`${queueDir}/failed`, cwd).catch((): QueuedPrd[] => []),
    loadQueue(`${queueDir}/skipped`, cwd).catch((): QueuedPrd[] => []),
  ]);

  if (failedPrds.some((p) => p.id === afterQueueId)) {
    throw new Error(
      `afterQueueId "${afterQueueId}" references a failed upstream queue item. ` +
      `Only pending, running, waiting, or completed-with-artifact items can be used as upstream dependencies.`,
    );
  }
  if (skippedPrds.some((p) => p.id === afterQueueId)) {
    throw new Error(
      `afterQueueId "${afterQueueId}" references a skipped upstream queue item. ` +
      `Only pending, running, waiting, or completed-with-artifact items can be used as upstream dependencies.`,
    );
  }

  // 5: Check completion registry for terminal states — also before artifact
  // registry so that failed/skipped/completed-without-artifact completion
  // records override any stale artifact entry.
  const completionRegistry = await loadCompletionRegistry(cwd);
  const completionRecord = lookupCompletion(completionRegistry, afterQueueId);
  if (completionRecord) {
    if (completionRecord.status === 'failed') {
      throw new Error(
        `afterQueueId "${afterQueueId}" references a failed upstream (completion registry). ` +
        `Only pending, running, waiting, or completed-with-artifact items can be used as upstream dependencies.`,
      );
    }
    if (completionRecord.status === 'skipped') {
      throw new Error(
        `afterQueueId "${afterQueueId}" references a skipped upstream (completion registry). ` +
        `Only pending, running, waiting, or completed-with-artifact items can be used as upstream dependencies.`,
      );
    }
    if (completionRecord.status === 'completed' && !completionRecord.artifactAvailable) {
      throw new Error(
        `afterQueueId "${afterQueueId}" references a completed upstream without a usable artifact. ` +
        `Re-run the upstream build to produce a usable artifact before adding dependents.`,
      );
    }
  }

  // 6: Check artifact registry — completed with usable artifact → ready immediately.
  // Only reached when no terminal/non-artifact state has overridden it above.
  const registry = await loadArtifactRegistry(cwd);
  if (hasUsableArtifact(registry, afterQueueId)) {
    return { dependsOn: [afterQueueId], intoWaiting: false };
  }

  // completed with artifactAvailable in completion registry but no durable artifact — inconsistency
  if (completionRecord?.status === 'completed') {
    throw new Error(
      `afterQueueId "${afterQueueId}" references a completed upstream without a durable artifact in the registry. ` +
      `Re-run the upstream build to produce a usable artifact before adding dependents.`,
    );
  }

  // 7: Unknown id
  throw new Error(
    `afterQueueId "${afterQueueId}" references an unknown queue item. ` +
    `Only pending, running, waiting, or completed-with-artifact queue items can be used as upstream dependencies.`,
  );
}

/**
 * Find all PRDs in the given array that list `upstreamId` in their `depends_on`.
 */
export function findDependents(prds: QueuedPrd[], upstreamId: string): QueuedPrd[] {
  return prds.filter((p) => p.frontmatter.depends_on?.includes(upstreamId) ?? false);
}

/**
 * Move a PRD file from `waiting/` to a destination directory.
 * Filesystem-only — queue state is runtime, not tracked in git.
 */
async function movePrdFromWaiting(
  filePath: string,
  destDir: string,
  _cwd: string,
  _message: string,
): Promise<void> {
  const destPath = resolve(destDir, basename(filePath));
  await mkdir(destDir, { recursive: true });
  await rename(filePath, destPath);
}

/**
 * Validate that all `depends_on` ids currently exist in the queue or have
 * a durable artifact in the artifact registry (completed with a usable build).
 * Throws with a descriptive error if any upstream is not found or is a known
 * terminal dependency without a usable artifact record.
 *
 * Error semantics:
 * - Active queue (pending/running/waiting): accepted as a live upstream.
 * - Artifact registry with `status: 'built'`: accepted as a completed upstream.
 * - Known terminal (in failed/ or skipped/) without a usable artifact: error
 *   containing "artifact" so callers can distinguish from unknown ids.
 * - Not found anywhere: error containing "unknown queue item".
 */
export async function validateDependsOnExists(
  depends_on: string[],
  queueDir: string,
  cwd: string,
): Promise<void> {
  if (depends_on.length === 0) return;

  const [pendingPrds, waitingPrds] = await Promise.all([
    loadQueue(queueDir, cwd).catch((): QueuedPrd[] => []),
    loadQueue(`${queueDir}/waiting`, cwd).catch((): QueuedPrd[] => []),
  ]);

  const existingIds = new Set([
    ...pendingPrds.map((p) => p.id),
    ...waitingPrds.map((p) => p.id),
  ]);

  const registry = await loadArtifactRegistry(cwd);

  // Collect known terminal ids (failed/ or skipped/) for richer error messages.
  const [failedPrds, skippedPrds] = await Promise.all([
    loadQueue(`${queueDir}/failed`, cwd).catch((): QueuedPrd[] => []),
    loadQueue(`${queueDir}/skipped`, cwd).catch((): QueuedPrd[] => []),
  ]);
  const terminalIds = new Set([
    ...failedPrds.map((p) => p.id),
    ...skippedPrds.map((p) => p.id),
  ]);
  const completionRegistry = await loadCompletionRegistry(cwd);

  for (const dep of depends_on) {
    // 1. Active root/waiting queue item: accept.
    if (existingIds.has(dep)) continue;
    // 2. Live running upstream (lock file alive): accept. Handles the race where
    // the PRD file has been consumed by the worker but the lock is still live.
    // eslint-disable-next-line no-await-in-loop
    const lockStatus = await readPrdLockStatus(dep, cwd);
    if (lockStatus.state === 'live') continue;
    // 3. Failed/skipped queue directory item: error containing "artifact".
    // Failed/skipped queue items never satisfy dependencies, even if an old
    // artifact record is still present from an earlier successful attempt.
    if (terminalIds.has(dep)) {
      throw new Error(
        `depends_on references a terminal queue item: "${dep}" has no usable artifact. ` +
        `The dependency completed in a terminal state without a durable artifact record. ` +
        `Re-run the dependency to produce a usable artifact before adding dependents.`,
      );
    }
    const completionRecord = lookupCompletion(completionRegistry, dep);
    // 3. Completion index status failed/skipped: error containing "artifact".
    if (completionRecord?.status === 'failed' || completionRecord?.status === 'skipped') {
      throw new Error(
        `depends_on references a failed or skipped dependency: "${dep}" has no usable artifact. ` +
        `The dependency reached a terminal failed or skipped state. ` +
        `Re-run the dependency to produce a usable artifact before adding dependents.`,
      );
    }
    // 4. Completion index status completed with artifactAvailable: false: error containing "artifact".
    if (completionRecord?.status === 'completed' && !completionRecord.artifactAvailable) {
      throw new Error(
        `depends_on references a completed dependency without a usable artifact: "${dep}". ` +
        `The dependency completed but did not produce a durable artifact record. ` +
        `Re-run the dependency to produce a usable artifact before adding dependents.`,
      );
    }
    // 5. Usable artifact registry record: accept.
    if (hasUsableArtifact(registry, dep)) continue;
    // 6. Completion index status completed (no usable artifact in registry): error containing "artifact".
    if (completionRecord?.status === 'completed') {
      throw new Error(
        `depends_on references a completed dependency: "${dep}" has no durable artifact in the registry. ` +
        `The dependency completed but the artifact was not durably recorded. ` +
        `Re-run the dependency to produce a usable artifact before adding dependents.`,
      );
    }
    // 7. Otherwise: unknown queue item.
    throw new Error(
      `depends_on references unknown queue item: "${dep}". ` +
      `Only pending, running, or waiting queue items, or completed items with a durable artifact, can be used as upstream dependencies.`,
    );
  }
}

/**
 * Recursively transition waiting dependents of `upstreamId` to `skipped/`.
 *
 * Called when an upstream PRD transitions to a terminal failure state
 * (`failed` or `cancelled`). Dependents are moved from `waiting/` to
 * `skipped/` with a reason string, then their own dependents are also
 * skipped (cascade).
 */
export async function propagateSkip(
  queueDir: string,
  cwd: string,
  upstreamId: string,
  reason: string,
): Promise<void> {
  let waitingPrds: QueuedPrd[];
  try {
    waitingPrds = await loadQueue(`${queueDir}/waiting`, cwd);
  } catch {
    return; // No waiting directory or read error — nothing to do
  }

  const dependents = findDependents(waitingPrds, upstreamId);
  if (dependents.length === 0) return;

  const skippedDir = resolve(cwd, queueDir, 'skipped');

  for (const dep of dependents) {
    const depReason = `upstream ${upstreamId} ${reason}`;
    await movePrdFromWaiting(
      dep.filePath,
      skippedDir,
      cwd,
      `skipped - ${depReason}`,
    );
    // Cascade: skip dependents of this now-skipped PRD
    await propagateSkip(queueDir, cwd, dep.id, 'skipped');
  }
}

/**
 * Unblock waiting PRDs whose upstream `completedId` has now finished.
 *
 * Moves qualifying PRDs from `waiting/` back to the queue root so the
 * normal dispatcher can pick them up. A waiting PRD is unblocked when
 * ALL of its `depends_on` entries are no longer present in the active queue
 * (pending/waiting) AND each dependency has a durable usable artifact in
 * the artifact registry.
 *
 * `requireArtifacts` defaults to `true` — the artifact registry is the
 * source of truth for dependency readiness. Pass `false` only for callers
 * that intentionally bypass artifact checks (legacy/migration paths).
 *
 * Returns the ids of PRDs that were moved to pending.
 */
export async function unblockWaiting(
  queueDir: string,
  cwd: string,
  completedId: string,
  options: { requireArtifacts?: boolean } = {},
): Promise<string[]> {
  let waitingPrds: QueuedPrd[];
  try {
    waitingPrds = await loadQueue(`${queueDir}/waiting`, cwd);
  } catch {
    return [];
  }

  if (waitingPrds.length === 0) return [];

  // Build the set of ids that are still actively blocked (pending or waiting)
  const pendingPrds = await loadQueue(queueDir, cwd).catch((): QueuedPrd[] => []);
  const stillActiveIds = new Set<string>([
    ...waitingPrds.map((p) => p.id),
    ...pendingPrds.map((p) => p.id),
  ]);
  // The just-completed PRD is no longer active
  stillActiveIds.delete(completedId);

  // Default requireArtifacts to true: artifact registry is the source of truth.
  const requireArtifacts = options.requireArtifacts ?? true;
  const registry = requireArtifacts ? await loadArtifactRegistry(cwd) : undefined;
  const terminalIds = requireArtifacts
    ? new Set<string>([
        ...(await loadQueue(`${queueDir}/failed`, cwd).catch((): QueuedPrd[] => [])).map((p) => p.id),
        ...(await loadQueue(`${queueDir}/skipped`, cwd).catch((): QueuedPrd[] => [])).map((p) => p.id),
      ])
    : undefined;
  const depHasUsableArtifact = (dep: string): boolean => {
    if (!requireArtifacts) return true;
    if (registry === undefined) return false;
    if (terminalIds?.has(dep)) return false;
    return hasUsableArtifact(registry, dep);
  };

  const queueRoot = resolve(cwd, queueDir);
  const unblocked: string[] = [];

  for (const prd of waitingPrds) {
    const deps: string[] = prd.frontmatter.depends_on ?? [];
    // A dep is satisfied when it is inactive and has a durable usable artifact record.
    const allSatisfied = deps.every(
      (dep: string) => !stillActiveIds.has(dep) && depHasUsableArtifact(dep),
    );

    if (allSatisfied) {
      await movePrdFromWaiting(
        prd.filePath,
        queueRoot,
        cwd,
        `unblocked - ${completedId} completed`,
      );
      unblocked.push(prd.id);
      // Remove from stillActiveIds so other waiting PRDs that depend on
      // this one can also be unblocked in subsequent loop iterations.
      stillActiveIds.delete(prd.id);
    }
  }

  return unblocked;
}
