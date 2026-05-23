/**
 * Static guardrails for published Pi eforge panel safety.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXTENSION_ROOT = resolve(REPO_ROOT, 'packages/pi-eforge/extensions/eforge');

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectTsFiles(path));
    } else if (entry.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('published Pi eforge panel guardrails', () => {
  it('does not request floating overlays from extension TypeScript', () => {
    for (const file of collectTsFiles(EXTENSION_ROOT)) {
      const source = readFileSync(file, 'utf-8');
      expect(source, file).not.toMatch(/overlay:\s*true|overlayOptions/);
    }
  });

  it('eforge_confirm_build uses editor-first review and returns confirmed source', () => {
    const source = readRepoFile('packages/pi-eforge/extensions/eforge/index.ts');
    const start = source.indexOf('name: "eforge_confirm_build"');
    const end = source.indexOf('renderCall(args, theme)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);

    expect(block).toContain('ctx.ui.editor');
    expect(block).not.toContain('Markdown(params.source');
    expect(block).toContain('return jsonResult({ choice: "confirm", source });');
    expect(block).toContain('return jsonResult({ choice: "confirm", source: params.source');
  });
});
