import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type ResumePrdContentSource =
  | 'queue-root'
  | 'queue-failed'
  | 'feature-branch-tip'
  | 'branch-history'
  | 'summary';

export interface ResolvedResumePrdContent {
  label: string;
  content: string;
  source: ResumePrdContentSource;
  path?: string;
  commit?: string;
}

export interface ResolveResumePrdContentOptions {
  cwd: string;
  prdId: string;
  setName: string;
  featureBranch: string;
  queueDir?: string;
  summaryPrdContent?: string;
}

/**
 * Resolve the PRD markdown used by compiled-build resume validation and
 * artifact projection. Preference order is durable queue state first, then the
 * provenance artifact on the preserved feature branch, then branch history.
 */
export async function resolveResumePrdContent(
  options: ResolveResumePrdContentOptions,
): Promise<ResolvedResumePrdContent | undefined> {
  assertSafePathSegment(options.prdId, 'prdId');
  assertSafePathSegment(options.setName, 'setName');
  assertSafeGitRef(options.featureBranch, 'featureBranch');

  const queueDir = options.queueDir ?? '.eforge/queue';
  if (isAbsolute(queueDir) || queueDir.split(/[\\/]+/).includes('..')) {
    throw new Error('Invalid queueDir: must be a relative path that does not escape cwd');
  }
  const queueRoot = resolve(options.cwd, queueDir);
  const rootQueuePath = resolve(queueRoot, `${options.prdId}.md`);
  const failedQueuePath = resolve(queueRoot, 'failed', `${options.prdId}.md`);
  assertContained(queueRoot, rootQueuePath, 'queue-root PRD path');
  assertContained(queueRoot, failedQueuePath, 'queue-failed PRD path');

  const root = await readFilesystemSource(options.cwd, rootQueuePath, 'queue-root');
  if (root) return root;

  const failed = await readFilesystemSource(options.cwd, failedQueuePath, 'queue-failed');
  if (failed) return failed;

  const relPath = join('eforge', 'prds', `${options.setName}.md`);
  const tip = await readGitObject(options.cwd, options.featureBranch, relPath);
  if (tip !== undefined) {
    return {
      label: `${options.featureBranch}:${relPath}`,
      content: tip,
      source: 'feature-branch-tip',
    };
  }

  const history = await readNewestGitHistoryObject(options.cwd, options.featureBranch, relPath);
  if (history !== undefined) {
    return {
      label: `${history.commit}:${relPath}`,
      content: history.content,
      source: 'branch-history',
      commit: history.commit,
    };
  }

  if (options.summaryPrdContent !== undefined) {
    return {
      label: `PRD ${options.prdId}`,
      content: options.summaryPrdContent,
      source: 'summary',
    };
  }

  return undefined;
}

function assertSafePathSegment(value: string, label: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`Invalid ${label}: must be a safe path segment`);
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Invalid ${label}: resolved outside queue directory`);
  }
}

function assertSafeGitRef(value: string, label: string): void {
  if (
    !value ||
    value.startsWith('-') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[\x00-\x20~^:?*[\\{}]/.test(value)
  ) {
    throw new Error(`Invalid ${label}: must be a safe git ref name`);
  }
}

async function readFilesystemSource(
  cwd: string,
  path: string,
  source: Extract<ResumePrdContentSource, 'queue-root' | 'queue-failed'>,
): Promise<ResolvedResumePrdContent | undefined> {
  try {
    const content = await readFile(path, 'utf-8');
    return {
      label: path.startsWith(cwd) ? path.slice(cwd.length + 1) : path,
      path,
      content,
      source,
    };
  } catch {
    return undefined;
  }
}

async function readGitObject(cwd: string, ref: string, relPath: string): Promise<string | undefined> {
  try {
    await exec('git', ['cat-file', '-e', `${ref}:${relPath}`], { cwd });
    const { stdout } = await exec('git', ['show', `${ref}:${relPath}`], { cwd });
    return stdout;
  } catch {
    return undefined;
  }
}

async function readNewestGitHistoryObject(
  cwd: string,
  ref: string,
  relPath: string,
): Promise<{ commit: string; content: string } | undefined> {
  let candidateCommits: string[];
  try {
    const { stdout } = await exec('git', ['rev-list', '--end-of-options', ref, '--', relPath], { cwd });
    candidateCommits = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return undefined;
  }

  for (const commit of candidateCommits) {
    const content = await readGitObject(cwd, commit, relPath);
    if (content !== undefined) return { commit, content };
  }
  return undefined;
}
