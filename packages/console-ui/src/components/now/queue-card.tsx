/**
 * QueueCard — the single build-queue surface.
 *
 * Renders dependency-linked plans as a "Build stack" subsection (in unlock
 * order) followed by an "Other queued items" subsection for everything not
 * part of a stack: failed items (with an explicit cascade-inspection action),
 * skipped items, and standalone pending/waiting items. Items shown in the
 * stack are not repeated in the flat list. No recovery mutation happens during
 * render or expansion.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { NowQueueItem, NowQueueStack, NowQueueSummary } from '@/lib/selectors/now';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';
import { QueueStacks } from './queue-stack-card';
import { QueueRecoveryDialog } from './queue-recovery-dialog';

interface QueueCardProps {
  stacks?: NowQueueStack[];
  summary: NowQueueSummary;
  refreshQueue?: () => Promise<void> | void;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'failed') return 'destructive';
  if (s === 'running') return 'default';
  if (s === 'skipped') return 'outline';
  return 'secondary';
}

function blockedByLabel(dependsOn: string[]): string {
  return dependsOn.map((depId) => selectPrdDisplayLabel(undefined, depId)).join(', ');
}

function LooseQueueRow({
  item,
  onInspect,
}: {
  item: NowQueueItem;
  onInspect: (item: NowQueueItem) => void;
}) {
  const isFailed = item.status.toLowerCase() === 'failed';
  return (
    <li className="flex items-start gap-2">
      <Badge variant={statusVariant(item.status)} className="shrink-0 capitalize text-xs">
        {item.status}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground truncate">{item.title}</p>
        {item.priority != null && (
          <span className="inline-block text-xs text-muted-foreground">priority {item.priority}</span>
        )}
        {item.dependsOn && item.dependsOn.length > 0 && (
          <p className="text-xs text-muted-foreground">blocked by {blockedByLabel(item.dependsOn)}</p>
        )}
        {item.recoveryVerdict && (
          <p className="text-xs text-muted-foreground">
            {item.recoveryVerdict.verdict} / {item.recoveryVerdict.confidence}
          </p>
        )}
        {!item.recoveryVerdict && isFailed && (
          <p className="text-xs text-muted-foreground">recovery pending</p>
        )}
        {isFailed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onInspect(item)}
          >
            Inspect cascade
          </Button>
        )}
      </div>
    </li>
  );
}

export function QueueCard({ stacks = [], summary, refreshQueue = () => undefined }: QueueCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [selectedRecoveryItem, setSelectedRecoveryItem] = React.useState<NowQueueItem | null>(null);

  // Items already shown in the stacked view; never repeat them in the flat list.
  const stackedIds = React.useMemo(
    () => new Set(stacks.flatMap((stack) => stack.items.map((item) => item.id))),
    [stacks],
  );

  // Collapsed and full loose lists track the selector's own truncation
  // (topItems vs allItems) so the disclosure count stays consistent.
  const looseTop = React.useMemo(
    () => summary.topItems.filter((item) => !stackedIds.has(item.id)),
    [summary.topItems, stackedIds],
  );
  const looseAll = React.useMemo(
    () => (summary.allItems ?? summary.topItems).filter((item) => !stackedIds.has(item.id)),
    [summary.allItems, summary.topItems, stackedIds],
  );

  const looseVisible = expanded ? looseAll : looseTop;
  const looseHidden = Math.max(0, looseAll.length - looseTop.length);

  const queuedCount = stackedIds.size + looseAll.length;
  const isEmpty = stacks.length === 0 && looseAll.length === 0;

  return (
    <Card id="queue">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Queue</CardTitle>
          {queuedCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {queuedCount} item{queuedCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {isEmpty ? (
          <p className="text-sm text-muted-foreground">Queue is empty</p>
        ) : (
          <>
            <QueueStacks stacks={stacks} />

            {looseAll.length > 0 && (
              <div className={stacks.length > 0 ? 'border-t pt-3' : undefined}>
                {stacks.length > 0 && (
                  <p className="mb-2 text-xs font-medium text-foreground">Other queued items</p>
                )}
                <div className="mb-2 flex flex-wrap gap-2">
                  {summary.pendingCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Pending: <span className="font-medium text-foreground">{summary.pendingCount}</span>
                    </span>
                  )}
                  {summary.failedCount > 0 && (
                    <span className="text-xs text-destructive">
                      Failed: <span className="font-medium">{summary.failedCount}</span>
                    </span>
                  )}
                  {summary.skippedCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Skipped: <span className="font-medium text-foreground">{summary.skippedCount}</span>
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {looseVisible.map((item) => (
                    <LooseQueueRow key={item.id} item={item} onInspect={setSelectedRecoveryItem} />
                  ))}
                </ul>
                {looseHidden > 0 && !expanded && (
                  <button
                    type="button"
                    className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setExpanded(true)}
                  >
                    + {looseHidden} more — show all
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
      <QueueRecoveryDialog
        open={selectedRecoveryItem != null}
        prdId={selectedRecoveryItem?.id ?? null}
        prdTitle={selectedRecoveryItem?.title}
        onOpenChange={(open) => {
          if (!open) setSelectedRecoveryItem(null);
        }}
        refreshQueue={refreshQueue}
      />
    </Card>
  );
}
