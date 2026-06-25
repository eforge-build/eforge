import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const extensionRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const repoRoot = join(extensionRoot, '../../..');
const promptAssets = [
  'prompts/eforge-plan-planning-draft.md',
  'prompts/eforge-plan-backlog-curation-item-audit.md',
  'prompts/eforge-plan-backlog-curation-reducer.md',
];

async function npmPackDryRunFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], { cwd: extensionRoot, timeout: 60_000 });
  const parsed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0]?.files.map((file) => file.path).sort() ?? [];
}

describe('eforge-plan prompt assets', () => {
  it('keeps all model-facing eforge-plan prompts under extension-owned source', async () => {
    for (const asset of promptAssets) expect(existsSync(join(extensionRoot, asset)), asset).toBe(true);
    expect(await readFile(join(extensionRoot, promptAssets[0]!), 'utf-8')).toContain('Submit exactly once. Do not finish with prose.');
    expect(await readFile(join(extensionRoot, promptAssets[1]!), 'utf-8')).toContain('You are auditing exactly one validated backlog item');
    expect(await readFile(join(extensionRoot, promptAssets[2]!), 'utf-8')).toContain('Do not use repository, filesystem, shell, network, or mutation tools');
  });

  it('publishes prompt assets and removes engine-owned eforge-plan prompts', async () => {
    const pkg = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf-8')) as { files?: string[] };
    expect(pkg.files).toEqual(expect.arrayContaining(['prompts/']));
    const packed = await npmPackDryRunFiles();
    expect(packed).toEqual(expect.arrayContaining(promptAssets));
    const enginePrompts = await readdir(join(repoRoot, 'packages/engine/src/prompts'));
    expect(enginePrompts.filter((name) => name.startsWith('eforge-plan-') && name.endsWith('.md'))).toEqual([]);
  }, 70_000);
});
