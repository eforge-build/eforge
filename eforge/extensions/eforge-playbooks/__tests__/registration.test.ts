import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildExtensionContributionManifest } from '@eforge-build/engine/extensions/manifest.js';
import { ACTION_IDS } from '../constants.js';
import { record } from './helpers.js';

describe('eforge-playbooks registration', () => {
  it('registers canonical actions, commands, console contribution, and metadata', async () => {
    const registry = record();
    expect(registry.diagnostics.filter((d) => d.code === 'extension:invalid-registration')).toEqual([]);
    expect(registry.actions.map((a) => a.value.id).sort()).toEqual([...ACTION_IDS].sort());
    for (const action of registry.actions.map((a) => a.value)) {
      expect(action.inputSchema.type).toBe('object');
      expect(action.outputSchema).toBeDefined();
    }
    expect(Object.fromEntries(registry.actions.map((a) => [a.value.id, a.value.sideEffects]))).toMatchObject({
      'list-playbooks': ['local-read'],
      'show-playbook': ['local-read'],
      'validate-playbook': ['none'],
      'save-playbook': ['local-write'],
      'copy-playbook': ['local-read', 'local-write'],
      'promote-playbook': ['local-write'],
      'demote-playbook': ['local-write'],
      'run-playbook': ['local-read', 'daemon-state', 'build-queue'],
    });
    const manifest = buildExtensionContributionManifest(registry);
    expect(manifest.actions.map((a) => a.id).sort()).toEqual(ACTION_IDS.map((id) => `eforge-playbooks:${id}`).sort());
    expect(manifest.integrationCommands.map((c) => c.id).sort()).toEqual(ACTION_IDS.map((id) => `eforge-playbooks:${id}`).sort());
    for (const command of manifest.integrationCommands) expect(command.action.actionId).toBe(command.id);
    const actionRefs = JSON.stringify(manifest.consoleContributions);
    for (const id of ACTION_IDS) expect(actionRefs).toContain(`eforge-playbooks:${id}`);
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'));
    expect(pkg.eforge.extension.capabilities).toEqual(expect.arrayContaining([{ name: 'eforge.playbooks.management', version: '1.0.0' }, { name: 'eforge.playbooks.run', version: '1.0.0' }]));
    expect(pkg.eforge.extension.dependencies.optional[0]).toMatchObject({ name: 'eforge-plan', capabilities: [{ name: 'eforge.plan.planning-mode-playbook', version: '>=1.0.0' }] });
  });
});
