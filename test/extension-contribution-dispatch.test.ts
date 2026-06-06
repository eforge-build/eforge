import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API_ROUTES,
  DAEMON_API_VERSION,
  EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
  EXTENSION_HOST_CONTRIBUTION_KINDS,
  clearApiVersionCache,
  invokeEforgeExtensionContribution,
  invokeEforgeExtensionContributionIfRunning,
  listEforgeExtensionContributions,
  listEforgeExtensionContributionsIfRunning,
  resolveExtensionContributionInvocation,
  summarizeExtensionContributionManifest,
  writeLockfile,
  type ExtensionContributionManifestResponse,
} from '@eforge-build/client';
import { readRepoFile } from './extension-tooling-wiring-helpers.js';

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

const objectSchema = { type: 'object', properties: {}, additionalProperties: true } as const;
const boundActionSchema = { type: 'object', properties: { fromAction: { type: 'string' } }, required: ['fromAction'], additionalProperties: false } as const;
const commandSpecificSchema = { type: 'object', properties: { fromCommand: { type: 'number' } }, required: ['fromCommand'], additionalProperties: false } as const;

function manifest(): ExtensionContributionManifestResponse {
  return {
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
    generatedAt: '2026-06-03T00:00:00.000Z',
    actions: [
      {
        id: 'ext.run',
        localId: 'run',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        title: 'Run action',
        description: 'Runs the extension action',
        inputSchema: boundActionSchema,
        sideEffects: ['daemon-state'],
      },
      {
        id: 'shared',
        localId: 'shared-action',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        title: 'Shared action',
        inputSchema: objectSchema,
      },
    ],
    consoleContributions: [
      {
        id: 'ext.console',
        localId: 'console',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        title: 'Console only',
        schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
        blocks: [{ rendererId: 'text', content: 'not a host invocation target' }],
      },
    ],
    consoleWorkstations: [],
    integrationCommands: [
      {
        id: 'ext.command',
        localId: 'command',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        label: 'Run command',
        description: 'Runs through a command binding',
        inputSchema: commandSpecificSchema,
        action: { actionId: 'ext.run', inputDefaults: { fromDefault: true, override: 'default' } },
      },
      {
        id: 'shared',
        localId: 'shared-command',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        label: 'Shared command',
        action: { actionId: 'ext.run' },
      },
    ],
    deepLinks: [
      {
        id: 'ext.deep',
        localId: 'deep',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        label: 'Open deep link',
        description: 'Runs through a deep-link binding',
        action: { actionId: 'ext.run', inputDefaults: { source: 'deep-link', override: 'default' } },
      },
      {
        id: 'ext.url',
        localId: 'url',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        label: 'External URL',
        urlTemplate: 'https://example.invalid/{id}',
      },
      {
        id: 'shared',
        localId: 'shared-deep',
        extensionName: 'example-extension',
        extensionPath: '/extensions/example',
        label: 'Shared deep link',
        action: { actionId: 'ext.run' },
      },
    ],
    diagnostics: [{ severity: 'warning', message: 'example diagnostic', code: 'example' }],
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function startServer(response: { ok: true; invocationId: string; output: unknown } | { ok: false; invocationId: string; error: { code: 'invalid-input'; message: string } }) {
  const requests: RecordedRequest[] = [];
  const contributionManifest = manifest();
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';
    requests.push({ method, url, body });

    if (url === API_ROUTES.health) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (url === API_ROUTES.version) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: DAEMON_API_VERSION }));
      return;
    }
    if (url === API_ROUTES.extensionContributionManifest) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(contributionManifest));
      return;
    }
    if (url === API_ROUTES.extensionActionInvoke) {
      res.writeHead(response.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server port');
  return { server, port: address.port, requests, manifest: contributionManifest };
}

let tmpDir: string;
let serverState: Awaited<ReturnType<typeof startServer>> | undefined;

beforeEach(async () => {
  clearApiVersionCache();
  tmpDir = await mkdtemp(join(tmpdir(), 'eforge-host-contributions-'));
});

afterEach(async () => {
  clearApiVersionCache();
  if (serverState) {
    await new Promise<void>((resolve, reject) => serverState!.server.close((err) => err ? reject(err) : resolve()));
    serverState = undefined;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe('extension contribution host dispatcher projection', () => {
  it('declares action, command, and deep-link as host contribution kinds', () => {
    expect(EXTENSION_HOST_CONTRIBUTION_KINDS).toEqual(['action', 'command', 'deep-link']);
  });

  it('summarizes actions, integration commands, and deep links while excluding console contributions', () => {
    const summary = summarizeExtensionContributionManifest(manifest());

    expect(summary.generatedAt).toBe('2026-06-03T00:00:00.000Z');
    expect(summary.diagnostics).toEqual([{ severity: 'warning', message: 'example diagnostic', code: 'example' }]);
    expect(summary.entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'action:ext.run',
      'action:shared',
      'command:ext.command',
      'command:shared',
      'deep-link:ext.deep',
      'deep-link:ext.url',
      'deep-link:shared',
    ]);
    expect(summary.entries.some((entry) => entry.id === 'ext.console')).toBe(false);
    expect(summary.entries.find((entry) => entry.id === 'ext.url')).toMatchObject({ kind: 'deep-link', actionBacked: false, urlTemplate: 'https://example.invalid/{id}' });
    expect(summary.entries.find((entry) => entry.id === 'ext.command')).toMatchObject({
      kind: 'command',
      actionId: 'ext.run',
      actionBacked: true,
      inputDefaults: { fromDefault: true, override: 'default' },
    });
  });

  it('projects bound action schemas for action-backed host entries and preserves command-specific precedence', () => {
    const summary = summarizeExtensionContributionManifest(manifest());

    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.deep')?.inputSchema).toEqual(boundActionSchema);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'shared')?.inputSchema).toEqual(boundActionSchema);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command')?.inputSchema).toEqual(commandSpecificSchema);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command')?.inputDefaults).toEqual({ fromDefault: true, override: 'default' });
    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.url')?.inputSchema).toBeUndefined();
  });

  it('filters summary entries by requested kind', () => {
    const summary = summarizeExtensionContributionManifest(manifest(), { kind: 'deep-link' });
    expect(summary.entries.map((entry) => entry.kind)).toEqual(['deep-link', 'deep-link', 'deep-link']);
  });
});

describe('extension contribution host dispatcher invocation', () => {
  it('direct action invocation posts the effective action id and caller input', async () => {
    serverState = await startServer({ ok: true, invocationId: 'invoke-action', output: { done: true } });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    const result = await invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'action',
      id: 'ext.run',
      input: { value: 1 },
      requestedBy: { host: 'cli' },
    });

    expect(result).toMatchObject({ target: { kind: 'action', id: 'ext.run', actionId: 'ext.run' }, response: { ok: true, invocationId: 'invoke-action' } });
    const invokeRequest = serverState.requests.find((request) => request.url === API_ROUTES.extensionActionInvoke);
    expect(invokeRequest?.method).toBe('POST');
    expect(JSON.parse(invokeRequest?.body ?? '{}')).toEqual({ actionId: 'ext.run', input: { value: 1 }, requestedBy: { host: 'cli' } });
  });

  it('command invocation resolves action binding, merges defaults, and records command provenance', async () => {
    serverState = await startServer({ ok: true, invocationId: 'invoke-command', output: null });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    await invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'command',
      id: 'ext.command',
      input: { override: 'caller', callerOnly: 2 },
      requestedBy: { host: 'mcp' },
    });

    const invokeRequest = serverState.requests.find((request) => request.url === API_ROUTES.extensionActionInvoke);
    expect(JSON.parse(invokeRequest?.body ?? '{}')).toEqual({
      actionId: 'ext.run',
      input: { fromDefault: true, override: 'caller', callerOnly: 2 },
      requestedBy: { host: 'mcp', commandId: 'ext.command' },
    });
  });

  it('deep-link invocation resolves action binding, merges defaults, and records deep-link provenance', async () => {
    serverState = await startServer({ ok: true, invocationId: 'invoke-deep', output: 'ok' });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    await invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'deep-link',
      id: 'ext.deep',
      input: { override: 'caller' },
      requestedBy: { host: 'pi' },
    });

    const invokeRequest = serverState.requests.find((request) => request.url === API_ROUTES.extensionActionInvoke);
    expect(JSON.parse(invokeRequest?.body ?? '{}')).toEqual({
      actionId: 'ext.run',
      input: { source: 'deep-link', override: 'caller' },
      requestedBy: { host: 'pi', deepLinkId: 'ext.deep' },
    });
  });

  it('returns typed daemon action failures as data instead of throwing', async () => {
    serverState = await startServer({ ok: false, invocationId: 'invoke-failed', error: { code: 'invalid-input', message: 'Bad input' } });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    await expect(invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'action',
      id: 'ext.run',
      input: {},
      requestedBy: { host: 'cli' },
    })).resolves.toMatchObject({ response: { ok: false, invocationId: 'invoke-failed', error: { code: 'invalid-input' } } });
  });

  it('lists and invokes through IfRunning helpers without starting a daemon', async () => {
    await expect(listEforgeExtensionContributionsIfRunning({ cwd: tmpDir })).resolves.toBeNull();
    await expect(invokeEforgeExtensionContributionIfRunning({ cwd: tmpDir, id: 'ext.run', input: {}, requestedBy: { host: 'pi' } })).resolves.toBeNull();
  });

  it('routes list through the platform contribution manifest helper', async () => {
    serverState = await startServer({ ok: true, invocationId: 'unused', output: null });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    const result = await listEforgeExtensionContributions({ cwd: tmpDir, kind: 'command' });

    expect(result.entries.map((entry) => entry.kind)).toEqual(['command', 'command']);
    expect(serverState.requests.some((request) => request.method === 'GET' && request.url === API_ROUTES.extensionContributionManifest)).toBe(true);
  });
});

describe('extension contribution local resolution errors', () => {
  it('rejects missing ids, non-object input, unknown ids, ambiguous ids, and URL-only deep links before invocation', () => {
    const contributionManifest = manifest();
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { id: '', input: {}, requestedBy: { host: 'cli' } })).toThrow('"id" is required when action is "invoke"');
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { id: '   ', input: {}, requestedBy: { host: 'cli' } })).toThrow('"id" is required when action is "invoke"');
    for (const input of [null, [], 'text', 1, true]) {
      expect(() => resolveExtensionContributionInvocation(contributionManifest, { kind: 'action', id: 'ext.run', input, requestedBy: { host: 'cli' } })).toThrow('"input" must be a JSON object');
    }
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { kind: 'action', id: 'missing', input: {}, requestedBy: { host: 'cli' } })).toThrow('Unknown extension action "missing"');
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { kind: 'command', id: 'missing', input: {}, requestedBy: { host: 'cli' } })).toThrow('Unknown extension integration command "missing"');
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { kind: 'deep-link', id: 'missing', input: {}, requestedBy: { host: 'cli' } })).toThrow('Unknown extension deep link "missing"');
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { id: 'shared', input: {}, requestedBy: { host: 'cli' } })).toThrow('Ambiguous extension contribution id "shared"; pass kind action, command, or deep-link');
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { kind: 'deep-link', id: 'ext.url', input: {}, requestedBy: { host: 'cli' } })).toThrow('Deep link "ext.url" is not action-backed');
  });

  it('does not import extension-management dispatch or inline daemon routes', () => {
    const source = readRepoFile('packages/client/src/api/extension-contribution-dispatch.ts');
    expect(source).not.toContain('/api/');
    expect(source).not.toContain('dispatchEforgeExtensionAction');
    expect(source).not.toContain('./extension-tool-dispatch.js');
    expect(source).not.toContain('daemonRequest');
  });
});
