import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const repo = join(root, '../../..');
async function json(path: string) { return JSON.parse(await readFile(path, 'utf-8')); }
async function files(dir = root): Promise<string[]> { const out: string[] = []; for (const e of await readdir(dir)) { const p = join(dir, e); const r = relative(root, p); if (['__tests__', 'dist', 'node_modules'].includes(r)) continue; const s = await stat(p); if (s.isDirectory()) out.push(...await files(p)); else if (e.endsWith('.ts')) out.push(p); } return out; }

describe('eforge-playbooks package foundation', () => {
  it('declares metadata, workspace registration, lockstep wiring, and scripts', async () => {
    const pkg = await json(join(root, 'package.json'));
    expect(pkg).toMatchObject({ name: '@eforge-build/eforge-playbooks', version: '0.7.21', license: 'Apache-2.0', type: 'module', types: './dist/index.d.ts', eforge: { extension: { name: 'eforge-playbooks', entrypoint: './dist/index.js' } } });
    expect(pkg.files).toEqual(['dist/', 'README.md', 'LICENSE']);
    expect(pkg.dependencies).toMatchObject({ '@eforge-build/extension-sdk': 'workspace:*', '@eforge-build/input': 'workspace:*' });
    expect(await readFile(join(repo, 'pnpm-workspace.yaml'), 'utf-8')).toContain('eforge/extensions/eforge-playbooks');
    expect(await readFile(join(repo, 'scripts/lib/lockstep-version.mjs'), 'utf-8')).toContain('eforge/extensions/eforge-playbooks/package.json');
    expect((await json(join(repo, 'package.json'))).scripts['type-check:eforge-playbooks']).toContain('@eforge-build/eforge-playbooks');
    expect(await readFile(join(repo, 'pnpm-lock.yaml'), 'utf-8')).toContain('eforge/extensions/eforge-playbooks:');
  });
  it('keeps generated/test files out of tsconfig and uses only public imports', async () => {
    const tsconfig = await json(join(root, 'tsconfig.json'));
    expect(tsconfig.exclude).toEqual(expect.arrayContaining(['dist', '__tests__']));
    const tsup = await readFile(join(root, 'tsup.config.ts'), 'utf-8');
    expect(tsup).toContain('dts: true'); expect(tsup).toContain('splitting: false'); expect(tsup).toContain('skipNodeModulesBundle: false'); expect(tsup).toContain('external: [/^node:/]');
    const forbidden = ['packages/.*/src', 'createPlaybook' + 'WorkflowAdapter', 'builtin:' + 'playbooks', 'playbook-' + 'service', '/api/' + 'playbook', 'api' + 'Playbook'].map((part) => new RegExp(part));
    for (const file of await files()) {
      const source = await readFile(file, 'utf-8');
      expect(forbidden.some((pattern) => pattern.test(source))).toBe(false);
    }
    expect(existsSync(join(root, 'LICENSE'))).toBe(true);
  });
});
