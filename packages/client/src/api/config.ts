/**
 * Typed helpers for daemon config API endpoints.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { ConfigShowResponse, ConfigValidateResponse, ConfigShowVerboseResponse } from '../types.js';

export function apiShowConfig(opts: { cwd: string }) {
  return daemonRequest<ConfigShowResponse>(opts.cwd, 'GET', API_ROUTES.configShow);
}

export function apiShowConfigIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<ConfigShowResponse>(opts.cwd, 'GET', API_ROUTES.configShow);
}

export function apiValidateConfig(opts: { cwd: string }) {
  return daemonRequest<ConfigValidateResponse>(opts.cwd, 'GET', API_ROUTES.configValidate);
}

export function apiValidateConfigIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<ConfigValidateResponse>(opts.cwd, 'GET', API_ROUTES.configValidate);
}

// --- eforge:region plan-01-unified-pi-landing-ux ---
/**
 * Fetch the verbose config response from a live daemon (starts daemon if needed).
 *
 * Includes resolved merged config and per-source provenance metadata via
 * GET /api/config/show?verbose=true.
 */
export function apiShowConfigVerbose(opts: { cwd: string }) {
  return daemonRequest<ConfigShowVerboseResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.configShow}?verbose=true`,
  );
}

/**
 * Fetch the verbose config response if a daemon is already running.
 *
 * Returns null when no daemon lockfile exists or the daemon is not alive.
 * Never spawns a new daemon process.
 */
export function apiShowConfigVerboseIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<ConfigShowVerboseResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.configShow}?verbose=true`,
  );
}
// --- eforge:endregion plan-01-unified-pi-landing-ux ---
