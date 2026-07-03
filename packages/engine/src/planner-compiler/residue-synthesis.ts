import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAtomOutput } from './atom-planning-contracts.js';
import type { PlanningAspectCoverageRecord, PlanningAspectCoverageSummary } from './coverage-accounting.js';
import type { PlanningReduceGap, PlanningReduceOutput } from './reduce-contracts.js';
import { coverageUpdatesForResidueCandidates, DEFAULT_PLANNING_RESIDUE_LIMITS, residueCandidateId, validatePlanningResidueCandidates, type PlanningResidueCandidate, type PlanningResidueLimits, type PlanningResidueReason, type PlanningResidueSynthesis } from './residue-contracts.js';
import { classifyPlanningReduceGap } from './source-localization-repair.js';
import type { PlanningSourceEvidenceBundle, PlanningSourceEvidenceRecord } from './source-evidence-contracts.js';

export interface SynthesizePlanningResidueInput { graph: PlanningAtomGraph; coverage: PlanningAspectCoverageSummary; atomOutputs?: PlanningAtomOutput[]; sourceEvidenceBundle?: PlanningSourceEvidenceBundle; reduceOutputs?: PlanningReduceOutput[]; limits?: Partial<PlanningResidueLimits> }

export function synthesizePlanningResidue(input: SynthesizePlanningResidueInput): PlanningResidueSynthesis {
  const limits = { ...DEFAULT_PLANNING_RESIDUE_LIMITS, ...(input.limits ?? {}) };
  const candidates = dedupeCandidates([
    ...pendingAspectCandidates(input.coverage),
    ...sourceEvidenceCandidates(input.coverage, input.sourceEvidenceBundle),
    ...atomOutputCandidates(input.coverage, input.atomOutputs ?? []),
    ...reduceOutputCandidates(input.coverage, input.reduceOutputs ?? []),
  ]).slice(0, limits.maxCandidates);
  const validation = validatePlanningResidueCandidates({ graph: input.graph, coverage: input.coverage, candidates, limits });
  const validCandidates = validation.ok ? candidates : candidates.filter((candidate) => validatePlanningResidueCandidates({ graph: input.graph, coverage: input.coverage, candidates: [candidate], limits }).ok);
  return { graphId: input.graph.graphId, sourceHash: input.graph.sourceHash, candidates: validCandidates, coverageUpdates: coverageUpdatesForResidueCandidates(validCandidates), validationErrors: validation.ok ? [] : validation.errors, limits };
}

function pendingAspectCandidates(coverage: PlanningAspectCoverageSummary): PlanningResidueCandidate[] {
  return coverage.criteria.flatMap((criterion) => criterion.pendingAspectIds.map((aspectId) => {
    const aspect = requireAspect(coverage, aspectId);
    return candidate('residue', 'pending-aspect', [criterion.criterionId], [aspectId], `Represent unresolved aspect ${aspect.label}`, `Plan bounded work for unresolved aspect ${aspect.label}.`, ['A bounded module or plan fragment accounts for the unresolved aspect.'], ['The represented work has explicit validation expectations and linked criteria/aspects.'], `Aspect ${aspectId} remains pending after atom map/reduce planning.`, [aspect.source.value]);
  }));
}

function sourceEvidenceCandidates(coverage: PlanningAspectCoverageSummary, bundle: PlanningSourceEvidenceBundle | undefined): PlanningResidueCandidate[] {
  if (!bundle) return [];
  return bundle.records.filter((record) => record.status !== 'materialized' && buildableEvidenceStatus(record.status)).flatMap((record) => evidenceAspects(coverage, record).map((aspect) => {
    const reason = sourceEvidenceReason(record.status);
    return candidate('residue', reason, [aspect.criterionId], [aspect.aspectId], `Represent source evidence ${record.status}: ${record.path}`, `Create bounded product-scoped handling for localized owner path ${record.path} because source materialization returned ${record.status}.`, [`Product-scoped output accounts for ${record.path} without requiring unbounded mapper exploration.`], [aspect.criterionId], sourceEvidenceRationale(record), [record.path, record.reason].filter((value): value is string => Boolean(value)), { buildability: 'buildable', sourceLocalizationDerived: true, localizedOwnerPaths: [record.path], productScopedOutputRefs: [`localized-owner:${record.path}`], productScopedValidationRefs: [aspect.criterionId] });
  }));
}

function atomOutputCandidates(coverage: PlanningAspectCoverageSummary, outputs: PlanningAtomOutput[]): PlanningResidueCandidate[] {
  return outputs.filter((output) => output.status === 'failed' || output.status === 'skipped').flatMap((output) => aspectsForAtom(coverage, output.atomId).filter((aspect) => !aspect.satisfied).map((aspect) => candidate(output.status === 'failed' ? 'residue' : 'follow-up', output.status === 'failed' ? 'atom-failed' : 'atom-skipped', [aspect.criterionId], [aspect.aspectId], `${output.status} atom follow-up for ${aspect.label}`, `Create bounded ${output.status === 'failed' ? 'residue' : 'follow-up'} work for atom ${output.atomId} and aspect ${aspect.aspectId}.`, [`A replacement planning module accounts for atom ${output.atomId}'s uncompleted aspect.`], ['Validation reruns the relevant planner/compiler checks for the represented aspect.'], `Atom ${output.atomId} ended with status ${output.status}${output.error ? `: ${output.error}` : ''}.`, [output.atomId])));
}

function reduceOutputCandidates(coverage: PlanningAspectCoverageSummary, outputs: PlanningReduceOutput[]): PlanningResidueCandidate[] {
  return outputs.flatMap((output) => [
    ...((output.gaps ?? []).flatMap((gap) => reduceGapCandidate(output, gap))),
    ...((output.conflicts ?? []).map((conflict) => candidate('follow-up', 'reduce-conflict', conflict.criterionIds, conflict.aspectIds, conflict.title, `Create bounded verification work for reduce conflict ${conflict.conflictId}: ${conflict.description}`, ['A verification or reconciliation module resolves the conflicting planning outputs.'], ['Validation confirms one coherent approach remains after reconciliation.'], `Reduce node ${output.nodeId} reported conflict ${conflict.conflictId}.`, [output.nodeId, conflict.conflictId, ...(conflict.sourceIds ?? [])]))),
    ...(output.status === 'failed' || output.status === 'incomplete' ? incompleteReduceCandidates(coverage, output) : []),
  ]);
}

function reduceGapCandidate(output: PlanningReduceOutput, gap: PlanningReduceGap): PlanningResidueCandidate[] {
  const classified = classifyPlanningReduceGap(gap);
  if (classified && !buildableSourceLocalizationGap(gap)) return [];
  // Informational advice stays a compiler diagnostic; only representation-required
  // gaps (or buildable source/localization gaps) may become plans.
  if (!classified && !gap.representationRequired) return [];
  const extra = classified ? { buildability: 'buildable' as const, sourceLocalizationDerived: true, localizedOwnerPaths: gap.ownerPaths, productScopedOutputRefs: gap.productScopedOutputRefs, productScopedValidationRefs: gap.productScopedValidationRefs } : undefined;
  const validationExpectations = classified ? gap.productScopedValidationRefs! : ['Validation confirms the gap is addressed in the final plan set or represented follow-up work.'];
  const expectedOutputs = classified ? gap.productScopedOutputRefs! : ['A bounded module resolves or explicitly represents the reduce gap.'];
  return [candidate(gap.representationRequired ? 'residue' : 'follow-up', 'reduce-gap', gap.criterionIds, gap.aspectIds, gap.title, `Represent reduce gap ${gap.gapId}: ${gap.description}`, expectedOutputs, validationExpectations, `Reduce node ${output.nodeId} reported gap ${gap.gapId}.`, [output.nodeId, gap.gapId, ...(gap.sourceIds ?? []), ...(gap.ownerPaths ?? [])], extra)];
}

function buildableSourceLocalizationGap(gap: PlanningReduceGap): boolean {
  const ownerPaths = gap.ownerPaths ?? [];
  const outputRefs = gap.productScopedOutputRefs ?? [];
  return ownerPaths.length > 0 && outputRefs.length > 0 && outputRefs.every((ref) => {
    const path = ref.startsWith('localized-owner:') ? ref.slice('localized-owner:'.length) : '';
    return path.length > 0 && ownerPaths.includes(path);
  }) && (gap.productScopedValidationRefs?.length ?? 0) > 0 && gap.productScopedValidationRefs!.every((ref) => gap.criterionIds.includes(ref));
}

function incompleteReduceCandidates(coverage: PlanningAspectCoverageSummary, output: PlanningReduceOutput): PlanningResidueCandidate[] {
  const aspects = coverage.aspects.filter((aspect) => output.compactSummary.includes(aspect.aspectId) || !aspect.satisfied).slice(0, 8);
  return aspects.map((aspect) => candidate('residue', 'reduce-incomplete', [aspect.criterionId], [aspect.aspectId], `Incomplete reduce follow-up for ${aspect.label}`, `Represent incomplete reduce synthesis from node ${output.nodeId} for aspect ${aspect.aspectId}.`, ['A bounded synthesis module captures the missing reduce decision.'], ['Validation confirms final synthesis includes this aspect or an explicit representation.'], `Reduce node ${output.nodeId} ended with status ${output.status}${output.error ? `: ${output.error}` : ''}.`, [output.nodeId]));
}

function evidenceAspects(coverage: PlanningAspectCoverageSummary, record: PlanningSourceEvidenceRecord): PlanningAspectCoverageRecord[] {
  return coverage.aspects.filter((aspect) => aspect.source.kind === 'evidence' && aspect.source.value === record.path && !aspect.satisfied);
}

function aspectsForAtom(coverage: PlanningAspectCoverageSummary, atomId: string): PlanningAspectCoverageRecord[] {
  return coverage.aspects.filter((aspect) => aspect.atomIds.includes(atomId));
}

function buildableEvidenceStatus(status: PlanningSourceEvidenceRecord['status']): boolean {
  return status === 'too-large' || status === 'budget-exceeded';
}

function sourceEvidenceReason(status: PlanningSourceEvidenceRecord['status']): PlanningResidueReason {
  return status === 'missing' ? 'source-evidence-missing' : status === 'non-actionable' ? 'source-evidence-non-actionable' : status === 'directory' ? 'source-evidence-directory' : status === 'too-large' ? 'source-evidence-too-large' : status === 'read-error' ? 'source-evidence-read-error' : 'source-evidence-budget-exceeded';
}

function sourceEvidenceRationale(record: PlanningSourceEvidenceRecord): string {
  return `Source evidence ${record.path} could not be materialized with status ${record.status}${record.reason ? ` (${record.reason})` : ''}.`;
}

function requireAspect(coverage: PlanningAspectCoverageSummary, aspectId: string): PlanningAspectCoverageRecord {
  const aspect = coverage.aspects.find((candidate) => candidate.aspectId === aspectId);
  if (!aspect) throw new Error(`unknown aspect:${aspectId}`);
  return aspect;
}

function candidate(kind: PlanningResidueCandidate['kind'], reason: PlanningResidueReason, criterionIds: string[], aspectIds: string[], title: string, scope: string, expectedOutputs: string[], validationExpectations: string[], rationale: string, sourceRefs: string[] = [], extra: Partial<PlanningResidueCandidate> = {}): PlanningResidueCandidate {
  const cleanAspects = uniq(aspectIds);
  return { candidateId: residueCandidateId(reason, cleanAspects, sourceRefs[0]), kind, reason, title, criterionIds: uniq(criterionIds), aspectIds: cleanAspects, scope, expectedOutputs, validationExpectations, rationale, ...(sourceRefs.length > 0 ? { sourceRefs: uniq(sourceRefs) } : {}), ...extra };
}

function dedupeCandidates(candidates: PlanningResidueCandidate[]): PlanningResidueCandidate[] {
  const byId = new Map<string, PlanningResidueCandidate>();
  for (const candidate of candidates) if (!byId.has(candidate.candidateId)) byId.set(candidate.candidateId, candidate);
  return [...byId.values()].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

function uniq(values: string[]): string[] { return [...new Set(values.filter(Boolean))].sort(); }
