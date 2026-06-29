import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { selectReadyPlanningAtoms, type PlanningAtom, type PlanningAtomGraph } from '@eforge-build/engine/planner-compiler';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };

describe('planning atom scheduler', () => {
  it('selects ready atoms deterministically and blocks dependency successors', () => {
    const graph = schedulerGraph();

    const initial = selectReadyPlanningAtoms({ graph, parallelism: 1 });
    expect(initial.readyAtomIds).toEqual(['atom-a']);
    expect(initial.blockedAtoms).toEqual([{ atomId: 'atom-b', blockedByAtomIds: ['atom-a'] }, { atomId: 'atom-c', blockedByAtomIds: ['atom-b'] }]);

    const afterA = selectReadyPlanningAtoms({ graph, completedAtomIds: ['atom-a'], parallelism: 1 });
    expect(afterA.readyAtomIds).toEqual(['atom-b']);
    expect(afterA.blockedAtoms).toEqual([{ atomId: 'atom-c', blockedByAtomIds: ['atom-b'] }]);
  });

  it('treats skipped, failed, and running atoms as active without satisfying dependencies', () => {
    const graph = schedulerGraph();

    const decision = selectReadyPlanningAtoms({ graph, completedAtomIds: ['atom-a'], skippedAtomIds: ['atom-b'], failedAtomIds: ['atom-d'], runningAtomIds: ['atom-e'], parallelism: 2 });

    expect(decision.readyAtomIds).toEqual([]);
    expect(decision.blockedAtoms).toEqual([{ atomId: 'atom-c', blockedByAtomIds: ['atom-b'] }]);
    expect(decision.terminalAtomIds).toEqual(['atom-a', 'atom-b', 'atom-d']);
    expect(decision.activeAtomIds).toEqual(['atom-a', 'atom-b', 'atom-d', 'atom-e']);
  });
});

function schedulerGraph(): PlanningAtomGraph {
  const atoms = ['atom-a', 'atom-b', 'atom-c', 'atom-d', 'atom-e'].map((atomId) => atom(atomId));
  return { graphId: 'graph-scheduler', sourceHash: 'h'.repeat(64), inventory: { sourceHash: 'h'.repeat(64), byteLength: 0, lineCount: 0, criterionCount: 0, headingCount: 0, subsystemHints: [], actionableEvidenceCount: 0 }, atoms, edges: [{ fromAtomId: 'atom-a', toAtomId: 'atom-b', reason: 'test' }, { fromAtomId: 'atom-b', toAtomId: 'atom-c', reason: 'test' }], limits };
}

function atom(atomId: string): PlanningAtom {
  return { atomId, title: atomId, reason: 'general', criterionIds: [], facetIds: [], subsystemHints: ['general'], evidencePaths: [], interfaceKeys: [], dependencyHints: [], sourceSlices: [], budget: { maxRecursiveDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 }, estimate: { sourceBytes: 0, criteriaCount: 0, subsystemCount: 1, evidencePathCount: 0, estimatedPromptBytes: 0 } };
}
