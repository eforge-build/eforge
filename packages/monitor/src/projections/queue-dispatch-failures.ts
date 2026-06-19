import type { EforgeEvent, QueueItem } from '@eforge-build/client';
import type { EventRecord } from '../db.js';
import { hydrateEforgeEvent } from './event-hydration.js';

type QueueDispatchFailedEvent = Extract<EforgeEvent, { type: 'queue:prd:dispatch-failed' }>;
type QueueDispatchClearEvent = Extract<EforgeEvent, { type: 'queue:prd:discovered' }>;

type QueueDispatchFailureCandidate = QueueDispatchFailedEvent | QueueDispatchClearEvent;

interface LatestDispatchFailure {
  event: QueueDispatchFailedEvent;
  rowId: number;
}

interface LatestDispatchClear {
  event: QueueDispatchClearEvent;
  rowId: number;
}

function eventMillis(event: QueueDispatchFailureCandidate): number {
  const millis = Date.parse(event.timestamp);
  return Number.isFinite(millis) ? millis : 0;
}

function isNewer(candidate: QueueDispatchFailureCandidate, candidateRowId: number, current: { event: QueueDispatchFailureCandidate; rowId: number }): boolean {
  const candidateMillis = eventMillis(candidate);
  const currentMillis = eventMillis(current.event);
  return candidateMillis > currentMillis || (candidateMillis === currentMillis && candidateRowId > current.rowId);
}

export function latestQueueDispatchFailuresFromEvents(rows: EventRecord[]): Map<string, QueueItem['dispatchFailure']> {
  const latest = new Map<string, LatestDispatchFailure>();
  const clears = new Map<string, LatestDispatchClear>();
  for (const row of rows) {
    if (row.type !== 'queue:prd:dispatch-failed' && row.type !== 'queue:prd:discovered') continue;
    const event = hydrateEforgeEvent(row);
    if (event?.type === 'queue:prd:dispatch-failed') {
      const current = latest.get(event.prdId);
      if (!current || isNewer(event, row.id, current)) {
        latest.set(event.prdId, { event, rowId: row.id });
      }
    } else if (event?.type === 'queue:prd:discovered') {
      const current = clears.get(event.prdId);
      if (!current || isNewer(event, row.id, current)) {
        clears.set(event.prdId, { event, rowId: row.id });
      }
    }
  }
  return new Map([...latest.entries()]
    .filter(([prdId, failure]) => {
      const clear = clears.get(prdId);
      return !clear || isNewer(failure.event, failure.rowId, clear);
    })
    .map(([prdId, { event }]) => [
      prdId,
      { reason: event.reason, stage: event.stage, timestamp: event.timestamp },
    ]));
}

export function overlayQueueDispatchFailures(items: QueueItem[], rows: EventRecord[]): QueueItem[] {
  const latest = latestQueueDispatchFailuresFromEvents(rows);
  if (latest.size === 0) return items;

  let changed = false;
  const projected = items.map((item) => {
    const dispatchFailure = item.status === 'failed' ? latest.get(item.id) : undefined;
    if (dispatchFailure === undefined) return item;
    if (
      item.dispatchFailure?.reason === dispatchFailure.reason
      && item.dispatchFailure.stage === dispatchFailure.stage
      && item.dispatchFailure.timestamp === dispatchFailure.timestamp
    ) {
      return item;
    }
    changed = true;
    return { ...item, dispatchFailure };
  });

  return changed ? projected : items;
}
