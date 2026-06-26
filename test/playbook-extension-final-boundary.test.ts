import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

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

  it('keeps CLI, MCP, Pi, and skill playbook host surfaces removed while generic contribution APIs remain', () => {
    const removedHostFiles = [
      'packages/eforge/src/cli/playbook.ts',
      'packages/eforge/src/cli/playbook-contributions.ts',
      'packages/pi-eforge/extensions/eforge/playbook-commands.ts',
      'packages/pi-eforge/extensions/eforge/playbook-contributions.ts',
      'eforge-plugin/skills/playbook/playbook.md',
      'packages/pi-eforge/skills/eforge-playbook/SKILL.md',
    ];
    for (const path of removedHostFiles) {
      expect(existsSync(resolve(repoRoot, path)), `${path} should stay deleted`).toBe(false);
    }

    const cli = read('packages/eforge/src/cli/index.ts');
    const cliContributions = read('packages/eforge/src/cli/extension-contributions.ts');
    const mcp = read('packages/eforge/src/cli/mcp-proxy.ts');
    const mcpContributions = read('packages/eforge/src/cli/mcp-extension-contributions.ts');
    const pi = read('packages/pi-eforge/extensions/eforge/index.ts');
    const piExtensions = read('packages/pi-eforge/extensions/eforge/extension-contributions.ts');
    const plugin = readJson<{ commands?: string[] }>('eforge-plugin/.claude-plugin/plugin.json');

    expect(cli).toContain('registerExtensionContributionCommands(extension)');
    expect(cliContributions).toContain(".command('contributions')");
    expect(mcp).toContain('registerExtensionContributionMcpTool(server, cwd)');
    expect(mcpContributions).toContain('eforge_extension_contribution');
    expect(pi).toContain('registerExtensionContributionTool(pi)');
    expect(piExtensions).toContain('eforge_extension_contribution');
    expect(piExtensions).toContain('eforge:extensions');
    expect(plugin.commands ?? []).not.toContain('./skills/playbook/playbook.md');

    for (const source of [cli, cliContributions, mcp, mcpContributions, pi, piExtensions]) {
      expect(source).not.toContain('eforge_playbook');
      expect(source).not.toContain('eforge:playbook');
      expect(source).not.toContain('PLAYBOOK_CONTRIBUTION_IDS');
      expect(source).not.toContain('invokePlaybookContributionForHost');
      expect(source).not.toMatch(/eforge-playbooks:[a-z-]+/);
    }
  });
});
