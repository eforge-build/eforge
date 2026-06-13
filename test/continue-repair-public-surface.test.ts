import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function term(parts: string[]): string {
  return parts.join('');
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (path.includes('node_modules') || path.includes('/dist/')) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...listFiles(path));
    else if (/\.(ts|tsx|js|jsx|md|json)$/.test(path)) out.push(path);
  }
  return out;
}

function readFiles(paths: string[]): string {
  return paths.map((path) => `\n--- ${path} ---\n${readFileSync(path, 'utf-8')}`).join('\n');
}

function isAllowedSplitReference(path: string, line: string): boolean {
  return line.includes('split_to_followup')
    || line.includes('split that way')
    || line.includes('whitespace-split')
    || line.includes('vocabulary drops split')
    || path.includes('/__tests__/');
}

function activeRecoverySplitMatches(paths: string[]): string[] {
  const activeRecoverySplit = /\b(?:verdict|action|kind)\s*[:=]\s*['"]split['"]|['"]split['"]\s*(?:as\s+const)?\s*,?\s*\/\/\s*(?:recovery\s+)?(?:verdict|action|option)/;
  return paths.flatMap((path) => {
    const text = readFileSync(path, 'utf-8');
    return text
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => activeRecoverySplit.test(line) && !isAllowedSplitReference(path, line))
      .map(({ line, index }) => `${path}:${index + 1}: ${line.trim()}`);
  });
}

const publicSurfaceRoots = [
  'packages/client/src',
  'packages/monitor/src/routes',
  'packages/eforge/src/cli',
  'packages/pi-eforge/extensions/eforge',
  'packages/pi-eforge/skills/eforge-recover',
  'eforge-plugin/skills/recover',
  'docs',
  'web/content/docs',
  'web/content/reference',
  'web/public/docs',
  'web/public/reference',
  'web/public',
];

describe('continue-repair public surface', () => {
  it('exposes continue-repair route/tool names and removes old recovery aliases', () => {
    const source = readFiles(publicSurfaceRoots.flatMap(listFiles));

    expect(source).toContain('continueRepair');
    expect(source).toContain('/api/recover/continue-repair');
    expect(source).toContain('eforge_continue_repair');
    expect(source).not.toContain(term(['/api/recover/', 'resume', '-build']));
    expect(source).not.toContain(term(['api', 'Resume', 'Build']));
    expect(source).not.toContain(term(['resume', 'Build']));
    expect(source).not.toContain(term(['eforge_', 'resume_', 'build']));
  });

  it('keeps public extension docs on continue-and-repair terminology', () => {
    const publicExtensionDocs = readFiles([
      ...listFiles('docs').filter((path) => /extensions.*\.md$/.test(path)),
      ...listFiles('web/content/docs').filter((path) => /extensions.*\.md$/.test(path)),
      ...listFiles('web/public/docs').filter((path) => /extensions.*\.md$/.test(path)),
      'web/public/llms-full.txt',
      'packages/extension-sdk/README.md',
    ]);

    expect(publicExtensionDocs).toContain('continueRepair');
    expect(publicExtensionDocs).not.toContain('compiledResume');
    expect(publicExtensionDocs).not.toContain('QueueDispatchCompiledResume');
    expect(publicExtensionDocs).not.toContain('compiled-resume');
    expect(publicExtensionDocs).not.toContain('resume_*');
  });

  it('keeps recovery sidecars greenfield: no split successor fields or legacy recovery option actions', () => {
    const sidecarSurfaceFiles = [
      ...listFiles('packages/client/src/events'),
      ...listFiles('packages/client/src/routes'),
      ...listFiles('packages/engine/src/recovery'),
      ...listFiles('packages/monitor/src/routes'),
      ...listFiles('docs'),
      ...listFiles('web/content/docs'),
      ...listFiles('web/content/reference'),
      ...listFiles('web/public/docs'),
      ...listFiles('web/public/reference'),
      ...listFiles('web/public/schemas'),
      ...listFiles('web/public'),
    ];
    const sidecarSurface = readFiles(sidecarSurfaceFiles);
    const publicActionSurface = readFiles(
      sidecarSurfaceFiles.filter((path) => !path.endsWith('packages/engine/src/recovery/sidecar-read.ts')),
    );

    expect(sidecarSurface).toContain('continue-repair');
    expect(sidecarSurface).toContain('continueRepairEligibility');
    expect(sidecarSurface).not.toContain(term(['suggested', 'Successor', 'Prd']));
    expect(sidecarSurface).not.toContain(term(['eforge_', 'resume_', 'build']));
    expect(publicActionSurface).not.toContain(term(['compiled', '-build-', 'resume']));
    expect(sidecarSurface).toContain('split_to_followup');
    expect(activeRecoverySplitMatches(sidecarSurfaceFiles)).toEqual([]);
  });
});
