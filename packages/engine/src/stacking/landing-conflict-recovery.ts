import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { EforgeEvent } from '../events.js';
import { execWithTimeout } from '../exec-with-timeout.js';
import { normalizePostMergeCommandTimeoutMs } from '../config.js';
import { retryOnLock } from '../git.js';
import { stripTemporaryEforgeRegionMarkerLines } from '../region-marker-cleanup.js';
import type { MergeConflictInfo, MergeResolver } from '../worktree-ops.js';
import type { StackBaseContext } from './base-resolver.js';
import { stackProviderCommandEvent, stackProviderCommandEventFromError } from './provider-events.js';
import type {
  StackProviderAdapter,
  StackProviderErrorClassification,
  StackProviderInterruptedOperation,
} from './provider.js';

const exec = promisify(execFile);
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_VALIDATION_TIMEOUT_MS = 300_000;

// --- eforge:region public-api ---
export interface LandingConflictRecoveryResult {
  recovered: boolean;
  attempts: number;
  reason?: string;
  abortAttempted: boolean;
  abortSucceeded: boolean;
}

export interface LandingConflictRecoveryOptions {
  cwd: string;
  mergeWorktreePath: string;
  stackContext: StackBaseContext;
  provider: StackProviderAdapter;
  classification: StackProviderErrorClassification;
  initialOperation?: StackProviderInterruptedOperation;
  mergeResolver?: MergeResolver;
  maxAttempts?: number;
  postRecoveryValidationCommands?: string[];
  validationTimeoutMs?: number;
  signal?: AbortSignal;
}

type ConflictResolution = { changedFiles: string[] };
// --- eforge:endregion public-api ---

// --- eforge:region orchestration ---
export async function* recoverLandingConflict(
  opts: LandingConflictRecoveryOptions,
): AsyncGenerator<EforgeEvent, LandingConflictRecoveryResult> {
  const maxAttempts = normalizeMaxAttempts(opts.maxAttempts);
  const redact = opts.provider.redactMessage.bind(opts.provider);
  const providerName = opts.stackContext.provider;
  const branch = opts.stackContext.branch;

  if (!opts.provider.classifyError || !opts.provider.getInterruptedOperation || !opts.provider.continueInterruptedOperation) {
    return yield* failRecovery(opts, 0, 'Provider does not expose interrupted-operation recovery methods', opts.initialOperation);
  }

  if (!opts.classification.recoverable || opts.classification.kind !== 'recoverable-conflict') {
    return yield* failRecovery(opts, 0, redact(opts.classification.message), opts.initialOperation);
  }

  let operation = opts.initialOperation;
  if (!operation) {
    try {
      operation = await opts.provider.getInterruptedOperation(opts.mergeWorktreePath, opts.classification);
    } catch (err) {
      return yield* failRecovery(opts, 0, redact(err instanceof Error ? err.message : String(err)), opts.initialOperation);
    }
  }
  if (!operation) {
    return yield* failRecovery(opts, 0, 'No interrupted provider operation is active', undefined);
  }

  yield detectedEvent(opts, operation);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    yield startEvent(opts, attempt, maxAttempts);

    let unmergedFiles: string[];
    try {
      await resolveTemporaryMarkerConflicts(opts.mergeWorktreePath, operation.conflictedFiles);
      unmergedFiles = await getUnmergedFiles(opts.mergeWorktreePath);

      if (unmergedFiles.length > 0 && opts.mergeResolver) {
        const conflict = toMergeConflictInfo(opts.stackContext, operation, unmergedFiles);
        const resolved = await opts.mergeResolver(opts.mergeWorktreePath, conflict);
        if (!resolved) {
          return yield* failRecovery(opts, attempt, 'Merge resolver reported it could not resolve and stage the remaining conflicts', operation);
        }
        unmergedFiles = await getUnmergedFiles(opts.mergeWorktreePath);
      }
    } catch (err) {
      return yield* failRecovery(opts, attempt, redact(err instanceof Error ? err.message : String(err)), operation);
    }

    if (unmergedFiles.length > 0) {
      const reason = `Recovery attempt ${attempt} left unmerged file(s): ${unmergedFiles.join(', ')}`;
      return yield* failRecovery(opts, attempt, reason, operation);
    }

    try {
      const result = await opts.provider.continueInterruptedOperation(opts.mergeWorktreePath, operation);
      yield stackProviderCommandEvent(providerName, branch, result, redact);
    } catch (err) {
      const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
      if (commandEvent) yield commandEvent;

      let next: StackProviderInterruptedOperation | undefined;
      try {
        next = await classifyInterruptedOperation(opts, err);
      } catch (classifyErr) {
        return yield* failRecovery(opts, attempt, redact(classifyErr instanceof Error ? classifyErr.message : String(classifyErr)), operation);
      }
      if (next && attempt < maxAttempts) {
        operation = next;
        yield detectedEvent(opts, operation);
        continue;
      }

      const reason = attempt >= maxAttempts
        ? `Recovery reached max attempts (${maxAttempts})`
        : redact(err instanceof Error ? err.message : String(err));
      return yield* failRecovery(opts, attempt, reason, next ?? operation);
    }

    const validationPassed = yield* runPostRecoveryValidation(opts);
    if (!validationPassed) {
      return yield* failRecovery(opts, attempt, 'Post-recovery validation failed', undefined);
    }

    yield completeEvent(opts, attempt);
    return { recovered: true, attempts: attempt, abortAttempted: false, abortSucceeded: false };
  }

  return yield* failRecovery(opts, maxAttempts, `Recovery reached max attempts (${maxAttempts})`, operation);
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.trunc(value));
}
// --- eforge:endregion orchestration ---

// --- eforge:region failure-handling ---
async function* failRecovery(
  opts: LandingConflictRecoveryOptions,
  attempts: number,
  reason: string,
  activeOperation: StackProviderInterruptedOperation | undefined,
): AsyncGenerator<EforgeEvent, LandingConflictRecoveryResult> {
  let abortAttempted = false;
  let abortSucceeded = false;
  let finalReason = reason;

  if (activeOperation && opts.provider.abortInterruptedOperation) {
    abortAttempted = true;
    try {
      const result = await opts.provider.abortInterruptedOperation(opts.mergeWorktreePath, activeOperation);
      yield stackProviderCommandEvent(
        opts.stackContext.provider,
        opts.stackContext.branch,
        result,
        opts.provider.redactMessage.bind(opts.provider),
      );
      abortSucceeded = true;
    } catch (err) {
      const commandEvent = stackProviderCommandEventFromError(
        opts.stackContext.provider,
        opts.stackContext.branch,
        err,
        opts.provider.redactMessage.bind(opts.provider),
      );
      if (commandEvent) yield commandEvent;
      const message = opts.provider.redactMessage(err instanceof Error ? err.message : String(err));
      finalReason = `${reason}; abort failed: ${message}`;
    }
  }

  yield failedEvent(opts, attempts, finalReason, abortAttempted, abortSucceeded);
  return { recovered: false, attempts, reason: finalReason, abortAttempted, abortSucceeded };
}

async function classifyInterruptedOperation(
  opts: LandingConflictRecoveryOptions,
  err: unknown,
): Promise<StackProviderInterruptedOperation | undefined> {
  if (!opts.provider.classifyError || !opts.provider.getInterruptedOperation) return undefined;
  const classification = await opts.provider.classifyError(opts.mergeWorktreePath, err);
  if (!classification.recoverable || classification.kind !== 'recoverable-conflict') return undefined;
  return opts.provider.getInterruptedOperation(opts.mergeWorktreePath, classification);
}
// --- eforge:endregion failure-handling ---

// --- eforge:region validation ---
async function* runPostRecoveryValidation(opts: LandingConflictRecoveryOptions): AsyncGenerator<EforgeEvent, boolean> {
  const commands = opts.postRecoveryValidationCommands ?? [];
  if (commands.length === 0) return true;

  yield { timestamp: new Date().toISOString(), type: 'validation:start', commands } as EforgeEvent;
  for (const command of commands) {
    if (opts.signal?.aborted) {
      yield { timestamp: new Date().toISOString(), type: 'validation:complete', passed: false } as EforgeEvent;
      return false;
    }

    yield { timestamp: new Date().toISOString(), type: 'validation:command:start', command } as EforgeEvent;
    const timeoutMs = normalizePostMergeCommandTimeoutMs(opts.validationTimeoutMs, DEFAULT_VALIDATION_TIMEOUT_MS);
    const result = await execWithTimeout(command, {
      cwd: opts.mergeWorktreePath,
      timeoutMs,
      signal: opts.signal,
    });
    if (result.timedOut) {
      const output = `[timed out after ${timeoutMs}ms]`;
      yield {
        timestamp: new Date().toISOString(),
        type: 'validation:command:timeout',
        command,
        timeoutMs,
        pid: result.pid ?? -1,
      } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'validation:command:complete', command, exitCode: 124, output } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'validation:complete', passed: false } as EforgeEvent;
      return false;
    }
    const output = (result.stdout + result.stderr).trim();
    yield { timestamp: new Date().toISOString(), type: 'validation:command:complete', command, exitCode: result.exitCode, output } as EforgeEvent;
    if (result.exitCode !== 0) {
      yield { timestamp: new Date().toISOString(), type: 'validation:complete', passed: false } as EforgeEvent;
      return false;
    }
  }

  yield { timestamp: new Date().toISOString(), type: 'validation:complete', passed: true } as EforgeEvent;
  return true;
}
// --- eforge:endregion validation ---

// --- eforge:region marker-cleanup ---
async function resolveTemporaryMarkerConflicts(cwd: string, conflictedFiles: string[]): Promise<ConflictResolution> {
  const changedFiles: string[] = [];
  const fullyResolvedFiles: string[] = [];
  for (const file of conflictedFiles) {
    const absolutePath = resolve(cwd, file);
    let content: string;
    try {
      content = await readFile(absolutePath, 'utf8');
    } catch {
      continue;
    }
    const resolved = resolveConflictHunks(content);
    if (resolved === undefined || resolved.content === content) continue;
    await writeFile(absolutePath, resolved.content, 'utf8');
    changedFiles.push(file);
    if (resolved.fullyResolved) fullyResolvedFiles.push(file);
  }

  if (fullyResolvedFiles.length > 0) {
    await retryOnLock(() => exec('git', ['add', '--', ...fullyResolvedFiles], { cwd }), cwd);
  }

  return { changedFiles };
}

function resolveConflictHunks(content: string): { content: string; fullyResolved: boolean } | undefined {
  const lines = content.split(/(?<=\n)/);
  let index = 0;
  let changed = false;
  let fullyResolved = true;
  const output: string[] = [];

  while (index < lines.length) {
    if (!lines[index]?.startsWith('<<<<<<<')) {
      output.push(lines[index] ?? '');
      index += 1;
      continue;
    }

    const parsed = parseConflictHunk(lines, index);
    if (!parsed) return undefined;
    const replacement = resolveParsedHunk(parsed.current, parsed.incoming);
    if (replacement === undefined) {
      output.push(lines.slice(index, parsed.nextIndex).join(''));
      fullyResolved = false;
    } else {
      output.push(replacement);
      changed = true;
    }
    index = parsed.nextIndex;
  }

  return changed ? { content: output.join(''), fullyResolved } : undefined;
}

function parseConflictHunk(
  lines: string[],
  start: number,
): { current: string; incoming: string; nextIndex: number } | undefined {
  const current: string[] = [];
  const incoming: string[] = [];
  let target = current;
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.startsWith('|||||||')) {
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('=======')) index += 1;
      continue;
    }
    if (line.startsWith('=======')) {
      target = incoming;
      index += 1;
      continue;
    }
    if (line.startsWith('>>>>>>>')) {
      return { current: current.join(''), incoming: incoming.join(''), nextIndex: index + 1 };
    }
    target.push(line);
    index += 1;
  }
  return undefined;
}

function resolveParsedHunk(current: string, incoming: string): string | undefined {
  const strippedCurrent = stripTemporaryEforgeRegionMarkerLines(current);
  const strippedIncoming = stripTemporaryEforgeRegionMarkerLines(incoming);
  const currentChanged = strippedCurrent !== current;
  const incomingChanged = strippedIncoming !== incoming;
  if (!currentChanged && !incomingChanged) return undefined;
  if (strippedCurrent === strippedIncoming) return strippedCurrent;
  if (currentChanged && strippedCurrent.trim().length === 0) return strippedIncoming;
  if (incomingChanged && strippedIncoming.trim().length === 0) return strippedCurrent;
  return undefined;
}
// --- eforge:endregion marker-cleanup ---

// --- eforge:region git-helpers ---
async function getUnmergedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await exec('git', ['diff', '--name-only', '--diff-filter=U'], { cwd });
  return stdout.trim().split('\n').filter(Boolean);
}

function toMergeConflictInfo(
  stackContext: StackBaseContext,
  operation: StackProviderInterruptedOperation,
  conflictedFiles: string[],
): MergeConflictInfo {
  return {
    branch: stackContext.branch,
    baseBranch: stackContext.baseBranch ?? 'main',
    conflictedFiles,
    conflictDiff: operation.conflictDiff,
  };
}
// --- eforge:endregion git-helpers ---

// --- eforge:region event-builders ---
function detectedEvent(opts: LandingConflictRecoveryOptions, operation: StackProviderInterruptedOperation): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'stack:landing:conflict:detected',
    prdId: opts.stackContext.prdId,
    stackId: opts.stackContext.stackId,
    provider: opts.stackContext.provider,
    branch: opts.stackContext.branch,
    operation: operation.operation,
    conflictKind: operation.conflictKind,
    conflictedFiles: operation.conflictedFiles,
  } as unknown as EforgeEvent;
}

function startEvent(opts: LandingConflictRecoveryOptions, attempt: number, maxAttempts: number): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'stack:landing:conflict:recovery:start',
    prdId: opts.stackContext.prdId,
    stackId: opts.stackContext.stackId,
    provider: opts.stackContext.provider,
    branch: opts.stackContext.branch,
    attempt,
    maxAttempts,
  } as unknown as EforgeEvent;
}

function completeEvent(opts: LandingConflictRecoveryOptions, attempts: number): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'stack:landing:conflict:recovery:complete',
    prdId: opts.stackContext.prdId,
    stackId: opts.stackContext.stackId,
    provider: opts.stackContext.provider,
    branch: opts.stackContext.branch,
    attempts,
  } as unknown as EforgeEvent;
}

function failedEvent(
  opts: LandingConflictRecoveryOptions,
  attempts: number,
  reason: string,
  abortAttempted: boolean,
  abortSucceeded: boolean,
): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'stack:landing:conflict:recovery:failed',
    prdId: opts.stackContext.prdId,
    stackId: opts.stackContext.stackId,
    provider: opts.stackContext.provider,
    branch: opts.stackContext.branch,
    attempts,
    reason,
    abortAttempted,
    abortSucceeded,
  } as unknown as EforgeEvent;
}
// --- eforge:endregion event-builders ---
