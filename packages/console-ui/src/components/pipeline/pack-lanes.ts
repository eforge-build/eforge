/** Greedy interval packing: place items into the minimum number of lanes so
 *  that no two items on the same lane overlap in time. Items are sorted by
 *  start and assigned to the first lane whose last item ends at or before the
 *  item's start. Sequential (non-overlapping) work collapses onto one lane;
 *  genuinely concurrent work fans out into parallel lanes.
 *
 *  Within a returned lane, items keep their true start/end positions - callers
 *  position bars absolutely, so real idle gaps between items remain visible. */
export function packIntoLanes<T>(
  items: readonly T[],
  getStart: (item: T) => number,
  getEnd: (item: T) => number,
): T[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => getStart(a) - getStart(b));
  const lanes: T[][] = [];
  const laneEnds: number[] = [];
  for (const item of sorted) {
    const start = getStart(item);
    const end = getEnd(item);
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (laneEnds[i] <= start) {
        lanes[i].push(item);
        laneEnds[i] = end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([item]);
      laneEnds.push(end);
    }
  }
  return lanes;
}
