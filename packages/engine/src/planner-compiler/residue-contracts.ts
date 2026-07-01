import type { PlanningAtomGraph } from './atom-graph.js';
import type { PlanningAspectCoverageSummary, PlanningAspectCoverageUpdate } from './coverage-accounting.js';
import { stableSlug, utf8ByteLength } from './source-analysis.js';

export type PlanningResidueKind = 'residue' | 'follow-up';
export type PlanningResidueBuildability = 'buildable' | 'repair-only';
export type PlanningResidueReason = 'pending-aspect' | 'source-evidence-missing' | 'source-evidence-non-actionable' | 'source-evidence-directory' | 'source-evidence-too-large' | 'source-evidence-read-error' | 'source-evidence-budget-exceeded' | 'atom-failed' | 'atom-skipped' | 'reduce-gap' | 'reduce-conflict' | 'reduce-incomplete';

export interface PlanningResidueLimits { maxCandidates: number; maxScopeBytes: number; maxRationaleBytes: number; maxExpectedOutputBytes: number; maxValidationExpectationBytes: number }
export interface PlanningResidueCandidate { candidateId: string; kind: PlanningResidueKind; reason: PlanningResidueReason; title: string; criterionIds: string[]; aspectIds: string[]; scope: string; expectedOutputs: string[]; validationExpectations: string[]; rationale: string; sourceRefs?: string[]; dependsOnCandidateIds?: string[]; buildability?: PlanningResidueBuildability; sourceLocalizationDerived?: boolean; localizedOwnerPaths?: string[]; productScopedOutputRefs?: string[]; productScopedValidationRefs?: string[] }
export interface PlanningResidueSynthesis { graphId: string; sourceHash: string; candidates: PlanningResidueCandidate[]; coverageUpdates: PlanningAspectCoverageUpdate[]; validationErrors: string[]; limits: PlanningResidueLimits }
export interface ValidatePlanningResidueCandidatesInput { graph: PlanningAtomGraph; coverage: PlanningAspectCoverageSummary; candidates: PlanningResidueCandidate[]; limits?: PlanningResidueLimits }
export type PlanningResidueValidation = { ok: true; errors: [] } | { ok: false; errors: string[] };

export const DEFAULT_PLANNING_RESIDUE_LIMITS: PlanningResidueLimits = { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 };

export function validatePlanningResidueCandidates(input: ValidatePlanningResidueCandidatesInput): PlanningResidueValidation {
  const limits = input.limits ?? DEFAULT_PLANNING_RESIDUE_LIMITS;
  const errors: string[] = [];
  const criteria = new Set(input.coverage.criteria.map((criterion) => criterion.criterionId));
  const aspects = new Set(input.coverage.aspects.map((aspect) => aspect.aspectId));
  if (input.candidates.length > limits.maxCandidates) errors.push(`residue candidate count exceeded:${input.candidates.length}`);
  validateUnique('residue candidate', input.candidates.map((candidate) => candidate.candidateId), errors);
  for (const candidate of input.candidates) validateCandidate(candidate, criteria, aspects, input.candidates, limits, errors);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors: [...new Set(errors)].sort() };
}

export function coverageUpdatesForResidueCandidates(candidates: PlanningResidueCandidate[]): PlanningAspectCoverageUpdate[] {
  const updates = new Map<string, PlanningAspectCoverageUpdate>();
  for (const candidate of [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) {
    for (const aspectId of candidate.aspectIds) {
      if (updates.has(aspectId)) continue;
      updates.set(aspectId, {
        aspectId,
        status: 'represented',
        representation: { kind: candidate.kind, moduleId: candidate.candidateId, reason: candidate.rationale, validationExpectation: candidate.validationExpectations.join(' ') },
      });
    }
  }
  return [...updates.values()].sort((a, b) => a.aspectId.localeCompare(b.aspectId));
}

export function residueCandidateId(reason: PlanningResidueReason, aspectIds: string[], sourceId?: string): string {
  return `candidate-${stableSlug(reason)}-${stableSlug([...aspectIds, sourceId ?? ''].filter(Boolean).join('-')).slice(0, 64)}`;
}

function validateCandidate(candidate: PlanningResidueCandidate, criteria: Set<string>, aspects: Set<string>, siblings: PlanningResidueCandidate[], limits: PlanningResidueLimits, errors: string[]): void {
  if (!nonEmpty(candidate.candidateId)) errors.push('residue candidate requires id');
  if (!nonEmpty(candidate.title)) errors.push(`residue candidate requires title:${candidate.candidateId}`);
  if (!nonEmpty(candidate.scope)) errors.push(`residue candidate requires scope:${candidate.candidateId}`);
  if (!nonEmpty(candidate.rationale)) errors.push(`residue candidate requires rationale:${candidate.candidateId}`);
  if (candidate.criterionIds.length === 0 || candidate.aspectIds.length === 0) errors.push(`residue candidate must link criteria and aspects:${candidate.candidateId}`);
  if (candidate.expectedOutputs.length === 0) errors.push(`residue candidate requires expected outputs:${candidate.candidateId}`);
  if (candidate.validationExpectations.length === 0) errors.push(`residue candidate requires validation expectations:${candidate.candidateId}`);
  if (vague(candidate.scope) || vague(candidate.rationale) || candidate.expectedOutputs.some(vague)) errors.push(`residue candidate is vague:${candidate.candidateId}`);
  if (candidate.sourceLocalizationDerived) validateSourceLocalizationResidue(candidate, errors);
  validateBudget(candidate, limits, errors);
  for (const criterionId of candidate.criterionIds) if (!criteria.has(criterionId)) errors.push(`unknown residue criterion:${candidate.candidateId}:${criterionId}`);
  for (const aspectId of candidate.aspectIds) if (!aspects.has(aspectId)) errors.push(`unknown residue aspect:${candidate.candidateId}:${aspectId}`);
  validateDependencyIds(candidate, siblings, errors);
}

function validateSourceLocalizationResidue(candidate: PlanningResidueCandidate, errors: string[]): void {
  if (candidate.buildability !== 'buildable') errors.push(`source/localization residue must be buildable to synthesize:${candidate.candidateId}`);
  const ownerPaths = candidate.localizedOwnerPaths ?? [];
  const outputRefs = candidate.productScopedOutputRefs ?? [];
  if (ownerPaths.length === 0) errors.push(`source/localization residue requires localized owner paths:${candidate.candidateId}`);
  if (outputRefs.length === 0 || !outputRefs.every((ref) => productScopedOutputRef(ref, ownerPaths))) errors.push(`source/localization residue requires product-scoped outputs:${candidate.candidateId}`);
  if ((candidate.productScopedValidationRefs ?? []).length === 0) errors.push(`source/localization residue requires PRD validation refs:${candidate.candidateId}`);
  if ((candidate.productScopedValidationRefs ?? []).some((ref) => !candidate.criterionIds.includes(ref))) errors.push(`source/localization residue validation must reference original criteria:${candidate.candidateId}`);
}

function productScopedOutputRef(ref: string, ownerPaths: string[]): boolean {
  const path = ref.startsWith('localized-owner:') ? ref.slice('localized-owner:'.length) : '';
  return nonEmpty(path) && ownerPaths.includes(path);
}

function validateBudget(candidate: PlanningResidueCandidate, limits: PlanningResidueLimits, errors: string[]): void {
  if (utf8ByteLength(candidate.scope) > limits.maxScopeBytes) errors.push(`residue scope budget exceeded:${candidate.candidateId}`);
  if (utf8ByteLength(candidate.rationale) > limits.maxRationaleBytes) errors.push(`residue rationale budget exceeded:${candidate.candidateId}`);
  for (const value of candidate.expectedOutputs) if (utf8ByteLength(value) > limits.maxExpectedOutputBytes) errors.push(`residue expected output budget exceeded:${candidate.candidateId}`);
  for (const value of candidate.validationExpectations) if (utf8ByteLength(value) > limits.maxValidationExpectationBytes) errors.push(`residue validation expectation budget exceeded:${candidate.candidateId}`);
}

function validateDependencyIds(candidate: PlanningResidueCandidate, siblings: PlanningResidueCandidate[], errors: string[]): void {
  const ids = new Set(siblings.map((sibling) => sibling.candidateId).filter(nonEmpty));
  for (const dependencyId of candidate.dependsOnCandidateIds ?? []) {
    if (!nonEmpty(dependencyId)) errors.push(`residue dependency requires id:${candidate.candidateId}`);
    else if (dependencyId === candidate.candidateId) errors.push(`residue dependency self-reference:${candidate.candidateId}`);
    else if (!ids.has(dependencyId)) errors.push(`residue dependency missing:${candidate.candidateId}:${dependencyId}`);
  }
}

function validateUnique(kind: string, ids: string[], errors: string[]): void {
  const seen = new Set<string>();
  for (const id of ids.filter(nonEmpty)) {
    if (seen.has(id)) errors.push(`${kind} id duplicated:${id}`);
    seen.add(id);
  }
}

function vague(value: string): boolean {
  return /\b(?:investigate later|tbd|todo|figure out|look into|unknown)\b/i.test(value);
}

function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
