/**
 * Pure helper tests for workflow wizard decision mapping and config diff behavior.
 *
 * Tests cover:
 *   1. mapAnswersToPreset — the four wizard dimensions map to each of the five presets.
 *   2. buildConfigChangeSummary — every key changed by a selected preset appears in
 *      the summary and no keys outside that preset appear.
 *   3. resolveGitSpiceRemediation — each of the three outcomes is exercisable.
 *   4. applyDeltaToConfig — delta is correctly merged into existing config.
 *
 * No Pi SDK imports: all functions under test live in workflow-wizard-helpers.ts
 * which has no Pi framework dependencies.
 */

import { describe, it, expect } from 'vitest';
import {
  mapAnswersToPreset,
  getPresetConfigDelta,
  buildConfigChangeSummary,
  buildConfigChangeSummaryWithGitSpice,
  resolveGitSpiceRemediation,
  resolvePresetAfterRemediation,
  applyDeltaToConfig,
  WORKFLOW_PRESETS,
  type WizardAnswers,
  type WorkflowPresetId,
} from '../packages/pi-eforge/extensions/eforge/workflow-wizard-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All keys present in a WorkflowConfigDelta as dot-notation strings. */
function deltaKeys(presetId: WorkflowPresetId): Set<string> {
  const delta = getPresetConfigDelta(presetId);
  const keys = new Set<string>();
  if (delta.landing?.action !== undefined) keys.add('landing.action');
  if (delta.landing?.pr?.autoMerge !== undefined) keys.add('landing.pr.autoMerge');
  if (delta.build?.allowLocalMergeToTrunk !== undefined) keys.add('build.allowLocalMergeToTrunk');
  if (delta.build?.postMergeCommands !== undefined) keys.add('build.postMergeCommands');
  if (delta.stacking?.enabled !== undefined) keys.add('stacking.enabled');
  if (delta.stacking?.gitSpice?.command !== undefined) keys.add('stacking.gitSpice.command');
  if (delta.stacking?.sync?.afterBuild !== undefined) keys.add('stacking.sync.afterBuild');
  return keys;
}

// ---------------------------------------------------------------------------
// 1. mapAnswersToPreset — covers all five presets
// ---------------------------------------------------------------------------

describe('mapAnswersToPreset', () => {
  it('maps solo + merge → solo-merge', () => {
    const answers: WizardAnswers = {
      context: 'solo',
      landing: 'merge',
      stacking: 'none',
      autoSync: 'no',
    };
    expect(mapAnswersToPreset(answers).id).toBe('solo-merge');
  });

  it('maps solo + pr + no stacking → solo-pr', () => {
    const answers: WizardAnswers = {
      context: 'solo',
      landing: 'pr',
      stacking: 'none',
      autoSync: 'no',
    };
    expect(mapAnswersToPreset(answers).id).toBe('solo-pr');
  });

  it('maps team + pr + no stacking → team-pr', () => {
    const answers: WizardAnswers = {
      context: 'team',
      landing: 'pr',
      stacking: 'none',
      autoSync: 'no',
    };
    expect(mapAnswersToPreset(answers).id).toBe('team-pr');
  });

  it('maps git-spice stacking + no auto-sync → stacked-pr', () => {
    const answers: WizardAnswers = {
      context: 'team',
      landing: 'pr',
      stacking: 'git-spice',
      autoSync: 'no',
    };
    expect(mapAnswersToPreset(answers).id).toBe('stacked-pr');
  });

  it('maps git-spice stacking + auto-sync → stacked-pr-autosync', () => {
    const answers: WizardAnswers = {
      context: 'solo',
      landing: 'pr',
      stacking: 'git-spice',
      autoSync: 'yes',
    };
    expect(mapAnswersToPreset(answers).id).toBe('stacked-pr-autosync');
  });

  it('stacking = git-spice overrides landing=merge (solo) and auto-sync=yes → stacked-pr-autosync', () => {
    const answers: WizardAnswers = {
      context: 'solo',
      landing: 'merge',
      stacking: 'git-spice',
      autoSync: 'yes',
    };
    // stacking takes priority regardless of landing/context
    expect(mapAnswersToPreset(answers).id).toBe('stacked-pr-autosync');
  });

  it('stacking = git-spice overrides landing=merge (team) and auto-sync=no → stacked-pr', () => {
    const answers: WizardAnswers = {
      context: 'team',
      landing: 'merge',
      stacking: 'git-spice',
      autoSync: 'no',
    };
    expect(mapAnswersToPreset(answers).id).toBe('stacked-pr');
  });

  it('returns a preset from the WORKFLOW_PRESETS array for every mapping', () => {
    const presetIds = WORKFLOW_PRESETS.map((p) => p.id);
    const allTestAnswers: WizardAnswers[] = [
      { context: 'solo', landing: 'merge', stacking: 'none', autoSync: 'no' },
      { context: 'solo', landing: 'pr', stacking: 'none', autoSync: 'no' },
      { context: 'team', landing: 'pr', stacking: 'none', autoSync: 'no' },
      { context: 'team', landing: 'pr', stacking: 'git-spice', autoSync: 'no' },
      { context: 'team', landing: 'pr', stacking: 'git-spice', autoSync: 'yes' },
    ];
    for (const answers of allTestAnswers) {
      const preset = mapAnswersToPreset(answers);
      expect(presetIds).toContain(preset.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. buildConfigChangeSummary — key set parity with delta
// ---------------------------------------------------------------------------

describe('buildConfigChangeSummary', () => {
  const allPresetIds: WorkflowPresetId[] = [
    'solo-merge',
    'solo-pr',
    'team-pr',
    'stacked-pr',
    'stacked-pr-autosync',
  ];

  for (const presetId of allPresetIds) {
    it(`${presetId}: summary keys match delta keys exactly`, () => {
      const summaryItems = buildConfigChangeSummary(presetId);
      const summaryKeys = new Set(summaryItems.map((i) => i.key));
      const expectedKeys = deltaKeys(presetId);

      // Every delta key appears in summary
      for (const key of expectedKeys) {
        expect(summaryKeys, `${presetId}: expected key "${key}" in summary`).toContain(key);
      }

      // No summary key outside delta
      for (const key of summaryKeys) {
        expect(expectedKeys, `${presetId}: unexpected key "${key}" in summary`).toContain(key);
      }
    });
  }

  it('solo-merge summary includes landing.action = merge', () => {
    const items = buildConfigChangeSummary('solo-merge');
    const landingItem = items.find((i) => i.key === 'landing.action');
    expect(landingItem?.value).toBe('merge');
  });

  it('team-pr summary includes landing.pr.autoMerge = ask', () => {
    const items = buildConfigChangeSummary('team-pr');
    const autoMergeItem = items.find((i) => i.key === 'landing.pr.autoMerge');
    expect(autoMergeItem?.value).toBe('ask');
  });

  it('solo-pr summary includes landing.pr.autoMerge = always', () => {
    const items = buildConfigChangeSummary('solo-pr');
    const autoMergeItem = items.find((i) => i.key === 'landing.pr.autoMerge');
    expect(autoMergeItem?.value).toBe('always');
  });

  it('stacked-pr summary includes stacking.enabled = true', () => {
    const items = buildConfigChangeSummary('stacked-pr');
    const stackingItem = items.find((i) => i.key === 'stacking.enabled');
    expect(stackingItem?.value).toBe('true');
  });

  it('stacked-pr-autosync summary includes stacking.sync.afterBuild', () => {
    const items = buildConfigChangeSummary('stacked-pr-autosync');
    const syncItem = items.find((i) => i.key === 'stacking.sync.afterBuild');
    expect(syncItem?.value).toBe('true');
  });

  it('buildConfigChangeSummaryWithGitSpice adds stacking.gitSpice.command', () => {
    const items = buildConfigChangeSummaryWithGitSpice('stacked-pr', '/usr/local/bin/git-spice');
    const gsItem = items.find((i) => i.key === 'stacking.gitSpice.command');
    expect(gsItem?.value).toBe('/usr/local/bin/git-spice');
    // Base delta keys are still present
    expect(items.find((i) => i.key === 'stacking.enabled')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. resolveGitSpiceRemediation — all three outcomes
// ---------------------------------------------------------------------------

describe('resolveGitSpiceRemediation', () => {
  it('cancel choice → action: cancel', () => {
    const result = resolveGitSpiceRemediation('cancel');
    expect(result.action).toBe('cancel');
    expect(result.gitSpiceCommand).toBeUndefined();
  });

  it('disable-stacking choice → action: disable-stacking', () => {
    const result = resolveGitSpiceRemediation('disable-stacking');
    expect(result.action).toBe('disable-stacking');
    expect(result.gitSpiceCommand).toBeUndefined();
  });

  it('configure-path choice with commandPath → action: proceed-with-stacking + gitSpiceCommand', () => {
    const result = resolveGitSpiceRemediation('configure-path', '/opt/homebrew/bin/git-spice');
    expect(result.action).toBe('proceed-with-stacking');
    expect(result.gitSpiceCommand).toBe('/opt/homebrew/bin/git-spice');
  });

  it('configure-path choice without commandPath → action: proceed-with-stacking, no command', () => {
    const result = resolveGitSpiceRemediation('configure-path');
    expect(result.action).toBe('proceed-with-stacking');
    expect(result.gitSpiceCommand).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. resolvePresetAfterRemediation — stacking disabled or custom command
// ---------------------------------------------------------------------------

describe('resolvePresetAfterRemediation', () => {
  it('cancel result → returns null', () => {
    const result = resolvePresetAfterRemediation('stacked-pr', { action: 'cancel' });
    expect(result).toBeNull();
  });

  it('disable-stacking result → falls back to team-pr preset', () => {
    const result = resolvePresetAfterRemediation('stacked-pr', { action: 'disable-stacking' });
    expect(result).not.toBeNull();
    expect(result!.presetId).toBe('team-pr');
    expect(result!.delta.stacking?.enabled).toBe(false);
  });

  it('proceed-with-stacking without command → returns original preset delta unchanged', () => {
    const result = resolvePresetAfterRemediation('stacked-pr', { action: 'proceed-with-stacking' });
    expect(result).not.toBeNull();
    expect(result!.presetId).toBe('stacked-pr');
    expect(result!.delta.stacking?.enabled).toBe(true);
    expect(result!.delta.stacking?.gitSpice?.command).toBeUndefined();
  });

  it('proceed-with-stacking with command → adds gitSpice.command to delta', () => {
    const result = resolvePresetAfterRemediation('stacked-pr', {
      action: 'proceed-with-stacking',
      gitSpiceCommand: '/custom/git-spice',
    });
    expect(result).not.toBeNull();
    expect(result!.delta.stacking?.gitSpice?.command).toBe('/custom/git-spice');
    expect(result!.delta.stacking?.enabled).toBe(true);
  });

  it('autosync preset with custom git-spice command preserves stacking.sync.afterBuild', () => {
    const result = resolvePresetAfterRemediation('stacked-pr-autosync', {
      action: 'proceed-with-stacking',
      gitSpiceCommand: '/custom/git-spice',
    });
    expect(result).not.toBeNull();
    expect(result!.delta.stacking?.sync?.afterBuild).toBe(true);
    expect(result!.delta.stacking?.gitSpice?.command).toBe('/custom/git-spice');
  });
});

// ---------------------------------------------------------------------------
// 5. applyDeltaToConfig — merge behavior
// ---------------------------------------------------------------------------

describe('applyDeltaToConfig', () => {
  it('applies landing.action to empty config', () => {
    const result = applyDeltaToConfig({}, { landing: { action: 'pr' } });
    expect((result.landing as { action: string }).action).toBe('pr');
  });

  it('does not mutate the input config', () => {
    const input = { landing: { action: 'merge' } };
    const inputCopy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
    applyDeltaToConfig(input, { landing: { action: 'pr' } });
    expect(input).toEqual(inputCopy);
  });

  it('preserves unrelated existing keys', () => {
    const existing = {
      build: { trunkBranch: 'main', postMergeCommands: ['pnpm test'] },
    };
    const result = applyDeltaToConfig(existing, { landing: { action: 'pr' } });
    const build = result.build as Record<string, unknown>;
    expect(build.trunkBranch).toBe('main');
  });

  it('deduplicates postMergeCommands when adding new commands', () => {
    const existing = {
      build: { postMergeCommands: ['pnpm test', 'eforge stack sync'] },
    };
    const result = applyDeltaToConfig(existing, {
      build: { postMergeCommands: ['eforge stack sync'] },
    });
    const cmds = (result.build as { postMergeCommands: string[] }).postMergeCommands;
    expect(cmds.filter((c: string) => c === 'eforge stack sync')).toHaveLength(1);
  });

  it('appends new postMergeCommands to existing list', () => {
    const existing = {
      build: { postMergeCommands: ['pnpm test'] },
    };
    const result = applyDeltaToConfig(existing, {
      build: { postMergeCommands: ['eforge stack sync'] },
    });
    const cmds = (result.build as { postMergeCommands: string[] }).postMergeCommands;
    expect(cmds).toContain('pnpm test');
    expect(cmds).toContain('eforge stack sync');
  });

  it('merges stacking.gitSpice into existing stacking block', () => {
    const existing = { stacking: { enabled: true } };
    const result = applyDeltaToConfig(existing, {
      stacking: { gitSpice: { command: '/custom/gs' } },
    });
    const stacking = result.stacking as { enabled: boolean; gitSpice: { command: string } };
    expect(stacking.enabled).toBe(true);
    expect(stacking.gitSpice.command).toBe('/custom/gs');
  });

  it('applies full solo-merge delta correctly', () => {
    const result = applyDeltaToConfig({}, getPresetConfigDelta('solo-merge'));
    const landing = result.landing as { action: string };
    const build = result.build as { allowLocalMergeToTrunk: boolean };
    const stacking = result.stacking as { enabled: boolean };
    expect(landing.action).toBe('merge');
    expect(build.allowLocalMergeToTrunk).toBe(true);
    expect(stacking.enabled).toBe(false);
  });

  it('applies full stacked-pr-autosync delta correctly', () => {
    const result = applyDeltaToConfig({}, getPresetConfigDelta('stacked-pr-autosync'));
    const landing = result.landing as { action: string };
    const stacking = result.stacking as { enabled: boolean; sync: { afterBuild: boolean } };
    expect(landing.action).toBe('pr');
    expect(stacking.enabled).toBe(true);
    expect(stacking.sync.afterBuild).toBe(true);
  });
});
