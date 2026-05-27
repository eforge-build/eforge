/**
 * Pi-free helper functions for the workflow wizard.
 *
 * Contains pure functions for:
 *   - Answer-to-preset mapping (four wizard dimensions → one of five presets)
 *   - Config-change summaries and diffs
 *   - git-spice remediation outcome resolution
 *   - Config delta application
 *
 * No Pi SDK imports — all functions are unit-testable without the Pi runtime.
 */

// ---------------------------------------------------------------------------
// Wizard answer types
// ---------------------------------------------------------------------------

/** Whether the project is primarily solo or team development. */
export type WizardContext = 'solo' | 'team';

/** How builds should land after completing. */
export type WizardLanding = 'merge' | 'pr';

/** Stack provider choice (none = no stacking). */
export type WizardStacking = 'none' | 'git-spice';

/** Whether to run stack sync automatically as a post-merge command. */
export type WizardAutoSync = 'yes' | 'no';

/** The four wizard question answers. */
export interface WizardAnswers {
  context: WizardContext;
  landing: WizardLanding;
  stacking: WizardStacking;
  /** Only meaningful when stacking === 'git-spice'. */
  autoSync: WizardAutoSync;
}

// ---------------------------------------------------------------------------
// Workflow preset definitions
// ---------------------------------------------------------------------------

/** Unique identifier for each of the five workflow presets. */
export type WorkflowPresetId =
  | 'solo-merge'
  | 'solo-pr'
  | 'team-pr'
  | 'stacked-pr'
  | 'stacked-pr-autosync';

/** Metadata for a workflow preset. */
export interface WorkflowPreset {
  id: WorkflowPresetId;
  label: string;
  description: string;
}

/** The five workflow presets. */
export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'solo-merge',
    label: 'Solo - direct merge',
    description:
      'Solo developer: builds land directly on trunk via merge. Requires allowLocalMergeToTrunk.',
  },
  {
    id: 'solo-pr',
    label: 'Solo - pull requests',
    description:
      'Solo developer: each build opens a PR. Auto-merge is always enabled so PRs merge as soon as checks pass.',
  },
  {
    id: 'team-pr',
    label: 'Team - pull requests',
    description:
      'Team workflow: each build opens a PR. Auto-merge requires an explicit per-run flag (ask mode).',
  },
  {
    id: 'stacked-pr',
    label: 'Stacked PRs (git-spice)',
    description:
      'Stacked-PR workflow backed by git-spice. Each build PR targets the parent artifact branch. Stack sync must be run manually.',
  },
  {
    id: 'stacked-pr-autosync',
    label: 'Stacked PRs with auto sync',
    description:
      'Stacked-PR workflow with automatic stack sync after every merge (daemon-owned: runs stack sync after each build completes).',
  },
];

// ---------------------------------------------------------------------------
// Config delta type
// ---------------------------------------------------------------------------

/**
 * A partial eforge config patch — contains only the keys this preset explicitly sets.
 * Applied over the existing config via applyDeltaToConfig().
 */
export interface WorkflowConfigDelta {
  landing?: {
    action?: 'pr' | 'merge' | 'leave';
    pr?: {
      autoMerge?: 'ask' | 'always' | 'never';
    };
  };
  build?: {
    allowLocalMergeToTrunk?: boolean;
    postMergeCommands?: string[];
  };
  stacking?: {
    enabled?: boolean;
    gitSpice?: {
      command?: string;
    };
    sync?: {
      afterBuild?: boolean;
    };
  };
}

/** The config delta for each preset. */
const PRESET_CONFIG_DELTAS: Record<WorkflowPresetId, WorkflowConfigDelta> = {
  'solo-merge': {
    landing: { action: 'merge' },
    build: { allowLocalMergeToTrunk: true },
    stacking: { enabled: false },
  },
  'solo-pr': {
    landing: { action: 'pr', pr: { autoMerge: 'always' } },
    stacking: { enabled: false },
  },
  'team-pr': {
    landing: { action: 'pr', pr: { autoMerge: 'ask' } },
    stacking: { enabled: false },
  },
  'stacked-pr': {
    landing: { action: 'pr' },
    stacking: { enabled: true },
  },
  'stacked-pr-autosync': {
    landing: { action: 'pr' },
    stacking: { enabled: true, sync: { afterBuild: true } },
  },
};

// ---------------------------------------------------------------------------
// Answer-to-preset mapping
// ---------------------------------------------------------------------------

/**
 * Map the four wizard answer dimensions to one of the five workflow presets.
 *
 * Mapping logic:
 *   - If stacking is 'git-spice': autoSync=yes → stacked-pr-autosync, no → stacked-pr
 *   - If landing is 'merge': → solo-merge (merge requires solo allowLocalMergeToTrunk)
 *   - If landing is 'pr' and context is 'solo': → solo-pr
 *   - If landing is 'pr' and context is 'team': → team-pr
 */
export function mapAnswersToPreset(answers: WizardAnswers): WorkflowPreset {
  if (answers.stacking === 'git-spice') {
    const id: WorkflowPresetId =
      answers.autoSync === 'yes' ? 'stacked-pr-autosync' : 'stacked-pr';
    return WORKFLOW_PRESETS.find((p) => p.id === id)!;
  }

  if (answers.landing === 'merge') {
    return WORKFLOW_PRESETS.find((p) => p.id === 'solo-merge')!;
  }

  // landing === 'pr', no stacking
  if (answers.context === 'solo') {
    return WORKFLOW_PRESETS.find((p) => p.id === 'solo-pr')!;
  }

  return WORKFLOW_PRESETS.find((p) => p.id === 'team-pr')!;
}

// ---------------------------------------------------------------------------
// Config delta and summaries
// ---------------------------------------------------------------------------

/** Return the config delta for a given preset ID. */
export function getPresetConfigDelta(presetId: WorkflowPresetId): WorkflowConfigDelta {
  return PRESET_CONFIG_DELTAS[presetId];
}

/** A single key=value entry in a config change summary. */
export interface ConfigChangeItem {
  key: string;
  value: string;
  description: string;
}

/**
 * Build a human-readable change summary for a preset's config delta.
 * Returns one item per field that the preset explicitly sets.
 * The set of keys in the returned array corresponds exactly to the keys
 * present in the preset's delta — no more, no less.
 */
export function buildConfigChangeSummary(presetId: WorkflowPresetId): ConfigChangeItem[] {
  const delta = PRESET_CONFIG_DELTAS[presetId];
  const items: ConfigChangeItem[] = [];

  if (delta.landing?.action !== undefined) {
    items.push({
      key: 'landing.action',
      value: delta.landing.action,
      description: `Landing action: **${delta.landing.action}**`,
    });
  }

  if (delta.landing?.pr?.autoMerge !== undefined) {
    items.push({
      key: 'landing.pr.autoMerge',
      value: delta.landing.pr.autoMerge,
      description: `PR auto-merge: **${delta.landing.pr.autoMerge}**`,
    });
  }

  if (delta.build?.allowLocalMergeToTrunk !== undefined) {
    items.push({
      key: 'build.allowLocalMergeToTrunk',
      value: String(delta.build.allowLocalMergeToTrunk),
      description: `Allow direct merge to trunk: **${delta.build.allowLocalMergeToTrunk}**`,
    });
  }

  if (delta.build?.postMergeCommands !== undefined) {
    items.push({
      key: 'build.postMergeCommands',
      value: delta.build.postMergeCommands.join(', '),
      description: `Post-merge commands: \`${delta.build.postMergeCommands.join(', ')}\``,
    });
  }

  if (delta.stacking?.enabled !== undefined) {
    items.push({
      key: 'stacking.enabled',
      value: String(delta.stacking.enabled),
      description: `Stacking: **${delta.stacking.enabled ? 'enabled' : 'disabled'}**`,
    });
  }

  if (delta.stacking?.gitSpice?.command !== undefined) {
    items.push({
      key: 'stacking.gitSpice.command',
      value: delta.stacking.gitSpice.command,
      description: `git-spice command: \`${delta.stacking.gitSpice.command}\``,
    });
  }

  if (delta.stacking?.sync?.afterBuild !== undefined) {
    items.push({
      key: 'stacking.sync.afterBuild',
      value: String(delta.stacking.sync.afterBuild),
      description: `Auto stack sync after build: **${delta.stacking.sync.afterBuild ? 'enabled' : 'disabled'}** (daemon-owned)`,
    });
  }

  return items;
}

/**
 * Build a config change summary for a delta that includes a custom git-spice command.
 * Returns the same keys as `buildConfigChangeSummary` for the base preset, plus
 * an entry for `stacking.gitSpice.command` when a command is provided.
 */
export function buildConfigChangeSummaryWithGitSpice(
  presetId: WorkflowPresetId,
  gitSpiceCommand: string,
): ConfigChangeItem[] {
  const items = buildConfigChangeSummary(presetId);
  // Replace or add the gitSpice.command item
  const existing = items.findIndex((i) => i.key === 'stacking.gitSpice.command');
  const item: ConfigChangeItem = {
    key: 'stacking.gitSpice.command',
    value: gitSpiceCommand,
    description: `git-spice command: \`${gitSpiceCommand}\``,
  };
  if (existing >= 0) {
    items[existing] = item;
  } else {
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// git-spice remediation
// ---------------------------------------------------------------------------

/** User choices when a stacking preset is selected but git-spice is unavailable. */
export type GitSpiceRemediationChoice = 'disable-stacking' | 'cancel' | 'configure-path';

/** The outcome of a git-spice remediation decision. */
export interface GitSpiceRemediationResult {
  /** 'cancel': abort the wizard. 'disable-stacking': fall back to non-stacking PR preset. 'proceed-with-stacking': continue with stacking, optionally with a custom command path. */
  action: 'cancel' | 'disable-stacking' | 'proceed-with-stacking';
  /** When action is 'proceed-with-stacking', the configured command path (if provided). */
  gitSpiceCommand?: string;
}

/**
 * Resolve a user's git-spice remediation choice to a structured outcome.
 *
 * Outcomes:
 *   - 'disable-stacking': fall back to PR workflow without stacking
 *   - 'cancel': abort the wizard entirely
 *   - 'configure-path': proceed with stacking, using the provided commandPath
 */
export function resolveGitSpiceRemediation(
  choice: GitSpiceRemediationChoice,
  commandPath?: string,
): GitSpiceRemediationResult {
  switch (choice) {
    case 'cancel':
      return { action: 'cancel' };
    case 'disable-stacking':
      return { action: 'disable-stacking' };
    case 'configure-path':
      return { action: 'proceed-with-stacking', gitSpiceCommand: commandPath };
  }
}

/**
 * Given a remediation result, return the effective preset and delta to use.
 * When action is 'disable-stacking', falls back to the team-pr preset (PR without stacking).
 */
export function resolvePresetAfterRemediation(
  originalPresetId: WorkflowPresetId,
  remediation: GitSpiceRemediationResult,
): { presetId: WorkflowPresetId; delta: WorkflowConfigDelta } | null {
  if (remediation.action === 'cancel') {
    return null;
  }

  if (remediation.action === 'disable-stacking') {
    // Fall back to team-pr (PR without stacking, applicable to both solo and team contexts)
    return {
      presetId: 'team-pr',
      delta: getPresetConfigDelta('team-pr'),
    };
  }

  // proceed-with-stacking: use the original preset, with an optional custom git-spice command
  const baseDelta = getPresetConfigDelta(originalPresetId);
  const delta: WorkflowConfigDelta = remediation.gitSpiceCommand
    ? {
        ...baseDelta,
        stacking: {
          ...baseDelta.stacking,
          gitSpice: { command: remediation.gitSpiceCommand },
        },
      }
    : baseDelta;

  return { presetId: originalPresetId, delta };
}

// ---------------------------------------------------------------------------
// Config delta application
// ---------------------------------------------------------------------------

/**
 * Apply a config delta to an existing config object (shallow-deep merge).
 * Returns a new object; the input is not mutated.
 *
 * For `build.postMergeCommands`, any new commands are appended to the existing
 * list (deduplication: only adds commands not already present).
 */
export function applyDeltaToConfig(
  current: Record<string, unknown>,
  delta: WorkflowConfigDelta,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...current };

  if (delta.landing !== undefined) {
    const existing = (result.landing != null && typeof result.landing === 'object' && !Array.isArray(result.landing))
      ? (result.landing as Record<string, unknown>)
      : {};
    const newLanding: Record<string, unknown> = { ...existing };

    if (delta.landing.action !== undefined) {
      newLanding.action = delta.landing.action;
    }

    if (delta.landing.pr !== undefined) {
      const existingPr = (newLanding.pr != null && typeof newLanding.pr === 'object' && !Array.isArray(newLanding.pr))
        ? (newLanding.pr as Record<string, unknown>)
        : {};
      const newPr: Record<string, unknown> = { ...existingPr };
      if (delta.landing.pr.autoMerge !== undefined) {
        newPr.autoMerge = delta.landing.pr.autoMerge;
      }
      newLanding.pr = newPr;
    }

    result.landing = newLanding;
  }

  if (delta.build !== undefined) {
    const existing = (result.build != null && typeof result.build === 'object' && !Array.isArray(result.build))
      ? (result.build as Record<string, unknown>)
      : {};
    const newBuild: Record<string, unknown> = { ...existing };

    if (delta.build.allowLocalMergeToTrunk !== undefined) {
      newBuild.allowLocalMergeToTrunk = delta.build.allowLocalMergeToTrunk;
    }

    if (delta.build.postMergeCommands !== undefined) {
      const existingCmds = Array.isArray(newBuild.postMergeCommands)
        ? (newBuild.postMergeCommands as string[])
        : [];
      const merged = [...existingCmds];
      for (const cmd of delta.build.postMergeCommands) {
        if (!merged.includes(cmd)) merged.push(cmd);
      }
      newBuild.postMergeCommands = merged;
    }

    result.build = newBuild;
  }

  if (delta.stacking !== undefined) {
    const existing = (result.stacking != null && typeof result.stacking === 'object' && !Array.isArray(result.stacking))
      ? (result.stacking as Record<string, unknown>)
      : {};
    const newStacking: Record<string, unknown> = { ...existing };

    if (delta.stacking.enabled !== undefined) {
      newStacking.enabled = delta.stacking.enabled;
    }

    if (delta.stacking.gitSpice !== undefined) {
      const existingGs = (newStacking.gitSpice != null && typeof newStacking.gitSpice === 'object' && !Array.isArray(newStacking.gitSpice))
        ? (newStacking.gitSpice as Record<string, unknown>)
        : {};
      const newGs: Record<string, unknown> = { ...existingGs };
      if (delta.stacking.gitSpice.command !== undefined) {
        newGs.command = delta.stacking.gitSpice.command;
      }
      newStacking.gitSpice = newGs;
    }

    if (delta.stacking.sync !== undefined) {
      const existingSync = (newStacking.sync != null && typeof newStacking.sync === 'object' && !Array.isArray(newStacking.sync))
        ? (newStacking.sync as Record<string, unknown>)
        : {};
      const newSync: Record<string, unknown> = { ...existingSync };
      if (delta.stacking.sync.afterBuild !== undefined) {
        newSync.afterBuild = delta.stacking.sync.afterBuild;
      }
      newStacking.sync = newSync;
    }

    result.stacking = newStacking;
  }

  return result;
}
