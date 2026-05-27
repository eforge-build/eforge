/**
 * Shared daemon client utilities.
 *
 * Extracted from mcp-proxy.ts so that both the MCP proxy and other
 * consumers (e.g. plugin skills) can share daemon lifecycle helpers.
 */

import { readLockfile, isServerAlive } from './lockfile.js';
import { verifyApiVersion } from './api-version.js';
import { API_ROUTES } from './routes.js';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve, dirname } from 'node:path';

const execFileAsync = promisify(execFile);

export const DAEMON_START_TIMEOUT_MS = 15_000;
export const DAEMON_POLL_INTERVAL_MS = 500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when `cwd` looks like an eforge agent worktree: the merge worktree
 * (`.../<project>-<setName>-worktrees/__merge__`) or a per-module worktree
 * (`.../<project>-<setName>-worktrees/<moduleId>`). Spawning a daemon there
 * could cause a recursive auto-build. Queue state lives under `.eforge/queue/`
 * which is gitignored and not committed into worktrees.
 */
export function isAgentWorktreeCwd(cwd: string): boolean {
  // Walk upward from cwd so that nested paths inside __merge__ or a module
  // worktree (e.g. running from a subdirectory) are also detected.
  let dir = cwd;
  while (true) {
    const name = basename(dir);
    if (name === '__merge__') return true;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    if (/-worktrees$/.test(basename(parent))) return true;
    dir = parent;
  }
  return false;
}

export class DaemonInWorktreeError extends Error {
  readonly cwd: string;
  constructor(cwd: string) {
    super(
      `Refusing to spawn eforge daemon from agent worktree: ${cwd}. ` +
      `An auto-discovered eforge plugin or extension reached an agent subprocess. ` +
      `Run eforge from the project root, not from inside a worktree.`,
    );
    this.name = 'DaemonInWorktreeError';
    this.cwd = cwd;
  }
}

// --- eforge:region plan-01-core-daemon-stack-sync ---

/**
 * Error thrown when a wet stack sync is attempted from an agent worktree
 * and no project-root daemon can be discovered via git common dir.
 *
 * Unlike DaemonInWorktreeError (which covers arbitrary daemon spawn attempts),
 * this is specific to the wet sync path where we tried discovery and failed.
 */
export class DaemonNotDiscoverableError extends Error {
  readonly cwd: string;
  constructor(cwd: string, reason: string) {
    super(
      `Cannot perform wet stack sync from agent worktree ${cwd}: ${reason}. ` +
      `Start the eforge daemon from the project root first, then retry.`,
    );
    this.name = 'DaemonNotDiscoverableError';
    this.cwd = cwd;
  }
}

/**
 * Discover the project root cwd for a git worktree by reading the git common
 * dir. For a main working tree, the common dir is the `.git` directory
 * (relative), and resolving it then taking `dirname` yields the project root.
 * For a linked worktree, the common dir is an absolute path to the main
 * repo's `.git/`; taking `dirname` of that also yields the project root.
 *
 * Example (linked worktree at /proj/set-worktrees/plan-01):
 *   gitCommonDir = /proj/.git
 *   dirname(/proj/.git) = /proj  ← project root
 *
 * Example (main worktree at /proj):
 *   gitCommonDir = .git  (relative)
 *   resolve(/proj, .git) = /proj/.git
 *   dirname(/proj/.git) = /proj  ← project root
 *
 * Returns null when git is unavailable, the directory is not a git repo, or
 * the common dir output is empty.
 */
export async function discoverProjectRootCwd(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { cwd });
    const gitCommonDir = stdout.trim();
    if (!gitCommonDir) return null;
    const resolvedCommonDir = resolve(cwd, gitCommonDir);
    return dirname(resolvedCommonDir);
  } catch {
    return null;
  }
}

/**
 * Like daemonRequestIfRunning, but for an agent worktree: discovers the project
 * root daemon via git common dir and routes the request there.
 *
 * Returns null when no live daemon is found at the discovered project root.
 * Throws DaemonNotDiscoverableError when an active discovery attempt fails
 * and the worktree cannot fall back to local execution.
 */
export async function daemonRequestFromWorktree<T = unknown>(
  cwd: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; port: number } | null> {
  const projectRoot = await discoverProjectRootCwd(cwd);
  if (!projectRoot) return null;
  return daemonRequestIfRunning<T>(projectRoot, method, path, body);
}

// --- eforge:endregion plan-01-core-daemon-stack-sync ---

export async function ensureDaemon(cwd: string): Promise<number> {
  const existing = readLockfile(cwd);
  if (existing && (await isServerAlive(existing))) {
    return existing.port;
  }

  if (isAgentWorktreeCwd(cwd)) {
    throw new DaemonInWorktreeError(cwd);
  }

  // Auto-start daemon
  const child = spawn('eforge', ['daemon', 'start'], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => {
    // Swallow — poll loop will time out with descriptive error
  });
  child.unref();

  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(DAEMON_POLL_INTERVAL_MS);
    const lock = readLockfile(cwd);
    if (lock && (await isServerAlive(lock))) {
      return lock.port;
    }
  }

  throw new Error(
    'Daemon failed to start within timeout. Run `eforge daemon start` manually to diagnose.',
  );
}

/**
 * Like daemonRequest but only talks to an already-running daemon.
 * Returns null if daemon is not running instead of trying to start it.
 *
 * When a live daemon is found, performs API version verification before
 * non-version requests so Pi callers get the same stale-daemon diagnostics
 * as the auto-starting daemonRequest path.
 */
export async function daemonRequestIfRunning<T = unknown>(
  cwd: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; port: number } | null> {
  const lock = readLockfile(cwd);
  if (!lock || !(await isServerAlive(lock))) return null;
  if (path !== API_ROUTES.version) {
    await verifyApiVersion(cwd);
  }
  return daemonRequestWithPort<T>(lock.port, method, path, body);
}

async function daemonRequestWithPort<T = unknown>(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; port: number }> {
  const url = `http://127.0.0.1:${port}${path}`;
  const options: RequestInit = {
    method,
    signal: AbortSignal.timeout(30_000),
  };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) {
    const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
    throw new Error(`Daemon returned ${res.status}: ${truncated}`);
  }
  try {
    return { data: JSON.parse(text) as T, port };
  } catch {
    return { data: text as T, port };
  }
}

export async function daemonRequest<T = unknown>(
  cwd: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; port: number }> {
  if (path !== API_ROUTES.version) {
    await verifyApiVersion(cwd);
  }
  const port = await ensureDaemon(cwd);
  return daemonRequestWithPort<T>(port, method, path, body);
}
