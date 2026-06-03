/**
 * QueueCard — the single forward-looking build-queue surface.
 *
 * Renders dependency-linked plans as a "Build stack" subsection (in unlock
 * order) followed by an "Other queued items" subsection for standalone
 * pending/waiting/running items not part of a stack. The queue is forward-only:
 * a failed or skipped PRD already ran, so it is not shown here — those surface
 * in the "Needs attention" strip, which owns the Recover action. No mutation
 * happens during render or expansion.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowQueueItem, NowQueueStack, NowQueueSummary } from '@/lib/selectors/now';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';
import { QueueStacks } from './queue-stack-card';

interface QueueCardProps {
  stacks?: NowQueueStack[];
  summary: NowQueueSummary;
}

function statusVariant(status: string): 'default' | 'secondary' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'running') return 'default';
  if (s === 'waiting') return 'outline';
  return 'secondary';
}

function blockedByLabel(dependsOn: string[]): string {
  return dependsOn.map((depId) => selectPrdDisplayLabel(undefined, depId)).join(', ');
}

/**
 * Forward queue work only. A failed or skipped PRD already ran and belongs in
 * the Needs attention strip (with the Recover action), not in the queue.
 */
function isForwardItem(item: NowQueueItem): boolean {
  const s = item.status.toLowerCase();
  return s !== 'failed' && s !== 'skipped';
}

function LooseQueueRow({ item }: { item: NowQueueItem }) {
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
      </div>
    </li>
  );
}

export function QueueCard({ stacks = [], summary }: QueueCardProps) {
  const [expanded, setExpanded] = React.useState(false);

  // Items already shown in the stacked view; never repeat them in the flat list.
  const stackedIds = React.useMemo(
    () => new Set(stacks.flatMap((stack) => stack.items.map((item) => item.id))),
    [stacks],
  );

  // Collapsed and full loose lists track the selector's own truncation
  // (topItems vs allItems) so the disclosure count stays consistent. Forward
  // items only — failures and skips surface in the Needs attention strip.
  const looseTop = React.useMemo(
    () => summary.topItems.filter((item) => !stackedIds.has(item.id) && isForwardItem(item)),
    [summary.topItems, stackedIds],
  );
  const looseAll = React.useMemo(
    () =>
      (summary.allItems ?? summary.topItems).filter(
        (item) => !stackedIds.has(item.id) && isForwardItem(item),
      ),
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
          <p className="text-sm text-muted-foreground">Nothing waiting to build</p>
        ) : (
          <>
            <QueueStacks stacks={stacks} />

            {looseAll.length > 0 && (
              <div className={stacks.length > 0 ? 'border-t pt-3' : undefined}>
                {stacks.length > 0 && (
                  <p className="mb-2 text-xs font-medium text-foreground">Other queued items</p>
                )}
                {summary.pendingCount > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    <span className="text-xs text-muted-foreground">
                      Pending: <span className="font-medium text-foreground">{summary.pendingCount}</span>
                    </span>
                  </div>
                )}
                <ul className="space-y-1.5">
                  {looseVisible.map((item) => (
                    <LooseQueueRow key={item.id} item={item} />
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
    </Card>
  );
}
