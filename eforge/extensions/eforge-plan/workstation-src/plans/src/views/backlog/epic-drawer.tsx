import * as React from 'react';
import { X } from 'lucide-react';
import { getBridge } from '@/bridge';
import { SafeMarkdown } from '@/components/safe-markdown';
import type { CompactEpic } from '@/types';

interface GetEpicResponse {
  schemaVersion: 1;
  epic: CompactEpic;
  items: unknown[];
  totalItems: number;
}

interface EpicDrawerProps {
  epicId: string;
  onClose: () => void;
}

/**
 * Read-only detail drawer for a standalone "horizon" epic - one with authored
 * body content but no backlog items, so it never appears in the kanban grouping
 * or chip row. Renders the epic's Markdown body alongside its metadata. This is
 * the interim epic-based UX for parked future ideas (see backlog item
 * add-horizon-items-to-eforge-plan); a first-class horizon item type will
 * eventually replace it, and editing belongs there rather than here.
 */
export function EpicDrawer({ epicId, onClose }: EpicDrawerProps) {
  const [epic, setEpic] = React.useState<CompactEpic | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getBridge().invokeAction<GetEpicResponse>('get-epic', { id: epicId, includeBody: true, includeItems: false })
      .then((response) => { if (!cancelled) setEpic(response.epic); })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [epicId]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const title = epic?.title ?? epicId;

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[34rem] max-w-full flex-col border-l border-border bg-card shadow-2xl" aria-label={`Horizon epic ${title}`}>
      <header className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[color:var(--lane-archive)]">Horizon epic · no items</p>
          <h3 className="mt-0.5 text-sm font-semibold leading-snug text-text-bright">{title}</h3>
          <code className="mt-1 block break-all text-2xs text-muted-foreground">{epicId}</code>
        </div>
        <button type="button" aria-label="Close details" className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && <p className="rounded border border-border bg-background p-2 text-xs text-muted-foreground">Loading epic…</p>}
        {error && <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive-foreground">{error}</p>}

        {epic && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
              <span>Status <span className="capitalize text-foreground">{epic.status}</span></span>
              {epic.priority && <span>Priority <span className="capitalize text-foreground">{epic.priority}</span></span>}
            </div>
            {epic.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {epic.tags.map((tag) => <span key={tag} className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">{tag}</span>)}
              </div>
            )}
            <div className="mt-4 border-t border-border pt-3">
              {epic.body?.trim()
                ? <SafeMarkdown markdown={epic.body} />
                : <p className="text-xs text-muted-foreground">This epic has no body content.</p>}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
