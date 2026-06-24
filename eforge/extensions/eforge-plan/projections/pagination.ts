import { paginateContributionItems } from '@eforge-build/extension-sdk';

export interface PageInput { limit?: number; offset?: number }
export interface Page<T> { entries: T[]; limit: number; offset: number; total: number }
export interface PaginationMetadata { limit: number; offset: number; returned: number; hasMore: boolean; nextOffset?: number }

export function paginateProjection<T>(entries: readonly T[], input: PageInput = {}, defaultLimit = 20, maxLimit = 100): Page<T> {
  const page = paginateContributionItems(entries, input, { defaultLimit, maxLimit });
  return { entries: page.items, limit: page.limit, offset: page.offset, total: page.total };
}

export function pageMetadata(page: Pick<Page<unknown>, 'entries' | 'limit' | 'offset'>, total: number): PaginationMetadata {
  const nextOffset = page.offset + page.entries.length;
  return { limit: page.limit, offset: page.offset, returned: page.entries.length, hasMore: nextOffset < total, ...(nextOffset < total ? { nextOffset } : {}) };
}

export function uniqueStrings(values: readonly (string | undefined | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort();
}

export function byStableId<T extends { id?: string; itemId?: string; session?: string; title?: string }>(a: T, b: T): number {
  return (a.id ?? a.itemId ?? a.session ?? a.title ?? '').localeCompare(b.id ?? b.itemId ?? b.session ?? b.title ?? '');
}
