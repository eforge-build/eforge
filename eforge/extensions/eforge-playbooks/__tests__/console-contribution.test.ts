import { describe, expect, it } from 'vitest';
import { buildExtensionContributionManifest } from '@eforge-build/engine/extensions/manifest.js';
import { ACTION_IDS } from '../constants.js';
import { record } from './helpers.js';

const effectiveActionIds = ACTION_IDS.map((id) => `eforge-playbooks:${id}`);

describe('eforge-playbooks Console contribution contract', () => {
  it('declares generic Console blocks for every playbook action and an inventory deep link', () => {
    const manifest = buildExtensionContributionManifest(record());

    expect(manifest.consoleContributions).toHaveLength(1);
    const [contribution] = manifest.consoleContributions;
    expect(contribution).toMatchObject({
      id: 'eforge-playbooks:playbook-management',
      localId: 'playbook-management',
      extensionName: 'eforge-playbooks',
      title: 'eforge playbooks',
      availability: { available: true },
    });

    expect(contribution.blocks[0]).toMatchObject({
      rendererId: 'markdown',
      content: expect.stringMatching(/extension-owned actions|generic build queue|eforge-plan capability/i),
    });

    const actionBlocks = contribution.blocks.filter((block) => 'action' in block);
    expect(actionBlocks).toHaveLength(ACTION_IDS.length);
    expect(actionBlocks.map((block) => block.action?.actionId).sort()).toEqual([...effectiveActionIds].sort());

    const listBlock = actionBlocks.find((block) => block.action?.actionId === 'eforge-playbooks:list-playbooks');
    expect(listBlock?.rendererId).toBe('action-button');

    const formActionIds = actionBlocks
      .filter((block) => block.rendererId === 'action-form')
      .map((block) => block.action?.actionId)
      .sort();
    expect(formActionIds).toEqual(effectiveActionIds.filter((id) => id !== 'eforge-playbooks:list-playbooks').sort());

    const saveBlock = actionBlocks.find((block) => block.action?.actionId === 'eforge-playbooks:save-playbook');
    expect(saveBlock?.action).toMatchObject({ inputDefaults: { overwrite: true } });

    expect(manifest.deepLinks).toContainEqual(expect.objectContaining({
      id: 'eforge-playbooks:inventory',
      localId: 'inventory',
      action: { actionId: 'eforge-playbooks:list-playbooks' },
    }));
  });
});
