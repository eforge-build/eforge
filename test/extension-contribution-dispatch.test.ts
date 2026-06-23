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
  createExtensionContributionFailedInvocationEnvelope,
  invokeEforgeExtensionContribution,
  invokeEforgeExtensionContributionIfRunning,
  listEforgeExtensionContributions,
  listEforgeExtensionContributionsIfRunning,
  resolveExtensionContributionInvocation,
  showExtensionContributionManifestEntry,
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
        outputProfile: 'agent-compact',
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
    expect(summary.diagnostics).toBeUndefined();
    expect(summary.diagnosticCount).toBe(1);
    expect(summary.total).toBe(7);
    expect(summary.returned).toBe(7);
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
      sideEffects: ['daemon-state'],
      outputProfile: 'agent-compact',
      hasInputSchema: true,
      inputDefaultKeys: ['fromDefault', 'override'],
    });
  });

  it('omits full input schemas by default while preserving compact input metadata', () => {
    const summary = summarizeExtensionContributionManifest(manifest());
    const command = summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command');

    expect(command?.inputSchema).toBeUndefined();
    expect(command?.inputDefaults).toBeUndefined();
    expect(command).toMatchObject({
      hasInputSchema: true,
      requiredInputKeys: ['fromCommand'],
      inputPropertyKeys: ['fromCommand'],
      inputDefaultKeys: ['fromDefault', 'override'],
    });
  });

  it('projects bound action schemas for full host entries and preserves command-specific precedence', () => {
    const summary = summarizeExtensionContributionManifest(manifest(), { includeInputSchema: true });

    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.deep')?.inputSchema).toEqual(boundActionSchema);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'shared')?.inputSchema).toEqual(boundActionSchema);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command')?.inputSchema).toEqual(commandSpecificSchema);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command')?.inputDefaults).toEqual({ fromDefault: true, override: 'default' });
    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.url')?.inputSchema).toBeUndefined();
  });

  it('projects output profiles from underlying actions to host summaries', () => {
    const summary = summarizeExtensionContributionManifest(manifest());

    expect(summary.entries.find((entry) => entry.kind === 'action' && entry.id === 'ext.run')?.outputProfile).toBe('agent-compact');
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command')?.outputProfile).toBe('agent-compact');
    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.deep')?.outputProfile).toBe('agent-compact');
    expect(summary.entries.find((entry) => entry.kind === 'action' && entry.id === 'shared')?.outputProfile).toBeUndefined();
    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.url')?.outputProfile).toBeUndefined();
  });

  it('projects bound action unavailability onto command and deep-link host summaries', () => {
    const value = manifest();
    value.actions[0] = { ...value.actions[0], availability: { available: false, message: 'missing capability', diagnostics: [{ code: 'extension:dependency-capability-incompatible', message: 'missing capability', severity: 'warning' }] } };
    const summary = summarizeExtensionContributionManifest(value);

    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command')?.availability).toMatchObject({ available: false, message: 'missing capability' });
    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.deep')?.availability).toMatchObject({ available: false, message: 'missing capability' });
    expect(summary.entries.find((entry) => entry.kind === 'deep-link' && entry.id === 'ext.url')?.availability).toBeUndefined();
  });

  it('filters summary entries by requested kind', () => {
    const summary = summarizeExtensionContributionManifest(manifest(), { kind: 'deep-link' });
    expect(summary.entries.map((entry) => entry.kind)).toEqual(['deep-link', 'deep-link', 'deep-link']);
  });

  it('includes full diagnostics only when requested, including empty diagnostics', () => {
    const compact = summarizeExtensionContributionManifest(manifest());
    const full = summarizeExtensionContributionManifest(manifest(), { includeDiagnostics: true });
    const emptyDiagnostics = manifest();
    emptyDiagnostics.diagnostics = [];

    expect(compact.diagnostics).toBeUndefined();
    expect(compact.diagnosticCount).toBe(1);
    expect(full.diagnostics).toEqual([{ severity: 'warning', message: 'example diagnostic', code: 'example' }]);
    expect(full.diagnosticCount).toBe(1);
    expect(summarizeExtensionContributionManifest(emptyDiagnostics, { includeDiagnostics: true }).diagnostics).toEqual([]);
    expect(showExtensionContributionManifestEntry(emptyDiagnostics, { kind: 'action', id: 'ext.run', includeDiagnostics: true }).diagnostics).toEqual([]);
  });

  it('filters summary entries by extension name, search, id prefix, and output profile', () => {
    const value = manifest();
    value.actions.push({
      id: 'other.run',
      localId: 'run',
      extensionName: 'other-extension',
      extensionPath: '/extensions/other',
      title: 'Other action',
      inputSchema: objectSchema,
      outputProfile: 'debug-rich',
    });

    expect(summarizeExtensionContributionManifest(value, { extensionName: 'other-extension' }).entries.map((entry) => entry.id)).toEqual(['other.run']);
    expect(summarizeExtensionContributionManifest(value, { search: 'open deep' }).entries.map((entry) => entry.id)).toEqual(['ext.deep']);
    expect(summarizeExtensionContributionManifest(value, { idPrefix: 'ext.' }).entries.every((entry) => entry.id.startsWith('ext.'))).toBe(true);
    expect(summarizeExtensionContributionManifest(value, { outputProfile: 'debug-rich' }).entries.map((entry) => entry.id)).toEqual(['other.run']);
  });

  it('rejects invalid projection option values at runtime', () => {
    const contributionManifest = manifest();

    expect(() => summarizeExtensionContributionManifest(contributionManifest, { kind: 'console' } as never)).toThrow('"kind" must be action, command, deep-link, or all');
    expect(() => showExtensionContributionManifestEntry(contributionManifest, { id: 'ext.run', kind: 'all' } as never)).toThrow('"kind" must be action, command, or deep-link');
    expect(() => summarizeExtensionContributionManifest(contributionManifest, { projection: 'tiny' } as never)).toThrow('"projection" must be compact or full');
    expect(() => summarizeExtensionContributionManifest(contributionManifest, { outputProfile: 'raw-html' } as never)).toThrow('"outputProfile" must be agent-compact, agent-paginated, markdown, ui-rich, or debug-rich');
    expect(() => summarizeExtensionContributionManifest(contributionManifest, { includeDiagnostics: 'yes' } as never)).toThrow('"includeDiagnostics" must be a boolean');
    expect(() => summarizeExtensionContributionManifest(contributionManifest, { search: 123 } as never)).toThrow('"search" must be a string');
  });

  it('paginates filtered entries with deterministic continuation metadata', () => {
    const summary = summarizeExtensionContributionManifest(manifest(), { limit: 2, offset: 2 });

    expect(summary.entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual(['command:ext.command', 'command:shared']);
    expect(summary.total).toBe(7);
    expect(summary.returned).toBe(2);
    expect(summary.offset).toBe(2);
    expect(summary.limit).toBe(2);
    expect(summary.hasMore).toBe(true);
    expect(summary.nextOffset).toBe(4);
    expect(() => summarizeExtensionContributionManifest(manifest(), { limit: 0 })).toThrow('"limit" must be a positive integer');
  });

  it('resolves one contribution detail with schema and diagnostics on demand', () => {
    const detail = showExtensionContributionManifestEntry(manifest(), {
      kind: 'command',
      id: 'ext.command',
      includeInputSchema: true,
      includeDiagnostics: true,
    });

    expect(detail.entry.inputSchema).toEqual(commandSpecificSchema);
    expect(detail.entry.inputDefaults).toEqual({ fromDefault: true, override: 'default' });
    expect(detail.diagnostics).toEqual([{ severity: 'warning', message: 'example diagnostic', code: 'example' }]);
  });

  it('treats full projection as shorthand for schemas and diagnostics', () => {
    const summary = summarizeExtensionContributionManifest(manifest(), { projection: 'full' });

    expect(summary.diagnostics).toEqual([{ severity: 'warning', message: 'example diagnostic', code: 'example' }]);
    expect(summary.entries.find((entry) => entry.kind === 'command' && entry.id === 'ext.command')?.inputSchema).toEqual(commandSpecificSchema);
  });

  it('infers unambiguous detail kind and preserves ambiguity checks', () => {
    const detail = showExtensionContributionManifestEntry(manifest(), { id: 'ext.deep' });

    expect(detail.entry).toMatchObject({ kind: 'deep-link', id: 'ext.deep', actionId: 'ext.run' });
    expect(detail.entry.inputSchema).toBeUndefined();
    expect(() => showExtensionContributionManifestEntry(manifest(), { id: 'shared' })).toThrow('Ambiguous extension contribution id "shared"; pass kind action, command, or deep-link');
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

  it('returns client-side unavailable failures without posting to the invoke route', async () => {
    serverState = await startServer({ ok: true, invocationId: 'should-not-invoke', output: null });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });

    serverState.manifest.actions[0].availability = { available: false, message: 'action unavailable' };
    await expect(invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'action',
      id: 'ext.run',
      input: {},
      requestedBy: { host: 'cli' },
    })).resolves.toMatchObject({ response: { ok: false, error: { code: 'unavailable', message: 'action unavailable' } } });

    delete serverState.manifest.actions[0].availability;
    serverState.manifest.integrationCommands[0].availability = { available: false, message: 'command unavailable' };
    await expect(invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'command',
      id: 'ext.command',
      input: {},
      requestedBy: { host: 'cli' },
    })).resolves.toMatchObject({ response: { ok: false, error: { code: 'unavailable', message: 'command unavailable' } } });

    delete serverState.manifest.integrationCommands[0].availability;
    serverState.manifest.deepLinks[0].availability = { available: false, message: 'deep link unavailable' };
    await expect(invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'deep-link',
      id: 'ext.deep',
      input: {},
      requestedBy: { host: 'cli' },
    })).resolves.toMatchObject({ response: { ok: false, error: { code: 'unavailable', message: 'deep link unavailable' } } });

    expect(serverState.requests.filter((request) => request.url === API_ROUTES.extensionActionInvoke)).toHaveLength(0);
  });

  it('creates a failed invocation envelope without echoing raw target input', async () => {
    const largeValue = 'secret-large-value-'.repeat(200);
    serverState = await startServer({ ok: false, invocationId: 'invoke-failed', error: { code: 'invalid-input', message: `Bad input ${largeValue} ${'x'.repeat(1200)}` } });
    writeLockfile(tmpDir, { pid: process.pid, port: serverState.port, startedAt: new Date().toISOString() });
    const longKey = `secret-key-${'x'.repeat(120)}`;

    const result = await invokeEforgeExtensionContribution({
      cwd: tmpDir,
      kind: 'action',
      id: 'ext.run',
      input: { largeValue, [longKey]: true, other: 1 },
      requestedBy: { host: 'cli' },
    });
    const envelope = createExtensionContributionFailedInvocationEnvelope(result);

    expect(envelope).toMatchObject({
      target: { kind: 'action', id: 'ext.run', actionId: 'ext.run' },
      error: { code: 'invalid-input', messageTruncated: true },
      inputSummary: { inputKeyCount: 3, truncatedInputKeyCount: 1 },
    });
    expect(envelope?.error.message.length).toBeLessThanOrEqual(1000);
    expect(envelope?.error.message).toContain('[redacted input value]');
    expect(envelope?.error.message).not.toContain(largeValue);

    const escapedValue = 'secret "escaped" value '.repeat(20);
    const escapedEnvelope = createExtensionContributionFailedInvocationEnvelope({
      ...result,
      target: { ...result.target, input: { escapedValue } },
      response: { ok: false, invocationId: 'escaped', error: { code: 'invalid-input', message: `Bad input ${JSON.stringify(escapedValue)}` } },
    });
    expect(escapedEnvelope?.error.message).toContain('[redacted input value]');
    expect(escapedEnvelope?.error.message).not.toContain(escapedValue);

    const truncatedEnvelope = createExtensionContributionFailedInvocationEnvelope({
      ...result,
      response: { ok: false, invocationId: 'truncated', error: { code: 'invalid-input', message: `Bad input ${largeValue.slice(0, 120)}` } },
    });
    expect(truncatedEnvelope?.error.message).toContain('omitted because it echoed request input');
    expect(truncatedEnvelope?.error.message).not.toContain(largeValue.slice(0, 120));

    const misalignedEnvelope = createExtensionContributionFailedInvocationEnvelope({
      ...result,
      response: { ok: false, invocationId: 'misaligned', error: { code: 'invalid-input', message: `Bad input ${largeValue.slice(10, 130)}` } },
    });
    expect(misalignedEnvelope?.error.message).toContain('omitted because it echoed request input');
    expect(misalignedEnvelope?.error.message).not.toContain(largeValue.slice(10, 130));
    expect(envelope?.inputSummary.inputKeys.every((key) => key.length <= 80)).toBe(true);
    expect(envelope?.inputSummary.serializedInputSize).toBeGreaterThan(largeValue.length);
    expect(JSON.stringify(envelope)).not.toContain(largeValue);
    expect(JSON.stringify(envelope)).not.toContain(longKey);
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
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { kind: 'console', id: 'ext.run', input: {}, requestedBy: { host: 'cli' } } as never)).toThrow('"kind" must be action, command, or deep-link');
    expect(() => resolveExtensionContributionInvocation(contributionManifest, { kind: 'action', id: 'ext.run', input: {}, requestedBy: { host: 'unknown' } } as never)).toThrow('"requestedBy" is invalid');
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
