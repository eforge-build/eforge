import type { BuildStageSpec, ReviewProfileConfig } from '@eforge-build/client';
import type { PlanningAtom } from './atom-graph.js';
import type { PlanningModuleDocsWork, PlanningModuleTestWork } from './reduce-digest-contracts.js';
import type { PlanningResidueCandidate } from './residue-contracts.js';
import type { SourceLocalizationRecord } from './source-localization-contracts.js';

export interface PlanPipelineModuleSignals { moduleId: string; criterionIds: string[]; aspectIds: string[]; dependsOnModuleIds: string[]; residue: boolean; docsWork?: PlanningModuleDocsWork; testWork?: PlanningModuleTestWork }
export interface PlanPipelineRiskInputs {
  modules: PlanPipelineModuleSignals[];
  atoms: Array<Pick<PlanningAtom, 'atomId' | 'criterionIds' | 'subsystemHints' | 'estimate'>>;
  localizationRecords: Array<Pick<SourceLocalizationRecord, 'confidence' | 'status' | 'linkedCriterionIds' | 'linkedAspectIds'>>;
  residueCandidates: Array<Pick<PlanningResidueCandidate, 'candidateId' | 'buildability' | 'criterionIds'>>;
}
export type PlanPipelineRiskFactor = 'large-plan' | 'residue-derived' | 'repair-only-residue' | 'low-confidence-localization' | 'multi-subsystem' | 'dependency-root';
export interface PlanRiskAssessment { moduleId: string; score: number; factors: PlanPipelineRiskFactor[] }
export interface DerivedPlanPipelineSettings { moduleId: string; build: BuildStageSpec[]; review: ReviewProfileConfig; risk: PlanRiskAssessment; rationale: string }
export interface PlanPipelineDerivation { plans: DerivedPlanPipelineSettings[]; defaultBuild: BuildStageSpec[]; defaultReview: ReviewProfileConfig; rationale: string }

export const LARGE_PLAN_CRITERION_COUNT = 3;
export const LARGE_PLAN_SOURCE_BYTES = 16_000;
export const LARGE_PLAN_ASPECT_COUNT = 8;
export const MULTI_SUBSYSTEM_COUNT = 3;
export const MODERATE_REVIEW_MIN_SCORE = 1;
export const HEAVY_REVIEW_MIN_SCORE = 3;

const LIGHT_REVIEW: ReviewProfileConfig = Object.freeze({ strategy: 'single' as const, perspectives: Object.freeze(['code']) as unknown as ReviewProfileConfig['perspectives'], maxRounds: 1, evaluatorStrictness: 'standard' as const });
const MODERATE_REVIEW: ReviewProfileConfig = Object.freeze({ strategy: 'auto' as const, perspectives: Object.freeze(['code', 'test']) as unknown as ReviewProfileConfig['perspectives'], maxRounds: 1, evaluatorStrictness: 'standard' as const });
const HEAVY_REVIEW: ReviewProfileConfig = Object.freeze({ strategy: 'parallel' as const, perspectives: Object.freeze(['code', 'security', 'test', 'verify']) as unknown as ReviewProfileConfig['perspectives'], maxRounds: 2, evaluatorStrictness: 'strict' as const });

/**
 * Derive per-plan build/review pipeline settings from deterministic compiler
 * risk signals. Pure function: no I/O, no LLM, no timestamps. This is the
 * designated sole source of pipeline defaults for the compiler path; the
 * planning quality review gate audits its output.
 */
export function derivePlanPipelineSettings(input: PlanPipelineRiskInputs): PlanPipelineDerivation {
  const dependedOn = dependedOnModuleIds(input.modules);
  const plans = [...input.modules]
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
    .map((module) => settingsForModule(module, input, dependedOn));
  const highestScore = plans.reduce((max, plan) => Math.max(max, plan.risk.score), 0);
  return {
    plans,
    defaultBuild: [...buildForScore(highestScore)],
    defaultReview: cloneReview(reviewForScore(highestScore)),
    rationale: derivationRationale(plans, highestScore),
  };
}

function settingsForModule(module: PlanPipelineModuleSignals, input: PlanPipelineRiskInputs, dependedOn: Set<string>): DerivedPlanPipelineSettings {
  const factors = riskFactorsForModule(module, input, dependedOn);
  const score = factors.reduce((total, factor) => total + FACTOR_WEIGHTS[factor], 0);
  const review = reviewForScore(score);
  const docsWork = module.docsWork ?? 'none';
  const testWork = module.testWork ?? 'none';
  const build = buildForModule(score, docsWork, testWork);
  return {
    moduleId: module.moduleId,
    build,
    review: cloneReview(review),
    risk: { moduleId: module.moduleId, score, factors },
    rationale: moduleRationale(score, factors, docsWork, testWork, build, review),
  };
}

const FACTOR_WEIGHTS: Record<PlanPipelineRiskFactor, number> = {
  'large-plan': 1,
  'residue-derived': 2,
  'repair-only-residue': 1,
  'low-confidence-localization': 1,
  'multi-subsystem': 1,
  'dependency-root': 1,
};

function riskFactorsForModule(module: PlanPipelineModuleSignals, input: PlanPipelineRiskInputs, dependedOn: Set<string>): PlanPipelineRiskFactor[] {
  const factors: PlanPipelineRiskFactor[] = [];
  const joinedAtoms = input.atoms.filter((atom) => intersects(atom.criterionIds, module.criterionIds));
  if (isLargePlan(module, joinedAtoms)) factors.push('large-plan');
  if (module.residue) {
    factors.push('residue-derived');
    const candidate = input.residueCandidates.find((entry) => entry.candidateId === module.moduleId);
    if (candidate?.buildability === 'repair-only') factors.push('repair-only-residue');
  }
  if (hasLowConfidenceLocalization(module, input.localizationRecords)) factors.push('low-confidence-localization');
  if (touchedSubsystemCount(joinedAtoms) >= MULTI_SUBSYSTEM_COUNT) factors.push('multi-subsystem');
  if (dependedOn.has(module.moduleId)) factors.push('dependency-root');
  return factors;
}

function isLargePlan(module: PlanPipelineModuleSignals, joinedAtoms: PlanPipelineRiskInputs['atoms']): boolean {
  if (module.criterionIds.length >= LARGE_PLAN_CRITERION_COUNT) return true;
  if (module.aspectIds.length >= LARGE_PLAN_ASPECT_COUNT) return true;
  const sourceBytes = joinedAtoms.reduce((total, atom) => total + atom.estimate.sourceBytes, 0);
  return sourceBytes >= LARGE_PLAN_SOURCE_BYTES;
}

function hasLowConfidenceLocalization(module: PlanPipelineModuleSignals, records: PlanPipelineRiskInputs['localizationRecords']): boolean {
  return records.some((record) =>
    (record.confidence === 'low' || record.status === 'unresolved')
    && (intersects(record.linkedCriterionIds, module.criterionIds) || intersects(record.linkedAspectIds, module.aspectIds)));
}

function touchedSubsystemCount(joinedAtoms: PlanPipelineRiskInputs['atoms']): number {
  return new Set(joinedAtoms.flatMap((atom) => atom.subsystemHints)).size;
}

function dependedOnModuleIds(modules: PlanPipelineModuleSignals[]): Set<string> {
  const dependedOn = new Set<string>();
  for (const module of modules) for (const dependencyId of module.dependsOnModuleIds) if (dependencyId !== module.moduleId) dependedOn.add(dependencyId);
  return dependedOn;
}

function reviewForScore(score: number): ReviewProfileConfig {
  if (score >= HEAVY_REVIEW_MIN_SCORE) return HEAVY_REVIEW;
  if (score >= MODERATE_REVIEW_MIN_SCORE) return MODERATE_REVIEW;
  return LIGHT_REVIEW;
}

function buildForScore(score: number): BuildStageSpec[] {
  return buildForModule(score, 'none', 'none');
}

function buildForModule(score: number, docsWork: PlanningModuleDocsWork, testWork: PlanningModuleTestWork): BuildStageSpec[] {
  const build: BuildStageSpec[] = [docsWork === 'author-new' ? ['implement', 'doc-author'] : 'implement'];
  if (docsWork !== 'none') build.push('doc-sync');
  if (testWork === 'author-new') build.push('test-write');
  if (testWork !== 'none' || score >= HEAVY_REVIEW_MIN_SCORE) build.push('test-cycle');
  build.push('review-cycle');
  return build;
}

function formatBuild(build: readonly BuildStageSpec[]): string {
  return build.map((spec) => (Array.isArray(spec) ? `[${spec.join(', ')}]` : spec)).join(' -> ');
}

function cloneReview(review: ReviewProfileConfig): ReviewProfileConfig {
  return { strategy: review.strategy, perspectives: [...review.perspectives], maxRounds: review.maxRounds, evaluatorStrictness: review.evaluatorStrictness };
}

function moduleRationale(score: number, factors: PlanPipelineRiskFactor[], docsWork: PlanningModuleDocsWork, testWork: PlanningModuleTestWork, build: readonly BuildStageSpec[], review: ReviewProfileConfig): string {
  const basis = factors.length > 0 ? `risk score ${score} (${factors.join(', ')})` : 'no risk factors';
  return `${basis}; declared docs work ${docsWork}, test work ${testWork}; derived build ${formatBuild(build)} and ${review.strategy} review with perspectives ${review.perspectives.join(', ')}, ${review.maxRounds} round(s), ${review.evaluatorStrictness} evaluation`;
}

function derivationRationale(plans: DerivedPlanPipelineSettings[], highestScore: number): string {
  const perPlan = plans.map((plan) => `- ${plan.moduleId}: ${plan.rationale}`);
  return ['Per-plan pipeline settings derived deterministically from compiler risk signals.', `Set-level defaults follow the highest plan risk score (${highestScore}).`, ...perPlan].join('\n');
}

function intersects(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
