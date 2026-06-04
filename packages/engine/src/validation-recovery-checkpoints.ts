import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ReviewIssue } from './events.js';

const exec = promisify(execFile);

const MAX_PATCH_CHARS = 200_000;
const MAX_METADATA_STRING_LENGTH = 2_000;
const MAX_METADATA_DEPTH = 6;
const MAX_METADATA_NODES = 160;
const MAX_METADATA_ARRAY_ITEMS = 40;
const MAX_METADATA_OBJECT_KEYS = 60;
const MAX_CHECKPOINT_ISSUES = 40;
const MAX_SIGNATURES = 80;
const MAX_UNTRACKED_FILE_BYTES = 64_000;

export type ValidationRecoveryRepairStrategy = 'narrow' | 'structural';

export interface ValidationRecoveryCheckpointReference {
  artifactRoot: string;
  directory: string;
  metadataPath: string;
  patchPath: string;
}

export interface ValidationRecoveryCheckpointPaths extends ValidationRecoveryCheckpointReference {
  usedProjectRoot: boolean;
}

export interface ResolveValidationRecoveryCheckpointPathsOptions {
  cwd: string;
  worktreePath: string;
  planSetName: string;
  planId: string;
  attempt: number;
  providerName: string;
}

export interface WriteValidationRecoveryCheckpointOptions extends ResolveValidationRecoveryCheckpointPathsOptions {
  repairStrategy: ValidationRecoveryRepairStrategy;
  repairClass: string;
  issues: ReviewIssue[];
  signatures: string[];
  failureSummary?: string;
}

interface PatchCapture { content: string; charCount: number; truncated: boolean }

export function resolveValidationRecoveryCheckpointPaths(
  options: ResolveValidationRecoveryCheckpointPathsOptions,
): ValidationRecoveryCheckpointPaths {
  const cwd = resolve(options.cwd);
  const worktreePath = resolve(options.worktreePath);
  const usedProjectRoot = !isSameOrInside(cwd, worktreePath);
  const artifactRoot = usedProjectRoot ? cwd : worktreePath;
  const directory = join(
    artifactRoot,
    '.eforge',
    'validation-recovery',
    sanitizePathSegment(options.planSetName),
    sanitizePathSegment(options.planId),
    `attempt-${Math.max(0, Math.trunc(options.attempt))}-${sanitizePathSegment(options.providerName)}`,
  );

  return {
    artifactRoot,
    directory,
    metadataPath: join(directory, 'metadata.json'),
    patchPath: join(directory, 'checkpoint.patch'),
    usedProjectRoot,
  };
}

export async function writeValidationRecoveryCheckpoint(
  options: WriteValidationRecoveryCheckpointOptions,
): Promise<ValidationRecoveryCheckpointReference> {
  const paths = resolveValidationRecoveryCheckpointPaths(options);
  await ensureCheckpointDirectory(paths.artifactRoot, paths.directory);
  await assertCheckpointDirectorySafe(paths.artifactRoot, paths.directory);

  const patch = await captureCheckpointPatch(resolve(options.worktreePath));
  await writeCheckpointFileSafely(paths.artifactRoot, paths.patchPath, patch.content);

  const metadata = buildCheckpointMetadata(options, paths, patch);
  await writeCheckpointFileSafely(paths.artifactRoot, paths.metadataPath, `${stableJsonStringify(metadata)}\n`);

  return {
    artifactRoot: paths.artifactRoot,
    directory: paths.directory,
    metadataPath: paths.metadataPath,
    patchPath: paths.patchPath,
  };
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2) ?? 'null';
}

function buildCheckpointMetadata(
  options: WriteValidationRecoveryCheckpointOptions,
  paths: ValidationRecoveryCheckpointPaths,
  patch: PatchCapture,
): Record<string, unknown> {
  return {
    version: 1,
    planSetName: options.planSetName,
    planId: options.planId,
    providerName: options.providerName,
    attempt: Math.max(0, Math.trunc(options.attempt)),
    repairStrategy: options.repairStrategy,
    repairClass: options.repairClass,
    failureSummary: truncateString(options.failureSummary ?? '', MAX_METADATA_STRING_LENGTH),
    checkpoint: {
      artifactRoot: paths.artifactRoot,
      directory: paths.directory,
      metadataPath: paths.metadataPath,
      patchPath: paths.patchPath,
      usedProjectRoot: paths.usedProjectRoot,
    },
    patch: {
      charCount: patch.charCount,
      truncated: patch.truncated,
    },
    signatures: options.signatures.slice(0, MAX_SIGNATURES).map((signature) => truncateString(signature, MAX_METADATA_STRING_LENGTH)),
    signaturesTruncated: options.signatures.length > MAX_SIGNATURES,
    issues: options.issues.slice(0, MAX_CHECKPOINT_ISSUES).map(formatIssueForMetadata),
    issuesTruncated: options.issues.length > MAX_CHECKPOINT_ISSUES,
  };
}

function formatIssueForMetadata(issue: ReviewIssue): Record<string, unknown> {
  return stripUndefined({
    severity: issue.severity,
    category: issue.category,
    file: issue.file,
    line: issue.line,
    description: truncateString(issue.description, MAX_METADATA_STRING_LENGTH),
    fix: issue.fix ? truncateString(issue.fix, MAX_METADATA_STRING_LENGTH) : undefined,
    retryGuidance: issue.retryGuidance ? truncateString(issue.retryGuidance, MAX_METADATA_STRING_LENGTH) : undefined,
    failureKind: issue.failureKind,
    repairClass: issue.repairClass,
    validationProviderName: issue.validationProviderName,
    runtimeFailureKind: issue.runtimeFailureKind,
    metadata: issue.metadata === undefined ? undefined : boundJsonValue(issue.metadata),
  });
}

async function captureCheckpointPatch(worktreePath: string): Promise<PatchCapture> {
  const sections: string[] = [];
  const trackedDiff = await captureTrackedDiff(worktreePath);
  if (trackedDiff.trim().length > 0) sections.push(trackedDiff.trimEnd());

  const untrackedDiff = await captureUntrackedFiles(worktreePath);
  if (untrackedDiff.trim().length > 0) sections.push(untrackedDiff.trimEnd());

  const raw = sections.length > 0
    ? `${sections.join('\n\n')}\n`
    : '# No worktree changes were present before validation repair.\n';
  return boundPatch(redactPatchSecrets(raw));
}

async function captureTrackedDiff(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-c', 'core.quotepath=false', 'diff', '--binary', '--no-ext-diff', 'HEAD', '--'], { cwd: worktreePath });
    return stdout;
  } catch {
    try {
      const { stdout } = await exec('git', ['-c', 'core.quotepath=false', 'diff', '--binary', '--no-ext-diff', '--'], { cwd: worktreePath });
      return stdout;
    } catch (error) {
      return `# Unable to capture git diff before validation repair: ${errorMessage(error)}\n`;
    }
  }
}

async function captureUntrackedFiles(worktreePath: string): Promise<string> {
  let files: string[];
  try {
    const { stdout } = await exec('git', ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '-z'], { cwd: worktreePath });
    files = stdout.split('\0').filter(Boolean).sort();
  } catch {
    return '';
  }

  const sections: string[] = [];
  for (const file of files) {
    sections.push(await formatUntrackedFilePatch(worktreePath, file));
  }
  return sections.filter(Boolean).join('\n');
}

async function formatUntrackedFilePatch(worktreePath: string, file: string): Promise<string> {
  const fullPath = resolve(worktreePath, file);
  if (!isSameOrInside(fullPath, worktreePath)) {
    return `# Untracked path outside worktree omitted: ${file}\n`;
  }
  try {
    const info = await lstat(fullPath);
    if (info.isSymbolicLink()) return `# Untracked symlink omitted: ${file}\n`;
    if (!info.isFile()) return `# Untracked non-file omitted: ${file}\n`;

    const handle = await open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile()) return `# Untracked non-file omitted: ${file}\n`;
      if (openedInfo.size > MAX_UNTRACKED_FILE_BYTES) {
        return `# Untracked file omitted because it exceeds ${MAX_UNTRACKED_FILE_BYTES} bytes: ${file} (${openedInfo.size} bytes)\n`;
      }
      if (!isSameOrInside(resolve(worktreePath, file), worktreePath)) {
        return `# Untracked path outside worktree omitted: ${file}\n`;
      }
      const content = await handle.readFile();
      if (content.includes(0)) return `# Binary untracked file omitted: ${file} (${openedInfo.size} bytes)\n`;
      const text = content.toString('utf8');
      const lines = text.length === 0 ? [] : text.replace(/\n$/u, '').split('\n');
      return [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line) => `+${line}`),
        '',
      ].join('\n');
    } finally {
      await handle.close();
    }
  } catch (error) {
    return `# Unable to capture untracked file ${file}: ${errorMessage(error)}\n`;
  }
}

async function assertCheckpointDirectorySafe(artifactRoot: string, directory: string): Promise<void> {
  const resolvedRoot = resolve(artifactRoot);
  const resolvedDirectory = resolve(directory);
  if (!isSameOrInside(resolvedDirectory, resolvedRoot)) {
    throw new Error('Validation recovery checkpoint directory escapes artifact root');
  }
  const realRoot = await realpath(resolvedRoot);
  const realDirectory = await realpath(resolvedDirectory);
  if (!isSameOrInside(realDirectory, realRoot)) {
    throw new Error('Validation recovery checkpoint directory resolves outside artifact root');
  }
  await assertNoSymlinkDirectoryComponents(resolvedRoot, resolvedDirectory);
}

async function ensureCheckpointDirectory(artifactRoot: string, directory: string): Promise<void> {
  const resolvedRoot = resolve(artifactRoot);
  const resolvedDirectory = resolve(directory);
  if (!isSameOrInside(resolvedDirectory, resolvedRoot)) {
    throw new Error('Validation recovery checkpoint directory escapes artifact root');
  }
  let current = resolvedRoot;
  const rel = relative(resolvedRoot, resolvedDirectory);
  for (const segment of rel.split('/').filter(Boolean)) {
    current = join(current, segment);
    try {
      await assertDirectoryComponentSafe(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await mkdir(current);
      await assertDirectoryComponentSafe(current);
    }
  }
}

async function assertNoSymlinkDirectoryComponents(resolvedRoot: string, resolvedDirectory: string): Promise<void> {
  let current = resolvedRoot;
  const rel = relative(resolvedRoot, resolvedDirectory);
  for (const segment of rel.split('/').filter(Boolean)) {
    current = join(current, segment);
    await assertDirectoryComponentSafe(current);
  }
}

async function assertDirectoryComponentSafe(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new Error('Validation recovery checkpoint directory contains a symlink');
  }
  if (!stat.isDirectory()) {
    throw new Error('Validation recovery checkpoint path component is not a directory');
  }
}

async function writeCheckpointFileSafely(artifactRoot: string, filePath: string, content: string): Promise<void> {
  const resolvedFile = resolve(filePath);
  if (!isSameOrInside(resolvedFile, resolve(artifactRoot))) {
    throw new Error('Validation recovery checkpoint file escapes artifact root');
  }
  await assertCheckpointDirectorySafe(artifactRoot, dirname(resolvedFile));
  try {
    const existing = await lstat(resolvedFile);
    if (existing.isSymbolicLink()) throw new Error('Validation recovery checkpoint file is a symlink');
    if (!existing.isFile()) throw new Error('Validation recovery checkpoint path is not a regular file');
    await unlink(resolvedFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | ((constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0);
  const handle = await open(resolvedFile, flags, 0o600);
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

function redactPatchSecrets(content: string): string {
  return content
    .replace(/https:\/\/[^\s/@]+@/g, 'https://[redacted]@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\bgh[oprsu]_[A-Za-z0-9_]+\b/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, '[redacted]')
    .replace(/\b([A-Za-z0-9_.-]*(?:token|password|secret|api[_-]?key|authorization)[A-Za-z0-9_.-]*)\s*[:=]\s*[^\s]+/gi, '$1=[redacted]');
}

function boundPatch(content: string): PatchCapture {
  const charCount = content.length;
  if (charCount <= MAX_PATCH_CHARS) return { content, charCount, truncated: false };
  return {
    content: `${content.slice(0, MAX_PATCH_CHARS)}\n\n# Validation recovery checkpoint patch truncated at ${MAX_PATCH_CHARS} characters.\n`,
    charCount,
    truncated: true,
  };
}

function sanitizePathSegment(value: string): string {
  const safe = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || 'unknown';
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const rel = relative(parent, candidate);
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel));
}

function boundJsonValue(value: unknown): unknown { return boundJsonValueInner(value, 0, { nodes: 0 }); }

function boundJsonValueInner(value: unknown, depth: number, state: { nodes: number }): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_METADATA_NODES) return '[truncated: metadata node limit exceeded]';
  if (depth > MAX_METADATA_DEPTH) return '[truncated: metadata depth limit exceeded]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') return truncateString(value, MAX_METADATA_STRING_LENGTH);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_METADATA_ARRAY_ITEMS).map((item) => boundJsonValueInner(item, depth + 1, state));
    if (value.length > MAX_METADATA_ARRAY_ITEMS) items.push(`[truncated: ${value.length - MAX_METADATA_ARRAY_ITEMS} array item(s) omitted]`);
    return items;
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const selected = keys.slice(0, MAX_METADATA_OBJECT_KEYS);
    const out: Record<string, unknown> = {};
    for (const key of selected) {
      out[key] = boundJsonValueInner(source[key], depth + 1, state);
    }
    if (keys.length > MAX_METADATA_OBJECT_KEYS) {
      out.__truncatedKeys = `${keys.length - MAX_METADATA_OBJECT_KEYS} object key(s) omitted`;
    }
    return out;
  }
  return String(value);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = sortJsonValue(child);
    }
    return out;
  }
  return value;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) out[key] = child;
  }
  return out;
}

function truncateString(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…[truncated ${value.length - maxLength} chars]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
