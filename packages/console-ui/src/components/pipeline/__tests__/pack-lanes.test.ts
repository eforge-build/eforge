import { describe, it, expect } from 'vitest';
import { packIntoLanes } from '../pack-lanes';

interface Span {
  id: string;
  start: number;
  end: number;
}

const span = (id: string, start: number, end: number): Span => ({ id, start, end });
const pack = (items: Span[]) => packIntoLanes(items, (s) => s.start, (s) => s.end);
const ids = (lanes: Span[][]) => lanes.map((lane) => lane.map((s) => s.id));

describe('packIntoLanes', () => {
  it('returns no lanes for an empty input', () => {
    expect(pack([])).toEqual([]);
  });

  it('collapses sequential non-overlapping items onto a single lane', () => {
    const result = pack([span('a', 0, 10), span('b', 10, 20), span('c', 25, 30)]);
    expect(ids(result)).toEqual([['a', 'b', 'c']]);
  });

  it('fans concurrent items out into parallel lanes', () => {
    const result = pack([span('a', 0, 30), span('b', 5, 20), span('c', 10, 25)]);
    expect(result).toHaveLength(3);
    expect(ids(result)).toEqual([['a'], ['b'], ['c']]);
  });

  it('reuses the earliest free lane so a later item shares a freed row', () => {
    // a and b overlap (two lanes); c starts after a ends and reuses lane 0.
    const result = pack([span('a', 0, 10), span('b', 5, 30), span('c', 12, 20)]);
    expect(ids(result)).toEqual([['a', 'c'], ['b']]);
  });

  it('sorts by start time before packing regardless of input order', () => {
    const result = pack([span('c', 25, 30), span('a', 0, 10), span('b', 10, 20)]);
    expect(ids(result)).toEqual([['a', 'b', 'c']]);
  });

  it('treats touching boundaries (end === next start) as non-overlapping', () => {
    const result = pack([span('a', 0, 10), span('b', 10, 20)]);
    expect(ids(result)).toEqual([['a', 'b']]);
  });
});
