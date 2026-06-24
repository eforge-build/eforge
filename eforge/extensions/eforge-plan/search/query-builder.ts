const TOKEN_RE = /[\p{L}\p{N}_]+/gu;
const FTS_COLUMNS = ['title', 'tags_text', 'item_ids_text', 'epic_ids_text', 'recommendation_refs_text'] as const;
const FTS_BODY_COLUMNS = ['summary_text', 'body_text'] as const;

export interface BuiltFtsQuery { empty: boolean; expression: string; tokens: string[] }

export function tokenizeFtsQuery(query: string | undefined): string[] {
  const normalized = (query ?? '').normalize('NFKC').toLowerCase();
  return Array.from(normalized.matchAll(TOKEN_RE), (m) => m[0]).filter((token) => token.length > 0).slice(0, 24);
}

function quoteToken(token: string): string { return `"${token.replace(/"/g, '""')}"`; }

export function buildFtsQuery(query: string | undefined, input: { searchBody?: boolean } = {}): BuiltFtsQuery {
  const tokens = tokenizeFtsQuery(query);
  if (tokens.length === 0) return { empty: true, expression: '', tokens };
  const columns = input.searchBody === true ? [...FTS_COLUMNS, ...FTS_BODY_COLUMNS] : FTS_COLUMNS;
  const scope = `{${columns.join(' ')}}`;
  return { empty: false, expression: tokens.map((token) => `${scope} : ${quoteToken(token)}`).join(' AND '), tokens };
}
