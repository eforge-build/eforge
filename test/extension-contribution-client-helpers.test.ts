import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  API_ROUTES,
  DAEMON_API_VERSION,
  EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
  apiGetExtensionContributionManifest,
  apiGetExtensionContributionManifestIfRunning,
  apiInvokeExtensionAction,
  apiInvokeExtensionActionIfRunning,
  summarizeExtensionContributionManifest,
  resolveExtensionContributionInvocation,
  clearApiVersionCache,
  writeLockfile,
} from '@eforge-build/client';

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function startServer(opts: { untypedInvokeResponse?: boolean } = {}) {
  const requests: RecordedRequest[] = [];
  const manifest = {
    schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
    generatedAt: '2026-06-03T00:00:00.000Z',
    actions: [{
      id: 'eforge-plan:open-planning-entry',
      localId: 'open-planning-entry',
      extensionName: 'eforge-plan',
      extensionPath: '/extensions/eforge-plan',
      title: 'Open eforge-plan planning entry',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      sideEffects: ['none'],
    }],
    consoleContributions: [],
    consoleWorkstations: [{
      id: 'eforge-plan:planning-workstation',
      localId: 'planning-workstation',
      extensionName: 'eforge-plan',
      extensionPath: '/extensions/eforge-plan',
      title: 'eforge-plan planning workstation',
      schemaVersion: EXTENSION_CONTRIBUTION_MANIFEST_SCHEMA_VERSION,
      frameBundle: { browserSdkVersion: 1, frameUrl: '/api/extensions/workstations/eforge-plan%3Aplanning-workstation/frame', entrypoint: { id: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', url: '/api/extensions/workstations/eforge-plan%3Aplanning-workstation/assets/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', relativePath: 'index.js', sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, styles: [], assets: [] },
      allowedActions: ['eforge-plan:open-planning-entry'],
    }],
    integrationCommands: [{
      id: 'eforge-plan:open-planning-entry',
      localId: 'open-planning-entry',
      extensionName: 'eforge-plan',
      extensionPath: '/extensions/eforge-plan',
      label: 'Open eforge-plan planning entry',
      action: { actionId: 'eforge-plan:open-planning-entry' },
    }],
    deepLinks: [{
      id: 'eforge-plan:planning-workstation',
      localId: 'planning-workstation',
      extensionName: 'eforge-plan',
      extensionPath: '/extensions/eforge-plan',
      label: 'Open eforge-plan planning workstation',
      urlTemplate: '/console/workstations/eforge-plan%3Aplanning-workstation',
      action: { actionId: 'eforge-plan:open-planning-entry' },
    }],
  };
  const invokeResponse = { ok: false as const, invocationId: 'invoke-1', error: { code: 'invalid-input' as const, message: 'Bad input' } };

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
      res.end(JSON.stringify(manifest));
      return;
    }
    if (url === API_ROUTES.extensionActionInvoke) {
      if (opts.untypedInvokeResponse) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(invokeResponse));
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
  if (!address || typeof address === 'string') throw new Error('No port');
  return { server, port: address.port, requests, manifest, invokeResponse };
}

let tmpDir: string;
let serverState: Awaited<ReturnType<typeof startServer>> | undefined;

beforeEach(async () => {
  clearApiVersionCache();
  tmpDir = await mkdtemp(join(tmpdir(), 'eforge-extension-contributions-'));
});

afterEach(async () => {
  clearApiVersionCache();
  if (serverState) {
    await new Promise<void>((resolve, reject) => serverState!.server.close((err) => err ? reject(err) : resolve()));
    serverState = undefined;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe('extension contribution Node client helpers', () => {
  it('IfRunning helpers return null without a daemon lockfile', async () => {
    await expect(apiGetExtensionContributionManifestIfRunning({ cwd: tmpDir })).resolves.toBeNull();
    await expect(apiInvokeExtensionActionIfRunning({
      cwd: tmpDir,
      body: { actionId: 'example.action', input: {}, requestedBy: { host: 'cli' } },
    })).resolves.toBeNull();
  });

  it('routes IfRunning helpers to contribution constants and parses typed non-2xx action responses', async () => {
    serverState = await startServer();
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    await expect(apiGetExtensionContributionManifestIfRunning({ cwd: tmpDir })).resolves.toEqual(serverState.manifest);
    const body = { actionId: 'example.action', input: { value: 1 }, requestedBy: { host: 'cli' as const } };
    await expect(apiInvokeExtensionActionIfRunning({ cwd: tmpDir, body })).resolves.toEqual(serverState.invokeResponse);

    expect(serverState.requests.some((req) => req.method === 'GET' && req.url === API_ROUTES.extensionContributionManifest)).toBe(true);
    const invokeRequest = serverState.requests.find((req) => req.url === API_ROUTES.extensionActionInvoke);
    expect(invokeRequest?.method).toBe('POST');
    expect(invokeRequest?.body).toBe(JSON.stringify(body));
  });

  it('routes auto-starting helpers to contribution constants and parses response bodies', async () => {
    serverState = await startServer();
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    await expect(apiGetExtensionContributionManifest({ cwd: tmpDir })).resolves.toEqual(serverState.manifest);
    const body = { actionId: 'example.action', input: { value: 1 }, requestedBy: { host: 'cli' as const } };
    await expect(apiInvokeExtensionAction({ cwd: tmpDir, body })).resolves.toEqual(serverState.invokeResponse);

    expect(serverState.requests.some((req) => req.method === 'GET' && req.url === API_ROUTES.extensionContributionManifest)).toBe(true);
    const invokeRequest = serverState.requests.find((req) => req.url === API_ROUTES.extensionActionInvoke);
    expect(invokeRequest?.method).toBe('POST');
    expect(invokeRequest?.body).toBe(JSON.stringify(body));
  });

  it('resolves eforge-plan action-backed planning entry contributions', async () => {
    serverState = await startServer();
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    const manifest = await apiGetExtensionContributionManifest({ cwd: tmpDir });
    const summary = summarizeExtensionContributionManifest(manifest);

    expect(summary.diagnosticCount).toBe(0);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'eforge-plan:open-planning-entry')).toMatchObject({
      actionId: 'eforge-plan:open-planning-entry',
      actionBacked: true,
      hasInputSchema: true,
    });
    const planningDeepLink = summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'eforge-plan:planning-workstation');
    expect(planningDeepLink).toMatchObject({
      actionId: 'eforge-plan:open-planning-entry',
      urlTemplate: '/console/workstations/eforge-plan%3Aplanning-workstation',
      actionBacked: true,
    });
    expect(planningDeepLink?.inputSchema).toBeUndefined();
    expect(resolveExtensionContributionInvocation(manifest, { kind: 'command', id: 'eforge-plan:open-planning-entry', input: {}, requestedBy: { host: 'cli' } }).target).toMatchObject({
      actionId: 'eforge-plan:open-planning-entry',
      id: 'eforge-plan:open-planning-entry',
    });
  });

  it('throws action HTTP status and body on untyped non-2xx responses', async () => {
    serverState = await startServer({ untypedInvokeResponse: true });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    await expect(apiInvokeExtensionActionIfRunning({
      cwd: tmpDir,
      body: { actionId: 'example.action', input: {}, requestedBy: { host: 'cli' } },
    })).rejects.toThrow('Failed to invoke extension action: HTTP 404 Not found');
  });
});
