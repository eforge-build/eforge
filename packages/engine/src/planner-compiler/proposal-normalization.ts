import type { BuildStageSpec, ReviewProfileConfig } from '@eforge-build/client';
import type { BoundedPlannerCompilerResult } from './compiler-runner.js';
import { cloneBuildStages, derivePlanPipelineSettings, type DerivedPlanPipelineSettings } from './pipeline-derivation.js';
import type { PlanningModuleDocsWork, PlanningModuleReviewDepth, PlanningModuleTestOwnership, PlanningModuleTestWork } from './reduce-digest-contracts.js';

export type ProposalNormalizationChangeKind = 'fallback' | 'normalized' | 'safety-escalation';
export interface ProposalNormalizationChange { field: 'docsWork' | 'testWork' | 'testOwnership' | 'reviewDepth' | 'fileOwnership'; kind: ProposalNormalizationChangeKind; reason: string }
export interface PlanningProposalIntentSnapshot { docsWork?: PlanningModuleDocsWork; testWork?: PlanningModuleTestWork; testOwnership?: PlanningModuleTestOwnership; reviewDepth?: PlanningModuleReviewDepth; reviewRationale?: string; dependsOnModuleIds: string[] }
export interface NormalizedPlanningFileOwnership { path: string; ownerModuleId?: string; consumerModuleIds: string[]; shared: boolean; reason?: string }
export interface PlanningProposalModuleInput {
  moduleId: string;
  title: string;
  criterionIds: string[];
  aspectIds: string[];
  markdown: string;
  dependsOnModuleIds: string[];
  validationExpectation: string;
  residue: boolean;
  docsWork?: PlanningModuleDocsWork;
  testWork?: PlanningModuleTestWork;
  testOwnership?: PlanningModuleTestOwnership;
  reviewDepth?: PlanningModuleReviewDepth;
  reviewRationale?: string;
}
export interface NormalizedPlanningProposalModule extends Omit<PlanningProposalModuleInput, 'docsWork' | 'testWork' | 'testOwnership' | 'reviewDepth'> {
  docsWork: PlanningModuleDocsWork;
  testWork: PlanningModuleTestWork;
  testOwnership: PlanningModuleTestOwnership;
  reviewDepth: PlanningModuleReviewDepth;
  build: BuildStageSpec[];
  review: ReviewProfileConfig;
  pipelineRationale: string;
  proposedIntent: PlanningProposalIntentSnapshot;
  normalizationChanges: ProposalNormalizationChange[];
  ownedPaths: string[];
}
export interface PlanningProposalNormalizationResult {
  status: 'accepted' | 'normalized' | 'rejected';
  modules: NormalizedPlanningProposalModule[];
  fileOwnership: NormalizedPlanningFileOwnership[];
  fileOwnershipConflicts: Array<{ path: string; ownerModuleIds: string[] }>;
  validationErrors: string[];
  defaultBuild: BuildStageSpec[];
  defaultReview: ReviewProfileConfig;
  rationale: string;
}
export interface NormalizePlanningProposalInput { compilerResult: BoundedPlannerCompilerResult; modules: PlanningProposalModuleInput[] }

type PreparedPlanningProposalModule = Omit<PlanningProposalModuleInput, 'docsWork' | 'testWork' | 'testOwnership'> & { docsWork: PlanningModuleDocsWork; testWork: PlanningModuleTestWork; testOwnership: PlanningModuleTestOwnership };

const MAX_NORMALIZED_MODULES = 128;

/**
 * Convert model-authored module intent into the one executable representation
 * consumed by artifact, architecture, and diagnostics synthesis. The function
 * never creates extra modules: invalid boundaries fail closed instead.
 */
export function normalizePlanningProposal(input: NormalizePlanningProposalInput): PlanningProposalNormalizationResult {
  const prepared = input.modules.map(normalizeDeclaredIntent);
  const derivation = derivePlanPipelineSettings({
    modules: prepared.map((entry) => ({ ...entry.module, testOwnershipDeclared: entry.proposedIntent.testOwnership !== undefined })),
    atoms: input.compilerResult.atomGraph.atoms,
    localizationRecords: input.compilerResult.sourceLocalizationBundle.records,
    residueCandidates: input.compilerResult.residue.candidates,
  });
  const modules = prepared.map(({ module, proposedIntent, changes }) => {
    const settings = requireSettings(module.moduleId, derivation.plans);
    const normalizationChanges = [...changes, ...reviewChanges(proposedIntent, settings)];
    return {
      ...module,
      testOwnership: settings.testOwnership,
      reviewDepth: settings.reviewDepth,
      build: cloneBuildStages(settings.build),
      review: cloneReview(settings.review),
      pipelineRationale: settings.rationale,
      proposedIntent,
      normalizationChanges,
      ownedPaths: [] as string[],
    };
  });
  const ownership = deriveFileOwnership(input.compilerResult, modules);
  const modulesWithPaths = modules.map((module) => ({
    ...module,
    normalizationChanges: [...module.normalizationChanges, ...(ownership.changesByModule.get(module.moduleId) ?? [])],
    ownedPaths: ownership.entries.filter((entry) => entry.ownerModuleId === module.moduleId).map((entry) => entry.path),
  }));
  const validationErrors = validateNormalizedProposal(input.compilerResult, modulesWithPaths, ownership.conflicts);
  const changed = modulesWithPaths.some((module) => module.normalizationChanges.length > 0);
  return {
    status: validationErrors.length > 0 ? 'rejected' : changed ? 'normalized' : 'accepted',
    modules: modulesWithPaths,
    fileOwnership: ownership.entries,
    fileOwnershipConflicts: ownership.conflicts,
    validationErrors,
    defaultBuild: cloneBuildStages(derivation.defaultBuild),
    defaultReview: cloneReview(derivation.defaultReview),
    rationale: derivation.rationale,
  };
}

function normalizeDeclaredIntent(module: PlanningProposalModuleInput): { module: PreparedPlanningProposalModule; proposedIntent: PlanningProposalIntentSnapshot; changes: ProposalNormalizationChange[] } {
  const proposedIntent: PlanningProposalIntentSnapshot = {
    ...(module.docsWork ? { docsWork: module.docsWork } : {}),
    ...(module.testWork ? { testWork: module.testWork } : {}),
    ...(module.testOwnership ? { testOwnership: module.testOwnership } : {}),
    ...(module.reviewDepth ? { reviewDepth: module.reviewDepth } : {}),
    ...(module.reviewRationale ? { reviewRationale: module.reviewRationale } : {}),
    dependsOnModuleIds: [...module.dependsOnModuleIds],
  };
  const changes: ProposalNormalizationChange[] = [];
  const docsWork = module.docsWork ?? 'none';
  const testWork = module.testWork ?? 'none';
  if (module.docsWork === undefined) changes.push({ field: 'docsWork', kind: 'fallback', reason: 'no documentation intent was proposed; selected none' });
  if (module.testWork === undefined) changes.push({ field: 'testWork', kind: 'fallback', reason: 'no test-work intent was proposed; selected none' });
  let testOwnership = module.testOwnership;
  if (!testOwnership) {
    testOwnership = testWork === 'author-new' ? 'test-writer' : 'existing-only';
    changes.push({ field: 'testOwnership', kind: 'fallback', reason: testWork === 'author-new' ? 'author-new test work requires a deterministic author; selected test-writer' : 'no test author was proposed; selected existing-only' });
  } else if (testWork === 'author-new' && testOwnership === 'existing-only') {
    testOwnership = 'test-writer';
    changes.push({ field: 'testOwnership', kind: 'normalized', reason: 'existing-only cannot satisfy author-new test work; selected the isolated test-writer boundary' });
  }
  return { module: { ...module, docsWork, testWork, testOwnership }, proposedIntent, changes };
}

function reviewChanges(proposed: PlanningProposalIntentSnapshot, settings: DerivedPlanPipelineSettings): ProposalNormalizationChange[] {
  if (!proposed.reviewDepth) return [{ field: 'reviewDepth', kind: 'fallback', reason: `no review depth was proposed; selected ${settings.reviewDepth} from deterministic risk signals` }];
  if (proposed.reviewDepth !== settings.reviewDepth) return [{ field: 'reviewDepth', kind: 'safety-escalation', reason: `deterministic risk floor raised ${proposed.reviewDepth} review to ${settings.reviewDepth}` }];
  return [];
}

function deriveFileOwnership(result: BoundedPlannerCompilerResult, modules: NormalizedPlanningProposalModule[]): { entries: NormalizedPlanningFileOwnership[]; conflicts: Array<{ path: string; ownerModuleIds: string[] }>; changesByModule: Map<string, ProposalNormalizationChange[]> } {
  const claims = new Map<string, { owners: Set<string>; consumers: Set<string>; shared: boolean; reasons: Set<string> }>();
  const changesByModule = new Map<string, ProposalNormalizationChange[]>();
  const modulesByAtom = new Map(result.atomGraph.atoms.map((atom) => [atom.atomId, modules.filter((module) => !module.residue && (intersects(module.aspectIds, atom.facetIds) || intersects(module.criterionIds, atom.criterionIds))).map((module) => module.moduleId)]));
  for (const evidence of result.sharedBrief.evidenceOwnership) {
    const ownerAtomId = evidence.primaryAtomId ?? evidence.referencedByAtomIds[0];
    const atomOwners = ownerAtomId ? modulesByAtom.get(ownerAtomId) ?? [] : [];
    const linkedOwners = linkedModulesForPath(evidence.path, result, modules);
    const candidates = linkedOwners.length > 0 ? linkedOwners : atomOwners;
    const owner = selectFileOwner(evidence.path, candidates, result, modules);
    const demotedConsumers = candidates.filter((moduleId) => moduleId !== owner);
    if (owner && demotedConsumers.length > 0) {
      const changes = changesByModule.get(owner) ?? [];
      changes.push({ field: 'fileOwnership', kind: 'normalized', reason: `assigned ${evidence.path} exclusively to ${owner}; overlapping candidates became consumers: ${demotedConsumers.join(',')}` });
      changesByModule.set(owner, changes);
    }
    addClaim(claims, evidence.path, owner ? [owner] : [], [...evidence.consumerAtomIds.flatMap((atomId) => modulesByAtom.get(atomId) ?? []), ...demotedConsumers], evidence.shared || demotedConsumers.length > 0, evidence.reason);
  }
  const residuePaths = new Map(result.residue.candidates.map((candidate) => [candidate.candidateId, candidate.localizedOwnerPaths ?? []]));
  for (const module of modules.filter((candidate) => candidate.residue)) {
    for (const path of residuePaths.get(module.moduleId) ?? []) addClaim(claims, path, [module.moduleId], [], false, 'residue localized owner');
  }
  const conflicts: Array<{ path: string; ownerModuleIds: string[] }> = [];
  const entries = [...claims.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, claim]) => {
    const owners = [...claim.owners].sort();
    if (owners.length > 1) conflicts.push({ path, ownerModuleIds: owners });
    return {
      path,
      ...(owners.length === 1 ? { ownerModuleId: owners[0] } : {}),
      consumerModuleIds: [...claim.consumers].filter((moduleId) => !owners.includes(moduleId)).sort(),
      shared: claim.shared,
      ...([...claim.reasons].sort()[0] ? { reason: [...claim.reasons].sort()[0] } : {}),
    };
  });
  return { entries, conflicts, changesByModule };
}

function selectFileOwner(path: string, candidates: string[], result: BoundedPlannerCompilerResult, modules: NormalizedPlanningProposalModule[]): string | undefined {
  const records = result.sourceLocalizationBundle.records.filter((record) => record.candidateFiles.some((candidate) => candidate.path === path));
  const moduleById = new Map(modules.map((module) => [module.moduleId, module]));
  const score = (moduleId: string): number => {
    const module = moduleById.get(moduleId);
    if (!module) return 0;
    return records.reduce((total, record) => total + intersectionCount(module.aspectIds, record.linkedAspectIds) * 10 + intersectionCount(module.criterionIds, record.linkedCriterionIds) * 2, 0);
  };
  const scores = new Map(uniq(candidates).map((moduleId) => [moduleId, score(moduleId)]));
  return [...scores.keys()].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a.localeCompare(b))[0];
}

function linkedModulesForPath(path: string, result: BoundedPlannerCompilerResult, modules: NormalizedPlanningProposalModule[]): string[] {
  const records = result.sourceLocalizationBundle.records.filter((record) => record.candidateFiles.some((candidate) => candidate.path === path));
  return uniq(modules.filter((module) => !module.residue && records.some((record) => intersects(module.criterionIds, record.linkedCriterionIds) || intersects(module.aspectIds, record.linkedAspectIds))).map((module) => module.moduleId));
}

function addClaim(claims: Map<string, { owners: Set<string>; consumers: Set<string>; shared: boolean; reasons: Set<string> }>, path: string, owners: string[], consumers: string[], shared: boolean, reason?: string): void {
  const claim = claims.get(path) ?? { owners: new Set<string>(), consumers: new Set<string>(), shared: false, reasons: new Set<string>() };
  for (const owner of owners) claim.owners.add(owner);
  for (const consumer of consumers) claim.consumers.add(consumer);
  claim.shared ||= shared;
  if (reason) claim.reasons.add(reason);
  claims.set(path, claim);
}

/**
 * Validate only what normalization itself owns. Compiler-level validation
 * errors are merged into the artifact result by plan-artifact-synthesis; they
 * must not reject the proposal here or the diagnostics artifact would blame
 * the model's module boundaries for unrelated compiler failures.
 */
function validateNormalizedProposal(result: BoundedPlannerCompilerResult, modules: NormalizedPlanningProposalModule[], conflicts: Array<{ path: string; ownerModuleIds: string[] }>): string[] {
  const errors: string[] = [];
  if (modules.length > MAX_NORMALIZED_MODULES) errors.push(`normalized module count budget exceeded:${modules.length}>${MAX_NORMALIZED_MODULES}`);
  validateUniqueModules(modules, errors);
  validateDependencies(modules, errors);
  validateModuleCoverage(result, modules, errors);
  validateModuleBudgets(result, modules, errors);
  for (const conflict of conflicts) errors.push(`file ownership overlap:${conflict.path}:${conflict.ownerModuleIds.join(',')}`);
  for (const module of modules) errors.push(...pipelineCompatibilityErrors(module));
  // Model-controlled ids/paths are interpolated above; collapse whitespace so
  // a hostile value cannot inject fake lines into plaintext log renderings.
  return [...new Set(errors.map(singleLine))].sort();
}

function singleLine(value: string): string { return value.replace(/\s+/g, ' ').trim(); }

function validateUniqueModules(modules: NormalizedPlanningProposalModule[], errors: string[]): void {
  const seen = new Set<string>();
  for (const module of modules) {
    if (!module.moduleId.trim()) errors.push('module requires id');
    else if (seen.has(module.moduleId)) errors.push(`module id duplicated:${module.moduleId}`);
    seen.add(module.moduleId);
    if (!module.title.trim()) errors.push(`module requires title:${module.moduleId}`);
    if (!module.markdown.trim()) errors.push(`module requires markdown:${module.moduleId}`);
    if (module.criterionIds.length === 0) errors.push(`module requires criteria:${module.moduleId}`);
    if (module.aspectIds.length === 0) errors.push(`module requires aspects:${module.moduleId}`);
    if (!module.validationExpectation.trim()) errors.push(`module requires validation expectation:${module.moduleId}`);
  }
}

function validateDependencies(modules: NormalizedPlanningProposalModule[], errors: string[]): void {
  const ids = new Set(modules.map((module) => module.moduleId));
  const dependencies = new Map(modules.map((module) => [module.moduleId, module.dependsOnModuleIds]));
  for (const module of modules) for (const dependencyId of module.dependsOnModuleIds) {
    if (dependencyId === module.moduleId) errors.push(`module dependency self-reference:${module.moduleId}`);
    else if (!ids.has(dependencyId)) errors.push(`module dependency missing:${module.moduleId}:${dependencyId}`);
  }
  const state = new Map<string, 'visiting' | 'visited'>();
  const visit = (moduleId: string, path: string[]): void => {
    if (state.get(moduleId) === 'visited') return;
    if (state.get(moduleId) === 'visiting') { const start = path.indexOf(moduleId); errors.push(`module dependency cycle:${[...path.slice(start), moduleId].join('->')}`); return; }
    state.set(moduleId, 'visiting');
    for (const dependencyId of dependencies.get(moduleId) ?? []) if (dependencyId !== moduleId && dependencies.has(dependencyId)) visit(dependencyId, [...path, moduleId]);
    state.set(moduleId, 'visited');
  };
  for (const moduleId of [...dependencies.keys()].sort()) visit(moduleId, []);
}

function validateModuleCoverage(result: BoundedPlannerCompilerResult, modules: NormalizedPlanningProposalModule[], errors: string[]): void {
  if (modules.length === 0) return;
  const covered = new Set(modules.flatMap((module) => module.criterionIds));
  const skipped = new Set(result.map.coverage.criteria.filter((criterion) => criterion.complete && criterion.requiredAspectIds.length > 0 && criterion.skippedAspectIds.length === criterion.requiredAspectIds.length).map((criterion) => criterion.criterionId));
  for (const criterion of result.sourceInventory.criteria) if (!covered.has(criterion.id) && !skipped.has(criterion.id)) errors.push(`criterion has no module owner:${criterion.id}`);
}

function validateModuleBudgets(result: BoundedPlannerCompilerResult, modules: NormalizedPlanningProposalModule[], errors: string[]): void {
  for (const module of modules.filter((candidate) => !candidate.residue)) {
    const atoms = result.atomGraph.atoms.filter((atom) => intersects(module.criterionIds, atom.criterionIds) || intersects(module.aspectIds, atom.facetIds));
    const sourceBytes = atoms.reduce((total, atom) => total + atom.estimate.sourceBytes, 0);
    const subsystems = new Set(atoms.flatMap((atom) => atom.subsystemHints)).size;
    if (sourceBytes > result.atomGraph.limits.maxPromptSourceBytes) errors.push(`module source context budget exceeded:${module.moduleId}:${sourceBytes}>${result.atomGraph.limits.maxPromptSourceBytes}`);
    if (module.criterionIds.length > result.atomGraph.limits.maxCriteriaPerUnit) errors.push(`module criterion budget exceeded:${module.moduleId}:${module.criterionIds.length}>${result.atomGraph.limits.maxCriteriaPerUnit}`);
    if (subsystems > result.atomGraph.limits.maxSubsystemsPerUnit) errors.push(`module subsystem budget exceeded:${module.moduleId}:${subsystems}>${result.atomGraph.limits.maxSubsystemsPerUnit}`);
  }
}

function pipelineCompatibilityErrors(module: NormalizedPlanningProposalModule): string[] {
  const stages = module.build.flatMap((stage) => Array.isArray(stage) ? stage : [stage]);
  const errors: string[] = [];
  const count = (stage: string): number => stages.filter((candidate) => candidate === stage).length;
  if (count('implement') !== 1 || count('review-cycle') !== 1) errors.push(`normalized pipeline requires one implement and review-cycle:${module.moduleId}`);
  if (module.testOwnership === 'test-writer' ? count('test-write') !== 1 : count('test-write') !== 0) errors.push(`normalized pipeline test ownership incompatible:${module.moduleId}:${module.testOwnership}`);
  if (module.docsWork === 'author-new' && (count('doc-author') !== 1 || count('doc-sync') !== 1)) errors.push(`normalized pipeline docs authoring incompatible:${module.moduleId}`);
  if (module.docsWork === 'sync-existing' && (count('doc-author') !== 0 || count('doc-sync') !== 1)) errors.push(`normalized pipeline docs sync incompatible:${module.moduleId}`);
  if (module.docsWork === 'none' && (count('doc-author') !== 0 || count('doc-sync') !== 0)) errors.push(`normalized pipeline unexpected docs stage:${module.moduleId}`);
  return errors;
}

function requireSettings(moduleId: string, settings: DerivedPlanPipelineSettings[]): DerivedPlanPipelineSettings {
  const value = settings.find((entry) => entry.moduleId === moduleId);
  if (!value) throw new Error(`missing derived pipeline settings for module:${moduleId}`);
  return value;
}

function cloneReview(review: ReviewProfileConfig): ReviewProfileConfig { return { ...review, perspectives: [...review.perspectives] }; }
function intersects(a: string[], b: string[]): boolean { return a.some((value) => b.includes(value)); }
function intersectionCount(a: string[], b: string[]): number { return a.filter((value) => b.includes(value)).length; }
function uniq(values: string[]): string[] { return [...new Set(values.filter((value) => value.trim().length > 0))].sort(); }
