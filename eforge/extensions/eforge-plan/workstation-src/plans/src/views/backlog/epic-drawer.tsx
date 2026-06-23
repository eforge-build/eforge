import * as React from 'react';
import { getBridge } from '@/bridge';
import { Drawer } from '@/components/ui/drawer';
import { ErrorBox } from '@/components/ui/error-box';
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

  const title = epic?.title ?? epicId;

  return (
    <Drawer
      ariaLabel={`Horizon epic ${title}`}
      eyebrow="Horizon epic · no items"
      title={title}
      subtitle={<code className="mt-1 block break-all text-2xs text-muted-foreground">{epicId}</code>}
      onClose={onClose}
    >
      {loading && <p className="rounded border border-border bg-background p-2 text-xs text-muted-foreground">Loading epic…</p>}
      {error && <ErrorBox>{error}</ErrorBox>}

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
    </Drawer>
  );
}
