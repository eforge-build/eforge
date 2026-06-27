import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../packages/eforge/src/cli/index.js';
import { readRepoFile, REPO_ROOT } from './extension-tooling-wiring-helpers.js';

const deletedHostSurfaceFiles = [
  'packages/eforge/src/cli/playbook.ts',
  'packages/eforge/src/cli/playbook-contributions.ts',
  'packages/pi-eforge/extensions/eforge/playbook-commands.ts',
  'packages/pi-eforge/extensions/eforge/playbook-contributions.ts',
  'eforge-plugin/skills/playbook/playbook.md',
  'packages/pi-eforge/skills/eforge-playbook/SKILL.md',
] as const;

const hostImplementationRoots = [
  'packages/eforge/src/cli',
  'packages/pi-eforge/extensions/eforge',
  'eforge-plugin',
  'packages/docs-gen/src/generators/tools.ts',
  'scripts/check-skill-parity.mjs',
] as const;

const removedHostTokens = [
  'registerPlaybookCommands',
  'invokePlaybookContributionForHost',
  'invokePlaybookContributionIfRunning',
  'PLAYBOOK_CONTRIBUTION_IDS',
  'eforge_playbook',
  'eforge:playbook',
  'promptForPlaybookLandingGate',
  'playbookChoiceNeedsTrunkRemediation',
] as const;

function commandNames(command: { commands?: Array<{ name(): string }> } | undefined): string[] {
  return command?.commands?.map((child) => child.name()) ?? [];
}

function read(relativePath: string): string {
  return readRepoFile(relativePath);
}

function textFilesUnder(path: string): string[] {
  const absolute = resolve(REPO_ROOT, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [path];
  const files: string[] = [];
  for (const entry of readdirSync(absolute)) {
    if (entry === 'dist' || entry === 'node_modules') continue;
    const child = join(absolute, entry);
    const childRelative = relative(REPO_ROOT, child);
    if (statSync(child).isDirectory()) files.push(...textFilesUnder(childRelative));
    else if (/\.(?:ts|tsx|js|mjs|json|md)$/.test(entry)) files.push(childRelative);
  }
  return files;
}

describe('host surface neutrality boundary', () => {
  it('removes deleted playbook host files instead of leaving compatibility shims', () => {
    for (const path of deletedHostSurfaceFiles) {
      expect(existsSync(resolve(REPO_ROOT, path)), `${path} should be absent`).toBe(false);
    }
  });

  it('keeps CLI contribution commands but no top-level playbook command or play alias', () => {
    const program = createProgram(undefined, 'test');
    const extension = program.commands.find((command) => command.name() === 'extension');
    const contributions = extension?.commands.find((command) => command.name() === 'contributions');

    expect(commandNames(program)).not.toEqual(expect.arrayContaining(['playbook', 'play']));
    expect(commandNames(contributions)).toEqual(expect.arrayContaining(['list', 'show', 'invoke']));
  });

  it('keeps MCP and Pi generic contribution surfaces registered', () => {
    expect(read('packages/eforge/src/cli/mcp-extension-contributions.ts')).toContain('eforge_extension_contribution');
    expect(read('packages/eforge/src/cli/mcp-proxy.ts')).toContain('registerExtensionContributionMcpTool(server, cwd)');
    expect(read('packages/pi-eforge/extensions/eforge/extension-contributions.ts')).toContain('eforge_extension_contribution');
    expect(read('packages/pi-eforge/extensions/eforge/extension-contributions.ts')).toContain('eforge:extensions');
    expect(read('packages/pi-eforge/extensions/eforge/index.ts')).toContain('registerExtensionContributionTool(pi)');
    expect(read('packages/pi-eforge/extensions/eforge/index.ts')).toContain('registerExtensionContributionsCommand(pi, () => _latestCtx)');
  });

  it('contains no removed playbook host tokens in host implementation roots', () => {
    const files = hostImplementationRoots.flatMap((root) => textFilesUnder(root));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(resolve(REPO_ROOT, file), 'utf-8');
      for (const token of removedHostTokens) {
        expect(source, `${file} should not contain ${token}`).not.toContain(token);
      }
    }
  });

  it('does not hard-code eforge-playbooks action IDs in host implementation roots', () => {
    const files = hostImplementationRoots.flatMap((root) => textFilesUnder(root));
    const actionIdPattern = /eforge-playbooks:[a-z-]+/;

    for (const file of files) {
      const source = readFileSync(resolve(REPO_ROOT, file), 'utf-8');
      expect(source, `${file} should treat extension contribution IDs as opaque`).not.toMatch(actionIdPattern);
    }
  });

  it('removes playbook skills from Claude plugin registration, Pi skills, docs generation, and parity checks', () => {
    const plugin = JSON.parse(read('eforge-plugin/.claude-plugin/plugin.json')) as { version: string; commands: string[] };
    const piPackage = JSON.parse(read('packages/pi-eforge/package.json')) as { version: string };
    const docsGenerator = read('packages/docs-gen/src/generators/tools.ts');
    const parity = read('scripts/check-skill-parity.mjs');

    expect(plugin.commands).not.toContain('./skills/playbook/playbook.md');
    expect(plugin.version.localeCompare('0.25.76', undefined, { numeric: true })).toBeGreaterThan(0);
    expect(piPackage.version).toBe('0.7.21');
    expect(docsGenerator).not.toContain("plugin: 'playbook'");
    expect(docsGenerator).not.toContain('eforge-playbook');
    expect(parity).not.toContain('plugin: "playbook"');
    expect(parity).not.toContain('eforge-playbook');
  });

  it('exports generic landing helpers without playbook-specific landing wrappers', () => {
    const landingGate = read('packages/pi-eforge/extensions/eforge/landing-gate.ts');
    const trunkLanding = read('packages/pi-eforge/extensions/eforge/trunk-landing.ts');

    expect(landingGate).toContain('promptForBuildLandingGate');
    expect(landingGate).toContain('promptForLandingSelection');
    expect(landingGate).not.toContain('promptForPlaybookLandingGate');
    expect(trunkLanding).toContain('shouldPromptForTrunkLanding');
    expect(trunkLanding).not.toContain('playbookChoiceNeedsTrunkRemediation');
  });
});
