import * as React from 'react';
import type { QueueStatusGroup as QueueStatusGroupModel } from '@/lib/selectors/queue';
import { QueueItemRow } from './queue-item-row';
import { Badge } from '@/components/ui/badge';

interface QueueStatusGroupProps {
  group: QueueStatusGroupModel;
}

/**
 * Renders a status group heading and a list of queue item rows.
 */
export function QueueStatusGroup({ group }: QueueStatusGroupProps) {
  return (
    <section aria-label={`${group.label} items`}>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {group.label}
        </h2>
        <Badge variant="secondary" className="text-xs px-1.5 py-0">
          {group.items.length}
        </Badge>
        {!group.known && (
          <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground">
            unknown status
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {group.items.map((item) => (
          <QueueItemRow key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
