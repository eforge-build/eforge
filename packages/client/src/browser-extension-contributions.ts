import { API_ROUTES } from './routes.js';
import {
  parseExtensionActionInvokeResponse,
  parseExtensionContributionManifest,
  type ExtensionActionInvokeRequest,
  type ExtensionActionInvokeResponse,
  type ExtensionContributionManifestResponse,
} from './extension-contributions.js';

// --- eforge:region plan-01-platform-contracts ---
export async function fetchExtensionContributionManifest(init?: RequestInit): Promise<ExtensionContributionManifestResponse> {
  const res = await fetch(API_ROUTES.extensionContributionManifest, { ...init, method: 'GET' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to fetch extension contribution manifest: HTTP ${res.status} ${body}`);
  }
  const json = await res.json() as unknown;
  return parseExtensionContributionManifest(json);
}

export async function invokeExtensionAction(
  body: ExtensionActionInvokeRequest,
  init?: RequestInit,
): Promise<ExtensionActionInvokeResponse> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(API_ROUTES.extensionActionInvoke, {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json() as unknown;
  return parseExtensionActionInvokeResponse(json);
}
// --- eforge:endregion plan-01-platform-contracts ---
