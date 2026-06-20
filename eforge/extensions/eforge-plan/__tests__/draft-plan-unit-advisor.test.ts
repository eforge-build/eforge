import { describe, expect, it } from 'vitest';
import { adviseMerge, adviseSplit, buildDependencyContext } from '../draft-plan-unit-advisor.js';

const labels = new Map([['a', 'Item A'], ['b', 'Item B'], ['c', 'Item C'], ['d', 'Item D']]);

describe('draft plan unit dependency advisor', () => {
  it('flags a split that separates a dependency edge', () => {
    // b depends on a; peeling b away from a crosses the edge.
    const deps = new Map([['a', []], ['b', ['a']]]);
    const advisory = adviseSplit(['b'], ['a'], deps, labels);
    expect(advisory.severity).toBe('caution');
    expect(advisory.findings).toHaveLength(1);
    expect(advisory.findings[0]).toMatchObject({ code: 'split-crosses-dependency', itemIds: ['b', 'a'] });
  });

  it('confirms a split that keeps every dependency within one side', () => {
    // b depends on a, and both stay together; c is independent and peeled off.
    const deps = new Map([['a', []], ['b', ['a']], ['c', []]]);
    const advisory = adviseSplit(['c'], ['a', 'b'], deps, labels);
    expect(advisory.severity).toBe('ok');
    expect(advisory.findings[0].code).toBe('split-respects-dependencies');
  });

  it('reports a merge of coupled units as justified', () => {
    // Unit [a] and unit [b] where b depends on a: merging keeps coupled work together.
    const deps = new Map([['a', []], ['b', ['a']]]);
    const advisory = adviseMerge([['a'], ['b']], deps, labels);
    expect(advisory.severity).toBe('ok');
    expect(advisory.findings[0]).toMatchObject({ code: 'merge-justified-by-dependency', itemIds: ['a', 'b'] });
  });

  it('cautions when merging units with no dependencies between them', () => {
    const deps = new Map([['a', []], ['b', []]]);
    const advisory = adviseMerge([['a'], ['b']], deps, labels);
    expect(advisory.severity).toBe('caution');
    expect(advisory.findings[0].code).toBe('merge-independent-units');
  });

  it('builds in-scope dependency context, dropping edges that leave the scope', () => {
    const rows = [
      { id: 'a', title: 'Item A', dependsOn: [] },
      { id: 'b', title: 'Item B', dependsOn: ['a', 'external'] },
    ];
    const { deps, labels: built } = buildDependencyContext(rows, new Set(['a', 'b']));
    expect(deps.get('b')).toEqual(['a']);
    expect(built.get('b')).toBe('Item B');
  });
});
