/**
 * QueueStacks — presentational render of dependency-linked queued plans, shown
 * in unlock order. Rendered as a subsection inside the merged QueueCard (no
 * Card chrome of its own). Returns null when there are no multi-item stacks.
 */
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import type { NowQueueStack, NowQueueStackItem } from '@/lib/selectors/now';
import { QueueRowActions } from './queue-row-actions';
import type { QueueRowActionCallbacks } from './queue-row-actions';
import type { PrioritySibling } from './queue-priority-dialog';

interface QueueStacksProps extends QueueRowActionCallbacks {
  stacks: NowQueueStack[];
  /** Forward queue items for the priority dialog's presets and landing preview. */
  prioritySiblings?: PrioritySibling[];
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
  if (item.unlocksCount > 0) {
    return `unlocks ${item.unlocksCount} plan${item.unlocksCount !== 1 ? 's' : ''}`;
  }
  return 'ready when dependencies clear';
}

function unlocksLabel(item: NowQueueStackItem): string | null {
  if (item.unlocksCount <= 0) return null;
  return `unlocks ${item.unlocksCount} plan${item.unlocksCount !== 1 ? 's' : ''}`;
}

/**
 * A running stack item is already shown in full as an active build card above,
 * so it collapses to a thin reference row here: it holds its place in the
 * dependency chain (node, connector, layer, title), points back to the detailed
 * card, and renders only daemon-capability-gated PRD cancel controls.
 */
function RunningStackRow({ item, isLast, onPreviewCascade, onApplyCascade }: { item: NowQueueStackItem; isLast: boolean } & QueueRowActionCallbacks) {
  const unlocks = unlocksLabel(item);
  return (
    <li className="relative pl-6">
      {!isLast && <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden="true" />}
      <span
        className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border border-primary bg-primary"
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-xs text-muted-foreground">
        <span>Layer {item.layer} / {item.totalLayers}</span>
        <span className="min-w-0 truncate font-medium text-foreground/80" title={item.title}>
          {item.title}
        </span>
        <span className="text-foreground/70">running ↑</span>
        <span aria-hidden="true">·</span>
        <span>see above{unlocks ? ` · ${unlocks}` : ''}</span>
        <span className="ml-auto">
          <QueueRowActions
            itemId={item.id}
            itemTitle={item.title}
            showCancel
            hold={item.hold}
            capabilities={item.capabilities}
            onPreviewCascade={onPreviewCascade}
            onApplyCascade={onApplyCascade}
          />
        </span>
      </div>
    </li>
  );
}

function QueueStackItemRow({
  item,
  isLast,
  prioritySiblings,
  onSetPriority,
  onOverrideDependency,
  onHold,
  onUnhold,
  onPreviewCascade,
  onApplyCascade,
}: { item: NowQueueStackItem; isLast: boolean; prioritySiblings?: PrioritySibling[] } & QueueRowActionCallbacks) {
  const status = item.status.toLowerCase();
  if (status === 'running') {
    return <RunningStackRow item={item} isLast={isLast} onPreviewCascade={onPreviewCascade} onApplyCascade={onApplyCascade} />;
  }
  // Pending/waiting rows expose the full queue-control set; running rows are
  // handled above and only expose PRD cancel controls when daemon capabilities
  // allow it.
  const showActions = status === 'pending' || status === 'waiting';
  return (
    <li className="relative pl-6">
      {!isLast && <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden="true" />}
      <span
        className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border border-muted-foreground/50 bg-background"
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
          {item.priority != null && (
            <Badge variant="outline" className="text-xs tabular-nums">P: {item.priority}</Badge>
          )}
          {item.hold?.held === true && <Badge variant="outline" className="text-xs">Held</Badge>}
          {showActions && (
            <span className="ml-auto">
              <QueueRowActions
                itemId={item.id}
                itemTitle={item.title}
                initialPriority={item.priority}
                prioritySiblings={prioritySiblings}
                onSetPriority={onSetPriority}
                dependencyIds={item.dependsOn}
                onOverrideDependency={onOverrideDependency}
                onHold={onHold}
                onUnhold={onUnhold}
                onPreviewCascade={onPreviewCascade}
                onApplyCascade={onApplyCascade}
                hold={item.hold}
                capabilities={item.capabilities}
              />
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-foreground">{item.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{itemDetail(item)}</p>
        {item.hold?.reason && <p className="text-xs text-muted-foreground">hold: {item.hold.reason}</p>}
      </div>
    </li>
  );
}

export function QueueStacks({
  stacks,
  prioritySiblings,
  onSetPriority,
  onOverrideDependency,
  onHold,
  onUnhold,
  onPreviewCascade,
  onApplyCascade,
}: QueueStacksProps) {
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
                  prioritySiblings={prioritySiblings}
                  onSetPriority={onSetPriority}
                  onOverrideDependency={onOverrideDependency}
                  onHold={onHold}
                  onUnhold={onUnhold}
                  onPreviewCascade={onPreviewCascade}
                  onApplyCascade={onApplyCascade}
                />
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
