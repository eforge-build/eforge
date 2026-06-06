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
    actions: [],
    consoleContributions: [],
    consoleWorkstations: [],
    integrationCommands: [],
    deepLinks: [],
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

  it('throws action HTTP status and body on untyped non-2xx responses', async () => {
    serverState = await startServer({ untypedInvokeResponse: true });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    await expect(apiInvokeExtensionActionIfRunning({
      cwd: tmpDir,
      body: { actionId: 'example.action', input: {}, requestedBy: { host: 'cli' } },
    })).rejects.toThrow('Failed to invoke extension action: HTTP 404 Not found');
  });
});
