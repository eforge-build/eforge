import { daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { VersionResponse } from '../routes.js';

export interface ExtensionErrorVersionHintOptions {
  cwd: string;
  callerVersion: string;
}

export async function appendExtensionErrorVersionHint(
  err: unknown,
  options: ExtensionErrorVersionHintOptions,
): Promise<Error> {
  const base = err instanceof Error ? err : new Error(String(err));
  if (!isExtensionDomainError(base)) return base;
  const version = await readDaemonVersion(options.cwd);
  if (!version?.eforgeVersion || version.eforgeVersion === options.callerVersion) return base;
  const hint = buildExtensionErrorVersionHint(version.eforgeVersion, options.callerVersion);
  const enriched = new Error(`${base.message}\n\n${hint}`);
  enriched.stack = base.stack;
  return enriched;
}

export function buildExtensionErrorVersionHint(daemonVersion: string, callerVersion: string): string {
  const safeDaemonVersion = sanitizeVersionForHint(daemonVersion);
  const safeCallerVersion = sanitizeVersionForHint(callerVersion);
  return [
    `Daemon eforgeVersion ${safeDaemonVersion} differs from caller version ${safeCallerVersion}.`,
    'This can happen when the daemon is stale after an update or when CLI/MCP/Pi and daemon builds are out of sync.',
    'Restart the eforge daemon, then update/rebuild the caller and daemon from the same eforge version if the error persists.',
  ].join(' ');
}

async function readDaemonVersion(cwd: string): Promise<VersionResponse | null> {
  try {
    const result = await daemonRequestIfRunning<VersionResponse>(cwd, 'GET', API_ROUTES.version);
    return result?.data ?? null;
  } catch {
    return null;
  }
}

function isExtensionDomainError(err: Error): boolean {
  return /Daemon returned (4\d\d|5\d\d):|Extension not found|Unknown extension/i.test(err.message);
}

function sanitizeVersionForHint(value: string): string {
  const singleLine = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!singleLine) return 'unknown';
  return singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
}
