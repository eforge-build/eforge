/**
 * QueueCard — the single forward-looking build-queue surface.
 *
 * Renders, top to bottom: an "Intake" subsection for pre-build PRD formatting
 * runs (work entering the queue), the dependency-linked "Build stack"
 * subsection (in unlock order), then an "Other queued items" subsection for
 * standalone pending/waiting items not part of a stack. Running rows are not in
 * the loose list — they surface only through the stack/active-build views. The
 * queue is forward-only: a failed or skipped PRD already ran, so it is not shown
 * here — those surface in the "Needs attention" strip, which owns the Recover
 * action. When nothing is intaking, queued, or stacked the card renders nothing
 * at all (the PipelineChips carries the zero-state counts). No mutation happens
 * during render or expansion.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  NowEnqueueCard,
  NowQueueItem,
  NowQueueStack,
  NowQueueSummary,
} from '@/lib/selectors/now';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';
import { QueueStacks } from './queue-stack-card';
import { QueueIntakeLane } from './queue-intake-lane';
import { QueueRowActions } from './queue-row-actions';
import type { QueueRowActionCallbacks } from './queue-row-actions';

interface QueueCardProps extends QueueRowActionCallbacks {
  stacks?: NowQueueStack[];
  summary: NowQueueSummary;
  /** Pre-build PRD formatting runs, shown as the Intake lane. */
  enqueueCards?: NowEnqueueCard[];
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
 * Forward queue work only — pending or waiting. This matches the
 * `selectNowQueueSummary` contract, whose `topItems`/`allItems` are already
 * pending/waiting rows. A failed or skipped PRD already ran and belongs in the
 * Needs attention strip; a running PRD surfaces as an active build card. None of
 * them belong in the queue preview.
 */
function isForwardItem(item: NowQueueItem): boolean {
  const s = item.status.toLowerCase();
  return s === 'pending' || s === 'waiting';
}

function LooseQueueRow({
  item,
  onSetPriority,
  onRemove,
}: { item: NowQueueItem } & QueueRowActionCallbacks) {
  const status = item.status.toLowerCase();
  // Only forward queue work (pending/waiting) is mutable from Console; running
  // rows keep their status-only presentation.
  const showActions = status === 'pending' || status === 'waiting';
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
        {showActions && (
          <QueueRowActions
            itemId={item.id}
            itemTitle={item.title}
            initialPriority={item.priority}
            onSetPriority={onSetPriority}
            onRemove={onRemove}
          />
        )}
      </div>
    </li>
  );
}

export function QueueCard({
  stacks = [],
  summary,
  enqueueCards = [],
  onSetPriority,
  onRemove,
}: QueueCardProps) {
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

  const hasIntake = enqueueCards.length > 0;
  const hasStacks = stacks.length > 0;
  // Nothing intaking, queued, or stacked → render nothing. The PipelineChips
  // carries the zero-state counts, so an empty Queue card is pure noise.
  if (!hasIntake && !hasStacks && looseAll.length === 0) {
    return null;
  }

  return (
    <Card id="queue">
      <CardHeader className="pb-2 pt-4 px-4">
        {/* No count here: the PipelineChips is the authoritative count surface
            (Intake/Queued/Active). A second count on the card only invited
            drift, since the strip counts forward work while the stack includes
            the already-running plan as a reference row. */}
        <CardTitle className="text-sm font-semibold">Queue</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <QueueIntakeLane cards={enqueueCards} />

        {hasStacks && (
          <div className={hasIntake ? 'border-t pt-3' : undefined}>
            <QueueStacks stacks={stacks} onSetPriority={onSetPriority} onRemove={onRemove} />
          </div>
        )}

        {looseAll.length > 0 && (
          <div className={hasStacks || hasIntake ? 'border-t pt-3' : undefined}>
            {(hasStacks || hasIntake) && (
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
                <LooseQueueRow
                  key={item.id}
                  item={item}
                  onSetPriority={onSetPriority}
                  onRemove={onRemove}
                />
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
      </CardContent>
    </Card>
  );
}
