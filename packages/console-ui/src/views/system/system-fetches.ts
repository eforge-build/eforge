/**
 * Typed fetch functions for all System view surfaces.
 * All paths are built from API_ROUTES and URLSearchParams — no /api/ literals.
 */
import { API_ROUTES } from '@eforge-build/client/browser';
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
  PlaybookListResponse,
  SessionPlanListResponse,
  ModelProvidersResponse,
  ModelListResponse,
} from '@eforge-build/client/browser';
import type { SystemModelHarness } from './system-types';

/** Ordered harness list for model catalog fetches. */
export const SYSTEM_MODEL_HARNESSES = ['pi', 'claude-sdk'] as const satisfies readonly SystemModelHarness[];

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

export async function fetchSystemPlaybookList(signal?: AbortSignal): Promise<PlaybookListResponse> {
  const data = await fetchJson<PlaybookListResponse>(API_ROUTES.playbookList, { signal });
  return data!;
}

export async function fetchSystemSessionPlanList(signal?: AbortSignal): Promise<SessionPlanListResponse> {
  const data = await fetchJson<SessionPlanListResponse>(API_ROUTES.sessionPlanList, { signal });
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
