import type { SearchResult } from '@/types';

export type SearchNavigationIntent =
  | { kind: 'item'; itemId: string }
  | { kind: 'plan'; planKey: string }
  | { kind: 'display' };

export function navigationIntentForSearchResult(result: SearchResult): SearchNavigationIntent {
  if (result.type === 'backlog_item') return { kind: 'item', itemId: result.id };
  if (result.type === 'session_plan') {
    const session = result.refs?.session ?? result.id.replace(/^plan:/, '');
    return { kind: 'plan', planKey: session.startsWith('plan:') ? session : `plan:${session}` };
  }
  return { kind: 'display' };
}
