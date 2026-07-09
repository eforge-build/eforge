import type { BuildStageSpec, ReviewProfileConfig } from '@eforge-build/client';
import type { PlanningArchitectureManifest } from './architecture-manifest-contracts.js';
import { synthesizeArchitecture } from './architecture-synthesis.js';
import type { BoundedPlannerCompilerResult } from './compiler-runner.js';
import { derivePlanningAspectCoverage, type PlanningAspectCoverageSummary } from './coverage-accounting.js';
import type { PlanningAtomModuleCandidate, PlanningAtomPlanFragment } from './atom-planning-contracts.js';
import { cloneBuildStages, derivePlanPipelineSettings, type DerivedPlanPipelineSettings } from './pipeline-derivation.js';
import type { PlanningModuleDocsWork, PlanningModuleReviewDepth, PlanningModuleTestOwnership, PlanningModuleTestWork } from './reduce-digest-contracts.js';
import type { PlanningResidueCandidate } from './residue-contracts.js';

export interface SynthesizePlanningArtifactsInput { compilerResult: BoundedPlannerCompilerResult }
export interface PlanningSynthesizedModulePlan { moduleId: string; title: string; criterionIds: string[]; aspectIds: string[]; markdown: string; dependsOnModuleIds: string[]; validationExpectation: string; residue: boolean; docsWork: PlanningModuleDocsWork; testWork: PlanningModuleTestWork; testOwnership: PlanningModuleTestOwnership; reviewDepth: PlanningModuleReviewDepth; reviewRationale?: string; build: BuildStageSpec[]; review: ReviewProfileConfig; pipelineRationale: string }
export interface PlanningArtifactOrchestration { modules: Array<{ id: string; dependsOn: string[]; build: BuildStageSpec[]; review: ReviewProfileConfig }> }
export interface PlanningArtifactPipelineDefaults { defaultBuild: BuildStageSpec[]; defaultReview: ReviewProfileConfig; rationale: string }
export interface PlanningArtifactSynthesisResult { architectureMarkdown: string; architectureManifest: PlanningArchitectureManifest; planMarkdown: string; modulePlans: PlanningSynthesizedModulePlan[]; orchestration: PlanningArtifactOrchestration; pipelineDefaults: PlanningArtifactPipelineDefaults; acceptanceCoverageMarkdown: string; validationErrors: string[] }

type PlanningSynthesizedModulePlanBase = Omit<PlanningSynthesizedModulePlan, 'build' | 'review' | 'reviewDepth' | 'testOwnership' | 'pipelineRationale'> & { testOwnership?: PlanningModuleTestOwnership; reviewDepth?: PlanningModuleReviewDepth };

export function synthesizePlanningArtifacts(input: SynthesizePlanningArtifactsInput): PlanningArtifactSynthesisResult {
  const result = input.compilerResult;
  const fragments = selectPlanFragments(result);
  const baseModules = [...candidateModules(result, fragments), ...residueModules(result.residue.candidates)];
  const derivation = derivePlanPipelineSettings({
    modules: baseModules.map((module) => ({ moduleId: module.moduleId, criterionIds: module.criterionIds, aspectIds: module.aspectIds, dependsOnModuleIds: module.dependsOnModuleIds, residue: module.residue, docsWork: module.docsWork, testWork: module.testWork, testOwnership: module.testOwnership, reviewDepth: module.reviewDepth, reviewRationale: module.reviewRationale })),
    atoms: result.atomGraph.atoms,
    localizationRecords: result.sourceLocalizationBundle.records,
    residueCandidates: result.residue.candidates,
  });
  const modules = baseModules.map((module) => stampPipelineSettings(module, derivation.plans));
  const validationErrors = validateSynthesizedArtifacts(result, modules);
  const architecture = synthesizeArchitecture({ compilerResult: result, modulePlans: modules });
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
    pipelineDefaults: { defaultBuild: derivation.defaultBuild, defaultReview: derivation.defaultReview, rationale: derivation.rationale },
    acceptanceCoverageMarkdown,
    validationErrors: [...new Set(validationErrors)].sort(),
  };
}

function stampPipelineSettings(module: PlanningSynthesizedModulePlanBase, plans: DerivedPlanPipelineSettings[]): PlanningSynthesizedModulePlan {
  const settings = plans.find((plan) => plan.moduleId === module.moduleId);
  if (!settings) throw new Error(`missing derived pipeline settings for module:${module.moduleId}`);
  return { ...module, markdown: appendNormalizedExecutionIntent(module.markdown, settings), testOwnership: settings.testOwnership, reviewDepth: settings.reviewDepth, build: cloneBuildStages(settings.build), review: { ...settings.review, perspectives: [...settings.review.perspectives] }, pipelineRationale: settings.rationale };
}

/**
 * Render the Execution Intent section purely from normalized pipeline settings
 * and append it as the final section of every plan (candidate and residue).
 * The block is never regex-patched into agent-authored markdown: agent text
 * cannot absorb, shadow, or spoof the stamp, replacement-pattern characters
 * (`$&` etc.) are inert, and the rationale is collapsed to a single line so a
 * model-authored review rationale cannot inject extra declaration lines.
 */
function appendNormalizedExecutionIntent(markdown: string, settings: DerivedPlanPipelineSettings): string {
  return [markdown, '', '## Execution Intent', '', `Test ownership: ${settings.testOwnership}`, `Review depth: ${settings.reviewDepth}`, `Review rationale: ${singleLine(settings.rationale)}`].join('\n');
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
    docsWork: module.docsWork ?? 'none',
    testWork: module.testWork ?? 'none',
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

function validateSynthesizedArtifacts(result: BoundedPlannerCompilerResult, modules: PlanningSynthesizedModulePlan[]): string[] {
  const errors = [...result.validationErrors];
  const coverage = coverageFor(result);
  validateModules(modules, errors);
  validateModuleCriterionCoverage(result, modules, coverage, errors);
  validateCoverage(coverage, errors);
  if (result.reduce.finalOutput?.status === 'failed' && result.residue.candidates.length === 0) errors.push('failed reduce output requires residue coverage');
  return errors;
}

function validateModules(modules: PlanningSynthesizedModulePlan[], errors: string[]): void {
  const moduleIds = new Set(modules.map((module) => module.moduleId).filter(nonEmpty));
  validateUnique('module', modules.map((module) => module.moduleId), errors);
  for (const module of modules) {
    if (!nonEmpty(module.moduleId)) errors.push('module requires id');
    if (!nonEmpty(module.title)) errors.push(`module requires title:${module.moduleId}`);
    if (!nonEmpty(module.markdown)) errors.push(`module requires markdown:${module.moduleId}`);
    if (module.criterionIds.length === 0) errors.push(`module requires criteria:${module.moduleId}`);
    if (module.aspectIds.length === 0) errors.push(`module requires aspects:${module.moduleId}`);
    if (!nonEmpty(module.validationExpectation)) errors.push(`module requires validation expectation:${module.moduleId}`);
    for (const dependencyId of module.dependsOnModuleIds) {
      if (dependencyId === module.moduleId) errors.push(`module dependency self-reference:${module.moduleId}`);
      else if (!moduleIds.has(dependencyId)) errors.push(`module dependency missing:${module.moduleId}:${dependencyId}`);
    }
  }
  validateDependencyCycles(modules, errors);
}

function validateDependencyCycles(modules: PlanningSynthesizedModulePlan[], errors: string[]): void {
  const dependencies = new Map(modules.map((module) => [module.moduleId, module.dependsOnModuleIds]));
  const state = new Map<string, 'visiting' | 'visited'>();
  const visit = (moduleId: string, path: string[]): void => {
    if (state.get(moduleId) === 'visited') return;
    if (state.get(moduleId) === 'visiting') {
      const cycleStart = path.indexOf(moduleId);
      errors.push(`module dependency cycle:${[...path.slice(cycleStart), moduleId].join('->')}`);
      return;
    }
    state.set(moduleId, 'visiting');
    for (const dependencyId of dependencies.get(moduleId) ?? []) if (dependencyId !== moduleId && dependencies.has(dependencyId)) visit(dependencyId, [...path, moduleId]);
    state.set(moduleId, 'visited');
  };
  for (const moduleId of [...dependencies.keys()].sort()) visit(moduleId, []);
}

function validateModuleCriterionCoverage(result: BoundedPlannerCompilerResult, modules: PlanningSynthesizedModulePlan[], coverage: PlanningAspectCoverageSummary, errors: string[]): void {
  if (modules.length === 0) return;
  const covered = new Set(modules.flatMap((module) => module.criterionIds));
  // A criterion whose required aspects are all deliberately skipped (with a
  // reason, per coverage accounting) is complete without executable work, so
  // it legitimately has no owning module - e.g. "no changes to X are required".
  const fullySkipped = new Set(coverage.criteria
    .filter((criterion) => criterion.complete && criterion.requiredAspectIds.length > 0 && criterion.skippedAspectIds.length === criterion.requiredAspectIds.length)
    .map((criterion) => criterion.criterionId));
  for (const criterion of result.sourceInventory.criteria) {
    if (!covered.has(criterion.id) && !fullySkipped.has(criterion.id)) errors.push(`criterion has no module owner:${criterion.id}`);
  }
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

function validateUnique(kind: string, ids: string[], errors: string[]): void {
  const seen = new Set<string>();
  for (const id of ids.filter(nonEmpty)) {
    if (seen.has(id)) errors.push(`${kind} id duplicated:${id}`);
    seen.add(id);
  }
}

function uniq(values: string[]): string[] { return [...new Set(values.filter(nonEmpty))].sort(); }
function intersects(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
