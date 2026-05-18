/**
 * Pi-local no-start daemon request wrappers.
 *
 * All Pi extension daemon calls (except eforge_daemon start/restart) must
 * go through these helpers. They use daemonRequestIfRunning under the hood
 * so they never auto-start the daemon process.
 *
 * Usage:
 *   - `piDaemonRequest(...)` — same as daemonRequestIfRunning; returns null
 *     when no daemon is running. Use in ambient/polling contexts and commands
 *     that want to show a daemon-not-running overlay.
 *   - `requireDaemon(...)` — throws DAEMON_NOT_RUNNING_GUIDANCE when the
 *     daemon is not running. Use in Pi tool execute handlers that
 *     unconditionally require a live daemon.
 */

import { daemonRequestIfRunning } from '@eforge-build/client';

/**
 * Standard guidance message shown to the user when a tool requires a live
 * daemon but none is running.
 */
export const DAEMON_NOT_RUNNING_GUIDANCE =
  'The eforge daemon is not running. Start it with `eforge_daemon { action: "start" }`, `/eforge:restart`, or `eforge daemon start`.';

/**
 * Pi-local wrapper for raw no-start daemon requests.
 * Returns null when no daemon is running (same contract as daemonRequestIfRunning).
 */
export function piDaemonRequest<T = unknown>(
  cwd: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; port: number } | null> {
  return daemonRequestIfRunning<T>(cwd, method, path, body);
}

/**
 * Pi-local wrapper that throws a standard daemon-not-running error when no
 * daemon is live. Use for Pi tool execute handlers that require an active daemon.
 *
 * @throws Error with DAEMON_NOT_RUNNING_GUIDANCE when no daemon is running.
 */
export async function requireDaemon<T = unknown>(
  cwd: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; port: number }> {
  const result = await daemonRequestIfRunning<T>(cwd, method, path, body);
  if (result === null) {
    throw new Error(DAEMON_NOT_RUNNING_GUIDANCE);
  }
  return result;
}
