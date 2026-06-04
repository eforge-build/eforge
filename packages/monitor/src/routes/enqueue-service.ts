import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { MonitorContext } from '../context.js';
import { HttpRouteError } from '../http/route-errors.js';
import { isWithinDir } from './control-validation.js';

const VALID_LANDING_ACTIONS = ['pr', 'merge', 'leave'] as const;
type LandingActionValue = (typeof VALID_LANDING_ACTIONS)[number];

export interface PreparedEnqueueRequest {
  source: string;
  args: string[];
}

export async function prepareEnqueueRequest(context: MonitorContext, body: Record<string, unknown>): Promise<PreparedEnqueueRequest> {
  if (!body.source || typeof body.source !== 'string') throw new HttpRouteError(400, 'Missing required field: source');
  if (body.onSuccess !== undefined) throw new HttpRouteError(400, 'Field "onSuccess" is no longer supported. Use "landingAction: pr|merge|leave" instead.');

  const explicitLandingAction = validateLandingAction(body.landingAction);
  const explicitLandingAutoMerge = await validateLandingAutoMerge(context, body.landingAutoMerge, explicitLandingAction);
  const validatedAfterQueueId = await validateAfterQueueId(context, body.afterQueueId);
  const explicitProfileName = await validateExplicitProfile(context, body.profile);
  const inheritedAgentProfile = await discoverInheritedAgentProfile(context, body.source);
  if (explicitProfileName === undefined && inheritedAgentProfile) await validateProfile(context, inheritedAgentProfile, `Inherited agent profile '${inheritedAgentProfile}' not found`);

  const args = [body.source, ...(Array.isArray(body.flags) ? body.flags.filter((flag): flag is string => typeof flag === 'string') : [])];
  const effectiveProfile = explicitProfileName ?? inheritedAgentProfile;
  if (effectiveProfile) args.push('--profile', effectiveProfile);
  if (explicitLandingAction) args.push('--landing-action', explicitLandingAction);
  if (explicitLandingAutoMerge === true) args.push('--landing-auto-merge');
  else if (explicitLandingAutoMerge === false) args.push('--no-landing-auto-merge');
  if (validatedAfterQueueId) args.push('--after', validatedAfterQueueId);
  return { source: body.source, args };
}

function validateLandingAction(value: unknown): LandingActionValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(VALID_LANDING_ACTIONS as readonly string[]).includes(value)) {
    throw new HttpRouteError(400, `Invalid field: landingAction must be one of: ${VALID_LANDING_ACTIONS.join(', ')}`);
  }
  return value as LandingActionValue;
}

async function validateLandingAutoMerge(context: MonitorContext, value: unknown, explicitLandingAction: LandingActionValue | undefined): Promise<boolean | undefined> {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new HttpRouteError(400, 'Invalid field: landingAutoMerge must be a boolean');
  if (value !== true) return value;
  if (context.cwd) {
    try {
      const { loadConfig } = await import('@eforge-build/engine/config');
      const { config } = await loadConfig(context.cwd);
      const cfg = config as unknown as { landing?: { action?: string; pr?: { autoMerge?: string } } };
      const effective = explicitLandingAction ?? cfg.landing?.action ?? 'merge';
      if (effective !== 'pr') throw new HttpRouteError(400, `Invalid field: landingAutoMerge can only be true when the effective landing action is 'pr' (got '${effective}')`);
      if (cfg.landing?.pr?.autoMerge === 'never') throw new HttpRouteError(400, "landingAutoMerge: true is not allowed when landing.pr.autoMerge is 'never' in project config");
    } catch (err) {
      if (err instanceof HttpRouteError) throw err;
      throw new HttpRouteError(500, `Failed to load project config: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (explicitLandingAction !== undefined && explicitLandingAction !== 'pr') {
    throw new HttpRouteError(400, `Invalid field: landingAutoMerge can only be true when landingAction is 'pr' (got '${explicitLandingAction}')`);
  }
  return value;
}

async function validateAfterQueueId(context: MonitorContext, value: unknown): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpRouteError(400, 'Invalid field: afterQueueId must be a string');
  if (context.cwd) {
    let classifyFn: typeof import('@eforge-build/engine/prd-queue').classifyAfterQueueId;
    let queueDir: string;
    try {
      const [prdQueueModule, configModule] = await Promise.all([import('@eforge-build/engine/prd-queue'), import('@eforge-build/engine/config')]);
      classifyFn = prdQueueModule.classifyAfterQueueId;
      const { config } = await configModule.loadConfig(context.cwd);
      queueDir = config.prdQueue.dir;
    } catch (err) {
      throw new HttpRouteError(500, `Server error loading dependencies: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await classifyFn(value, queueDir, context.cwd);
    } catch (err) {
      throw new HttpRouteError(400, err instanceof Error ? err.message : `Invalid afterQueueId: ${value}`);
    }
  }
  return value;
}

async function validateExplicitProfile(context: MonitorContext, value: unknown): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) throw new HttpRouteError(400, 'Invalid field: profile must be a non-empty string');
  await validateProfile(context, value, `Profile '${value}' not found`);
  return value;
}

async function validateProfile(context: MonitorContext, name: string, missingMessage: string): Promise<void> {
  const { getConfigDir, getConventionalConfigDir, loadProfile } = await import('@eforge-build/engine/config');
  const configDir = (await getConfigDir(context.cwd)) ?? getConventionalConfigDir(context.cwd);
  const profileResult = await loadProfile(configDir, name, context.cwd);
  if (!profileResult) throw new HttpRouteError(400, missingMessage);
}

async function discoverInheritedAgentProfile(context: MonitorContext, source: string): Promise<string | undefined> {
  if (!context.cwd) return undefined;
  const resolvedSourcePath = resolve(context.cwd, source);
  let rawSourceContent: string;
  try {
    const sourceFileStat = await stat(resolvedSourcePath);
    if (!sourceFileStat.isFile()) return undefined;
    rawSourceContent = await readFile(resolvedSourcePath, 'utf-8');
  } catch { return undefined; }
  try {
    const { createSessionPlanningWorkflowAdapter } = await import('@eforge-build/input');
    return createSessionPlanningWorkflowAdapter().flat.normalizeBuildSource({ sourcePath: resolvedSourcePath, content: rawSourceContent }).agentProfile;
  } catch (err) {
    throw new HttpRouteError(400, err instanceof Error ? err.message : 'Failed to parse source');
  }
}

export async function markSessionPlanSubmittedAfterEnqueue(context: MonitorContext, source: string, eforgeSessionId: string): Promise<void> {
  const cwd = context.cwd;
  if (!cwd) return;
  const { createSessionPlanningWorkflowAdapter } = await import('@eforge-build/input');
  const adapter = createSessionPlanningWorkflowAdapter();
  const storageRoot = adapter.flat.resolveStorageRoot(cwd);
  const absSource = resolve(cwd, source);
  if (!isWithinDir(absSource, storageRoot) || dirname(absSource) !== storageRoot || !absSource.endsWith('.md')) return;
  const sessionId = basename(absSource, '.md');
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sessionId)) return;
  const adapterPath = adapter.flat.resolvePath({ cwd, session: sessionId });
  if (adapterPath !== absSource) return;
  try {
    const sourceFileStat = await stat(adapterPath);
    if (!sourceFileStat.isFile()) return;
  } catch { return; }
  try {
    await adapter.flat.setStatus({ cwd, session: sessionId, status: 'submitted', eforge_session: eforgeSessionId });
  } catch (err) {
    process.stderr.write(`[eforge] Failed to auto-submit session plan: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
