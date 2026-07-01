// --- eforge:region plan-01-runtime-choice-core ---
/** Shared invocation helper that resolves config and harness from one effective recipe. */

import type { AgentRole } from '../events.js';
import type { EforgeConfig, ResolvedAgentConfig } from '../config.js';
import type { AgentHarness } from '../harness.js';
import type { AgentRuntimeRegistry, ToolbeltSummary } from '../agent-runtime-registry.js';
import type { PlanEntry } from './agent-config.js';
import { resolveAgentConfig } from './agent-config.js';
import type { RuntimeChoiceInvocationMetadata, RuntimeChoiceSelection } from './runtime-choice.js';
import { resolveRuntimeChoiceForInvocation } from './runtime-choice.js';

export interface ResolvedAgentRuntimeForInvocation {
  agentConfig: ResolvedAgentConfig;
  harness: AgentHarness;
  toolbeltSummary: ToolbeltSummary;
  selection: RuntimeChoiceSelection;
}

export function resolveAgentRuntimeForInvocation(
  role: AgentRole,
  config: EforgeConfig,
  registry: AgentRuntimeRegistry,
  planEntry?: PlanEntry,
  metadata: RuntimeChoiceInvocationMetadata = {},
): ResolvedAgentRuntimeForInvocation {
  const selection = resolveRuntimeChoiceForInvocation(role, config, planEntry, metadata);
  if (!registry.forEffectiveRecipe) {
    throw new Error('Agent runtime registry does not support effective recipe lookup.');
  }
  const { harness, toolbeltSummary } = registry.forEffectiveRecipe(selection.tier, selection.effectiveRecipe);
  const agentConfig = resolveAgentConfig(
    role,
    config,
    planEntry,
    toolbeltSummary,
    selection.effectiveRecipe,
    selection.tier,
    selection.tierSource,
  );
  return { agentConfig, harness, toolbeltSummary, selection };
}
// --- eforge:endregion plan-01-runtime-choice-core ---
