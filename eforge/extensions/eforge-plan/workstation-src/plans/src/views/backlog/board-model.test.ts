import { describe, expect, it } from 'vitest';
import type { BoardItem } from '@/types';
import { matchesFilter } from './board-model';

function item(overrides: Partial<BoardItem>): BoardItem {
  return {
    id: 'item-1',
    title: 'Item',
    status: 'open',
    priority: 'medium',
    tags: [],
    lane: 'inbox',
    reasons: [],
    unresolvedDependsOn: [],
    activeTraceReasons: [],
    blocked: false,
    ready: false,
    reviewDue: false,
    closed: false,
    dependencies: [],
    dependents: [],
    notes: {},
    recLanes: [],
    ...overrides,
  } as BoardItem;
}

describe('matchesFilter', () => {
  it('treats open as not-closed', () => {
    expect(matchesFilter(item({ closed: false }), 'open')).toBe(true);
    expect(matchesFilter(item({ closed: true }), 'open')).toBe(false);
  });

  it('excludes closed items from the blocked filter so results match the open-only count pill', () => {
    expect(matchesFilter(item({ blocked: true, closed: false }), 'blocked')).toBe(true);
    // Closed items keep their blocked flag, but the filter means actionable blocked work.
    expect(matchesFilter(item({ blocked: true, closed: true }), 'blocked')).toBe(false);
  });
});
