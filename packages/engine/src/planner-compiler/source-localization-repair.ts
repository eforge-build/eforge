import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import type { PlanningAtomGraph } from './atom-graph.js';
import { runPlanningAtomMap, type PlanningAtomMapResult } from './atom-map-runner.js';
import type { PlanningReduceGap, PlanningReduceGapIssueKind, PlanningReduceLimits } from './reduce-contracts.js';
import { runPlanningReduce, type PlanningReduceResult } from './reduce-runner.js';
import { deriveSharedPlanningBrief } from './shared-brief.js';
import type { SharedPlanningBrief, SharedPlanningBriefLimits } from './shared-brief-contracts.js';
import type { PlanningSourceEvidenceBundle, PlanningSourceEvidenceLimits, PlanningSourceEvidenceStatus } from './source-evidence-contracts.js';
import { materializePlanningSourceEvidence } from './source-evidence-materialization.js';
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
  evidenceMaterializationStatus: Array<{ path: string; status: PlanningSourceEvidenceStatus | 'none'; reason?: string }>;
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
    const repairHints = mergeRepairHints(input.sourceLocalizationHints, hintsForGaps(gaps, affectedAtomIds, state.sourceLocalizationBundle));
    const sourceLocalizationBundle = await deriveSourceLocalization({ cwd: input.cwd, inventory: input.sourceInventory, graph: input.graph, hints: repairHints, limits: input.sourceLocalizationLimits });
    const sharedBrief = deriveSharedPlanningBrief({ graph: input.graph, sourceLocalizationBundle, limits: input.sharedBriefLimits });
    const sourceEvidenceBundle = await materializePlanningSourceEvidence({ cwd: input.cwd, graph: input.graph, sharedBrief, limits: input.sourceEvidenceLimits });
    const map = affectedAtomIds.length === 0 ? state.map : await runPlanningAtomMap({ graph: input.graph, inventory: input.sourceInventory, sharedBrief, sourceEvidenceBundle, sourceContent: input.sourceContent, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, reduceDigestPromptBudgetBytes: input.reduceDigestPromptBudgetBytes, parallelism: input.parallelism, abortSignal: input.abortSignal, onEvent: input.onEvent, affectedAtomIds, priorOutputs: state.map.outputs });
    const reduce = await runPlanningReduce({ graph: input.graph, mapResult: map, cwd: input.cwd, harness: input.harness, agentOptions: input.agentOptions, limits: input.reduceLimits, abortSignal: input.abortSignal, onEvent: input.onEvent });
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
  return outputs.flatMap((output) => (output.gaps ?? []).map((gap) => classifyPlanningReduceGap(gap, localization, evidence, graph)).filter((gap): gap is ClassifiedPlanningReduceGap => Boolean(gap?.sourceLocalizationSignal)));
}

export function classifyPlanningReduceGap(gap: PlanningReduceGap, localization?: SourceLocalizationBundle, evidence?: PlanningSourceEvidenceBundle, graph?: PlanningAtomGraph): ClassifiedPlanningReduceGap | undefined {
  const issueKind = gap.issueKind && SOURCE_GAP_KINDS.has(gap.issueKind) ? gap.issueKind : inferIssueKind(gap, localization, evidence);
  const sourceLocalizationSignal = gap.sourceLocalizationSignal === true || SOURCE_GAP_KINDS.has(issueKind);
  if (!sourceLocalizationSignal) return undefined;
  const ownerPaths = uniq([...(gap.ownerPaths ?? []), ...extractPathSignals(`${gap.title} ${gap.description}`)]);
  const sourceNeedIds = uniq([...(gap.sourceNeedIds ?? []), ...sourceNeedIdsForGap(gap, ownerPaths, localization)]);
  return {
    gap: { ...gap, issueKind, sourceLocalizationSignal: true, sourceNeedIds, ownerPaths },
    issueKind,
    sourceLocalizationSignal: true,
    sourceNeedIds,
    affectedAtomIds: uniq([...(gap.affectedAtomIds ?? []), ...atomIdsForGap(gap, sourceNeedIds, ownerPaths, localization, evidence, graph)]),
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
    evidenceMaterializationStatus: localizedOwnerPaths.map((path) => ({ path, status: evidenceByPath.get(path)?.status ?? 'none', ...(evidenceByPath.get(path)?.reason ? { reason: evidenceByPath.get(path)!.reason } : {}) })),
    coverageStatus: { criteria: coverageRecord(criterionIds, input.graph.atoms.flatMap((atom) => atom.criterionIds)), aspects: coverageRecord(aspectIds, input.sourceLocalizationBundle.records.flatMap((record) => record.linkedAspectIds)), sourceNeeds: coverageRecord(sourceNeedIds, input.sourceLocalizationBundle.records.map((record) => record.needId)) },
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
  return localization?.records.filter((record) => overlaps(record.linkedCriterionIds, gap.criterionIds) || overlaps(record.linkedAspectIds, gap.aspectIds) || ownerPaths.includes(record.query) || record.candidateFiles.some((candidate) => ownerPaths.includes(candidate.path))).map((record) => record.needId) ?? [];
}

function hintsForGaps(gaps: ClassifiedPlanningReduceGap[], atomIds: string[], localization: SourceLocalizationBundle): SourceLocalizationHint[] {
  const records = new Map(localization.records.map((record) => [record.needId, record]));
  return gaps.flatMap((gap) => [
    ...gap.sourceNeedIds.flatMap((needId) => records.get(needId) ? [{ kind: records.get(needId)!.kind, query: records.get(needId)!.query, criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, atomIds }] : []),
    ...gap.ownerPaths.map((path) => ({ kind: 'literal-path' as const, query: path, paths: [path], criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, atomIds })),
    { kind: hintKindFor(gap.issueKind), query: `${gap.gap.title} ${gap.gap.description}`.slice(0, 1_000), criterionIds: gap.criterionIds, aspectIds: gap.aspectIds, atomIds },
  ]);
}

function mergeRepairHints(existing: SourceLocalizationInputHints | undefined, projectHints: SourceLocalizationHint[]): SourceLocalizationInputHints {
  return { ignorePrefixes: existing?.ignorePrefixes, ignoreGlobs: existing?.ignoreGlobs, projectHints: [...(existing?.projectHints ?? []), ...projectHints] };
}

function hintKindFor(kind: PlanningReduceGapIssueKind): SourceLocalizationHint['kind'] {
  if (kind === 'missing-entrypoint-evidence') return 'entrypoint';
  if (kind === 'missing-config-evidence') return 'config';
  if (kind === 'missing-consumer-surface-evidence') return 'consumer-surface';
  if (kind === 'missing-contract-evidence') return 'interface';
  return 'keyword';
}

function localizedPathsFor(gaps: ClassifiedPlanningReduceGap[], localization: SourceLocalizationBundle): string[] {
  const needIds = new Set(gaps.flatMap((gap) => gap.sourceNeedIds));
  const explicit = gaps.flatMap((gap) => gap.ownerPaths);
  const localized = localization.records.filter((record) => needIds.has(record.needId) || overlaps(record.linkedCriterionIds, gaps.flatMap((gap) => gap.criterionIds)) || overlaps(record.linkedAspectIds, gaps.flatMap((gap) => gap.aspectIds))).flatMap((record) => record.candidateFiles.map((candidate) => candidate.path));
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
  const nonMaterialized = paths.filter((path) => evidence.records.find((record) => record.path === path)?.status !== 'materialized');
  return nonMaterialized.length > 0 ? `localized owner paths not materialized:${nonMaterialized.join(',')}` : `reducer still reports source/localization gaps:${gaps.map((gap) => gap.gap.gapId).join(',')}`;
}

function extractPathSignals(text: string): string[] {
  return uniq([...text.matchAll(/(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@/-]+/g)].map((match) => match[0].replace(/[),.;:]+$/, '')).filter((path) => !/^https?:\//.test(path) && !path.includes('..')));
}

function overlaps(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
function uniq(values: string[]): string[] { return [...new Set(values.filter((value) => value.trim().length > 0))].sort(); }
