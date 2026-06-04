/**
 * QueueStacks — presentational render of dependency-linked queued plans, shown
 * in unlock order. Rendered as a subsection inside the merged QueueCard (no
 * Card chrome of its own). Returns null when there are no multi-item stacks.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import type { NowQueueStack, NowQueueStackItem } from '@/lib/selectors/now';
import { cn } from '@/lib/utils';
import { QueueRowActions } from './queue-row-actions';
import type { QueueRowActionCallbacks } from './queue-row-actions';

interface QueueStacksProps extends QueueRowActionCallbacks {
  stacks: NowQueueStack[];
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'failed') return 'destructive';
  if (s === 'running') return 'default';
  if (s === 'waiting') return 'outline';
  return 'secondary';
}

function statusSummary(stack: NowQueueStack): string {
  const parts: string[] = [];
  if (stack.activeCount > 0) parts.push(`${stack.activeCount} running`);
  if (stack.waitingCount > 0) parts.push(`${stack.waitingCount} waiting`);
  if (stack.pendingCount > 0) parts.push(`${stack.pendingCount} pending`);
  return parts.join(' · ');
}

function itemDetail(item: NowQueueStackItem): string {
  if (item.blockedBy.length > 0) {
    return `blocked by ${item.blockedBy.join(', ')}`;
  }
  if (item.status.toLowerCase() === 'running') {
    return item.unlocksCount > 0
      ? `currently running · unlocks ${item.unlocksCount} plan${item.unlocksCount !== 1 ? 's' : ''}`
      : 'currently running';
  }
  if (item.unlocksCount > 0) {
    return `unlocks ${item.unlocksCount} plan${item.unlocksCount !== 1 ? 's' : ''}`;
  }
  return 'ready when dependencies clear';
}

function QueueStackItemRow({
  item,
  isLast,
  onSetPriority,
  onRemove,
}: { item: NowQueueStackItem; isLast: boolean } & QueueRowActionCallbacks) {
  const status = item.status.toLowerCase();
  // Only forward queue work (pending/waiting) is mutable from Console; running
  // rows keep their status-only presentation.
  const showActions = status === 'pending' || status === 'waiting';
  return (
    <li className="relative pl-6">
      {!isLast && <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden="true" />}
      <span
        className={cn(
          'absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border bg-background',
          item.status.toLowerCase() === 'running' ? 'border-primary bg-primary' : 'border-muted-foreground/50',
        )}
        aria-hidden="true"
      />
      <div className="rounded-md border bg-muted/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Layer {item.layer} / {item.totalLayers}
          </span>
          <Badge variant={statusVariant(item.status)} className="capitalize text-xs">
            {item.status}
          </Badge>
        </div>
        <p className="mt-1 text-sm font-medium text-foreground">{item.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{itemDetail(item)}</p>
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

export function QueueStacks({ stacks, onSetPriority, onRemove }: QueueStacksProps) {
  if (stacks.length === 0) return null;

  const totalPlans = stacks.reduce((sum, stack) => sum + stack.totalItems, 0);

  return (
    <section aria-label="Build stack">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-foreground">Build stack</p>
          <p className="text-xs text-muted-foreground">
            Dependency-linked plans, shown in unlock order.
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {totalPlans} stacked plan{totalPlans !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-4">
        {stacks.map((stack, stackIndex) => (
          <div key={stack.id} aria-label={`Build stack ${stackIndex + 1}`}>
            {stacks.length > 1 && (
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Stack {stackIndex + 1}</span>
                <span>{statusSummary(stack)}</span>
              </div>
            )}
            {stacks.length === 1 && statusSummary(stack) && (
              <p className="mb-2 text-xs text-muted-foreground">{statusSummary(stack)}</p>
            )}
            <ol className="space-y-2">
              {stack.items.map((item, itemIndex) => (
                <QueueStackItemRow
                  key={item.id}
                  item={item}
                  isLast={itemIndex === stack.items.length - 1}
                  onSetPriority={onSetPriority}
                  onRemove={onRemove}
                />
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
