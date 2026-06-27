import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const deletedHostFiles = [
  'packages/eforge/src/cli/playbook.ts',
  'packages/eforge/src/cli/playbook-contributions.ts',
  'packages/pi-eforge/extensions/eforge/playbook-commands.ts',
  'packages/pi-eforge/extensions/eforge/playbook-contributions.ts',
  'eforge-plugin/skills/playbook/playbook.md',
  'packages/pi-eforge/skills/eforge-playbook/SKILL.md',
] as const;

const hostSourceFiles = [
  'packages/eforge/src/cli/index.ts',
  'packages/eforge/src/cli/mcp-proxy.ts',
  'packages/pi-eforge/extensions/eforge/index.ts',
  'packages/docs-gen/src/generators/tools.ts',
  'scripts/check-skill-parity.mjs',
] as const;

describe('playbook host surface neutrality', () => {
  it('deletes compatibility host files and playbook skill files', () => {
    for (const path of deletedHostFiles) {
      expect(existsSync(path), `${path} should be deleted`).toBe(false);
    }
  });

  it('removes hard-coded host playbook adapters, tools, commands, and action maps', () => {
    const forbidden = [
      'registerPlaybookCommands',
      'invokePlaybookContributionForHost',
      'invokePlaybookContributionIfRunning',
      'PLAYBOOK_CONTRIBUTION_IDS',
      'eforge_playbook',
      'eforge:playbook',
      'eforge-playbooks:',
    ];

    for (const path of hostSourceFiles) {
      const source = read(path);
      for (const token of forbidden) {
        expect(source, `${path} should not contain ${token}`).not.toContain(token);
      }
    }
  });

  it('keeps generic extension contribution surfaces available', () => {
    expect(read('packages/eforge/src/cli/index.ts')).toContain('registerExtensionContributionCommands(extension)');
    expect(read('packages/eforge/src/cli/mcp-extension-contributions.ts')).toContain('eforge_extension_contribution');
    expect(read('packages/pi-eforge/extensions/eforge/extension-contributions.ts')).toContain('eforge_extension_contribution');
    expect(read('packages/pi-eforge/extensions/eforge/extension-contributions.ts')).toContain('eforge:extensions');
  });
});
