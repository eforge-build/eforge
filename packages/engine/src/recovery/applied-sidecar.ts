/**
 * Shared helpers for the optional `applied` marker on recovery sidecars
 * (`<prdId>.recovery.json`). The marker is the durable idempotency store for
 * recovery applies: once a verdict is applied, the marker records the action so
 * a repeated apply is a no-op (no duplicate successor enqueue, no repeated
 * Console prompt).
 *
 * Reads tolerate legacy sidecars that predate the field and never throw on a
 * missing or invalid marker. Writes preserve every existing sidecar field
 * (`schemaVersion`, `generatedAt`, `summary`, `verdict`, and any unrelated keys)
 * and are atomic via write-to-temp-then-rename.
 */

import { readFile, writeFile, rename, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type {
  RecoveryAppliedMetadata,
  AcceptSuccessAppliedSummary,
  AcceptSuccessReasonCategory,
} from '@eforge-build/client';
import { ACCEPT_SUCCESS_REASON_CATEGORIES } from '@eforge-build/client';

export type { RecoveryAppliedMetadata, AcceptSuccessAppliedSummary };

// `accepted-success` is intentionally excluded: it uses the rich
// `AcceptSuccessAppliedSummary` shape (keyed by `acceptedAt`) parsed by
// `parseAcceptSuccessAppliedMetadata`, not this `appliedAt`-based base parser.
const VALID_ACTIONS = new Set<RecoveryAppliedMetadata['action']>([
  'retry',
  'split',
  'abandon',
]);

/**
 * Validate and narrow an unknown value into `RecoveryAppliedMetadata`.
 * Returns `undefined` for anything that is not a well-formed applied marker so
 * callers can ignore invalid metadata without crashing.
 */
export function parseRecoveryAppliedMetadata(value: unknown): RecoveryAppliedMetadata | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  const action = obj.action;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action as RecoveryAppliedMetadata['action'])) {
    return undefined;
  }
  if (typeof obj.appliedAt !== 'string' || obj.appliedAt.length === 0) return undefined;
  const commitSha = typeof obj.commitSha === 'string' ? obj.commitSha : undefined;
  if (action === 'split') {
    // Split applied metadata must carry the enqueued successor id; without it the
    // marker cannot drive idempotent Console UX, so treat it as invalid.
    if (typeof obj.successorPrdId !== 'string' || obj.successorPrdId.length === 0) return undefined;
    return {
      action: 'split',
      appliedAt: obj.appliedAt,
      successorPrdId: obj.successorPrdId,
      ...(commitSha !== undefined && { commitSha }),
    };
  }
  return {
    action: action as 'retry' | 'abandon',
    appliedAt: obj.appliedAt,
    ...(commitSha !== undefined && { commitSha }),
  };
}

/**
 * Read the `applied` marker from a recovery sidecar JSON file.
 * Returns `undefined` when the file is missing, unreadable, malformed, or has no
 * valid `applied` marker (legacy sidecars).
 */
export async function readRecoveryAppliedMetadata(
  sidecarJsonPath: string,
): Promise<RecoveryAppliedMetadata | undefined> {
  let raw: string;
  try {
    raw = await readFile(sidecarJsonPath, 'utf-8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  return parseRecoveryAppliedMetadata((parsed as Record<string, unknown>).applied);
}

/**
 * Write (or overwrite) the `applied` marker on a recovery sidecar JSON file,
 * preserving all existing fields. Atomic via temp-file rename.
 *
 * Throws if the sidecar does not exist or is not valid JSON — the marker is only
 * written after a verdict has been applied, at which point the sidecar is known
 * to be present and well-formed.
 */
export async function writeRecoveryAppliedMetadata(
  sidecarJsonPath: string,
  applied: RecoveryAppliedMetadata,
): Promise<void> {
  const raw = await readFile(sidecarJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.applied = applied;
  const content = JSON.stringify(parsed, null, 2) + '\n';
  const tmp = sidecarJsonPath + '.tmp';
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, sidecarJsonPath);
}


const ACCEPT_SUCCESS_REASON_CATEGORY_SET = new Set<AcceptSuccessReasonCategory>(
  ACCEPT_SUCCESS_REASON_CATEGORIES,
);

function isReasonCategory(value: unknown): value is AcceptSuccessReasonCategory {
  return typeof value === 'string' && ACCEPT_SUCCESS_REASON_CATEGORY_SET.has(value as AcceptSuccessReasonCategory);
}

/**
 * Read the raw `applied.action` string from a recovery sidecar without
 * validating the rest of the marker. Returns `undefined` when the file is
 * missing, unreadable, malformed JSON, or has no `applied.action` string.
 *
 * Used to detect the presence of *any* applied marker — including malformed or
 * non-accepted-success markers that the strict parsers reject — so an
 * accepted-success apply never silently overwrites another recovery action's
 * audit record.
 */
export async function readRawAppliedAction(
  sidecarJsonPath: string,
): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(sidecarJsonPath, 'utf-8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const applied = (parsed as Record<string, unknown>).applied;
  if (typeof applied !== 'object' || applied === null) return undefined;
  const action = (applied as Record<string, unknown>).action;
  return typeof action === 'string' ? action : undefined;
}

/**
 * Validate and narrow an unknown value into the rich `accepted-success` applied
 * metadata recorded by an accepted-success apply. Returns `undefined` for any
 * value that is not a well-formed accepted-success marker so callers can treat a
 * malformed or non-accepted-success marker as absent.
 */
export function parseAcceptSuccessAppliedMetadata(value: unknown): AcceptSuccessAppliedSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  if (obj.action !== 'accepted-success') return undefined;
  if (typeof obj.acceptedAt !== 'string' || obj.acceptedAt.length === 0) return undefined;
  if (!isReasonCategory(obj.reasonCategory)) return undefined;
  if (typeof obj.reason !== 'string' || obj.reason.trim().length === 0) return undefined;

  const cleanup = obj.cleanup as Record<string, unknown> | undefined;
  if (!cleanup || (cleanup.status !== 'committed' && cleanup.status !== 'noop')) return undefined;

  const landing = obj.landing as Record<string, unknown> | undefined;
  if (!landing || (landing.action !== 'pr' && landing.action !== 'merge' && landing.action !== 'leave')) return undefined;
  if (landing.status !== 'complete' && landing.status !== 'skipped' && landing.status !== 'failed') return undefined;

  let autoMerge: AcceptSuccessAppliedSummary['landing']['autoMerge'] | undefined;
  const rawAutoMerge = landing.autoMerge as Record<string, unknown> | undefined;
  if (rawAutoMerge !== undefined) {
    if (typeof rawAutoMerge !== 'object' || rawAutoMerge === null) return undefined;
    if (rawAutoMerge.status === 'complete') autoMerge = { status: 'complete' };
    else if ((rawAutoMerge.status === 'skipped' || rawAutoMerge.status === 'failed') && typeof rawAutoMerge.reason === 'string') {
      autoMerge = { status: rawAutoMerge.status, reason: rawAutoMerge.reason };
    } else return undefined;
  }

  const dependents = obj.dependents as Record<string, unknown> | undefined;
  // Strict: a malformed dependents block must invalidate the whole marker rather
  // than being silently rewritten into a different valid-looking wire shape, so
  // idempotency and Console completion never hide corrupted audit metadata.
  const asStrictStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x): x is string => typeof x === 'string') ? v : undefined;
  if (!dependents) return undefined;
  const unblocked = asStrictStringArray(dependents.unblocked);
  const remainedBlocked = asStrictStringArray(dependents.remainedBlocked);
  const notFound = asStrictStringArray(dependents.notFound);
  if (!unblocked || !remainedBlocked || !notFound) return undefined;

  return {
    action: 'accepted-success',
    acceptedAt: obj.acceptedAt,
    reasonCategory: obj.reasonCategory,
    reason: obj.reason,
    cleanup: {
      status: cleanup.status,
      ...(typeof cleanup.commitSha === 'string' && cleanup.commitSha.length > 0 ? { commitSha: cleanup.commitSha } : {}),
    },
    landing: {
      action: landing.action,
      status: landing.status,
      ...(typeof landing.prUrl === 'string' ? { prUrl: landing.prUrl } : {}),
      ...(typeof landing.mergeCommitSha === 'string' ? { mergeCommitSha: landing.mergeCommitSha } : {}),
      ...(typeof landing.branch === 'string' ? { branch: landing.branch } : {}),
      ...(typeof landing.reason === 'string' ? { reason: landing.reason } : {}),
      ...(autoMerge !== undefined ? { autoMerge } : {}),
    },
    dependents: { unblocked, remainedBlocked, notFound },
  };
}

/**
 * Read the rich `accepted-success` applied metadata from a recovery sidecar JSON
 * file. Returns `undefined` when the file is missing, unreadable, malformed, or
 * has no valid accepted-success marker.
 */
export async function readAcceptSuccessAppliedMetadata(
  sidecarJsonPath: string,
): Promise<AcceptSuccessAppliedSummary | undefined> {
  let raw: string;
  try {
    raw = await readFile(sidecarJsonPath, 'utf-8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  return parseAcceptSuccessAppliedMetadata((parsed as Record<string, unknown>).applied);
}

/**
 * Write (or overwrite) the rich `accepted-success` applied marker on a recovery
 * sidecar JSON file, preserving all existing fields. Atomic via temp-file rename.
 *
 * Throws if the sidecar does not exist or is not valid JSON — the marker is only
 * written after an accepted-success apply, at which point the sidecar is known to
 * be present and well-formed.
 */
export async function writeAcceptSuccessAppliedMetadata(
  sidecarJsonPath: string,
  applied: AcceptSuccessAppliedSummary,
): Promise<void> {
  const raw = await readFile(sidecarJsonPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.applied = applied;
  const content = JSON.stringify(parsed, null, 2) + '\n';
  // Write to a randomly-named sibling opened with exclusive-create semantics
  // (O_CREAT|O_EXCL, mode 0600) so a pre-existing file or symlink at the temp
  // path is never followed, then rename atomically onto the sidecar.
  const tmp = `${sidecarJsonPath}.${randomBytes(8).toString('hex')}.tmp`;
  const handle = await open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf-8');
  } finally {
    await handle.close();
  }
  await rename(tmp, sidecarJsonPath);
}
