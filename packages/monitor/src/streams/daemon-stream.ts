import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DaemonStreamSnapshot } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { autoBuildStateToWire, buildDaemonHeartbeatObject } from '../projections/auto-build-state.js';
import { overlayQueueDispatchFailures } from '../projections/queue-dispatch-failures.js';
import { countPendingQueueDepth, loadQueueItemsSync } from '../projections/queue-items.js';
import { projectRunsForAcceptedSuccess } from '../projections/runs.js';
import { stackLayersToWire } from '../projections/stack-layers.js';
import { writeHello } from '../sse-handshake.js';
import { loadSyncStatusForRouteSync } from '../stack-sync-service.js';
import { hydrateEforgeEvent, hydrateRecentDaemonActivity } from './event-parser.js';
import { parseLastEventIdHeader, writeJsonDataFrame, writeSseHeaders } from './sse.js';

export interface DaemonSubscriber {
  res: ServerResponse;
  lastSeenId: number;
}

export interface StreamClock {
  now(): number;
}

export interface DaemonStreamSnapshotOptions {
  startedAtMs: number;
  subscriberCount: number;
  clock: StreamClock;
}

export interface AttachDaemonStreamInput extends DaemonStreamSnapshotOptions {
  context: MonitorContext;
  subscribers: Set<DaemonSubscriber>;
  req: IncomingMessage;
  res: ServerResponse;
}

export function attachDaemonStream(input: AttachDaemonStreamInput): void {
  const { context, subscribers, req, res } = input;
  writeSseHeaders(res);

  const { cursor, snapshot } = buildDaemonHello(context, input);
  writeHello(res, cursor, snapshot);

  const lastEventId = parseLastEventIdHeader(req.headers);
  let lastSeenId = lastEventId ?? cursor;
  if (lastEventId !== undefined) {
    lastSeenId = replayDaemonEvents(context, res, lastEventId);
  }

  const subscriber: DaemonSubscriber = { res, lastSeenId };
  subscribers.add(subscriber);
  req.on('close', () => {
    subscribers.delete(subscriber);
  });
}

export function buildDaemonHello(
  context: MonitorContext,
  options: DaemonStreamSnapshotOptions,
): { cursor: number; snapshot: DaemonStreamSnapshot } {
  const cursor = context.db.getMaxDaemonEventId();
  const stackSyncStatus = context.cwd ? loadSyncStatusForRouteSync(context.cwd) : { version: 1 as const };
  const stackSyncStatusWire = stackSyncStatus.last !== undefined || stackSyncStatus.current !== undefined
    ? ({ last: stackSyncStatus.last, current: stackSyncStatus.current } as DaemonStreamSnapshot['stackSyncStatus'])
    : undefined;
  const snapshot: DaemonStreamSnapshot = {
    cursor,
    liveness: buildHeartbeatObject(context, options),
    recentActivity: hydrateRecentDaemonActivity(context.db.getDaemonEventsAfter(Math.max(0, cursor - 20)), cursor),
    runs: projectRunsForAcceptedSuccess(context.db.getRuns(), context.queuePaths?.queueDir),
    queue: context.cwd && context.queuePaths
      ? overlayQueueDispatchFailures(loadQueueItemsSync(context.queuePaths.queueDir, context.queuePaths.lockDir), context.db.getDaemonEventsAfter(0))
      : [],
    sessionMetadata: context.db.getSessionMetadataBatch(),
    autoBuild: autoBuildStateToWire({
      state: context.options.daemonState,
      capacity: { runningCount: context.getRunningBuildCount(), limit: context.getSchedulerLimit() },
    }),
    stackLayers: context.cwd ? stackLayersToWire(context.cwd) : [],
    ...(stackSyncStatusWire !== undefined ? { stackSyncStatus: stackSyncStatusWire } : {}),
  };
  return { cursor, snapshot };
}

export function buildHeartbeatObject(
  context: MonitorContext,
  options: DaemonStreamSnapshotOptions,
): DaemonStreamSnapshot['liveness'] {
  const runningBuilds = context.getRunningBuildCount();
  return buildDaemonHeartbeatObject({
    state: context.options.daemonState,
    capacity: { runningCount: runningBuilds, limit: context.getSchedulerLimit() },
    now: options.clock.now(),
    startedAtMs: options.startedAtMs,
    queueDepth: getQueueDepth(context),
    runningBuilds,
    subscriberCount: options.subscriberCount,
  });
}

export function deliverDaemonDeltas(context: MonitorContext, subscriber: DaemonSubscriber): void {
  const newEvents = context.db.getDaemonEventsAfter(subscriber.lastSeenId);
  for (const event of newEvents) {
    const parsed = hydrateEforgeEvent(event);
    if (!parsed) continue;
    writeJsonDataFrame(subscriber.res, parsed, event.id);
    if (event.id > subscriber.lastSeenId) subscriber.lastSeenId = event.id;
  }
}

function replayDaemonEvents(context: MonitorContext, res: ServerResponse, lastEventId: number): number {
  let lastSeenId = lastEventId;
  const historicalEvents = context.db.getDaemonEventsAfter(lastEventId);
  for (const event of historicalEvents) {
    const parsed = hydrateEforgeEvent(event);
    if (!parsed) continue;
    writeJsonDataFrame(res, parsed, event.id);
    if (event.id > lastSeenId) lastSeenId = event.id;
  }
  return lastSeenId;
}

function getQueueDepth(context: MonitorContext): number {
  if (!context.cwd || !context.queuePaths) return 0;
  return countPendingQueueDepth(context.cwd, context.queuePaths.relativeQueueDir);
}
