import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = join(process.cwd(), 'packages/monitor/src');
const REGION_RE = /\/\/ --- eforge:region ([a-z0-9-]+) ---/;
const ENDREGION_RE = /\/\/ --- eforge:endregion ([a-z0-9-]+) ---/;

describe('monitor source region markers', () => {
  it('marks every production source file over 300 lines', () => {
    const failures: string[] = [];
    for (const file of productionTsFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      if (countLines(content) <= 300) continue;
      const rel = relative(process.cwd(), file);
      const error = validateMarkers(content);
      if (error) failures.push(`${rel}: ${error}`);
    }
    expect(failures).toEqual([]);
  });
});

function productionTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionTsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.endsWith('\n') ? content.split('\n').length - 1 : content.split('\n').length;
}

function validateMarkers(content: string): string | null {
  const stack: string[] = [];
  let sawRegion = false;
  let sawEndregion = false;
  for (const line of content.split('\n')) {
    const region = REGION_RE.exec(line);
    if (region) {
      sawRegion = true;
      stack.push(region[1]);
      continue;
    }
    const endregion = ENDREGION_RE.exec(line);
    if (endregion) {
      sawEndregion = true;
      const expected = stack.pop();
      if (expected !== endregion[1]) return `unbalanced endregion ${endregion[1]}`;
    }
  }
  if (!sawRegion || !sawEndregion) return 'missing durable eforge region markers';
  if (stack.length > 0) return `unclosed region ${stack[stack.length - 1]}`;
  return null;
}
