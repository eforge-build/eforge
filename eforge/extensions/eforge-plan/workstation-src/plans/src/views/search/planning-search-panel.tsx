import * as React from 'react';
import { Search } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Button } from '@/components/ui/button';
import { RailCard } from '@/components/ui/rail-card';
import { ErrorBox } from '@/components/ui/error-box';
import type { JsonObject, SearchDocumentType, SearchPlanningRecordsResponse, SearchResult } from '@/types';
import { navigationIntentForSearchResult } from '@/lib/search-result-routing';

const TYPES: SearchDocumentType[] = ['backlog_item', 'epic', 'session_plan', 'recommendation'];
const DEFAULT_LIMIT = 20;

export function PlanningSearchPanel({ openItem, openPlan }: { openItem: (id: string) => void; openPlan: (key: string) => void }) {
  const [query, setQuery] = React.useState('');
  const [selectedTypes, setSelectedTypes] = React.useState<SearchDocumentType[]>(TYPES);
  const [page, setPage] = React.useState<SearchPlanningRecordsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const runSearch = React.useCallback(async (offset = 0) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (selectedTypes.length === 0) { setError('Select at least one result type.'); setPage(null); return; }
    setLoading(true); setError(null);
    try {
      const response = await getBridge().invokeAction<SearchPlanningRecordsResponse>('search-planning-records', {
        query: trimmed,
        limit: DEFAULT_LIMIT,
        offset,
        fields: ['rank', 'snippet', 'refs', 'updatedAt'],
        types: selectedTypes,
      } as unknown as JsonObject);
      setPage(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [query, selectedTypes]);

  return (
    <RailCard icon={Search} title="Planning search" contentClassName="grid gap-2">
      <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void runSearch(0); }}>
        <input aria-label="Search planning records" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search items, epics, plans…" className="h-8 rounded border border-input bg-background px-2 text-xs" />
        <div className="flex flex-wrap gap-1">
          {TYPES.map((type) => (
            <label key={type} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">
              <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => setSelectedTypes((current) => current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type])} />
              {type.replace('_', ' ')}
            </label>
          ))}
        </div>
        {selectedTypes.length === 0 && <p className="text-2xs text-destructive">Select at least one result type.</p>}
        <Button size="sm" type="submit" disabled={loading || query.trim().length === 0 || selectedTypes.length === 0}>{loading ? 'Searching…' : 'Search'}</Button>
      </form>
      {error && <ErrorBox>{error}</ErrorBox>}
      {page?.indexDirty && <p className="rounded border border-[color:var(--prio-medium)]/40 bg-[color:var(--prio-medium)]/10 p-1.5 text-2xs text-[color:var(--prio-medium)]">Search index dirty: {page.indexStatus.dirtyCount} documents need rebuild.</p>}
      {page && <Counts counts={page.countsByType} />}
      <div className="grid gap-1">
        {page?.results.map((result) => <ResultRow key={`${result.type}:${result.id}`} result={result} openItem={openItem} openPlan={openPlan} />)}
      </div>
      {page && (
        <div className="flex items-center justify-between text-2xs text-muted-foreground">
          <span>{page.page.returned} of {page.total} results · offset {page.page.offset}</span>
          {page.page.hasMore && <Button size="xs" variant="outline" onClick={() => void runSearch(page.page.nextOffset ?? page.page.offset + page.page.returned)}>Next</Button>}
        </div>
      )}
    </RailCard>
  );
}

function Counts({ counts }: { counts: SearchPlanningRecordsResponse['countsByType'] }) {
  return <div className="flex flex-wrap gap-1 text-2xs text-muted-foreground">{TYPES.map((type) => <span key={type} className="rounded border border-border px-1">{type.replace('_', ' ')}: {counts[type] ?? 0}</span>)}</div>;
}

function ResultRow({ result, openItem, openPlan }: { result: SearchResult; openItem: (id: string) => void; openPlan: (key: string) => void }) {
  const intent = navigationIntentForSearchResult(result);
  const content = <><span className="block text-2xs uppercase tracking-wide text-muted-foreground">{result.type.replace('_', ' ')}</span><span className="block text-xs font-medium text-text-bright">{result.title}</span>{result.snippet && <Snippet text={result.snippet.text} />}</>;
  if (intent.kind === 'item') return <button type="button" onClick={() => openItem(intent.itemId)} className="rounded border border-border p-2 text-left hover:border-primary">{content}</button>;
  if (intent.kind === 'plan') return <button type="button" onClick={() => openPlan(intent.planKey)} className="rounded border border-border p-2 text-left hover:border-primary">{content}</button>;
  return <div className="rounded border border-border bg-muted/20 p-2">{content}</div>;
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(<mark>|<\/mark>)/g);
  let marked = false;
  return <p className="mt-1 text-2xs text-muted-foreground">{parts.map((part, index) => { if (part === '<mark>') { marked = true; return null; } if (part === '</mark>') { marked = false; return null; } return marked ? <mark key={index} className="rounded bg-primary/20 px-0.5 text-foreground">{part}</mark> : <React.Fragment key={index}>{part}</React.Fragment>; })}</p>;
}
