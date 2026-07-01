import type { BoundedPlannerCompilerResult } from './compiler-runner.js';
import { derivePlanningAspectCoverage } from './coverage-accounting.js';
import type { PlanningAtomModuleCandidate, PlanningAtomPlanFragment } from './atom-planning-contracts.js';
import type { PlanningResidueCandidate } from './residue-contracts.js';

export interface SynthesizePlanningArtifactsInput { compilerResult: BoundedPlannerCompilerResult }
export interface PlanningSynthesizedModulePlan { moduleId: string; title: string; criterionIds: string[]; aspectIds: string[]; markdown: string; dependsOnModuleIds: string[]; validationExpectation: string; residue: boolean }
export interface PlanningArtifactOrchestration { modules: Array<{ id: string; dependsOn: string[] }> }
export interface PlanningArtifactSynthesisResult { architectureMarkdown: string; planMarkdown: string; modulePlans: PlanningSynthesizedModulePlan[]; orchestration: PlanningArtifactOrchestration; acceptanceCoverageMarkdown: string; validationErrors: string[] }

export function synthesizePlanningArtifacts(input: SynthesizePlanningArtifactsInput): PlanningArtifactSynthesisResult {
  const result = input.compilerResult;
  const fragments = selectPlanFragments(result);
  const modules = [...candidateModules(result, fragments), ...residueModules(result.residue.candidates)];
  const validationErrors = validateSynthesizedArtifacts(result, modules);
  const architectureMarkdown = architectureMarkdownFor(result);
  const acceptanceCoverageMarkdown = coverageMarkdownFor(result);
  const planMarkdown = planMarkdownFor(result, modules, fragments);
  if (!nonEmpty(architectureMarkdown)) validationErrors.push('architecture markdown is empty');
  if (!nonEmpty(planMarkdown)) validationErrors.push('plan markdown is empty');
  return {
    architectureMarkdown,
    planMarkdown,
    modulePlans: modules,
    orchestration: { modules: modules.map((module) => ({ id: module.moduleId, dependsOn: [...module.dependsOnModuleIds] })) },
    acceptanceCoverageMarkdown,
    validationErrors: [...new Set(validationErrors)].sort(),
  };
}

function selectPlanFragments(result: BoundedPlannerCompilerResult): PlanningAtomPlanFragment[] {
  const reduceFragments = artifactReduceOutputs(result).flatMap((output) => output.planFragments ?? []);
  const atomFragments = result.map.outputs.flatMap((output) => output.planFragments ?? []);
  return cloneFragments(reduceFragments.length > 0 ? reduceFragments : atomFragments);
}

function candidateModules(result: BoundedPlannerCompilerResult, fragments: PlanningAtomPlanFragment[]): PlanningSynthesizedModulePlan[] {
  const reduceModules = artifactReduceOutputs(result).flatMap((output) => output.moduleCandidates ?? []);
  const atomModules = result.map.outputs.flatMap((output) => output.moduleCandidates ?? []);
  return cloneModules(reduceModules.length > 0 ? reduceModules : atomModules).map((module) => modulePlanFromCandidate(module, fragments));
}

function artifactReduceOutputs(result: BoundedPlannerCompilerResult) {
  return result.reduce.finalOutput ? [result.reduce.finalOutput] : result.reduce.outputs;
}

function modulePlanFromCandidate(module: PlanningAtomModuleCandidate, fragments: PlanningAtomPlanFragment[]): PlanningSynthesizedModulePlan {
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
  };
}

function residueModules(candidates: PlanningResidueCandidate[]): PlanningSynthesizedModulePlan[] {
  return candidates.map((candidate) => ({
    moduleId: candidate.candidateId,
    title: candidate.title,
    criterionIds: [...candidate.criterionIds],
    aspectIds: [...candidate.aspectIds],
    markdown: residueMarkdown(candidate),
    dependsOnModuleIds: [...(candidate.dependsOnCandidateIds ?? [])],
    validationExpectation: candidate.validationExpectations.join('\n'),
    residue: true,
  }));
}

function validateSynthesizedArtifacts(result: BoundedPlannerCompilerResult, modules: PlanningSynthesizedModulePlan[]): string[] {
  const errors = [...result.validationErrors];
  validateModules(modules, errors);
  validateCoverage(result, errors);
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
    if (module.residue) validateResidueModule(module, errors);
    for (const dependencyId of module.dependsOnModuleIds) {
      if (dependencyId === module.moduleId) errors.push(`module dependency self-reference:${module.moduleId}`);
      else if (!moduleIds.has(dependencyId)) errors.push(`module dependency missing:${module.moduleId}:${dependencyId}`);
    }
  }
}

function validateResidueModule(module: PlanningSynthesizedModulePlan, errors: string[]): void {
  if (/candidate-reduce-gap/.test(module.moduleId) && /source\/localization|localized owner|owner path|materialized source/i.test(module.markdown)) {
    const validationText = module.validationExpectation;
    if (!module.criterionIds.some((criterionId) => validationText.includes(criterionId))) errors.push(`source/localization residue requires original PRD validation:${module.moduleId}`);
    if (!/localized-owner:[^\s)\],;]+/i.test(module.markdown)) errors.push(`source/localization residue requires concrete localized owner:${module.moduleId}`);
    if (!/product-scoped|Product-scoped/i.test(module.markdown)) errors.push(`source/localization residue requires product-scoped outputs:${module.moduleId}`);
  }
}

function validateCoverage(result: BoundedPlannerCompilerResult, errors: string[]): void {
  const coverage = derivePlanningAspectCoverage({
    graph: result.atomGraph,
    inventory: result.sourceInventory,
    updates: [...result.map.outputs.flatMap((output) => output.aspectUpdates), ...result.residue.coverageUpdates],
  });
  errors.push(...coverage.validationErrors);
  for (const criterion of coverage.criteria.filter((item) => !item.complete)) errors.push(`unresolved criterion after artifact synthesis:${criterion.criterionId}:${criterion.pendingAspectIds.join(',')}`);
}

function architectureMarkdownFor(result: BoundedPlannerCompilerResult): string {
  const finalSummary = result.reduce.finalOutput?.compactSummary;
  const summaries = result.reduce.outputs.map((output) => output.compactSummary).filter(nonEmpty);
  return ['# Planner Compiler Architecture', '', finalSummary || summaries.join('\n\n') || 'No reduce synthesis was produced.', '', `Compiler status: ${result.status}`, `Source hash: ${result.sourceInventory.sourceHash}`].join('\n');
}

function planMarkdownFor(result: BoundedPlannerCompilerResult, modules: PlanningSynthesizedModulePlan[], fragments: PlanningAtomPlanFragment[]): string {
  return ['# Planner Compiler Plan', '', '## Modules', ...modules.map((module) => `- ${module.moduleId}: ${module.title}${module.residue ? ' (residue/follow-up)' : ''}`), '', '## Plan fragments', ...(fragments.length > 0 ? fragments.map((fragment) => `### ${fragment.title || fragment.fragmentId}\n\n${fragment.markdown}`) : ['No standalone plan fragments were produced.']), '', coverageMarkdownFor(result)].join('\n');
}

function coverageMarkdownFor(result: BoundedPlannerCompilerResult): string {
  const coverage = derivePlanningAspectCoverage({ graph: result.atomGraph, inventory: result.sourceInventory, updates: [...result.map.outputs.flatMap((output) => output.aspectUpdates), ...result.residue.coverageUpdates] });
  return ['## Acceptance Coverage', '', `Complete criteria: ${coverage.completeCriteria.join(', ') || '(none)'}`, `Incomplete criteria: ${coverage.incompleteCriteria.join(', ') || '(none)'}`, '', '### Represented residue/follow-up aspects', ...(result.residue.candidates.length > 0 ? result.residue.candidates.map((candidate) => `- ${candidate.candidateId}: ${candidate.aspectIds.join(', ')} (${candidate.reason})`) : ['- (none)'])].join('\n');
}

function moduleMarkdown(module: PlanningAtomModuleCandidate, fragments: PlanningAtomPlanFragment[]): string {
  return [`# ${module.title || module.moduleId}`, '', module.description, '', '## Traceability', '', `Criteria: ${module.criterionIds.join(', ')}`, `Aspects: ${module.aspectIds.join(', ')}`, '', '## Validation', '', module.validationExpectation, '', ...fragments.map((fragment) => `## Fragment: ${fragment.title || fragment.fragmentId}\n\n${fragment.markdown}`)].join('\n');
}

function residueMarkdown(candidate: PlanningResidueCandidate): string {
  return [`# ${candidate.title}`, '', candidate.scope, '', '## Expected outputs', '', ...candidate.expectedOutputs.map((output) => `- ${output}`), '', '## Validation expectations', '', ...candidate.validationExpectations.map((value) => `- ${value}`), '', '## Rationale', '', candidate.rationale].join('\n');
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
