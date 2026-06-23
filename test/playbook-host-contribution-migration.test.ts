import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const contributionIds = {
  list: 'eforge-playbooks:list-playbooks',
  show: 'eforge-playbooks:show-playbook',
  save: 'eforge-playbooks:save-playbook',
  validate: 'eforge-playbooks:validate-playbook',
  copy: 'eforge-playbooks:copy-playbook',
  promote: 'eforge-playbooks:promote-playbook',
  demote: 'eforge-playbooks:demote-playbook',
  run: 'eforge-playbooks:run-playbook',
} as const;

const hostSourceFiles = [
  'packages/eforge/src/cli/playbook.ts',
  'packages/eforge/src/cli/playbook-contributions.ts',
  'packages/eforge/src/cli/mcp-proxy.ts',
  'packages/pi-eforge/extensions/eforge/playbook-commands.ts',
  'packages/pi-eforge/extensions/eforge/playbook-contributions.ts',
  'packages/pi-eforge/extensions/eforge/index.ts',
] as const;

const skillFiles = [
  'eforge-plugin/skills/playbook/playbook.md',
  'packages/pi-eforge/skills/eforge-playbook/SKILL.md',
] as const;

function escapedRegExp(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

describe('playbook host migration to eforge-playbooks contributions', () => {
  it('keeps CLI and Pi compatibility host files present instead of deleting user-facing playbook surfaces', () => {
    for (const path of hostSourceFiles) {
      expect(existsSync(path), `${path} should exist`).toBe(true);
    }
  });

  it('registers CLI playbook commands and the eforge play alias through the host-local contribution adapter', () => {
    const cliIndex = read('packages/eforge/src/cli/index.ts');
    const cliPlaybook = read('packages/eforge/src/cli/playbook.ts');

    expect(cliIndex).toContain('registerPlaybookCommand');
    expect(cliPlaybook).toContain('invokePlaybookContributionForHost');
    expect(cliPlaybook).toContain(".command('playbook')");
    expect(cliPlaybook).toContain(".command('play <name>')");
    expect(cliPlaybook).toContain(".command('run <name>')");
    expect(cliPlaybook).toContain(".command('promote <name>')");
    expect(cliPlaybook).toContain(".command('demote <name>')");
    expect(cliPlaybook).toContain('git');
    expect(cliPlaybook).toContain('add');
  });

  it('defines CLI/MCP contribution helper IDs and invokes them as integration commands with CLI provenance', () => {
    const helper = read('packages/eforge/src/cli/playbook-contributions.ts');

    for (const id of Object.values(contributionIds)) expect(helper).toContain(id);
    expect(helper).toContain('PLAYBOOK_EXTENSION_NAME');
    expect(helper).toContain('invokeEforgeExtensionContribution');
    expect(helper).toMatch(/kind:\s*['"]command['"]/);
    expect(helper).toContain("host: 'cli'");
    expect(helper).toContain('eforge-playbooks extension is unavailable');
    expect(helper).toContain('Install, trust, and reload eforge-playbooks');
    expect(helper).toContain('planningContributionId');
  });

  it('keeps the Claude MCP playbook tool as a compatibility facade with copy and no playbook-specific session-plan branch', () => {
    const source = read('packages/eforge/src/cli/mcp-proxy.ts');
    const playbookToolStart = source.indexOf("name: 'eforge_playbook'");
    const sessionPlanStart = source.indexOf("name: 'eforge_session_plan'");

    expect(playbookToolStart).toBeGreaterThanOrEqual(0);
    expect(sessionPlanStart).toBeGreaterThan(playbookToolStart);
    const playbookTool = source.slice(playbookToolStart, sessionPlanStart);
    const sessionPlanTool = source.slice(sessionPlanStart);

    expect(playbookTool).toContain('eforge-playbooks');
    expect(playbookTool).toMatch(/z\.enum\(\[[^\]]*['"]copy['"]/s);
    for (const field of ['sourceScope', 'targetScope', 'overwrite', 'mode', 'profile', 'includeShadowed']) {
      expect(playbookTool).toContain(field);
    }
    expect(playbookTool).toContain('invokePlaybookContributionForHost');
    expect(playbookTool).toContain('McpUserError');

    const removedAction = 'create-from-' + 'playbook';
    expect(sessionPlanTool).not.toContain(removedAction);
    expect(sessionPlanTool).not.toContain('playbook_name');
    expect(sessionPlanTool).not.toContain('sessionPlanCreateFrom' + 'Playbook');
  });

  it('registers Pi native playbook command/tool surfaces through the Pi contribution helper', () => {
    const index = read('packages/pi-eforge/extensions/eforge/index.ts');
    const commands = read('packages/pi-eforge/extensions/eforge/playbook-commands.ts');
    const helper = read('packages/pi-eforge/extensions/eforge/playbook-contributions.ts');

    expect(index).toContain('name: "eforge_playbook"');
    expect(index).toContain('eforge-playbooks');
    expect(index).toMatch(/StringEnum\(\[[^\]]*['"]copy['"]/s);
    expect(index).toContain('invokePlaybookContributionIfRunning');
    expect(index).toContain('pi.registerCommand("eforge:playbook"');
    expect(commands).toContain('handlePlaybookCommand');
    expect(commands).toContain('promptForPlaybookLandingGate');
    expect(commands).toContain('apiGetQueueIfRunning');
    expect(commands).toContain('landingAutoMerge');
    expect(commands).toContain('afterQueueId');
    expect(commands).toContain('planningEntry');

    for (const id of Object.values(contributionIds)) expect(helper).toContain(id);
    expect(helper).toContain('invokeEforgeExtensionContributionIfRunning');
    expect(helper).toMatch(/kind:\s*['"]command['"]/);
    expect(helper).toContain("host: 'pi'");
    expect(helper).toContain('DAEMON_NOT_RUNNING_GUIDANCE');
    expect(helper).toContain('eforge-playbooks extension is unavailable');
  });

  it('removes direct playbook route/helper references from host compatibility sources and skills', () => {
    const forbidden = [
      'api' + 'Playbook',
      'API_ROUTES.' + 'playbook',
      '/api/' + 'playbook',
      'sessionPlanCreateFrom' + 'Playbook',
      'create-from-' + 'playbook',
    ];

    for (const path of [...hostSourceFiles, ...skillFiles]) {
      const source = read(path);
      for (const token of forbidden) {
        expect(source, `${path} should not contain ${token}`).not.toContain(token);
      }
    }
  });

  it('keeps Claude and Pi playbook skills in extension-owned parity', () => {
    const claude = read('eforge-plugin/skills/playbook/playbook.md');
    const pi = read('packages/pi-eforge/skills/eforge-playbook/SKILL.md');

    for (const skill of [claude, pi]) {
      expect(skill).toContain('Tool boundary');
      expect(skill).toContain('eforge-playbooks');
      expect(skill).toContain(contributionIds.list);
      expect(skill).toContain(contributionIds.run);
      expect(skill).toContain(contributionIds.copy);
      expect(skill).toContain('action: "copy"');
      expect(skill).toContain('eforge-plan:open-planning-entry');
      expect(skill).toContain('eforge-plan:planning-workstation');
      expect(skill).toContain('/console/workstations/eforge-plan%3Aplanning-workstation');
      expect(skill).toContain('Install, trust, and reload eforge-playbooks');
      expect(skill).not.toMatch(/returned by the daemon/i);
    }

    expect(claude).toContain('mcp__eforge__eforge_playbook');
    expect(claude).toContain('mcp__eforge__eforge_extension_contribution');
    expect(pi).toContain('eforge_playbook');
    expect(pi).toContain('eforge_extension_contribution');
    expect(pi).not.toContain('mcp__eforge__');
  });

  it('adds a real Pi package type-check path without bumping the Pi package version or using noCheck', () => {
    const pkg = JSON.parse(read('packages/pi-eforge/package.json')) as { version: string; scripts?: Record<string, string> };
    const tsconfig = read('packages/pi-eforge/tsconfig.json');
    const typeCheck = pkg.scripts?.['type-check'] ?? '';

    expect(pkg.version).toBe('0.7.21');
    expect(typeCheck).toContain('tsc --noEmit');
    expect(typeCheck).not.toContain('--noCheck');
    expect(typeCheck).not.toContain('transpileOnly');
    expect(tsconfig).toContain('extensions/**/*.ts');
    expect(tsconfig).not.toContain('noCheck');
  });

  it('bumps only the Claude plugin integration version for host-facing skill changes', () => {
    const plugin = JSON.parse(read('eforge-plugin/.claude-plugin/plugin.json')) as { version: string };
    const pi = JSON.parse(read('packages/pi-eforge/package.json')) as { version: string };

    expect(plugin.version).toMatch(/^0\.25\.\d+$/);
    expect(plugin.version).not.toBe('0.25.65');
    expect(pi.version).toBe('0.7.21');
  });
});
