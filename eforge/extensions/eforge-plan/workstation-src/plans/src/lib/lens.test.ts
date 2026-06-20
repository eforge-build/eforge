import { describe, expect, it } from 'vitest';
import type { BoardItem } from '@/types';
import { collectLensTags, intersectsLens, lensMatchingItemIds } from './lens';

function item(id: string, tags: string[]): BoardItem {
  return {
    id, title: id, status: 'planned', priority: 'medium', tags, lane: 'ready',
    reasons: [], unresolvedDependsOn: [], activeTraceReasons: [], blocked: false,
    ready: true, reviewDue: false, closed: false, dependencies: [], dependents: [],
    notes: { claim: '', evidence: '', recheck: '', promotionPaths: '' }, recLanes: [],
  };
}

describe('collectLensTags', () => {
  it('orders tags by frequency then alphabetically', () => {
    const tags = collectLensTags([item('a', ['ux', 'cli']), item('b', ['ux']), item('c', ['api'])]);
    expect(tags).toEqual([
      { tag: 'ux', count: 2 },
      { tag: 'api', count: 1 },
      { tag: 'cli', count: 1 },
    ]);
  });

  it('caps the bar at 16 tags but force-includes a less-frequent active tag', () => {
    // 20 tags each carried twice (higher frequency) push the single-use `edge`
    // tag outside the top-16 slice, exercising the force-include branch.
    const frequent = Array.from({ length: 20 }, (_unused, index) => [
      item(`i${index}a`, [`tag${index}`]),
      item(`i${index}b`, [`tag${index}`]),
    ]).flat();
    const rare = item('rare', ['edge']);
    const tags = collectLensTags([...frequent, rare], 'edge');
    // 16 capped entries plus the force-appended active tag.
    expect(tags).toHaveLength(17);
    expect(tags.find((entry) => entry.tag === 'edge')).toEqual({ tag: 'edge', count: 1 });
  });

  it('force-includes an active tag carried by no item with a zero count', () => {
    const tags = collectLensTags([item('a', ['ux'])], 'gone');
    expect(tags).toContainEqual({ tag: 'gone', count: 0 });
  });

  it('returns an empty list when no items carry tags', () => {
    expect(collectLensTags([item('a', [])])).toEqual([]);
  });
});

describe('lensMatchingItemIds', () => {
  it('returns ids of items carrying the tag', () => {
    const ids = lensMatchingItemIds([item('a', ['ux']), item('b', ['cli']), item('c', ['ux', 'cli'])], 'ux');
    expect([...ids].sort()).toEqual(['a', 'c']);
  });

  it('returns an empty set when no tag is active', () => {
    expect(lensMatchingItemIds([item('a', ['ux'])], '').size).toBe(0);
  });
});

describe('intersectsLens', () => {
  const matched = new Set(['a', 'c']);
  it('is true when any id is in the lens set', () => {
    expect(intersectsLens(['b', 'c'], matched)).toBe(true);
  });
  it('is false with no overlap, missing ids, or an empty lens', () => {
    expect(intersectsLens(['b', 'd'], matched)).toBe(false);
    expect(intersectsLens(undefined, matched)).toBe(false);
    expect(intersectsLens(['a'], new Set())).toBe(false);
  });
});
