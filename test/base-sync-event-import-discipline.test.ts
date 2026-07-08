import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..');

function collectTypeScriptFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) collectTypeScriptFiles(fullPath, files);
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) files.push(fullPath);
  }
  return files;
}

const scannedRoots = ['packages', 'test', 'eforge-plugin', 'web'];

const allowedPrefixes = [
  'packages/client/src/events/',
  'packages/client/src/events.schemas.ts',
  'packages/client/src/events.ts',
  'packages/client/src/index.ts',
  'packages/client/src/__tests__/',
  'test/base-sync-event-import-discipline.test.ts',
];

const forbiddenPatterns = [
  /interface\s+(?:\w*BaseSync\w*|\w*DirectPrBaseSync\w*)(?:Event|Payload)\w*\b/,
  /type\s+(?:\w*BaseSync\w*|\w*DirectPrBaseSync\w*)(?:Event|Payload)\w*\s*=/,
  /(?:const|interface|type)\s+(?:\w*BaseSync\w*|\w*DirectPrBaseSync\w*)Schema\b/,
  /type\s+\w+\s*=\s*[^;]*(?:'base-sync:[^']+'|"base-sync:[^"]+")/s,
  /interface\s+\w+\s*{[^}]*type\??:\s*(?:'base-sync:[^']+'|"base-sync:[^"]+")[^}]*}/s,
  /(?:z\.object|Type\.Object)\s*\(\s*{[\s\S]*?(?:'base-sync:[^']+'|"base-sync:[^"]+")/,
];

function hasForbiddenBaseSyncWireShape(content: string): boolean {
  return forbiddenPatterns.some((pattern) => pattern.test(content));
}

describe('base-sync event import discipline', () => {
  it('flags local schema facsimiles even without base-sync names', () => {
    expect(hasForbiddenBaseSyncWireShape("const Local = z.object({ type: z.literal('base-sync:start') });")).toBe(true);
    expect(hasForbiddenBaseSyncWireShape("const Local = Type.Object({ type: Type.Literal('base-sync:success') });")).toBe(true);
    expect(hasForbiddenBaseSyncWireShape("const unrelated = z.object({ type: z.literal('plan:start') });")).toBe(false);
  });

  it('does not redeclare base-sync event wire shapes outside the client event contract', () => {
    const files = scannedRoots.flatMap((root) => collectTypeScriptFiles(join(repoRoot, root)));
    const violations: string[] = [];

    for (const filePath of files) {
      const relPath = relative(repoRoot, filePath).replace(/\\/g, '/');
      if (allowedPrefixes.some((prefix) => relPath.startsWith(prefix))) continue;
      const content = readFileSync(filePath, 'utf8');
      if (hasForbiddenBaseSyncWireShape(content)) violations.push(relPath);
    }

    expect(violations).toEqual([]);
  });
});
