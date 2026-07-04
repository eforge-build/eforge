import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { resolveAdaptiveRescopeLimits, type AdaptiveRescopeLimits } from '../compile-resilience/planning-decomposition-limits.js';
import { derivePlanningAtomGraph, type PlanningAtomGraph, type PlanningRescopeDirective } from './atom-graph.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { evidenceSlug } from './evidence-hygiene.js';
import { DEFAULT_EXPLORATION_MAX_TURNS, runRepositoryExplorationAgent } from './exploration-agent.js';
import { decideExplorationSkip, EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE, type RepositoryExplorationOutcome } from './exploration-contracts.js';
import { stableSlug } from './source-analysis.js';
import { deriveSourceLocalization } from './source-localization.js';
import type { SourceLocalizationBundle, SourceLocalizationHint, SourceLocalizationInputHints, SourceLocalizationRecord } from './source-localization-contracts.js';
import type { SourceInventory } from './source-inventory.js';

// --- eforge:region adaptive-rescope-contracts ---

/** Need kinds whose unresolved state marks a need as critical for fail-closed decisions. */
const CRITICAL_NEED_KINDS = new Set(['interface', 'entrypoint']);

export type AdaptiveRescopeStatus = 'not-needed' | 'warning-only' | 'rescoped' | 'exhausted-proceeded' | 'fail-closed';

export interface AdaptiveRescopeDiagnostics {
  status: AdaptiveRescopeStatus;
  attempts: number;
  maxAttempts: number;
  originalAtomCount: number;
  revisedAtomCount: number;
  ledger: { totalToolUseBudget: number; usedToolUses: number };
  riskReasons: string[];
  splitGroups: Array<{ directiveId: string; groupKey: string; criterionIds: string[]; rationale: string }>;
  rerunScopeKeys: string[];
  preservedScopeKeys: string[];
  unresolvedCriticalNeedIds: string[];
}

export interface AdaptiveExplorationRescopeResult {
  hints?: SourceLocalizationInputHints;
  outcome?: RepositoryExplorationOutcome;
  unknownIdDrops?: Array<{ field: string; id: string; index?: number }>;
  rescopeDirectives?: PlanningRescopeDirective[];
  diagnostics: AdaptiveRescopeDiagnostics;
}

/** Thrown when rescoping is exhausted with critical needs unresolved; the compile stage fails closed. */
export class AdaptiveRescopeFailClosedError extends Error {
  constructor(message: string, readonly diagnostics: AdaptiveRescopeDiagnostics) {
    super(message);
    this.name = 'AdaptiveRescopeFailClosedError';
  }
}

export interface RunAdaptiveExplorationRescopeInput {
  cwd: string;
  harness: AgentHarness;
  agentOptions?: SdkPassthroughConfig & { maxTurns?: number };
  sourceContent: string;
  inventory: SourceInventory;
  limits: PlanningDecompositionLimits;
  rescopeLimits?: Partial<AdaptiveRescopeLimits>;
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

// --- eforge:endregion adaptive-rescope-contracts ---

// --- eforge:region adaptive-rescope-derivations ---

/** Per-scope exploration tool budget scales with unresolved-need count; the configured per-scope limit stays the clamp. */
export function deriveExplorationToolBudget(needCount: number, rescopeLimits: AdaptiveRescopeLimits, clamp: number): number {
  return Math.max(1, Math.min(rescopeLimits.explorationBudgetBaseToolUses + rescopeLimits.explorationBudgetToolUsesPerNeed * needCount, clamp));
}

/** The turn ceiling must scale with the derived budget (~2 tool uses per turn) or it silently binds first. */
export function deriveExplorationMaxTurns(toolBudget: number): number {
  return Math.max(DEFAULT_EXPLORATION_MAX_TURNS, Math.ceil(toolBudget / 2) + 2);
}

function isUnresolved(record: SourceLocalizationRecord): boolean {
  return record.status !== 'resolved' || record.confidence !== 'high';
}

/** Unresolved needs that are critical: contract/entrypoint kinds, or linked to criteria carrying interface keys. */
export function criticalUnresolvedNeedIds(bundle: SourceLocalizationBundle, inventory: SourceInventory): string[] {
  const interfaceCriterionIds = new Set(inventory.criteria.filter((criterion) => criterion.interfaceKeys.length > 0).map((criterion) => criterion.id));
  return bundle.records
    .filter(isUnresolved)
    .filter((record) => CRITICAL_NEED_KINDS.has(record.kind) || record.linkedCriterionIds.some((id) => interfaceCriterionIds.has(id)))
    .map((record) => record.needId)
    .sort();
}

export interface RescopeRiskClassification { risky: boolean; reasons: string[] }

/**
 * A degraded exploration outcome is risky when existing deterministic signals
 * say localization cannot be trusted: low high-confidence share, a collapsed
 * root atom spanning more subsystems than one planning unit allows, or
 * unresolved needs tied to interface contracts. Rescoping only remedies the
 * collapsed-root pathology, so an already-decomposed graph is never risky
 * here - it keeps today's warning-only degradation.
 */
export function classifyRescopeRisk(input: { bundle: SourceLocalizationBundle; inventory: SourceInventory; graph: PlanningAtomGraph; limits: PlanningDecompositionLimits }): RescopeRiskClassification {
  if (input.graph.atoms.length > 1) return { risky: false, reasons: [`already-decomposed (${input.graph.atoms.length} atoms)`] };
  const reasons: string[] = [];
  const skip = decideExplorationSkip(input.bundle, input.inventory.summary.criterionCount);
  if (skip.share < EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE) reasons.push(`low-confidence-share (${skip.highConfidenceCount}/${skip.literalNeedCount})`);
  const subsystems = new Set(input.inventory.criteria.flatMap((criterion) => criterion.subsystemHints));
  if (input.graph.atoms.length === 1 && subsystems.size > input.limits.maxSubsystemsPerUnit) reasons.push(`subsystem-diverse-root (${subsystems.size} subsystems)`);
  const critical = criticalUnresolvedNeedIds(input.bundle, input.inventory);
  if (critical.length > 0) reasons.push(`unresolved-interface-needs (${critical.length})`);
  return { risky: reasons.length > 0, reasons };
}

/**
 * Deterministically partition the criterion set into rescope groups keyed by
 * subsystem hint, interface key, or evidence slug. Hints shared by every
 * criterion (generic surface terms like route/schema) cannot discriminate, so
 * each criterion is keyed by its first non-common hint. Returns [] when fewer
 * than two distinct groups exist - a single group cannot narrow anything.
 */
export function deriveRescopeDirectives(inventory: SourceInventory, bundle: SourceLocalizationBundle): PlanningRescopeDirective[] {
  const unresolvedByCriterion = new Map<string, number>();
  for (const record of bundle.records.filter(isUnresolved)) {
    for (const criterionId of record.linkedCriterionIds) unresolvedByCriterion.set(criterionId, (unresolvedByCriterion.get(criterionId) ?? 0) + 1);
  }
  const commonHints = commonToAllCriteria(inventory, (criterion) => [...criterion.subsystemHints, ...criterion.interfaceKeys]);
  const groups = new Map<string, string[]>();
  for (const criterion of [...inventory.criteria].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = [...criterion.subsystemHints, ...criterion.interfaceKeys].find((hint) => !commonHints.has(hint))
      ?? (criterion.evidencePaths[0] ? evidenceSlug(criterion.evidencePaths[0]) : undefined)
      ?? criterion.subsystemHints[0]
      ?? 'general';
    groups.set(key, [...(groups.get(key) ?? []), criterion.id]);
  }
  if (groups.size < 2) return [];
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupKey, criterionIds]) => ({
      directiveId: `rescope-${stableSlug(groupKey)}`,
      groupKey,
      criterionIds,
      rationale: `degraded exploration: split by ${groupKey} (${criterionIds.length} criteria, ${criterionIds.reduce((sum, id) => sum + (unresolvedByCriterion.get(id) ?? 0), 0)} unresolved need links)`,
    }));
}

function commonToAllCriteria(inventory: SourceInventory, hintsOf: (criterion: SourceInventory['criteria'][number]) => string[]): Set<string> {
  if (inventory.criteria.length === 0) return new Set();
  let common = new Set(hintsOf(inventory.criteria[0]));
  for (const criterion of inventory.criteria.slice(1)) {
    const hints = new Set(hintsOf(criterion));
    common = new Set([...common].filter((hint) => hints.has(hint)));
  }
  return common;
}

// --- eforge:endregion adaptive-rescope-derivations ---

// --- eforge:region adaptive-rescope-loop ---

/**
 * Bounded pre-map adaptive rescope loop (stage-integration layer). Runs the
 * initial exploration with a need-count-derived budget; on a risky degraded
 * outcome it derives deterministic split directives, reruns exploration per
 * scope under a cross-run tool-use ledger, and preserves scopes that are
 * already high-confidence. Exhausted attempts with critical needs unresolved
 * throw AdaptiveRescopeFailClosedError; everything else proceeds with the best
 * merged hints. Repository access stays confined to the exploration agent.
 */
export async function runAdaptiveExplorationRescope(input: RunAdaptiveExplorationRescopeInput): Promise<AdaptiveExplorationRescopeResult> {
  const rescopeLimits = resolveAdaptiveRescopeLimits(input.rescopeLimits);
  const emit = (message: string, level: 'progress' | 'warning' = 'progress'): void => {
    if (level === 'warning') input.onEvent?.({ timestamp: new Date().toISOString(), type: 'planning:warning', message, source: 'repository-exploration' });
    else input.onEvent?.({ timestamp: new Date().toISOString(), type: 'planning:progress', message });
  };
  const graph = derivePlanningAtomGraph({ content: input.sourceContent, hash: input.inventory.sourceHash, limits: input.limits, inventory: input.inventory });
  const baseline = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.inventory, graph });
  const diagnostics: AdaptiveRescopeDiagnostics = {
    status: 'not-needed', attempts: 0, maxAttempts: rescopeLimits.maxRescopeAttempts,
    originalAtomCount: graph.atoms.length, revisedAtomCount: graph.atoms.length,
    ledger: { totalToolUseBudget: 0, usedToolUses: 0 },
    riskReasons: [], splitGroups: [], rerunScopeKeys: [], preservedScopeKeys: [], unresolvedCriticalNeedIds: [],
  };
  const skip = decideExplorationSkip(baseline, input.inventory.summary.criterionCount);
  emit(`Repository exploration ${skip.skip ? 'skipped' : 'starting'}: ${skip.reason}`);
  if (skip.skip) return { diagnostics };

  const initialBudget = deriveExplorationToolBudget(baseline.records.filter(isUnresolved).length, rescopeLimits, input.limits.maxLocalExplorationToolUses);
  diagnostics.ledger.totalToolUseBudget = initialBudget * rescopeLimits.explorationTotalBudgetMultiplier;
  const runExploration = async (bundle: SourceLocalizationBundle, scopedGraph: PlanningAtomGraph, budget: number, scopeNeedIds?: string[]) => {
    const result = await runRepositoryExplorationAgent({
      cwd: input.cwd, harness: input.harness,
      agentOptions: { ...(input.agentOptions ?? {}), maxTurns: input.agentOptions?.maxTurns ?? deriveExplorationMaxTurns(budget) },
      inventory: input.inventory, baselineBundle: bundle, graph: scopedGraph,
      maxToolUses: budget, scopeNeedIds, abortSignal: input.abortSignal, onEvent: input.onEvent,
    });
    diagnostics.ledger.usedToolUses += result.toolUses;
    return result;
  };

  const initial = await runExploration(baseline, graph, initialBudget);
  let hints = initial.hints;
  let outcome = initial.outcome;
  const unknownIdDrops = [...initial.unknownIdDrops];
  if (outcome.status === 'completed' && hints) {
    emit(`Repository exploration produced ${hints.projectHints?.length ?? 0} localization hints in ${initial.toolUses} tool uses.`);
    return { hints, outcome, unknownIdDrops, diagnostics };
  }

  const risk = classifyRescopeRisk({ bundle: baseline, inventory: input.inventory, graph, limits: input.limits });
  diagnostics.riskReasons = risk.reasons;
  if (!risk.risky) {
    diagnostics.status = 'warning-only';
    emit(`Repository exploration degraded (${outcome.status}) but deterministic localization confidence is sufficient; proceeding with a warning.`, 'warning');
    return { hints, outcome, unknownIdDrops, diagnostics };
  }

  let bundle = baseline;
  let directives: PlanningRescopeDirective[] = [];
  for (let attempt = 1; attempt <= rescopeLimits.maxRescopeAttempts; attempt += 1) {
    const derived = deriveRescopeDirectives(input.inventory, bundle);
    if (derived.length === 0) {
      diagnostics.status = 'warning-only';
      emit(`Adaptive rescope attempt ${attempt}: no split signal (single scope); proceeding degraded with a warning.`, 'warning');
      return { hints, outcome, unknownIdDrops, rescopeDirectives: directives.length > 0 ? directives : undefined, diagnostics };
    }
    directives = derived;
    diagnostics.attempts = attempt;
    diagnostics.splitGroups = derived.map(({ directiveId, groupKey, criterionIds, rationale }) => ({ directiveId, groupKey, criterionIds, rationale }));
    const rescopedGraph = derivePlanningAtomGraph({ content: input.sourceContent, hash: input.inventory.sourceHash, limits: input.limits, inventory: input.inventory, rescopeDirectives: directives });
    diagnostics.revisedAtomCount = rescopedGraph.atoms.length;
    emit(`Adaptive rescope attempt ${attempt}/${rescopeLimits.maxRescopeAttempts}: split ${diagnostics.originalAtomCount} atom(s) into ${rescopedGraph.atoms.length} across ${derived.length} scopes (${risk.reasons.join('; ')}).`);
    bundle = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.inventory, graph: rescopedGraph, hints });
    for (const directive of directives) {
      const wanted = new Set(directive.criterionIds);
      const scopeNeeds = bundle.records.filter((record) => isUnresolved(record) && record.linkedCriterionIds.some((id) => wanted.has(id)));
      if (scopeNeeds.length === 0) {
        diagnostics.preservedScopeKeys.push(directive.groupKey);
        continue;
      }
      const remaining = diagnostics.ledger.totalToolUseBudget - diagnostics.ledger.usedToolUses;
      const budget = Math.min(deriveExplorationToolBudget(scopeNeeds.length, rescopeLimits, input.limits.maxLocalExplorationToolUses), remaining);
      if (budget < 1) {
        emit(`Adaptive rescope: cross-run tool budget exhausted (${diagnostics.ledger.usedToolUses}/${diagnostics.ledger.totalToolUseBudget}); scope ${directive.groupKey} not rerun.`, 'warning');
        continue;
      }
      diagnostics.rerunScopeKeys.push(directive.groupKey);
      const scoped = await runExploration(bundle, rescopedGraph, budget, scopeNeeds.map((record) => record.needId).sort());
      unknownIdDrops.push(...scoped.unknownIdDrops);
      outcome = scoped.outcome;
      if (scoped.hints) hints = mergeHints(hints, scoped.hints);
    }
    bundle = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.inventory, graph: rescopedGraph, hints });
    diagnostics.unresolvedCriticalNeedIds = criticalUnresolvedNeedIds(bundle, input.inventory);
    if (diagnostics.unresolvedCriticalNeedIds.length === 0) {
      diagnostics.status = 'rescoped';
      emit(`Adaptive rescope resolved critical localization after attempt ${attempt}; compiling ${rescopedGraph.atoms.length} rescoped scopes.`);
      return { hints, outcome, unknownIdDrops, rescopeDirectives: directives, diagnostics };
    }
  }

  if (diagnostics.attempts === 0) {
    // Rescope attempts disabled by limits: behave like the warning-only path.
    diagnostics.status = 'warning-only';
    emit('Adaptive rescoping disabled (0 attempts); proceeding degraded with a warning.', 'warning');
    return { hints, outcome, unknownIdDrops, diagnostics };
  }
  if (diagnostics.unresolvedCriticalNeedIds.length > 0) {
    diagnostics.status = 'fail-closed';
    const reason = `Adaptive rescoping exhausted after ${diagnostics.attempts}/${rescopeLimits.maxRescopeAttempts} attempt(s) with ${diagnostics.unresolvedCriticalNeedIds.length} critical source need(s) unresolved (${diagnostics.unresolvedCriticalNeedIds.slice(0, 10).join(', ')}); failing compile instead of producing vague plans. Tool ledger: ${diagnostics.ledger.usedToolUses}/${diagnostics.ledger.totalToolUseBudget}.`;
    throw new AdaptiveRescopeFailClosedError(reason, diagnostics);
  }
  diagnostics.status = 'exhausted-proceeded';
  emit(`Adaptive rescoping exhausted with non-critical needs unresolved; proceeding with ${directives.length} rescoped scopes and merged hints.`, 'warning');
  return { hints, outcome, unknownIdDrops, rescopeDirectives: directives, diagnostics };
}

function mergeHints(base: SourceLocalizationInputHints | undefined, extra: SourceLocalizationInputHints): SourceLocalizationInputHints {
  const seen = new Set<string>();
  const merged: SourceLocalizationHint[] = [];
  for (const hint of [...(base?.projectHints ?? []), ...(extra.projectHints ?? [])]) {
    const key = JSON.stringify(hint);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hint);
  }
  return { projectHints: merged };
}

// --- eforge:endregion adaptive-rescope-loop ---
