import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  ConfigShowResponse,
  ConfigShowVerboseResponse,
  ConfigValidateResponse,
  HealthResponse,
  ProjectContext,
  VersionResponse,
} from '@eforge-build/client';
import { findConfigFile, getUserConfigPath, loadConfig, validateConfigFile } from '@eforge-build/engine/config';
import type { MonitorContext } from '../context.js';
import { defineRoute, type RouteDefinition } from '../http/router.js';
import { sendJson, sendJsonError } from '../http/response.js';
import { redactGitRemote, redactSensitive } from '../projections/config-redaction.js';

export function createConfigContextRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'projectContext',
      method: 'GET',
      handler: ({ res }) => {
        const body: ProjectContext = { cwd: context.cwd ?? null, gitRemote: redactGitRemote(context.cachedGitRemote) };
        sendJson(res, body);
      },
    }),
    defineRoute({
      routeKey: 'health',
      method: 'GET',
      handler: ({ res }) => {
        const body: HealthResponse = { status: 'ok', pid: context.versionInfo.pid };
        sendJson(res, body);
      },
    }),
    defineRoute({
      routeKey: 'version',
      method: 'GET',
      handler: ({ res }) => {
        const body: VersionResponse = {
          version: context.versionInfo.daemonApiVersion,
          eforgeVersion: context.versionInfo.eforgeVersion,
        };
        sendJson(res, body);
      },
    }),
    defineRoute({
      routeKey: 'configShow',
      method: 'GET',
      handler: async ({ res, query }) => {
        try {
          const verboseVal = query.get('verbose');
          const verbose = verboseVal === '1' || verboseVal === 'true';
          const { config: resolved, warnings } = await loadConfig(context.cwd);
          for (const warning of warnings) process.stderr.write(`${warning}\n`);
          if (verbose) {
            const response: ConfigShowVerboseResponse = await buildVerboseConfigResponse(context.cwd, resolved);
            sendJson(res, response);
            return;
          }
          sendJson(res, redactSensitive(resolved) as ConfigShowResponse);
        } catch (err) {
          sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to load config');
        }
      },
    }),
    defineRoute({
      routeKey: 'configValidate',
      method: 'GET',
      handler: async ({ res }) => {
        try {
          const response: ConfigValidateResponse = await validateConfigFile(context.cwd);
          sendJson(res, response);
        } catch (err) {
          sendJsonError(res, 500, err instanceof Error ? err.message : 'Failed to validate config');
        }
      },
    }),
  ];
}

async function buildVerboseConfigResponse(cwd: string | undefined, resolved: unknown): Promise<ConfigShowVerboseResponse> {
  const effectiveCwd = cwd ?? process.cwd();
  const configPath = await findConfigFile(effectiveCwd);
  const projectRoot = configPath ? dirname(dirname(configPath)) : effectiveCwd;
  const localPath = resolve(projectRoot, '.eforge', 'config.yaml');
  const projectPath = configPath ?? null;
  const userPath = getUserConfigPath();
  const [localExists, projectExists, userExists] = await Promise.all([
    exists(localPath),
    projectPath ? exists(projectPath) : Promise.resolve(false),
    exists(userPath),
  ]);
  return {
    resolved: redactSensitive(resolved) as Record<string, unknown>,
    sources: {
      local: { path: localPath, found: localExists },
      project: { path: projectPath, found: projectExists },
      user: { path: userPath, found: userExists },
    },
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}
