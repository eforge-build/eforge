import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTE_ROOT = join(process.cwd(), 'packages/monitor/src/routes');
const CONTENT_ROUTE_FILES = [
  'extension-content.ts',
  'content-validation.ts',
  'playbooks.ts',
  'playbook-service.ts',
  'session-plans.ts',
  'session-plan-service.ts',
  'session-plan-sets.ts',
  'session-plan-set-service.ts',
  ...walk(join(ROUTE_ROOT, 'extensions')).map((path) => relative(ROUTE_ROOT, path)),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return path.endsWith('.ts') ? [path] : [];
  }).sort();
}

function readRouteFile(relativePath: string): string {
  return readFileSync(join(ROUTE_ROOT, relativePath), 'utf-8');
}

function productionLines(relativePath: string): string[] {
  return readRouteFile(relativePath).split('\n');
}

describe('extension content route source contracts', () => {
  it('does not embed daemon endpoint path literals in content route modules', () => {
    for (const file of CONTENT_ROUTE_FILES) {
      expect(readRouteFile(file), file).not.toMatch(/["'`]\/api\//);
    }
  });

  it('does not redeclare JSON parsing or response helper implementations', () => {
    for (const file of CONTENT_ROUTE_FILES) {
      const source = readRouteFile(file);
      expect(source, file).not.toMatch(/\bfunction\s+parseJsonBody\b|\bconst\s+parseJsonBody\b/);
      expect(source, file).not.toMatch(/\bfunction\s+sendJson(?:Error)?\b|\bconst\s+sendJson(?:Error)?\b/);
    }
  });

  it('does not declare duplicate client-owned response wire shapes', () => {
    for (const file of CONTENT_ROUTE_FILES) {
      const declarations = productionLines(file).filter((line) => !line.trimStart().startsWith('import '))
        .filter((line) => /\b(?:interface|type)\s+\w*Response\b/.test(line));
      expect(declarations, file).toEqual([]);
    }
  });

  it('keeps input and extension discovery dependencies lazy inside services', () => {
    for (const file of CONTENT_ROUTE_FILES) {
      const staticFeatureImports = productionLines(file).filter((line) => /^import\s/.test(line))
        .filter((line) => /from ['"](?:@eforge-build\/input|@eforge-build\/engine\/extensions\/index)['"]/.test(line));
      expect(staticFeatureImports, file).toEqual([]);
    }
  });

  it('does not import server-main from extension content route modules', () => {
    for (const file of CONTENT_ROUTE_FILES) {
      const serverMainImports = productionLines(file).filter((line) => /^import\s/.test(line))
        .filter((line) => /server-main\.js['"]/.test(line));
      expect(serverMainImports, file).toEqual([]);
    }
  });
});
