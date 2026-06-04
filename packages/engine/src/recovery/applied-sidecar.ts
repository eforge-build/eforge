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

import { readFile, writeFile, rename } from 'node:fs/promises';
import type { RecoveryAppliedMetadata } from '@eforge-build/client';

export type { RecoveryAppliedMetadata };

const VALID_ACTIONS = new Set<RecoveryAppliedMetadata['action']>([
  'retry',
  'split',
  'abandon',
  'accepted-success',
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
    action: action as 'retry' | 'abandon' | 'accepted-success',
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
