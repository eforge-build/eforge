import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function repoPath(relative: string): string {
  return resolve(REPO_ROOT, relative);
}

function read(relative: string): string {
  return readFileSync(repoPath(relative), 'utf-8');
}

function expectPathAbsent(relative: string): void {
  expect(existsSync(repoPath(relative)), `${relative} should be absent`).toBe(false);
}

function listTextFilesUnder(relativeRoot: string): string[] {
  const absoluteRoot = repoPath(relativeRoot);
  const entries = readdirSync(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relative = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'dist' && entry.name !== 'node_modules') {
        files.push(...listTextFilesUnder(relative));
      }
    } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json|md|mdx|yaml|yml)$/.test(entry.name)) {
      if (statSync(repoPath(relative)).size < 1_000_000) files.push(relative);
    }
  }

  return files;
}

function compareSemver(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe('removed /eforge:plan host surfaces', () => {
  it('removes the native Pi command handler and registration', () => {
    const source = read('packages/pi-eforge/extensions/eforge/index.ts');

    expectPathAbsent('packages/pi-eforge/extensions/eforge/plan-command.ts');
    expect(source).not.toContain('handlePlanCommand');
    expect(source).not.toContain('./plan-command');
    expect(source).not.toContain('pi.registerCommand("eforge:plan"');
  });

  it('removes packaged Pi and Claude plan skills', () => {
    const manifest = JSON.parse(read('eforge-plugin/.claude-plugin/plugin.json')) as { commands: string[]; version: string };

    expectPathAbsent('packages/pi-eforge/skills/eforge-plan');
    expectPathAbsent('eforge-plugin/skills/plan');
    expect(manifest.commands).not.toContain('./skills/plan/plan.md');
    expect(compareSemver(manifest.version, '0.25.64')).toBeGreaterThan(0);
  });

  it('does not advertise the removed plan command or Pi plan skill forwarding target', () => {
    const removedSurfacePatterns = [
      '/eforge:plan',
      '/skill:eforge-plan',
      'pi.registerCommand("eforge:plan"',
      'handlePlanCommand',
      'skills/plan/plan.md',
    ];
    const files = [
      ...listTextFilesUnder('eforge-plugin'),
      ...listTextFilesUnder('packages/pi-eforge'),
      ...listTextFilesUnder('docs'),
      ...listTextFilesUnder('web/content'),
      ...listTextFilesUnder('web/public'),
    ];

    for (const relative of files) {
      const source = read(relative);
      for (const pattern of removedSurfacePatterns) {
        expect(source, `${relative} should not contain ${pattern}`).not.toContain(pattern);
      }
    }
  });
});

describe('generic eforge-plan planning entry remains', () => {
  it('keeps generic contribution discovery in MCP and Pi host surfaces', () => {
    expect(read('packages/eforge/src/cli/mcp-extension-contributions.ts')).toContain('eforge_extension_contribution');
    expect(read('packages/pi-eforge/extensions/eforge/extension-contributions.ts')).toContain('eforge_extension_contribution');
    expect(read('packages/pi-eforge/extensions/eforge/extension-contributions.ts')).toContain('eforge:extensions');
  });

  it('keeps eforge-plan workstation, deep-link, and contribution routing', () => {
    const source = read('eforge/extensions/eforge-plan/index.ts');

    expect(source).toContain('eforge-plan:open-planning-entry');
    expect(source).toContain('eforge-plan:planning-workstation');
    expect(source).toContain('/console/workstations/eforge-plan%3Aplanning-workstation');
    expect(source).toContain('registerIntegrationCommand');
    expect(source).toContain('registerDeepLink');
    expect(source).toContain('registerConsoleWorkstation');
  });
});
