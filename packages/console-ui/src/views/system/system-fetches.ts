/**
 * Typed fetch functions for all System view surfaces.
 * All paths are built from API_ROUTES and URLSearchParams — no raw daemon route literals.
 */
import { API_ROUTES, fetchExtensionContributionManifest } from '@eforge-build/client/browser';
import { fetchJson } from '@/lib/fetch-json';
import type {
  HealthResponse,
  VersionResponse,
  ProjectContext,
  ConfigShowVerboseResponse,
  ConfigValidateResponse,
  ProfileListResponse,
  ProfileShowResponse,
  ExtensionListResponse,
  ExtensionValidateResponse,
  ExtensionContributionManifestResponse,
  PlaybookListResponse,
  ModelProvidersResponse,
  ModelListResponse,
  ExtensionTrustResponse,
  ExtensionUntrustResponse,
  ExtensionPromoteResponse,
  ExtensionDemoteResponse,
  ExtensionReloadResponse,
} from '@eforge-build/client/browser';
import type { SystemModelHarness } from './system-types';

/** Ordered harness list for model catalog fetches. */
export const SYSTEM_MODEL_HARNESSES = ['pi', 'claude-sdk'] as const satisfies readonly SystemModelHarness[];

/** Stable provenance annotation sent with Console-driven trust mutations. */
export const CONSOLE_EXTENSION_TRUSTED_BY = 'console-ui';

/**
 * Exactly-one-of target identifier for a selected extension mutation/validation.
 * Callers must supply precisely one of `name` or `path` so duplicate extension
 * names cannot select the wrong extension.
 */
export type SystemExtensionTarget =
  | { path: string; name?: never }
  | { name: string; path?: never };

/**
 * POST a JSON body to a daemon extension route and return the typed response.
 * On a non-2xx response the daemon `{ error }` body is surfaced verbatim as the
 * thrown Error message; non-JSON bodies fall back to a status-derived message.
 * Shared by every Console-driven extension mutation so daemon messages reach the
 * UI unchanged.
 */
async function postExtensionMutation<T>(
  route: string,
  body: unknown,
  verb: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status} ${res.statusText} ${verb}`;
    try {
      const errBody = (await res.json()) as { error?: unknown };
      if (errBody && typeof errBody.error === 'string' && errBody.error.length > 0) {
        message = errBody.error;
      }
    } catch {
      // Non-JSON error body — fall back to the status-derived message.
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/**
 * Trust a project-team extension by path. POSTs `{ path, trustedBy }` to the
 * daemon trust route and returns the typed trust response.
 */
export async function trustSystemExtension(
  path: string,
  signal?: AbortSignal,
): Promise<ExtensionTrustResponse> {
  return postExtensionMutation<ExtensionTrustResponse>(
    API_ROUTES.extensionTrust,
    { path, trustedBy: CONSOLE_EXTENSION_TRUSTED_BY },
    'trusting extension',
    signal,
  );
}

/**
 * Untrust a project-team extension by path. POSTs `{ path }` to the daemon
 * untrust route and returns the typed trust response.
 */
export async function untrustSystemExtension(
  path: string,
  signal?: AbortSignal,
): Promise<ExtensionUntrustResponse> {
  return postExtensionMutation<ExtensionUntrustResponse>(
    API_ROUTES.extensionUntrust,
    { path },
    'untrusting extension',
    signal,
  );
}

/**
 * Promote a project-local extension to project-team scope in the default
 * no-force/no-trust mode. POSTs `{ path }` to the daemon promote route.
 */
export async function promoteSystemExtension(
  path: string,
  signal?: AbortSignal,
): Promise<ExtensionPromoteResponse> {
  return postExtensionMutation<ExtensionPromoteResponse>(
    API_ROUTES.extensionPromote,
    { path },
    'promoting extension',
    signal,
  );
}

/**
 * Demote a project-team extension to project-local scope in the default
 * no-force mode. POSTs `{ path }` to the daemon demote route.
 */
export async function demoteSystemExtension(
  path: string,
  signal?: AbortSignal,
): Promise<ExtensionDemoteResponse> {
  return postExtensionMutation<ExtensionDemoteResponse>(
    API_ROUTES.extensionDemote,
    { path },
    'demoting extension',
    signal,
  );
}

/**
 * Reload extension discovery and restart the runtime watcher. POSTs a JSON `{}`
 * body to the daemon reload route for parity with the Node client helper and
 * returns the typed reload response (extension list plus watcher metadata).
 */
export async function reloadSystemExtensions(
  signal?: AbortSignal,
): Promise<ExtensionReloadResponse> {
  return postExtensionMutation<ExtensionReloadResponse>(
    API_ROUTES.extensionReload,
    {},
    'reloading extensions',
    signal,
  );
}

/**
 * Validate a single selected extension. Builds the validate route with exactly
 * one `name` or `path` query parameter and issues a GET with no request body.
 */
export async function validateSelectedSystemExtension(
  target: SystemExtensionTarget,
  signal?: AbortSignal,
): Promise<ExtensionValidateResponse> {
  const path = typeof target.path === 'string' ? target.path.trim() : '';
  const name = typeof target.name === 'string' ? target.name.trim() : '';
  // Reject missing, both-present, or blank identifiers so a malformed target can
  // never build `/api/extensions/validate?` and fall through to global
  // validation or daemon fallback behavior.
  if ((path.length > 0) === (name.length > 0)) {
    throw new Error(
      'validateSelectedSystemExtension requires exactly one non-empty target identifier (path or name).',
    );
  }
  const params = new URLSearchParams();
  if (path.length > 0) {
    params.set('path', path);
  } else {
    params.set('name', name);
  }
  const url = `${API_ROUTES.extensionValidate}?${params.toString()}`;
  const data = await fetchJson<ExtensionValidateResponse>(url, { signal });
  return data!;
}

export async function fetchSystemHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const data = await fetchJson<HealthResponse>(API_ROUTES.health, { signal });
  return data!;
}

export async function fetchSystemVersion(signal?: AbortSignal): Promise<VersionResponse> {
  const data = await fetchJson<VersionResponse>(API_ROUTES.version, { signal });
  return data!;
}

export async function fetchSystemProjectContext(signal?: AbortSignal): Promise<ProjectContext> {
  const data = await fetchJson<ProjectContext>(API_ROUTES.projectContext, { signal });
  return data!;
}

export async function fetchSystemConfigShow(signal?: AbortSignal): Promise<ConfigShowVerboseResponse> {
  const url = `${API_ROUTES.configShow}?${new URLSearchParams({ verbose: 'true' }).toString()}`;
  const data = await fetchJson<ConfigShowVerboseResponse>(url, { signal });
  return data!;
}

export async function fetchSystemConfigValidate(signal?: AbortSignal): Promise<ConfigValidateResponse> {
  const data = await fetchJson<ConfigValidateResponse>(API_ROUTES.configValidate, { signal });
  return data!;
}

export async function fetchSystemProfileList(signal?: AbortSignal): Promise<ProfileListResponse> {
  const data = await fetchJson<ProfileListResponse>(API_ROUTES.profileList, { signal });
  return data!;
}

export async function fetchSystemProfileShow(signal?: AbortSignal): Promise<ProfileShowResponse> {
  const data = await fetchJson<ProfileShowResponse>(API_ROUTES.profileShow, { signal });
  return data!;
}

export async function fetchSystemExtensionList(signal?: AbortSignal): Promise<ExtensionListResponse> {
  const data = await fetchJson<ExtensionListResponse>(API_ROUTES.extensionList, { signal });
  return data!;
}

export async function fetchSystemExtensionValidate(signal?: AbortSignal): Promise<ExtensionValidateResponse> {
  const data = await fetchJson<ExtensionValidateResponse>(API_ROUTES.extensionValidate, { signal });
  return data!;
}

export async function fetchSystemExtensionContributionManifest(signal?: AbortSignal): Promise<ExtensionContributionManifestResponse> {
  return fetchExtensionContributionManifest({ signal });
}

export async function fetchSystemPlaybookList(signal?: AbortSignal): Promise<PlaybookListResponse> {
  const data = await fetchJson<PlaybookListResponse>(API_ROUTES.playbookList, { signal });
  return data!;
}

export async function fetchSystemModelProviders(
  harness: SystemModelHarness,
  signal?: AbortSignal,
): Promise<ModelProvidersResponse> {
  const url = `${API_ROUTES.modelProviders}?${new URLSearchParams({ harness }).toString()}`;
  const data = await fetchJson<ModelProvidersResponse>(url, { signal });
  return data!;
}

export async function fetchSystemModelList(
  harness: SystemModelHarness,
  signal?: AbortSignal,
): Promise<ModelListResponse> {
  const url = `${API_ROUTES.modelList}?${new URLSearchParams({ harness }).toString()}`;
  const data = await fetchJson<ModelListResponse>(url, { signal });
  return data!;
}
