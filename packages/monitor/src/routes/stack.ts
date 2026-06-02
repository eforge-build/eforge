import type { StackLayersResponse, StackSyncRequest, StackSyncResponse, StackSyncStatusResponse } from '@eforge-build/client';
import { loadConfig } from '@eforge-build/engine/config';
import type { MonitorContext } from '../context.js';
import { isRequestBodyTooLargeError, parseJsonBody } from '../http/request.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { localMutation, localOnly, rejectCrossSiteBrowser } from '../http/security.js';
import { stackLayersToWire } from '../projections/stack-layers.js';
import { loadSyncStatusForRoute, runStackSync } from '../stack-sync-service.js';

type Trigger = NonNullable<StackSyncRequest['trigger']>;
type ActiveBuildPolicy = NonNullable<StackSyncRequest['activeBuildPolicy']>;

export function createStackRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'stackLayers',
      method: 'GET',
      security: [localOnly('Stack reads'), rejectCrossSiteBrowser('Stack reads')],
      handler: ({ res }) => {
        const response: StackLayersResponse = { layers: context.cwd ? stackLayersToWire(context.cwd) : [] };
        sendJson(res, response);
      },
    }),
    defineRoute({
      routeKey: 'stackSync',
      method: 'POST',
      security: [localMutation('Stack sync mutations')],
      handler: async ({ req, res }) => handleStackSync(context, req, res),
    }),
    defineRoute({
      routeKey: 'stackSyncStatus',
      method: 'GET',
      security: [localOnly('Stack reads'), rejectCrossSiteBrowser('Stack reads')],
      handler: async ({ res }) => {
        const syncCwd = context.cwd;
        if (!syncCwd) { sendJson(res, {} satisfies StackSyncStatusResponse); return; }
        try {
          const statusFile = await loadSyncStatusForRoute(syncCwd);
          const response: StackSyncStatusResponse = { last: statusFile.last, current: statusFile.current };
          sendJson(res, response);
        } catch (err) {
          sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to load stack sync status');
        }
      },
    }),
  ];
}

async function handleStackSync(
  context: MonitorContext,
  req: Parameters<typeof parseJsonBody>[0],
  res: Parameters<typeof sendJson>[0],
): Promise<void> {
  const syncCwd = context.cwd;
  if (!syncCwd) { sendJsonError(res, 503, 'Working directory not configured'); return; }
  let rawBody: unknown;
  try {
    rawBody = await parseJsonBody(req);
  } catch (err) {
    sendJsonError(res, isRequestBodyTooLargeError(err) ? 413 : 400, isRequestBodyTooLargeError(err) ? 'Request body too large' : 'Invalid JSON request body');
    return;
  }
  const request = validateStackSyncBody(rawBody, res);
  if (!request) return;
  try {
    const { config } = await loadConfig(syncCwd);
    if (!config.stacking.enabled) {
      const response: StackSyncResponse = {
        outcome: 'skipped',
        reason: 'Stacking is not enabled. Set stacking.enabled: true in eforge/config.yaml to activate.',
        stackingActive: false,
        dryRun: request.dryRun === true,
        restackCandidates: [],
        activeBuildSkips: [],
        providerCommands: [],
      };
      sendJson(res, response);
      return;
    }
    sendJson(res, await runStackSync({ db: context.db, config, cwd: syncCwd, request }));
  } catch (err) {
    sendJsonError(res, 500, err instanceof Error ? err.message : 'Stack sync failed');
  }
}

function validateStackSyncBody(rawBody: unknown, res: Parameters<typeof sendJson>[0]): StackSyncRequest | null {
  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    sendJsonError(res, 400, 'Request body must be a JSON object');
    return null;
  }
  const rawBodyObj = rawBody as Record<string, unknown>;
  const rawDryRun = rawBodyObj.dryRun;
  if (rawDryRun !== undefined && typeof rawDryRun !== 'boolean') {
    sendJsonError(res, 400, 'dryRun must be a boolean when present');
    return null;
  }
  const rawTrigger = rawBodyObj.trigger;
  if (rawTrigger !== undefined && !isTrigger(rawTrigger)) {
    sendJsonError(res, 400, 'trigger must be "manual", "after-build", "scheduled", or "retry-deferred" when present');
    return null;
  }
  const rawActiveBuildPolicy = rawBodyObj.activeBuildPolicy;
  if (rawActiveBuildPolicy !== undefined && !isActiveBuildPolicy(rawActiveBuildPolicy)) {
    sendJsonError(res, 400, 'activeBuildPolicy must be "skip" or "defer" when present');
    return null;
  }
  return {
    dryRun: rawDryRun === true,
    ...(rawTrigger !== undefined && { trigger: rawTrigger }),
    ...(rawActiveBuildPolicy !== undefined && { activeBuildPolicy: rawActiveBuildPolicy }),
  };
}

function isTrigger(value: unknown): value is Trigger {
  return value === 'manual' || value === 'after-build' || value === 'scheduled' || value === 'retry-deferred';
}

function isActiveBuildPolicy(value: unknown): value is ActiveBuildPolicy {
  return value === 'skip' || value === 'defer';
}
