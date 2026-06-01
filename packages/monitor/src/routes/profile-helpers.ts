import type { IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseJsonBody } from '../http/request.js';

export type ProfileScope = 'local' | 'project' | 'user';

export function extractHarnessFromProfile(profile: unknown): 'claude-sdk' | 'pi' | undefined {
  if (!profile || typeof profile !== 'object') return undefined;
  const p = profile as Record<string, unknown>;
  if (p.agentRuntimes && typeof p.agentRuntimes === 'object') {
    const runtimeKey = typeof p.defaultAgentRuntime === 'string' ? p.defaultAgentRuntime : 'main';
    const runtime = (p.agentRuntimes as Record<string, unknown>)[runtimeKey];
    if (runtime && typeof runtime === 'object') {
      const harness = (runtime as Record<string, unknown>).harness;
      if (harness === 'claude-sdk' || harness === 'pi') return harness;
    }
  }
  const backend = p.backend;
  if (backend === 'claude-sdk' || backend === 'pi') return backend;
  return undefined;
}

export async function loadProjectPartialConfig(configDir: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(resolve(configDir, 'config.yaml'), 'utf-8');
    const data = parseYaml(raw);
    if (data && typeof data === 'object') return data as Record<string, unknown>;
  } catch {
    // missing or malformed config falls back to empty partial config
  }
  return {};
}

export function isProfileScope(value: unknown): value is ProfileScope {
  return value === 'local' || value === 'project' || value === 'user';
}

export function isValidProfileName(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

export function writeWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
}

export async function readOptionalProfileDeleteOptions(
  req: IncomingMessage,
): Promise<{ force: boolean; scope: ProfileScope | undefined }> {
  try {
    const body = await parseJsonBody(req) as { force?: unknown; scope?: unknown };
    return { force: body.force === true, scope: isProfileScope(body.scope) ? body.scope : undefined };
  } catch {
    return { force: false, scope: undefined };
  }
}
