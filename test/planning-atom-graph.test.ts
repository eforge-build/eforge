import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { classifyEvidenceCandidate, derivePlanningAtomGraph, deriveSourceInventory, extractEvidenceCandidatesFromText, normalizeEvidenceValue, rankEvidenceCandidates } from '@eforge-build/engine/compile-resilience/planning-decomposition';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 500, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 2, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Big Plan', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

describe('planning source inventory and atom graph', () => {
  it('builds deterministic source inventory with actionable evidence and generated artifact hygiene', () => {
    const content = prd([
      '`packages/engine/src/config.ts` handles runtime choices and ignores eforge/plans/example/architecture.md planning artifacts.',
      '`test/config-schema.test.ts` covers config schema validation and ignores .decomposition/output.json.',
      'docs/config.md documents the runtime choice fields.',
    ]);

    const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'prd.md' });

    expect(inventory.summary.criterionCount).toBe(3);
    expect(inventory.summary.headingCount).toBe(2);
    expect(inventory.criteria[0].evidencePaths).toContain('packages/engine/src/config.ts');
    expect(inventory.criteria.flatMap((criterion) => criterion.evidencePaths)).toContain('test/config-schema.test.ts');
    expect(inventory.criteria.flatMap((criterion) => criterion.evidencePaths)).not.toContain('eforge/plans/example/architecture.md');
    expect(inventory.evidenceCandidates.find((candidate) => candidate.value === 'eforge/plans/example/architecture.md')?.actionable).toBe(false);
  });

  it('classifies broad directories and generated planning artifacts as non-actionable', () => {
    const candidates = rankEvidenceCandidates(['.', 'packages', 'test', 'packages/engine/src/config.ts', 'eforge/plans/foo/.decomposition/graph.json', 'docs/config.md']);

    expect(classifyEvidenceCandidate('packages').reason).toBe('broad-directory');
    expect(classifyEvidenceCandidate('eforge/plans/foo/orchestration.yaml').reason).toBe('generated-planning-artifact');
    expect(candidates.filter((candidate) => candidate.actionable).map((candidate) => candidate.value)).toEqual(['packages/engine/src/config.ts', 'docs/config.md']);
    expect(extractEvidenceCandidatesFromText('The config.ts helper is a symbol, not a path.')).toEqual([]);
    expect(normalizeEvidenceValue('docs/config.md.')).toBe('docs/config.md');
  });

  it('derives bounded atoms before agent execution from criteria, subsystems, and budgets', () => {
    const content = prd([
      'engine updates `packages/engine/src/config.ts` for runtime choice schema.',
      'engine adds `packages/engine/src/config-runtime-choices.ts` helpers.',
      'client updates `packages/client/src/events.ts` for choice metadata.',
      'console renders runtime choice metadata in `packages/console-ui/src/routes/runs.tsx`.',
      'docs update `docs/config.md` for profile examples.',
    ]);

    const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'prd.md', limits: { ...limits, maxCriteriaPerUnit: 2, maxSubsystemsPerUnit: 1 } });
    const again = derivePlanningAtomGraph({ content, hash: hash(content), path: 'prd.md', limits: { ...limits, maxCriteriaPerUnit: 2, maxSubsystemsPerUnit: 1 } });

    expect(graph.graphId).toBe(again.graphId);
    expect(graph.atoms.length).toBeGreaterThan(1);
    expect(graph.atoms.every((atom) => atom.estimate.criteriaCount <= 2)).toBe(true);
    expect(graph.atoms.every((atom) => atom.subsystemHints.length <= 1)).toBe(true);
    expect(graph.atoms.flatMap((atom) => atom.criterionIds).sort()).toEqual(['ac-001', 'ac-002', 'ac-003', 'ac-004', 'ac-005']);
    expect(graph.atoms.flatMap((atom) => atom.facetIds).some((facet) => facet.includes('packages-engine-src-config-ts'))).toBe(true);
  });

  it('splits oversized single criteria into source-budgeted atoms without relying on failure recursion', () => {
    const longCriterion = `engine updates packages/engine/src/large.ts ${'with detailed behavior '.repeat(80)}`;
    const content = prd([longCriterion, 'test covers packages/engine/src/large.ts behavior.']);
    const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits: { ...limits, maxPromptSourceBytes: 120, maxCriteriaPerUnit: 10 } });

    expect(graph.atoms.length).toBeGreaterThan(1);
    expect(graph.atoms.every((atom) => atom.estimate.sourceBytes <= 120)).toBe(true);
    expect(graph.atoms.some((atom) => atom.reason === 'oversized-criterion')).toBe(true);
    expect(graph.atoms.flatMap((atom) => atom.evidencePaths)).toContain('packages/engine/src/large.ts');
  });
});
