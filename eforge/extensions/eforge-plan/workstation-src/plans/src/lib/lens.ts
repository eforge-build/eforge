import type { BoardItem } from '@/types';

export interface LensTag {
  tag: string;
  count: number;
}

// Cap the perspective bar so a tag-heavy backlog does not overflow the rail.
// The active tag is always kept even if it falls outside the top slice.
const MAX_LENS_TAGS = 16;

/**
 * Perspective candidates derived from backlog item tags, ordered by frequency
 * (most-used first, then alphabetical). Tags are the lens dimension because they
 * are multi-valued: one item can sit under several perspectives, which is what a
 * lens - unlike a container - requires. The active tag is force-included so the
 * selection never disappears from the bar after a refresh.
 */
export function collectLensTags(items: BoardItem[], active?: string): LensTag[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ordered = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]): LensTag => ({ tag, count }));
  const limited = ordered.slice(0, MAX_LENS_TAGS);
  if (active && !limited.some((entry) => entry.tag === active)) {
    limited.push(ordered.find((entry) => entry.tag === active) ?? { tag: active, count: counts.get(active) ?? 0 });
  }
  return limited;
}

/** Ids of items carrying the active perspective tag. Empty when no lens is set. */
export function lensMatchingItemIds(items: BoardItem[], tag: string): Set<string> {
  if (!tag) return new Set();
  return new Set(items.filter((item) => item.tags.includes(tag)).map((item) => item.id));
}

/** True when any of the given item ids carries the active perspective. */
export function intersectsLens(itemIds: readonly string[] | undefined, lensItemIds: Set<string>): boolean {
  if (!itemIds || lensItemIds.size === 0) return false;
  return itemIds.some((id) => lensItemIds.has(id));
}
