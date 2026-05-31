/**
 * Durable stack sync status persistence.
 *
 * Manages `.eforge/stacks/sync-status.json`: load/save helpers for the
 * current and last completed stack sync status.
 *
 * The status file is eforge-owned runtime state (gitignored). It is written
 * atomically via temp-file-then-rename to prevent partial writes. Loading
 * returns `undefined` when the file does not exist or contains invalid JSON.
 */


import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { StackSyncOutcome } from './sync.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trigger that initiated the stack sync. */
export type StackSyncTrigger = 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';

/** Policy for handling active-build overlap during wet sync. */
export type StackSyncActiveBuildPolicy = 'skip' | 'defer';

/** Durable sync status record persisted to disk. */
export interface StackSyncStatus {
  /** Unique identifier for this sync operation. */
  id: string;
  /** Trigger that initiated the sync. */
  trigger?: StackSyncTrigger;
  /** Active-build policy used for this sync. */
  activeBuildPolicy?: StackSyncActiveBuildPolicy;
  /** ISO timestamp when the sync started. */
  startedAt: string;
  /** ISO timestamp when the sync completed (absent for in-progress syncs). */
  completedAt?: string;
  /**
   * Overall outcome. Absent for in-progress (current) records that have not
   * yet completed. Always present on terminal (last) records.
   */
  outcome?: StackSyncOutcome;
  /** Human-readable reason (present for non-complete outcomes). */
  reason?: string;
  /** Error message when outcome is 'failed' or 'conflict'. */
  error?: string;
  /** Whether the sync was a dry run. */
  dryRun: boolean;
  /** SHA of the local trunk branch, when available. */
  localTrunkSha?: string;
  /** SHA of origin/<trunk>, when available. */
  originTrunkSha?: string;
  /** Whether the local trunk was at or behind origin. */
  fastForward?: boolean;
  /** Artifact branches eligible for restack after exclusion filtering. */
  restackCandidates: string[];
  /** Branches and worktrees skipped because active builds are using them (present on terminal records). */
  activeBuildSkips?: Array<{ branch: string; worktree?: string; reason: string }>;
  /** Provider commands that were executed or would be executed in dry-run mode (present on terminal records). */
  providerCommands?: Array<{ command: string; args: string[]; dryRun: boolean; ran: boolean; stdout?: string; stderr?: string; exitCode?: number }>;
}

/** The shape of the sync-status.json file. */
export interface StackSyncStatusFile {
  /** File format version. */
  version: 1;
  /** The most recently completed (terminal) sync status. */
  last?: StackSyncStatus;
  /** The currently in-progress sync status. Absent when no sync is running. */
  current?: StackSyncStatus;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the sync status file for the given project root.
 *
 * `.eforge/stacks/sync-status.json` is runtime state — gitignored, eforge-owned.
 */
export function stackSyncStatusPath(cwd: string): string {
  return resolve(cwd, '.eforge', 'stacks', 'sync-status.json');
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load the stack sync status from disk.
 *
 * Returns `{ version: 1 }` (empty) when the file does not exist or contains
 * invalid JSON/schema. Never throws on missing files.
 */
export async function loadStackSyncStatus(cwd: string): Promise<StackSyncStatusFile> {
  const filePath = stackSyncStatusPath(cwd);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1 };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { version: 1 };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1
  ) {
    return { version: 1 };
  }

  return parsed as StackSyncStatusFile;
}

/**
 * Synchronously load the stack sync status from disk.
 *
 * Equivalent to `loadStackSyncStatus` but uses synchronous I/O so it can be
 * called from synchronous contexts such as SSE stream:hello snapshot builders.
 *
 * Returns `{ version: 1 }` (empty) when the file does not exist or contains
 * invalid JSON/schema. Never throws on missing files.
 */
export function loadStackSyncStatusSync(cwd: string): StackSyncStatusFile {
  const filePath = stackSyncStatusPath(cwd);
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1 };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { version: 1 };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as Record<string, unknown>).version !== 1
  ) {
    return { version: 1 };
  }

  return parsed as StackSyncStatusFile;
}

/**
 * Atomically write the stack sync status to disk.
 *
 * Writes to a temp file in the same directory, then renames into place to
 * prevent partial writes from corrupting the status file.
 */
export async function saveStackSyncStatus(cwd: string, status: StackSyncStatusFile): Promise<void> {
  const filePath = stackSyncStatusPath(cwd);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmpPath, JSON.stringify(status, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

/**
 * Update the current in-progress sync status on disk.
 *
 * Reads the existing file, sets `current`, and writes back atomically.
 */
export async function setCurrentSyncStatus(cwd: string, current: StackSyncStatus): Promise<void> {
  const existing = await loadStackSyncStatus(cwd);
  await saveStackSyncStatus(cwd, { ...existing, current });
}

/**
 * Mark the current sync as complete: moves `current` to `last` and clears `current`.
 *
 * If `current` is undefined (no sync was in-progress), updates `last` directly with
 * the provided status.
 */
export async function completeCurrentSyncStatus(cwd: string, completed: StackSyncStatus): Promise<void> {
  const existing = await loadStackSyncStatus(cwd);
  await saveStackSyncStatus(cwd, { ...existing, last: completed, current: undefined });
}

