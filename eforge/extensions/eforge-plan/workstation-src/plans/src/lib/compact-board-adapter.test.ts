import { describe, expect, it } from 'vitest';
import { getMockCompactBoard, getMockCompactItemDetail, mockRecommendations } from '@/fixtures/mock-data';
import { boardFromCompact, mergeCompactItemDetail, mergeCompactLanePage } from './compact-board-adapter';

describe('compact board adapter', () => {
  it('renders open lane cards from compact items without body or note text', () => {
    const board = boardFromCompact(getMockCompactBoard({ limit: 10 }), mockRecommendations);

    expect(board.items.some((item) => item.id === 'legacy-cleanup')).toBe(false);
    expect(board.items[0]?.notes.claim).toBe('');
    expect(JSON.stringify(board)).not.toContain('Users want a dry-run preview');
  });

  it('keeps closed lane counts when closed cards are absent', () => {
    const board = boardFromCompact(getMockCompactBoard({ limit: 10 }), null);
    const done = board.lanes.find((lane) => lane.lane === 'done');

    expect(board.counts?.closed).toBe(1);
    expect(done).toMatchObject({ count: 1, closedCount: 1, items: [] });
  });

  it('attaches recommendation ranks and lanes', () => {
    const board = boardFromCompact(getMockCompactBoard({ limit: 10 }), mockRecommendations);
    const recommended = board.items.find((item) => item.id === 'recommend-next-work');

    expect(recommended?.recRank).toBe(1);
    expect(recommended?.recLanes).toContain('Planning foundations');
  });

  it('defaults compact dependency refs from ids and unresolved blockers', () => {
    const board = boardFromCompact(getMockCompactBoard({ limit: 10 }), null);
    const blocked = board.items.find((item) => item.id === 'auto-mode');

    expect(blocked?.dependencies).toEqual([expect.objectContaining({ id: 'traceability', title: 'traceability', blocking: true, missing: false })]);
  });

  it('merges closed lane pages and item detail fields', () => {
    const initial = boardFromCompact(getMockCompactBoard({ limit: 10 }), mockRecommendations);
    const withClosed = mergeCompactLanePage(initial, getMockCompactBoard({ lane: 'done', includeClosed: true, limit: 10 }), mockRecommendations);
    const closed = withClosed.items.find((item) => item.id === 'legacy-cleanup');

    expect(closed).toBeDefined();
    const detailed = mergeCompactItemDetail(withClosed.items.find((item) => item.id === 'add-import-preview')!, getMockCompactItemDetail('add-import-preview'));
    expect(detailed.notes.claim).toContain('Users want');
    expect(detailed.lifecycleLinks?.length).toBeGreaterThan(0);
  });
});
