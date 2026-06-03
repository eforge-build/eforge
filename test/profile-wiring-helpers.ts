import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// Resolve paths relative to the repo root (one dir up from `test/`).
export const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf-8');
}

export function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error('No YAML frontmatter found in markdown');
  }
  const parsed = parseYaml(match[1]);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Frontmatter did not parse to an object');
  }
  return parsed as Record<string, unknown>;
}
