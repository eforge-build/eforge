import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DaemonStreamSnapshot } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { buildDaemonHeartbeatObject } from '../projections/auto-build-state.js';
import { countPendingQueueDepth } from '../projections/queue-items.js';
import { projectAutoBuildForContext, projectFailedEnqueuesForContext, projectQueueForContext, projectRunsForContext, projectSessionMetadataForContext } from '../projections/monitor-state.js';
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

export async function attachDaemonStream(input: AttachDaemonStreamInput): Promise<void> {
  const { context, subscribers, req, res } = input;
  writeSseHeaders(res);

  const { cursor, snapshot } = await buildDaemonHello(context, input);
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

export async function buildDaemonHello(
  context: MonitorContext,
  options: DaemonStreamSnapshotOptions,
): Promise<{ cursor: number; snapshot: DaemonStreamSnapshot }> {
  const cursor = context.db.getMaxDaemonEventId();
  const stackSyncStatus = context.cwd ? loadSyncStatusForRouteSync(context.cwd) : { version: 1 as const };
  const stackSyncStatusWire = stackSyncStatus.last !== undefined || stackSyncStatus.current !== undefined
    ? ({ last: stackSyncStatus.last, current: stackSyncStatus.current } as DaemonStreamSnapshot['stackSyncStatus'])
    : undefined;
  const snapshot: DaemonStreamSnapshot = {
    cursor,
    liveness: buildHeartbeatObject(context, options),
    recentActivity: hydrateRecentDaemonActivity(context.db.getDaemonEventsAfter(Math.max(0, cursor - 20)), cursor),
    runs: projectRunsForContext(context),
    queue: await projectQueueForContext(context),
    sessionMetadata: projectSessionMetadataForContext(context),
    autoBuild: projectAutoBuildForContext(context),
    failedEnqueues: projectFailedEnqueuesForContext(context),
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
