import { describe, expect, it } from 'vitest';
import {
  enableLocalMergeToTrunkInConfigYaml,
  getEffectiveOnSuccess,
  shouldPromptForTrunkLanding,
  playbookChoiceNeedsTrunkRemediation,
} from '../packages/pi-eforge/extensions/eforge/trunk-landing.js';
import { parse as parseYaml } from 'yaml';

describe('Pi eforge trunk landing policy helpers', () => {
  it('defaults effective onSuccess to merge-to-base-branch', () => {
    expect(getEffectiveOnSuccess(undefined)).toBe('merge-to-base-branch');
  });

  it('prompts only for trunk + merge-to-base-branch + no local trunk opt-in', () => {
    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { onSuccess: 'merge-to-base-branch', allowLocalMergeToTrunk: false },
    })).toBe(true);

    expect(shouldPromptForTrunkLanding({
      currentBranch: 'feature/x',
      trunkBranch: 'main',
      build: { onSuccess: 'merge-to-base-branch', allowLocalMergeToTrunk: false },
    })).toBe(false);

    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { onSuccess: 'issue-pr', allowLocalMergeToTrunk: false },
    })).toBe(false);

    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { onSuccess: 'merge-to-base-branch', allowLocalMergeToTrunk: true },
    })).toBe(false);
  });

  it('treats an explicit issue-pr override as non-prompting on trunk', () => {
    expect(shouldPromptForTrunkLanding({
      currentBranch: 'main',
      trunkBranch: 'main',
      build: { onSuccess: 'merge-to-base-branch', allowLocalMergeToTrunk: false },
      onSuccessOverride: 'issue-pr',
    })).toBe(false);
  });

  it('updates config YAML to enable local trunk merges while preserving build settings', () => {
    const updated = enableLocalMergeToTrunkInConfigYaml(`build:\n  onSuccess: merge-to-base-branch\n  maxValidationRetries: 2\n`);
    const parsed = parseYaml(updated) as { build: Record<string, unknown> };

    expect(parsed.build.onSuccess).toBe('merge-to-base-branch');
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

describe('playbookChoiceNeedsTrunkRemediation', () => {
  const trunkInput = {
    currentBranch: 'main',
    trunkBranch: 'main',
    build: { onSuccess: 'merge-to-base-branch' as const, allowLocalMergeToTrunk: false },
  };

  const nonTrunkInput = {
    currentBranch: 'feature/x',
    trunkBranch: 'main',
    build: { onSuccess: 'merge-to-base-branch' as const, allowLocalMergeToTrunk: false },
  };

  it('returns false for issue-pr choice regardless of branch', () => {
    expect(playbookChoiceNeedsTrunkRemediation('issue-pr', trunkInput)).toBe(false);
    expect(playbookChoiceNeedsTrunkRemediation('issue-pr', nonTrunkInput)).toBe(false);
  });

  it('returns false for leave-branch choice regardless of branch', () => {
    expect(playbookChoiceNeedsTrunkRemediation('leave-branch', trunkInput)).toBe(false);
    expect(playbookChoiceNeedsTrunkRemediation('leave-branch', nonTrunkInput)).toBe(false);
  });

  it('returns false for merge-to-base-branch on a non-trunk branch', () => {
    expect(playbookChoiceNeedsTrunkRemediation('merge-to-base-branch', nonTrunkInput)).toBe(false);
  });

  it('returns true for merge-to-base-branch on trunk without allowLocalMergeToTrunk', () => {
    expect(playbookChoiceNeedsTrunkRemediation('merge-to-base-branch', trunkInput)).toBe(true);
  });

  it('treats an explicit merge-to-base-branch choice as overriding configured issue-pr', () => {
    expect(
      playbookChoiceNeedsTrunkRemediation('merge-to-base-branch', {
        ...trunkInput,
        build: { onSuccess: 'issue-pr' as const, allowLocalMergeToTrunk: false },
      }),
    ).toBe(true);
  });

  it('returns false for merge-to-base-branch on trunk when allowLocalMergeToTrunk is true', () => {
    expect(
      playbookChoiceNeedsTrunkRemediation('merge-to-base-branch', {
        ...trunkInput,
        build: { ...trunkInput.build, allowLocalMergeToTrunk: true },
      }),
    ).toBe(false);
  });
});
