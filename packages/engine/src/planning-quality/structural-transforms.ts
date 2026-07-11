import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { BuildStageSpec, PlanningDecompositionLimits, ReviewProfileConfig } from '@eforge-build/client';

import {
  FACTOR_WEIGHTS,
  LARGE_PLAN_SOURCE_BYTES,
  MULTI_SUBSYSTEM_COUNT,
  deriveBuildStages,
  reviewDepthForRiskScore,
  reviewProfileForDepth,
  type PlanPipelineRiskFactor,
} from '../planner-compiler/pipeline-derivation.js';
import {
  parseArchitectureManifest,
  renderArchitectureManifestFence,
  type PlanningArchitectureManifest,
  type PlanningArchitectureManifestContract,
} from '../planner-compiler/architecture-manifest-contracts.js';
import {
  COMPILER_DIAGNOSTICS_ARTIFACT,
  validateCompilerDiagnostics,
  type CompilerDiagnostics,
} from '../planner-compiler/compiler-diagnostics-contracts.js';
import type {
  PlanningModuleDocsWork,
  PlanningModuleReviewDepth,
  PlanningModuleTestOwnership,
  PlanningModuleTestWork,
} from '../planner-compiler/reduce-digest-contracts.js';
import type { PlanningQualityStructuralFix } from './schemas.js';

interface PlanDocument { id: string; name: string; frontmatter: string; body: string }
interface StructuralMetadata {
  docsWork: PlanningModuleDocsWork;
  testWork: PlanningModuleTestWork;
  testOwnership: PlanningModuleTestOwnership;
  reviewDepth: PlanningModuleReviewDepth;
  reviewFloor: PlanningModuleReviewDepth;
  riskFactors: PlanPipelineRiskFactor[];
  budgetUsage: { sourceContextBytes: number; criterionCount: number; subsystemCount: number };
  build: BuildStageSpec[];
}
interface StructuralState {
  planDir: string;
  architecture: string;
  orchestration: Record<string, unknown>;
  plans: Map<string, PlanDocument>;
  manifest: PlanningArchitectureManifest;
  diagnostics: CompilerDiagnostics;
  metadata: Map<string, StructuralMetadata>;
  deletedPlanIds: Set<string>;
  /** Plans whose body a fix actually rewrote; untouched plan files are never re-serialized. */
  touchedPlanIds: Set<string>;
  /** absorbed plan id -> merge target, so merged validation expectations survive architecture regeneration. */
  absorbedInto: Map<string, string>;
  /** Set by merge fixes; architecture.md is regenerated only when the manifest changed. */
  manifestChanged: boolean;
}

export interface ApplyStructuralPlanningQualityFixesOptions {
  cwd: string;
  outputDir: string;
  planSetName: string;
  fixes: PlanningQualityStructuralFix[];
  limits: PlanningDecompositionLimits;
}

// --- eforge:region structural-transform-entrypoints ---
/**
 * Apply semantic planning simplifications as one logical transaction. All
 * derived artifact content is computed and validated before any file changes;
 * a write failure restores every touched file from its captured original.
 */
export async function applyStructuralPlanningQualityFixes(options: ApplyStructuralPlanningQualityFixesOptions): Promise<string[]> {
  if (options.fixes.length === 0) return [];
  const planDir = resolve(options.cwd, options.outputDir, options.planSetName);
  const state = await loadState(planDir);
  for (const fix of options.fixes) applyFix(state, fix, options.limits);
  validateState(state);
  const outputs = renderOutputs(state);
  const changedPaths = await writeTransaction(outputs);
  return changedPaths.map((path) => relative(options.cwd, path).split(sep).join('/'));
}

async function loadState(planDir: string): Promise<StructuralState> {
  const [architecture, orchestrationRaw, diagnosticsRaw] = await Promise.all([
    readFile(resolve(planDir, 'architecture.md'), 'utf8'),
    readFile(resolve(planDir, 'orchestration.yaml'), 'utf8'),
    readFile(resolve(planDir, COMPILER_DIAGNOSTICS_ARTIFACT), 'utf8'),
  ]);
  const parsedManifest = parseArchitectureManifest(architecture);
  if (!parsedManifest.manifest) throw new Error(`Cannot simplify plans: ${parsedManifest.errors.join('; ')}`);
  const diagnosticsValue: unknown = JSON.parse(diagnosticsRaw);
  const diagnosticsResult = validateCompilerDiagnostics(diagnosticsValue);
  if (!diagnosticsResult.ok) throw new Error(`Cannot simplify plans: invalid compiler diagnostics: ${diagnosticsResult.errors.join('; ')}`);
  const diagnostics = diagnosticsValue as CompilerDiagnostics;
  if (diagnostics.omitted.normalizationModules > 0) throw new Error('Cannot simplify plans: normalization module diagnostics were compacted');
  const orchestrationValue: unknown = parseYaml(orchestrationRaw);
  if (!isRecord(orchestrationValue) || !Array.isArray(orchestrationValue.plans)) throw new Error('Cannot simplify plans: orchestration.yaml is not a plan-set object');
  const plans = new Map<string, PlanDocument>();
  for (const entry of orchestrationValue.plans) {
    if (!isRecord(entry) || typeof entry.id !== 'string') throw new Error('Cannot simplify plans: orchestration plan requires an id');
    validatePlanId(entry.id);
    const raw = await readFile(resolve(planDir, `${entry.id}.md`), 'utf8');
    plans.set(entry.id, parsePlanDocument(raw, entry.id));
  }
  const metadata = new Map<string, StructuralMetadata>();
  for (const module of diagnostics.normalization.modules) {
    metadata.set(module.moduleId, {
      docsWork: module.normalized.docsWork,
      testWork: module.normalized.testWork,
      testOwnership: module.normalized.testOwnership,
      reviewDepth: module.normalized.reviewDepth,
      reviewFloor: module.normalized.reviewFloor,
      riskFactors: [...module.normalized.risk.factors],
      budgetUsage: { ...module.normalized.budgetUsage },
      build: cloneBuild(module.normalized.build),
    });
  }
  for (const planId of plans.keys()) if (!metadata.has(planId)) throw new Error(`Cannot simplify plan without complete normalization diagnostics: ${planId}`);
  // Diagnostics are immutable, so after an accepted merge they describe the
  // pre-merge module set (including the target's pre-merge review floor and
  // budget usage). Refuse a second structural pass over an already-simplified
  // plan set rather than revalidate against stale floors.
  for (const moduleId of metadata.keys()) if (!plans.has(moduleId)) throw new Error(`Cannot simplify plans: compiler diagnostics describe a module absent from the plan set (${JSON.stringify(moduleId)}); structural fixes were already applied`);
  return { planDir, architecture, orchestration: orchestrationValue, plans, manifest: parsedManifest.manifest, diagnostics, metadata, deletedPlanIds: new Set(), touchedPlanIds: new Set(), absorbedInto: new Map(), manifestChanged: false };
}

// --- eforge:endregion structural-transform-entrypoints ---

// --- eforge:region structural-operations ---
function applyFix(state: StructuralState, fix: PlanningQualityStructuralFix, limits: PlanningDecompositionLimits): void {
  if (fix.kind === 'merge_plans') mergePlans(state, fix.targetPlanId, fix.absorbedPlanIds, fix.rationale, limits);
  else if (fix.kind === 'remove_redundant_stage') removeRedundantStage(state, fix.planId, fix.stage);
  else reduceReviewDepth(state, fix.planId, fix.reviewDepth);
}

function mergePlans(state: StructuralState, targetId: string, absorbedIds: string[], rationale: string, limits: PlanningDecompositionLimits): void {
  validatePlanId(targetId);
  const absorbed = uniq(absorbedIds);
  if (absorbed.includes(targetId)) throw new Error(`Cannot merge a plan into itself: ${targetId}`);
  const ids = [targetId, ...absorbed];
  const planDocs = ids.map((id) => requirePlan(state, id));
  const manifestPlans = ids.map((id) => requireManifestPlan(state, id));
  if (manifestPlans.some((plan) => plan.residue)) throw new Error('Cannot merge residue plans because compiler diagnostic representation ids are immutable');
  ensureNoDiagnosticRepresentationReferences(state.diagnostics, absorbed);
  const metadata = ids.map((id) => requireMetadata(state, id));
  const criteria = uniq(manifestPlans.flatMap((plan) => plan.criterionIds));
  const aspects = uniq(manifestPlans.flatMap((plan) => plan.aspectIds));
  // Diagnostics record per-module usage totals, not the underlying atom sets,
  // so source bytes and subsystem counts shared between merged modules cannot
  // be de-duplicated here. Summing is an intentional conservative upper bound:
  // it can only over-estimate the merged plan's usage and risk factors, never
  // relax a budget ceiling or a review floor below what the compiler derived.
  const budgetUsage = {
    sourceContextBytes: metadata.reduce((total, item) => total + item.budgetUsage.sourceContextBytes, 0),
    criterionCount: criteria.length,
    subsystemCount: metadata.reduce((total, item) => total + item.budgetUsage.subsystemCount, 0),
  };
  validateMergedBudget(targetId, budgetUsage, limits);
  const riskFactors = mergedRiskFactors(metadata, budgetUsage);
  const reviewFloor = reviewDepthForRiskScore(riskScore(riskFactors));
  const reviewDepth = deepestDepth(...metadata.map((item) => item.reviewDepth), reviewFloor);
  const docsWork = strongestDocs(metadata.map((item) => item.docsWork));
  const testWork = strongestTests(metadata.map((item) => item.testWork));
  const testOwnership = mergedTestOwnership(metadata, testWork);
  const preserveTestCycle = metadata.some((item) => flattened(item.build).includes('test-cycle'));
  const build = canonicalBuild(docsWork, testWork, testOwnership, reviewFloor, preserveTestCycle);
  const mergedMetadata: StructuralMetadata = { docsWork, testWork, testOwnership, reviewDepth, reviewFloor, riskFactors, budgetUsage, build };

  const targetDoc = planDocs[0];
  targetDoc.body = mergedPlanBody(targetDoc.name, planDocs, criteria, aspects, mergedMetadata, rationale);
  state.touchedPlanIds.add(targetId);
  for (const id of absorbed) {
    state.plans.delete(id);
    state.metadata.delete(id);
    state.touchedPlanIds.delete(id);
    state.deletedPlanIds.add(id);
    state.absorbedInto.set(id, targetId);
  }
  state.metadata.set(targetId, mergedMetadata);
  rewriteOrchestrationForMerge(state, targetId, absorbed, mergedMetadata);
  rewriteManifestForMerge(state, targetId, absorbed, criteria, aspects);
}

function removeRedundantStage(state: StructuralState, planId: string, stage: string): void {
  const metadata = requireMetadata(state, planId);
  if (!flattened(metadata.build).includes(stage)) throw new Error(`Cannot remove absent stage ${stage} from ${planId}`);
  const build = removeStage(metadata.build, stage);
  validateBuildCompatibility(planId, build, metadata);
  metadata.build = build;
  updateOrchestrationPlan(state, planId, { build });
  rewriteExecutionIntent(requirePlan(state, planId), metadata);
  state.touchedPlanIds.add(planId);
}

function reduceReviewDepth(state: StructuralState, planId: string, depth: PlanningModuleReviewDepth): void {
  const metadata = requireMetadata(state, planId);
  if (depthRank(depth) >= depthRank(metadata.reviewDepth)) throw new Error(`Review-depth fix must reduce ${planId} below ${metadata.reviewDepth}`);
  if (depthRank(depth) < depthRank(metadata.reviewFloor)) throw new Error(`Cannot reduce ${planId} review below deterministic floor ${metadata.reviewFloor}`);
  metadata.reviewDepth = depth;
  updateOrchestrationPlan(state, planId, { review: reviewProfileForDepth(depth) });
  rewriteExecutionIntent(requirePlan(state, planId), metadata);
  state.touchedPlanIds.add(planId);
}

// --- eforge:endregion structural-operations ---

// --- eforge:region structural-artifact-regeneration ---
function rewriteOrchestrationForMerge(state: StructuralState, targetId: string, absorbedIds: string[], metadata: StructuralMetadata): void {
  const absorbed = new Set(absorbedIds);
  const plans = orchestrationPlans(state);
  const target = plans.find((entry) => entry.id === targetId);
  if (!target) throw new Error(`Orchestration target plan not found: ${targetId}`);
  const targetDeps = uniq(plans.filter((entry) => entry.id === targetId || absorbed.has(String(entry.id))).flatMap(dependenciesOf).map((id) => absorbed.has(id) ? targetId : id).filter((id) => id !== targetId));
  const retained = plans.filter((entry) => !absorbed.has(String(entry.id)));
  for (const entry of retained) {
    const id = String(entry.id);
    const deps = id === targetId ? targetDeps : uniq(dependenciesOf(entry).map((dep) => absorbed.has(dep) ? targetId : dep).filter((dep) => dep !== id));
    entry.depends_on = deps;
  }
  target.build = cloneBuild(metadata.build);
  target.review = reviewProfileForDepth(metadata.reviewDepth);
  target.test_ownership = metadata.testOwnership;
  state.orchestration.plans = retained;
  validateDependencyGraph(retained);
}

function rewriteManifestForMerge(state: StructuralState, targetId: string, absorbedIds: string[], criteria: string[], aspects: string[]): void {
  const absorbed = new Set(absorbedIds);
  const mapId = (id: string): string => absorbed.has(id) ? targetId : id;
  const sourcePlans = state.manifest.plans;
  const targetSources = sourcePlans.filter((plan) => plan.planId === targetId || absorbed.has(plan.planId));
  const targetDependencies = uniq(targetSources.flatMap((plan) => plan.dependsOnPlanIds).map(mapId).filter((id) => id !== targetId));
  const plans = sourcePlans.filter((plan) => !absorbed.has(plan.planId)).map((plan) => ({
    ...plan,
    ...(plan.planId === targetId ? { criterionIds: criteria, aspectIds: aspects, residue: targetSources.some((item) => item.residue), dependsOnPlanIds: targetDependencies } : { dependsOnPlanIds: uniq(plan.dependsOnPlanIds.map(mapId).filter((id) => id !== plan.planId)) }),
  }));
  const ownership = state.manifest.fileOwnership.map((entry) => {
    const owners = uniq(entry.ownerPlanIds.map(mapId));
    return { ...entry, ownerPlanIds: owners, consumerPlanIds: uniq(entry.consumerPlanIds.map(mapId).filter((id) => !owners.includes(id))) };
  });
  const nonDependencyContracts = state.manifest.contracts
    .filter((entry) => entry.kind !== 'plan-dependency')
    .map((entry) => mapContract(entry, mapId))
    .filter((entry): entry is PlanningArchitectureManifestContract => entry !== undefined);
  const dependencyContracts = plans.flatMap((plan) => plan.dependsOnPlanIds.map((dependency) => ({
    contractId: `plan-dependency:${plan.planId}->${dependency}:`,
    kind: 'plan-dependency' as const,
    fromPlanId: plan.planId,
    toPlanId: dependency,
    summary: `${plan.planId} depends on ${dependency}`,
  })));
  state.manifest = {
    ...state.manifest,
    plans,
    fileOwnership: ownership,
    contracts: dedupeContracts([...nonDependencyContracts, ...dependencyContracts]),
    conflicts: state.manifest.conflicts.map((entry) => ({ ...entry, planIds: uniq(entry.planIds.map(mapId)) })),
  };
  state.manifestChanged = true;
}

function validateState(state: StructuralState): void {
  const planIds = new Set(state.plans.keys());
  const orchestration = orchestrationPlans(state);
  if (orchestration.length !== planIds.size || orchestration.some((entry) => !planIds.has(String(entry.id)))) throw new Error('Structural simplification left plan files and orchestration out of sync');
  const manifestIds = new Set(state.manifest.plans.map((plan) => plan.planId));
  if (manifestIds.size !== planIds.size || [...planIds].some((id) => !manifestIds.has(id))) throw new Error('Structural simplification left plan files and architecture out of sync');
  validateDependencyGraph(orchestration);
  for (const planId of planIds) validateBuildCompatibility(planId, requireMetadata(state, planId).build, requireMetadata(state, planId));
  for (const entry of state.manifest.fileOwnership) for (const id of [...entry.ownerPlanIds, ...entry.consumerPlanIds]) requireKnownPlanId(planIds, id, `file ownership ${entry.path}`);
  for (const contract of state.manifest.contracts) {
    requireKnownPlanId(planIds, contract.fromPlanId, `contract ${contract.contractId}`);
    requireKnownPlanId(planIds, contract.toPlanId, `contract ${contract.contractId}`);
  }
  for (const conflict of state.manifest.conflicts) for (const id of conflict.planIds) requireKnownPlanId(planIds, id, `conflict ${conflict.conflictId}`);
  if (state.manifestChanged) {
    const parsed = parseArchitectureManifest(renderArchitecture(state));
    if (!parsed.manifest) throw new Error(`Structural architecture regeneration failed: ${parsed.errors.join('; ')}`);
  }
}

/**
 * Emit only artifacts a fix actually changed. Untouched plan files and
 * acceptance-coverage.md are never re-serialized: a parse/render round trip is
 * not byte-preserving, and a formatting-only rewrite would inflate the atomic
 * evaluator path group with style-only diffs the evaluator must reject —
 * deterministically failing the all-or-none verdict on the real fixes.
 */
function renderOutputs(state: StructuralState): Map<string, string | undefined> {
  const outputs = new Map<string, string | undefined>();
  outputs.set(resolve(state.planDir, 'orchestration.yaml'), stringifyYaml(state.orchestration));
  if (state.manifestChanged) outputs.set(resolve(state.planDir, 'architecture.md'), renderArchitecture(state));
  for (const planId of state.touchedPlanIds) {
    const plan = requirePlan(state, planId);
    outputs.set(resolve(state.planDir, `${plan.id}.md`), `${plan.frontmatter}\n${plan.body.trim()}\n`);
  }
  for (const planId of state.deletedPlanIds) outputs.set(resolve(state.planDir, `${planId}.md`), undefined);
  return outputs;
}

function renderArchitecture(state: StructuralState): string {
  const existing = state.architecture;
  const manifest = state.manifest;
  const summary = sectionBody(existing, '## Summary', '## Compiler status') || 'Planning boundaries were structurally simplified after compiler synthesis.';
  const compilerStatus = sectionBody(existing, '## Compiler status', '## Plan boundaries');
  const validationByPlan = mergedValidationLines(state);
  return [
    '# Planner Compiler Architecture', '', '## Summary', '', summary.trim(), '', '## Compiler status', '', compilerStatus.trim(), '',
    '## Plan boundaries', '', ...manifest.plans.flatMap((plan) => [
      `### ${plan.planId} — ${plan.title}`, '', `Criteria: ${plan.criterionIds.join(', ') || '(none)'}`, `Aspects: ${plan.aspectIds.join(', ') || '(none)'}`,
      `Depends on: ${plan.dependsOnPlanIds.join(', ') || '(none)'}`, `Residue: ${plan.residue ? 'yes' : 'no'}`,
      `Owned files: ${manifest.fileOwnership.filter((entry) => entry.ownerPlanIds.includes(plan.planId)).map((entry) => entry.path).join(', ') || '(none)'}`,
      `Validation: ${validationByPlan.get(plan.planId) ?? '(none)'}`, '',
    ]),
    '## Integration contracts', '', ...(manifest.contracts.length > 0 ? manifest.contracts.map(contractLine) : ['- (none)']), '',
    '## Shared file ownership', '', ...(manifest.fileOwnership.length > 0 ? manifest.fileOwnership.map(ownershipLine) : ['- (none)']), '',
    '## Reduce conflicts', '', ...(manifest.conflicts.length > 0 ? manifest.conflicts.map((entry) => `- ${entry.conflictId}: ${entry.title} (criteria: ${entry.criterionIds.join(', ') || 'none'}; plans: ${entry.planIds.join(', ') || 'none'})`) : ['- (none)']), '',
    '## Machine-readable manifest', '', renderArchitectureManifestFence(manifest), '',
  ].join('\n');
}

/**
 * Validation expectations exist only in architecture.md (the manifest carries
 * none), so regeneration must carry them forward from the compiler-rendered
 * boundary sections. A merge target inherits the absorbed plans' expectations.
 */
function mergedValidationLines(state: StructuralState): Map<string, string> {
  const merged = new Map<string, string[]>();
  const resolveTarget = (id: string): string => {
    let current = id;
    while (state.absorbedInto.has(current)) current = state.absorbedInto.get(current)!;
    return current;
  };
  for (const [planId, line] of parseValidationLines(state.architecture)) {
    const finalId = resolveTarget(planId);
    const lines = merged.get(finalId) ?? [];
    if (!lines.includes(line)) lines.push(line);
    merged.set(finalId, lines);
  }
  return new Map([...merged].map(([planId, lines]) => [planId, lines.filter((line) => line !== '(none)').join('; ') || '(none)']));
}

/** Deterministic parse of the compiler-rendered `### <planId> — <title>` boundary sections. */
function parseValidationLines(architecture: string): Map<string, string> {
  const section = sectionBody(architecture, '## Plan boundaries', '## Integration contracts');
  const lines = new Map<string, string>();
  let currentPlanId: string | undefined;
  for (const line of section.split('\n')) {
    if (line.startsWith('### ')) currentPlanId = line.slice(4).split(' — ')[0]?.trim();
    else if (currentPlanId && line.startsWith('Validation: ')) lines.set(currentPlanId, line.slice('Validation: '.length).trim());
  }
  return lines;
}

// --- eforge:endregion structural-artifact-regeneration ---

// --- eforge:region structural-transaction ---
async function writeTransaction(outputs: Map<string, string | undefined>): Promise<string[]> {
  const originals = new Map<string, string | undefined>();
  const tempPaths: string[] = [];
  try {
    for (const path of outputs.keys()) originals.set(path, await readOptional(path));
    for (const [path, content] of outputs) {
      if (content === undefined) continue;
      const tempPath = `${path}.structural-${randomUUID()}.tmp`;
      tempPaths.push(tempPath);
      await writeFile(tempPath, content, 'utf8');
    }
    let tempIndex = 0;
    for (const [path, content] of outputs) {
      if (content === undefined) await unlink(path);
      else await rename(tempPaths[tempIndex++], path);
    }
    return [...outputs.entries()].filter(([path, content]) => originals.get(path) !== content).map(([path]) => path);
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const [path, content] of originals) {
      try { if (content === undefined) await unlink(path); else await writeFile(path, content, 'utf8'); } catch (restoreError) {
        if (content === undefined && (restoreError as NodeJS.ErrnoException).code === 'ENOENT') continue; // never-written file is already absent
        rollbackFailures.push(`${path} (${(restoreError as Error).message})`);
      }
    }
    if (rollbackFailures.length > 0) throw new Error(`${(error as Error).message}; rollback additionally failed to restore: ${rollbackFailures.join(', ')}`, { cause: error });
    throw error;
  } finally {
    for (const path of tempPaths) try { await unlink(path); } catch { /* already renamed or absent */ }
  }
}

// --- eforge:endregion structural-transaction ---

// --- eforge:region structural-invariants-and-rendering ---
function mergedPlanBody(title: string, plans: PlanDocument[], criteria: string[], aspects: string[], metadata: StructuralMetadata, rationale: string): string {
  const sections = plans.map((plan) => `### ${plan.name}\n\n${stripManagedSections(plan.body).trim()}`);
  return [`# ${title}`, '', `Merged cohesive scopes: ${plans.map((plan) => plan.id).join(', ')}.`, '', `Rationale: ${singleLine(rationale)}`, '', '## Traceability', '', `Criteria: ${criteria.join(', ')}`, `Aspects: ${aspects.join(', ')}`, '', '## Merged scope', '', ...sections, '', executionIntent(metadata)].join('\n');
}

function rewriteExecutionIntent(plan: PlanDocument, metadata: StructuralMetadata): void {
  plan.body = `${stripSection(plan.body, '## Execution Intent').trim()}\n\n${executionIntent(metadata)}`;
}
function executionIntent(metadata: StructuralMetadata): string { return ['## Execution Intent', '', `Test ownership: ${metadata.testOwnership}`, `Review depth: ${metadata.reviewDepth}`, `Review rationale: structural simplification preserved deterministic floor ${metadata.reviewFloor}`].join('\n'); }
function stripManagedSections(body: string): string { return stripSection(stripSection(body, '## Traceability'), '## Execution Intent').replace(/^# .+\n+/, ''); }
function stripSection(body: string, heading: string): string { const lines = body.split('\n'); const start = lines.findIndex((line) => line.trim() === heading); if (start < 0) return body; let end = lines.length; for (let i = start + 1; i < lines.length; i += 1) if (lines[i].startsWith('## ')) { end = i; break; } return [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n'); }

function validateMergedBudget(planId: string, usage: StructuralMetadata['budgetUsage'], limits: PlanningDecompositionLimits): void {
  if (usage.sourceContextBytes > limits.maxPromptSourceBytes) throw new Error(`Merged plan source context budget exceeded:${planId}:${usage.sourceContextBytes}>${limits.maxPromptSourceBytes}`);
  if (usage.criterionCount > limits.maxCriteriaPerUnit) throw new Error(`Merged plan criterion budget exceeded:${planId}:${usage.criterionCount}>${limits.maxCriteriaPerUnit}`);
  if (usage.subsystemCount > limits.maxSubsystemsPerUnit) throw new Error(`Merged plan subsystem budget exceeded:${planId}:${usage.subsystemCount}>${limits.maxSubsystemsPerUnit}`);
}
function mergedRiskFactors(metadata: StructuralMetadata[], usage: StructuralMetadata['budgetUsage']): PlanPipelineRiskFactor[] { const factors = new Set(metadata.flatMap((item) => item.riskFactors)); factors.delete('dependency-root'); if (usage.sourceContextBytes >= LARGE_PLAN_SOURCE_BYTES) factors.add('large-plan'); if (usage.subsystemCount >= MULTI_SUBSYSTEM_COUNT) factors.add('multi-subsystem'); return [...factors].sort(); }
function riskScore(factors: PlanPipelineRiskFactor[]): number { return factors.reduce((total, factor) => total + FACTOR_WEIGHTS[factor], 0); }
function strongestDocs(values: PlanningModuleDocsWork[]): PlanningModuleDocsWork { return strongest(values, ['none', 'sync-existing', 'author-new']); }
function strongestTests(values: PlanningModuleTestWork[]): PlanningModuleTestWork { return strongest(values, ['none', 'exercise-existing', 'author-new']); }
function strongest<T extends string>(values: T[], order: readonly T[]): T { return [...values].sort((a, b) => order.indexOf(b) - order.indexOf(a))[0]; }
function mergedTestOwnership(metadata: StructuralMetadata[], testWork: PlanningModuleTestWork): PlanningModuleTestOwnership { const authorOwners = uniq(metadata.filter((item) => item.testWork === 'author-new').map((item) => item.testOwnership)); if (authorOwners.length > 1) throw new Error(`Cannot merge plans with conflicting test authors: ${authorOwners.join(',')}`); if (authorOwners.length === 1) return authorOwners[0] as PlanningModuleTestOwnership; const active = uniq(metadata.map((item) => item.testOwnership).filter((owner) => owner !== 'existing-only')); if (active.length > 1) throw new Error(`Cannot merge plans with conflicting test ownership: ${active.join(',')}`); if (testWork === 'author-new' && active.length === 0) throw new Error('Cannot merge author-new test work without a test author'); return (active[0] as PlanningModuleTestOwnership | undefined) ?? 'existing-only'; }
function canonicalBuild(docs: PlanningModuleDocsWork, tests: PlanningModuleTestWork, owner: PlanningModuleTestOwnership, floor: PlanningModuleReviewDepth, preserveTestCycle: boolean): BuildStageSpec[] { return deriveBuildStages(docs, tests, owner, preserveTestCycle || floor === 'heavy'); }
function validateBuildCompatibility(planId: string, build: BuildStageSpec[], metadata: StructuralMetadata): void { const stages = flattened(build); const count = (stage: string) => stages.filter((item) => item === stage).length; if (count('implement') !== 1 || count('review-cycle') !== 1) throw new Error(`Structural pipeline requires one implement and review-cycle:${planId}`); if (metadata.testOwnership === 'test-writer' ? count('test-write') !== 1 : count('test-write') !== 0) throw new Error(`Structural pipeline test ownership incompatible:${planId}`); if (metadata.docsWork === 'author-new' && (count('doc-author') !== 1 || count('doc-sync') !== 1)) throw new Error(`Structural pipeline docs authoring incompatible:${planId}`); if (metadata.docsWork === 'sync-existing' && (count('doc-author') !== 0 || count('doc-sync') !== 1)) throw new Error(`Structural pipeline docs sync incompatible:${planId}`); if (metadata.docsWork === 'none' && (count('doc-author') !== 0 || count('doc-sync') !== 0)) throw new Error(`Structural pipeline unexpected docs stage:${planId}`); if ((metadata.testWork !== 'none' || metadata.reviewFloor === 'heavy') && count('test-cycle') !== 1) throw new Error(`Structural pipeline requires test-cycle:${planId}`); }
function removeStage(build: BuildStageSpec[], stage: string): BuildStageSpec[] { return build.flatMap((entry): BuildStageSpec[] => { if (!Array.isArray(entry)) return entry === stage ? [] : [entry]; const retained = entry.filter((item) => item !== stage); return retained.length === 0 ? [] : retained.length === 1 ? [retained[0]] : [retained]; }); }

function mapContract(entry: PlanningArchitectureManifestContract, mapId: (id: string) => string): PlanningArchitectureManifestContract | undefined { const fromPlanId = mapId(entry.fromPlanId); const toPlanId = mapId(entry.toPlanId); if (fromPlanId === toPlanId) return undefined; const suffix = entry.interfaceKey ?? entry.path ?? ''; return { ...entry, contractId: `${entry.kind}:${fromPlanId}->${toPlanId}:${suffix}`, fromPlanId, toPlanId }; }
function dedupeContracts(contracts: PlanningArchitectureManifestContract[]): PlanningArchitectureManifestContract[] { return [...new Map(contracts.map((entry) => [entry.contractId, entry])).values()].sort((a, b) => a.contractId.localeCompare(b.contractId)); }
function contractLine(entry: PlanningArchitectureManifestContract): string { const via = entry.kind === 'interface' ? `interface ${entry.interfaceKey}` : entry.kind === 'shared-file' ? `shared file ${entry.path}` : 'plan dependency'; return `- ${entry.fromPlanId} -> ${entry.toPlanId} (${via})${entry.summary ? `: ${entry.summary}` : ''}`; }
function ownershipLine(entry: PlanningArchitectureManifest['fileOwnership'][number]): string { const consumers = entry.consumerPlanIds.length > 0 ? `; consumers ${entry.consumerPlanIds.join(', ')}` : ''; return `- ${entry.path}: owner ${entry.ownerPlanIds.join(', ') || '(none)'}${consumers}${entry.reason ? ` (${entry.reason})` : ''}`; }
function updateOrchestrationPlan(state: StructuralState, planId: string, update: { build?: BuildStageSpec[]; review?: ReviewProfileConfig }): void { const entry = orchestrationPlans(state).find((plan) => plan.id === planId); if (!entry) throw new Error(`Orchestration plan not found: ${planId}`); if (update.build) entry.build = cloneBuild(update.build); if (update.review) entry.review = { ...update.review, perspectives: [...update.review.perspectives] }; }
function orchestrationPlans(state: StructuralState): Record<string, unknown>[] { if (!Array.isArray(state.orchestration.plans) || state.orchestration.plans.some((entry) => !isRecord(entry))) throw new Error('Invalid orchestration plans'); return state.orchestration.plans as Record<string, unknown>[]; }
function dependenciesOf(entry: Record<string, unknown>): string[] { return Array.isArray(entry.depends_on) ? entry.depends_on.filter((item): item is string => typeof item === 'string') : []; }
function validateDependencyGraph(plans: Record<string, unknown>[]): void { const deps = new Map(plans.map((entry) => [String(entry.id), dependenciesOf(entry)])); const state = new Map<string, 'visiting' | 'visited'>(); const visit = (id: string): void => { if (state.get(id) === 'visited') return; if (state.get(id) === 'visiting') throw new Error(`Structural simplification created dependency cycle at ${id}`); state.set(id, 'visiting'); for (const dep of deps.get(id) ?? []) { if (!deps.has(dep)) throw new Error(`Structural simplification created missing dependency ${id}->${dep}`); visit(dep); } state.set(id, 'visited'); }; for (const id of deps.keys()) visit(id); }
function ensureNoDiagnosticRepresentationReferences(diagnostics: CompilerDiagnostics, absorbed: string[]): void { const ids = new Set(absorbed); for (const gap of diagnostics.reduce.gaps) if (gap.representedByCandidateId && ids.has(gap.representedByCandidateId)) throw new Error(`Cannot absorb diagnostic representation plan: ${gap.representedByCandidateId}`); for (const conflict of diagnostics.reduce.conflicts) if (conflict.representedByCandidateId && ids.has(conflict.representedByCandidateId)) throw new Error(`Cannot absorb diagnostic conflict plan: ${conflict.representedByCandidateId}`); }
function parsePlanDocument(raw: string, expectedId: string): PlanDocument { const match = raw.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/); if (!match) throw new Error(`Invalid plan file format: ${expectedId}`); const frontmatterValue: unknown = parseYaml(match[1].replace(/^---\n|\n---\n?$/g, '')); if (!isRecord(frontmatterValue) || frontmatterValue.id !== expectedId || typeof frontmatterValue.name !== 'string') throw new Error(`Plan frontmatter mismatch: ${expectedId}`); return { id: expectedId, name: frontmatterValue.name, frontmatter: match[1], body: match[2].trim() }; }
// Ids interpolated below are model-supplied and unresolved, so they are JSON-escaped
// to keep newlines/control characters out of planning error events and session logs.
function requirePlan(state: StructuralState, id: string): PlanDocument { const value = state.plans.get(id); if (!value) throw new Error(`Plan not found: ${JSON.stringify(id)}`); return value; }
function requireMetadata(state: StructuralState, id: string): StructuralMetadata { const value = state.metadata.get(id); if (!value) throw new Error(`Normalization diagnostics not found for plan: ${JSON.stringify(id)}`); return value; }
function requireManifestPlan(state: StructuralState, id: string): PlanningArchitectureManifest['plans'][number] { const value = state.manifest.plans.find((plan) => plan.planId === id); if (!value) throw new Error(`Architecture manifest plan not found: ${JSON.stringify(id)}`); return value; }
function validatePlanId(id: string): void { if (!/^[A-Za-z0-9_-]+$/.test(id) || id.includes('..')) throw new Error(`Invalid structural plan id: ${JSON.stringify(id)}`); }
function requireKnownPlanId(planIds: Set<string>, id: string, source: string): void { if (!planIds.has(id)) throw new Error(`Structural simplification left unknown plan ${id} in ${source}`); }
function sectionBody(markdown: string, start: string, end: string): string { const startIndex = markdown.indexOf(start); if (startIndex < 0) return ''; const bodyStart = startIndex + start.length; const endIndex = markdown.indexOf(end, bodyStart); return markdown.slice(bodyStart, endIndex < 0 ? markdown.length : endIndex).trim(); }
function flattened(build: BuildStageSpec[]): string[] { return build.flatMap((entry) => Array.isArray(entry) ? entry : [entry]); }
function cloneBuild(build: BuildStageSpec[]): BuildStageSpec[] { return build.map((entry) => Array.isArray(entry) ? [...entry] : entry); }
function deepestDepth(...values: PlanningModuleReviewDepth[]): PlanningModuleReviewDepth { return [...values].sort((a, b) => depthRank(b) - depthRank(a))[0]; }
function depthRank(value: PlanningModuleReviewDepth): number { return { light: 0, standard: 1, heavy: 2 }[value]; }
function uniq(values: string[]): string[] { return [...new Set(values)].sort(); }
function singleLine(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function readOptional(path: string): Promise<string | undefined> { try { return await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; } }
// --- eforge:endregion structural-invariants-and-rendering ---
