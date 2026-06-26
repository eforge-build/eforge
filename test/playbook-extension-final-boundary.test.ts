import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

const contributionIds = [
  'eforge-playbooks:list-playbooks',
  'eforge-playbooks:show-playbook',
  'eforge-playbooks:save-playbook',
  'eforge-playbooks:validate-playbook',
  'eforge-playbooks:copy-playbook',
  'eforge-playbooks:promote-playbook',
  'eforge-playbooks:demote-playbook',
  'eforge-playbooks:run-playbook',
] as const;

const deletedBoundaryFiles = [
  'packages/client/src/api/playbook.ts',
  'packages/client/src/routes/playbook.ts',
  'packages/monitor/src/routes/playbooks.ts',
  'packages/monitor/src/routes/playbook-service.ts',
  'packages/input/src/playbook-workflow.ts',
  'packages/console-ui/src/views/system/playbooks-section.tsx',
] as const;

const scanRoots = [
  'packages/client/src',
  'packages/monitor/src',
  'packages/input/src',
  'packages/eforge/src',
  'packages/pi-eforge',
  'packages/console-ui/src',
  'eforge-plugin',
  'docs',
  'web/content',
  'web/public',
  'README.md',
] as const;

const skippedPathParts = new Set([
  'node_modules',
  'dist',
  '.git',
  '.eforge',
  '.next',
  '__tests__',
]);

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

function isTextFile(path: string): boolean {
  return [...textExtensions].some((extension) => path.endsWith(extension));
}

function shouldSkip(path: string): boolean {
  const relative = path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
  const parts = relative.split(sep);
  if (parts.some((part) => skippedPathParts.has(part))) return true;
  if (relative.startsWith(`eforge${sep}plans${sep}`)) return true;
  if (relative.includes(`${sep}generated-plan-worktrees${sep}`)) return true;
  if (relative.startsWith(`test${sep}`)) return true;
  return false;
}

function walkTextFiles(root: string): string[] {
  const absolute = resolve(repoRoot, root);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return isTextFile(absolute) ? [absolute] : [];
  const files: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(absolute, entry);
    if (shouldSkip(child)) continue;
    const stat = statSync(child);
    if (stat.isDirectory()) files.push(...walkTextFiles(child));
    else if (stat.isFile() && isTextFile(child)) files.push(child);
  }
  return files;
}

function scanForForbiddenTokens(tokens: string[]): Array<{ path: string; token: string }> {
  const failures: Array<{ path: string; token: string }> = [];
  const files = [...new Set(scanRoots.flatMap((root) => walkTextFiles(root)))];
  for (const absolute of files) {
    const contents = readFileSync(absolute, 'utf8');
    for (const token of tokens) {
      if (contents.includes(token)) failures.push({ path: absolute.slice(repoRoot.length + 1), token });
    }
  }
  return failures;
}

function toolBlock(source: string, name: string, nextName?: string): string {
  const startMatch = new RegExp(`name:\\s*['\"]${name}['\"]`).exec(source);
  expect(startMatch?.index ?? -1, `${name} should be registered`).toBeGreaterThanOrEqual(0);
  const start = startMatch?.index ?? 0;
  const endMatch = nextName ? new RegExp(`name:\\s*['\"]${nextName}['\"]`).exec(source.slice(start + 1)) : null;
  const end = endMatch ? start + 1 + endMatch.index : source.length;
  return source.slice(start, end > start ? end : source.length);
}

describe('playbook extension final boundary', () => {
  it('keeps removed direct daemon/client/input/Console playbook ownership files absent', () => {
    for (const path of deletedBoundaryFiles) {
      expect(existsSync(resolve(repoRoot, path)), `${path} should stay deleted`).toBe(false);
    }
  });

  it('keeps non-test source and docs free of stale direct playbook ownership tokens', () => {
    const directRoute = '/api/' + 'playbook';
    const forbidden = [
      directRoute,
      'api' + 'Playbook',
      'API_ROUTES.' + 'playbook',
      'PlaybookListResponse',
      'PlaybookRunRequest',
      'sessionPlanCreateFrom' + 'Playbook',
      'create-from-' + 'playbook',
      'createPlaybookWorkflowAdapter',
      'PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR',
      'builtin:' + 'playbooks',
      'PlaybooksSection',
      'fetchSystemPlaybookList',
      'selectPlaybookModeCounts',
    ];

    expect(scanForForbiddenTokens(forbidden)).toEqual([]);
  });

  it('registers @eforge-build/eforge-playbooks as a workspace, lockstep, and lockfile package', () => {
    expect(read('pnpm-workspace.yaml')).toContain('eforge/extensions/eforge-playbooks');
    expect(read('scripts/lib/lockstep-version.mjs')).toContain('eforge/extensions/eforge-playbooks/package.json');
    expect(read('pnpm-lock.yaml')).toMatch(/^\s{2}eforge\/extensions\/eforge-playbooks:/m);

    const pkg = readJson<any>('eforge/extensions/eforge-playbooks/package.json');

    expect(pkg.name).toBe('@eforge-build/eforge-playbooks');
    expect(pkg.exports['.'].import).toBe('./dist/index.js');
    expect(pkg.publishConfig?.access).toBe('public');
    expect(pkg.eforge?.extension?.name).toBe('eforge-playbooks');
    expect(pkg.eforge?.extension?.entrypoint).toBe('./dist/index.js');
    expect(pkg.eforge?.extension?.capabilities?.map((capability) => capability.name)).toEqual(
      expect.arrayContaining(['eforge.playbooks.management', 'eforge.playbooks.run']),
    );
    expect(pkg.eforge?.extension?.dependencies?.optional).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'eforge-plan',
          capabilities: expect.arrayContaining([
            expect.objectContaining({ name: 'eforge.plan.planning-workstation', version: '>=1.0.0' }),
          ]),
        }),
      ]),
    );
    expect(readJson<{ scripts?: Record<string, string> }>('package.json').scripts).toHaveProperty('type-check:eforge-playbooks');
  });

  it('keeps CLI, MCP, Pi, and skill playbook host surfaces delegated to generic eforge-playbooks contributions', () => {
    const cliHelper = read('packages/eforge/src/cli/playbook-contributions.ts');
    const piHelper = read('packages/pi-eforge/extensions/eforge/playbook-contributions.ts');
    for (const id of contributionIds) {
      expect(cliHelper, `CLI helper should define ${id}`).toContain(id);
      expect(piHelper, `Pi helper should define ${id}`).toContain(id);
    }

    const mcp = read('packages/eforge/src/cli/mcp-proxy.ts');
    const pi = read('packages/pi-eforge/extensions/eforge/index.ts');
    expect(toolBlock(mcp, 'eforge_playbook', 'eforge_session_plan')).toMatch(/['"]copy['"]/);
    expect(toolBlock(pi, 'eforge_playbook', 'eforge_session_plan')).toMatch(/['"]copy['"]/);

    const removedAction = 'create-from-' + 'playbook';
    for (const sessionPlanTool of [toolBlock(mcp, 'eforge_session_plan'), toolBlock(pi, 'eforge_session_plan')]) {
      expect(sessionPlanTool).not.toContain(removedAction);
      expect(sessionPlanTool).not.toContain('playbook_name');
    }

    const claudeSkill = read('eforge-plugin/skills/playbook/playbook.md');
    const piSkill = read('packages/pi-eforge/skills/eforge-playbook/SKILL.md');
    for (const skill of [claudeSkill, piSkill]) {
      expect(skill).toContain('eforge-playbooks');
      expect(skill).toContain('eforge-playbooks:run-playbook');
      expect(skill).toContain('eforge-playbooks:copy-playbook');
      expect(skill).not.toContain('/api/' + 'playbook');
      expect(skill).not.toContain(removedAction);
    }
    expect(claudeSkill).toContain('mcp__eforge__eforge_extension_contribution');
    expect(piSkill).toContain('eforge_extension_contribution');
  });
});
