import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const extensionRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const repoRoot = join(extensionRoot, '../../..');

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

async function ensureBuilt(): Promise<void> {
  const required = [
    'dist/index.js',
    'dist/backlog-curation-source-provider.js',
    'workstation-assets/plans/index.js',
    'workstation-assets/plans/style.css',
  ].map((rel) => join(extensionRoot, rel));
  if (required.every((path) => existsSync(path))) return;
  await execFileAsync('pnpm', ['--filter', '@eforge-build/eforge-plan', 'build'], { cwd: repoRoot, timeout: 180_000 });
}

async function npmPackDryRunFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], { cwd: extensionRoot, timeout: 60_000 });
  const parsed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0]?.files.map((file) => file.path).sort() ?? [];
}

async function listJsFiles(root: string, dir = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    const info = await stat(path);
    if (info.isDirectory()) files.push(...await listJsFiles(root, path));
    else if (entry.endsWith('.js')) files.push(relative(root, path));
  }
  return files;
}

const nodeBuiltinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

function isAllowedRuntimeImport(specifier: string): boolean {
  const rootSpecifier = specifier.startsWith('node:') ? specifier : specifier.split('/')[0]!;
  return specifier.startsWith('./') || specifier.startsWith('../') || nodeBuiltinSpecifiers.has(rootSpecifier) || nodeBuiltinSpecifiers.has(specifier);
}

function runtimeImportSpecifiers(source: string): string[] {
  const staticSpecifiers = [...source.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g)].map((match) => match[1]!);
  const dynamicSpecifiers = [...source.matchAll(/\bimport\(["']([^"']+)["']\)/g)].map((match) => match[1]!);
  return [...staticSpecifiers, ...dynamicSpecifiers];
}

describe('eforge-plan package publication artifact', () => {
  beforeAll(async () => {
    await ensureBuilt();
  }, 180_000);

  it('declares publishable first-party package metadata and release wiring', async () => {
    const pkg = await readJson(join(extensionRoot, 'package.json'));
    expect(pkg.name).toBe('@eforge-build/eforge-plan');
    expect(pkg.private).not.toBe(true);
    expect(pkg.publishConfig).toMatchObject({ access: 'public' });
    expect(pkg.files).toEqual(expect.arrayContaining(['dist/', 'workstation-assets/', 'README.md', 'LICENSE']));
    expect(pkg.eforge).toMatchObject({ extension: { name: 'eforge-plan', entrypoint: './dist/index.js' } });

    const workspace = await readFile(join(repoRoot, 'pnpm-workspace.yaml'), 'utf-8');
    expect(workspace).toContain('eforge/extensions/eforge-plan');
    const lockstep = await readFile(join(repoRoot, 'scripts/lib/lockstep-version.mjs'), 'utf-8');
    expect(lockstep).toContain('eforge/extensions/eforge-plan/package.json');
  });

  it('builds required runtime and workstation assets before packing', () => {
    for (const rel of [
      'dist/index.js',
      'dist/backlog-curation-source-provider.js',
      'workstation-assets/plans/index.js',
      'workstation-assets/plans/style.css',
    ]) {
      expect(existsSync(join(extensionRoot, rel)), rel).toBe(true);
    }
  });

  it('packs only compiled runtime, workstation assets, and package metadata', async () => {
    const files = await npmPackDryRunFiles();
    expect(files).toEqual(expect.arrayContaining([
      'dist/index.js',
      'dist/backlog-curation-source-provider.js',
      'workstation-assets/plans/index.js',
      'workstation-assets/plans/style.css',
      'README.md',
      'LICENSE',
      'package.json',
    ]));

    expect(files.filter((path) => path.startsWith('workstation-src/'))).toEqual([]);
    expect(files.filter((path) => path.startsWith('__tests__/'))).toEqual([]);
    expect(files.filter((path) => path.startsWith('node_modules/'))).toEqual([]);
    expect(files).not.toContain('tsup.config.ts');
    expect(files).not.toContain('tsconfig.json');
    expect(files.filter((path) => !path.startsWith('dist/') && path.endsWith('.ts'))).toEqual([]);
  });

  it('keeps compiled runtime self-contained for fresh-project imports', async () => {
    const runtimeFiles = await listJsFiles(join(extensionRoot, 'dist'));
    const violations: string[] = [];
    for (const rel of runtimeFiles) {
      const source = await readFile(join(extensionRoot, 'dist', rel), 'utf-8');
      if (/\.\.\/\.\.\/\.\.\/packages|\.\.\/\.\.\/\.\.\/\.\.\/packages|packages\/[^/]+\/src/.test(source)) {
        violations.push(`${rel}: repository source path`);
      }
      for (const specifier of runtimeImportSpecifiers(source)) {
        if (!isAllowedRuntimeImport(specifier) || specifier.startsWith('@eforge-build/')) violations.push(`${rel}: ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
