import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { derivePlanningAspectCoverage, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, synthesizePlanningArtifacts, synthesizePlanningResidue, type BoundedPlannerCompilerResult, type PlanningAtomMapResult, type PlanningAtomOutput, type PlanningAtomTask, type PlanningReduceResult, type PlanningReduceOutput, type PlanningResidueSynthesis, buildPlanningAtomTasks } from '@eforge-build/engine/planner-compiler';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Artifact Synthesis', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('planning artifact synthesis', () => {
  it('synthesizes canonical module plans, orchestration, and coverage markdown from reduce output', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const reduceOutput = completedReduceOutput(atomOutput);
    const compilerResult = compilerFixture(data, [atomOutput], [reduceOutput]);

    const result = synthesizePlanningArtifacts({ compilerResult });

    expect(result.validationErrors).toEqual([]);
    expect(result.architectureMarkdown).toContain('Reduced artifact synthesis.');
    expect(result.planMarkdown).toContain('module-reduce-000-001');
    expect(result.modulePlans).toEqual([expect.objectContaining({ moduleId: 'module-reduce-000-001', criterionIds: ['ac-001'], residue: false })]);
    expect(result.orchestration.modules).toEqual([{ id: 'module-reduce-000-001', dependsOn: [] }]);
    expect(result.acceptanceCoverageMarkdown).toContain('Complete criteria: ac-001');
  });

  it('uses the final reduce output instead of intermediate reduce artifacts', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const intermediateOutput = completedReduceOutput(atomOutput);
    const finalOutput: PlanningReduceOutput = {
      ...completedReduceOutput(atomOutput),
      nodeId: 'reduce-root',
      compactSummary: 'Root artifact synthesis.',
      planFragments: [{ fragmentId: 'fragment-root', title: 'Root plan', criterionIds: ['ac-001'], aspectIds: data.tasks[0].aspectIds, markdown: 'Final root plan.' }],
      moduleCandidates: [moduleCandidateFromOutput(atomOutput, 'module-root')],
    };
    const compilerResult = compilerFixture(data, [atomOutput], [intermediateOutput, finalOutput]);

    const result = synthesizePlanningArtifacts({ compilerResult });

    expect(result.validationErrors).toEqual([]);
    expect(result.modulePlans.map((module) => module.moduleId)).toEqual(['module-root']);
    expect(result.planMarkdown).toContain('Final root plan.');
    expect(result.planMarkdown).not.toContain('module-reduce-000-001');
  });

  it('adds residue candidates as explicit follow-up modules that can complete represented aspects', () => {
    const data = fixture(['engine updates `packages/engine/src/missing.ts`.']);
    const failedOutput: PlanningAtomOutput = { atomId: data.tasks[0].atomId, status: 'failed', aspectUpdates: [], error: 'source missing' };
    const map = mapResult(data, [failedOutput]);
    const residue = synthesizePlanningResidue({ graph: data.graph, coverage: map.coverage, atomOutputs: [failedOutput] });
    const compilerResult = compilerFixture(data, [failedOutput], [], residue);

    const result = synthesizePlanningArtifacts({ compilerResult });

    expect(result.validationErrors).toEqual([]);
    expect(result.modulePlans).toHaveLength(residue.candidates.length);
    expect(result.modulePlans.every((module) => module.residue)).toBe(true);
    expect(result.acceptanceCoverageMarkdown).toContain('Complete criteria: ac-001');
  });

  it('reports duplicate module IDs and invalid module dependencies', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const reduceOutput: PlanningReduceOutput = {
      ...completedReduceOutput(atomOutput),
      moduleCandidates: [
        moduleCandidate(data.tasks[0], 'module-duplicate', ['missing-module']),
        moduleCandidate(data.tasks[0], 'module-duplicate'),
      ],
    };

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, [atomOutput], [reduceOutput]) });

    expect(result.validationErrors).toEqual(['module dependency missing:module-duplicate:missing-module', 'module id duplicated:module-duplicate']);
  });

  it('blocks artifact success when required aspects remain unresolved and unrepresented', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const incompleteOutput: PlanningAtomOutput = { atomId: data.tasks[0].atomId, status: 'failed', aspectUpdates: [], error: 'planner failed' };
    const compilerResult = compilerFixture(data, [incompleteOutput], []);

    const result = synthesizePlanningArtifacts({ compilerResult });

    expect(result.validationErrors).toEqual([`unresolved criterion after artifact synthesis:ac-001:${data.tasks[0].aspectIds[0]}`]);
  });
});

function fixture(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'artifact.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'artifact.md', limits, inventory });
  const sharedBrief = deriveSharedPlanningBrief({ graph });
  const tasks = buildPlanningAtomTasks({ graph, inventory, sharedBrief });
  return { content, inventory, graph, sharedBrief, tasks };
}

function compilerFixture(data: ReturnType<typeof fixture>, atomOutputs: PlanningAtomOutput[], reduceOutputs: PlanningReduceOutput[], residue?: PlanningResidueSynthesis): BoundedPlannerCompilerResult {
  const map = mapResult(data, atomOutputs);
  const reduce = reduceResult(data.graph.graphId, reduceOutputs);
  return {
    sourceInventory: data.inventory,
    atomGraph: data.graph,
    sharedBrief: data.sharedBrief,
    sourceEvidenceBundle: { graphId: data.graph.graphId, sourceHash: data.graph.sourceHash, records: [], byAtomId: {}, totalBytes: 0, limits: { maxFilesTotal: 40, maxFilesPerAtom: 8, maxBytesTotal: 80_000, maxBytesPerFile: 200_000, maxExcerptBytesPerFile: 8_000, maxEvidenceBytesPerAtom: 20_000 }, validationErrors: [] },
    map,
    reduce,
    residue: residue ?? { graphId: data.graph.graphId, sourceHash: data.graph.sourceHash, candidates: [], coverageUpdates: [], validationErrors: [], limits: { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 } },
    status: residue && residue.candidates.length > 0 ? 'complete-with-residue' : reduce.reduceComplete && map.mapComplete ? 'complete' : 'incomplete',
    validationErrors: [],
    events: [],
  };
}

function mapResult(data: ReturnType<typeof fixture>, outputs: PlanningAtomOutput[]): PlanningAtomMapResult {
  const coverage = derivePlanningAspectCoverage({ graph: data.graph, inventory: data.inventory, updates: outputs.flatMap((output) => output.aspectUpdates) });
  return { graphId: data.graph.graphId, outputs, coverage, completedAtomIds: outputs.filter((output) => output.status === 'completed').map((output) => output.atomId), failedAtomIds: outputs.filter((output) => output.status === 'failed').map((output) => output.atomId), skippedAtomIds: [], blockedAtoms: [], readyAtomIds: [], mapComplete: coverage.incompleteCriteria.length === 0 && outputs.every((output) => output.status === 'completed'), validationErrors: [], events: [], iterations: 1, sharedFindings: [] };
}

function reduceResult(graphId: string, outputs: PlanningReduceOutput[]): PlanningReduceResult {
  const finalOutput = outputs[outputs.length - 1];
  return { graphId, ...(finalOutput ? { rootNodeId: finalOutput.nodeId, finalOutput } : {}), tree: { graphId, nodes: [], limits: { maxInputsPerReduce: 4, maxReduceDepth: 6, maxReducePromptBytes: 24_000, maxReduceSummaryBytes: 8_000 }, validationErrors: [] }, outputs, conflicts: outputs.flatMap((output) => output.conflicts ?? []), gaps: outputs.flatMap((output) => output.gaps ?? []), validationErrors: [], reduceComplete: finalOutput?.status === 'completed', events: [], iterations: outputs.length > 0 ? 1 : 0 };
}

function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }], moduleCandidates: [moduleCandidate(task, `module-${task.atomId}`)] };
}

function completedReduceOutput(output: PlanningAtomOutput): PlanningReduceOutput {
  return { nodeId: 'reduce-000-001', status: 'completed', compactSummary: 'Reduced artifact synthesis.', planFragments: output.planFragments, moduleCandidates: [moduleCandidateFromOutput(output, 'module-reduce-000-001')], validationStrategy: 'Run relevant checks.' };
}

function moduleCandidate(task: PlanningAtomTask, moduleId: string, dependsOnModuleIds: string[] = []) {
  return { moduleId, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.', ...(dependsOnModuleIds.length > 0 ? { dependsOnModuleIds } : {}) };
}

function moduleCandidateFromOutput(output: PlanningAtomOutput, moduleId: string) {
  return { moduleId, title: 'Reduced module', criterionIds: output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [], aspectIds: output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? [], description: 'Implement reduced planning work.', validationExpectation: 'Reduced checks pass.' };
}
