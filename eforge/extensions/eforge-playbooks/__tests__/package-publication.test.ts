import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const repo = join(root, '../../..');

describe('eforge-playbooks package publication', () => {
  it('builds, imports, and packs only public files', async () => {
    if (!existsSync(join(root, 'dist/index.js')) || !existsSync(join(root, 'dist/index.d.ts'))) await execFileAsync('pnpm', ['--filter', '@eforge-build/eforge-playbooks...', 'build'], { cwd: repo, timeout: 120_000 });
    await import(pathToFileURL(join(root, 'dist/index.js')).href);
    const { stdout } = await execFileAsync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], { cwd: root, timeout: 30_000 });
    const files = JSON.parse(stdout)[0].files.map((f: { path: string }) => f.path);
    expect(files).toEqual(expect.arrayContaining(['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE', 'package.json']));
    expect(files.some((f: string) => /__tests__|node_modules|tsconfig\.json|tsup\.config\.ts/.test(f))).toBe(false);
  }, 120_000);
});
