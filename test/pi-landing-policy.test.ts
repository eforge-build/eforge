/**
 * Tests for the pure Pi landing policy/menu helper.
 *
 * Validates buildLandingMenuModel across:
 *   - Feature branch: all applicable choices are present, no warning
 *   - Protected trunk (allowLocalMergeToTrunk: false, effectiveLanding merge):
 *     merge and project-default-as-merge are omitted, warning is set,
 *     remediation choices are surfaced
 *   - Trunk opt-in (allowLocalMergeToTrunk: true): merge and project-default included
 *   - Default inheritance: project-default value is distinct from wire values
 *   - Null/undefined currentBranch: treated as non-trunk (no protection)
 *
 * Follows AGENTS.md conventions: no mocks, real pure function, inline inputs.
 */

import { describe, expect, it } from 'vitest';
import { buildLandingMenuModel } from '../packages/pi-eforge/extensions/eforge/landing-policy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function choiceValues(choices: Array<{ value: string }>): string[] {
  return choices.map((c) => c.value);
}

const FEATURE_BRANCH = 'feature/my-task';
const TRUNK = 'main';

// ---------------------------------------------------------------------------
// Feature branch
// ---------------------------------------------------------------------------

describe('buildLandingMenuModel - feature branch', () => {
  const baseInput = {
    effectiveLanding: 'merge-to-base-branch' as const,
    currentBranch: FEATURE_BRANCH,
    trunkBranch: TRUNK,
    allowLocalMergeToTrunk: false,
  };

  it('includes project-default, PR, merge, leave, and cancel in normalChoices when offerProjectDefault is true', () => {
    const model = buildLandingMenuModel({ ...baseInput, offerProjectDefault: true });
    const values = choiceValues(model.normalChoices);
    expect(values).toContain('project-default');
    expect(values).toContain('issue-pr');
    expect(values).toContain('merge-to-base-branch');
    expect(values).toContain('leave-branch');
    expect(values).toContain('cancel');
  });

  it('excludes project-default when offerProjectDefault is false', () => {
    const model = buildLandingMenuModel({ ...baseInput, offerProjectDefault: false });
    const values = choiceValues(model.normalChoices);
    expect(values).not.toContain('project-default');
    // explicit wire-value choices are still present
    expect(values).toContain('issue-pr');
    expect(values).toContain('merge-to-base-branch');
    expect(values).toContain('leave-branch');
  });

  it('has no warning on a feature branch', () => {
    const model = buildLandingMenuModel({ ...baseInput, offerProjectDefault: true });
    expect(model.warning).toBeUndefined();
  });

  it('has no omitted unsafe choices on a feature branch', () => {
    const model = buildLandingMenuModel({ ...baseInput, offerProjectDefault: true });
    expect(model.omittedUnsafeChoices).toHaveLength(0);
  });

  it('normalChoices labels include shorthand vocabulary (pr / merge / leave)', () => {
    const model = buildLandingMenuModel({ ...baseInput, offerProjectDefault: false });
    const prChoice = model.normalChoices.find((c) => c.value === 'issue-pr');
    const mergeChoice = model.normalChoices.find((c) => c.value === 'merge-to-base-branch');
    const leaveChoice = model.normalChoices.find((c) => c.value === 'leave-branch');

    expect(prChoice).toBeDefined();
    expect(mergeChoice).toBeDefined();
    expect(leaveChoice).toBeDefined();

    // Labels must reference the shorthand so users see familiar vocabulary
    expect(`${prChoice!.label} ${prChoice!.description}`).toMatch(/\bpr\b/i);
    expect(`${mergeChoice!.label} ${mergeChoice!.description}`).toMatch(/\bmerge\b/i);
    expect(`${leaveChoice!.label} ${leaveChoice!.description}`).toMatch(/\bleave\b/i);
  });

  it('normalChoices also surface the wire value for each shorthand choice', () => {
    const model = buildLandingMenuModel({ ...baseInput, offerProjectDefault: false });
    const prChoice = model.normalChoices.find((c) => c.value === 'issue-pr');
    const mergeChoice = model.normalChoices.find((c) => c.value === 'merge-to-base-branch');
    const leaveChoice = model.normalChoices.find((c) => c.value === 'leave-branch');

    const prText = `${prChoice!.label} ${prChoice!.description}`;
    const mergeText = `${mergeChoice!.label} ${mergeChoice!.description}`;
    const leaveText = `${leaveChoice!.label} ${leaveChoice!.description}`;

    // Wire values should appear so advanced users can cross-reference
    expect(prText).toMatch(/issue-pr/);
    expect(mergeText).toMatch(/merge-to-base-branch/);
    expect(leaveText).toMatch(/leave-branch/);
  });
});

// ---------------------------------------------------------------------------
// Protected trunk
// ---------------------------------------------------------------------------

describe('buildLandingMenuModel - protected trunk (allowLocalMergeToTrunk: false)', () => {
  const protectedTrunkInput = {
    effectiveLanding: 'merge-to-base-branch' as const,
    currentBranch: TRUNK,
    trunkBranch: TRUNK,
    allowLocalMergeToTrunk: false,
    offerProjectDefault: true,
  };

  it('omits merge-to-base-branch from normalChoices', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    expect(choiceValues(model.normalChoices)).not.toContain('merge-to-base-branch');
  });

  it('omits project-default from normalChoices when effective default resolves to unsafe merge', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    expect(choiceValues(model.normalChoices)).not.toContain('project-default');
  });

  it('exposes a warning string', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    expect(model.warning).toBeTruthy();
    expect(typeof model.warning).toBe('string');
  });

  it('warning references the trunk branch name', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    expect(model.warning).toMatch(new RegExp(TRUNK));
  });

  it('remediationChoices includes PR, leave, and cancel', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    const values = choiceValues(model.remediationChoices);
    expect(values).toContain('issue-pr');
    expect(values).toContain('leave-branch');
    expect(values).toContain('cancel');
  });

  it('remediationChoices includes update-config when projectConfigPath is provided', () => {
    const model = buildLandingMenuModel({
      ...protectedTrunkInput,
      projectConfigPath: '/project/eforge/config.yaml',
    });
    expect(choiceValues(model.remediationChoices)).toContain('update-config');
  });

  it('remediationChoices excludes update-config when projectConfigPath is undefined', () => {
    const model = buildLandingMenuModel({ ...protectedTrunkInput, projectConfigPath: undefined });
    expect(choiceValues(model.remediationChoices)).not.toContain('update-config');
  });

  it('remediationChoices excludes update-config when projectConfigPath is null', () => {
    const model = buildLandingMenuModel({ ...protectedTrunkInput, projectConfigPath: null });
    expect(choiceValues(model.remediationChoices)).not.toContain('update-config');
  });

  it('records merge-to-base-branch in omittedUnsafeChoices', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    const omittedValues = model.omittedUnsafeChoices.map((c) => c.value);
    expect(omittedValues).toContain('merge-to-base-branch');
  });

  it('records project-default in omittedUnsafeChoices when it resolves to unsafe merge', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    const omittedValues = model.omittedUnsafeChoices.map((c) => c.value);
    expect(omittedValues).toContain('project-default');
  });

  it('omittedUnsafeChoices entries have a reason string', () => {
    const model = buildLandingMenuModel(protectedTrunkInput);
    for (const entry of model.omittedUnsafeChoices) {
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('treats feature branch as safe even when allowLocalMergeToTrunk is false', () => {
    const model = buildLandingMenuModel({
      effectiveLanding: 'merge-to-base-branch',
      currentBranch: FEATURE_BRANCH,
      trunkBranch: TRUNK,
      allowLocalMergeToTrunk: false,
      offerProjectDefault: true,
    });
    expect(model.warning).toBeUndefined();
    expect(choiceValues(model.normalChoices)).toContain('merge-to-base-branch');
  });
});

// ---------------------------------------------------------------------------
// Trunk opt-in
// ---------------------------------------------------------------------------

describe('buildLandingMenuModel - trunk opt-in (allowLocalMergeToTrunk: true)', () => {
  const trunkOptInInput = {
    effectiveLanding: 'merge-to-base-branch' as const,
    currentBranch: TRUNK,
    trunkBranch: TRUNK,
    allowLocalMergeToTrunk: true,
    offerProjectDefault: true,
  };

  it('includes merge-to-base-branch in normalChoices', () => {
    const model = buildLandingMenuModel(trunkOptInInput);
    expect(choiceValues(model.normalChoices)).toContain('merge-to-base-branch');
  });

  it('includes project-default in normalChoices when offerProjectDefault is true and default is merge', () => {
    const model = buildLandingMenuModel(trunkOptInInput);
    expect(choiceValues(model.normalChoices)).toContain('project-default');
  });

  it('has no warning when allowLocalMergeToTrunk is enabled', () => {
    const model = buildLandingMenuModel(trunkOptInInput);
    expect(model.warning).toBeUndefined();
  });

  it('has no omitted unsafe choices', () => {
    const model = buildLandingMenuModel(trunkOptInInput);
    expect(model.omittedUnsafeChoices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Default inheritance
// ---------------------------------------------------------------------------

describe('buildLandingMenuModel - default inheritance', () => {
  it('project-default choice has a distinct stable value, not a wire value', () => {
    const model = buildLandingMenuModel({
      effectiveLanding: 'merge-to-base-branch',
      currentBranch: FEATURE_BRANCH,
      trunkBranch: TRUNK,
      allowLocalMergeToTrunk: false,
      offerProjectDefault: true,
    });
    const defaultChoice = model.normalChoices.find((c) => c.value === 'project-default');
    expect(defaultChoice).toBeDefined();
    expect(defaultChoice!.value).toBe('project-default');
    // project-default must differ from all wire values
    expect(defaultChoice!.value).not.toBe('merge-to-base-branch');
    expect(defaultChoice!.value).not.toBe('issue-pr');
    expect(defaultChoice!.value).not.toBe('leave-branch');
  });

  it('project-default label describes inheriting the project setting', () => {
    const model = buildLandingMenuModel({
      effectiveLanding: 'issue-pr',
      currentBranch: FEATURE_BRANCH,
      trunkBranch: TRUNK,
      allowLocalMergeToTrunk: false,
      offerProjectDefault: true,
    });
    const defaultChoice = model.normalChoices.find((c) => c.value === 'project-default');
    expect(defaultChoice).toBeDefined();
    // Label should convey that the project default will be used
    expect(`${defaultChoice!.label} ${defaultChoice!.description}`).toMatch(/default|project/i);
  });

  it('when effectiveLanding is issue-pr, project-default is offered but direct-merge trunk warning is raised', () => {
    const model = buildLandingMenuModel({
      effectiveLanding: 'issue-pr',
      currentBranch: TRUNK,
      trunkBranch: TRUNK,
      allowLocalMergeToTrunk: false,
      offerProjectDefault: true,
    });
    // issue-pr default is safe for inheritance, but the explicit merge choice remains unsafe on trunk.
    expect(model.warning).toMatch(/direct merge-to-base-branch/i);
    expect(choiceValues(model.normalChoices)).toContain('project-default');
  });

  it('omits explicit merge on protected trunk even when the project default is issue-pr', () => {
    const model = buildLandingMenuModel({
      effectiveLanding: 'issue-pr',
      currentBranch: TRUNK,
      trunkBranch: TRUNK,
      allowLocalMergeToTrunk: false,
      offerProjectDefault: true,
    });

    expect(choiceValues(model.normalChoices)).toContain('project-default');
    expect(choiceValues(model.normalChoices)).not.toContain('merge-to-base-branch');
    expect(model.omittedUnsafeChoices.map((c) => c.value)).toContain('merge-to-base-branch');
  });
});

// ---------------------------------------------------------------------------
// Null / undefined currentBranch
// ---------------------------------------------------------------------------

describe('buildLandingMenuModel - unknown currentBranch', () => {
  it('treats null currentBranch as non-trunk (no trunk protection)', () => {
    const model = buildLandingMenuModel({
      effectiveLanding: 'merge-to-base-branch',
      currentBranch: null,
      trunkBranch: TRUNK,
      allowLocalMergeToTrunk: false,
      offerProjectDefault: true,
    });
    expect(model.warning).toBeUndefined();
    expect(choiceValues(model.normalChoices)).toContain('merge-to-base-branch');
    expect(model.omittedUnsafeChoices).toHaveLength(0);
  });

  it('treats undefined currentBranch as non-trunk (no trunk protection)', () => {
    const model = buildLandingMenuModel({
      effectiveLanding: 'merge-to-base-branch',
      currentBranch: undefined,
      trunkBranch: TRUNK,
      allowLocalMergeToTrunk: false,
      offerProjectDefault: true,
    });
    expect(model.warning).toBeUndefined();
    expect(choiceValues(model.normalChoices)).toContain('merge-to-base-branch');
  });
});
