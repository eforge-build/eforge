import type { BuildStageSpec, ReviewProfileConfig } from '@eforge-build/client';
import type { PlanningArchitectureManifest } from './architecture-manifest-contracts.js';
import { synthesizeArchitecture } from './architecture-synthesis.js';
import type { BoundedPlannerCompilerResult } from './compiler-runner.js';
import { derivePlanningAspectCoverage, type PlanningAspectCoverageSummary } from './coverage-accounting.js';
import type { PlanningAtomModuleCandidate, PlanningAtomPlanFragment } from './atom-planning-contracts.js';
import { cloneBuildStages } from './pipeline-derivation.js';
import { normalizePlanningProposal, type PlanningProposalNormalizationResult } from './proposal-normalization.js';
import type { PlanningModuleDocsWork, PlanningModuleReviewDepth, PlanningModuleTestOwnership, PlanningModuleTestWork } from './reduce-digest-contracts.js';
import type { PlanningResidueCandidate } from './residue-contracts.js';

export interface SynthesizePlanningArtifactsInput { compilerResult: BoundedPlannerCompilerResult }
export interface PlanningSynthesizedModulePlan { moduleId: string; title: string; criterionIds: string[]; aspectIds: string[]; markdown: string; dependsOnModuleIds: string[]; validationExpectation: string; residue: boolean; docsWork: PlanningModuleDocsWork; testWork: PlanningModuleTestWork; testOwnership: PlanningModuleTestOwnership; reviewDepth: PlanningModuleReviewDepth; reviewRationale?: string; build: BuildStageSpec[]; review: ReviewProfileConfig; pipelineRationale: string }
export interface PlanningArtifactOrchestration { modules: Array<{ id: string; dependsOn: string[]; build: BuildStageSpec[]; review: ReviewProfileConfig }> }
export interface PlanningArtifactPipelineDefaults { defaultBuild: BuildStageSpec[]; defaultReview: ReviewProfileConfig; rationale: string }
export interface PlanningArtifactSynthesisResult { architectureMarkdown: string; architectureManifest: PlanningArchitectureManifest; planMarkdown: string; modulePlans: PlanningSynthesizedModulePlan[]; orchestration: PlanningArtifactOrchestration; pipelineDefaults: PlanningArtifactPipelineDefaults; normalization: PlanningProposalNormalizationResult; acceptanceCoverageMarkdown: string; validationErrors: string[] }

type PlanningSynthesizedModulePlanBase = Omit<PlanningSynthesizedModulePlan, 'build' | 'review' | 'docsWork' | 'testWork' | 'reviewDepth' | 'testOwnership' | 'pipelineRationale'> & { docsWork?: PlanningModuleDocsWork; testWork?: PlanningModuleTestWork; testOwnership?: PlanningModuleTestOwnership; reviewDepth?: PlanningModuleReviewDepth };

export function synthesizePlanningArtifacts(input: SynthesizePlanningArtifactsInput): PlanningArtifactSynthesisResult {
  const result = input.compilerResult;
  const fragments = selectPlanFragments(result);
  const baseModules = [...candidateModules(result, fragments), ...residueModules(result.residue.candidates)];
  const normalization = normalizePlanningProposal({ compilerResult: result, modules: baseModules });
  const modules = normalization.modules.map(stampNormalizedModule);
  const validationErrors = validateSynthesizedArtifacts(result, normalization.validationErrors);
  const architecture = synthesizeArchitecture({ compilerResult: result, modulePlans: modules, fileOwnership: normalization.fileOwnership });
  const acceptanceCoverageMarkdown = coverageMarkdownFor(result);
  const planMarkdown = planMarkdownFor(result, modules, fragments);
  if (!nonEmpty(architecture.markdown)) validationErrors.push('architecture markdown is empty');
  if (!nonEmpty(planMarkdown)) validationErrors.push('plan markdown is empty');
  return {
    architectureMarkdown: architecture.markdown,
    architectureManifest: architecture.manifest,
    planMarkdown,
    modulePlans: modules,
    orchestration: { modules: modules.map((module) => ({ id: module.moduleId, dependsOn: [...module.dependsOnModuleIds], build: cloneBuildStages(module.build), review: { ...module.review, perspectives: [...module.review.perspectives] } })) },
    pipelineDefaults: { defaultBuild: normalization.defaultBuild, defaultReview: normalization.defaultReview, rationale: normalization.rationale },
    normalization,
    acceptanceCoverageMarkdown,
    validationErrors: [...new Set(validationErrors)].sort(),
  };
}

function stampNormalizedModule(module: PlanningProposalNormalizationResult['modules'][number]): PlanningSynthesizedModulePlan {
  const { proposedIntent: _proposedIntent, normalizationChanges: _normalizationChanges, ownedPaths: _ownedPaths, ...normalized } = module;
  return { ...normalized, markdown: appendNormalizedExecutionIntent(module.markdown, module), build: cloneBuildStages(module.build), review: { ...module.review, perspectives: [...module.review.perspectives] } };
}

/**
 * Render the Execution Intent section purely from normalized pipeline settings
 * and append it as the final section of every plan (candidate and residue).
 * The block is never regex-patched into agent-authored markdown: agent text
 * cannot absorb, shadow, or spoof the stamp, replacement-pattern characters
 * (`$&` etc.) are inert, and the rationale is collapsed to a single line so a
 * model-authored review rationale cannot inject extra declaration lines.
 */
function appendNormalizedExecutionIntent(markdown: string, settings: Pick<PlanningSynthesizedModulePlan, 'testOwnership' | 'reviewDepth' | 'pipelineRationale'>): string {
  return [markdown, '', '## Execution Intent', '', `Test ownership: ${settings.testOwnership}`, `Review depth: ${settings.reviewDepth}`, `Review rationale: ${singleLine(settings.pipelineRationale)}`].join('\n');
}

function singleLine(value: string): string { return value.replace(/\s+/g, ' ').trim(); }

function selectPlanFragments(result: BoundedPlannerCompilerResult): PlanningAtomPlanFragment[] {
  const reduceFragments = artifactReduceOutputs(result).flatMap((output) => output.planFragments ?? []);
  const atomFragments = result.map.outputs.flatMap((output) => output.planFragments ?? []);
  return cloneFragments(reduceFragments.length > 0 ? reduceFragments : atomFragments);
}

function candidateModules(result: BoundedPlannerCompilerResult, fragments: PlanningAtomPlanFragment[]): PlanningSynthesizedModulePlanBase[] {
  const reduceModules = artifactReduceOutputs(result).flatMap((output) => output.moduleCandidates ?? []);
  const atomModules = result.map.outputs.flatMap((output) => output.moduleCandidates ?? []);
  return cloneModules(reduceModules.length > 0 ? reduceModules : atomModules).map((module) => modulePlanFromCandidate(module, fragments));
}

function artifactReduceOutputs(result: BoundedPlannerCompilerResult) {
  return result.reduce.finalOutput ? [result.reduce.finalOutput] : result.reduce.outputs;
}

function modulePlanFromCandidate(module: PlanningAtomModuleCandidate, fragments: PlanningAtomPlanFragment[]): PlanningSynthesizedModulePlanBase {
  const relatedFragments = fragments.filter((fragment) => intersects(fragment.aspectIds, module.aspectIds) || intersects(fragment.criterionIds, module.criterionIds));
  return {
    moduleId: module.moduleId,
    title: module.title || module.moduleId,
    criterionIds: uniq(module.criterionIds),
    aspectIds: uniq(module.aspectIds),
    markdown: moduleMarkdown(module, relatedFragments),
    dependsOnModuleIds: uniq(module.dependsOnModuleIds ?? []),
    validationExpectation: module.validationExpectation,
    residue: false,
    ...(module.docsWork ? { docsWork: module.docsWork } : {}),
    ...(module.testWork ? { testWork: module.testWork } : {}),
    ...(module.testOwnership ? { testOwnership: module.testOwnership } : {}),
    ...(module.reviewDepth ? { reviewDepth: module.reviewDepth } : {}),
    ...(module.reviewRationale ? { reviewRationale: module.reviewRationale } : {}),
  };
}

function residueModules(candidates: PlanningResidueCandidate[]): PlanningSynthesizedModulePlanBase[] {
  return candidates.map((candidate) => ({
    moduleId: candidate.candidateId,
    title: candidate.title,
    criterionIds: [...candidate.criterionIds],
    aspectIds: [...candidate.aspectIds],
    markdown: residueMarkdown(candidate),
    dependsOnModuleIds: [...(candidate.dependsOnCandidateIds ?? [])],
    validationExpectation: candidate.validationExpectations.join('\n'),
    residue: true,
    // Residue candidates intentionally carry no docsWork/testWork declarations: they have
    // no structured doc/test intent fields, so extra build stages for residue modules come
    // solely from score-derived risk factors in derivePlanPipelineSettings (residue-derived,
    // repair-only-residue). Do not infer declarations from residue text.
    docsWork: 'none' as const,
    testWork: 'none' as const,
  }));
}

function validateSynthesizedArtifacts(result: BoundedPlannerCompilerResult, normalizationErrors: string[]): string[] {
  // Compiler-level validation errors still block artifact synthesis; they are
  // merged here (not inside normalization) so the normalization verdict stays
  // scoped to the model's proposal.
  const errors = [...normalizationErrors, ...result.validationErrors];
  const coverage = coverageFor(result);
  validateCoverage(coverage, errors);
  if (result.reduce.finalOutput?.status === 'failed' && result.residue.candidates.length === 0) errors.push('failed reduce output requires residue coverage');
  return [...new Set(errors)].sort();
}

function validateCoverage(coverage: PlanningAspectCoverageSummary, errors: string[]): void {
  errors.push(...coverage.validationErrors);
  for (const criterion of coverage.criteria.filter((item) => !item.complete)) errors.push(`unresolved criterion after artifact synthesis:${criterion.criterionId}:${criterion.pendingAspectIds.join(',')}`);
}

function planMarkdownFor(result: BoundedPlannerCompilerResult, modules: PlanningSynthesizedModulePlan[], fragments: PlanningAtomPlanFragment[]): string {
  return ['# Planner Compiler Plan', '', '## Modules', ...modules.map((module) => `- ${module.moduleId}: ${module.title}${module.residue ? ' (residue/follow-up)' : ''}`), '', '## Plan fragments', ...(fragments.length > 0 ? fragments.map((fragment) => `### ${fragment.title || fragment.fragmentId}\n\n${fragment.markdown}`) : ['No standalone plan fragments were produced.']), '', coverageMarkdownFor(result)].join('\n');
}

function coverageFor(result: BoundedPlannerCompilerResult): PlanningAspectCoverageSummary {
  return derivePlanningAspectCoverage({
    graph: result.atomGraph,
    inventory: result.sourceInventory,
    updates: [...result.map.outputs.flatMap((output) => output.aspectUpdates), ...result.residue.coverageUpdates],
  });
}

function coverageMarkdownFor(result: BoundedPlannerCompilerResult): string {
  const coverage = coverageFor(result);
  return ['## Acceptance Coverage', '', `Complete criteria: ${coverage.completeCriteria.join(', ') || '(none)'}`, `Incomplete criteria: ${coverage.incompleteCriteria.join(', ') || '(none)'}`, '', '### Represented residue/follow-up aspects', ...(result.residue.candidates.length > 0 ? result.residue.candidates.map((candidate) => `- ${candidate.candidateId}: ${candidate.aspectIds.join(', ')} (${candidate.reason})`) : ['- (none)'])].join('\n');
}

function moduleMarkdown(module: PlanningAtomModuleCandidate, fragments: PlanningAtomPlanFragment[]): string {
  // The Execution Intent section is intentionally absent here: it is rendered
  // from normalized pipeline settings in appendNormalizedExecutionIntent so the
  // plan never carries a model-authored declaration the stamp would have to patch.
  return [`# ${module.title || module.moduleId}`, '', module.description, '', '## Traceability', '', `Criteria: ${module.criterionIds.join(', ')}`, `Aspects: ${module.aspectIds.join(', ')}`, '', '## Validation', '', module.validationExpectation, '', ...fragments.map((fragment) => `## Fragment: ${fragment.title || fragment.fragmentId}\n\n${fragment.markdown}`)].join('\n');
}

function residueMarkdown(candidate: PlanningResidueCandidate): string {
  return [`# ${candidate.title}`, '', candidate.scope, '', '## Traceability', '', `Criteria: ${candidate.criterionIds.join(', ')}`, `Aspects: ${candidate.aspectIds.join(', ')}`, '', '## Expected outputs', '', ...candidate.expectedOutputs.map((output) => `- ${output}`), '', '## Validation expectations', '', ...candidate.validationExpectations.map((value) => `- ${value}`), '', '## Rationale', '', candidate.rationale].join('\n');
}

function cloneFragments(fragments: PlanningAtomPlanFragment[]): PlanningAtomPlanFragment[] {
  return fragments.map((fragment) => ({ ...fragment, criterionIds: [...fragment.criterionIds], aspectIds: [...fragment.aspectIds], dependsOnFragmentIds: fragment.dependsOnFragmentIds ? [...fragment.dependsOnFragmentIds] : undefined }));
}

function cloneModules(modules: PlanningAtomModuleCandidate[]): PlanningAtomModuleCandidate[] {
  return modules.map((module) => ({ ...module, criterionIds: [...module.criterionIds], aspectIds: [...module.aspectIds], dependsOnModuleIds: module.dependsOnModuleIds ? [...module.dependsOnModuleIds] : undefined }));
}

function uniq(values: string[]): string[] { return [...new Set(values.filter(nonEmpty))].sort(); }
function intersects(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
