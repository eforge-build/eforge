import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';

const execFileAsync = promisify(execFile);
const extensionRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const repoRoot = join(extensionRoot, '../../..');

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

async function listRuntimeSourceFiles(dir = extensionRoot): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const rel = relative(extensionRoot, path);
    if (rel === '__tests__' || rel === 'dist' || rel === 'workstation-assets' || rel === 'workstation-src' || rel === 'node_modules') continue;
    const info = await stat(path);
    if (info.isDirectory()) files.push(...await listRuntimeSourceFiles(path));
    else if (entry.endsWith('.ts')) files.push(path);
  }
  return files;
}

async function ensureBuilt(): Promise<void> {
  const required = [
    join(extensionRoot, 'dist/index.js'),
    join(extensionRoot, 'dist/backlog-curation-source-provider.js'),
    join(extensionRoot, 'workstation-assets/plans/index.js'),
  ];
  if (required.every((path) => existsSync(path))) return;
  await execFileAsync('pnpm', ['--filter', '@eforge-build/eforge-plan', 'build'], { cwd: repoRoot, timeout: 120_000 });
}

describe('eforge-plan package foundation', () => {
  it('declares public package metadata, exports, dependencies, and build scripts', async () => {
    const pkg = await readJson(join(extensionRoot, 'package.json'));
    expect(pkg.name).toBe('@eforge-build/eforge-plan');
    expect(pkg.private).not.toBe(true);
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.publishConfig).toMatchObject({ access: 'public' });
    expect(pkg.eforge).toMatchObject({ extension: { name: 'eforge-plan', entrypoint: './dist/index.js' } });
    expect(pkg.exports).toMatchObject({ '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './package.json': './package.json' });
    expect(pkg.types).toBe('./dist/index.d.ts');
    expect(pkg.files).toEqual(expect.arrayContaining(['dist/', 'workstation-assets/', 'README.md', 'LICENSE']));
    expect(pkg.scripts).toEqual(expect.objectContaining({
      build: expect.stringContaining('build:workstation'),
      'build:runtime': expect.stringContaining('tsup'),
      'build:workstation': expect.stringContaining('workstation-src/plans'),
      'type-check': expect.stringContaining('tsc --noEmit'),
    }));
    expect(pkg.dependencies).toEqual(expect.objectContaining({
      '@eforge-build/client': 'workspace:*',
      '@eforge-build/extension-sdk': 'workspace:*',
      '@eforge-build/input': 'workspace:*',
      yaml: expect.any(String),
    }));
  });

  it('participates in workspace type-check and lockstep release metadata', async () => {
    const workspace = await readFile(join(repoRoot, 'pnpm-workspace.yaml'), 'utf-8');
    expect(workspace).toContain('eforge/extensions/eforge-plan');
    expect(workspace).toContain('eforge/extensions/eforge-plan/workstation-src/plans');

    const rootPkg = await readJson(join(repoRoot, 'package.json'));
    expect(rootPkg.scripts).toEqual(expect.objectContaining({
      'type-check': expect.stringContaining('pnpm -r type-check'),
      'type-check:eforge-plan': expect.stringContaining('@eforge-build/eforge-plan'),
    }));

    const lockstep = await readFile(join(repoRoot, 'scripts/lib/lockstep-version.mjs'), 'utf-8');
    expect(lockstep).toContain('eforge/extensions/eforge-plan/package.json');
  });

  it('scopes package type-check inputs away from generated and browser-only assets', async () => {
    const tsconfig = await readJson(join(extensionRoot, 'tsconfig.json'));
    expect(tsconfig.compilerOptions).toMatchObject({ noEmit: true, declaration: false });
    expect(tsconfig.include).toEqual(expect.arrayContaining(['**/*.ts', 'tsup.config.ts']));
    expect(tsconfig.exclude).toEqual(expect.arrayContaining(['dist', 'workstation-assets', 'workstation-src', '__tests__']));
  });

  it('records the new package importer and public workspace dependencies in the lockfile', async () => {
    const lockfile = await readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf-8');
    const importerStart = lockfile.indexOf('  eforge/extensions/eforge-plan:');
    const nextImporterStart = lockfile.indexOf('\n\n  ', importerStart + 1);
    const importer = lockfile.slice(importerStart, nextImporterStart);
    expect(importerStart).toBeGreaterThanOrEqual(0);
    expect(importer).toContain("'@eforge-build/client':");
    expect(importer).toContain("'@eforge-build/extension-sdk':");
    expect(importer).toContain("'@eforge-build/input':");
    expect(importer).toContain('yaml:');
    expect(importer).toContain("'@eforge-build/eforge-plan-workstation':");
    expect(importer).toContain('tsup:');
  });

  it('builds stable runtime entrypoints with bundled public dependencies', async () => {
    const source = await readFile(join(extensionRoot, 'tsup.config.ts'), 'utf-8');
    expect(source).toContain("index: 'index.ts'");
    expect(source).toContain("'backlog-curation-source-provider': 'backlog-curation-source-provider.ts'");
    expect(source).toContain('dts: true');
    expect(source).toContain('splitting: false');
    expect(source).toContain('skipNodeModulesBundle: false');
    for (const dependency of ['@eforge-build/client', '@eforge-build/extension-sdk', '@eforge-build/input', 'yaml', 'zod', '@sinclair/typebox']) {
      expect(source).toContain(`'${dependency}'`);
    }
    expect(source).toContain('external: [/^node:/]');
  });

  it('uses public package imports in runtime source', async () => {
    const files = await listRuntimeSourceFiles();
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf-8');
      if (/\.\.\/\.\.\/\.\.\/packages|\.\.\/\.\.\/\.\.\/\.\.\/packages|packages\/.*?\/src/.test(source)) violations.push(relative(extensionRoot, file));
    }
    expect(violations).toEqual([]);
  });

  it('uses the compiled backlog curation source-provider path', async () => {
    const source = await readFile(join(extensionRoot, 'backlog-curation-actions.ts'), 'utf-8');
    expect(source).toContain('./dist/backlog-curation-source-provider.js');
    expect(source).not.toContain('./backlog-curation-source-provider.ts');
  });

  it('builds import-safe runtime and workstation artifacts', async () => {
    await ensureBuilt();
    for (const rel of ['dist/index.js', 'dist/backlog-curation-source-provider.js', 'workstation-assets/plans/index.js', 'workstation-assets/plans/style.css']) {
      expect(existsSync(join(extensionRoot, rel)), rel).toBe(true);
    }

    const indexUrl = pathToFileURL(join(extensionRoot, 'dist/index.js')).href;
    await execFileAsync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(indexUrl)});`], { cwd: repoRoot, timeout: 30_000 });

    const mod = await import(indexUrl) as { default?: unknown };
    expect(typeof mod.default).toBe('function');

    const { api, state } = createExtensionRecorder('eforge-plan', join(extensionRoot, 'dist/index.js'));
    (mod.default as (api: unknown) => void)(api);
    expect(state.actions.length).toBeGreaterThan(0);
    expect(state.inputSources.length).toBeGreaterThan(0);
    expect(state.deepLinks.length).toBeGreaterThan(0);
    expect(state.integrationCommands.length).toBeGreaterThan(0);
    expect(state.consoleWorkstations.some((entry) => entry.value.frameBundle !== undefined)).toBe(true);

    for (const rel of ['dist/index.js', 'dist/backlog-curation-source-provider.js']) {
      const built = await readFile(join(extensionRoot, rel), 'utf-8');
      expect(built).not.toMatch(/\.\.\/\.\.\/\.\.\/packages|\.\.\/\.\.\/\.\.\/\.\.\/packages|packages\/.*?\/src/);
      expect(built).not.toMatch(/from ["']@eforge-build\//);
    }
  }, 120_000);
});
