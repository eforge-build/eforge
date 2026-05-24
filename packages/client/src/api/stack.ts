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
