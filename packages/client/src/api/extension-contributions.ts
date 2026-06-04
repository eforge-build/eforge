import { daemonRequest, daemonRequestIfRunning, daemonRequestWithStatus, daemonRequestWithStatusIfRunning } from '../daemon-client.js';
import { API_ROUTES } from '../routes.js';
import {
  parseExtensionActionInvokeResponse,
  parseExtensionContributionManifest,
  type ExtensionActionInvokeRequest,
  type ExtensionActionInvokeResponse,
  type ExtensionContributionManifestResponse,
} from '../extension-contributions.js';

// --- eforge:region plan-01-platform-contracts ---
export async function apiGetExtensionContributionManifest(opts: { cwd: string }): Promise<ExtensionContributionManifestResponse> {
  const { data } = await daemonRequest<unknown>(opts.cwd, 'GET', API_ROUTES.extensionContributionManifest);
  return parseExtensionContributionManifest(data);
}

export async function apiGetExtensionContributionManifestIfRunning(opts: { cwd: string }): Promise<ExtensionContributionManifestResponse | null> {
  const result = await daemonRequestIfRunning<unknown>(opts.cwd, 'GET', API_ROUTES.extensionContributionManifest);
  return result ? parseExtensionContributionManifest(result.data) : null;
}

export async function apiInvokeExtensionAction(opts: {
  cwd: string;
  body: ExtensionActionInvokeRequest;
}): Promise<ExtensionActionInvokeResponse> {
  const { data } = await daemonRequestWithStatus<unknown>(
    opts.cwd,
    'POST',
    API_ROUTES.extensionActionInvoke,
    opts.body,
  );
  return parseExtensionActionInvokeResponse(data);
}

export async function apiInvokeExtensionActionIfRunning(opts: {
  cwd: string;
  body: ExtensionActionInvokeRequest;
}): Promise<ExtensionActionInvokeResponse | null> {
  const result = await daemonRequestWithStatusIfRunning<unknown>(
    opts.cwd,
    'POST',
    API_ROUTES.extensionActionInvoke,
    opts.body,
  );
  return result ? parseExtensionActionInvokeResponse(result.data) : null;
}
// --- eforge:endregion plan-01-platform-contracts ---
