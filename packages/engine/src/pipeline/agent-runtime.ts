/** Shared invocation helper that resolves config and harness from one effective recipe. */

import type { AgentRole } from '../events.js';
import type { EforgeConfig, ResolvedAgentConfig } from '../config.js';
import type { AgentHarness } from '../harness.js';
import type { AgentRuntimeRegistry, ToolbeltSummary } from '../agent-runtime-registry.js';
import type { RuntimeChoiceRouterRuntimeOptions } from '../extensions/runtime-choice-router.js';
import type { PlanEntry } from './agent-config.js';
import { resolveAgentConfig } from './agent-config.js';
import type { RuntimeChoiceInvocationMetadata, RuntimeChoiceSelection } from './runtime-choice.js';
import { resolveRuntimeChoiceForInvocation } from './runtime-choice.js';
import { resolveRuntimeChoiceWithExtensionRouters } from '../extensions/runtime-choice-router.js';

export interface ResolvedAgentRuntimeForInvocation {
  agentConfig: ResolvedAgentConfig;
  harness: AgentHarness;
  toolbeltSummary: ToolbeltSummary;
  selection: RuntimeChoiceSelection;
}

function resolveRuntimeFromSelection(
  role: AgentRole,
  config: EforgeConfig,
  registry: AgentRuntimeRegistry,
  planEntry: PlanEntry | undefined,
  metadata: RuntimeChoiceInvocationMetadata,
  selection: RuntimeChoiceSelection,
): ResolvedAgentRuntimeForInvocation {
  const { harness, toolbeltSummary } = registry.forEffectiveRecipe
    ? registry.forEffectiveRecipe(selection.tier, selection.effectiveRecipe)
    : registry.forRoleResolved(role, planEntry, metadata);
  const agentConfig = resolveAgentConfig(
    role,
    config,
    planEntry,
    toolbeltSummary,
    selection.effectiveRecipe,
    selection.tier,
    selection.tierSource,
    selection,
  );
  return { agentConfig, harness, toolbeltSummary, selection };
}

export function resolveAgentRuntimeForInvocation(
  role: AgentRole,
  config: EforgeConfig,
  registry: AgentRuntimeRegistry,
  planEntry?: PlanEntry,
  metadata: RuntimeChoiceInvocationMetadata = {},
): ResolvedAgentRuntimeForInvocation {
  const selection = resolveRuntimeChoiceForInvocation(role, config, planEntry, metadata);
  return resolveRuntimeFromSelection(role, config, registry, planEntry, metadata, selection);
}

export async function resolveAgentRuntimeForInvocationWithExtensions(
  role: AgentRole,
  config: EforgeConfig,
  registry: AgentRuntimeRegistry,
  planEntry: PlanEntry | undefined,
  metadata: RuntimeChoiceInvocationMetadata = {},
  routerOptions?: RuntimeChoiceRouterRuntimeOptions,
): Promise<ResolvedAgentRuntimeForInvocation> {
  const selection = routerOptions
    ? await resolveRuntimeChoiceWithExtensionRouters(role, config, planEntry, metadata, routerOptions)
    : resolveRuntimeChoiceForInvocation(role, config, planEntry, metadata);
  return resolveRuntimeFromSelection(role, config, registry, planEntry, metadata, selection);
}
