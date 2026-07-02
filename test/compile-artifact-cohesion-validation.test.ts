import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { validateCompileArtifacts } from '@eforge-build/engine/compile-resilience/artifact-validation';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import type { PipelineContext } from '@eforge-build/engine/pipeline';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import {
  buildCompilerDiagnostics,
  buildPlanningAtomTasks,
  derivePlanningAspectCoverage,
  derivePlanningAtomGraph,
  deriveSharedPlanningBrief,
  deriveSourceInventory,
  parseArchitectureManifest,
  renderArchitectureManifestFence,
  synthesizePlanningArtifacts,
  writePlanningCompilerArtifacts,
  type BoundedPlannerCompilerResult,
  type CompilerDiagnostics,
  type CompilerDiagnosticsGap,
  type PlanningArchitectureManifest,
  type PlanningAtomMapResult,
  type PlanningAtomOutput,
  type PlanningAtomTask,
  type PlanningReduceOutput,
  type PlanningReduceResult,
  type SharedPlanningBrief,
} from '@eforge-build/engine/planner-compiler';
import { makePipelineCtx } from './pipeline-helpers.js';
import { useTempDir } from './test-tmpdir.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');
const SHARED_PATH = 'packages/engine/src/shared.ts';
const PIPELINE: PipelineComposition = { scope: 'excursion', compile: ['planner'], defaultBuild: ['implement'], defaultReview: DEFAULT_REVIEW, rationale: 'cohesion validation test' };

describe('compile artifact cohesion validation', () => {
  const tempDir = useTempDir('eforge-cohesion-validation-');

  it('accepts a valid compiler plan set with and without required compiler artifacts', async () => {
    const ctx = await writeCompilerSet(tempDir());

    await expect(validateCompileArtifacts(ctx)).resolves.toMatchObject({ ok: true });
    await expect(validateCompileArtifacts(ctx, { compilerArtifacts: 'require' })).resolves.toMatchObject({ ok: true });
  });

  it('fails deterministically when two plans claim the same file without a declared dependency', async () => {
    const ctx = await writeCompilerSet(tempDir(), { dependency: false });
    await rewriteManifest(ctx, (manifest) => ({
      ...manifest,
      fileOwnership: manifest.fileOwnership.map((entry) => entry.path === SHARED_PATH ? { ...entry, ownerPlanIds: ['module-a', 'module-b'], consumerPlanIds: [] } : entry),
    }));

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    const message = result.ok ? '' : result.message;
    expect(message).toContain(`file ownership conflict: ${SHARED_PATH} claimed by module-a and module-b without a declared dependency`);
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThanOrEqual(4_096);
  });

  it('allows shared file ownership between plans connected by a declared dependency', async () => {
    const ctx = await writeCompilerSet(tempDir());
    await rewriteManifest(ctx, (manifest) => ({
      ...manifest,
      fileOwnership: manifest.fileOwnership.map((entry) => entry.path === SHARED_PATH ? { ...entry, ownerPlanIds: ['module-a', 'module-b'], consumerPlanIds: [] } : entry),
    }));

    await expect(validateCompileArtifacts(ctx)).resolves.toMatchObject({ ok: true });
  });

  it('fails when the architecture manifest and orchestration disagree on plans or dependencies', async () => {
    const missingPlanCtx = await writeCompilerSet(tempDir(), { planSetName: 'cohesion-missing-plan' });
    await rewriteManifest(missingPlanCtx, (manifest) => ({ ...manifest, plans: manifest.plans.filter((plan) => plan.planId !== 'module-b') }));
    const missingPlan = await validateCompileArtifacts(missingPlanCtx);
    expect(missingPlan.ok).toBe(false);
    expect(missingPlan.ok ? '' : missingPlan.message).toContain('orchestration plan missing from architecture manifest: module-b');

    const ghostPlanCtx = await writeCompilerSet(tempDir(), { planSetName: 'cohesion-ghost-plan' });
    await rewriteManifest(ghostPlanCtx, (manifest) => ({ ...manifest, plans: [...manifest.plans, { ...manifest.plans[0], planId: 'module-ghost' }] }));
    const ghostPlan = await validateCompileArtifacts(ghostPlanCtx);
    expect(ghostPlan.ok).toBe(false);
    expect(ghostPlan.ok ? '' : ghostPlan.message).toContain('architecture manifest plan missing from orchestration: module-ghost');

    const dependencyCtx = await writeCompilerSet(tempDir(), { planSetName: 'cohesion-dependency' });
    await rewriteManifest(dependencyCtx, (manifest) => ({ ...manifest, plans: manifest.plans.map((plan) => plan.planId === 'module-b' ? { ...plan, dependsOnPlanIds: [] } : plan) }));
    const dependency = await validateCompileArtifacts(dependencyCtx);
    expect(dependency.ok).toBe(false);
    expect(dependency.ok ? '' : dependency.message).toContain('plan dependency mismatch for module-b');
  });

  it('accepts a redundant transitive dependency edge (literal manifest vs parse-reduced orchestration)', async () => {
    // module-c declares [module-a, module-b] while module-b -> module-a. The
    // on-disk orchestration.yaml carries the same literal list, but
    // parseOrchestrationConfig transitively reduces it to [module-b] at read
    // time. Closures agree, so cohesion validation must pass.
    const ctx = await writeCompilerSet(tempDir(), { chain: true, planSetName: 'cohesion-transitive' });

    const architecture = await readFile(resolve(planDir(ctx), 'architecture.md'), 'utf8');
    const parsed = parseArchitectureManifest(architecture);
    expect(parsed.manifest?.plans.find((plan) => plan.planId === 'module-c')?.dependsOnPlanIds).toEqual(['module-a', 'module-b']);

    await expect(validateCompileArtifacts(ctx)).resolves.toMatchObject({ ok: true });
    await expect(validateCompileArtifacts(ctx, { compilerArtifacts: 'require' })).resolves.toMatchObject({ ok: true });
  });

  it('still fails when dependency closures genuinely disagree', async () => {
    const ctx = await writeCompilerSet(tempDir(), { chain: true, planSetName: 'cohesion-closure-mismatch' });
    await rewriteManifest(ctx, (manifest) => ({ ...manifest, plans: manifest.plans.map((plan) => plan.planId === 'module-c' ? { ...plan, dependsOnPlanIds: ['module-a'] } : plan) }));

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('plan dependency mismatch for module-c');
  });

  it('fails when a plan boundary heading is missing from architecture.md', async () => {
    const ctx = await writeCompilerSet(tempDir());
    const architecturePath = resolve(planDir(ctx), 'architecture.md');
    const architecture = await readFile(architecturePath, 'utf8');
    await writeFile(architecturePath, architecture.replace('### module-a — ', '### renamed-module — '), 'utf8');

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('architecture.md missing plan boundary heading: module-a');
  });

  it('fails when acceptance coverage and plan criterion references disagree', async () => {
    const unreferencedCtx = await writeCompilerSet(tempDir(), { planSetName: 'cohesion-unreferenced' });
    const coveragePath = resolve(planDir(unreferencedCtx), 'acceptance-coverage.md');
    const coverage = await readFile(coveragePath, 'utf8');
    await writeFile(coveragePath, coverage.replace(/^Complete criteria: (.+)$/m, 'Complete criteria: $1, ac-999'), 'utf8');
    const unreferenced = await validateCompileArtifacts(unreferencedCtx);
    expect(unreferenced.ok).toBe(false);
    expect(unreferenced.ok ? '' : unreferenced.message).toContain('complete criterion not referenced by any plan: ac-999');

    const unknownCtx = await writeCompilerSet(tempDir(), { planSetName: 'cohesion-unknown' });
    const planPath = resolve(planDir(unknownCtx), 'module-a.md');
    const plan = await readFile(planPath, 'utf8');
    await writeFile(planPath, plan.replace(/^Criteria: (.+)$/m, 'Criteria: $1, ac-999'), 'utf8');
    const unknown = await validateCompileArtifacts(unknownCtx);
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? '' : unknown.message).toContain('plan module-a references criterion absent from acceptance-coverage.md: ac-999');
  });

  it('fails when compiler diagnostics record unpreserved reduce gaps', async () => {
    const unrepresentedCtx = await writeCompilerSet(tempDir(), { planSetName: 'cohesion-unrepresented' });
    await rewriteDiagnostics(unrepresentedCtx, (diagnostics) => ({
      ...diagnostics,
      reduce: { ...diagnostics.reduce, gaps: [diagnosticsGap({ gapId: 'gap-dropped', resolution: 'unrepresented' })] },
    }));
    const unrepresented = await validateCompileArtifacts(unrepresentedCtx);
    expect(unrepresented.ok).toBe(false);
    expect(unrepresented.ok ? '' : unrepresented.message).toContain('reduce gap requires representation but is unrepresented: gap-dropped');

    const ghostCtx = await writeCompilerSet(tempDir(), { planSetName: 'cohesion-ghost-candidate' });
    await rewriteDiagnostics(ghostCtx, (diagnostics) => ({
      ...diagnostics,
      reduce: { ...diagnostics.reduce, gaps: [diagnosticsGap({ gapId: 'gap-ghost', resolution: 'residue-represented', representedByCandidateId: 'plan-ghost' })] },
    }));
    const ghost = await validateCompileArtifacts(ghostCtx);
    expect(ghost.ok).toBe(false);
    expect(ghost.ok ? '' : ghost.message).toContain('reduce gap gap-ghost represented by unknown plan: plan-ghost');
  });

  it('fails when compiler diagnostics are corrupt', async () => {
    const ctx = await writeCompilerSet(tempDir());
    await writeFile(resolve(planDir(ctx), 'compiler-diagnostics.json'), '{ not json', 'utf8');

    const result = await validateCompileArtifacts(ctx);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('compiler diagnostics is not valid JSON');
  });

  it('skips cohesion checks for legacy plan sets and enforces presence only when required', async () => {
    const ctx = await writeCompilerSet(tempDir());
    await rm(resolve(planDir(ctx), 'compiler-diagnostics.json'));

    await expect(validateCompileArtifacts(ctx)).resolves.toMatchObject({ ok: true });

    const required = await validateCompileArtifacts(ctx, { compilerArtifacts: 'require' });
    expect(required.ok).toBe(false);
    expect(required.ok ? '' : required.message).toContain('missing compiler-diagnostics.json');
  });
});

function planDir(ctx: PipelineContext): string {
  return resolve(ctx.cwd, ctx.config.plan.outputDir, ctx.planSetName);
}

async function rewriteManifest(ctx: PipelineContext, mutate: (manifest: PlanningArchitectureManifest) => PlanningArchitectureManifest): Promise<void> {
  const architecturePath = resolve(planDir(ctx), 'architecture.md');
  const architecture = await readFile(architecturePath, 'utf8');
  const parsed = parseArchitectureManifest(architecture);
  if (!parsed.manifest) throw new Error(`Cannot rewrite manifest: ${parsed.errors.join('; ')}`);
  const fence = renderArchitectureManifestFence(parsed.manifest);
  await writeFile(architecturePath, architecture.replace(fence, renderArchitectureManifestFence(mutate(parsed.manifest))), 'utf8');
}

async function rewriteDiagnostics(ctx: PipelineContext, mutate: (diagnostics: CompilerDiagnostics) => CompilerDiagnostics): Promise<void> {
  const diagnosticsPath = resolve(planDir(ctx), 'compiler-diagnostics.json');
  const diagnostics = JSON.parse(await readFile(diagnosticsPath, 'utf8')) as CompilerDiagnostics;
  await writeFile(diagnosticsPath, `${JSON.stringify(mutate(diagnostics), null, 2)}\n`, 'utf8');
}

function diagnosticsGap(overrides: { gapId: string; resolution: CompilerDiagnosticsGap['resolution']; representedByCandidateId?: string }): CompilerDiagnosticsGap {
  return {
    gapId: overrides.gapId,
    title: 'Reduce gap',
    reduceNodeId: 'reduce-000-001',
    issueKind: 'generic',
    sourceLocalizationSignal: false,
    representationRequired: true,
    criterionIds: ['ac-001'],
    aspectIds: [],
    sourceNeedIds: [],
    affectedAtomIds: [],
    ownerPaths: [],
    productScopedOutputRefs: [],
    productScopedValidationRefs: [],
    description: 'Reduce gap preserved for cohesion validation.',
    resolution: overrides.resolution,
    ...(overrides.representedByCandidateId ? { representedByCandidateId: overrides.representedByCandidateId } : {}),
  };
}

async function writeCompilerSet(cwd: string, options: { dependency?: boolean; chain?: boolean; planSetName?: string } = {}): Promise<PipelineContext> {
  const planSetName = options.planSetName ?? 'cohesion-set';
  const compilerResult = multiPlanCompilerResult(options.dependency ?? true, options.chain ?? false);
  const artifacts = synthesizePlanningArtifacts({ compilerResult });
  if (artifacts.validationErrors.length > 0) throw new Error(`fixture synthesis failed: ${artifacts.validationErrors.join('; ')}`);
  await writePlanningCompilerArtifacts({ cwd, outputDir: 'eforge/plans', planSetName, baseBranch: 'main', pipeline: PIPELINE, artifacts, diagnostics: buildCompilerDiagnostics({ compilerResult, planSetName }) });
  return makePipelineCtx({ cwd, planSetName, pipeline: PIPELINE });
}

function multiPlanCompilerResult(dependency: boolean, chain: boolean): BoundedPlannerCompilerResult {
  const criteria = ['- engine updates `packages/engine/src/a.ts`.', '- docs update `packages/engine/src/b.ts`.', ...(chain ? ['- cli updates `packages/engine/src/c.ts`.'] : [])];
  const content = ['# Cohesion Validation', '', '## Acceptance Criteria', ...criteria].join('\n');
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'cohesion.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'cohesion.md', limits, inventory });
  const derivedBrief = deriveSharedPlanningBrief({ graph });
  const tasks = buildPlanningAtomTasks({ graph, inventory, sharedBrief: derivedBrief });
  const [atomA, atomB] = [tasks[0].atomId, tasks[1].atomId];
  const sharedBrief: SharedPlanningBrief = {
    ...derivedBrief,
    evidenceOwnership: [{ path: SHARED_PATH, referencedByAtomIds: [atomA, atomB], primaryAtomId: atomA, consumerAtomIds: [atomB], shared: true, reason: 'shared evidence' }],
    interfaceSummaries: [],
  };
  const atomOutputs = tasks.map((task) => completedOutput(task));
  const reduceOutput: PlanningReduceOutput = {
    nodeId: 'reduce-000-001',
    status: 'completed',
    compactSummary: 'Reduced cohesion synthesis.',
    planFragments: atomOutputs.flatMap((output) => output.planFragments ?? []),
    moduleCandidates: [
      { moduleId: 'module-a', title: 'Engine module', criterionIds: tasks[0].criterionIds, aspectIds: tasks[0].aspectIds, description: 'Implement the engine update.', validationExpectation: 'Engine checks pass.' },
      { moduleId: 'module-b', title: 'Docs module', criterionIds: tasks[1].criterionIds, aspectIds: tasks[1].aspectIds, description: 'Implement the docs update.', validationExpectation: 'Docs checks pass.', ...(dependency ? { dependsOnModuleIds: ['module-a'] } : {}) },
      // The redundant module-a edge (also reachable via module-b) exercises the
      // literal-manifest vs parse-reduced-orchestration asymmetry.
      ...(chain ? [{ moduleId: 'module-c', title: 'Cli module', criterionIds: tasks[2].criterionIds, aspectIds: tasks[2].aspectIds, description: 'Implement the cli update.', validationExpectation: 'Cli checks pass.', dependsOnModuleIds: ['module-a', 'module-b'] }] : []),
    ],
    validationStrategy: 'Run relevant checks.',
  };
  const map = mapResult({ graph, inventory }, atomOutputs);
  const reduce = reduceResult(graph.graphId, [reduceOutput]);
  return {
    sourceInventory: inventory,
    atomGraph: graph,
    sourceLocalizationBundle: { sourceHash: graph.sourceHash, graphId: graph.graphId, records: [], byAtomId: {}, diagnostics: [], limits: { maxIndexedFiles: 10_000, maxCandidateFilesPerNeed: 12, maxDirectoryExpansionFiles: 20, maxBytesPerScannedFile: 64_000, maxTotalScannedBytes: 2_000_000 }, indexDiagnostics: [] },
    sharedBrief,
    sourceEvidenceBundle: { graphId: graph.graphId, sourceHash: graph.sourceHash, records: [], byAtomId: {}, totalBytes: 0, limits: { maxFilesTotal: 40, maxFilesPerAtom: 8, maxBytesTotal: 80_000, maxBytesPerFile: 200_000, maxExcerptBytesPerFile: 8_000, maxEvidenceBytesPerAtom: 20_000 }, validationErrors: [] },
    map,
    reduce,
    residue: { graphId: graph.graphId, sourceHash: graph.sourceHash, candidates: [], coverageUpdates: [], validationErrors: [], limits: { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 } },
    repairDiagnostics: [],
    status: 'complete',
    validationErrors: [],
    events: [],
  };
}

function mapResult(data: { graph: ReturnType<typeof derivePlanningAtomGraph>; inventory: ReturnType<typeof deriveSourceInventory> }, outputs: PlanningAtomOutput[]): PlanningAtomMapResult {
  const coverage = derivePlanningAspectCoverage({ graph: data.graph, inventory: data.inventory, updates: outputs.flatMap((output) => output.aspectUpdates) });
  return { graphId: data.graph.graphId, outputs, coverage, completedAtomIds: outputs.map((output) => output.atomId), failedAtomIds: [], skippedAtomIds: [], blockedAtoms: [], readyAtomIds: [], mapComplete: coverage.incompleteCriteria.length === 0, validationErrors: [], events: [], iterations: 1, sharedFindings: [] };
}

function reduceResult(graphId: string, outputs: PlanningReduceOutput[]): PlanningReduceResult {
  const finalOutput = outputs[outputs.length - 1];
  return { graphId, ...(finalOutput ? { rootNodeId: finalOutput.nodeId, finalOutput } : {}), tree: { graphId, nodes: [], limits: { maxInputsPerReduce: 4, maxReduceDepth: 6, maxReducePromptBytes: 24_000, maxReduceSummaryBytes: 8_000 }, validationErrors: [] }, outputs, conflicts: [], gaps: [], validationErrors: [], reduceComplete: finalOutput?.status === 'completed', events: [], iterations: 1 };
}

function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }] };
}
