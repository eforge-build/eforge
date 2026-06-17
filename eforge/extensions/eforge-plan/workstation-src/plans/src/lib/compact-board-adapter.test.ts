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

  it('keeps global open-board pagination when merging a done lane page', () => {
    const initialResponse = getMockCompactBoard({ limit: 2 });
    const initial = boardFromCompact({
      ...initialResponse,
      pagination: { limit: 2, offset: 0, returned: initialResponse.items.length, hasMore: true, nextOffset: 37 },
    }, mockRecommendations);
    const donePage = getMockCompactBoard({ lane: 'done', includeClosed: true, limit: 1, offset: 0 });

    const merged = mergeCompactLanePage(initial, donePage, mockRecommendations);

    expect(merged.pagination?.nextOffset).toBe(37);
    expect(merged.lanes.find((lane) => lane.lane === 'done')?.pagination?.nextOffset).toBeUndefined();
    expect(merged.items.filter((item) => item.id === 'legacy-cleanup')).toHaveLength(1);
  });

  it('preserves closed-lane pagination when merging a later global open page', () => {
    const initial = boardFromCompact(getMockCompactBoard({ limit: 2 }), mockRecommendations);
    const donePage = getMockCompactBoard({ lane: 'done', includeClosed: true, limit: 1, offset: 0 });
    const donePagination = { limit: 1, offset: 0, returned: donePage.items.length, hasMore: true, nextOffset: 1 };
    const withDone = mergeCompactLanePage(initial, {
      ...donePage,
      pagination: donePagination,
      lanes: donePage.lanes.map((lane) => lane.lane === 'done' ? { ...lane, pagination: donePagination } : lane),
    }, mockRecommendations);

    const globalPage = getMockCompactBoard({ limit: 2, offset: 2 });
    const merged = mergeCompactLanePage(withDone, globalPage, mockRecommendations);

    expect(merged.pagination?.offset).toBe(2);
    expect(merged.lanes.find((lane) => lane.lane === 'done')?.pagination?.nextOffset).toBe(1);
    expect(merged.items.filter((item) => item.id === 'legacy-cleanup')).toHaveLength(1);
  });
});
