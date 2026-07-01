import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { coverageUpdatesForResidueCandidates, derivePlanningAspectCoverage, derivePlanningAtomGraph, deriveSourceInventory, synthesizePlanningResidue, validatePlanningResidueCandidates, type PlanningAtomOutput, type PlanningReduceGap, type PlanningReduceOutput, type PlanningSourceEvidenceBundle, type PlanningSourceEvidenceRecord, type PlanningResidueCandidate } from '@eforge-build/engine/planner-compiler';

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

  it('blocks unresolved source-evidence residue unless it has concrete product-scoped handling', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/missing.ts`.']);
    const missingBundle = evidenceBundle(graph, [record('packages/engine/src/missing.ts', 'missing', ['atom-engine-001'], 'file-not-found')]);
    const tooLargeBundle = evidenceBundle(graph, [record('packages/engine/src/missing.ts', 'too-large', ['atom-engine-001'], 'file-byte-size-exceeds-limit')]);

    const missing = synthesizePlanningResidue({ graph, coverage, sourceEvidenceBundle: missingBundle });
    const tooLarge = synthesizePlanningResidue({ graph, coverage, sourceEvidenceBundle: tooLargeBundle });

    expect(missing.candidates.map((candidate) => candidate.reason)).not.toContain('source-evidence-missing');
    expect(tooLarge.candidates.find((candidate) => candidate.reason === 'source-evidence-too-large')).toMatchObject({
      buildability: 'buildable',
      sourceLocalizationDerived: true,
      localizedOwnerPaths: ['packages/engine/src/missing.ts'],
      productScopedValidationRefs: ['ac-001'],
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

  it('synthesizes follow-up work for reduce conflicts and residue for required non-source gaps', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const aspectId = coverage.aspects[0].aspectId;
    const reduceOutputs: PlanningReduceOutput[] = [{
      nodeId: 'reduce-root',
      status: 'incomplete',
      compactSummary: aspectId,
      gaps: [{ gapId: 'gap-requirement', title: 'Requirement detail missing', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Requirement details were insufficient.', representationRequired: true }],
      conflicts: [{ conflictId: 'conflict-contract', title: 'Contract disagreement', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Two fragments disagree on the contract.' }],
    }];

    const result = synthesizePlanningResidue({ graph, coverage, reduceOutputs });

    expect(result.candidates.find((candidate) => candidate.reason === 'reduce-gap')).toMatchObject({ kind: 'residue', aspectIds: [aspectId] });
    expect(result.candidates.find((candidate) => candidate.reason === 'reduce-conflict')).toMatchObject({ kind: 'follow-up', aspectIds: [aspectId] });
  });

  it('keeps unresolved source/localization reduce gaps repair-only', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const aspectId = coverage.aspects[0].aspectId;
    const reduceOutputs: PlanningReduceOutput[] = [{
      nodeId: 'reduce-root',
      status: 'incomplete',
      compactSummary: aspectId,
      gaps: [{ gapId: 'gap-owner', title: 'Missing localized owner path', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Missing localized owner path for product source.', representationRequired: true, issueKind: 'missing-owner-path', sourceLocalizationSignal: true }],
    }];

    const result = synthesizePlanningResidue({ graph, coverage, reduceOutputs });

    expect(result.candidates.map((candidate) => candidate.reason)).not.toContain('reduce-gap');
  });

  it('allows buildable source/localization reduce residue with concrete owners and PRD validation', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const aspectId = coverage.aspects[0].aspectId;
    const reduceOutputs: PlanningReduceOutput[] = [{
      nodeId: 'reduce-root',
      status: 'incomplete',
      compactSummary: aspectId,
      gaps: [{ gapId: 'gap-owner', title: 'Localized source budget', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Materialized source budget exceeded for localized owner path packages/engine/src/a.ts.', representationRequired: true, issueKind: 'missing-materialized-source', sourceLocalizationSignal: true, ownerPaths: ['packages/engine/src/a.ts'], productScopedOutputRefs: ['localized-owner:packages/engine/src/a.ts'], productScopedValidationRefs: ['ac-001'] }],
    }];

    const result = synthesizePlanningResidue({ graph, coverage, reduceOutputs });

    expect(result.candidates.find((candidate) => candidate.reason === 'reduce-gap')).toMatchObject({ buildability: 'buildable', sourceLocalizationDerived: true, localizedOwnerPaths: ['packages/engine/src/a.ts'] });
  });

  it('keeps source/localization reduce gaps repair-only without complete buildability metadata', () => {
    const { graph, coverage } = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const aspectId = coverage.aspects[0].aspectId;
    const baseGap = { gapId: 'gap-owner', title: 'Localized source budget', criterionIds: ['ac-001'], aspectIds: [aspectId], description: 'Materialized source budget exceeded for localized owner path packages/engine/src/a.ts.', representationRequired: true, issueKind: 'missing-materialized-source' as const, sourceLocalizationSignal: true };
    const cases: Array<[string, Partial<PlanningReduceGap>]> = [
      ['no ownerPaths', { productScopedOutputRefs: ['localized-owner:packages/engine/src/a.ts'], productScopedValidationRefs: ['ac-001'] }],
      ['no productScopedOutputRefs', { ownerPaths: ['packages/engine/src/a.ts'], productScopedValidationRefs: ['ac-001'] }],
      ['no productScopedValidationRefs', { ownerPaths: ['packages/engine/src/a.ts'], productScopedOutputRefs: ['localized-owner:packages/engine/src/a.ts'] }],
      ['output refs do not use localized-owner convention', { ownerPaths: ['packages/engine/src/a.ts'], productScopedOutputRefs: ['product-scoped handling for packages/engine/src/a.ts'], productScopedValidationRefs: ['ac-001'] }],
      ['validation refs do not match criteria', { ownerPaths: ['packages/engine/src/a.ts'], productScopedOutputRefs: ['localized-owner:packages/engine/src/a.ts'], productScopedValidationRefs: ['ac-999'] }],
    ];

    for (const [, gapPatch] of cases) {
      const result = synthesizePlanningResidue({ graph, coverage, reduceOutputs: [{ nodeId: 'reduce-root', status: 'incomplete', compactSummary: aspectId, gaps: [{ ...baseGap, ...gapPatch }] }] });
      expect(result.candidates.some((candidate) => candidate.reason === 'reduce-gap')).toBe(false);
    }

    const invalidCandidate: PlanningResidueCandidate = { ...goodCandidate('candidate-invalid-source-localization', aspectId), sourceLocalizationDerived: true, buildability: 'buildable', localizedOwnerPaths: ['packages/engine/src/a.ts'], productScopedOutputRefs: ['product-scoped handling for packages/engine/src/a.ts'], productScopedValidationRefs: ['ac-999'] };
    expect(validatePlanningResidueCandidates({ graph, coverage, candidates: [invalidCandidate] })).toEqual({ ok: false, errors: ['source/localization residue requires product-scoped outputs:candidate-invalid-source-localization', 'source/localization residue validation must reference original criteria:candidate-invalid-source-localization'] });
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
