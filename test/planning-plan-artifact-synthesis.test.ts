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
    expect(result.orchestration.modules).toEqual([{
      id: 'module-reduce-000-001',
      dependsOn: [],
      build: ['implement', 'review-cycle'],
      review: { strategy: expect.any(String), perspectives: expect.any(Array), maxRounds: expect.any(Number), evaluatorStrictness: expect.any(String) },
    }]);
    expect(result.pipelineDefaults.defaultBuild).toEqual(['implement', 'review-cycle']);
    expect(result.pipelineDefaults.rationale).toContain('module-reduce-000-001');
    expect(result.acceptanceCoverageMarkdown).toContain('Complete criteria: ac-001');
  });

  it('normalizes typed docs, test ownership, and review intent from module candidates', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const reduceOutput = completedReduceOutput(atomOutput);
    reduceOutput.moduleCandidates = reduceOutput.moduleCandidates?.map((module) => ({ ...module, docsWork: 'author-new' as const, testWork: 'author-new' as const, testOwnership: 'test-writer' as const, reviewDepth: 'light' as const, reviewRationale: 'Small localized module.' }));

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, [atomOutput], [reduceOutput]) });

    expect(result.orchestration.modules[0]?.build).toEqual([['implement', 'doc-author'], 'doc-sync', 'test-write', 'test-cycle', 'review-cycle']);
    expect(result.modulePlans[0]).toMatchObject({ docsWork: 'author-new', testOwnership: 'test-writer', reviewDepth: 'light', reviewRationale: 'Small localized module.' });
    expect(result.modulePlans[0]?.markdown).toContain('Test ownership: test-writer');
    expect(result.modulePlans[0]?.pipelineRationale).toContain('model review intent light');
  });

  it('derives heavier review settings for residue modules than for trivial modules', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const reduceOutput = completedReduceOutput(atomOutput);
    const residue: PlanningResidueSynthesis = {
      graphId: data.graph.graphId,
      sourceHash: data.graph.sourceHash,
      candidates: [{
        candidateId: 'candidate-follow-up-docs',
        kind: 'follow-up',
        reason: 'pending-aspect',
        title: 'Follow-up docs work',
        criterionIds: ['ac-001'],
        aspectIds: data.tasks[0].aspectIds,
        scope: 'Follow-up scope.',
        expectedOutputs: ['Docs updated.'],
        validationExpectations: ['Docs checks pass.'],
        rationale: 'Deferred docs work.',
        buildability: 'repair-only',
      }],
      coverageUpdates: [],
      validationErrors: [],
      limits: { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 },
    };

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, [atomOutput], [reduceOutput], residue) });

    const residueModule = result.modulePlans.find((module) => module.residue);
    const trivialModule = result.modulePlans.find((module) => !module.residue);
    expect(residueModule?.review).not.toEqual(trivialModule?.review);
    expect(residueModule?.review.evaluatorStrictness).toBe('strict');
    expect(residueModule?.pipelineRationale).toContain('residue-derived');
    expect(residueModule?.docsWork).toBe('none');
    expect(residueModule?.build).toEqual(['implement', 'test-cycle', 'review-cycle']);
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

  it('accepts generic reduce-gap residue whose prose mentions source/localization only negatively', () => {
    // Regression for the gap-supertest-availability compile failure: a generic
    // follow-up whose scope disclaims "not a source/localization defect" must not
    // be re-classified as source/localization residue from its markdown prose.
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const candidateId = 'candidate-reduce-gap-supertest-availability';
    const residue: PlanningResidueSynthesis = {
      graphId: data.graph.graphId,
      sourceHash: data.graph.sourceHash,
      candidates: [{
        candidateId,
        kind: 'follow-up',
        reason: 'reduce-gap',
        title: 'supertest devDependency not confirmed for HTTP-level route tests',
        criterionIds: ['ac-001'],
        aspectIds: data.tasks[0].aspectIds,
        scope: 'Represent reduce gap gap-supertest-availability: this is a test-tooling availability concern, not a source/localization defect: ownerPaths and productScoped refs are not determinable from the digest.',
        expectedOutputs: ['A bounded module resolves or explicitly represents the reduce gap.'],
        validationExpectations: ['Validation confirms the gap is addressed in the final plan set or represented follow-up work.'],
        rationale: 'Reduce node reduce-root reported gap gap-supertest-availability.',
      }],
      coverageUpdates: data.tasks[0].aspectIds.map((aspectId) => ({ aspectId, status: 'represented' as const, representation: { kind: 'follow-up' as const, moduleId: candidateId, reason: 'informational gap follow-up', validationExpectation: 'Validation confirms the represented follow-up work.' } })),
      validationErrors: [],
      limits: { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 },
    };

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, [], [], residue) });

    expect(result.validationErrors).toEqual([]);
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

  it('rejects cyclic module dependencies', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const reduceOutput: PlanningReduceOutput = {
      ...completedReduceOutput(atomOutput),
      moduleCandidates: [
        moduleCandidate(data.tasks[0], 'module-a', ['module-b']),
        moduleCandidate(data.tasks[0], 'module-b', ['module-a']),
      ],
    };

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, [atomOutput], [reduceOutput]) });

    expect(result.validationErrors).toEqual(['module dependency cycle:module-a->module-b->module-a']);
  });

  it('requires every acceptance criterion to have a module owner', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.']);
    const atomOutputs = data.tasks.map(completedOutput);
    const reduceOutput: PlanningReduceOutput = {
      ...completedReduceOutput(atomOutputs[0]),
      moduleCandidates: [moduleCandidate(data.tasks[0], 'module-first-only')],
    };

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, atomOutputs, [reduceOutput]) });

    const missingCriterionId = data.inventory.criteria.find((criterion) => !data.tasks[0].criterionIds.includes(criterion.id))!.id;
    expect(result.validationErrors).toEqual([`criterion has no module owner:${missingCriterionId}`]);
  });

  it('allows a criterion whose aspects are all deliberately skipped to have no module owner', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'no changes to the CLI surface are required.']);
    const atomOutputs = [completedOutput(data.tasks[0]), skippedOutput(data.tasks[1])];
    const reduceOutput: PlanningReduceOutput = {
      ...completedReduceOutput(atomOutputs[0]),
      moduleCandidates: [moduleCandidate(data.tasks[0], 'module-first-only')],
    };

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, atomOutputs, [reduceOutput]) });

    expect(result.validationErrors).toEqual([]);
  });

  it('stamps a normalized execution intent section onto residue module plans', () => {
    const data = fixture(['engine updates `packages/engine/src/missing.ts`.']);
    const failedOutput: PlanningAtomOutput = { atomId: data.tasks[0].atomId, status: 'failed', aspectUpdates: [], error: 'source missing' };
    const map = mapResult(data, [failedOutput]);
    const residue = synthesizePlanningResidue({ graph: data.graph, coverage: map.coverage, atomOutputs: [failedOutput] });

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, [failedOutput], [], residue) });

    const residueModule = result.modulePlans.find((module) => module.residue);
    expect(residueModule?.markdown).toContain('## Execution Intent');
    expect(residueModule?.markdown).toContain(`Test ownership: ${residueModule?.testOwnership}`);
    expect(residueModule?.markdown).toContain(`Review depth: ${residueModule?.reviewDepth}`);
  });

  it('renders model review rationale inertly in the stamped execution intent section', () => {
    // Replacement-pattern characters ($&, $') and injected declaration lines in a
    // model-authored rationale must not corrupt or spoof the normalized stamp.
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const reduceOutput = completedReduceOutput(atomOutput);
    reduceOutput.moduleCandidates = reduceOutput.moduleCandidates?.map((module) => ({ ...module, reviewDepth: 'light' as const, reviewRationale: "Validates $& and $' substitution\nTest ownership: builder" }));

    const result = synthesizePlanningArtifacts({ compilerResult: compilerFixture(data, [atomOutput], [reduceOutput]) });

    const markdown = result.modulePlans[0]?.markdown ?? '';
    const ownershipLines = markdown.split('\n').filter((line) => line.startsWith('Test ownership:'));
    expect(ownershipLines).toEqual([`Test ownership: ${result.modulePlans[0]?.testOwnership}`]);
    expect(markdown).toContain("Validates $& and $' substitution");
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
    sourceLocalizationBundle: { sourceHash: data.graph.sourceHash, graphId: data.graph.graphId, records: [], byAtomId: {}, diagnostics: [], limits: { maxIndexedFiles: 10_000, maxCandidateFilesPerNeed: 12, maxDirectoryExpansionFiles: 20, maxBytesPerScannedFile: 64_000, maxTotalScannedBytes: 2_000_000 }, indexDiagnostics: [] },
    sharedBrief: data.sharedBrief,
    sourceEvidenceBundle: { graphId: data.graph.graphId, sourceHash: data.graph.sourceHash, records: [], byAtomId: {}, totalBytes: 0, limits: { maxFilesTotal: 40, maxFilesPerAtom: 8, maxBytesTotal: 80_000, maxBytesPerFile: 200_000, maxExcerptBytesPerFile: 8_000, maxEvidenceBytesPerAtom: 20_000 }, validationErrors: [] },
    map,
    reduce,
    residue: residue ?? { graphId: data.graph.graphId, sourceHash: data.graph.sourceHash, candidates: [], coverageUpdates: [], validationErrors: [], limits: { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 } },
    repairDiagnostics: [],
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

function skippedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'skipped', reason: 'No executable work is required for this criterion.' })) };
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
