// --- eforge:region extension-tooling-routes-package-management ---
/**
 * Split in-process daemon route tests for native extension tooling surfaces.
 */

import { describe, it, expect, vi } from 'vitest';
import { chmod, lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { API_ROUTES, DAEMON_API_VERSION, writeLockfile, apiListExtensions, apiNewExtension, apiReloadExtensions, apiShowExtension, apiTestExtension, apiValidateExtensions, apiTrustExtension, apiUntrustExtension, apiInstallExtension, apiUpdateExtension, apiRemoveExtension, apiPromoteExtension, apiDemoteExtension, type ExtensionListResponse, type ExtensionNewResponse, type ExtensionReloadResponse, type ExtensionShowResponse, type ExtensionTestResponse, type ExtensionValidateResponse, type ExtensionTrustResponse, type ExtensionInstallResponse, type ExtensionUpdateResponse, type ExtensionRemoveResponse, type ExtensionPromoteResponse, type ExtensionDemoteResponse } from '@eforge-build/client';
import { AutoBuildSupervisor } from '@eforge-build/monitor/auto-build-supervisor';
import { readInstallSidecar, upsertTrustRecord, writeInstallSidecar } from '@eforge-build/engine/extensions';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { makeTempDir, setupProject, start, startWithDatabase, replayEvent, insertReplayRun, postExtensionTestRaw, postTrustRaw, openDatabase, startServer, server } from './extension-tooling-routes-helpers.js';

describe('extension tooling daemon routes: package management', () => {
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

  it('POST extensionUpdate applies version overrides only to npm sidecar sources', async () => {
    const source = await readFile('packages/monitor/src/extension-package-management.ts', 'utf-8');
    const updateBlock = source.slice(
      source.indexOf('export async function updateExtensionPackage'),
      source.indexOf('export interface RemoveExtensionResult'),
    );
    expect(updateBlock).toContain("assertOptionalString(body.version, 'version')");
    expect(updateBlock).toContain('if (body.version !== undefined)');
    expect(updateBlock).toContain("if (sidecar.sourceKind !== 'npm')");
    expect(updateBlock).toContain('assertRegistryNpmPackageSpecForVersionOverride(sidecar.sourceSpec)');
    expect(updateBlock).toContain('assertRegistryNpmVersionSpecifierForOverride(body.version)');
    expect(updateBlock).toContain('effectiveSpec = updateNpmSpecVersion(sidecar.sourceSpec, body.version)');
    expect(updateBlock).toContain('assertRegistryNpmPackageSpecForVersionOverride(effectiveSpec)');
    expect(updateBlock).toContain("if (sidecar.sourceKind === 'npm')");
    expect(updateBlock).toContain('acquireFromNpm(effectiveSpec, cwd)');
    expect(updateBlock).toContain('sourceSpec: effectiveSpec');
    expect(updateBlock).toContain('acquireFromTarball(sidecar.sourceSpec, cwd)');
    expect(updateBlock).toContain('acquireFromLocalDir(sidecar.sourceSpec, cwd)');
  });

  it('POST extensionUpdate persists the effective source spec for version-pinned npm updates', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const installedDir = resolve(tmpDir, '.eforge', 'extensions', 'registry-pkg');
    await mkdir(installedDir, { recursive: true });
    await writeFile(resolve(installedDir, 'package.json'), JSON.stringify({ name: 'registry-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(installedDir, 'index.js'), 'export default function extension() {}', 'utf-8');
    await writeInstallSidecar(installedDir, {
      sourceKind: 'npm',
      sourceSpec: 'registry-pkg@1.0.0',
      resolvedVersion: '1.0.0',
      targetScope: 'project-local',
    });

    const fakeBin = resolve(tmpDir, 'fake-bin');
    await mkdir(fakeBin, { recursive: true });
    const fakeNpm = resolve(fakeBin, 'npm');
    await writeFile(fakeNpm, `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const packDestArg = process.argv.find((arg) => arg.startsWith('--pack-destination='));
const packDest = packDestArg.split('=')[1];
const spec = process.argv[process.argv.length - 1];
const version = spec.split('@').pop();
const root = mkdtempSync(join(tmpdir(), 'fake-npm-pack-'));
const pkg = join(root, 'package');
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'registry-pkg', version }));
writeFileSync(join(pkg, 'index.js'), 'export default function extension() { return "updated"; }');
const filename = 'registry-pkg-' + version + '.tgz';
execFileSync('tar', ['-czf', resolve(packDest, filename), '-C', root, 'package']);
process.stdout.write(JSON.stringify([{ name: 'registry-pkg', version, filename }]));
`, 'utf-8');
    await chmod(fakeNpm, 0o755);

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });
    const oldPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${oldPath ?? ''}`;
    try {
      const updateRes = await apiUpdateExtension({ cwd: tmpDir, body: { name: 'registry-pkg', version: '2.0.0' } });
      expect(updateRes.data.previousVersion).toBe('1.0.0');
      expect(updateRes.data.extension.install?.sourceSpec).toBe('registry-pkg@2.0.0');
      expect(updateRes.data.extension.install?.resolvedVersion).toBe('2.0.0');
      const sidecar = await readInstallSidecar(installedDir);
      expect(sidecar.data?.sourceSpec).toBe('registry-pkg@2.0.0');
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it('POST extensionUpdate rejects version overrides for npm file sidecar sources', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const pkgDir = resolve(tmpDir, 'file-source-pkg');
    await mkdir(pkgDir, { recursive: true });
    await writeFile(resolve(pkgDir, 'package.json'), JSON.stringify({ name: 'file-source-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(pkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });
    await apiInstallExtension({ cwd: tmpDir, body: { source: 'file:./file-source-pkg' } });

    const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionUpdate}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'file-source-pkg', version: 'latest' }),
    });
    expect(res.status).toBe(400);
    await expect(res.text()).resolves.toContain('Version overrides are supported only for registry npm package specs');
  });

  it('POST extensionUpdate rejects invalid registry npm version override specifiers', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const installedDir = resolve(tmpDir, '.eforge', 'extensions', 'registry-pkg');
    await mkdir(installedDir, { recursive: true });
    await writeFile(resolve(installedDir, 'package.json'), JSON.stringify({ name: 'registry-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(installedDir, 'index.js'), 'export default function extension() {}', 'utf-8');
    await writeInstallSidecar(installedDir, {
      sourceKind: 'npm',
      sourceSpec: 'registry-pkg',
      targetScope: 'project-local',
    });

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    for (const version of ['file:./other-pkg', '../other-pkg', 'https://example.com/ext.tgz', 'github:user/repo', 'user/repo', 'ext-1.0.0.tgz']) {
      const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionUpdate}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'registry-pkg', version }),
      });
      expect(res.status, `Expected 400 for version: ${version}`).toBe(400);
      await expect(res.text()).resolves.toContain('Version overrides must be registry npm versions');
    }
  });

  it('POST extensionUpdate rejects version overrides for path and tarball sidecar sources', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const pathPkgDir = resolve(tmpDir, 'path-version-pkg');
    await mkdir(pathPkgDir, { recursive: true });
    await writeFile(resolve(pathPkgDir, 'package.json'), JSON.stringify({ name: 'path-version-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(pathPkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');

    const tarPkgDir = resolve(tmpDir, 'tar-version-pkg');
    await mkdir(tarPkgDir, { recursive: true });
    await writeFile(resolve(tarPkgDir, 'package.json'), JSON.stringify({ name: 'tar-version-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(tarPkgDir, 'index.js'), 'export default function extension() {}', 'utf-8');
    execFileSync('npm', ['pack', '--ignore-scripts', `--pack-destination=${tmpDir}`], { cwd: tarPkgDir, stdio: 'pipe' });

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });
    await apiInstallExtension({ cwd: tmpDir, body: { source: './path-version-pkg' } });
    await apiInstallExtension({ cwd: tmpDir, body: { source: './tar-version-pkg-1.0.0.tgz' } });

    for (const name of ['path-version-pkg', 'tar-version-pkg']) {
      const res = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionUpdate}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, version: 'latest' }),
      });
      expect(res.status, `Expected 400 for ${name}`).toBe(400);
      await expect(res.text()).resolves.toContain('Version overrides are supported only for registry npm package specs');
    }
  });

  it('requires a daemon API version new enough for version-pinned extension updates', () => {
    expect(DAEMON_API_VERSION).toBeGreaterThanOrEqual(70);
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

  it('supports path selectors for update, remove, promote, and demote while rejecting symlink paths', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);

    const srv = await start(tmpDir);
    writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });

    const updateSource = resolve(tmpDir, 'path-update-pkg');
    await mkdir(updateSource, { recursive: true });
    await writeFile(resolve(updateSource, 'package.json'), JSON.stringify({ name: 'path-update-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(updateSource, 'index.js'), 'export default function extension() { return "old"; }', 'utf-8');
    await apiInstallExtension({ cwd: tmpDir, body: { source: './path-update-pkg' } });
    await writeFile(resolve(updateSource, 'index.js'), 'export default function extension() { return "updated-by-path"; }', 'utf-8');

    const updateByPath = await apiUpdateExtension({ cwd: tmpDir, body: { path: '.eforge/extensions/path-update-pkg' } });
    expect(updateByPath.data.extension.name).toBe('path-update-pkg');
    await expect(readFile(resolve(tmpDir, '.eforge', 'extensions', 'path-update-pkg', 'index.js'), 'utf-8')).resolves.toContain('updated-by-path');

    const removeSource = resolve(tmpDir, 'path-remove-pkg');
    await mkdir(removeSource, { recursive: true });
    await writeFile(resolve(removeSource, 'package.json'), JSON.stringify({ name: 'path-remove-pkg', version: '1.0.0' }), 'utf-8');
    await writeFile(resolve(removeSource, 'index.js'), 'export default function extension() {}', 'utf-8');
    await apiInstallExtension({ cwd: tmpDir, body: { source: './path-remove-pkg' } });
    await apiRemoveExtension({ cwd: tmpDir, body: { path: '.eforge/extensions/path-remove-pkg' } });
    await expect(lstat(resolve(tmpDir, '.eforge', 'extensions', 'path-remove-pkg'))).rejects.toMatchObject({ code: 'ENOENT' });

    const promoteLocalDir = resolve(tmpDir, '.eforge', 'extensions', 'path-promote');
    await mkdir(promoteLocalDir, { recursive: true });
    await writeFile(resolve(promoteLocalDir, 'index.js'), 'export default function extension() { return "promoted"; }', 'utf-8');
    const promoteByPath = await apiPromoteExtension({ cwd: tmpDir, body: { path: '.eforge/extensions/path-promote' } });
    expect(promoteByPath.data.extension).toMatchObject({ name: 'path-promote', scope: 'project-team' });
    await expect(readFile(resolve(tmpDir, 'eforge', 'extensions', 'path-promote', 'index.js'), 'utf-8')).resolves.toContain('promoted');

    const demoteTeamDir = resolve(tmpDir, 'eforge', 'extensions', 'path-demote');
    await mkdir(demoteTeamDir, { recursive: true });
    await writeFile(resolve(demoteTeamDir, 'index.js'), 'export default function extension() { return "demoted"; }', 'utf-8');
    const demoteByPath = await apiDemoteExtension({ cwd: tmpDir, body: { path: 'eforge/extensions/path-demote' } });
    expect(demoteByPath.data.extension).toMatchObject({ name: 'path-demote', scope: 'project-local' });
    await expect(readFile(resolve(tmpDir, '.eforge', 'extensions', 'path-demote', 'index.js'), 'utf-8')).resolves.toContain('demoted');

    const symlinkPath = resolve(tmpDir, '.eforge', 'extensions', 'path-update-link');
    await symlink(resolve(tmpDir, '.eforge', 'extensions', 'path-update-pkg'), symlinkPath, 'dir');
    const rejected = await fetch(`http://localhost:${srv.port}${API_ROUTES.extensionUpdate}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '.eforge/extensions/path-update-link' }),
    });
    expect(rejected.status).toBe(400);
  });

  // --- end extension package management tests ---
});
// --- eforge:endregion extension-tooling-routes-package-management ---
