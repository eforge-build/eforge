import { describe, expect, it } from 'vitest';
import {
  enableLocalMergeToTrunkInConfigYaml,
  getEffectiveLandingAction,
  shouldPromptForTrunkLanding,
} from '../packages/pi-eforge/extensions/eforge/trunk-landing.js';
import { parse as parseYaml } from 'yaml';

describe('Pi eforge trunk landing policy helpers', () => {
  it('defaults effective landing to merge', () => {
    expect(getEffectiveLandingAction(undefined)).toBe('merge');
  });

  it('prompts only for trunk + merge + no local trunk opt-in', () => {
    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { allowLocalMergeToTrunk: false },
      configuredLandingAction: 'merge',
    })).toBe(true);

    expect(shouldPromptForTrunkLanding({
      currentBranch: 'feature/x',
      trunkBranch: 'main',
      build: { allowLocalMergeToTrunk: false },
      configuredLandingAction: 'merge',
    })).toBe(false);

    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { allowLocalMergeToTrunk: false },
      configuredLandingAction: 'pr',
    })).toBe(false);

    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { allowLocalMergeToTrunk: true },
      configuredLandingAction: 'merge',
    })).toBe(false);
  });

  it('treats an explicit pr override as non-prompting on trunk', () => {
    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { allowLocalMergeToTrunk: false },
      configuredLandingAction: 'merge',
      landingActionOverride: 'pr',
    })).toBe(false);
  });

  it('updates config YAML to enable local trunk merges while preserving landing and build settings', () => {
    const updated = enableLocalMergeToTrunkInConfigYaml(`landing:\n  action: merge\nbuild:\n  maxValidationRetries: 2\n`);
    const parsed = parseYaml(updated) as { landing: { action: string }; build: Record<string, unknown> };

    expect(parsed.landing.action).toBe('merge');
    expect(parsed.build.maxValidationRetries).toBe(2);
    expect(parsed.build.allowLocalMergeToTrunk).toBe(true);
  });

  it('creates a build section when config YAML has none', () => {
    const updated = enableLocalMergeToTrunkInConfigYaml(`maxConcurrentBuilds: 2\n`);
    const parsed = parseYaml(updated) as { build: Record<string, unknown>; maxConcurrentBuilds: number };

    expect(parsed.maxConcurrentBuilds).toBe(2);
    expect(parsed.build.allowLocalMergeToTrunk).toBe(true);
  });
});
