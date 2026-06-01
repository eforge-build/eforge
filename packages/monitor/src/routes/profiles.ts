import type {
  ProfileCreateRequest,
  ProfileCreateResponse,
  ProfileDeleteResponse,
  ProfileListResponse,
  ProfileShowResponse,
  ProfileUseRequest,
  ProfileUseResponse,
} from '@eforge-build/client';
import {
  createAgentRuntimeProfile,
  deleteAgentRuntimeProfile,
  extractProfileMetadata,
  getConfigDir,
  getConventionalConfigDir,
  listProfiles,
  loadProfile,
  loadUserConfig,
  loadUserProfile,
  resolveActiveProfileName,
  resolveUserActiveProfile,
  setActiveProfile,
  type PartialEforgeConfig,
  type ProfileMetadata,
} from '@eforge-build/engine/config';
import type { MonitorContext } from '../context.js';
import { parseJsonBody } from '../http/request.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { localMutation } from '../http/security.js';
import { redactSensitive } from '../projections/config-redaction.js';
import {
  extractHarnessFromProfile,
  isProfileScope,
  isValidProfileName,
  loadProjectPartialConfig,
  readOptionalProfileDeleteOptions,
  writeWarnings,
} from './profile-helpers.js';

export function createProfileRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({ routeKey: 'profileList', method: 'GET', handler: ({ res, query }) => handleProfileList(context, res, query) }),
    defineRoute({ routeKey: 'profileShow', method: 'GET', handler: ({ res }) => handleProfileShow(context, res) }),
    defineRoute({ routeKey: 'profileUse', method: 'POST', security: [localMutation('Profile mutations')], handler: ({ req, res }) => handleProfileUse(context, req, res) }),
    defineRoute({ routeKey: 'profileCreate', method: 'POST', security: [localMutation('Profile mutations')], handler: ({ req, res }) => handleProfileCreate(context, req, res) }),
    defineRoute({ routeKey: 'profileDelete', method: 'DELETE', security: [localMutation('Profile mutations')], handler: ({ req, res, params }) => handleProfileDelete(context, req, res, params.name) }),
  ];
}

async function handleProfileList(context: MonitorContext, res: Parameters<typeof sendJson>[0], query: URLSearchParams): Promise<void> {
  try {
    const scopeParam = query.get('scope');
    const discoveredConfigDir = await getConfigDir(context.cwd);
    const configDir = discoveredConfigDir ?? getConventionalConfigDir(context.cwd);
    let profiles = await listProfiles(configDir, context.cwd);
    if (isProfileScope(scopeParam)) profiles = profiles.filter((profile) => profile.scope === scopeParam);
    const projectConfig = discoveredConfigDir ? await loadProjectPartialConfig(configDir) : {};
    const userConfig = await loadUserConfig();
    const { name, source, warnings } = await resolveActiveProfileName(
      configDir,
      projectConfig as Parameters<typeof resolveActiveProfileName>[1],
      userConfig as Parameters<typeof resolveActiveProfileName>[2],
      context.cwd,
    );
    writeWarnings(warnings);
    const response: ProfileListResponse = { profiles, active: name, source: source as ProfileListResponse['source'] };
    sendJson(res, response);
  } catch (err) {
    sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to list agent runtime profiles');
  }
}

async function handleProfileShow(context: MonitorContext, res: Parameters<typeof sendJson>[0]): Promise<void> {
  try {
    const configDir = await getConfigDir(context.cwd);
    if (!configDir) {
      const { name, warnings } = await resolveUserActiveProfile();
      writeWarnings(warnings);
      if (name === null) {
        sendJson(res, { active: null, source: 'none', resolved: { harness: undefined, profile: null } } satisfies ProfileShowResponse);
        return;
      }
      const result = await loadUserProfile(name);
      const profile = result ? result.profile : null;
      sendJson(res, {
        active: name,
        source: result ? 'user-local' : 'missing',
        resolved: {
          harness: result ? extractHarnessFromProfile(result.profile) : undefined,
          profile: redactSensitive(profile),
          scope: result ? 'user' : undefined,
          metadata: profile ? extractProfileMetadata(profile) : undefined,
        },
      } satisfies ProfileShowResponse);
      return;
    }
    const projectConfig = await loadProjectPartialConfig(configDir);
    const userConfig = await loadUserConfig();
    const { name, source, warnings } = await resolveActiveProfileName(
      configDir,
      projectConfig as Parameters<typeof resolveActiveProfileName>[1],
      userConfig as Parameters<typeof resolveActiveProfileName>[2],
      context.cwd,
    );
    writeWarnings(warnings);
    let profile: unknown = null;
    let harness: 'claude-sdk' | 'pi' | undefined;
    let scope: 'local' | 'project' | 'user' | undefined;
    let metadata: ProfileMetadata | undefined;
    if (name) {
      const result = await loadProfile(configDir, name, context.cwd);
      if (result) {
        profile = result.profile;
        scope = result.scope;
        harness = extractHarnessFromProfile(result.profile);
        metadata = extractProfileMetadata(result.profile);
      }
    }
    sendJson(res, {
      active: name,
      source: source as ProfileShowResponse['source'],
      resolved: { harness, profile: redactSensitive(profile), scope, metadata },
    } satisfies ProfileShowResponse);
  } catch (err) {
    sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to show agent runtime profile');
  }
}

async function handleProfileUse(context: MonitorContext, req: Parameters<typeof parseJsonBody>[0], res: Parameters<typeof sendJson>[0]): Promise<void> {
  let rawBody: unknown;
  try { rawBody = await parseJsonBody(req); } catch { sendJsonError(res, 400, 'Invalid JSON body'); return; }
  if (rawBody === null || typeof rawBody !== 'object') { sendJsonError(res, 400, 'Invalid JSON body'); return; }
  const body = rawBody as ProfileUseRequest;
  if (!body.name || typeof body.name !== 'string') { sendJsonError(res, 400, 'Missing required field: name (string)'); return; }
  if (!isValidProfileName(body.name)) { sendJsonError(res, 400, 'Invalid agent runtime profile name'); return; }
  const configDir = await getConfigDir(context.cwd);
  if (!configDir) { sendJsonError(res, 404, 'No eforge config directory found'); return; }
  try {
    const scopeVal = isProfileScope(body.scope) ? body.scope : undefined;
    await setActiveProfile(configDir, body.name, scopeVal ? { scope: scopeVal } : undefined, context.cwd);
    const response: ProfileUseResponse = { active: body.name };
    sendJson(res, response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to set active profile';
    sendJsonError(res, /not found/i.test(msg) ? 404 : 400, msg);
  }
}

async function handleProfileCreate(context: MonitorContext, req: Parameters<typeof parseJsonBody>[0], res: Parameters<typeof sendJson>[0]): Promise<void> {
  let rawBody: unknown;
  try { rawBody = await parseJsonBody(req); } catch { sendJsonError(res, 400, 'Invalid JSON body'); return; }
  if (rawBody === null || typeof rawBody !== 'object') { sendJsonError(res, 400, 'Invalid JSON body'); return; }
  const body = rawBody as ProfileCreateRequest;
  if (!body.name || typeof body.name !== 'string') { sendJsonError(res, 400, 'Missing required field: name (string)'); return; }
  const configDir = await getConfigDir(context.cwd);
  if (!configDir) { sendJsonError(res, 404, 'No eforge config directory found'); return; }
  try {
    const result = await createAgentRuntimeProfile(configDir, {
      name: body.name,
      agents: body.agents as PartialEforgeConfig['agents'],
      metadata: body.metadata,
      overwrite: body.overwrite === true,
      scope: isProfileScope(body.scope) ? body.scope : undefined,
    }, context.cwd);
    const response: ProfileCreateResponse = { path: result.path };
    sendJson(res, response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create agent runtime profile';
    sendJsonError(res, /already exists/i.test(msg) ? 409 : 400, msg);
  }
}

async function handleProfileDelete(
  context: MonitorContext,
  req: Parameters<typeof parseJsonBody>[0],
  res: Parameters<typeof sendJson>[0],
  name: string,
): Promise<void> {
  if (!name || !isValidProfileName(name)) { sendJsonError(res, 400, 'Invalid agent runtime profile name'); return; }
  try {
    const { force, scope } = await readOptionalProfileDeleteOptions(req);
    const configDir = await getConfigDir(context.cwd);
    if (!configDir) { sendJsonError(res, 404, 'No eforge config directory found'); return; }
    try {
      await deleteAgentRuntimeProfile(configDir, name, force, scope, context.cwd);
      const response: ProfileDeleteResponse = { deleted: name };
      sendJson(res, response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete agent runtime profile';
      if (/currently active/i.test(msg) || /ambiguous/i.test(msg)) sendJsonError(res, 409, msg);
      else if (/not found/i.test(msg)) sendJsonError(res, 404, msg);
      else sendJsonError(res, 400, msg);
    }
  } catch (err) {
    sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to delete agent runtime profile');
  }
}
