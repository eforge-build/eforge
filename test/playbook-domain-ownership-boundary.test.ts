import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

const deletedFiles = [
  'packages/eforge/src/cli/playbook.ts',
  'packages/eforge/src/cli/playbook-contributions.ts',
  'packages/pi-eforge/extensions/eforge/playbook-commands.ts',
  'packages/pi-eforge/extensions/eforge/playbook-contributions.ts',
  'packages/input/src/playbook.ts',
  'packages/input/src/playbook-plan-seed.ts',
  'packages/client/src/api/playbook.ts',
  'packages/client/src/routes/playbook.ts',
  'packages/monitor/src/routes/playbooks.ts',
  'eforge-plugin/skills/playbook/playbook.md',
  'packages/pi-eforge/skills/eforge-playbook/SKILL.md',
] as const;

const scanRoots = [
  'packages',
  'eforge-plugin',
  'eforge/extensions',
  'scripts',
  'docs',
  'web/content',
  'web/public',
  'README.md',
  'AGENTS.md',
  'pnpm-workspace.yaml',
  'package.json',
  'pnpm-lock.yaml',
] as const;

const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.txt', '.yaml', '.yml']);
const skippedParts = new Set([
  'node_modules',
  'dist',
  '.git',
  '.eforge',
  '.next',
  'coverage',
  'workstation-assets',
  'storybook-static',
]);

const forbiddenTokens = [
  'registerPlaybookCommands',
  'invokePlaybookContributionForHost',
  'invokePlaybookContributionIfRunning',
  'PLAYBOOK_CONTRIBUTION_IDS',
  'eforge_playbook',
  'eforge:playbook',
  'eforge playbook',
  'eforge play ',
  'playbookDraft',
  'PlanningPlaybookDraft',
  'planning-mode-playbook',
  'sessionPlanCreateFromPlaybook',
  'create-from-playbook',
  'apiPlaybook',
  'API_ROUTES.playbook',
  'PlaybookListResponse',
  'PlaybookRunRequest',
  'createPlaybookWorkflowAdapter',
  'PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR',
  'builtin:playbooks',
] as const;

const allowedBoundaryFiles = new Set([
  'test/playbook-domain-ownership-boundary.test.ts',
  'test/playbook-extension-contribution-flows.test.ts',
  'test/playbook-extension-docs-boundary.test.ts',
  'test/playbook-extension-final-boundary.test.ts',
  'test/playbook-daemon-boundary-removal.test.ts',
  'packages/console-ui/src/views/system/__tests__/playbook-console-boundary.test.tsx',
]);

const packageMetadataFiles = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'scripts/lib/lockstep-version.mjs',
  'scripts/agent-maintainability-baseline.json',
]);

function isTextFile(path: string): boolean {
  return [...textExtensions].some((extension) => path.endsWith(extension));
}

function shouldSkip(path: string): boolean {
  const relativePath = relative(repoRoot, path);
  const parts = relativePath.split(sep);
  if (parts.some((part) => skippedParts.has(part))) return true;
  if (relativePath.startsWith(`eforge${sep}plans${sep}`)) return true;
  if (relativePath.includes(`${sep}generated-plan-worktrees${sep}`)) return true;
  return false;
}

function walk(root: string): string[] {
  const absolute = resolve(repoRoot, root);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return isTextFile(absolute) ? [absolute] : [];
  return readdirSync(absolute).flatMap((entry) => {
    const child = join(absolute, entry);
    if (shouldSkip(child)) return [];
    const stat = statSync(child);
    if (stat.isDirectory()) return walk(relative(repoRoot, child));
    return stat.isFile() && isTextFile(child) ? [child] : [];
  });
}

function classify(path: string): string {
  if (path.startsWith('eforge/extensions/eforge-playbooks/')) return 'extension-owner';
  if (path.startsWith('test/') || path.includes('/__tests__/')) return allowedBoundaryFiles.has(path) ? 'boundary-test' : 'test-leak';
  if (packageMetadataFiles.has(path)) return 'package-metadata';
  if (path.startsWith('docs/') || path.startsWith('web/content/') || path.startsWith('web/public/') || path === 'README.md' || path === 'AGENTS.md') return 'docs';
  return 'leak';
}

function scannedFiles(): string[] {
  return [...new Set(scanRoots.flatMap((root) => walk(root)))];
}

function tokenFindings(): Array<{ path: string; token: string; classification: string }> {
  return scannedFiles().flatMap((absolute) => {
    const path = relative(repoRoot, absolute);
    const contents = readFileSync(absolute, 'utf-8');
    return forbiddenTokens
      .filter((token) => contents.includes(token))
      .map((token) => ({ path, token, classification: classify(path) }));
  });
}

function inputPlaybookImportFindings(): Array<{ path: string; importStatement: string; classification: string }> {
  const importFromInputPattern = /import\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]@eforge-build\/input['"];?/g;
  return scannedFiles().flatMap((absolute) => {
    const path = relative(repoRoot, absolute);
    const contents = readFileSync(absolute, 'utf-8');
    return [...contents.matchAll(importFromInputPattern)]
      .map((match) => match[0])
      .filter((importStatement) => /\b[Pp]laybook\w*\b/.test(importStatement))
      .map((importStatement) => ({ path, importStatement, classification: classify(path) }));
  });
}

function docsInputOwnershipFindings(): Array<{ path: string; line: string }> {
  const forbiddenDocsPattern = /@eforge-build\/input[^\n]*(?:playbook|Playbook)|pure playbook helpers|public input helpers/;
  return scannedFiles().flatMap((absolute) => {
    const path = relative(repoRoot, absolute);
    if (!(path === 'README.md' || path.startsWith('docs/') || path.startsWith('web/content/') || path.startsWith('web/public/') || path.startsWith('packages/scopes/') || path.startsWith('packages/docs-gen/src/'))) return [];
    return readFileSync(absolute, 'utf-8')
      .split(/\r?\n/)
      .filter((line) => forbiddenDocsPattern.test(line))
      .map((line) => ({ path, line }));
  });
}

describe('playbook domain ownership boundary', () => {
  it('keeps removed host, input, client, daemon, and skill playbook implementation files absent', () => {
    for (const path of deletedFiles) {
      expect(existsSync(resolve(repoRoot, path)), `${path} should stay deleted`).toBe(false);
    }
  });

  it('classifies every source-wide playbook ownership token and fails leaks outside the extension owner', () => {
    const findings = tokenFindings();
    const leaks = findings.filter(({ classification }) => classification === 'leak' || classification === 'test-leak');

    expect(leaks).toEqual([]);
  });

  it('keeps active docs and generated references free of removed host command, tool, route, and planning-field names', () => {
    const docFindings = tokenFindings().filter(({ classification }) => classification === 'docs');

    expect(docFindings).toEqual([]);
  });

  it('rejects playbook-specific imports from the domain-neutral input package', () => {
    expect(inputPlaybookImportFindings()).toEqual([]);
  });

  it('rejects docs that imply input owns playbook-specific helpers or semantics', () => {
    expect(docsInputOwnershipFindings()).toEqual([]);
  });

  it('keeps package metadata references limited to first-party extension inclusion', () => {
    const metadataFindings = tokenFindings().filter(({ classification }) => classification === 'package-metadata');

    expect(metadataFindings).toEqual([]);
    expect(readFileSync(resolve(repoRoot, 'pnpm-workspace.yaml'), 'utf-8')).toContain('eforge/extensions/eforge-playbooks');
    expect(readFileSync(resolve(repoRoot, 'scripts/lib/lockstep-version.mjs'), 'utf-8')).toContain('eforge/extensions/eforge-playbooks/package.json');
  });
});
