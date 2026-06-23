import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  apiGetExtensionContributionManifest,
  apiInstallExtension,
  apiReloadExtensions,
  apiRemoveExtension,
  apiUpdateExtension,
  apiValidateExtensions,
  writeLockfile,
} from '@eforge-build/client';
import { makeTempDir, setupProject, start } from './extension-tooling-routes-helpers.js';

const execFileAsync = promisify(execFile);
const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const extensionRoot = join(repoRoot, 'eforge/extensions/eforge-plan');

let packedTarballPath: string;

async function ensureBuilt(): Promise<void> {
  await execFileAsync('pnpm', ['--filter', '@eforge-build/eforge-plan', 'build'], { cwd: repoRoot, timeout: 180_000 });
}

async function packEforgePlan(): Promise<string> {
  const packDir = await execFileAsync('mktemp', ['-d', join(tmpdir(), 'eforge-plan-pack-XXXXXX')]);
  const destination = packDir.stdout.trim();
  const { stdout } = await execFileAsync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], { cwd: extensionRoot, timeout: 60_000 });
  const packed = JSON.parse(stdout) as Array<{ filename: string }>;
  return join(destination, packed[0]!.filename);
}

function shouldCopyPackagePath(sourceRoot: string, candidatePath: string): boolean {
  const rel = candidatePath === sourceRoot ? '' : candidatePath.slice(sourceRoot.length + 1);
  if (!rel) return true;
  return !rel.split(sep).some((part) => ['node_modules', '.git'].includes(part));
}

async function copyPackageSource(destination: string, version: string): Promise<void> {
  await cp(extensionRoot, destination, {
    recursive: true,
    filter: (sourcePath) => shouldCopyPackagePath(extensionRoot, sourcePath),
  });
  const pkgPath = resolve(destination, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8')) as Record<string, unknown>;
  pkg.version = version;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

async function startFixtureProject(): Promise<{ tmpDir: string; port: number }> {
  const tmpDir = makeTempDir();
  await setupProject(tmpDir);
  const srv = await start(tmpDir);
  writeLockfile(tmpDir, { pid: process.pid, port: srv.port, startedAt: new Date().toISOString() });
  return { tmpDir, port: srv.port };
}

async function fetchFromManifestUrl(port: number, path: string): Promise<Response> {
  return fetch(new URL(path, `http://localhost:${port}`).href);
}

beforeAll(async () => {
  await ensureBuilt();
  packedTarballPath = await packEforgePlan();
}, 240_000);

describe('eforge-plan package management acceptance', () => {
  it('installs, validates, reloads, serves workstation assets, and removes a packed tarball', async () => {
    const { tmpDir, port } = await startFixtureProject();

    const install = await apiInstallExtension({ cwd: tmpDir, body: { source: packedTarballPath } });
    expect(install.data.extension.name).toBe('eforge-plan');
    expect(install.data.extension.install?.sourceKind).toBe('url');
    expect(install.data.extension.package).toMatchObject({ packageName: '@eforge-build/eforge-plan' });

    const validation = await apiValidateExtensions({ cwd: tmpDir, name: 'eforge-plan' });
    expect(validation.data.valid).toBe(true);

    const reload = await apiReloadExtensions({ cwd: tmpDir });
    const loaded = reload.data.extensions.find((entry) => entry.name === 'eforge-plan');
    expect(loaded?.status).toBe('loaded');
    expect(loaded?.registrations.actions).toBeGreaterThan(0);
    expect(loaded?.registrations.inputSources).toBeGreaterThan(0);
    expect(loaded?.registrations.deepLinks).toBeGreaterThan(0);
    expect(loaded?.registrations.integrationCommands).toBeGreaterThan(0);
    expect(loaded?.registrations.consoleWorkstations).toBeGreaterThan(0);

    const manifest = await apiGetExtensionContributionManifest({ cwd: tmpDir });
    const actionIds = manifest.actions.map((entry) => entry.id);
    expect(actionIds).toEqual(expect.arrayContaining([
      'eforge-plan:create-plan-revision-annotation',
      'eforge-plan:resolve-plan-revision-annotation',
      'eforge-plan:get-roadmap-state',
      'eforge-plan:update-roadmap-state',
    ]));
    expect(manifest.consoleWorkstations.map((entry) => entry.id)).toContain('eforge-plan:planning-workstation');
    expect(manifest.integrationCommands.map((entry) => entry.id)).toContain('eforge-plan:open-planning-entry');
    expect(manifest.deepLinks.map((entry) => entry.id)).toContain('eforge-plan:planning-workstation');

    const workstation = manifest.consoleWorkstations.find((entry) => entry.id === 'eforge-plan:planning-workstation');
    expect(workstation).toBeDefined();
    expect(workstation && 'frameBundle' in workstation).toBe(true);
    if (!workstation || !('frameBundle' in workstation)) throw new Error('Missing eforge-plan frame bundle');
    expect(workstation.subviews).toEqual([
      { id: 'roadmap', label: 'Roadmap', path: '?focus=roadmap' },
      { id: 'backlog', label: 'Backlog', path: '?focus=board' },
      { id: 'plans', label: 'Plans', path: '?focus=plans' },
    ]);

    const frame = await fetchFromManifestUrl(port, workstation.frameBundle.frameUrl);
    expect(frame.status).toBe(200);
    expect(frame.headers.get('content-type')).toContain('text/html');

    const entrypoint = await fetchFromManifestUrl(port, workstation.frameBundle.entrypoint.url);
    expect(entrypoint.status).toBe(200);
    await expect(entrypoint.text()).resolves.toContain('Revise with AI');

    expect(workstation.frameBundle.styles.length).toBeGreaterThan(0);
    const style = await fetchFromManifestUrl(port, workstation.frameBundle.styles[0]!.url);
    expect(style.status).toBe(200);
    expect(style.headers.get('content-type')).toContain('text/css');

    await apiRemoveExtension({ cwd: tmpDir, body: { name: 'eforge-plan' } });
    await expect(lstat(resolve(tmpDir, '.eforge', 'extensions', 'eforge-plan'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 240_000);

  it('updates an npm-style file source and clears or restores project-team trust', async () => {
    const { tmpDir } = await startFixtureProject();
    const sourceDir = resolve(tmpDir, 'eforge-plan-source');
    await copyPackageSource(sourceDir, '0.0.1-test.0');

    const install = await apiInstallExtension({ cwd: tmpDir, body: { source: 'file:./eforge-plan-source', scope: 'project', trust: true } });
    expect(install.data.extension.install?.sourceKind).toBe('npm');
    expect(install.data.extension.package?.version).toBe('0.0.1-test.0');
    expect(install.data.extension.trustState).toBe('trusted');

    await copyPackageSource(sourceDir, '0.0.2-test.0');
    const update = await apiUpdateExtension({ cwd: tmpDir, body: { name: 'eforge-plan' } });
    expect(update.data.previousVersion).toBe('0.0.1-test.0');
    expect(update.data.extension.package?.version).toBe('0.0.2-test.0');
    expect(update.data.extension.trustState).toBe('untrusted');

    const retrusted = await apiUpdateExtension({ cwd: tmpDir, body: { name: 'eforge-plan', trust: true, trustedBy: 'package-test' } });
    expect(retrusted.data.extension.trustState).toBe('trusted');
    expect(retrusted.data.extension.trustedBy).toBe('package-test');

    await rm(sourceDir, { recursive: true, force: true });
  }, 240_000);
});
