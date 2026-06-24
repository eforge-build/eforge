import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

describe('engine agent task boundary', () => {
  it('does not contain eforge-plan prompt files or prompt loads in engine agent/prompt code', async () => {
    const promptFiles = await readdir('packages/engine/src/prompts');
    expect(promptFiles.filter((name) => name.startsWith('eforge-plan-') && name.endsWith('.md'))).toEqual([]);

    const files = await listFiles('packages/engine/src/agents');
    const violations: string[] = [];
    for (const file of files.filter((path) => /\.[cm]?tsx?$/.test(path))) {
      const source = await readFile(file, 'utf-8');
      if (/loadPrompt\(["']eforge-plan/.test(source) || /eforge-plan/.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
