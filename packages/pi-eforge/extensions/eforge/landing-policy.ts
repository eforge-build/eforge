/**
 * Pure Pi landing policy/menu helper.
 *
 * Computes branch-aware choice menus for both /eforge:build and autonomous
 * /eforge:playbook run. No side effects — callers own all UI rendering.
 *
 * User-facing vocabulary uses `landing.action` shorthands:
 *   pr    → issue-pr
 *   merge → merge-to-base-branch
 *   leave → leave-branch
 *
 * These wire values are what the daemon and engine accept via `onSuccess`.
 */

import type { BuildOnSuccess } from './trunk-landing.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface LandingMenuChoice {
  value: string;
  label: string;
  description: string;
}

export interface OmittedUnsafeChoice {
  value: string;
  reason: string;
}

export interface LandingMenuModel {
  /**
   * Choices to display in the primary landing selector.
   *
   * On a protected trunk (merge-to-base-branch would land without opt-in),
   * unsafe choices (merge-to-base-branch and project-default-as-merge) are
   * excluded. On a feature branch, all applicable choices are present.
   */
  normalChoices: LandingMenuChoice[];

  /**
   * Trunk remediation choices — PR, leave, config opt-in, cancel.
   *
   * Non-empty only when trunk protection is active. Designed for use in
   * the remediation sub-panel that appears when the unsafe merge action is
   * blocked on trunk, or as the primary choices when `normalChoices` already
   * excludes the unsafe options.
   */
  remediationChoices: LandingMenuChoice[];

  /**
   * Warning message when trunk protection is active (merge on protected trunk).
   * Undefined on safe branches.
   */
  warning?: string;

  /**
   * Metadata for choices omitted from normalChoices due to trunk protection.
   * Used by tests to assert that unsafe choices were correctly excluded.
   */
  omittedUnsafeChoices: OmittedUnsafeChoice[];
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface LandingMenuModelInput {
  /** The effective configured/default landing action (resolved from project config). */
  effectiveLanding: BuildOnSuccess;
  /** Current git branch, null or undefined when not in a git repo or detached HEAD. */
  currentBranch: string | null | undefined;
  /** Resolved trunk branch name (e.g. "main" or "master"). */
  trunkBranch: string;
  /** Whether allowLocalMergeToTrunk is enabled in the project config. */
  allowLocalMergeToTrunk: boolean;
  /** When true, include a "Use project default" choice in normalChoices. */
  offerProjectDefault: boolean;
  /**
   * Absolute path to the project eforge/config.yaml, or null/undefined when
   * no project config file exists. Controls whether update-config is offered
   * in remediationChoices.
   */
  projectConfigPath?: string | null;
}

// ---------------------------------------------------------------------------
// Static choice definitions
// ---------------------------------------------------------------------------

const PR_CHOICE: LandingMenuChoice = {
  value: 'issue-pr',
  label: 'Open a pull request (pr)',
  description: 'Create a GitHub PR for review instead of merging directly (issue-pr)',
};

const MERGE_CHOICE: LandingMenuChoice = {
  value: 'merge-to-base-branch',
  label: 'Merge to base branch (merge)',
  description: 'Merge the worktree branch back when the build succeeds (merge-to-base-branch)',
};

const LEAVE_CHOICE: LandingMenuChoice = {
  value: 'leave-branch',
  label: 'Leave branch (leave)',
  description: 'Commit to the worktree branch and exit without merging or opening a PR (leave-branch)',
};

const CANCEL_CHOICE: LandingMenuChoice = {
  value: 'cancel',
  label: 'Cancel',
  description: 'Do not proceed',
};

const UPDATE_CONFIG_CHOICE: LandingMenuChoice = {
  value: 'update-config',
  label: 'Update eforge/config.yaml to allow local trunk merges',
  description: 'Sets build.allowLocalMergeToTrunk: true (applies to all future builds)',
};

function projectDefaultChoice(effectiveLanding: BuildOnSuccess): LandingMenuChoice {
  return {
    value: 'project-default',
    label: 'Use project default',
    description: `Inherit the project-configured landing action — currently: ${effectiveLanding}`,
  };
}

// ---------------------------------------------------------------------------
// buildLandingMenuModel
// ---------------------------------------------------------------------------

/**
 * Compute a branch-aware landing selection model.
 *
 * Protected trunk behavior (effectiveLanding === merge-to-base-branch,
 * currentBranch === trunkBranch, allowLocalMergeToTrunk === false):
 *   - normalChoices: excludes merge-to-base-branch and project-default (when
 *     project-default would resolve to merge).
 *   - warning: set to a human-readable string referencing the trunk branch.
 *   - remediationChoices: PR, leave, update-config (when projectConfigPath is
 *     provided), cancel.
 *   - omittedUnsafeChoices: records merge-to-base-branch with reason.
 *
 * Normal behavior (not on protected trunk):
 *   - normalChoices: project-default (when offerProjectDefault), PR, merge,
 *     leave, cancel.
 *   - warning: undefined.
 *   - remediationChoices: [] (empty).
 *   - omittedUnsafeChoices: [] (empty).
 */
export function buildLandingMenuModel(input: LandingMenuModelInput): LandingMenuModel {
  const {
    effectiveLanding,
    currentBranch,
    trunkBranch,
    allowLocalMergeToTrunk,
    offerProjectDefault,
    projectConfigPath,
  } = input;

  // Trunk protection fires whenever the current branch is trunk and
  // local-trunk merge opt-in is not enabled. Unknown/null branch is treated as
  // non-trunk (no protection). Even when the configured default is safe, the
  // explicit merge choice is unsafe and must not be presented as a normal
  // option.
  const isProtectedTrunk =
    !allowLocalMergeToTrunk &&
    Boolean(currentBranch) &&
    currentBranch === trunkBranch;

  if (isProtectedTrunk) {
    const defaultWouldMerge = effectiveLanding === 'merge-to-base-branch';
    const warning = defaultWouldMerge
      ? `On trunk (${trunkBranch}) with merge-to-base-branch landing — allowLocalMergeToTrunk is disabled`
      : `On trunk (${trunkBranch}); direct merge-to-base-branch landing is disabled without allowLocalMergeToTrunk`;

    const omittedUnsafeChoices: OmittedUnsafeChoice[] = [
      {
        value: 'merge-to-base-branch',
        reason:
          `Direct local merge to ${trunkBranch} is not allowed without ` +
          `build.allowLocalMergeToTrunk: true in eforge/config.yaml`,
      },
      ...(offerProjectDefault && defaultWouldMerge
        ? [
            {
              value: 'project-default',
              reason: 'Project default resolves to the unsafe merge-to-base-branch landing action on trunk',
            },
          ]
        : []),
    ];

    const safeDefaultChoices = offerProjectDefault && !defaultWouldMerge
      ? [projectDefaultChoice(effectiveLanding)]
      : [];

    const remediationChoices: LandingMenuChoice[] = [
      ...safeDefaultChoices,
      PR_CHOICE,
      LEAVE_CHOICE,
      ...(projectConfigPath ? [UPDATE_CONFIG_CHOICE] : []),
      CANCEL_CHOICE,
    ];

    // normalChoices on protected trunk = safe alternatives only. Direct merge
    // is always omitted; project-default is omitted only when it resolves to
    // the unsafe merge action.
    const normalChoices: LandingMenuChoice[] = [
      ...safeDefaultChoices,
      PR_CHOICE,
      LEAVE_CHOICE,
      CANCEL_CHOICE,
    ];

    return { normalChoices, remediationChoices, warning, omittedUnsafeChoices };
  }

  // Non-protected trunk or feature branch: full choice menu
  const normalChoices: LandingMenuChoice[] = [];

  if (offerProjectDefault) {
    normalChoices.push({
      value: 'project-default',
      label: 'Use project default',
      description: `Inherit the project-configured landing action — currently: ${effectiveLanding}`,
    });
  }

  normalChoices.push(PR_CHOICE, MERGE_CHOICE, LEAVE_CHOICE, CANCEL_CHOICE);

  return {
    normalChoices,
    remediationChoices: [],
    omittedUnsafeChoices: [],
  };
}
