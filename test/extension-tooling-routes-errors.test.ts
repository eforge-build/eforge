/**
 * Split in-process daemon route tests for native extension tooling surfaces.
 */

import { describe, it, expect, vi } from 'vitest';
import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { API_ROUTES, writeLockfile, apiListExtensions, apiNewExtension, apiReloadExtensions, apiShowExtension, apiTestExtension, apiValidateExtensions, apiTrustExtension, apiUntrustExtension, apiInstallExtension, apiUpdateExtension, apiRemoveExtension, apiPromoteExtension, apiDemoteExtension, type ExtensionListResponse, type ExtensionNewResponse, type ExtensionReloadResponse, type ExtensionShowResponse, type ExtensionTestResponse, type ExtensionValidateResponse, type ExtensionTrustResponse, type ExtensionInstallResponse, type ExtensionUpdateResponse, type ExtensionRemoveResponse, type ExtensionPromoteResponse, type ExtensionDemoteResponse } from '@eforge-build/client';
import { AutoBuildSupervisor } from '@eforge-build/monitor/auto-build-supervisor';
import { upsertTrustRecord } from '@eforge-build/engine/extensions';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { makeTempDir, setupProject, start, startWithDatabase, replayEvent, insertReplayRun, postExtensionTestRaw, postTrustRaw, openDatabase, startServer, server } from './extension-tooling-routes-helpers.js';

describe('extension tooling daemon routes: errors', () => {
  function rawRequest(port: number, path: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: unknown): Promise<number> {
    return new Promise((resolveStatus, rejectStatus) => {
      const req = request({
        hostname: 'localhost',
        port,
        path,
        method,
        headers: { ...(method === 'POST' && { 'Content-Type': 'application/json' }), ...headers },
      }, (res) => {
        res.resume();
        res.on('end', () => resolveStatus(res.statusCode ?? 0));
      });
      req.on('error', rejectStatus);
      req.end(method === 'POST' ? JSON.stringify(body ?? {}) : undefined);
    });
  }

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

  it('extension new, reload, and read routes reject cross-origin callers and non-loopback Host headers', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    for (const route of [API_ROUTES.extensionNew, API_ROUTES.extensionReload]) {
      await expect(rawRequest(srv.port, route, 'POST', { Origin: 'http://evil.example' }), route).resolves.toBe(403);
      await expect(rawRequest(srv.port, route, 'POST', { Host: '192.0.2.1' }), route).resolves.toBe(403);
    }

    for (const route of [API_ROUTES.extensionList, API_ROUTES.extensionShow, API_ROUTES.extensionValidate]) {
      await expect(rawRequest(srv.port, route, 'GET', { Origin: 'http://evil.example' }), route).resolves.toBe(403);
      await expect(rawRequest(srv.port, route, 'GET', { Host: '192.0.2.1' }), route).resolves.toBe(403);
    }
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

  it('package mutation routes reject fields unsupported by that endpoint', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    const srv = await start(tmpDir);

    const rejectedCases: Array<{ route: string; body: Record<string, unknown> }> = [
      { route: API_ROUTES.extensionInstall, body: { source: './pkg', version: 'latest' } },
      { route: API_ROUTES.extensionInstall, body: { source: './pkg', path: './pkg' } },
      { route: API_ROUTES.extensionUpdate, body: { name: 'pkg', force: true } },
      { route: API_ROUTES.extensionRemove, body: { name: 'pkg', version: 'latest' } },
      { route: API_ROUTES.extensionRemove, body: { name: 'pkg', trust: true } },
      { route: API_ROUTES.extensionRemove, body: { name: 'pkg', trustedBy: 'tester' } },
      { route: API_ROUTES.extensionPromote, body: { name: 'pkg', version: 'latest' } },
      { route: API_ROUTES.extensionDemote, body: { name: 'pkg', version: 'latest' } },
      { route: API_ROUTES.extensionDemote, body: { name: 'pkg', trust: true } },
      { route: API_ROUTES.extensionDemote, body: { name: 'pkg', trustedBy: 'tester' } },
    ];

    for (const { route, body } of rejectedCases) {
      const res = await fetch(`http://localhost:${srv.port}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status, `${route} should reject ${JSON.stringify(body)}`).toBe(400);
    }
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
});
