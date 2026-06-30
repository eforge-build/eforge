import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { coverageUpdatesForResidueCandidates, derivePlanningAspectCoverage, derivePlanningAtomGraph, deriveSourceInventory, synthesizePlanningResidue, validatePlanningResidueCandidates, type PlanningAtomOutput, type PlanningReduceOutput, type PlanningSourceEvidenceBundle, type PlanningSourceEvidenceRecord, type PlanningResidueCandidate } from '@eforge-build/engine/planner-compiler';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Residue', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function fixture(criteria = ['engine updates `packages/engine/src/missing.ts`.', 'client updates `packages/client/src/events.ts`.']) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'residue.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'residue.md', limits, inventory });
  const coverage = derivePlanningAspectCoverage({ graph, inventory });
  return { graph, inventory, coverage };
}

describe('planning residue synthesis', () => {
  it('synthesizes represented residue updates for pending aspects', () => {
    const { graph, inventory, coverage } = fixture(['engine updates `packages/engine/src/missing.ts`.']);

    const result = synthesizePlanningResidue({ graph, coverage });
    const updatedCoverage = derivePlanningAspectCoverage({ graph, inventory, updates: result.coverageUpdates });

    expect(result.validationErrors).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ kind: 'residue', reason: 'pending-aspect', criterionIds: ['ac-001'], aspectIds: ['ac-001:evidence:packages-engine-src-missing-ts'] });
    expect(updatedCoverage.completeCriteria).toEqual(['ac-001']);
    expect(updatedCoverage.aspects[0].representation?.moduleId).toBe(result.candidates[0].candidateId);
  });

  it('synthesizes source-evidence residue with concrete status reasons', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/missing.ts`.']);
    const bundle = evidenceBundle(graph, [record('packages/engine/src/missing.ts', 'missing', ['atom-engine-001'], 'file-not-found')]);

    const result = synthesizePlanningResidue({ graph, coverage, sourceEvidenceBundle: bundle });

    expect(result.candidates.map((candidate) => candidate.reason)).toContain('source-evidence-missing');
    expect(result.candidates.find((candidate) => candidate.reason === 'source-evidence-missing')).toMatchObject({
      sourceRefs: ['file-not-found', 'packages/engine/src/missing.ts'],
      expectedOutputs: ['Concrete handling for packages/engine/src/missing.ts is captured without requiring unbounded mapper exploration.'],
    });
  });

  it('synthesizes residue for failed atom outputs without marking unrelated aspects complete', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.']);
    const failedAtomId = graph.atoms[0].atomId;
    const outputs: PlanningAtomOutput[] = [{ atomId: failedAtomId, status: 'failed', aspectUpdates: [], error: 'planner context exhausted' }];

    const result = synthesizePlanningResidue({ graph, coverage, atomOutputs: outputs });
    const failedCandidate = result.candidates.find((candidate) => candidate.reason === 'atom-failed');

    expect(failedCandidate?.sourceRefs).toEqual([failedAtomId]);
    expect(failedCandidate?.rationale).toContain('planner context exhausted');
    expect(result.coverageUpdates.map((update) => update.aspectId)).toContain(failedCandidate!.aspectIds[0]);
  });

  it('synthesizes follow-up work for reduce conflicts and residue for required gaps', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const aspectId = coverage.aspects[0].aspectId;
    const reduceOutputs: PlanningReduceOutput[] = [{
      nodeId: 'reduce-root',
      status: 'incomplete',
      compactSummary: aspectId,
      gaps: [{ gapId: 'gap-source', title: 'Source detail missing', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Source details were insufficient.', representationRequired: true }],
      conflicts: [{ conflictId: 'conflict-contract', title: 'Contract disagreement', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Two fragments disagree on the contract.' }],
    }];

    const result = synthesizePlanningResidue({ graph, coverage, reduceOutputs });

    expect(result.candidates.find((candidate) => candidate.reason === 'reduce-gap')).toMatchObject({ kind: 'residue', aspectIds: [aspectId] });
    expect(result.candidates.find((candidate) => candidate.reason === 'reduce-conflict')).toMatchObject({ kind: 'follow-up', aspectIds: [aspectId] });
  });

  it('rejects vague or invalid residue candidates', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const candidate: PlanningResidueCandidate = { candidateId: 'candidate-bad', kind: 'residue', reason: 'pending-aspect', title: 'Bad', criterionIds: ['ac-001'], aspectIds: [coverage.aspects[0].aspectId], scope: 'investigate later', expectedOutputs: ['todo'], validationExpectations: [], rationale: 'unknown' };

    const validation = validatePlanningResidueCandidates({ graph, coverage, candidates: [candidate] });

    expect(validation).toEqual({ ok: false, errors: ['residue candidate is vague:candidate-bad', 'residue candidate requires validation expectations:candidate-bad'] });
  });

  it('deduplicates coverage updates when multiple candidates represent one aspect', () => {
    const { coverage } = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const aspectId = coverage.aspects[0].aspectId;
    const updates = coverageUpdatesForResidueCandidates([
      goodCandidate('candidate-a', aspectId),
      goodCandidate('candidate-b', aspectId),
    ]);

    expect(updates).toHaveLength(1);
    expect(updates[0].representation?.moduleId).toBe('candidate-a');
  });
});

function record(path: string, status: PlanningSourceEvidenceRecord['status'], atomIds: string[], reason: string): PlanningSourceEvidenceRecord {
  return { path, status, referencedByAtomIds: atomIds, shared: false, deliveredToAtomIds: [], reason };
}

function evidenceBundle(graph: ReturnType<typeof fixture>['graph'], records: PlanningSourceEvidenceRecord[]): PlanningSourceEvidenceBundle {
  return { graphId: graph.graphId, sourceHash: graph.sourceHash, records, byAtomId: Object.fromEntries(records.flatMap((item) => item.referencedByAtomIds.map((atomId) => [atomId, [item.path]]))), totalBytes: 0, limits: { maxFilesTotal: 40, maxFilesPerAtom: 8, maxBytesTotal: 80_000, maxBytesPerFile: 200_000, maxExcerptBytesPerFile: 8_000, maxEvidenceBytesPerAtom: 20_000 }, validationErrors: [] };
}

function goodCandidate(candidateId: string, aspectId: string): PlanningResidueCandidate {
  return { candidateId, kind: 'residue', reason: 'pending-aspect', title: candidateId, criterionIds: ['ac-001'], aspectIds: [aspectId], scope: 'Represent bounded planner residue for the linked aspect.', expectedOutputs: ['A concrete module candidate records the represented planner work.'], validationExpectations: ['Planner compiler tests cover the represented aspect.'], rationale: 'The aspect needs explicit represented work.' };
}
