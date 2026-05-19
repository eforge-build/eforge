/**
 * Typed helpers for native eforge extension daemon API endpoints.
 */

import { daemonRequest, daemonRequestIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import type {
  ExtensionDemoteRequest,
  ExtensionDemoteResponse,
  ExtensionInstallRequest,
  ExtensionInstallResponse,
  ExtensionListResponse,
  ExtensionNewRequest,
  ExtensionNewResponse,
  ExtensionPromoteRequest,
  ExtensionPromoteResponse,
  ExtensionReloadResponse,
  ExtensionRemoveRequest,
  ExtensionRemoveResponse,
  ExtensionShowResponse,
  ExtensionTestRequest,
  ExtensionTestResponse,
  ExtensionTrustRequest,
  ExtensionTrustResponse,
  ExtensionUntrustRequest,
  ExtensionUntrustResponse,
  ExtensionUpdateRequest,
  ExtensionUpdateResponse,
  ExtensionValidateResponse,
} from '../types.js';

function appendQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function apiListExtensions(opts: { cwd: string }) {
  return daemonRequest<ExtensionListResponse>(opts.cwd, 'GET', API_ROUTES.extensionList);
}

export function apiShowExtension(opts: { cwd: string; name: string }) {
  const params = new URLSearchParams({ name: opts.name });
  return daemonRequest<ExtensionShowResponse>(
    opts.cwd,
    'GET',
    appendQuery(API_ROUTES.extensionShow, params),
  );
}

export function apiValidateExtensions(opts: { cwd: string; name?: string; path?: string }) {
  const params = new URLSearchParams();
  if (opts.name !== undefined) params.set('name', opts.name);
  if (opts.path !== undefined) params.set('path', opts.path);
  return daemonRequest<ExtensionValidateResponse>(
    opts.cwd,
    'GET',
    appendQuery(API_ROUTES.extensionValidate, params),
  );
}

export function apiNewExtension(opts: { cwd: string; body: ExtensionNewRequest }) {
  return daemonRequest<ExtensionNewResponse>(opts.cwd, 'POST', API_ROUTES.extensionNew, opts.body);
}

export function apiReloadExtensions(opts: { cwd: string }) {
  return daemonRequest<ExtensionReloadResponse>(opts.cwd, 'POST', API_ROUTES.extensionReload, {});
}

// --- eforge:region plan-01-engine-daemon-extension-replay ---
export function apiTestExtension(opts: { cwd: string; body: ExtensionTestRequest }) {
  return daemonRequest<ExtensionTestResponse>(opts.cwd, 'POST', API_ROUTES.extensionTest, opts.body);
}
// --- eforge:endregion plan-01-engine-daemon-extension-replay ---

// --- eforge:region plan-02-management-surfaces ---
export function apiTrustExtension(opts: { cwd: string; body: ExtensionTrustRequest }) {
  return daemonRequest<ExtensionTrustResponse>(opts.cwd, 'POST', API_ROUTES.extensionTrust, opts.body);
}

export function apiUntrustExtension(opts: { cwd: string; body: ExtensionUntrustRequest }) {
  return daemonRequest<ExtensionUntrustResponse>(opts.cwd, 'POST', API_ROUTES.extensionUntrust, opts.body);
}
// --- eforge:endregion plan-02-management-surfaces ---

// --- eforge:region plan-01-no-start-client-helpers ---
export function apiListExtensionsIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<ExtensionListResponse>(opts.cwd, 'GET', API_ROUTES.extensionList);
}

export function apiShowExtensionIfRunning(opts: { cwd: string; name: string }) {
  const params = new URLSearchParams({ name: opts.name });
  return daemonRequestIfRunning<ExtensionShowResponse>(
    opts.cwd,
    'GET',
    appendQuery(API_ROUTES.extensionShow, params),
  );
}

export function apiValidateExtensionsIfRunning(opts: { cwd: string; name?: string; path?: string }) {
  const params = new URLSearchParams();
  if (opts.name !== undefined) params.set('name', opts.name);
  if (opts.path !== undefined) params.set('path', opts.path);
  return daemonRequestIfRunning<ExtensionValidateResponse>(
    opts.cwd,
    'GET',
    appendQuery(API_ROUTES.extensionValidate, params),
  );
}

export function apiNewExtensionIfRunning(opts: { cwd: string; body: ExtensionNewRequest }) {
  return daemonRequestIfRunning<ExtensionNewResponse>(opts.cwd, 'POST', API_ROUTES.extensionNew, opts.body);
}

export function apiReloadExtensionsIfRunning(opts: { cwd: string }) {
  return daemonRequestIfRunning<ExtensionReloadResponse>(opts.cwd, 'POST', API_ROUTES.extensionReload, {});
}

export function apiTestExtensionIfRunning(opts: { cwd: string; body: ExtensionTestRequest }) {
  return daemonRequestIfRunning<ExtensionTestResponse>(opts.cwd, 'POST', API_ROUTES.extensionTest, opts.body);
}

export function apiTrustExtensionIfRunning(opts: { cwd: string; body: ExtensionTrustRequest }) {
  return daemonRequestIfRunning<ExtensionTrustResponse>(opts.cwd, 'POST', API_ROUTES.extensionTrust, opts.body);
}

export function apiUntrustExtensionIfRunning(opts: { cwd: string; body: ExtensionUntrustRequest }) {
  return daemonRequestIfRunning<ExtensionUntrustResponse>(opts.cwd, 'POST', API_ROUTES.extensionUntrust, opts.body);
}
// --- eforge:endregion plan-01-no-start-client-helpers ---

// --- eforge:region plan-01-extension-package-foundation ---
export function apiInstallExtension(opts: { cwd: string; body: ExtensionInstallRequest }) {
  return daemonRequest<ExtensionInstallResponse>(opts.cwd, 'POST', API_ROUTES.extensionInstall, opts.body);
}

export function apiUpdateExtension(opts: { cwd: string; body: ExtensionUpdateRequest }) {
  return daemonRequest<ExtensionUpdateResponse>(opts.cwd, 'POST', API_ROUTES.extensionUpdate, opts.body);
}

export function apiRemoveExtension(opts: { cwd: string; body: ExtensionRemoveRequest }) {
  return daemonRequest<ExtensionRemoveResponse>(opts.cwd, 'POST', API_ROUTES.extensionRemove, opts.body);
}

export function apiPromoteExtension(opts: { cwd: string; body: ExtensionPromoteRequest }) {
  return daemonRequest<ExtensionPromoteResponse>(opts.cwd, 'POST', API_ROUTES.extensionPromote, opts.body);
}

export function apiDemoteExtension(opts: { cwd: string; body: ExtensionDemoteRequest }) {
  return daemonRequest<ExtensionDemoteResponse>(opts.cwd, 'POST', API_ROUTES.extensionDemote, opts.body);
}

export function apiInstallExtensionIfRunning(opts: { cwd: string; body: ExtensionInstallRequest }) {
  return daemonRequestIfRunning<ExtensionInstallResponse>(opts.cwd, 'POST', API_ROUTES.extensionInstall, opts.body);
}

export function apiUpdateExtensionIfRunning(opts: { cwd: string; body: ExtensionUpdateRequest }) {
  return daemonRequestIfRunning<ExtensionUpdateResponse>(opts.cwd, 'POST', API_ROUTES.extensionUpdate, opts.body);
}

export function apiRemoveExtensionIfRunning(opts: { cwd: string; body: ExtensionRemoveRequest }) {
  return daemonRequestIfRunning<ExtensionRemoveResponse>(opts.cwd, 'POST', API_ROUTES.extensionRemove, opts.body);
}

export function apiPromoteExtensionIfRunning(opts: { cwd: string; body: ExtensionPromoteRequest }) {
  return daemonRequestIfRunning<ExtensionPromoteResponse>(opts.cwd, 'POST', API_ROUTES.extensionPromote, opts.body);
}

export function apiDemoteExtensionIfRunning(opts: { cwd: string; body: ExtensionDemoteRequest }) {
  return daemonRequestIfRunning<ExtensionDemoteResponse>(opts.cwd, 'POST', API_ROUTES.extensionDemote, opts.body);
}
// --- eforge:endregion plan-01-extension-package-foundation ---
