import { describe, it, expect } from 'vitest';
import { computeDepthMap } from '../compute-depth-map';
import type { OrchestrationConfig } from '@/lib/types';

type PlanEntry = OrchestrationConfig['plans'][number];

function makePlan(id: string, dependsOn: string[] = []): PlanEntry {
  return {
    id,
    name: id,
    dependsOn,
    branch: `branch-${id}`,
    build: [],
    review: {} as PlanEntry['review'],
  };
}

describe('computeDepthMap smoke', () => {
  it('computes depth for a linear chain: a(0) → b(1) → c(2)', () => {
    const plans = [makePlan('a'), makePlan('b', ['a']), makePlan('c', ['b'])];
    const depthMap = computeDepthMap(plans);
    expect(depthMap.get('a')).toBe(0);
    expect(depthMap.get('b')).toBe(1);
    expect(depthMap.get('c')).toBe(2);
  });

  it('uses longest path in a branching DAG (diamond: a→b, a→c, b→d, c→d gives d depth 2)', () => {
    const plans = [makePlan('a'), makePlan('b', ['a']), makePlan('c', ['a']), makePlan('d', ['b', 'c'])];
    const depthMap = computeDepthMap(plans);
    expect(depthMap.get('d')).toBe(2);
  });

  it('does not infinite-loop on cyclic input', () => {
    const plans = [makePlan('a', ['b']), makePlan('b', ['a'])];
    expect(() => computeDepthMap(plans)).not.toThrow();
    expect(computeDepthMap(plans).has('a')).toBe(true);
  });

  it('returns empty map for empty plans array', () => {
    expect(computeDepthMap([]).size).toBe(0);
  });
});
