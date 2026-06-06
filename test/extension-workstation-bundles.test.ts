import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_ROUTES, buildPath, CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN, safeParseExtensionContributionManifest } from '@eforge-build/client';
import { getScopeDirectory, type ScopeResolverOpts } from '@eforge-build/scopes';
import {
  buildExtensionContributionManifest,
  findConsoleWorkstationBundleAsset,
  loadNativeExtensions,
} from '@eforge-build/engine/extensions';
import { validateConsoleWorkstationSpec } from '../packages/engine/src/extensions/contribution-validation.js';

import { useTempDir } from './test-tmpdir.js';

async function makeTree(root: string): Promise<ScopeResolverOpts> {
  process.env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
  const opts = { cwd: root, configDir: resolve(root, 'eforge') };
  await mkdir(resolve(getScopeDirectory('project-local', opts), 'extensions'), { recursive: true });
  await writeFile(resolve(root, 'package.json'), '{"type":"module"}\n', 'utf-8');
  return opts;
}

async function writeExtension(root: string, name: string, body: string, files: Record<string, string | Buffer> = {}) {
  const opts = await makeTree(root);
  const extensionRoot = resolve(getScopeDirectory('project-local', opts), 'extensions', name);
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(resolve(extensionRoot, 'index.js'), body, 'utf-8');
  for (const [path, content] of Object.entries(files)) {
    const fullPath = resolve(extensionRoot, path);
    await mkdir(resolve(fullPath, '..'), { recursive: true });
    await writeFile(fullPath, content);
  }
  return loadNativeExtensions({ cwd: opts.cwd, configDir: opts.configDir, config: { enabled: true, trustProjectExtensions: false } });
}

const validBundle = {
  id: 'workspace',
  title: 'Workspace',
  frameBundle: { root: 'workstation-assets/board', entrypoint: 'index.js', styles: ['style.css'], assets: ['logo.svg'], browserSdkVersion: 1 },
};

describe('extension workstation frameBundle runtime', () => {
  const makeTempDir = useTempDir('extension-workstation-bundles-');
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  });

  it('validates legacy srcDoc and frameBundle workstation registrations', () => {
    expect(validateConsoleWorkstationSpec({ id: 'workspace', title: 'Workspace', srcDoc: '<h1>Workspace</h1>' }).ok).toBe(true);
    const { browserSdkVersion: _browserSdkVersion, ...bundleWithoutSdkVersion } = validBundle.frameBundle;
    expect(validateConsoleWorkstationSpec(validBundle).ok).toBe(true);
    expect(validateConsoleWorkstationSpec({ ...validBundle, frameBundle: { ...validBundle.frameBundle, root: 'workstation-assets' } }).ok).toBe(true);
    expect(validateConsoleWorkstationSpec({ ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: 'index.mjs' } }).ok).toBe(true);
    expect(validateConsoleWorkstationSpec({ ...validBundle, frameBundle: bundleWithoutSdkVersion }).ok).toBe(true);
  });

  it.each([
    ['both source modes', { ...validBundle, srcDoc: '<p>x</p>' }, 'requires exactly one of srcDoc or frameBundle'],
    ['neither source mode', { id: 'workspace', title: 'Workspace' }, 'requires exactly one of srcDoc or frameBundle'],
    ['non-object frameBundle', { id: 'workspace', title: 'Workspace', frameBundle: 'workstation-assets/board' }, 'frameBundle must be an object'],
    ['absolute root', { ...validBundle, frameBundle: { ...validBundle.frameBundle, root: '/workstation-assets/board' } }, 'frameBundle.root'],
    ['root outside workstation-assets', { ...validBundle, frameBundle: { ...validBundle.frameBundle, root: 'assets' } }, 'workstation-assets'],
    ['absolute entrypoint', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: '/index.js' } }, 'frameBundle.entrypoint'],
    ['windows drive root', { ...validBundle, frameBundle: { ...validBundle.frameBundle, root: 'C:/workstation-assets/board' } }, 'frameBundle.root'],
    ['empty root', { ...validBundle, frameBundle: { ...validBundle.frameBundle, root: '' } }, 'frameBundle.root'],
    ['empty entrypoint', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: '' } }, 'frameBundle.entrypoint'],
    ['traversal segment', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: '../index.js' } }, 'frameBundle.entrypoint'],
    ['dot segment', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: './index.js' } }, 'frameBundle.entrypoint'],
    ['empty segment', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: 'dist//index.js' } }, 'frameBundle.entrypoint'],
    ['null byte', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: 'index\0.js' } }, 'frameBundle.entrypoint'],
    ['backslash', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: 'dist\\index.js' } }, 'frameBundle.entrypoint'],
    ['unsupported entrypoint extension', { ...validBundle, frameBundle: { ...validBundle.frameBundle, entrypoint: 'index.ts' } }, 'supported browser module extension'],
    ['unsupported style extension', { ...validBundle, frameBundle: { ...validBundle.frameBundle, styles: ['style.png'] } }, 'supported stylesheet extensions'],
    ['non-array styles', { ...validBundle, frameBundle: { ...validBundle.frameBundle, styles: 'style.css' } }, 'frameBundle.styles'],
    ['non-array assets', { ...validBundle, frameBundle: { ...validBundle.frameBundle, assets: 'logo.svg' } }, 'frameBundle.assets'],
    ['unsafe style path', { ...validBundle, frameBundle: { ...validBundle.frameBundle, styles: ['../style.css'] } }, 'frameBundle.styles[0]'],
    ['unsafe asset path', { ...validBundle, frameBundle: { ...validBundle.frameBundle, assets: ['logo\\evil.svg'] } }, 'frameBundle.assets[0]'],
    ['unsupported SDK', { ...validBundle, frameBundle: { ...validBundle.frameBundle, browserSdkVersion: 2 } }, 'frameBundle.browserSdkVersion'],
  ])('rejects invalid frameBundle source: %s', (_name, value, message) => {
    const result = validateConsoleWorkstationSpec(value);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(message);
  });

  it('projects bundle metadata, dedupes assets, validates schema, and resolves asset lookup', async () => {
    const result = await writeExtension(makeTempDir(), 'bundle', `import { Type } from '@eforge-build/extension-sdk';
    export default function extension(eforge) {
      eforge.registerAction({ id: 'open', title: 'Open', inputSchema: Type.Object({}), handler: () => ({ ok: true }) });
      eforge.registerAction({ id: 'other', title: 'Other', inputSchema: Type.Object({}), handler: () => ({ ok: true }) });
      eforge.registerConsoleWorkstation({ id: 'board', title: 'Board', frameBundle: { root: 'workstation-assets/board', entrypoint: 'index.js', styles: ['style.css', 'style.css'], assets: ['logo.svg', 'style.css', 'copy.js'] } });
      eforge.registerConsoleWorkstation({ id: 'empty-actions', title: 'Empty actions', allowedActions: [], frameBundle: { root: 'workstation-assets/board', entrypoint: 'index.js' } });
      eforge.registerConsoleWorkstation({ id: 'legacy', title: 'Legacy', srcDoc: '<p>Legacy</p>' });
    }`, {
      'workstation-assets/board/index.js': 'console.log("board");',
      'workstation-assets/board/style.css': 'body { color: red; }',
      'workstation-assets/board/logo.svg': '<svg/>',
      'workstation-assets/board/copy.js': 'console.log("board");',
    });

    const manifest = buildExtensionContributionManifest(result.registry);
    expect(safeParseExtensionContributionManifest(manifest).success).toBe(true);
    const workstation = manifest.consoleWorkstations.find((entry) => entry.id === 'bundle:board');
    expect(workstation).toBeDefined();
    expect(workstation && 'srcDoc' in workstation).toBe(false);
    expect(workstation && 'frameBundle' in workstation ? workstation.frameBundle.browserSdkVersion : undefined).toBe(1);
    if (!workstation || !('frameBundle' in workstation)) throw new Error('bundle workstation missing');
    expect(workstation.allowedActions).toEqual(['bundle:open', 'bundle:other']);
    expect(workstation.frameBundle.frameUrl).toBe(buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: workstation.id }));
    expect(workstation.frameBundle.styles.map((asset) => asset.relativePath)).toEqual(['workstation-assets/board/style.css']);
    expect(workstation.frameBundle.assets.map((asset) => asset.relativePath)).toEqual(['workstation-assets/board/logo.svg', 'workstation-assets/board/copy.js']);
    const refs = [workstation.frameBundle.entrypoint, ...workstation.frameBundle.styles, ...workstation.frameBundle.assets];
    for (const asset of refs) {
      expect(asset.id).toMatch(new RegExp(CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN));
      expect(asset.url).toBe(buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId: workstation.id, assetId: asset.id }));
    }
    expect(workstation.frameBundle.entrypoint.sha256).toBe(createHash('sha256').update('console.log("board");').digest('hex'));
    expect(workstation.frameBundle.entrypoint.id).toBe(`sha256-${workstation.frameBundle.entrypoint.sha256}-path-${createHash('sha256').update('index.js').digest('hex')}`);
    expect(workstation.frameBundle.entrypoint.id).not.toBe(workstation.frameBundle.assets[1]?.id);

    const emptyActions = manifest.consoleWorkstations.find((entry) => entry.id === 'bundle:empty-actions');
    expect(emptyActions?.allowedActions).toEqual([]);

    const lookup = findConsoleWorkstationBundleAsset(result.registry, workstation.id, workstation.frameBundle.entrypoint.id);
    expect(lookup).toMatchObject({ ok: true, asset: { absolutePath: await realpath(resolve(result.registry.extensions[0].path, 'workstation-assets/board/index.js')) } });
    expect(findConsoleWorkstationBundleAsset(result.registry, workstation.id, 'not-an-id')).toMatchObject({ ok: false, reason: 'malformed-asset-id' });
    const unknownId = `sha256-${'0'.repeat(64)}-path-${'1'.repeat(64)}`;
    expect(findConsoleWorkstationBundleAsset(result.registry, workstation.id, unknownId)).toMatchObject({ ok: false, reason: 'unknown-asset-id' });
    expect(findConsoleWorkstationBundleAsset(result.registry, 'missing:board', workstation.frameBundle.entrypoint.id)).toMatchObject({ ok: false, reason: 'unknown-workstation' });
    expect(findConsoleWorkstationBundleAsset(result.registry, 'bundle:legacy', workstation.frameBundle.entrypoint.id)).toMatchObject({ ok: false, reason: 'not-frame-bundle' });
  });

  it('keeps engine manifest projection free of inline API route literals', async () => {
    const source = await readFile(resolve('packages/engine/src/extensions/manifest.ts'), 'utf-8');

    expect(source).not.toContain('/api/');
  });

  it('emits diagnostics and omits bundle workstations with missing declared files', async () => {
    const result = await writeExtension(makeTempDir(), 'missing', `export default function extension(eforge) {
      eforge.registerConsoleWorkstation({ id: 'board', title: 'Board', frameBundle: { root: 'workstation-assets/board', entrypoint: 'missing.js' } });
    }`, { 'workstation-assets/board/present.js': 'console.log("present");' });
    const manifest = buildExtensionContributionManifest(result.registry);
    expect(manifest.consoleWorkstations).toHaveLength(0);
    expect(manifest.diagnostics).toContainEqual(expect.objectContaining({ code: 'extension:invalid-workstation-bundle', name: 'missing:board' }));
  });
});
