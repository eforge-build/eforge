import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type GuidanceArtifactLocation =
  | { source: 'merge-worktree'; planSetRelPath: string; artifactCommit?: undefined }
  | { source: 'feature-branch' | 'branch-history'; planSetRelPath: string; artifactCommit: string };

export async function ensureGuidanceMergeWorktree(opts: { cwd: string; mergeWorktreePath: string; featureBranch: string }): Promise<void> {
  validateSafeGitRef(opts.featureBranch, 'featureBranch');
  await exec('git', ['rev-parse', '--verify', '--end-of-options', opts.featureBranch], { cwd: opts.cwd });
  if (await pathExistsNoFollow(opts.mergeWorktreePath)) {
    await assertExistingGuidanceWorktree(opts);
    return;
  }
  await mkdir(dirname(opts.mergeWorktreePath), { recursive: true });
  await exec('git', ['worktree', 'add', opts.mergeWorktreePath, opts.featureBranch], { cwd: opts.cwd });
}

export async function locateGuidanceArtifacts(opts: { cwd: string; mergeWorktreePath: string; featureBranch: string; outputDir: string; setName: string }): Promise<GuidanceArtifactLocation | undefined> {
  const planSetRelPath = join(opts.outputDir, opts.setName);
  const orchRelPath = join(planSetRelPath, 'orchestration.yaml');
  if (existsSync(resolve(opts.mergeWorktreePath, orchRelPath))) return { source: 'merge-worktree', planSetRelPath };

  if (await pathExistsAtRef(opts.cwd, opts.featureBranch, orchRelPath)) {
    const { stdout } = await exec('git', ['rev-parse', '--verify', '--end-of-options', opts.featureBranch], { cwd: opts.cwd });
    return { source: 'feature-branch', planSetRelPath, artifactCommit: stdout.trim() };
  }

  const historyCommit = await findArtifactCommitInHistory({ cwd: opts.cwd, featureBranch: opts.featureBranch, orchRelPath });
  return historyCommit ? { source: 'branch-history', planSetRelPath, artifactCommit: historyCommit } : undefined;
}

export async function materializeGuidanceArtifactsFromHistory(opts: { mergeWorktreePath: string; artifactCommit: string; planSetRelPath: string }): Promise<void> {
  await exec('git', ['checkout', opts.artifactCommit, '--', opts.planSetRelPath], { cwd: opts.mergeWorktreePath });
}

export async function listGuidanceArtifactPathsAtCommit(opts: { cwd: string; artifactCommit: string; planSetRelPath: string }): Promise<string[]> {
  const { stdout } = await exec('git', ['ls-tree', '-r', '--name-only', opts.artifactCommit, '--', opts.planSetRelPath], { cwd: opts.cwd });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort();
}

export async function assertNoPreexistingGuidanceTargetDiff(opts: { mergeWorktreePath: string; targetPaths: string[] }): Promise<void> {
  for (const targetPath of opts.targetPaths) {
    const { stdout } = await exec('git', ['status', '--porcelain=v1', '--', targetPath], { cwd: opts.mergeWorktreePath });
    if (stdout.trim().length > 0) {
      throw new Error(`Recovery guidance target has pre-existing uncommitted changes: ${targetPath}`);
    }
  }
}

export async function gitPathExists(cwd: string, relPath: string): Promise<boolean> {
  return existsSync(resolve(cwd, relPath));
}

export async function currentHead(cwd: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

export async function hasAnyDiff(cwd: string, paths: string[]): Promise<boolean> {
  const { stdout } = await exec('git', ['status', '--porcelain=v1', '--', ...paths], { cwd });
  return stdout.trim().length > 0;
}

async function pathExistsNoFollow(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function assertExistingGuidanceWorktree(opts: { cwd: string; mergeWorktreePath: string; featureBranch: string }): Promise<void> {
  const stat = await lstat(opts.mergeWorktreePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Recovery guidance merge worktree path is not a real directory: ${opts.mergeWorktreePath}`);
  }

  const expectedPath = await realpath(opts.mergeWorktreePath);
  const expectedHead = (await exec('git', ['rev-parse', '--verify', '--end-of-options', opts.featureBranch], { cwd: opts.cwd })).stdout.trim();
  const worktree = await findRegisteredWorktree(opts.cwd, expectedPath);
  if (!worktree) throw new Error(`Recovery guidance merge path is not registered as a worktree for this repository: ${opts.mergeWorktreePath}`);
  const expectedBranch = `refs/heads/${opts.featureBranch}`;
  if (worktree.branch !== expectedBranch && worktree.head !== expectedHead) {
    throw new Error(`Recovery guidance merge worktree is not checked out at ${opts.featureBranch}: ${opts.mergeWorktreePath}`);
  }
}

async function findRegisteredWorktree(cwd: string, realWorktreePath: string): Promise<{ head?: string; branch?: string } | undefined> {
  const { stdout } = await exec('git', ['worktree', 'list', '--porcelain'], { cwd });
  let current: { path?: string; head?: string; branch?: string } | undefined;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      const match = await matchesWorktree(current, realWorktreePath);
      if (match) return match;
      current = { path: line.slice('worktree '.length) };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim();
    }
  }
  return matchesWorktree(current, realWorktreePath);
}

async function matchesWorktree(worktree: { path?: string; head?: string; branch?: string } | undefined, realWorktreePath: string): Promise<{ head?: string; branch?: string } | undefined> {
  if (!worktree?.path) return undefined;
  try {
    return await realpath(worktree.path) === realWorktreePath ? { head: worktree.head, branch: worktree.branch } : undefined;
  } catch {
    return undefined;
  }
}

async function findArtifactCommitInHistory(opts: { cwd: string; featureBranch: string; orchRelPath: string }): Promise<string | undefined> {
  const { stdout } = await exec('git', ['rev-list', opts.featureBranch, '--', opts.orchRelPath], { cwd: opts.cwd });
  for (const candidate of stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
    if (await pathExistsAtRef(opts.cwd, candidate, opts.orchRelPath)) return candidate;
  }
  return undefined;
}

async function pathExistsAtRef(cwd: string, ref: string, relPath: string): Promise<boolean> {
  try {
    await exec('git', ['cat-file', '-e', `${ref}:${relPath}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

function validateSafeGitRef(value: string, label: string): void {
  if (!value || /^[.-]|[.]$|[\x00-\x20~^:?*[\\{}@]/.test(value) || value.endsWith('.lock') || value.includes('..')) {
    throw new Error(`Invalid ${label}: contains characters that are not allowed in a branch ref`);
  }
}
