/**
 * Pure helper for building the daemon profileCreate payload from per-tier
 * agent runtime selections collected by the /eforge:profile:new wizard.
 *
 * This module contains no TUI panel calls and is fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type HarnessType = 'claude-sdk' | 'pi';

/** The four built-in tier names. */
export type TierName = 'planning' | 'implementation' | 'review' | 'evaluation';

/** A harness + model + effort selection for a single tier. */
export interface TierSelection {
  /** Which harness to use for this tier. */
  harness: HarnessType;
  /** Provider name — required when harness is 'pi'. */
  provider?: string;
  /** Model identifier (e.g. "claude-opus-4-7"). */
  modelId: string;
  /** Effort level (e.g. "high", "medium", "low"). */
  effort: string;
  /** Toolbelt name to assign to this tier (e.g. "browser-ui", "none"). */
  toolbelt?: string;
}

/** A tier-local choice overlay. Omitted fields inherit from the tier default. */
export interface RuntimeChoiceSelection {
  harness?: HarnessType;
  provider?: string;
  modelId?: string;
  effort?: string;
  toolbelt?: string;
}

export interface RuntimeRoutingPredicate {
  roles?: string[];
  phase?: string[];
  stage?: string[];
  pathGlobs?: string[];
  keywords?: string[];
  shardIds?: string[];
  shardRoots?: string[];
}

export interface RuntimeRoutingRuleSelection {
  name: string;
  choice: string;
  when: RuntimeRoutingPredicate;
}

export interface TierRuntimeChoicesSelection {
  choices?: Record<string, RuntimeChoiceSelection>;
  routing?: {
    rules: RuntimeRoutingRuleSelection[];
  };
}

/** Input to buildProfileCreatePayload. */
export interface ProfileCreateInput {
  /** Profile name (e.g. "pi-anthropic"). */
  name: string;
  /** Where the profile file is written. */
  scope: 'project' | 'user' | 'local';
  /** Per-tier selections for each of the four built-in tiers. */
  tiers: {
    planning: TierSelection;
    implementation: TierSelection;
    review: TierSelection;
    evaluation: TierSelection;
  };
  /** Optional tier-local runtime choices and ordered routing rules. */
  runtimeChoices?: Partial<Record<TierName, TierRuntimeChoicesSelection>>;
  /** Descriptive metadata for the profile. Does not affect runtime behavior. */
  metadata?: {
    description?: string;
    whenToUse?: string[];
    tags?: string[];
  };
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface TierChoiceOverlayEntry {
  harness?: HarnessType;
  pi?: { provider: string };
  model?: string;
  effort?: string;
  /** Toolbelt name assigned to this choice. Omitted when not set. */
  toolbelt?: string;
}

export interface RuntimeRoutingRuleEntry {
  name: string;
  choice: string;
  when: RuntimeRoutingPredicate;
}

export interface TierRoutingEntry {
  rules: RuntimeRoutingRuleEntry[];
}

/** A single tier recipe entry in the create payload. */
export interface TierRecipeEntry {
  harness: HarnessType;
  pi?: { provider: string };
  model: string;
  effort: string;
  /** Toolbelt name assigned to this tier. Omitted when not set. */
  toolbelt?: string;
  /** Tier-local overlays that inherit from this tier default. */
  choices?: Record<string, TierChoiceOverlayEntry>;
  /** Ordered declarative routing rules for selecting a tier-local choice. */
  routing?: TierRoutingEntry;
}

/** The payload sent to POST /api/profile/create. */
export interface ProfileCreatePayload {
  name: string;
  scope: 'project' | 'user' | 'local';
  agents: {
    tiers: {
      planning: TierRecipeEntry;
      implementation: TierRecipeEntry;
      review: TierRecipeEntry;
      evaluation: TierRecipeEntry;
    };
  };
  /** Descriptive metadata for the profile. Does not affect runtime behavior. */
  metadata?: {
    description?: string;
    whenToUse?: string[];
    tags?: string[];
  };
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

function toTierEntry(sel: TierSelection, runtimeChoices?: TierRuntimeChoicesSelection): TierRecipeEntry {
  const entry: TierRecipeEntry = {
    harness: sel.harness,
    model: sel.modelId,
    effort: sel.effort,
  };
  if (sel.harness === 'pi' && sel.provider) {
    entry.pi = { provider: sel.provider };
  }
  if (sel.toolbelt !== undefined) {
    entry.toolbelt = sel.toolbelt;
  }
  if (runtimeChoices?.choices !== undefined) {
    entry.choices = Object.fromEntries(
      Object.entries(runtimeChoices.choices).map(([name, choice]) => [name, toChoiceEntry(choice)]),
    );
  }
  if (runtimeChoices?.routing !== undefined) {
    entry.routing = { rules: runtimeChoices.routing.rules.map((rule) => ({ ...rule, when: { ...rule.when } })) };
  }
  return entry;
}

function toChoiceEntry(sel: RuntimeChoiceSelection): TierChoiceOverlayEntry {
  const entry: TierChoiceOverlayEntry = {};
  if (sel.harness !== undefined) {
    entry.harness = sel.harness;
  }
  if (sel.harness === 'pi' && sel.provider) {
    entry.pi = { provider: sel.provider };
  } else if (sel.harness === undefined && sel.provider) {
    entry.pi = { provider: sel.provider };
  }
  if (sel.modelId !== undefined) {
    entry.model = sel.modelId;
  }
  if (sel.effort !== undefined) {
    entry.effort = sel.effort;
  }
  if (sel.toolbelt !== undefined) {
    entry.toolbelt = sel.toolbelt;
  }
  return entry;
}

/**
 * Build a daemon profileCreate payload from per-tier selections.
 *
 * Returns an object whose top-level keys are exactly `name`, `scope`, `agents`,
 * with `agents` containing only `tiers`. No `agentRuntimes`, no
 * `defaultAgentRuntime`, no `agents.models`. When `metadata` is provided in
 * the input, it is preserved as a top-level `metadata` key in the payload.
 */
export function buildProfileCreatePayload(input: ProfileCreateInput): ProfileCreatePayload {
  const { name, scope, tiers, metadata, runtimeChoices } = input;

  const payload: ProfileCreatePayload = {
    name,
    scope,
    agents: {
      tiers: {
        planning: toTierEntry(tiers.planning, runtimeChoices?.planning),
        implementation: toTierEntry(tiers.implementation, runtimeChoices?.implementation),
        review: toTierEntry(tiers.review, runtimeChoices?.review),
        evaluation: toTierEntry(tiers.evaluation, runtimeChoices?.evaluation),
      },
    },
  };

  if (metadata !== undefined) {
    payload.metadata = metadata;
  }

  return payload;
}
