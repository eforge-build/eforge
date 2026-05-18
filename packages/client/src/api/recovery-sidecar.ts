/**
 * Typed helper for the recovery sidecar read daemon API endpoint.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { ReadSidecarResponse } from '../routes.js';

export function apiReadRecoverySidecar(opts: { cwd: string; prdId: string }) {
  const params = new URLSearchParams({ prdId: opts.prdId });
  return daemonRequest<ReadSidecarResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.readRecoverySidecar}?${params.toString()}`,
  );
}

export function apiReadRecoverySidecarIfRunning(opts: { cwd: string; prdId: string }) {
  const params = new URLSearchParams({ prdId: opts.prdId });
  return daemonRequestIfRunning<ReadSidecarResponse>(
    opts.cwd,
    'GET',
    `${API_ROUTES.readRecoverySidecar}?${params.toString()}`,
  );
}
