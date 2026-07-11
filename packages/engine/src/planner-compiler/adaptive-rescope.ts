import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { resolveAdaptiveRescopeLimits, type AdaptiveRescopeLimits } from '../compile-resilience/planning-decomposition-limits.js';
import { derivePlanningAtomGraph, type PlanningAtomGraph, type PlanningRescopeDirective } from './atom-graph.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import { evidenceSlug } from './evidence-hygiene.js';
import { DEFAULT_EXPLORATION_MAX_TURNS, runRepositoryExplorationAgent } from './exploration-agent.js';
import { decideExplorationSkip, EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE, type RepositoryExplorationOutcome } from './exploration-contracts.js';
import { deriveRepositoryIndex } from './repository-index.js';
import { GENERIC_SURFACE_TERMS, stableSlug } from './source-analysis.js';
import { deriveSourceLocalization } from './source-localization.js';
import type { SourceLocalizationBundle, SourceLocalizationHint, SourceLocalizationInputHints, SourceLocalizationRecord } from './source-localization-contracts.js';
import type { SourceInventory } from './source-inventory.js';

// --- eforge:region adaptive-rescope-contracts ---

/**
 * Need kinds whose unresolved state can make compile output unsafe. Keep this
 * intentionally narrow: surface words such as config/route/test/docs are useful
 * rescope signals, but they are too generic to justify failing compile before
 * the decomposed planner gets a chance to produce scoped work.
 */
const CRITICAL_NEED_KINDS = new Set(['entrypoint']);

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

/** Unresolved needs that are critical enough to justify fail-closed compile behavior. */
export function criticalUnresolvedNeedIds(bundle: SourceLocalizationBundle, _inventory: SourceInventory): string[] {
  return bundle.records
    .filter(isUnresolved)
    .filter(isCompileBlockingNeed)
    .map((record) => record.needId)
    .sort();
}

function isCompileBlockingNeed(record: SourceLocalizationRecord): boolean {
  // Only needs derived from the PRD source may block a compile. Needs minted
  // from exploration-agent hints (source 'project-hint') are the agent's own
  // mid-flight leads: they add localization evidence but never new
  // compile-blocking obligations, otherwise pass/fail depends on run-to-run
  // agent phrasing instead of the source being planned.
  return record.source !== 'project-hint' && CRITICAL_NEED_KINDS.has(record.kind);
}

// Derived from the shared generic-surface vocabulary so the two lists cannot
// diverge; 'general' is the inventory fallback hint, not a surface term.
const GENERIC_SCOPE_LABELS = new Set([...GENERIC_SURFACE_TERMS, 'general']);

export interface CriticalNeedPartition { rescopable: string[]; unrescopable: string[] }

/**
 * Split critical unresolved needs by whether the rescope loop can remedy
 * them. Scoped reruns select needs through directive criterion ids, so a
 * need with no linked criteria (e.g. derived from an unkeyed hint) can never
 * be re-explored - counting it toward fail-closed would abort compiles the
 * loop structurally cannot save.
 */
export function partitionCriticalUnresolvedNeeds(bundle: SourceLocalizationBundle, inventory: SourceInventory): CriticalNeedPartition {
  const critical = new Set(criticalUnresolvedNeedIds(bundle, inventory));
  const linked = new Set(bundle.records.filter((record) => record.linkedCriterionIds.length > 0).map((record) => record.needId));
  return {
    rescopable: [...critical].filter((needId) => linked.has(needId)).sort(),
    unrescopable: [...critical].filter((needId) => !linked.has(needId)).sort(),
  };
}

export interface RescopeRiskClassification { risky: boolean; reasons: string[] }

/**
 * A degraded exploration outcome is risky when existing deterministic signals
 * say localization cannot be trusted: a low non-empty high-confidence share or
 * a collapsed root spanning more concrete subsystems than one planning unit
 * allows. Generic lexical surfaces and unresolved inferred interface labels
 * trigger repository inspection, not architectural decomposition. Rescoping
 * only remedies the collapsed-root pathology, so an already-decomposed graph is never risky
 * here - it keeps today's warning-only degradation.
 */
export function classifyRescopeRisk(input: { bundle: SourceLocalizationBundle; inventory: SourceInventory; graph: PlanningAtomGraph; limits: PlanningDecompositionLimits }): RescopeRiskClassification {
  if (input.graph.atoms.length > 1) return { risky: false, reasons: [`already-decomposed (${input.graph.atoms.length} atoms)`] };
  const reasons: string[] = [];
  const skip = decideExplorationSkip(input.bundle, input.inventory.summary.criterionCount);
  // A source with no literal path/directory needs requires bounded repository
  // inspection, but 0/0 is not evidence that the root scope is unsafe. Treating
  // it as a zero-percent share pre-splits small lexical categories (for example
  // implementation versus test criteria) before the model can propose a
  // coherent boundary.
  if (skip.literalNeedCount > 0 && skip.share < EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE) reasons.push(`low-confidence-share (${skip.highConfidenceCount}/${skip.literalNeedCount})`);
  const subsystems = new Set(input.inventory.criteria.flatMap((criterion) => criterion.subsystemHints).filter((hint) => !GENERIC_SCOPE_LABELS.has(hint)));
  if (subsystems.size > input.limits.maxSubsystemsPerUnit) reasons.push(`subsystem-diverse-root (${subsystems.size} concrete subsystems)`);
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
  const unresolvedByCriterion = unresolvedCountsByCriterion(bundle.records.filter(isUnresolved));
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
  const usedSlugs = new Map<string, number>();
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupKey, criterionIds]) => {
      // Distinct group keys can slug identically; disambiguate so directive
      // (and downstream atom) ids stay unique.
      const slug = stableSlug(groupKey);
      const collisions = usedSlugs.get(slug) ?? 0;
      usedSlugs.set(slug, collisions + 1);
      return {
        directiveId: collisions === 0 ? `rescope-${slug}` : `rescope-${slug}-${collisions + 1}`,
        groupKey,
        criterionIds,
        rationale: `degraded exploration: split by ${groupKey} (${criterionIds.length} criteria, ${criterionIds.reduce((sum, id) => sum + (unresolvedByCriterion.get(id) ?? 0), 0)} unresolved need links)`,
      };
    });
}

function unresolvedCountsByCriterion(records: SourceLocalizationRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) for (const criterionId of record.linkedCriterionIds) counts.set(criterionId, (counts.get(criterionId) ?? 0) + 1);
  return counts;
}

function sortedDirectivesByPriority(directives: PlanningRescopeDirective[], bundle: SourceLocalizationBundle, inventory: SourceInventory): PlanningRescopeDirective[] {
  const unresolvedByCriterion = unresolvedCountsByCriterion(bundle.records.filter(isUnresolved));
  const criticalNeedIds = new Set(criticalUnresolvedNeedIds(bundle, inventory));
  const criticalByCriterion = unresolvedCountsByCriterion(bundle.records.filter((record) => criticalNeedIds.has(record.needId)));
  const score = (directive: PlanningRescopeDirective, counts: Map<string, number>) => directive.criterionIds.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
  return [...directives].sort((a, b) =>
    score(b, criticalByCriterion) - score(a, criticalByCriterion)
    || score(b, unresolvedByCriterion) - score(a, unresolvedByCriterion)
    || b.criterionIds.length - a.criterionIds.length
    || a.groupKey.localeCompare(b.groupKey));
}

function scopeNeedCount(bundle: SourceLocalizationBundle, directive: PlanningRescopeDirective): number {
  const wanted = new Set(directive.criterionIds);
  return bundle.records.filter((record) => isUnresolved(record) && record.linkedCriterionIds.some((id) => wanted.has(id))).length;
}

function deriveLedgerBudget(input: { initialBudget: number; directives: PlanningRescopeDirective[]; bundle: SourceLocalizationBundle; rescopeLimits: AdaptiveRescopeLimits; clamp: number; includeBroadPass: boolean }): number {
  const broadBudget = input.includeBroadPass ? input.initialBudget : 0;
  const scopedBudget = input.directives.reduce((sum, directive) => sum + deriveExplorationToolBudget(scopeNeedCount(input.bundle, directive), input.rescopeLimits, input.clamp), 0);
  const legacyBudget = input.initialBudget * input.rescopeLimits.explorationTotalBudgetMultiplier;
  return Math.max(legacyBudget, broadBudget + scopedBudget);
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

/** Mirrors the diagnostics schema's splitGroups cap and bounds paid agent reruns per attempt. */
const MAX_RESCOPE_DIRECTIVES_PER_ATTEMPT = 64;

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
  // Project hints never carry ignore prefixes/globs (the only hint inputs that
  // shape the index), so one repository index serves every localization pass.
  const index = await deriveRepositoryIndex({ cwd: input.cwd });
  const baseline = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.inventory, graph, index });
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
  const runExploration = async (bundle: SourceLocalizationBundle, scopedGraph: PlanningAtomGraph, budget: number, scopeNeedIds?: string[]) => {
    const result = await runRepositoryExplorationAgent({
      cwd: input.cwd, harness: input.harness,
      agentOptions: { ...(input.agentOptions ?? {}), maxTurns: input.agentOptions?.maxTurns ?? deriveExplorationMaxTurns(budget) },
      inventory: input.inventory, baselineBundle: bundle, graph: scopedGraph,
      maxToolUses: budget, scopeNeedIds, abortSignal: input.abortSignal, onEvent: input.onEvent,
    });
    // A submission without tool uses still consumed a paid agent invocation;
    // charging at least 1 keeps the ledger the bound on invocation count.
    diagnostics.ledger.usedToolUses += Math.max(1, result.toolUses);
    const droppedHintCount = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
    if (droppedHintCount > 0) emit(`Repository exploration dropped ${droppedHintCount} invalid hint entries.`, 'warning');
    if (result.status === 'degraded') emit(`Repository exploration degraded to no hints: ${result.diagnostics.map((diagnostic) => diagnostic.message).join('; ') || 'no hints submitted'}`, 'warning');
    return result;
  };

  const risk = classifyRescopeRisk({ bundle: baseline, inventory: input.inventory, graph, limits: input.limits });
  diagnostics.riskReasons = risk.reasons;
  let bundle = baseline;
  let hints: SourceLocalizationInputHints | undefined;
  let outcome: RepositoryExplorationOutcome = { status: 'needs-rescope', reasons: ['too-broad'], notes: 'Risky collapsed scope split before broad exploration.' };
  const unknownIdDrops: Array<{ field: string; id: string; index?: number }> = [];
  let directives = risk.risky ? sortedDirectivesByPriority(deriveRescopeDirectives(input.inventory, baseline), baseline, input.inventory) : [];
  if (directives.length > MAX_RESCOPE_DIRECTIVES_PER_ATTEMPT) directives = directives.slice(0, MAX_RESCOPE_DIRECTIVES_PER_ATTEMPT);

  if (risk.risky && directives.length >= 2 && rescopeLimits.maxRescopeAttempts > 0) {
    diagnostics.ledger.totalToolUseBudget = deriveLedgerBudget({ initialBudget, directives, bundle: baseline, rescopeLimits, clamp: input.limits.maxLocalExplorationToolUses, includeBroadPass: false });
    emit(`Adaptive rescope pre-split: root scope is risky (${risk.reasons.join('; ')}); splitting before broad repository exploration.`);
  } else {
    diagnostics.ledger.totalToolUseBudget = initialBudget * rescopeLimits.explorationTotalBudgetMultiplier;
    const initial = await runExploration(baseline, graph, initialBudget);
    hints = initial.hints;
    outcome = initial.outcome;
    unknownIdDrops.push(...initial.unknownIdDrops);
    if (outcome.status === 'completed' && hints) {
      emit(`Repository exploration produced ${hints.projectHints?.length ?? 0} localization hints in ${initial.toolUses} tool uses.`);
      return { hints, outcome, unknownIdDrops, diagnostics };
    }
    if (!risk.risky) {
      diagnostics.status = 'warning-only';
      emit(`Repository exploration degraded (${outcome.status}) but deterministic localization confidence is sufficient; proceeding with a warning.`, 'warning');
      return { hints, outcome, unknownIdDrops, diagnostics };
    }
    diagnostics.ledger.totalToolUseBudget = deriveLedgerBudget({ initialBudget, directives, bundle: baseline, rescopeLimits, clamp: input.limits.maxLocalExplorationToolUses, includeBroadPass: true });
  }

  const everScopedRerunNeedIds = new Set<string>();
  for (let attempt = 1; attempt <= rescopeLimits.maxRescopeAttempts; attempt += 1) {
    let derived = attempt === 1 && directives.length > 0 ? directives : sortedDirectivesByPriority(deriveRescopeDirectives(input.inventory, bundle), bundle, input.inventory);
    if (derived.length === 0) {
      diagnostics.status = 'warning-only';
      emit(`Adaptive rescope attempt ${attempt}: no split signal (single scope); proceeding degraded with a warning.`, 'warning');
      return { hints, outcome, unknownIdDrops, rescopeDirectives: directives.length > 0 ? directives : undefined, diagnostics };
    }
    if (derived.length > MAX_RESCOPE_DIRECTIVES_PER_ATTEMPT) {
      emit(`Adaptive rescope attempt ${attempt}: capping ${derived.length} split scopes to ${MAX_RESCOPE_DIRECTIVES_PER_ATTEMPT}; ${derived.length - MAX_RESCOPE_DIRECTIVES_PER_ATTEMPT} scope(s) will not be re-explored.`, 'warning');
      derived = derived.slice(0, MAX_RESCOPE_DIRECTIVES_PER_ATTEMPT);
    }
    directives = sortedDirectivesByPriority(derived, bundle, input.inventory);
    diagnostics.attempts = attempt;
    diagnostics.splitGroups = directives.map(({ directiveId, groupKey, criterionIds, rationale }) => ({ directiveId, groupKey, criterionIds, rationale }));
    const rescopedGraph = derivePlanningAtomGraph({ content: input.sourceContent, hash: input.inventory.sourceHash, limits: input.limits, inventory: input.inventory, rescopeDirectives: directives });
    diagnostics.revisedAtomCount = rescopedGraph.atoms.length;
    emit(`Adaptive rescope attempt ${attempt}/${rescopeLimits.maxRescopeAttempts}: split ${diagnostics.originalAtomCount} atom(s) into ${rescopedGraph.atoms.length} across ${directives.length} scopes (${risk.reasons.join('; ')}).`);
    bundle = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.inventory, graph: rescopedGraph, hints, index });
    let rerunsThisAttempt = 0;
    let budgetSkipsThisAttempt = 0;
    const skippedScopeNeedIds = new Set<string>();
    const scopedRerunNeedIds = new Set<string>();
    const attemptOutcomes: RepositoryExplorationOutcome[] = [];
    for (const [directiveIndex, directive] of directives.entries()) {
      const wanted = new Set(directive.criterionIds);
      const scopeNeeds = bundle.records.filter((record) => isUnresolved(record) && record.linkedCriterionIds.some((id) => wanted.has(id)));
      if (scopeNeeds.length === 0) {
        pushUnique(diagnostics.preservedScopeKeys, directive.groupKey);
        continue;
      }
      const remaining = diagnostics.ledger.totalToolUseBudget - diagnostics.ledger.usedToolUses;
      const reserveForLater = directives.slice(directiveIndex + 1).reduce((sum, later) => {
        const laterNeedCount = scopeNeedCount(bundle, later);
        return laterNeedCount === 0 ? sum : sum + Math.min(deriveExplorationToolBudget(laterNeedCount, rescopeLimits, input.limits.maxLocalExplorationToolUses), rescopeLimits.explorationBudgetBaseToolUses);
      }, 0);
      const desiredBudget = deriveExplorationToolBudget(scopeNeeds.length, rescopeLimits, input.limits.maxLocalExplorationToolUses);
      const budget = Math.min(desiredBudget, Math.max(0, remaining - reserveForLater));
      if (budget < 1) {
        budgetSkipsThisAttempt += 1;
        for (const record of scopeNeeds) skippedScopeNeedIds.add(record.needId);
        emit(`Adaptive rescope: cross-run tool budget exhausted (${diagnostics.ledger.usedToolUses}/${diagnostics.ledger.totalToolUseBudget}); scope ${directive.groupKey} not rerun.`, 'warning');
        continue;
      }
      pushUnique(diagnostics.rerunScopeKeys, directive.groupKey);
      rerunsThisAttempt += 1;
      for (const record of scopeNeeds) {
        scopedRerunNeedIds.add(record.needId);
        everScopedRerunNeedIds.add(record.needId);
      }
      const scoped = await runExploration(bundle, rescopedGraph, budget, scopeNeeds.map((record) => record.needId).sort());
      unknownIdDrops.push(...scoped.unknownIdDrops);
      attemptOutcomes.push(scoped.outcome);
      if (scoped.hints) hints = mergeHints(hints, scoped.hints);
    }
    // Merge this attempt's scoped outcomes; a completed scope must not mask a
    // budget-exhausted or ambiguous sibling in diagnostics.
    if (attemptOutcomes.length > 0) outcome = attemptOutcomes.reduce(mergeOutcomes);
    bundle = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.inventory, graph: rescopedGraph, hints, index });
    const critical = partitionCriticalUnresolvedNeeds(bundle, input.inventory);
    diagnostics.unresolvedCriticalNeedIds = critical.rescopable;
    if (critical.unrescopable.length > 0) {
      emit(`Adaptive rescope: ${critical.unrescopable.length} critical need(s) have no linked criteria and cannot be re-explored (${critical.unrescopable.slice(0, 5).join(', ')}); excluded from the fail-closed gate.`, 'warning');
    }
    if (critical.rescopable.length === 0) {
      if (rerunsThisAttempt > 0 && outcome && outcome.status !== 'completed') {
        diagnostics.status = 'exhausted-proceeded';
        emit(`Adaptive rescope attempt ${attempt}: re-explored ${rerunsThisAttempt} scope(s); only non-critical localization needs remain after ${outcome.status}; compiling ${rescopedGraph.atoms.length} rescoped scopes with warnings.`, 'warning');
      } else if (rerunsThisAttempt > 0) {
        diagnostics.status = 'rescoped';
        emit(`Adaptive rescope attempt ${attempt}: re-explored ${rerunsThisAttempt} scope(s); no critical localization needs remain; compiling ${rescopedGraph.atoms.length} rescoped scopes.`);
      } else if (budgetSkipsThisAttempt > 0) {
        diagnostics.status = 'exhausted-proceeded';
        emit(`Adaptive rescope attempt ${attempt}: tool budget exhausted before any scoped rerun (${diagnostics.ledger.usedToolUses}/${diagnostics.ledger.totalToolUseBudget}); only non-critical needs unresolved, proceeding degraded with ${rescopedGraph.atoms.length} rescoped scopes.`, 'warning');
      } else {
        diagnostics.status = 'rescoped';
        emit(`Adaptive rescope attempt ${attempt}: all ${directives.length} scopes already localized; compiling ${rescopedGraph.atoms.length} rescoped scopes without re-exploration.`);
      }
      return { hints, outcome, unknownIdDrops, rescopeDirectives: directives, diagnostics };
    }
    if (budgetSkipsThisAttempt > 0) {
      const remainingAfterRerun = critical.rescopable.filter((needId) => everScopedRerunNeedIds.has(needId));
      const remainingOnlyFromSkippedScopes = critical.rescopable.every((needId) => skippedScopeNeedIds.has(needId) && !everScopedRerunNeedIds.has(needId));
      if (remainingOnlyFromSkippedScopes) {
        diagnostics.status = 'exhausted-proceeded';
        emit(`Adaptive rescope attempt ${attempt}: ${critical.rescopable.length} critical need(s) remain only in scope(s) skipped by the exploration budget; compiling ${rescopedGraph.atoms.length} rescoped scopes with low-confidence localization warnings instead of failing closed on budget starvation.`, 'warning');
        return { hints, outcome, unknownIdDrops, rescopeDirectives: directives, diagnostics };
      }
      emit(`Adaptive rescope attempt ${attempt}: ${remainingAfterRerun.length} critical need(s) remain after scoped reruns; not masking them behind ${budgetSkipsThisAttempt} budget-skipped scope(s).`, 'warning');
    }
    // Critical needs remain and nothing was rerun: further attempts would
    // replay identical directives against the same exhausted ledger, so stop.
    if (rerunsThisAttempt === 0) break;
  }

  if (diagnostics.attempts === 0) {
    // Rescope attempts disabled by limits: behave like the warning-only path.
    diagnostics.status = 'warning-only';
    emit('Adaptive rescoping disabled (0 attempts); proceeding degraded with a warning.', 'warning');
    return { hints, outcome, unknownIdDrops, diagnostics };
  }
  // Every attempt ended with rescopable critical needs outstanding (resolved
  // criticals return inside the loop), so exhaustion here always fails closed.
  diagnostics.status = 'fail-closed';
  const reason = `Adaptive rescoping exhausted after ${diagnostics.attempts}/${rescopeLimits.maxRescopeAttempts} attempt(s) with ${diagnostics.unresolvedCriticalNeedIds.length} critical source need(s) unresolved or below high confidence (${diagnostics.unresolvedCriticalNeedIds.slice(0, 10).join(', ')}); failing compile instead of producing vague plans. Tool ledger: ${diagnostics.ledger.usedToolUses}/${diagnostics.ledger.totalToolUseBudget}.`;
  throw new AdaptiveRescopeFailClosedError(reason, diagnostics);
}

const OUTCOME_STATUS_SEVERITY: Record<RepositoryExplorationOutcome['status'], number> = { 'completed': 0, 'needs-rescope': 1, 'ambiguous': 2, 'budget-exhausted': 3 };

/** Merge scoped rerun outcomes: most-degraded status wins, id/path lists union, tool counts sum. */
function mergeOutcomes(base: RepositoryExplorationOutcome, extra: RepositoryExplorationOutcome): RepositoryExplorationOutcome {
  const notes = [base.notes, extra.notes].filter(Boolean).join('; ');
  return {
    status: OUTCOME_STATUS_SEVERITY[extra.status] > OUTCOME_STATUS_SEVERITY[base.status] ? extra.status : base.status,
    unresolvedNeedIds: mergedList(base.unresolvedNeedIds, extra.unresolvedNeedIds, 100),
    reasons: mergedList(base.reasons, extra.reasons, 32),
    attemptedQueries: [...(base.attemptedQueries ?? []), ...(extra.attemptedQueries ?? [])].slice(0, 100),
    candidatePaths: mergedList(base.candidatePaths, extra.candidatePaths, 100),
    rescopeHints: mergedList(base.rescopeHints, extra.rescopeHints, 32),
    ...(notes ? { notes: notes.slice(0, 2_000) } : {}),
    toolUseCount: (base.toolUseCount ?? 0) + (extra.toolUseCount ?? 0),
  };
}

function mergedList<T>(base: T[] | undefined, extra: T[] | undefined, maxItems: number): T[] {
  return [...new Set([...(base ?? []), ...(extra ?? [])])].slice(0, maxItems);
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
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
