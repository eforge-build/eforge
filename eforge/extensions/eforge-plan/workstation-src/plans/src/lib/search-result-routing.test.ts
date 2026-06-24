import { describe, expect, it } from 'vitest';
import { navigationIntentForSearchResult } from './search-result-routing';

describe('search result routing', () => {
  it('routes backlog items and session plans', () => {
    expect(navigationIntentForSearchResult({ type: 'backlog_item', id: 'item-1', title: 'Item' })).toEqual({ kind: 'item', itemId: 'item-1' });
    expect(navigationIntentForSearchResult({ type: 'session_plan', id: '2026-plan', title: 'Plan', refs: { session: '2026-plan' } })).toEqual({ kind: 'plan', planKey: 'plan:2026-plan' });
  });

  it('keeps epics and recommendations read-only', () => {
    expect(navigationIntentForSearchResult({ type: 'epic', id: 'epic-1', title: 'Epic' })).toEqual({ kind: 'display' });
    expect(navigationIntentForSearchResult({ type: 'recommendation', id: 'rec-1', title: 'Rec' })).toEqual({ kind: 'display' });
  });
});
