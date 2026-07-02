import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { DEFAULT_REVIEW } from '@eforge-build/engine/config';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import type { PipelineComposition } from '@eforge-build/engine/schemas';
import {
  buildCompilerDiagnostics,
  buildPlanningAtomTasks,
  derivePlanningAspectCoverage,
  derivePlanningAtomGraph,
  deriveSharedPlanningBrief,
  deriveSourceInventory,
  parseArchitectureManifest,
  synthesizePlanningArtifacts,
  writePlanningCompilerArtifacts,
  type BoundedPlannerCompilerResult,
  type PlanningAtomMapResult,
  type PlanningAtomOutput,
  type PlanningAtomTask,
  type PlanningReduceOutput,
  type PlanningReduceResult,
  type PlanningResidueSynthesis,
  type SharedPlanningBrief,
} from '@eforge-build/engine/planner-compiler';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');
const SHARED_PATH = 'packages/engine/src/shared.ts';

function prd(criteria: string[]): string {
  return ['# Architecture Synthesis', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('planning architecture synthesis', () => {
  it('lists plan boundaries, integration contracts, and file ownership for a multi-plan compile', () => {
    const data = multiPlanFixture();
    const result = synthesizePlanningArtifacts({ compilerResult: data.compilerResult });

    expect(result.validationErrors).toEqual([]);
    expect(result.architectureMarkdown).toContain('### module-a — ');
    expect(result.architectureMarkdown).toContain('### module-b — ');
    expect(result.architectureMarkdown).toContain('Depends on: module-a');
    expect(result.architectureMarkdown).toContain('- module-b -> module-a (plan dependency)');
    expect(result.architectureMarkdown).toContain('- module-b -> module-a (interface EngineApi)');
    expect(result.architectureMarkdown).toContain(`- module-b -> module-a (shared file ${SHARED_PATH})`);
    expect(result.architectureMarkdown).toContain(`- ${SHARED_PATH}: owner module-a; consumers module-b`);
    expect(result.architectureMarkdown).toContain('Compiler status: complete');
    expect(result.architectureMarkdown).toContain(`Source hash: ${data.compilerResult.sourceInventory.sourceHash}`);

    const manifest = result.architectureManifest;
    expect(manifest.plans.map((plan) => plan.planId)).toEqual(['module-a', 'module-b']);
    expect(manifest.plans[1].dependsOnPlanIds).toEqual(['module-a']);
    expect(manifest.fileOwnership).toEqual([{ path: SHARED_PATH, ownerPlanIds: ['module-a'], consumerPlanIds: ['module-b'], shared: true, reason: 'shared evidence' }]);
    expect(manifest.contracts.map((contract) => contract.kind).sort()).toEqual(['interface', 'plan-dependency', 'shared-file']);
    expect(manifest.plans.map((plan) => ({ id: plan.planId, dependsOn: plan.dependsOnPlanIds }))).toEqual(result.orchestration.modules.map((module) => ({ id: module.id, dependsOn: module.dependsOn })));

    const parsed = parseArchitectureManifest(result.architectureMarkdown);
    expect(parsed.errors).toEqual([]);
    expect(parsed.manifest).toEqual(manifest);
  });

  it('marks residue plans as boundaries and registers their localized owner paths', () => {
    const data = multiPlanFixture();
    const residuePath = 'packages/engine/src/residue-owner.ts';
    const residue: PlanningResidueSynthesis = {
      ...emptyResidue(data.compilerResult),
      candidates: [{
        candidateId: 'candidate-reduce-gap-owner',
        kind: 'residue',
        reason: 'reduce-gap',
        title: 'Follow up localized owner',
        criterionIds: ['ac-002'],
        aspectIds: data.tasks[1].aspectIds,
        scope: 'Resolve the localized owner gap in the engine module.',
        expectedOutputs: ['Localized owner gap resolved.'],
        validationExpectations: ['Validation criteria ac-002 passes.'],
        rationale: 'Reducer surfaced a localized owner gap.',
        buildability: 'buildable',
        localizedOwnerPaths: [residuePath],
      }],
      coverageUpdates: [],
    };
    const compilerResult: BoundedPlannerCompilerResult = { ...data.compilerResult, residue, status: 'complete-with-residue' };

    const result = synthesizePlanningArtifacts({ compilerResult });

    const boundary = result.architectureMarkdown.slice(result.architectureMarkdown.indexOf('### candidate-reduce-gap-owner'));
    expect(boundary).toContain('Residue: yes');
    expect(result.architectureManifest.fileOwnership).toContainEqual({ path: residuePath, ownerPlanIds: ['candidate-reduce-gap-owner'], consumerPlanIds: [], shared: false, reason: 'residue localized owner' });
  });

  it('surfaces reduce conflicts with the plans they touch', () => {
    const data = multiPlanFixture({ conflicts: [{ conflictId: 'conflict-shared', title: 'Both plans mutate shared module', criterionIds: ['ac-001', 'ac-002'], aspectIds: [...data0AspectIds(), ...data1AspectIds()], description: 'Both plans touch the shared engine module.' }] });

    const result = synthesizePlanningArtifacts({ compilerResult: data.compilerResult });

    expect(result.architectureMarkdown).toContain('- conflict-shared: Both plans mutate shared module');
    expect(result.architectureManifest.conflicts).toEqual([{ conflictId: 'conflict-shared', title: 'Both plans mutate shared module', criterionIds: ['ac-001', 'ac-002'], planIds: ['module-a', 'module-b'] }]);
  });

  it('writes architecture.md whose manifest agrees with orchestration.yaml and the plan files on disk', async () => {
    const data = multiPlanFixture();
    const artifacts = synthesizePlanningArtifacts({ compilerResult: data.compilerResult });
    const pipeline: PipelineComposition = { scope: 'excursion', compile: ['planner'], defaultBuild: ['implement'], defaultReview: DEFAULT_REVIEW, rationale: 'architecture consistency test' };
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'eforge-architecture-'));

    const written = await writePlanningCompilerArtifacts({ cwd, outputDir: 'eforge/plans', planSetName: 'arch-set', baseBranch: 'main', pipeline, artifacts, diagnostics: buildCompilerDiagnostics({ compilerResult: data.compilerResult, planSetName: 'arch-set' }) });

    const architecture = await readFile(path.join(cwd, 'eforge/plans/arch-set/architecture.md'), 'utf8');
    const parsed = parseArchitectureManifest(architecture);
    expect(parsed.errors).toEqual([]);
    const manifest = parsed.manifest!;
    const orchestration = await parseOrchestrationConfig(path.join(cwd, 'eforge/plans/arch-set/orchestration.yaml'));
    expect(manifest.plans.map((plan) => plan.planId)).toEqual(orchestration.plans.map((plan) => plan.id));
    expect(manifest.plans.map((plan) => plan.dependsOnPlanIds)).toEqual(orchestration.plans.map((plan) => plan.dependsOn ?? []));
    for (const plan of manifest.plans) {
      expect(architecture).toContain(`### ${plan.planId} — `);
      const planFile = written.plans.find((candidate) => candidate.id === plan.planId);
      expect(planFile, `plan file for ${plan.planId}`).toBeDefined();
    }
    expect(written.artifactPaths).toContain('compiler-diagnostics.json');
  });
});

function data0AspectIds(): string[] { return multiPlanFixture().tasks[0].aspectIds; }
function data1AspectIds(): string[] { return multiPlanFixture().tasks[1].aspectIds; }

function multiPlanFixture(options: { conflicts?: PlanningReduceOutput['conflicts'] } = {}) {
  const content = prd(['engine updates `packages/engine/src/a.ts`.', 'docs update `packages/engine/src/b.ts`.']);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'architecture.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'architecture.md', limits, inventory });
  const derivedBrief = deriveSharedPlanningBrief({ graph });
  const tasks = buildPlanningAtomTasks({ graph, inventory, sharedBrief: derivedBrief });
  const [atomA, atomB] = [tasks[0].atomId, tasks[1].atomId];
  const sharedBrief: SharedPlanningBrief = {
    ...derivedBrief,
    evidenceOwnership: [{ path: SHARED_PATH, referencedByAtomIds: [atomA, atomB], primaryAtomId: atomA, consumerAtomIds: [atomB], shared: true, reason: 'shared evidence' }],
    interfaceSummaries: [{ key: 'EngineApi', atomIds: [atomA, atomB], primaryAtomId: atomA, consumerAtomIds: [atomB], summary: 'Engine API consumed across plans.' }],
  };
  const atomOutputs = tasks.map((task) => completedOutput(task));
  const reduceOutput: PlanningReduceOutput = {
    nodeId: 'reduce-000-001',
    status: 'completed',
    compactSummary: 'Reduced architecture synthesis.',
    planFragments: atomOutputs.flatMap((output) => output.planFragments ?? []),
    moduleCandidates: [
      { moduleId: 'module-a', title: 'Engine module', criterionIds: tasks[0].criterionIds, aspectIds: tasks[0].aspectIds, description: 'Implement the engine update.', validationExpectation: 'Engine checks pass.' },
      { moduleId: 'module-b', title: 'Docs module', criterionIds: tasks[1].criterionIds, aspectIds: tasks[1].aspectIds, description: 'Implement the docs update.', validationExpectation: 'Docs checks pass.', dependsOnModuleIds: ['module-a'] },
    ],
    validationStrategy: 'Run relevant checks.',
    ...(options.conflicts ? { conflicts: options.conflicts } : {}),
  };
  const map = mapResult({ graph, inventory }, atomOutputs);
  const reduce = reduceResult(graph.graphId, [reduceOutput]);
  const compilerResult: BoundedPlannerCompilerResult = {
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
  return { compilerResult, tasks };
}

function emptyResidue(result: BoundedPlannerCompilerResult): PlanningResidueSynthesis {
  return { graphId: result.atomGraph.graphId, sourceHash: result.atomGraph.sourceHash, candidates: [], coverageUpdates: [], validationErrors: [], limits: { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 } };
}

function mapResult(data: { graph: ReturnType<typeof derivePlanningAtomGraph>; inventory: ReturnType<typeof deriveSourceInventory> }, outputs: PlanningAtomOutput[]): PlanningAtomMapResult {
  const coverage = derivePlanningAspectCoverage({ graph: data.graph, inventory: data.inventory, updates: outputs.flatMap((output) => output.aspectUpdates) });
  return { graphId: data.graph.graphId, outputs, coverage, completedAtomIds: outputs.filter((output) => output.status === 'completed').map((output) => output.atomId), failedAtomIds: [], skippedAtomIds: [], blockedAtoms: [], readyAtomIds: [], mapComplete: coverage.incompleteCriteria.length === 0, validationErrors: [], events: [], iterations: 1, sharedFindings: [] };
}

function reduceResult(graphId: string, outputs: PlanningReduceOutput[]): PlanningReduceResult {
  const finalOutput = outputs[outputs.length - 1];
  return { graphId, ...(finalOutput ? { rootNodeId: finalOutput.nodeId, finalOutput } : {}), tree: { graphId, nodes: [], limits: { maxInputsPerReduce: 4, maxReduceDepth: 6, maxReducePromptBytes: 24_000, maxReduceSummaryBytes: 8_000 }, validationErrors: [] }, outputs, conflicts: outputs.flatMap((output) => output.conflicts ?? []), gaps: outputs.flatMap((output) => output.gaps ?? []), validationErrors: [], reduceComplete: finalOutput?.status === 'completed', events: [], iterations: 1 };
}

function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }] };
}
