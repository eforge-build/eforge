// --- eforge:region extension-tooling-routes-scaffold-trust ---
/**
 * Split in-process daemon route tests for native extension tooling surfaces.
 */

import { describe, it, expect, vi } from 'vitest';
import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { API_ROUTES, writeLockfile, apiListExtensions, apiNewExtension, apiReloadExtensions, apiShowExtension, apiTestExtension, apiValidateExtensions, apiTrustExtension, apiUntrustExtension, apiInstallExtension, apiUpdateExtension, apiRemoveExtension, apiPromoteExtension, apiDemoteExtension, type ExtensionListResponse, type ExtensionNewResponse, type ExtensionReloadResponse, type ExtensionShowResponse, type ExtensionTestResponse, type ExtensionValidateResponse, type ExtensionTrustResponse, type ExtensionInstallResponse, type ExtensionUpdateResponse, type ExtensionRemoveResponse, type ExtensionPromoteResponse, type ExtensionDemoteResponse } from '@eforge-build/client';
import { AutoBuildSupervisor } from '@eforge-build/monitor/auto-build-supervisor';
import { upsertTrustRecord } from '@eforge-build/engine/extensions';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { makeTempDir, setupProject, start, startWithDatabase, replayEvent, insertReplayRun, postExtensionTestRaw, postTrustRaw, openDatabase, startServer, server } from './extension-tooling-routes-helpers.js';

describe('extension tooling daemon routes: scaffold, reload, and trust', () => {
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
    const srv = await startWithDatabase(db, tmpDir, {
      daemonState: { autoBuildController: controller },
    });

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionReload}`, { method: 'POST' });
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
// --- eforge:endregion extension-tooling-routes-scaffold-trust ---
