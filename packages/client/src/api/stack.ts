import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type { StackLayersResponse } from '../routes.js';

export function apiGetStackLayers(opts: { cwd: string }) {
  return daemonRequest<StackLayersResponse>(opts.cwd, 'GET', API_ROUTES.stackLayers);
}

export function apiGetStackLayersIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<StackLayersResponse>(opts.cwd, 'GET', API_ROUTES.stackLayers);
}

import type { StackSyncRequest, StackSyncResponse, StackSyncStatusResponse } from '../routes.js';

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

export function apiGetStackSyncStatus(opts: { cwd: string }) {
  return daemonRequest<StackSyncStatusResponse>(
    opts.cwd,
    'GET',
    API_ROUTES.stackSyncStatus,
  );
}

export function apiGetStackSyncStatusIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<StackSyncStatusResponse>(
    opts.cwd,
    'GET',
    API_ROUTES.stackSyncStatus,
  );
}
