import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import {
  buildCompilerDiagnostics,
  buildPlanningAtomTasks,
  derivePlanningAspectCoverage,
  derivePlanningAtomGraph,
  deriveSharedPlanningBrief,
  deriveSourceInventory,
  MAX_COMPILER_DIAGNOSTICS_BYTES,
  serializeCompilerDiagnostics,
  validateCompilerDiagnostics,
  writeCompilerDiagnosticsArtifact,
  type BoundedPlannerCompilerResult,
  type PlanningAtomMapResult,
  type PlanningAtomOutput,
  type PlanningAtomTask,
  type PlanningReduceGap,
  type PlanningReduceOutput,
  type PlanningReduceResult,
  type PlanningResidueSynthesis,
  type SourceLocalizationRepairDiagnostic,
} from '@eforge-build/engine/planner-compiler';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Compiler Diagnostics', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('planning compiler diagnostics', () => {
  it('builds schema-valid diagnostics for a complete compile and is deterministic', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const compilerResult = compilerFixture(data, [atomOutput], [completedReduceOutput(atomOutput)]);

    const diagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: 'diag-set' });

    expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
    expect(diagnostics.compilerStatus).toBe('complete');
    expect(diagnostics.planSetName).toBe('diag-set');
    expect(diagnostics.sourceHash).toBe(data.inventory.sourceHash);
    expect(diagnostics.coverage.completeCriteria).toEqual(['ac-001']);
    expect(diagnostics.coverage.incompleteCriteria).toEqual([]);
    expect(diagnostics.reduce.gaps).toEqual([]);
    expect(diagnostics.reduce.conflicts).toEqual([]);
    expect(diagnostics.repair.status).toBe('not-needed');
    expect(diagnostics.residue.synthesisBlocked).toBe(false);
    expect(diagnostics.evidenceFailures).toEqual([]);
    expect(buildCompilerDiagnostics({ compilerResult, planSetName: 'diag-set' })).toEqual(diagnostics);
  });

  it('links reduce gaps and conflicts to the residue candidates that represent them', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const gap: PlanningReduceGap = { gapId: 'gap-owner', title: 'Missing owner path', criterionIds: ['ac-001'], aspectIds: data.tasks[0].aspectIds, description: 'No owner path localized for the engine update.', representationRequired: true, issueKind: 'missing-owner-path', sourceLocalizationSignal: true };
    const orphanGap: PlanningReduceGap = { gapId: 'gap-orphan', title: 'Unrepresented gap', criterionIds: ['ac-001'], aspectIds: data.tasks[0].aspectIds, description: 'Nothing represents this gap.', representationRequired: true };
    const adviceGap: PlanningReduceGap = { gapId: 'gap-advice', title: 'Route ordering advice', criterionIds: ['ac-001'], aspectIds: data.tasks[0].aspectIds, description: 'Register the search route before the parameter route.', representationRequired: false, issueKind: 'generic' };
    const reduceOutput: PlanningReduceOutput = { ...completedReduceOutput(atomOutput), gaps: [gap, orphanGap, adviceGap], conflicts: [{ conflictId: 'conflict-a', title: 'Two owners', criterionIds: ['ac-001'], aspectIds: data.tasks[0].aspectIds, description: 'Both plans touch the same file.' }] };
    const residue = residueFixture(data, [
      { candidateId: 'candidate-reduce-gap-owner', reason: 'reduce-gap', sourceRefs: ['gap-owner'] },
      { candidateId: 'candidate-reduce-conflict-a', reason: 'reduce-conflict', sourceRefs: ['conflict-a'] },
    ]);
    const compilerResult = compilerFixture(data, [atomOutput], [reduceOutput], { residue });

    const diagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: 'diag-set' });

    expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
    expect(diagnostics.reduce.gaps).toEqual([
      expect.objectContaining({ gapId: 'gap-advice', issueKind: 'generic', resolution: 'informational' }),
      expect.objectContaining({ gapId: 'gap-orphan', issueKind: 'generic', resolution: 'unrepresented' }),
      expect.objectContaining({ gapId: 'gap-owner', issueKind: 'missing-owner-path', resolution: 'residue-represented', representedByCandidateId: 'candidate-reduce-gap-owner' }),
    ]);
    expect(diagnostics.reduce.conflicts).toEqual([
      expect.objectContaining({ conflictId: 'conflict-a', resolution: 'residue-represented', representedByCandidateId: 'candidate-reduce-conflict-a' }),
    ]);
    expect(diagnostics.residue.candidates.map((candidate) => candidate.candidateId)).toEqual(['candidate-reduce-conflict-a', 'candidate-reduce-gap-owner']);
  });

  it('records exhausted repair attempts and blocked residue synthesis', () => {
    const data = fixture(['engine updates `packages/engine/src/missing.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const exhausted = repairDiagnostic(data.tasks[0], { attempt: 1, status: 'exhausted', unresolvedReason: 'no localized owner paths resolved' });
    const compilerResult = compilerFixture(data, [atomOutput], [completedReduceOutput(atomOutput)], {
      repairDiagnostics: [repairDiagnostic(data.tasks[0], { attempt: 1, status: 'unresolved' }), exhausted],
      status: 'incomplete',
      validationErrors: ['source localization repair exhausted:gap-owner:no localized owner paths resolved'],
    });

    const diagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: 'diag-set' });

    expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
    expect(diagnostics.compilerStatus).toBe('incomplete');
    expect(diagnostics.repair.status).toBe('exhausted');
    expect(diagnostics.repair.attempts).toHaveLength(2);
    expect(diagnostics.repair.attempts[1]).toEqual(expect.objectContaining({ status: 'exhausted', unresolvedReason: 'no localized owner paths resolved', residueSynthesisBlocked: true }));
    expect(diagnostics.repair.attempts[1].coverageStatus.criteria).toEqual([{ id: 'ac-001', status: 'covered' }]);
    expect(diagnostics.residue.synthesisBlocked).toBe(true);
    expect(diagnostics.residue.blockedReasons).toContain('no localized owner paths resolved');
    expect(diagnostics.validationErrors).toContain('source localization repair exhausted:gap-owner:no localized owner paths resolved');
  });

  it('captures non-materialized source evidence as evidence failures', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const atomId = data.tasks[0].atomId;
    const compilerResult = compilerFixture(data, [atomOutput], [completedReduceOutput(atomOutput)], {
      evidenceRecords: [
        { path: 'packages/engine/src/a.ts', status: 'materialized', referencedByAtomIds: [atomId], shared: false, deliveredToAtomIds: [atomId], contentExcerpt: 'export {};' },
        { path: 'packages/engine/src/missing.ts', status: 'missing', referencedByAtomIds: [atomId], shared: false, deliveredToAtomIds: [], reason: 'file not found' },
        { path: 'packages/engine/src/big.ts', status: 'too-large', referencedByAtomIds: [atomId], shared: false, deliveredToAtomIds: [], reason: 'exceeds per-file budget' },
      ],
    });

    const diagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: 'diag-set' });

    expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
    expect(diagnostics.evidenceFailures).toEqual([
      { path: 'packages/engine/src/big.ts', status: 'too-large', reason: 'exceeds per-file budget', referencedByAtomIds: [atomId] },
      { path: 'packages/engine/src/missing.ts', status: 'missing', reason: 'file not found', referencedByAtomIds: [atomId] },
    ]);
  });

  it('compacts oversized diagnostics under the byte cap while recording omissions', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const gaps: PlanningReduceGap[] = Array.from({ length: 128 }, (_, index) => ({
      gapId: `gap-${String(index + 1).padStart(3, '0')}`,
      title: `Gap ${index + 1}`,
      criterionIds: ['ac-001'],
      aspectIds: data.tasks[0].aspectIds,
      description: 'x'.repeat(4_000),
      representationRequired: false,
    }));
    const reduceOutput: PlanningReduceOutput = { ...completedReduceOutput(atomOutput), gaps };
    const compilerResult = compilerFixture(data, [atomOutput], [reduceOutput]);

    const diagnostics = buildCompilerDiagnostics({ compilerResult, planSetName: 'diag-set' });
    const serialized = serializeCompilerDiagnostics(diagnostics);
    const parsed = JSON.parse(serialized) as ReturnType<typeof buildCompilerDiagnostics>;

    expect(diagnostics.omitted.descriptionBytes).toBeGreaterThan(0);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(MAX_COMPILER_DIAGNOSTICS_BYTES);
    expect(validateCompilerDiagnostics(parsed)).toEqual({ ok: true, errors: [] });
    expect(parsed.reduce.gaps).toHaveLength(128);
    expect(parsed.omitted.descriptionBytes).toBeGreaterThan(diagnostics.omitted.descriptionBytes);
  });

  it('writes the diagnostics artifact to the plan set directory and rejects unsafe path components', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const atomOutput = completedOutput(data.tasks[0]);
    const diagnostics = buildCompilerDiagnostics({ compilerResult: compilerFixture(data, [atomOutput], [completedReduceOutput(atomOutput)]), planSetName: 'diag-set' });
    const cwd = await mkdtemp(join(tmpdir(), 'eforge-compiler-diagnostics-'));

    const artifactPath = await writeCompilerDiagnosticsArtifact({ cwd, outputDir: 'eforge/plans', planSetName: 'diag-set', diagnostics });

    expect(artifactPath).toBe(resolve(cwd, 'eforge/plans/diag-set/compiler-diagnostics.json'));
    const roundTripped = JSON.parse(await readFile(artifactPath, 'utf8'));
    expect(roundTripped).toEqual(diagnostics);
    expect(validateCompilerDiagnostics(roundTripped)).toEqual({ ok: true, errors: [] });

    await expect(writeCompilerDiagnosticsArtifact({ cwd, outputDir: 'eforge/plans', planSetName: '../escape', diagnostics })).rejects.toThrow(/safe relative path component/);
    await expect(writeCompilerDiagnosticsArtifact({ cwd, outputDir: 'eforge/plans', planSetName: 'diag-set', diagnostics, fileName: '../evil.json' })).rejects.toThrow(/safe relative path component/);
  });
});

interface CompilerFixtureOverrides {
  residue?: PlanningResidueSynthesis;
  repairDiagnostics?: SourceLocalizationRepairDiagnostic[];
  status?: BoundedPlannerCompilerResult['status'];
  validationErrors?: string[];
  evidenceRecords?: BoundedPlannerCompilerResult['sourceEvidenceBundle']['records'];
}

function fixture(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'diagnostics.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'diagnostics.md', limits, inventory });
  const sharedBrief = deriveSharedPlanningBrief({ graph });
  const tasks = buildPlanningAtomTasks({ graph, inventory, sharedBrief });
  return { content, inventory, graph, sharedBrief, tasks };
}

function compilerFixture(data: ReturnType<typeof fixture>, atomOutputs: PlanningAtomOutput[], reduceOutputs: PlanningReduceOutput[], overrides: CompilerFixtureOverrides = {}): BoundedPlannerCompilerResult {
  const map = mapResult(data, atomOutputs);
  const reduce = reduceResult(data.graph.graphId, reduceOutputs);
  const residue = overrides.residue ?? emptyResidue(data);
  return {
    sourceInventory: data.inventory,
    atomGraph: data.graph,
    sourceLocalizationBundle: { sourceHash: data.graph.sourceHash, graphId: data.graph.graphId, records: [], byAtomId: {}, diagnostics: [], limits: { maxIndexedFiles: 10_000, maxCandidateFilesPerNeed: 12, maxDirectoryExpansionFiles: 20, maxBytesPerScannedFile: 64_000, maxTotalScannedBytes: 2_000_000 }, indexDiagnostics: [] },
    sharedBrief: data.sharedBrief,
    sourceEvidenceBundle: { graphId: data.graph.graphId, sourceHash: data.graph.sourceHash, records: overrides.evidenceRecords ?? [], byAtomId: {}, totalBytes: 0, limits: { maxFilesTotal: 40, maxFilesPerAtom: 8, maxBytesTotal: 80_000, maxBytesPerFile: 200_000, maxExcerptBytesPerFile: 8_000, maxEvidenceBytesPerAtom: 20_000 }, validationErrors: [] },
    map,
    reduce,
    residue,
    repairDiagnostics: overrides.repairDiagnostics ?? [],
    status: overrides.status ?? (residue.candidates.length > 0 ? 'complete-with-residue' : reduce.reduceComplete && map.mapComplete ? 'complete' : 'incomplete'),
    validationErrors: overrides.validationErrors ?? [],
    events: [],
  };
}

function emptyResidue(data: ReturnType<typeof fixture>): PlanningResidueSynthesis {
  return { graphId: data.graph.graphId, sourceHash: data.graph.sourceHash, candidates: [], coverageUpdates: [], validationErrors: [], limits: { maxCandidates: 80, maxScopeBytes: 1_200, maxRationaleBytes: 1_200, maxExpectedOutputBytes: 800, maxValidationExpectationBytes: 800 } };
}

function residueFixture(data: ReturnType<typeof fixture>, entries: Array<{ candidateId: string; reason: 'reduce-gap' | 'reduce-conflict'; sourceRefs: string[] }>): PlanningResidueSynthesis {
  return {
    ...emptyResidue(data),
    candidates: entries.map((entry) => ({
      candidateId: entry.candidateId,
      kind: 'follow-up',
      reason: entry.reason,
      title: `Follow up ${entry.candidateId}`,
      criterionIds: ['ac-001'],
      aspectIds: data.tasks[0].aspectIds,
      scope: 'Resolve the reducer finding against the localized engine module.',
      expectedOutputs: ['Reducer finding resolved in the plan set.'],
      validationExpectations: ['Validation criteria ac-001 passes.'],
      rationale: 'Reducer surfaced a finding that needs explicit follow-up work.',
      sourceRefs: entry.sourceRefs,
    })),
  };
}

function repairDiagnostic(task: PlanningAtomTask, overrides: { attempt: number; status: SourceLocalizationRepairDiagnostic['status']; unresolvedReason?: string }): SourceLocalizationRepairDiagnostic {
  return {
    attempt: overrides.attempt,
    status: overrides.status,
    maxAttempts: 1,
    gapIds: ['gap-owner'],
    gapClassifications: [{ gapId: 'gap-owner', issueKind: 'missing-owner-path', sourceLocalizationSignal: true }],
    sourceNeedIds: [],
    affectedAtomIds: [task.atomId],
    criterionIds: task.criterionIds,
    aspectIds: task.aspectIds,
    localizedOwnerPaths: [],
    localizedOwnerStatus: [],
    evidenceMaterializationStatus: [],
    coverageStatus: { criteria: { 'ac-001': 'covered' }, aspects: {}, sourceNeeds: {} },
    ...(overrides.unresolvedReason ? { unresolvedReason: overrides.unresolvedReason } : {}),
    residueSynthesisBlocked: true,
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
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }], moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }] };
}

function completedReduceOutput(output: PlanningAtomOutput): PlanningReduceOutput {
  return { nodeId: 'reduce-000-001', status: 'completed', compactSummary: 'Reduced diagnostics synthesis.', planFragments: output.planFragments, moduleCandidates: [{ moduleId: 'module-reduce-000-001', title: 'Reduced module', criterionIds: output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? [], aspectIds: output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? [], description: 'Implement reduced planning work.', validationExpectation: 'Reduced checks pass.' }], validationStrategy: 'Run relevant checks.' };
}
