// --- eforge:region plan-03-stack-daemon-ui ---
import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { StackLayersResponse } from '../routes.js';

export function apiGetStackLayers(opts: { cwd: string }) {
  return daemonRequest<StackLayersResponse>(opts.cwd, 'GET', API_ROUTES.stackLayers);
}

export function apiGetStackLayersIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<StackLayersResponse>(opts.cwd, 'GET', API_ROUTES.stackLayers);
}
// --- eforge:endregion plan-03-stack-daemon-ui ---

// --- eforge:region plan-01-stack-sync-daemon-cli ---
import type { StackSyncRequest, StackSyncResponse } from '../routes.js';

export function apiStackSync(opts: { cwd: string; body: StackSyncRequest }) {
  return daemonRequest<StackSyncResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.stackSync,
    opts.body,
  );
}

export function apiStackSyncIfRunning(opts: { cwd: string; body: StackSyncRequest }) {
  return daemonRequestIfRunning<StackSyncResponse>(
    opts.cwd,
    'POST',
    API_ROUTES.stackSync,
    opts.body,
  );
}
// --- eforge:endregion plan-01-stack-sync-daemon-cli ---
