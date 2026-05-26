import { readLockfile, isServerAlive } from './lockfile.js';
import { API_ROUTES } from './routes.js';
import type { VersionResponse } from './routes.js';

// Re-export the browser-safe constant so Node consumers can keep importing
// from api-version.js as before.
export { DAEMON_API_VERSION } from './api-version-const.js';
import { DAEMON_API_VERSION } from './api-version-const.js';

// Version history and bump guidance live in api-version-const.ts (the
// browser-safe module that exports only the numeric constant).

/** Per-process cache: maps `${port}:${pid}` to the verified daemon version. */
const verifiedDaemons = new Map<string, number>();

/**
 * Reset the per-process version cache. For test use only.
 */
export function clearApiVersionCache(): void {
  verifiedDaemons.clear();
}

/**
 * Verify that the running daemon's API version matches `DAEMON_API_VERSION`.
 *
 * - If no lockfile exists, silently returns (the daemon is down; the caller
 *   will surface a clearer `daemon-down` error shortly via `ensureDaemon`).
 * - If the daemon reports a different version, throws an `Error` whose message
 *   contains `version mismatch` so `classifyDaemonError` routes it to
 *   `kind: 'version-mismatch'`.
 * - Results are cached per `${port}:${pid}` key for the lifetime of this
 *   process, so the check is only ever issued once per daemon instance.
 */
export async function verifyApiVersion(cwd: string): Promise<void> {
  const lock = readLockfile(cwd);
  if (!lock) return;

  // Stale lockfile: daemon process exited or port was reused. Bail out silently
  // so `ensureDaemon` downstream can detect the dead lockfile and auto-start a
  // fresh daemon instead of surfacing a misleading `daemon-down` error here.
  if (!(await isServerAlive(lock))) return;

  const cacheKey = `${lock.port}:${lock.pid}`;
  if (verifiedDaemons.has(cacheKey)) return;

  const url = `http://127.0.0.1:${lock.port}${API_ROUTES.version}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to fetch daemon version: ${res.status} ${text}`);
  }

  const data = JSON.parse(text) as VersionResponse;
  if (data.version !== DAEMON_API_VERSION) {
    throw new Error(
      `eforge daemon API version-mismatch: client expects v${DAEMON_API_VERSION}, daemon reports v${data.version}. Restart the daemon with the matching version.`,
    );
  }

  verifiedDaemons.set(cacheKey, data.version);
}
