/** Runtime-choice resolution for tier-local recipe overlays. */

import type { AgentRole } from '../events.js';
import type { AgentTier, EforgeConfig, TierConfig } from '../config.js';
import type { PlanEntry, Provenance } from './agent-config.js';
import { resolveTierForRole } from './agent-config.js';
import { anyPathMatchesGlob } from './path-globs.js';

export const RUNTIME_CHOICE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const KEYWORD_TEXT_LIMIT = 8_000;

type TierChoiceOverlay = NonNullable<TierConfig['choices']>[string];
type TierRoutingRule = NonNullable<NonNullable<TierConfig['routing']>['rules']>[number];

export type EffectiveAgentRecipe = Omit<TierConfig, 'choices' | 'routing'>;
export type RuntimeChoiceSource = 'default' | 'rule' | 'extension-router' | 'fallback';
export type RuntimeChoiceFallbackReason = 'no-match' | 'router-declined' | 'router-timeout' | 'router-error' | 'router-invalid-choice';

export interface RuntimeChoiceInvocationMetadata {
  phase?: string;
  stage?: string;
  planId?: string;
  pathHints?: string[];
  changedFiles?: string[];
  shardIds?: string[];
  shardRoots?: string[];
  shardFiles?: string[];
  shardLabels?: string[];
  planName?: string;
  planSummary?: string;
  prdTitle?: string;
  prdSummary?: string;
  taskSummary?: string;
  keywordText?: string;
}

export interface RuntimeChoiceSelection {
  tier: AgentTier;
  tierSource: Provenance;
  choice: string;
  choiceRef: string;
  matchedRule?: string;
  source: RuntimeChoiceSource;
  router?: string;
  fallbackReason?: RuntimeChoiceFallbackReason;
  effectiveRecipe: EffectiveAgentRecipe;
}

function stripChoiceFields(recipe: TierConfig): EffectiveAgentRecipe {
  const { choices: _choices, routing: _routing, ...rest } = recipe;
  return rest;
}

function mergePiConfig(base: EffectiveAgentRecipe['pi'], overlay: TierChoiceOverlay['pi']): EffectiveAgentRecipe['pi'] {
  if (!base && !overlay) return undefined;
  return {
    ...base,
    ...overlay,
    ...(base?.extensions || overlay?.extensions ? { extensions: { ...base?.extensions, ...overlay?.extensions } } : {}),
    ...(base?.compaction || overlay?.compaction ? { compaction: { ...base?.compaction, ...overlay?.compaction } } : {}),
    ...(base?.retry || overlay?.retry ? { retry: { ...base?.retry, ...overlay?.retry } } : {}),
  };
}

export function overlayEffectiveAgentRecipe(base: EffectiveAgentRecipe, overlay?: TierChoiceOverlay): EffectiveAgentRecipe {
  if (!overlay) return { ...base };
  const effectiveHarness = overlay.harness ?? base.harness;
  const effective = { ...base, ...overlay } as EffectiveAgentRecipe;
  delete effective.pi;
  delete effective.claudeSdk;
  if (effectiveHarness === 'pi' && (base.pi || overlay.pi)) effective.pi = mergePiConfig(base.pi, overlay.pi);
  if (effectiveHarness === 'claude-sdk' && (base.claudeSdk || overlay.claudeSdk)) effective.claudeSdk = { ...base.claudeSdk, ...overlay.claudeSdk };
  return effective;
}

export function canonicalizeChoiceRef(tier: AgentTier, rawChoice: string): { tier: AgentTier; choice: string; ref: string } {
  const trimmed = rawChoice.trim();
  const parts = trimmed.split('.');
  if (parts.length === 2) {
    const [refTier, choice] = parts as [AgentTier, string];
    if (refTier !== tier) {
      throw new Error(`Runtime choice "${rawChoice}" crosses tiers; routing under ${tier} may only reference ${tier} choices.`);
    }
    return { tier, choice, ref: `${tier}.${choice}` };
  }
  if (parts.length > 2) {
    throw new Error(`Runtime choice "${rawChoice}" is invalid; use "default", "name", or "${tier}.name".`);
  }
  return { tier, choice: trimmed, ref: `${tier}.${trimmed}` };
}

export function runtimeChoiceExists(tierRecipe: TierConfig, choice: string): boolean {
  return choice === 'default' || Object.prototype.hasOwnProperty.call(tierRecipe.choices ?? {}, choice);
}

export function availableRuntimeChoicesForTier(tierRecipe: TierConfig, tier: AgentTier): Array<{ name: string; qualified: string }> {
  const names = ['default', ...Object.keys(tierRecipe.choices ?? {}).sort()];
  return names.map((name) => ({ name, qualified: `${tier}.${name}` }));
}

function collectPaths(metadata: RuntimeChoiceInvocationMetadata, planEntry?: PlanEntry): string[] {
  const paths = new Set<string>();
  for (const value of metadata.pathHints ?? []) paths.add(value);
  for (const value of metadata.changedFiles ?? []) paths.add(value);
  for (const value of metadata.shardRoots ?? []) paths.add(value);
  for (const value of metadata.shardFiles ?? []) paths.add(value);
  if (planEntry?.filePath) paths.add(planEntry.filePath);
  const hasInvocationShardPaths = (metadata.shardRoots?.length ?? 0) > 0 || (metadata.shardFiles?.length ?? 0) > 0;
  if (!hasInvocationShardPaths && (metadata.shardIds?.length ?? 0) > 0) {
    const shardIds = new Set(metadata.shardIds);
    const shards = planEntry?.agents?.builder?.shards ?? [];
    for (const shard of shards) {
      if (!shardIds.has(shard.id)) continue;
      for (const root of shard.roots ?? []) paths.add(root);
      for (const file of shard.files ?? []) paths.add(file);
    }
  }
  return [...paths];
}

function boundedKeywordText(metadata: RuntimeChoiceInvocationMetadata, planEntry?: PlanEntry): string {
  const chunks = [
    metadata.planName,
    metadata.planSummary,
    metadata.prdTitle,
    metadata.prdSummary,
    metadata.taskSummary,
    ...(metadata.shardLabels ?? []),
    metadata.keywordText,
    planEntry && 'name' in planEntry ? String((planEntry as { name?: unknown }).name ?? '') : undefined,
  ];
  return chunks.filter((chunk): chunk is string => !!chunk && chunk.trim().length > 0).join('\n').toLowerCase().slice(0, KEYWORD_TEXT_LIMIT);
}

function listMatches(values: readonly string[] | undefined, candidates: readonly string[]): boolean {
  if (values === undefined) return true;
  if (values.length === 0) return false;
  const candidateSet = new Set(candidates.map((value) => value.toLowerCase()));
  return values.some((value) => candidateSet.has(value.toLowerCase()));
}

function ruleMatches(rule: TierRoutingRule, role: AgentRole, metadata: RuntimeChoiceInvocationMetadata, planEntry?: PlanEntry): boolean {
  const when = rule.when;
  if (!listMatches(when.roles, [role])) return false;
  if (!listMatches(when.phase, metadata.phase ? [metadata.phase] : [])) return false;
  if (!listMatches(when.stage, metadata.stage ? [metadata.stage] : [])) return false;
  if (when.pathGlobs !== undefined && !anyPathMatchesGlob(collectPaths(metadata, planEntry), when.pathGlobs)) return false;
  if (when.keywords !== undefined) {
    const text = boundedKeywordText(metadata, planEntry);
    if (!when.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) return false;
  }
  if (!listMatches(when.shardIds, metadata.shardIds ?? [])) return false;
  if (when.shardRoots !== undefined && !anyPathMatchesGlob(metadata.shardRoots ?? [], when.shardRoots)) return false;
  return true;
}

function selectChoice(tier: AgentTier, tierRecipe: TierConfig, role: AgentRole, metadata: RuntimeChoiceInvocationMetadata, planEntry?: PlanEntry): Pick<RuntimeChoiceSelection, 'choice' | 'choiceRef' | 'matchedRule' | 'source' | 'fallbackReason'> {
  for (const rule of tierRecipe.routing?.rules ?? []) {
    if (!ruleMatches(rule, role, metadata, planEntry)) continue;
    const ref = canonicalizeChoiceRef(tier, rule.choice);
    if (!runtimeChoiceExists(tierRecipe, ref.choice)) {
      throw new Error(`agents.tiers.${tier}.routing.rules.${rule.name}.choice references unknown choice "${rule.choice}".`);
    }
    return { choice: ref.choice, choiceRef: ref.ref, matchedRule: rule.name, source: 'rule' };
  }
  return { choice: 'default', choiceRef: `${tier}.default`, source: 'default', fallbackReason: 'no-match' };
}

export interface RuntimeChoiceSelectionOverride {
  choice: string;
  source: RuntimeChoiceSource;
  router?: string;
  fallbackReason?: RuntimeChoiceFallbackReason;
}

export function resolveRuntimeChoiceForExplicitChoice(
  role: AgentRole,
  config: EforgeConfig,
  planEntry: PlanEntry | undefined,
  choice: RuntimeChoiceSelectionOverride,
): RuntimeChoiceSelection {
  const { tier, tierSource } = resolveTierForRole(role, config, planEntry);
  const tierRecipe = config.agents.tiers?.[tier];
  if (!tierRecipe) {
    throw new Error(`Role "${role}" resolves to tier "${tier}" but no tier recipe is configured.`);
  }
  const ref = canonicalizeChoiceRef(tier, choice.choice);
  if (!runtimeChoiceExists(tierRecipe, ref.choice)) {
    throw new Error(`Runtime choice "${choice.choice}" is not configured for tier "${tier}".`);
  }
  const base = stripChoiceFields(tierRecipe);
  const overlay = ref.choice === 'default' ? undefined : tierRecipe.choices?.[ref.choice];
  return {
    tier,
    tierSource,
    choice: ref.choice,
    choiceRef: ref.ref,
    source: choice.source,
    ...(choice.router !== undefined && { router: choice.router }),
    ...(choice.fallbackReason !== undefined && { fallbackReason: choice.fallbackReason }),
    effectiveRecipe: overlayEffectiveAgentRecipe(base, overlay),
  };
}

export function resolveRuntimeChoiceForInvocation(
  role: AgentRole,
  config: EforgeConfig,
  planEntry?: PlanEntry,
  metadata: RuntimeChoiceInvocationMetadata = {},
): RuntimeChoiceSelection {
  const { tier, tierSource } = resolveTierForRole(role, config, planEntry);
  const tierRecipe = config.agents.tiers?.[tier];
  if (!tierRecipe) {
    throw new Error(`Role "${role}" resolves to tier "${tier}" but no tier recipe is configured.`);
  }
  const selected = selectChoice(tier, tierRecipe, role, metadata, planEntry);
  const base = stripChoiceFields(tierRecipe);
  const overlay = selected.choice === 'default' ? undefined : tierRecipe.choices?.[selected.choice];
  const effectiveRecipe = overlayEffectiveAgentRecipe(base, overlay);
  return { tier, tierSource, ...selected, effectiveRecipe };
}
