import { describe, it, expect } from 'vitest';
import { computeMaxConcurrency } from '@eforge-build/engine/orchestrator/phases';
import type { OrchestrationConfig } from '@eforge-build/engine/events';

const TEST_REVIEW = { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const };
const TEST_BUILD = ['implement', 'review-cycle'];

function makePlans(
  specs: Array<{ id: string; dependsOn?: string[] }>,
): OrchestrationConfig['plans'] {
  return specs.map((s) => ({
    id: s.id,
    name: s.id,
    dependsOn: s.dependsOn ?? [],
    branch: `feature/${s.id}`,
    build: TEST_BUILD,
    review: TEST_REVIEW,
  }));
}


describe('computeMaxConcurrency', () => {
  it('returns 0 for empty plans', () => {
    expect(computeMaxConcurrency([])).toBe(0);
  });

  it('returns 1 for a single plan with no dependencies', () => {
    const plans = makePlans([{ id: 'a' }]);
    expect(computeMaxConcurrency(plans)).toBe(1);
  });

  it('returns 1 for a linear chain (A -> B -> C)', () => {
    const plans = makePlans([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ]);
    expect(computeMaxConcurrency(plans)).toBe(1);
  });

  it('returns 2 for two independent plans', () => {
    const plans = makePlans([
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(computeMaxConcurrency(plans)).toBe(2);
  });

  it('returns 2 for a diamond graph (A -> B, A -> C, B -> D, C -> D)', () => {
    const plans = makePlans([
      { id: 'a' },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['b', 'c'] },
    ]);
    expect(computeMaxConcurrency(plans)).toBe(2);
  });

  it('returns 3 for three independent plans', () => {
    const plans = makePlans([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
    expect(computeMaxConcurrency(plans)).toBe(3);
  });

  it('returns correct max for mixed independence and deps', () => {


    const plans = makePlans([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd', dependsOn: ['a'] },
      { id: 'e', dependsOn: ['b'] },
    ]);
    expect(computeMaxConcurrency(plans)).toBe(3);
  });
});
