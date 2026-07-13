import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import { runPlanningAtomMap, type PlanningAtomMapResult } from './atom-map-runner.js';
import type { PlanningReduceGap, PlanningReduceGapIssueKind, PlanningReduceLimits } from './reduce-contracts.js';
import { runPlanningReduce, type PlanningReduceResult } from './reduce-runner.js';
import { deriveSharedPlanningBrief, synthesizeRepairEvidenceOwnership } from './shared-brief.js';
import type { SharedPlanningBrief, SharedPlanningBriefLimits } from './shared-brief-contracts.js';
import type { PlanningSourceEvidenceBundle, PlanningSourceEvidenceLimits, PlanningSourceEvidenceRecord, PlanningSourceEvidenceStatus } from './source-evidence-contracts.js';
import { materializePlanningSourceEvidence } from './source-evidence-materialization.js';
import { classifyEvidenceCandidate, normalizeEvidenceValue } from './evidence-hygiene.js';
import type { SourceInventory } from './source-inventory.js';
import { deriveSourceLocalization } from './source-localization.js';
import type { SourceLocalizationBundle, SourceLocalizationHint, SourceLocalizationInputHints, SourceLocalizationLimits, SourceLocalizationStatus } from './source-localization-contracts.js';
import type { PlannerCompilerEventSink } from './event-sink.js';

export const DEFAULT_SOURCE_LOCALIZATION_REPAIR_ATTEMPTS = 1;

export type SourceLocalizationRepairStatus = 'not-needed' | 'repaired' | 'unresolved' | 'exhausted';
export type SourceLocalizationRepairCoverageStatus = 'covered' | 'missing' | 'unknown';

export interface ClassifiedPlanningReduceGap {
  gap: PlanningReduceGap;
  issueKind: PlanningReduceGapIssueKind;
  sourceLocalizationSignal: boolean;
  sourceNeedIds: string[];
  affectedAtomIds: string[];
  criterionIds: string[];
  aspectIds: string[];
  ownerPaths: string[];
  productScopedOutputRefs: string[];
  productScopedValidationRefs: string[];
}

export interface SourceLocalizationRepairDiagnostic {
  attempt: number;
  status: SourceLocalizationRepairStatus;
  maxAttempts: number;
  gapIds: string[];
  gapClassifications: Array<{ gapId: string; issueKind: PlanningReduceGapIssueKind; sourceLocalizationSignal: boolean }>;
  sourceNeedIds: string[];
  affectedAtomIds: string[];
  criterionIds: string[];
  aspectIds: string[];
  localizedOwnerPaths: string[];
  localizedOwnerStatus: Array<{ path: string; status: SourceLocalizationStatus | 'none'; needIds: string[] }>;
  evidenceMaterializationStatus: Array<{ path: string; status: PlanningSourceEvidenceStatus | 'none'; reason?: string; budgetAtomIds?: string[]; priority?: boolean }>;
  coverageStatus: { criteria: Record<string, SourceLocalizationRepairCoverageStatus>; aspects: Record<string, SourceLocalizationRepairCoverageStatus>; sourceNeeds: Record<string, SourceLocalizationRepairCoverageStatus> };
  unresolvedReason?: string;
  residueSynthesisBlocked: boolean;
}

export interface SourceLocalizationRepairResult {
  sourceLocalizationBundle: SourceLocalizationBundle;
  sharedBrief: SharedPlanningBrief;
  sourceEvidenceBundle: PlanningSourceEvidenceBundle;
  map: PlanningAtomMapResult;
  reduce: PlanningReduceResult;
  diagnostics: SourceLocalizationRepairDiagnostic[];
  status: SourceLocalizationRepairStatus;
}

interface RunSourceLocalizationRepairLoopInput {
  cwd: string;
  sourceContent: string;
  sourceInventory: SourceInventory;
  graph: PlanningAtomGraph;
  harness: AgentHarness;
  agentOptions?: SdkPassthroughConfig & { maxTurns?: number };
  sourceLocalizationBundle: SourceLocalizationBundle;
  sharedBrief: SharedPlanningBrief;
  sourceEvidenceBundle: PlanningSourceEvidenceBundle;
  map: PlanningAtomMapResult;
  reduce: PlanningReduceResult;
  sourceLocalizationHints?: SourceLocalizationInputHints;
  sourceLocalizationLimits?: Partial<SourceLocalizationLimits>;
  sharedBriefLimits?: Partial<SharedPlanningBriefLimits>;
  sourceEvidenceLimits?: Partial<PlanningSourceEvidenceLimits>;
  reduceLimits?: Partial<PlanningReduceLimits>;
  reduceDigestPromptBudgetBytes?: number;
  maxAttempts?: number;
  parallelism?: number;
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

const SOURCE_GAP_KINDS = new Set<PlanningReduceGapIssueKind>(['missing-owner-path', 'missing-contract-evidence', 'missing-entrypoint-evidence', 'missing-config-evidence', 'missing-consumer-surface-evidence', 'directory-only-evidence', 'missing-materialized-source', 'localization-ambiguity']);
const MAX_REPAIR_PROJECT_HINTS = 100;
const MAX_REPAIR_HINTS_PER_GAP = 16;
const MAX_FALLBACK_SOURCE_NEEDS_PER_GAP = 16;
const MAX_REPAIR_PRIORITY_PATHS = 32;
const MAX_SOFT_PRIORITY_PATHS_PER_GAP = 8;
const MAX_UNRESOLVED_REASON_PATHS = 8;

// Exploration-only vocabulary kinds: they describe why exploration could not localize, not a repairable
// reduce gap, so they must never be re-inferred into a source-gap kind from gap text. They trigger repair
// only when the reducer explicitly sets sourceLocalizationSignal.
const EXPLORATION_ONLY_GAP_KINDS = new Set<PlanningReduceGapIssueKind>(['too-broad', 'tool-budget']);

export async function runSourceLocalizationRepairLoop(input: RunSourceLocalizationRepairLoopInput): Promise<SourceLocalizationRepairResult> {
  const maxAttempts = Math.max(0, input.maxAttempts ?? DEFAULT_SOURCE_LOCALIZATION_REPAIR_ATTEMPTS);
  let state = { sourceLocalizationBundle: input.sourceLocalizationBundle, sharedBrief: input.sharedBrief, sourceEvidenceBundle: input.sourceEvidenceBundle, map: input.map, reduce: input.reduce };
  const diagnostics: SourceLocalizationRepairDiagnostic[] = [];
  let gaps = classifyPlanningReduceGaps(state.reduce.outputs, state.sourceLocalizationBundle, state.sourceEvidenceBundle, input.graph);
  if (gaps.length === 0) return { ...state, diagnostics, status: 'not-needed' };
  if (maxAttempts === 0) {
    const affectedAtomIds = resolveAffectedAtomIds({ gaps, graph: input.graph, sourceLocalizationBundle: state.sourceLocalizationBundle, sourceEvidenceBundle: state.sourceEvidenceBundle });
    diagnostics.push(buildRepairDiagnostic({ attempt: 0, maxAttempts, gaps, affectedAtomIds, graph: input.graph, sourceLocalizationBundle: state.sourceLocalizationBundle, sourceEvidenceBundle: state.sourceEvidenceBundle, status: 'exhausted', unresolvedReasonOverride: 'repair attempts disabled' }));
    return { ...state, diagnostics, status: 'exhausted' };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const affectedAtomIds = resolveAffectedAtomIds({ gaps, graph: input.graph, sourceLocalizationBundle: state.sourceLocalizationBundle, sourceEvidenceBundle: state.sourceEvidenceBundle });
    const repairHints = mergeRepairHints(input.sourceLocalizationHints, hintsForGaps(gaps, affectedAtomIds, state.sourceLocalizationBundle, input.sourceInventory, input.graph));
    const sourceLocalizationBundle = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.sourceInventory, graph: input.graph, hints: repairHints, limits: input.sourceLocalizationLimits });
    const priorityPaths = repairPriorityPaths(gaps, sourceLocalizationBundle);
    const sharedBrief = withSyntheticRepairOwnership(deriveSharedPlanningBrief({ graph: input.graph, sourceLocalizationBundle, limits: input.sharedBriefLimits }), gaps, affectedAtomIds, input.graph);
    const sourceEvidenceBundle = await materializePlanningSourceEvidence({ cwd: input.cwd, graph: input.graph, sharedBrief, limits: input.sourceEvidenceLimits, priorityPaths });
    const map = affectedAtomIds.length === 0 ? state.map : await runPlanningAtomMap({ graph: input.graph, inventory: input.sourceInventory, sharedBrief, sourceEvidenceBundle, sourceContent: input.sourceContent, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, reduceDigestPromptBudgetBytes: input.reduceDigestPromptBudgetBytes, parallelism: input.parallelism, abortSignal: input.abortSignal, onEvent: input.onEvent, affectedAtomIds, priorOutputs: state.map.outputs });
    const reduce = await runPlanningReduce({ graph: input.graph, mapResult: map, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, limits: input.reduceLimits, sourceLocalizationBundle, abortSignal: input.abortSignal, onEvent: input.onEvent });
    state = { sourceLocalizationBundle, sharedBrief, sourceEvidenceBundle, map, reduce };
    const unresolved = classifyPlanningReduceGaps(reduce.outputs, sourceLocalizationBundle, sourceEvidenceBundle, input.graph);
    const diagnosticGaps = unresolved.length === 0 ? gaps : unresolved;
    const diagnosticAffectedAtomIds = unresolved.length === 0 ? affectedAtomIds : resolveAffectedAtomIds({ gaps: unresolved, graph: input.graph, sourceLocalizationBundle, sourceEvidenceBundle });
    diagnostics.push(buildRepairDiagnostic({ attempt, maxAttempts, gaps: diagnosticGaps, affectedAtomIds: diagnosticAffectedAtomIds, graph: input.graph, sourceLocalizationBundle, sourceEvidenceBundle, status: unresolved.length === 0 ? 'repaired' : attempt >= maxAttempts ? 'exhausted' : 'unresolved' }));
    gaps = unresolved;
    if (gaps.length === 0) return { ...state, diagnostics, status: 'repaired' };
  }
  return { ...state, diagnostics, status: 'exhausted' };
}

export function classifyPlanningReduceGaps(outputs: PlanningReduceResult['outputs'], localization: SourceLocalizationBundle, evidence: PlanningSourceEvidenceBundle, graph: PlanningAtomGraph): ClassifiedPlanningReduceGap[] {
  return outputs.flatMap((output) => (output.gaps ?? [])
    .filter((gap) => gap.representationRequired)
    .map((gap) => classifyPlanningReduceGap(gap, localization, evidence, graph))
    .filter((gap): gap is ClassifiedPlanningReduceGap => Boolean(gap?.sourceLocalizationSignal)));
}

export function classifyPlanningReduceGap(gap: PlanningReduceGap, localization?: SourceLocalizationBundle, evidence?: PlanningSourceEvidenceBundle, graph?: PlanningAtomGraph): ClassifiedPlanningReduceGap | undefined {
  const explorationOnly = gap.issueKind !== undefined && EXPLORATION_ONLY_GAP_KINDS.has(gap.issueKind);
  if (explorationOnly && gap.sourceLocalizationSignal !== true) return undefined;
  const issueKind = explorationOnly ? gap.issueKind! : gap.issueKind && SOURCE_GAP_KINDS.has(gap.issueKind) ? gap.issueKind : inferIssueKind(gap, localization, evidence);
  const sourceLocalizationSignal = gap.sourceLocalizationSignal === true || SOURCE_GAP_KINDS.has(issueKind);
  if (!sourceLocalizationSignal) return undefined;
  const ownerPaths = uniq([...(gap.ownerPaths ?? []), ...extractPathSignals(`${gap.title} ${gap.description}`)]);
  const validNeedIds = new Set(localization?.records.map((record) => record.needId) ?? []);
  // Bad reducer ids must not suppress criterion/aspect fallback localization.
  const explicitNeedIds = (gap.sourceNeedIds ?? []).filter((needId) => validNeedIds.has(needId));
  const derivedNeedIds = uniq(explicitNeedIds.length > 0 ? explicitNeedIds : sourceNeedIdsForGap({ ...gap, sourceNeedIds: [] }, ownerPaths, localization));
  // A structured source-localization gap remains traceable even when a broad
  // source produced no deterministic localization records to link back to.
  const sourceNeedIds = derivedNeedIds.length > 0 ? derivedNeedIds : [`${issueKind === 'missing-owner-path' ? 'missing-localized-owner-path' : issueKind}-${gap.gapId}`];
  return {
    gap: { ...gap, issueKind, sourceLocalizationSignal: true, sourceNeedIds, ownerPaths },
    issueKind,
    sourceLocalizationSignal: true,
    sourceNeedIds,
    affectedAtomIds: (() => {
      const explicit = (gap.affectedAtomIds ?? []).filter((atomId) => graph?.atoms.some((atom) => atom.atomId === atomId) ?? false);
      return uniq(explicit.length > 0 ? explicit : atomIdsForGap(gap, sourceNeedIds, ownerPaths, localization, evidence, graph));
    })(),
    criterionIds: uniq(gap.criterionIds),
    aspectIds: uniq(gap.aspectIds),
    ownerPaths,
    productScopedOutputRefs: uniq(gap.productScopedOutputRefs ?? []),
    productScopedValidationRefs: uniq(gap.productScopedValidationRefs ?? []),
  };
}

export function resolveAffectedAtomIds(input: { gaps: ClassifiedPlanningReduceGap[]; graph: PlanningAtomGraph; sourceLocalizationBundle: SourceLocalizationBundle; sourceEvidenceBundle: PlanningSourceEvidenceBundle }): string[] {
  return uniq(input.gaps.flatMap((gap) => gap.affectedAtomIds.length > 0 ? gap.affectedAtomIds : atomIdsForGap(gap.gap, gap.sourceNeedIds, gap.ownerPaths, input.sourceLocalizationBundle, input.sourceEvidenceBundle, input.graph))).filter((atomId) => input.graph.atoms.some((atom) => atom.atomId === atomId));
}

function buildRepairDiagnostic(input: { attempt: number; maxAttempts: number; gaps: ClassifiedPlanningReduceGap[]; affectedAtomIds: string[]; graph: PlanningAtomGraph; sourceLocalizationBundle: SourceLocalizationBundle; sourceEvidenceBundle: PlanningSourceEvidenceBundle; status: SourceLocalizationRepairStatus; unresolvedReasonOverride?: string }): SourceLocalizationRepairDiagnostic {
  const sourceNeedIds = uniq(input.gaps.flatMap((gap) => gap.sourceNeedIds));
  const criterionIds = uniq(input.gaps.flatMap((gap) => gap.criterionIds));
  const aspectIds = uniq(input.gaps.flatMap((gap) => gap.aspectIds));
  const localizedOwnerPaths = localizedPathsFor(input.gaps, input.sourceLocalizationBundle);
  const evidenceByPath = new Map(input.sourceEvidenceBundle.records.map((record) => [record.path, record]));
  return {
    attempt: input.attempt,
    status: input.status,
    maxAttempts: input.maxAttempts,
    gapIds: input.gaps.map((gap) => gap.gap.gapId).sort(),
    gapClassifications: input.gaps.map((gap) => ({ gapId: gap.gap.gapId, issueKind: gap.issueKind, sourceLocalizationSignal: true })).sort((a, b) => a.gapId.localeCompare(b.gapId)),
    sourceNeedIds,
    affectedAtomIds: [...input.affectedAtomIds].sort(),
    criterionIds,
    aspectIds,
    localizedOwnerPaths,
    localizedOwnerStatus: localizedOwnerPaths.map((path) => ownerStatus(path, input.sourceLocalizationBundle)),
    evidenceMaterializationStatus: localizedOwnerPaths.map((path) => {
      const record = evidenceByPath.get(path);
      return { path, status: record?.status ?? 'none' as const, ...(record?.reason ? { reason: record.reason } : {}), ...(record?.budgetAtomIds && record.budgetAtomIds.length > 0 ? { budgetAtomIds: [...record.budgetAtomIds] } : {}), ...(record?.priority ? { priority: true } : {}) };
    }),
    coverageStatus: { criteria: coverageRecord(criterionIds, input.graph.atoms.flatMap((atom) => atom.criterionIds)), aspects: coverageRecord(aspectIds, [...input.sourceLocalizationBundle.records.flatMap((record) => record.linkedAspectIds), ...aspectIds]), sourceNeeds: coverageRecord(sourceNeedIds, [...input.sourceLocalizationBundle.records.map((record) => record.needId), ...sourceNeedIds]) },
    ...(input.status === 'exhausted' || input.status === 'unresolved' ? { unresolvedReason: input.unresolvedReasonOverride ?? unresolvedReason(input.gaps, input.affectedAtomIds, localizedOwnerPaths, input.sourceEvidenceBundle) } : {}),
    residueSynthesisBlocked: true,
  };
}

function inferIssueKind(gap: PlanningReduceGap, localization?: SourceLocalizationBundle, evidence?: PlanningSourceEvidenceBundle): PlanningReduceGapIssueKind {
  const text = `${gap.title} ${gap.description}`.toLowerCase();
  if (/ambiguous|ambiguity|multiple candidates|partial localization/.test(text)) return 'localization-ambiguity';
  if (/directory only|directory-only|broad directory|directory evidence/.test(text)) return 'directory-only-evidence';
  if (/materiali[sz]ed|file not found|missing source|too large|read error|budget/.test(text) || evidence?.records.some((record) => gap.sourceIds?.includes(record.path) && record.status !== 'materialized')) return 'missing-materialized-source';
  if (/owner path|localized owner|missing owner|no owner/.test(text)) return 'missing-owner-path';
  if (/consumer surface|public surface|user-facing/.test(text)) return 'missing-consumer-surface-evidence';
  if (/entrypoint|entry point|main export/.test(text)) return 'missing-entrypoint-evidence';
  if (/config|configuration|settings/.test(text)) return 'missing-config-evidence';
  if (/contract|schema|interface/.test(text)) return 'missing-contract-evidence';
  if (localization?.records.some((record) => gap.sourceNeedIds?.includes(record.needId) && record.status !== 'resolved')) return 'missing-owner-path';
  return 'generic';
}

function atomIdsForGap(gap: PlanningReduceGap, sourceNeedIds: string[], ownerPaths: string[], localization?: SourceLocalizationBundle, evidence?: PlanningSourceEvidenceBundle, graph?: PlanningAtomGraph): string[] {
  const fromNeeds = localization?.records.filter((record) => sourceNeedIds.includes(record.needId)).flatMap((record) => record.assignedAtomIds) ?? [];
  const fromRecords = localization?.records.filter((record) => overlaps(record.linkedCriterionIds, gap.criterionIds) || overlaps(record.linkedAspectIds, gap.aspectIds) || record.candidateFiles.some((candidate) => ownerPaths.includes(candidate.path))).flatMap((record) => record.assignedAtomIds) ?? [];
  const fromEvidence = evidence?.records.filter((record) => ownerPaths.includes(record.path)).flatMap((record) => record.referencedByAtomIds) ?? [];
  const fromGraph = graph?.atoms.filter((atom) => overlaps(atom.criterionIds, gap.criterionIds) || overlaps(atom.facetIds, gap.aspectIds) || atom.evidencePaths.some((path) => ownerPaths.includes(path))).map((atom) => atom.atomId) ?? [];
  return uniq([...fromNeeds, ...fromRecords, ...fromEvidence, ...fromGraph]);
}

function sourceNeedIdsForGap(gap: PlanningReduceGap, ownerPaths: string[], localization?: SourceLocalizationBundle): string[] {
  if (!localization) return [];
  const explicit = localization.records.filter((record) => ownerPaths.includes(record.query) || record.candidateFiles.some((candidate) => ownerPaths.includes(candidate.path))).map((record) => record.needId);
  if (gap.sourceNeedIds?.length || explicit.length > 0) return uniq([...(gap.sourceNeedIds ?? []), ...explicit]);
  return localization.records
    .filter((record) => overlaps(record.linkedCriterionIds, gap.criterionIds) || overlaps(record.linkedAspectIds, gap.aspectIds))
    .sort(compareSourceNeedRepairValue)
    .slice(0, MAX_FALLBACK_SOURCE_NEEDS_PER_GAP)
    .map((record) => record.needId);
}

function hintsForGaps(gaps: ClassifiedPlanningReduceGap[], atomIds: string[], localization: SourceLocalizationBundle, inventory: SourceInventory, graph: PlanningAtomGraph): SourceLocalizationHint[] {
  const records = new Map(localization.records.map((record) => [record.needId, record]));
  return gaps.flatMap((gap) => {
    // Repair queries are evidence-derived only. Reducer prose is untrusted
    // diagnostic text and must not mint a lexical query that crosses atom
    // boundaries; criterion/aspect links on existing records remain fallback.
    const hints = [
      ...gap.ownerPaths.map((path) => ({ kind: 'literal-path' as const, query: path, paths: [path], criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, atomIds: gap.affectedAtomIds.length > 0 ? gap.affectedAtomIds : atomIds })),
      ...gap.sourceNeedIds.flatMap((needId) => {
        const record = records.get(needId);
        return record ? [{ kind: record.kind, query: record.query, criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, subsystemHints: record.subsystemHints, interfaceKeys: record.interfaceKeys, atomIds: gap.affectedAtomIds.length > 0 ? gap.affectedAtomIds : atomIds }] : [];
      }),
      ...trustedFallbackHints(gap, atomIds, inventory, graph),
    ];
    return hints.slice(0, MAX_REPAIR_HINTS_PER_GAP);
  });
}

function trustedFallbackHints(gap: ClassifiedPlanningReduceGap, atomIds: string[], inventory: SourceInventory, graph: PlanningAtomGraph): SourceLocalizationHint[] {
  // No reducer prose: derive only from the source inventory and graph.
  const criteria = inventory.criteria.filter((criterion) => gap.criterionIds.includes(criterion.id));
  const scopedAtoms = graph.atoms.filter((atom) => (gap.affectedAtomIds.length > 0 ? gap.affectedAtomIds : atomIds).includes(atom.atomId));
  const subsystemHints = [...new Set([...criteria.flatMap((criterion) => criterion.subsystemHints), ...scopedAtoms.flatMap((atom) => atom.subsystemHints)])]
    .filter((hint) => !/^(general|shared|lexical|criterion|test)$/i.test(hint));
  const interfaceKeys = [...new Set([...criteria.flatMap((criterion) => criterion.interfaceKeys), ...scopedAtoms.flatMap((atom) => atom.interfaceKeys)])];
  const paths = [...new Set([...criteria.flatMap((criterion) => criterion.evidencePaths), ...scopedAtoms.flatMap((atom) => atom.evidencePaths)])];
  const scope = gap.affectedAtomIds.length > 0 ? gap.affectedAtomIds : atomIds;
  return [
    ...paths.map((query) => ({ kind: 'literal-path' as const, query, paths: [query], criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, atomIds: scope })),
    ...interfaceKeys.map((query) => ({ kind: 'interface' as const, query, criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, subsystemHints, interfaceKeys, atomIds: scope })),
    ...subsystemHints.map((query) => ({ kind: 'subsystem' as const, query, criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, subsystemHints: [query], interfaceKeys, atomIds: scope })),
  ];
}

function mergeRepairHints(existing: SourceLocalizationInputHints | undefined, projectHints: SourceLocalizationHint[]): SourceLocalizationInputHints {
  // Reserve the bounded front of the catalog for evidence-derived repair
  // hints. Merge matching caller hints into them so needId/newFile metadata
  // survives without allowing an already-full caller catalog to displace a
  // gap's exact or criterion-linked relocalization query.
  const prioritized = dedupeHints(projectHints);
  const byKey = new Map(prioritized.map((hint) => [hintKey(hint), hint]));
  for (const hint of existing?.projectHints ?? []) {
    const key = hintKey(hint);
    const repair = byKey.get(key);
    byKey.set(key, repair ? mergeHint(repair, hint) : hint);
  }
  return { ignorePrefixes: existing?.ignorePrefixes, ignoreGlobs: existing?.ignoreGlobs, projectHints: [...byKey.values()].slice(0, MAX_REPAIR_PROJECT_HINTS) };
}

/**
 * Two-tier repair priority for evidence materialization. Hard tier: explicit
 * gap owner paths, which rank first within the total bounded repair budget.
 * Soft tier: the remaining localized candidates for the gaps (the same set
 * unresolvedReason later checks), capped per gap and in total so a broad
 * localization fan-out cannot turn "priority" into "everything".
 */
function repairPriorityPaths(gaps: ClassifiedPlanningReduceGap[], localization: SourceLocalizationBundle): string[] {
  const hard = uniq(gaps.flatMap((gap) => gap.ownerPaths.map(normalizeEvidenceValue)));
  const hardSet = new Set(hard);
  const soft = uniq(gaps.flatMap((gap) => localizedPathsFor([gap], localization)
    .map(normalizeEvidenceValue)
    .filter((path) => !hardSet.has(path))
    .slice(0, MAX_SOFT_PRIORITY_PATHS_PER_GAP)));
  // A reducer can submit many owner paths; priority is not an exemption from
  // the materializer's bounded work contract. Exact owners retain the first
  // tier, then deterministic ordering limits the total repair fan-out.
  return [...hard, ...soft].slice(0, MAX_REPAIR_PRIORITY_PATHS);
}

/**
 * Appends synthetic repair evidence ownership for hard-priority gap owner
 * paths that localization did not resolve into ownership, so the materializer
 * produces a real record for them (materialized or missing) instead of
 * leaving them without any evidence record. Materialization-only: atom briefs
 * are already built, so the synthetic entries never join ownedEvidencePaths
 * or shared-brief sections.
 */
function withSyntheticRepairOwnership(brief: SharedPlanningBrief, gaps: ClassifiedPlanningReduceGap[], affectedAtomIds: string[], graph: PlanningAtomGraph): SharedPlanningBrief {
  const existing = new Set(brief.evidenceOwnership.map((entry) => entry.path));
  const missingHardPaths = uniq(gaps.flatMap((gap) => gap.ownerPaths.map(normalizeEvidenceValue))).filter((path) => !existing.has(path));
  const synthetic = missingHardPaths.flatMap((path) => synthesizeRepairEvidenceOwnership([path], atomIdsForSyntheticPath(path, gaps, affectedAtomIds), graph));
  return synthetic.length === 0 ? brief : { ...brief, evidenceOwnership: [...brief.evidenceOwnership, ...synthetic] };
}

function atomIdsForSyntheticPath(path: string, gaps: ClassifiedPlanningReduceGap[], fallbackAtomIds: string[]): string[] {
  const matchingGapAtomIds = gaps
    .filter((gap) => gap.ownerPaths.map(normalizeEvidenceValue).includes(path))
    .flatMap((gap) => gap.affectedAtomIds);
  return uniq(matchingGapAtomIds.length > 0 ? matchingGapAtomIds : fallbackAtomIds);
}

function localizedPathsFor(gaps: ClassifiedPlanningReduceGap[], localization: SourceLocalizationBundle): string[] {
  const needIds = new Set(gaps.flatMap((gap) => gap.sourceNeedIds));
  const explicit = uniq(gaps.flatMap((gap) => gap.ownerPaths.map(normalizeEvidenceValue)));
  // A reducer-supplied owner is the authoritative repair target. Do not let
  // a criterion fallback widen its diagnostic to unrelated localized files.
  if (explicit.length > 0) return explicit;
  const localized = localization.records
    .filter((record) => needIds.has(record.needId) || explicit.includes(normalizeEvidenceValue(record.query)) || record.candidateFiles.some((candidate) => explicit.includes(normalizeEvidenceValue(candidate.path))))
    .flatMap((record) => record.candidateFiles.map((candidate) => normalizeEvidenceValue(candidate.path)));
  return uniq([...explicit, ...localized]);
}

function ownerStatus(path: string, localization: SourceLocalizationBundle): { path: string; status: SourceLocalizationStatus | 'none'; needIds: string[] } {
  const records = localization.records.filter((record) => record.candidateFiles.some((candidate) => candidate.path === path) || record.query === path);
  return { path, status: records[0]?.status ?? 'none', needIds: records.map((record) => record.needId).sort() };
}

function coverageRecord(ids: string[], coveredIds: string[]): Record<string, SourceLocalizationRepairCoverageStatus> {
  const covered = new Set(coveredIds);
  return Object.fromEntries(ids.map((id) => [id, covered.has(id) ? 'covered' : 'missing']));
}

function unresolvedReason(gaps: ClassifiedPlanningReduceGap[], atomIds: string[], paths: string[], evidence: PlanningSourceEvidenceBundle): string {
  if (atomIds.length === 0) return 'no affected atoms resolved from gap metadata';
  if (paths.length === 0) return 'no localized owner paths resolved';
  const recordByPath = new Map(evidence.records.map((record) => [record.path, record]));
  const nonMaterialized = paths.filter((path) => recordByPath.get(path)?.status !== 'materialized');
  if (nonMaterialized.length === 0) return `reducer still reports source/localization gaps:${gaps.map((gap) => gap.gap.gapId).join(',')}`;
  const detailed = nonMaterialized.slice(0, MAX_UNRESOLVED_REASON_PATHS).map((path) => describeNonMaterializedPath(path, recordByPath.get(path)));
  const overflow = nonMaterialized.length - MAX_UNRESOLVED_REASON_PATHS;
  return `localized owner paths not materialized:${detailed.join(',')}${overflow > 0 ? ` (+${overflow} more)` : ''}`;
}

function describeNonMaterializedPath(path: string, record: PlanningSourceEvidenceRecord | undefined): string {
  if (!record) return `${path}(no-evidence-record)`;
  const reason = record.reason ? `:${record.reason}` : '';
  const budgetAtoms = record.budgetAtomIds && record.budgetAtomIds.length > 0 ? `@${record.budgetAtomIds.join('+')}` : '';
  return `${path}(${record.status}${reason}${budgetAtoms})`;
}

function extractPathSignals(text: string): string[] {
  return uniq([...text.matchAll(/(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@/-]+/g)]
    .map((match) => normalizeEvidenceValue(match[0]))
    .filter((path) => !/^https?:\//.test(path) && !path.includes('..'))
    .filter((path) => classifyEvidenceCandidate(path).actionable));
}

function compareSourceNeedRepairValue(a: SourceLocalizationBundle['records'][number], b: SourceLocalizationBundle['records'][number]): number {
  return sourceNeedRepairScore(b) - sourceNeedRepairScore(a) || a.needId.localeCompare(b.needId);
}

function sourceNeedRepairScore(record: SourceLocalizationBundle['records'][number]): number {
  let score = 0;
  if (record.status !== 'resolved') score += 8;
  if (record.confidence === 'low') score += 4;
  else if (record.confidence === 'medium') score += 2;
  if (record.kind === 'literal-path' || record.kind === 'entrypoint') score += 4;
  if (record.candidateFiles.length > 0) score += 2;
  if (record.source === 'project-hint') score += 1;
  return score;
}

function dedupeHints(hints: SourceLocalizationHint[]): SourceLocalizationHint[] {
  const byKey = new Map<string, SourceLocalizationHint>();
  for (const hint of hints) {
    const key = hintKey(hint);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeHint(existing, hint) : hint);
  }
  return [...byKey.values()].sort(compareHintRepairValue);
}

function hintKey(hint: SourceLocalizationHint): string {
  return `${hint.kind}\0${hint.query}\0${(hint.paths ?? []).join('\0')}\0${(hint.criterionIds ?? []).join('\0')}\0${(hint.aspectIds ?? []).join('\0')}`;
}

function mergeHint(a: SourceLocalizationHint, b: SourceLocalizationHint): SourceLocalizationHint {
  return {
    kind: a.kind,
    query: a.query,
    paths: uniq([...(a.paths ?? []), ...(b.paths ?? [])]),
    keywords: uniq([...(a.keywords ?? []), ...(b.keywords ?? [])]),
    subsystemHints: uniq([...(a.subsystemHints ?? []), ...(b.subsystemHints ?? [])]),
    interfaceKeys: uniq([...(a.interfaceKeys ?? []), ...(b.interfaceKeys ?? [])]),
    criterionIds: uniq([...(a.criterionIds ?? []), ...(b.criterionIds ?? [])]),
    aspectIds: uniq([...(a.aspectIds ?? []), ...(b.aspectIds ?? [])]),
    atomIds: uniq([...(a.atomIds ?? []), ...(b.atomIds ?? [])]),
    ...(a.needId ?? b.needId ? { needId: a.needId ?? b.needId } : {}),
    ...(a.newFile || b.newFile ? { newFile: true } : {}),
  };
}

function compareHintRepairValue(a: SourceLocalizationHint, b: SourceLocalizationHint): number {
  return hintRepairScore(b) - hintRepairScore(a) || a.kind.localeCompare(b.kind) || a.query.localeCompare(b.query);
}

function hintRepairScore(hint: SourceLocalizationHint): number {
  let score = 0;
  if ((hint.paths ?? []).some((path) => classifyEvidenceCandidate(path).actionable)) score += 16;
  if (hint.kind === 'literal-path' || hint.kind === 'entrypoint') score += 8;
  else if (hint.kind === 'config' || hint.kind === 'interface' || hint.kind === 'consumer-surface') score += 4;
  if ((hint.atomIds ?? []).length > 0) score += 2;
  if ((hint.criterionIds ?? []).length > 0) score += 1;
  return score;
}

function overlaps(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
function uniq(values: string[]): string[] { return [...new Set(values.filter((value) => value.trim().length > 0))].sort(); }
