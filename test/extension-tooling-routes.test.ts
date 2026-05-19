/**
 * In-process daemon route tests for native extension tooling surfaces.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type MonitorServer } from '@eforge-build/monitor/server';
import { API_ROUTES, writeLockfile, apiListExtensions, apiNewExtension, apiReloadExtensions, apiShowExtension, apiTestExtension, apiValidateExtensions, apiTrustExtension, apiUntrustExtension, apiInstallExtension, apiUpdateExtension, apiRemoveExtension, apiPromoteExtension, apiDemoteExtension, type EforgeEvent, type ExtensionListResponse, type ExtensionNewResponse, type ExtensionReloadResponse, type ExtensionShowResponse, type ExtensionTestResponse, type ExtensionValidateResponse, type ExtensionTrustResponse, type ExtensionInstallResponse, type ExtensionUpdateResponse, type ExtensionRemoveResponse, type ExtensionPromoteResponse, type ExtensionDemoteResponse } from '@eforge-build/client';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { AutoBuildSupervisor } from '@eforge-build/monitor/auto-build-supervisor';
import { upsertTrustRecord } from '@eforge-build/engine/extensions';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-extension-tooling-routes-');
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (originalXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  }
});

async function setupProject(tmpDir: string): Promise<void> {
  process.env.XDG_CONFIG_HOME = resolve(tmpDir, 'xdg-config');
  await mkdir(process.env.XDG_CONFIG_HOME, { recursive: true });

  execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], { cwd: tmpDir });

  await mkdir(resolve(tmpDir, 'eforge', 'extensions'), { recursive: true });
  await mkdir(resolve(tmpDir, '.eforge', 'extensions'), { recursive: true });
  await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), [
    'extensions:',
    '  trustProjectExtensions: false',
    '  exclude:',
    '    - excluded',
  ].join('\n'), 'utf-8');

  await writeFile(
    resolve(tmpDir, '.eforge', 'extensions', 'loaded.js'),
    'export default function extension(eforge) { eforge.registerInputSource({ name: "loaded-input", description: "loaded", fetch: async () => "ok" }); }',
    'utf-8',
  );
  await writeFile(
    resolve(tmpDir, 'eforge', 'extensions', 'loaded.js'),
    'export default function extension(eforge) { eforge.registerTool({ name: "shadow-tool", description: "shadow", inputSchema: { type: "object", properties: {} }, handler: () => "ok" }); }',
    'utf-8',
  );
  await writeFile(
    resolve(tmpDir, 'eforge', 'extensions', 'team.js'),
    'export default function extension(eforge) { eforge.registerInputSource({ name: "team-input", description: "team", fetch: async () => "ok" }); }',
    'utf-8',
  );
  await writeFile(resolve(tmpDir, '.eforge', 'extensions', 'bad.js'), 'export default 42;', 'utf-8');
  await writeFile(
    resolve(tmpDir, '.eforge', 'extensions', 'excluded.js'),
    'export default function extension() {}',
    'utf-8',
  );
}

async function start(tmpDir: string): Promise<MonitorServer> {
  const db = openDatabase(resolve(tmpDir, '.eforge', 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });
  return server;
}

function replayEvent(type: 'config:warning' | 'plan:build:start', runId?: string): EforgeEvent {
  const timestamp = new Date().toISOString();
  if (type === 'config:warning') return { type, timestamp, ...(runId !== undefined && { runId }), message: 'warning', source: 'test' };
  return { type, timestamp, ...(runId !== undefined && { runId }), planId: 'plan-1' };
}

function insertReplayRun(db: ReturnType<typeof openDatabase>, opts: { runId: string; sessionId: string; cwd: string; events: EforgeEvent[]; startedAt?: string }): void {
  db.insertRun({ id: opts.runId, sessionId: opts.sessionId, planSet: 'set', command: 'build', status: 'completed', startedAt: opts.startedAt ?? new Date().toISOString(), cwd: opts.cwd });
  for (const event of opts.events) {
    db.insertEvent({ runId: opts.runId, type: event.type, data: JSON.stringify(event), timestamp: event.timestamp });
  }
}

function postExtensionTestRaw(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const req = request({
      hostname: 'localhost',
      port,
      path: API_ROUTES.extensionTest,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      res.resume();
      res.on('end', () => resolveStatus(res.statusCode ?? 0));
    });
    req.on('error', rejectStatus);
    req.end(JSON.stringify({}));
  });
}

function postTrustRaw(port: number, path: string, headers: Record<string, string>, body: unknown): Promise<number> {
  return new Promise((resolveStatus, rejectStatus) => {
    const req = request({
      hostname: 'localhost',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      res.resume();
      res.on('end', () => resolveStatus(res.statusCode ?? 0));
    });
    req.on('error', rejectStatus);
    req.end(JSON.stringify(body));
  });
}

describe('extension tooling daemon routes', () => {
  it('GET extensionList returns loaded, excluded, untrusted, error, shadows, registration summaries, and diagnostics', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionList}`);
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionListResponse;

    const loaded = data.extensions.find((entry) => entry.name === 'loaded' && entry.status === 'loaded');
    expect(loaded).toMatchObject({ name: 'loaded', status: 'loaded', scope: 'project-local', source: 'auto', enabled: true });
    expect(loaded?.registrations.inputSources).toBe(1);
    expect(loaded?.shadows.some((shadow) => shadow.scope === 'project-team')).toBe(true);
    expect(data.extensions.find((entry) => entry.name === 'loaded' && entry.status === 'shadowed')).toMatchObject({ name: 'loaded', status: 'shadowed', scope: 'project-team', enabled: false });
    expect(data.extensions.find((entry) => entry.name === 'team')).toMatchObject({
      name: 'team',
      status: 'skipped',
      scope: 'project-team',
      enabled: true,
      trust: 'untrusted',
      trustState: 'untrusted',
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      trustStorePath: resolve(tmpDir, '.eforge', 'extension-trust.json'),
    });
    expect(data.extensions.find((entry) => entry.name === 'bad')).toMatchObject({ name: 'bad', status: 'error', scope: 'project-local', enabled: true });
    expect(data.extensions.find((entry) => entry.name === 'excluded')).toMatchObject({ name: 'excluded', status: 'excluded', scope: 'project-local', enabled: false });
    expect(data.extensions.every((entry) => typeof entry.enabled === 'boolean')).toBe(true);
    expect(data.diagnostics.some((diagnostic) => diagnostic.code === 'extension:invalid-export')).toBe(true);
    expect(data.diagnostics.some((diagnostic) => diagnostic.code === 'extension:untrusted')).toBe(true);
  });

  it('GET extensionList marks all discovered entries disabled when extensions are globally disabled', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), [
      'extensions:',
      '  enabled: false',
      '  trustProjectExtensions: false',
    ].join('\n'), 'utf-8');
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionList}`);
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionListResponse;

    expect(data.extensions.length).toBeGreaterThan(0);
    expect(data.extensions.every((entry) => entry.enabled === false)).toBe(true);
    expect(data.totals).toMatchObject({ eventHooks: 0, inputSources: 0, tools: 0, prdEnrichers: 0 });
  });

  it('GET extensionList marks include-filtered auto entries disabled while selected entries stay enabled', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), [
      'extensions:',
      '  trustProjectExtensions: false',
      '  include:',
      '    - loaded',
    ].join('\n'), 'utf-8');
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionList}`);
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionListResponse;

    expect(data.extensions.find((entry) => entry.name === 'loaded' && entry.status === 'loaded')).toMatchObject({ enabled: true });
    expect(data.extensions.find((entry) => entry.name === 'bad')).toMatchObject({ status: 'excluded', enabled: false });
    expect(data.extensions.find((entry) => entry.name === 'excluded')).toMatchObject({ status: 'excluded', enabled: false });
  });

  it('GET extensionShow returns one entry and 404 for unknown names', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionShow}?name=loaded`);
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionShowResponse;
    expect(data.extension.name).toBe('loaded');
    expect(data.extension.status).toBe('loaded');
    expect(data.extension.enabled).toBe(true);

    const team = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionShow}?name=team`);
    expect(team.status).toBe(200);
    const teamData = await team.json() as ExtensionShowResponse;
    expect(teamData.extension).toMatchObject({
      name: 'team',
      scope: 'project-team',
      trust: 'untrusted',
      trustState: 'untrusted',
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const missing = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionShow}?name=missing`);
    expect(missing.status).toBe(404);
  });

  it('client extension helpers reach the daemon routes with typed response shapes', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    const list = await apiListExtensions({ cwd: tmpDir });
    expect(list.port).toBe(srv.port);
    expect(list.data.extensions.some((entry) => entry.name === 'loaded')).toBe(true);
    expect(list.data.totals.inputSources).toBe(1);

    const show = await apiShowExtension({ cwd: tmpDir, name: 'loaded' });
    expect(show.data.extension).toMatchObject({ name: 'loaded', status: 'loaded' });

    const validate = await apiValidateExtensions({ cwd: tmpDir, name: 'bad' });
    expect(validate.data.valid).toBe(false);
    expect(validate.data.extensions).toEqual([
      expect.objectContaining({ name: 'bad', status: 'error' }),
    ]);
    expect(validate.data.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'extension:invalid-export' }),
    ]));

    const validateTeam = await apiValidateExtensions({ cwd: tmpDir, name: 'team' });
    expect(validateTeam.data.extensions).toEqual([
      expect.objectContaining({ name: 'team', trustState: 'untrusted', currentHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);

    const testTeam = await apiTestExtension({ cwd: tmpDir, body: { name: 'team' } });
    expect(testTeam.data.extensions).toEqual([
      expect.objectContaining({ name: 'team', trustState: 'untrusted', currentHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);

    const created = await apiNewExtension({ cwd: tmpDir, body: { name: 'audit' } });
    expect(created.data).toMatchObject({ name: 'audit', template: 'event-logger', scope: 'project-local' });

    const reload = await apiReloadExtensions({ cwd: tmpDir });
    expect(reload.data.extensions.some((entry) => entry.name === 'audit')).toBe(true);

    await writeFile(
      resolve(tmpDir, '.eforge', 'extensions', 'replay.js'),
      'export default function extension(eforge) { eforge.onEvent("config:*", () => {}); }',
      'utf-8',
    );
    const fixture = resolve(tmpDir, 'fixture.json');
    await writeFile(fixture, JSON.stringify(replayEvent('config:warning')), 'utf-8');
    const tested = await apiTestExtension({ cwd: tmpDir, body: { name: 'replay', fixture } });
    expect(tested.data).toMatchObject({ valid: true, source: { kind: 'fixture', fixture: await realpath(fixture) }, replay: { inputEventCount: 1, filteredEventCount: 1 } });
    expect(tested.data.matches).toEqual([expect.objectContaining({ extensionName: 'replay', pattern: 'config:*' })]);
  });

  it('POST extensionTest supports static-only requests and rejects ambiguous request bodies', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const extensionPath = resolve(tmpDir, '.eforge', 'extensions', 'static-only.js');
    await writeFile(
      extensionPath,
      'export default function extension(eforge) { eforge.registerInputSource({ name: "static-input", description: "static", fetch: async () => "ok" }); }',
      'utf-8',
    );
    const srv = await start(tmpDir);

    const staticOnly = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'static-only' }),
    });
    expect(staticOnly.status).toBe(200);
    const data = await staticOnly.json() as ExtensionTestResponse;
    expect(data).toMatchObject({
      valid: true,
      source: { kind: 'none' },
      replay: { inputEventCount: 0, filteredEventCount: 0, emittedEventCount: 0, diagnosticEventCount: 0 },
      matches: [],
    });
    expect(data.deferredRegistrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'inputSources', count: 1 }),
    ]));

    for (const body of [
      { name: 'static-only', path: extensionPath },
      { name: 'static-only', fixture: 'events.json', run: 'latest' },
    ]) {
      const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it('POST extensionTest honors the configured event hook timeout', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeFile(resolve(tmpDir, '.eforge', 'config.yaml'), 'extensions:\n  eventHookTimeoutMs: 5\n', 'utf-8');
    await writeFile(
      resolve(tmpDir, '.eforge', 'extensions', 'timeout.js'),
      'export default function extension(eforge) { eforge.onEvent("config:warning", async () => { await new Promise(() => {}); }); }',
      'utf-8',
    );
    const fixture = resolve(tmpDir, 'timeout-fixture.json');
    await writeFile(fixture, JSON.stringify(replayEvent('config:warning')), 'utf-8');
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'timeout', fixture }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionTestResponse;
    expect(data.valid).toBe(false);
    expect(data.emittedDiagnostics).toEqual([
      expect.objectContaining({ type: 'extension:event-handler:timeout', timeoutMs: 5 }),
    ]);
  });

  it('POST extensionTest replays fixture events, filters by event type, and reports invalid fixtures', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const extensionPath = resolve(tmpDir, '.eforge', 'extensions', 'replay.js');
    await writeFile(
      extensionPath,
      'export default function extension(eforge) { eforge.onEvent("config:*", () => {}); eforge.onEvent("plan:build:*", () => {}); }',
      'utf-8',
    );
    const fixture = resolve(tmpDir, 'events.jsonl');
    await writeFile(fixture, `${JSON.stringify(replayEvent('config:warning'))}\n${JSON.stringify(replayEvent('plan:build:start'))}\n`, 'utf-8');
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'replay', fixture, event: 'plan:build:start' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionTestResponse;
    expect(data.valid).toBe(true);
    expect(data.replay).toMatchObject({ inputEventCount: 2, filteredEventCount: 1 });
    expect(data.matches).toEqual([expect.objectContaining({ eventIndex: 1, eventType: 'plan:build:start', pattern: 'plan:build:*' })]);

    const pathScoped = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: extensionPath, fixture, event: 'config:warning' }),
    });
    expect(pathScoped.status).toBe(200);
    const pathScopedData = await pathScoped.json() as ExtensionTestResponse;
    expect(pathScopedData.valid).toBe(true);
    expect(pathScopedData.matches).toEqual([expect.objectContaining({ eventIndex: 0, eventType: 'config:warning', extensionPath: await realpath(extensionPath) })]);

    const invalidFixture = resolve(tmpDir, 'bad.json');
    await writeFile(invalidFixture, JSON.stringify({ type: 'config:warning', timestamp: new Date().toISOString() }), 'utf-8');
    const bad = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'replay', fixture: invalidFixture }),
    });
    expect(bad.status).toBe(200);
    const badData = await bad.json() as ExtensionTestResponse;
    expect(badData.valid).toBe(false);
    expect(badData.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'extension:invalid-fixture' })]));
  });

  it('POST extensionTest replays latest, run-id, and session-id monitor histories without persisting replay diagnostics', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeFile(resolve(tmpDir, '.eforge', 'config.yaml'), 'extensions:\n  eventHookTimeoutMs: 5\n', 'utf-8');
    await writeFile(
      resolve(tmpDir, '.eforge', 'extensions', 'run-replay.js'),
      'export default function extension(eforge) { eforge.onEvent("config:warning", () => { throw new Error("dry-run failure"); }); eforge.onEvent("config:warning", async () => { await new Promise(() => {}); }); }',
      'utf-8',
    );
    const db = openDatabase(resolve(tmpDir, '.eforge', 'monitor.db'));
    insertReplayRun(db, { runId: 'run-old', sessionId: 'session-old', cwd: tmpDir, startedAt: '2026-01-01T00:00:00.000Z', events: [replayEvent('plan:build:start', 'run-old')] });
    insertReplayRun(db, { runId: 'run-new', sessionId: 'session-new', cwd: tmpDir, startedAt: '2026-01-02T00:00:00.000Z', events: [replayEvent('config:warning', 'run-new')] });
    db.insertEvent({
      runId: 'run-new',
      type: 'config:warning',
      data: JSON.stringify({ type: 'config:warning', timestamp: new Date().toISOString() }),
      timestamp: new Date().toISOString(),
    });
    server = await startServer(db, 0, { strictPort: true, cwd: tmpDir });

    for (const body of [{ run: 'latest' }, { run: 'run-new' }, { run: 'session-new' }]) {
      const before = db.getEventsBySession('session-new').length;
      const res = await fetch(`http://localhost:${server.port}${API_ROUTES.extensionTest}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'run-replay', ...body }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as ExtensionTestResponse;
      expect(data.valid).toBe(false);
      expect(data.source).toMatchObject({ kind: 'run', sessionId: 'session-new' });
      expect(data.replay.inputEventCount).toBe(1);
      expect(data.emittedDiagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'extension:event-handler:failed', message: 'dry-run failure' }),
        expect.objectContaining({ type: 'extension:event-handler:timeout', timeoutMs: 5 }),
      ]));
      expect(db.getEventsBySession('session-new')).toHaveLength(before);
    }
  });

  it('POST extensionTest rejects invalid paths and cross-origin callers', async () => {
    const tmpDir = makeTempDir();
    const outsideDir = makeTempDir();
    await setupProject(tmpDir);
    const escapedExtensionTarget = resolve(outsideDir, 'outside-extension.js');
    const escapedFixtureTarget = resolve(outsideDir, 'outside-fixture.json');
    await writeFile(escapedExtensionTarget, 'export default function extension() {}', 'utf-8');
    await writeFile(escapedFixtureTarget, JSON.stringify(replayEvent('config:warning')), 'utf-8');
    await symlink(escapedExtensionTarget, resolve(tmpDir, 'escaped-extension.js'));
    await symlink(escapedFixtureTarget, resolve(tmpDir, 'escaped-fixture.json'));
    const srv = await start(tmpDir);

    const invalidPath = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '../outside.js' }),
    });
    expect(invalidPath.status).toBe(400);

    const invalidFixture = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture: '../outside.json' }),
    });
    expect(invalidFixture.status).toBe(400);

    const escapedPath = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'escaped-extension.js' }),
    });
    expect(escapedPath.status).toBe(400);

    const escapedFixture = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture: 'escaped-fixture.json' }),
    });
    expect(escapedFixture.status).toBe(400);

    const crossOrigin = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionTest}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({}),
    });
    expect(crossOrigin.status).toBe(403);

    await expect(postExtensionTestRaw(srv.port, { Host: '192.0.2.1' })).resolves.toBe(403);
    await expect(postExtensionTestRaw(srv.port, { Host: '127.0.0.1.evil.example' })).resolves.toBe(403);
  });

  it('GET extensionValidate returns valid:false and error diagnostics when any extension has load errors', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionValidate}`);
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionValidateResponse;
    expect(data.valid).toBe(false);
    expect(data.extensions.some((entry) => entry.name === 'bad' && entry.status === 'error')).toBe(true);
    expect(data.diagnostics.some((diagnostic) => diagnostic.message.includes('Default export'))).toBe(true);
  });

  it('GET extensionValidate scopes validation and diagnostics to the requested extension name', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionValidate}?name=loaded`);
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionValidateResponse;
    expect(data.valid).toBe(true);
    expect(new Set(data.extensions.map((entry) => entry.name))).toEqual(new Set(['loaded']));
    expect(data.extensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'loaded', status: 'loaded' }),
      expect.objectContaining({ name: 'loaded', status: 'shadowed' }),
    ]));
    expect(data.diagnostics).toEqual([]);
  });

  it('GET extensionValidate rejects path traversal in ad-hoc path validation', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionValidate}?path=${encodeURIComponent('../outside.js')}`);
    expect(res.status).toBe(400);
  });

  it('POST extensionNew creates the default template in project-local scope', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionNew}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'audit' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionNewResponse;
    expect(data).toMatchObject({ name: 'audit', template: 'event-logger', scope: 'project-local', overwritten: false });
    const content = await readFile(resolve(tmpDir, '.eforge', 'extensions', 'audit.ts'), 'utf-8');
    expect(content).toContain('defineEforgeExtension');
    expect(content).toContain('onEvent');
  });

  it('POST extensionNew returns 409 on conflict and leaves existing content unchanged', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);
    const target = resolve(tmpDir, '.eforge', 'extensions', 'audit.ts');
    await writeFile(target, 'existing content', 'utf-8');

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionNew}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'audit' }),
    });

    expect(res.status).toBe(409);
    expect(await readFile(target, 'utf-8')).toBe('existing content');
  });

  it('POST extensionNew honors request scope, template, and force overwrite', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);
    const target = resolve(tmpDir, 'eforge', 'extensions', 'team-audit.ts');
    await writeFile(target, 'existing content', 'utf-8');

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionNew}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'team-audit', scope: 'project', template: 'blank', force: true }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionNewResponse;
    expect(data).toMatchObject({
      name: 'team-audit',
      requestScope: 'project',
      scope: 'project-team',
      template: 'blank',
      overwritten: true,
      path: target,
    });
    const content = await readFile(target, 'utf-8');
    expect(content).toContain('Register extension capabilities here');
    expect(content).not.toContain('onEvent');
  });

  it('POST extensionNew rejects invalid names and unknown templates', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    for (const body of [
      { name: '../audit' },
      { name: '..' },
      { name: '' },
      { name: 'audit', template: 'missing' },
    ]) {
      const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionNew}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it('POST extensionReload returns fresh extension data and no-watcher metadata', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionReload}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionReloadResponse;
    expect(data.extensions.some((entry) => entry.name === 'loaded')).toBe(true);
    expect(data.extensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'team', trustState: 'untrusted', currentHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]));
    expect(Array.isArray(data.diagnostics)).toBe(true);
    expect(data.totals).toMatchObject({ inputSources: 1, prdEnrichers: 0 });
    expect(data.watcher).toEqual({
      wasRunning: false,
      restarted: false,
      running: false,
      previousSessionId: null,
      sessionId: null,
      message: 'Extension discovery refreshed; no runtime watcher was restarted.',
    });
    expect(data).toMatchObject(data.watcher);
  });

  it('POST extensionReload reports active watcher restart metadata from the supervisor snapshot', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const db = openDatabase(resolve(tmpDir, '.eforge', 'monitor.db'));
    let watcher = { running: true, pid: null, sessionId: 'watcher-old' };
    const restartWatcher = vi.fn(() => {
      watcher = { running: true, pid: null, sessionId: 'watcher-new' };
    });
    const controller = new AutoBuildSupervisor({
      initialState: {
        desired: 'enabled',
        mode: 'running',
        watcher,
        scheduler: { alive: true, paused: false },
      },
      effects: {
        getWatcher: () => watcher,
        isSchedulerAlive: () => true,
        restartWatcher,
      },
    });
    server = await startServer(db, 0, {
      strictPort: true,
      cwd: tmpDir,
      daemonState: { autoBuildController: controller },
    });

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.extensionReload}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json() as ExtensionReloadResponse;
    expect(restartWatcher).toHaveBeenCalledOnce();
    expect(data.watcher).toEqual({
      wasRunning: true,
      restarted: true,
      running: true,
      previousSessionId: 'watcher-old',
      sessionId: 'watcher-new',
      message: 'Extension discovery refreshed and runtime watcher restarted.',
    });
    expect(data).toMatchObject(data.watcher);
  });

  it('POST extensionTrust writes a trust record and returns the updated entry without executing extension code', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const importMarker = resolve(tmpDir, 'team-imported.marker');
    await writeFile(
      resolve(tmpDir, 'eforge', 'extensions', 'team.js'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(importMarker)}, 'imported'); export default function extension(eforge) { eforge.registerInputSource({ name: "team-input", description: "team", fetch: async () => "ok" }); }`,
      'utf-8',
    );
    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // The 'team' extension is a project-team candidate
    const res = await apiTrustExtension({ cwd: tmpDir, body: { name: 'team' } });
    expect(res.port).toBe(srv.port);
    const data: ExtensionTrustResponse = res.data;
    expect(data.extension.name).toBe('team');
    expect(data.extension.scope).toBe('project-team');
    expect(data.extension.trust).toBe('trusted');
    expect(data.extension.trustState).toBe('trusted');
    expect(typeof data.extension.currentHash).toBe('string');
    expect(data.extension.currentHash).toHaveLength(64); // SHA-256 hex
    expect(data.extension.trustedHash).toBe(data.extension.currentHash);
    expect(typeof data.extension.trustedAt).toBe('string');
    expect(typeof data.message).toBe('string');
    expect(data.message).toContain('team');

    // Verify the trust store was written
    const { readFile: readFileNode } = await import('node:fs/promises');
    const trustStorePath = resolve(tmpDir, '.eforge', 'extension-trust.json');
    const trustStoreContent = JSON.parse(await readFileNode(trustStorePath, 'utf-8')) as { records: Array<{ name: string; hash: string }> };
    expect(trustStoreContent.records.some((r) => r.name === 'team' && r.hash === data.extension.currentHash)).toBe(true);

    // Extension code must NOT have been executed: a top-level import side effect would create this marker.
    await expect(readFile(importMarker, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(data.extension.registrations.inputSources).toBe(0);
    expect(data.extension.registrations.eventHooks).toBe(0);
  });

  it('POST extensionUntrust removes the trust record and returns the candidate as untrusted without executing extension code', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const importMarker = resolve(tmpDir, 'team-untrust-imported.marker');
    await writeFile(
      resolve(tmpDir, 'eforge', 'extensions', 'team.js'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(importMarker)}, 'imported'); export default function extension() {}`,
      'utf-8',
    );
    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Trust first
    await apiTrustExtension({ cwd: tmpDir, body: { name: 'team' } });

    // Then untrust
    const res = await apiUntrustExtension({ cwd: tmpDir, body: { name: 'team' } });
    const data: ExtensionTrustResponse = res.data;
    expect(data.extension.name).toBe('team');
    expect(data.extension.scope).toBe('project-team');
    expect(data.extension.trust).toBe('untrusted');
    expect(data.extension.trustState).toBe('untrusted');
    expect(typeof data.message).toBe('string');
    expect(data.message).toContain('team');

    // Trust store should no longer have the record
    const { readFile: readFileNode } = await import('node:fs/promises');
    const trustStorePath = resolve(tmpDir, '.eforge', 'extension-trust.json');
    const trustStoreContent = JSON.parse(await readFileNode(trustStorePath, 'utf-8')) as { records: Array<{ name: string }> };
    expect(trustStoreContent.records.find((r) => r.name === 'team')).toBeUndefined();
    await expect(readFile(importMarker, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('POST extensionTrust and extensionUntrust accept project-team extension paths', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const teamPath = resolve(tmpDir, 'eforge', 'extensions', 'team.js');
    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    const trusted = await apiTrustExtension({ cwd: tmpDir, body: { path: 'eforge/extensions/team.js', trustedBy: 'path-test' } });
    expect(trusted.data.extension).toMatchObject({
      name: 'team',
      path: teamPath,
      scope: 'project-team',
      trustState: 'trusted',
      trustedBy: 'path-test',
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const untrusted = await apiUntrustExtension({ cwd: tmpDir, body: { path: teamPath } });
    expect(untrusted.data.extension).toMatchObject({
      name: 'team',
      path: teamPath,
      scope: 'project-team',
      trustState: 'untrusted',
      currentHash: trusted.data.extension.currentHash,
    });
  });

  it('POST extensionTrust rejects project-local, user, external, path-escaping, ambiguous, and unknown targets', async () => {
    const tmpDir = makeTempDir();
    const outsideDir = makeTempDir();
    await setupProject(tmpDir);
    await mkdir(resolve(process.env.XDG_CONFIG_HOME!, 'eforge', 'extensions'), { recursive: true });
    await writeFile(resolve(process.env.XDG_CONFIG_HOME!, 'eforge', 'extensions', 'user-only.js'), 'export default function extension() {}', 'utf-8');
    const externalExtension = resolve(outsideDir, 'external.js');
    await writeFile(externalExtension, 'export default function extension() {}', 'utf-8');
    const escapedExtension = resolve(outsideDir, 'escaped.js');
    await writeFile(escapedExtension, 'export default function extension() {}', 'utf-8');
    await symlink(escapedExtension, resolve(tmpDir, 'eforge', 'extensions', 'escaped-link.js'));
    const srv = await start(tmpDir);

    for (const route of [API_ROUTES.extensionTrust, API_ROUTES.extensionUntrust]) {
      const unknown = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'nonexistent' }),
      });
      expect(unknown.status).toBe(404);

      const localOnly = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'bad' }),
      });
      expect(localOnly.status).toBe(404);

      const userOnly = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'user-only' }),
      });
      expect(userOnly.status).toBe(404);

      const projectLocalPath = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: resolve(tmpDir, '.eforge', 'extensions', 'loaded.js') }),
      });
      expect(projectLocalPath.status).toBe(400);

      const externalPath = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: externalExtension }),
      });
      expect(externalPath.status).toBe(400);

      const symlinkEscapedPath = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: resolve(tmpDir, 'eforge', 'extensions', 'escaped-link.js') }),
      });
      expect(symlinkEscapedPath.status).toBe(400);

      const missingBody = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(missingBody.status).toBe(400);

      const bothNamePath = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'team', path: resolve(tmpDir, 'eforge', 'extensions', 'team.js') }),
      });
      expect(bothNamePath.status).toBe(400);
    }

    await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), [
      'extensions:',
      '  trustProjectExtensions: false',
      '  paths:',
      '    - eforge/extensions/team.js',
    ].join('\n'), 'utf-8');
    for (const route of [API_ROUTES.extensionTrust, API_ROUTES.extensionUntrust]) {
      const ambiguous = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'team' }),
      });
      expect(ambiguous.status).toBe(409);
    }
  });

  it('POST extensionTrust and extensionUntrust reject cross-origin callers and non-loopback Host headers', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    await expect(postTrustRaw(srv.port, API_ROUTES.extensionTrust, { Origin: 'http://evil.example' }, { name: 'team' })).resolves.toBe(403);
    await expect(postTrustRaw(srv.port, API_ROUTES.extensionTrust, { Host: '192.0.2.1' }, { name: 'team' })).resolves.toBe(403);
    await expect(postTrustRaw(srv.port, API_ROUTES.extensionUntrust, { Origin: 'http://evil.example' }, { name: 'team' })).resolves.toBe(403);
    await expect(postTrustRaw(srv.port, API_ROUTES.extensionUntrust, { Host: '192.0.2.1' }, { name: 'team' })).resolves.toBe(403);
  });

  // --- extension package management route tests ---

  it('package mutation routes reject cross-origin callers and non-loopback Host headers', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    for (const route of [
      API_ROUTES.extensionInstall,
      API_ROUTES.extensionUpdate,
      API_ROUTES.extensionRemove,
      API_ROUTES.extensionPromote,
      API_ROUTES.extensionDemote,
    ]) {
      await expect(postTrustRaw(srv.port, route, { Origin: 'http://evil.example' }, {}), route).resolves.toBe(403);
      await expect(postTrustRaw(srv.port, route, { Host: '192.0.2.1' }, {}), route).resolves.toBe(403);
    }
  });

  it('POST extensionInstall installs a local directory to local, project, and user scopes with install provenance', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    // Create a local extension package directory
    const pkgDir = resolve(tmpDir, 'my-ext-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({
      name: 'my-ext-pkg',
      version: '1.0.0',
      eforge: { extension: { name: 'my-ext' } },
    }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');
    await mkdir(resolve(pkgDir, 'dist'), { recursive: true });
    await writeFile(resolve(pkgDir, 'dist', 'bundle.js'), 'export default function bundled() {}', 'utf-8');
    await mkdir(resolve(pkgDir, 'node_modules', 'dep'), { recursive: true });
    await writeFile(resolve(pkgDir, 'node_modules', 'dep', 'index.js'), 'module.exports = {};', 'utf-8');
    await mkdir(resolve(pkgDir, '.git'), { recursive: true });
    await writeFile(resolve(pkgDir, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Install to local scope
    const localRes = await apiInstallExtension({ cwd: tmpDir, body: { source: './my-ext-pkg', scope: 'local' } });
    const localExt: ExtensionInstallResponse = localRes.data;
    expect(localExt.extension.name).toBe('my-ext');
    expect(localExt.extension.scope).toBe('project-local');
    expect(localExt.extension.install).toBeDefined();
    expect(localExt.extension.install?.sourceKind).toBe('path');
    expect(localExt.extension.install?.installedAt).toBeDefined();
    expect(localExt.extension.install?.targetScope).toBe('project-local');

    // Verify on disk, including the package-copy filtering rules.
    const localInstallDir = resolve(tmpDir, '.eforge', 'extensions', 'my-ext');
    await expect(lstat(localInstallDir)).resolves.toBeDefined();
    await expect(readFile(resolve(localInstallDir, 'dist', 'bundle.js'), 'utf-8')).resolves.toContain('bundled');
    await expect(lstat(resolve(localInstallDir, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(resolve(localInstallDir, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });

    // Remove local install before installing to project scope
    await apiRemoveExtension({ cwd: tmpDir, body: { name: 'my-ext' } });

    // Install to project scope
    const projectRes = await apiInstallExtension({ cwd: tmpDir, body: { source: './my-ext-pkg', scope: 'project' } });
    const projectExt: ExtensionInstallResponse = projectRes.data;
    expect(projectExt.extension.name).toBe('my-ext');
    expect(projectExt.extension.scope).toBe('project-team');
    expect(projectExt.extension.install?.targetScope).toBe('project-team');

    // Verify on disk
    await expect(lstat(resolve(tmpDir, 'eforge', 'extensions', 'my-ext'))).resolves.toBeDefined();

    // Remove project install before installing to user scope
    await apiRemoveExtension({ cwd: tmpDir, body: { name: 'my-ext', force: true } });

    // Install to user scope
    const userRes = await apiInstallExtension({ cwd: tmpDir, body: { source: './my-ext-pkg', scope: 'user' } });
    const userExt: ExtensionInstallResponse = userRes.data;
    expect(userExt.extension.name).toBe('my-ext');
    expect(userExt.extension.scope).toBe('user');
    expect(userExt.extension.install?.targetScope).toBe('user');
    expect(userExt.extension.install?.sourceKind).toBe('path');
    expect(userExt.extension.install?.installedAt).toBeDefined();

    // Verify on disk at XDG user config path
    const userExtDir = resolve(process.env.XDG_CONFIG_HOME!, 'eforge', 'extensions', 'my-ext');
    await expect(lstat(userExtDir)).resolves.toBeDefined();
  });

  it('POST extensionInstall installs a local .tgz tarball and returns ExtensionEntry with install provenance', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    // Create a package and pack it using npm pack
    const pkgDir = resolve(tmpDir, 'tgz-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'tgz-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');
    execFileSync('npm', ['pack', '--ignore-scripts', `--pack-destination=${tmpDir}`], { cwd: pkgDir, stdio: 'pipe' });

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Install the tarball (ends with .tgz, starts with ./ -> path-tgz classification)
    const res = await apiInstallExtension({ cwd: tmpDir, body: { source: './tgz-pkg-1.0.0.tgz' } });
    const data: ExtensionInstallResponse = res.data;
    expect(data.extension.name).toBe('tgz-pkg');
    expect(data.extension.package).toMatchObject({ packageName: 'tgz-pkg', version: '1.0.0' });
    expect(data.extension.install).toMatchObject({
      sourceKind: 'url',
      sourceSpec: resolve(tmpDir, 'tgz-pkg-1.0.0.tgz'),
      targetScope: 'project-local',
    });
    expect(data.extension.install?.installedAt).toBeDefined();
    expect(typeof data.message).toBe('string');
  });

  it('POST extensionInstall installs an npm package spec (file: protocol) and records resolved version/integrity', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    // Create a local package (file: protocol makes classifier treat it as npm)
    const pkgDir = resolve(tmpDir, 'npm-test-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'npm-test-pkg', version: '3.1.4' }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // file:./path is classified as 'npm' and goes through npm pack
    const res = await apiInstallExtension({ cwd: tmpDir, body: { source: 'file:./npm-test-pkg' } });
    const data: ExtensionInstallResponse = res.data;
    expect(data.extension.name).toBe('npm-test-pkg');
    expect(data.extension.install?.sourceKind).toBe('npm');
    expect(data.extension.install?.sourceSpec).toBe('file:./npm-test-pkg');
    expect(data.extension.install?.resolvedVersion).toBe('3.1.4');
    expect(data.extension.install?.integrity).toBeDefined();
  });

  it('POST extensionInstall rejects an existing target without force:true and replaces with force:true', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const fileCollisionPkg = resolve(tmpDir, 'file-collision-pkg');
    await mkdir(fileCollisionPkg, { recursive: true });
    await writeFile(resolve(fileCollisionPkg, 'package.json'), JSON.stringify({ name: 'file-collision', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(fileCollisionPkg, 'index.js'), 'export default function extension() {}', 'utf-8');
    await writeFile(resolve(tmpDir, '.eforge', 'extensions', 'file-collision.js'), 'export default function existing() {}', 'utf-8');

    const pkgDir = resolve(tmpDir, 'force-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'force-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    const fileCollision = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionInstall}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: './file-collision-pkg' }),
    });
    expect(fileCollision.status).toBe(409);

    // First install succeeds
    const first = await apiInstallExtension({ cwd: tmpDir, body: { source: './force-pkg' } });
    expect(first.data.extension.name).toBe('force-pkg');

    // Second install without force: 409 conflict
    const noForce = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionInstall}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: './force-pkg' }),
    });
    expect(noForce.status).toBe(409);

    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() { return "v2"; }', 'utf-8');

    // With force: succeeds and replaces the installed files.
    const withForce = await apiInstallExtension({ cwd: tmpDir, body: { source: './force-pkg', force: true } });
    expect(withForce.data.extension.name).toBe('force-pkg');
    await expect(readFile(resolve(tmpDir, '.eforge', 'extensions', 'force-pkg', 'index.js'), 'utf-8')).resolves.toContain('v2');
  });

  it('POST extensionInstall for a project scope target leaves trustState untrusted unless trust:true is supplied', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const pkgDir = resolve(tmpDir, 'trust-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'trust-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    const staleTeamDir = resolve(tmpDir, 'eforge', 'extensions', 'trust-pkg');
    await mkdir(staleTeamDir, { recursive: true });
    await writeFile(resolve(staleTeamDir, 'index.js'), 'export default function oldExtension() {}', 'utf-8');
    await upsertTrustRecord(resolve(tmpDir, '.eforge'), 'trust-pkg', '0'.repeat(64), 'previous-test');

    // Install without trust, forcing over an existing project-team target that had a stale trust record.
    const noTrust = await apiInstallExtension({ cwd: tmpDir, body: { source: './trust-pkg', scope: 'project', force: true } });
    expect(noTrust.data.extension.trustState).toBe('untrusted');
    expect(noTrust.data.extension.trustedHash).toBeUndefined();
    const trustStoreAfterNoTrust = JSON.parse(await readFile(resolve(tmpDir, '.eforge', 'extension-trust.json'), 'utf-8')) as { records: Array<{ name: string }> };
    expect(trustStoreAfterNoTrust.records.find((record) => record.name === 'trust-pkg')).toBeUndefined();

    // Remove and reinstall with trust
    await apiRemoveExtension({ cwd: tmpDir, body: { name: 'trust-pkg', force: true } });

    const withTrust = await apiInstallExtension({ cwd: tmpDir, body: { source: './trust-pkg', scope: 'project', trust: true, trustedBy: 'test' } });
    expect(withTrust.data.extension.trustState).toBe('trusted');
  });

  it('POST extensionInstall and extensionUpdate do not import or execute the extension factory during package acquisition', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    // Extension with a module-level side effect (writes a marker when imported)
    const markerFile = resolve(tmpDir, 'factory-executed.marker');
    const pkgDir = resolve(tmpDir, 'side-effect-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'side-effect-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(
      resolve(pkgDir, 'index.js'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(markerFile)}, 'imported'); export default function extension() {}`,
      'utf-8',
    );

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Install to project scope (untrusted team extensions are not loaded by the engine)
    await apiInstallExtension({ cwd: tmpDir, body: { source: './side-effect-pkg', scope: 'project' } });

    // Factory must NOT have been executed during install (project-team untrusted → not loaded)
    await expect(lstat(markerFile)).rejects.toMatchObject({ code: 'ENOENT' });

    // Update also must not execute the factory
    await apiUpdateExtension({ cwd: tmpDir, body: { name: 'side-effect-pkg' } });
    await expect(lstat(markerFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('POST extensionInstall rejects git URL-like sources with 400', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    for (const source of [
      'git+https://github.com/user/repo.git',
      'git://github.com/user/repo.git',
      'git@github.com:user/repo.git',
      'github:user/repo',
      'gitlab:user/repo',
    ]) {
      const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionInstall}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      expect(res.status, `Expected 400 for source: ${source}`).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('Git URL');
      expect(body.error).toMatch(/future release|planned/i);
    }
  });

  it('POST extensionUpdate reinstalls from recorded sidecar source and removes prior project trust unless trust:true is supplied', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const pkgDir = resolve(tmpDir, 'update-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'update-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Install with trust to project scope
    await apiInstallExtension({ cwd: tmpDir, body: { source: './update-pkg', scope: 'project', trust: true } });

    // Verify it is trusted
    const showBefore = await apiShowExtension({ cwd: tmpDir, name: 'update-pkg' });
    expect(showBefore.data.extension.trustState).toBe('trusted');

    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() { return "updated"; }', 'utf-8');

    // Update without trust — should reinstall from the recorded source and clear the trust record
    const updateRes = await apiUpdateExtension({ cwd: tmpDir, body: { name: 'update-pkg' } });
    await expect(readFile(resolve(tmpDir, 'eforge', 'extensions', 'update-pkg', 'index.js'), 'utf-8')).resolves.toContain('updated');
    const data: ExtensionUpdateResponse = updateRes.data;
    expect(data.extension.name).toBe('update-pkg');
    expect(data.extension.trustState).toBe('untrusted');
    expect(data.extension.install).toBeDefined();
    expect(typeof data.message).toBe('string');

    // Update with explicit trust should write a fresh trust record and preserve trustedBy.
    const trustedUpdate = await apiUpdateExtension({ cwd: tmpDir, body: { name: 'update-pkg', trust: true, trustedBy: 'update-test' } });
    expect(trustedUpdate.data.extension).toMatchObject({
      name: 'update-pkg',
      trustState: 'trusted',
      trustedBy: 'update-test',
      trustedHash: trustedUpdate.data.extension.currentHash,
    });
  });

  it('POST extensionUpdate returns 409 when the target has no eforge install sidecar', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Create a handwritten extension (no sidecar)
    const handwrittenDir = resolve(tmpDir, '.eforge', 'extensions', 'handwritten');
    await mkdir(handwrittenDir, { recursive: true });
    await writeFile(resolve(handwrittenDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionUpdate}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'handwritten' }),
    });
    expect(res.status).toBe(409);
  });

  it('POST extensionRemove deletes an eforge-managed extension and refuses handwritten without force:true', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const pkgDir = resolve(tmpDir, 'remove-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'remove-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Install the extension
    await apiInstallExtension({ cwd: tmpDir, body: { source: './remove-pkg' } });
    const installedPath = resolve(tmpDir, '.eforge', 'extensions', 'remove-pkg');
    await expect(lstat(installedPath)).resolves.toBeDefined();

    // Remove it — should succeed (has sidecar)
    const removeRes = await apiRemoveExtension({ cwd: tmpDir, body: { name: 'remove-pkg' } });
    const data: ExtensionRemoveResponse = removeRes.data;
    expect(typeof data.message).toBe('string');
    expect(data.message).toContain('remove-pkg');
    await expect(lstat(installedPath)).rejects.toMatchObject({ code: 'ENOENT' });

    // Create a handwritten extension (no sidecar)
    const handwrittenDir = resolve(tmpDir, '.eforge', 'extensions', 'handwritten');
    await mkdir(handwrittenDir, { recursive: true });
    await writeFile(resolve(handwrittenDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    // Remove without force — 409
    const noForce = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionRemove}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'handwritten' }),
    });
    expect(noForce.status).toBe(409);

    // Remove with force — success
    const withForce = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionRemove}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'handwritten', force: true }),
    });
    expect(withForce.status).toBe(200);
    await expect(lstat(handwrittenDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('POST extensionPromote moves a project-local extension to project-team scope, clears trust, stages with git, and refuses collision without force', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    // Create a local extension (directory layout)
    const localExtDir = resolve(tmpDir, '.eforge', 'extensions', 'promote-me');
    await mkdir(localExtDir, { recursive: true });
    await writeFile(resolve(localExtDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    // Also create a team extension with same name for collision test
    const teamExtDir = resolve(tmpDir, 'eforge', 'extensions', 'promote-me');
    await mkdir(teamExtDir, { recursive: true });
    await writeFile(resolve(teamExtDir, 'index.js'), 'export default function extension() { /* team */ }', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Promote without force — 409 (collision with existing team extension)
    const noForce = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionPromote}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'promote-me' }),
    });
    expect(noForce.status).toBe(409);

    // Seed a stale trust record to verify promote clears it unless trust:true is supplied.
    await upsertTrustRecord(resolve(tmpDir, '.eforge'), 'promote-me', '0'.repeat(64), 'previous-test');

    // Promote with force succeeds and overwrites the colliding project-team target.
    const promoteRes = await apiPromoteExtension({ cwd: tmpDir, body: { name: 'promote-me', force: true } });
    const data: ExtensionPromoteResponse = promoteRes.data;
    expect(data.extension.name).toBe('promote-me');
    expect(data.extension.scope).toBe('project-team');
    expect(data.extension.trustState).toBe('untrusted');
    expect(data.extension.trustedHash).toBeUndefined();
    expect(typeof data.message).toBe('string');
    const trustStoreAfterPromote = JSON.parse(await readFile(resolve(tmpDir, '.eforge', 'extension-trust.json'), 'utf-8')) as { records: Array<{ name: string }> };
    expect(trustStoreAfterPromote.records.find((record) => record.name === 'promote-me')).toBeUndefined();

    // Local extension should be gone
    await expect(lstat(localExtDir)).rejects.toMatchObject({ code: 'ENOENT' });

    // Team extension should exist and contain the promoted local content, not the overwritten collision target.
    await expect(lstat(resolve(tmpDir, 'eforge', 'extensions', 'promote-me'))).resolves.toBeDefined();
    await expect(readFile(resolve(tmpDir, 'eforge', 'extensions', 'promote-me', 'index.js'), 'utf-8')).resolves.not.toContain('team');

    // Verify git staged the promoted path
    const gitStatus = execFileSync('git', ['status', '--porcelain'], { cwd: tmpDir, stdio: 'pipe' }).toString();
    expect(gitStatus).toMatch(/eforge[/\\]extensions[/\\]promote-me/);

    const trustedLocalDir = resolve(tmpDir, '.eforge', 'extensions', 'promote-trusted');
    await mkdir(trustedLocalDir, { recursive: true });
    await writeFile(resolve(trustedLocalDir, 'index.js'), 'export default function extension() {}', 'utf-8');
    const trustedPromote = await apiPromoteExtension({ cwd: tmpDir, body: { name: 'promote-trusted', trust: true, trustedBy: 'promote-test' } });
    expect(trustedPromote.data.extension).toMatchObject({
      name: 'promote-trusted',
      scope: 'project-team',
      trustState: 'trusted',
      trustedBy: 'promote-test',
      trustedHash: trustedPromote.data.extension.currentHash,
    });

    const localFile = resolve(tmpDir, '.eforge', 'extensions', 'promote-file.js');
    await writeFile(localFile, 'export default function extension() { return "file"; }', 'utf-8');
    const filePromote = await apiPromoteExtension({ cwd: tmpDir, body: { name: 'promote-file' } });
    expect(filePromote.data.extension).toMatchObject({ name: 'promote-file', scope: 'project-team' });
    await expect(lstat(localFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(resolve(tmpDir, 'eforge', 'extensions', 'promote-file.js'), 'utf-8')).resolves.toContain('file');
  });

  it('POST extensionDemote moves a project-team extension to project-local scope and refuses collision without force', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    // Create a team extension to demote
    const teamExtDir = resolve(tmpDir, 'eforge', 'extensions', 'demote-me');
    await mkdir(teamExtDir, { recursive: true });
    await writeFile(resolve(teamExtDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    // Demote succeeds
    const demoteRes = await apiDemoteExtension({ cwd: tmpDir, body: { name: 'demote-me' } });
    const data: ExtensionDemoteResponse = demoteRes.data;
    expect(data.extension.name).toBe('demote-me');
    expect(data.extension.scope).toBe('project-local');
    expect(typeof data.message).toBe('string');

    // Team extension should be gone
    await expect(lstat(teamExtDir)).rejects.toMatchObject({ code: 'ENOENT' });

    // Local extension should exist
    const localExtDir = resolve(tmpDir, '.eforge', 'extensions', 'demote-me');
    await expect(lstat(localExtDir)).resolves.toBeDefined();

    // Try to demote again — no team extension, 404
    const missingTeam = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionDemote}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'demote-me' }),
    });
    expect(missingTeam.status).toBe(404);

    // Collision: demote-me already exists in local scope
    const anotherTeamExt = resolve(tmpDir, 'eforge', 'extensions', 'demote-me');
    await mkdir(anotherTeamExt, { recursive: true });
    await writeFile(resolve(anotherTeamExt, 'index.js'), 'export default function extension() { /* v2 */ }', 'utf-8');

    const collision = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionDemote}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'demote-me' }),
    });
    expect(collision.status).toBe(409);

    // With force succeeds
    const withForce = await apiDemoteExtension({ cwd: tmpDir, body: { name: 'demote-me', force: true } });
    expect(withForce.data.extension.scope).toBe('project-local');

    const teamFile = resolve(tmpDir, 'eforge', 'extensions', 'demote-file.js');
    await writeFile(teamFile, 'export default function extension() { return "file"; }', 'utf-8');
    const fileDemote = await apiDemoteExtension({ cwd: tmpDir, body: { name: 'demote-file' } });
    expect(fileDemote.data.extension).toMatchObject({ name: 'demote-file', scope: 'project-local' });
    await expect(lstat(teamFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(resolve(tmpDir, '.eforge', 'extensions', 'demote-file.js'), 'utf-8')).resolves.toContain('file');
  });

  // --- end extension package management tests ---

  it('CLI extension validate exits with code 1 for an invalid ad-hoc extension path', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    const previousCwd = process.cwd();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      process.chdir(tmpDir);
      const program = createProgram(undefined, 'test');
      await expect(program.parseAsync([
        'node',
        'eforge',
        'extension',
        'validate',
        resolve(tmpDir, '.eforge', 'extensions', 'bad.js'),
        '--json',
      ])).rejects.toThrow('process.exit:1');
      expect(exitSpy).toHaveBeenCalledWith(1);
      const output = logSpy.mock.calls.map(([message]) => String(message)).join('\n');
      const data = JSON.parse(output) as ExtensionValidateResponse;
      expect(data.valid).toBe(false);
      expect(data.extensions).toEqual([
        expect.objectContaining({ name: 'bad', status: 'error' }),
      ]);
    } finally {
      process.chdir(previousCwd);
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
