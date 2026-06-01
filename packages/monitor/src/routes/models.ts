import type { ModelListResponse, ModelProvidersResponse } from '@eforge-build/client';
import { listModels, listProviders } from '@eforge-build/engine/models';
import type { MonitorContext } from '../context.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { localOnly, rejectCrossSiteBrowser } from '../http/security.js';

type Harness = 'pi' | 'claude-sdk';
const HARNESS_ERROR = 'Missing or invalid query param: harness (must be "pi" or "claude-sdk")';

export function createModelRoutes(_context: MonitorContext): RouteDefinition[] {
  const readSecurity = [localOnly('Model reads'), rejectCrossSiteBrowser('Model reads')];
  return [
    defineRoute({
      routeKey: 'modelProviders',
      method: 'GET',
      security: readSecurity,
      handler: async ({ res, query }) => {
        const harness = parseHarness(query.get('harness'));
        if (!harness) { sendJsonError(res, 400, HARNESS_ERROR); return; }
        try {
          const response: ModelProvidersResponse = { providers: await listProviders(harness) };
          sendJson(res, response);
        } catch (err) {
          sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to list providers');
        }
      },
    }),
    defineRoute({
      routeKey: 'modelList',
      method: 'GET',
      security: readSecurity,
      handler: async ({ res, query }) => {
        const harness = parseHarness(query.get('harness'));
        if (!harness) { sendJsonError(res, 400, HARNESS_ERROR); return; }
        try {
          const provider = query.get('provider') ?? undefined;
          const response: ModelListResponse = { models: await listModels(harness, provider) };
          sendJson(res, response);
        } catch (err) {
          sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to list models');
        }
      },
    }),
  ];
}

function parseHarness(value: string | null): Harness | undefined {
  return value === 'pi' || value === 'claude-sdk' ? value : undefined;
}
