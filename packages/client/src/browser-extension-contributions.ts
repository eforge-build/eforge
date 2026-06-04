import { API_ROUTES } from './routes.js';
import {
  parseExtensionActionInvokeResponse,
  parseExtensionContributionManifest,
  safeParseExtensionActionInvokeResponse,
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
  const text = await res.text();
  const json = parseJsonText(text);
  const parsed = safeParseExtensionActionInvokeResponse(json);
  if (parsed.success) return parsed.data;
  if (!res.ok) {
    throw new Error(`Failed to invoke extension action: HTTP ${res.status} ${text}`);
  }
  return parseExtensionActionInvokeResponse(json);
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
// --- eforge:endregion plan-01-platform-contracts ---
