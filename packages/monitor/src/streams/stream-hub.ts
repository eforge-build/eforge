import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EforgeEvent } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import type { MonitorStreamHub } from '../types.js';
import { reactToDaemonEvent } from '../daemon-event-reactions.js';
import {
  attachDaemonStream,
  buildHeartbeatObject as buildDaemonHeartbeat,
  deliverDaemonDeltas,
  type DaemonSubscriber,
  type StreamClock,
} from './daemon-stream.js';
import { hydrateEforgeEvent } from './event-parser.js';
import { attachSessionStream, deliverSessionDeltas, type SessionSubscriber } from './session-stream.js';
import { safeEnd, writeJsonDataFrame, writeNamedFrame } from './sse.js';

const POLL_INTERVAL_MS = 200;
const HEARTBEAT_INTERVAL_MS = 10_000;
const WALL_CLOCK: StreamClock = { now: () => Date.now() };

type TimerHandle = ReturnType<typeof setInterval>;

export interface StreamHubOptions {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  clock?: StreamClock;
}

export interface StreamHub extends Omit<MonitorStreamHub, 'attachSession' | 'attachDaemon' | 'subscriberCount' | 'buildHeartbeatObject'> {
  attachSession(req: IncomingMessage, res: ServerResponse, id: string): void;
  attachDaemon(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  subscriberCount(): number;
  buildHeartbeatObject(): unknown;
  flush(): Promise<void>;
}

export function createStreamHub(context: MonitorContext, options: StreamHubOptions = {}): StreamHub {
  const sessionSubscribers = new Set<SessionSubscriber>();
  const daemonSubscribers = new Set<DaemonSubscriber>();
  const clock = options.clock ?? WALL_CLOCK;
  const startedAtMs = clock.now();
  let reactionCursor = context.db.getMaxDaemonEventId();
  let stopped = false;
  let reactionScan: Promise<void> | null = null;

  const pollTimer = setInterval(() => {
    void runPollCycle();
  }, options.pollIntervalMs ?? POLL_INTERVAL_MS);
  unrefTimer(pollTimer);

  const heartbeatTimer = setInterval(() => {
    emitDaemonHeartbeat();
  }, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  unrefTimer(heartbeatTimer);

  function subscriberCount(): number {
    return sessionSubscribers.size + daemonSubscribers.size;
  }

  function heartbeatOptions() {
    return { startedAtMs, subscriberCount: daemonSubscribers.size, clock };
  }

  function buildHeartbeatObject(): unknown {
    return buildDaemonHeartbeat(context, heartbeatOptions());
  }

  async function runPollCycle(): Promise<void> {
    if (stopped) return;
    await scanDaemonReactions();
    deliverSessionSubscribers();
    deliverDaemonSubscribers();
  }

  function emitDaemonHeartbeat(): void {
    if (stopped || daemonSubscribers.size === 0) return;
    const heartbeat = buildHeartbeatObject();
    for (const subscriber of daemonSubscribers) {
      try {
        writeJsonDataFrame(subscriber.res, heartbeat);
      } catch {
        // Subscriber may have disconnected.
      }
    }
  }

  async function scanDaemonReactions(): Promise<void> {
    if (!context.options.daemonState) return;
    if (reactionScan !== null) return reactionScan;
    const currentScan = (async () => {
      try {
        const rows = context.db.getDaemonEventsAfter(reactionCursor);
        for (const row of rows) {
          let parsed: EforgeEvent | null;
          try {
            parsed = hydrateEforgeEvent(row);
          } catch {
            if (row.id > reactionCursor) reactionCursor = row.id;
            continue;
          }
          if (parsed) {
            await reactToDaemonEvent(parsed, {
              notifyQueueMutation: (reason) => context.options.daemonState?.autoBuildController.notifyQueueMutation(reason),
              finalizeQueuePrdCompletion: context.options.daemonState?.finalizeQueuePrdCompletion,
            });
          }
          if (row.id > reactionCursor) reactionCursor = row.id;
        }
      } catch {
        // Best-effort: reaction errors must not affect stream delivery.
      }
    })();
    reactionScan = currentScan;
    try {
      await currentScan;
    } finally {
      if (reactionScan === currentScan) reactionScan = null;
    }
  }

  function deliverSessionSubscribers(): void {
    for (const subscriber of sessionSubscribers) {
      try {
        deliverSessionDeltas(context, subscriber);
      } catch {
        // Subscriber may have disconnected.
      }
    }
  }

  function deliverDaemonSubscribers(): void {
    for (const subscriber of daemonSubscribers) {
      try {
        deliverDaemonDeltas(context, subscriber);
      } catch {
        // Subscriber may have disconnected.
      }
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    for (const subscriber of sessionSubscribers) safeEnd(subscriber.res);
    for (const subscriber of daemonSubscribers) safeEnd(subscriber.res);
    sessionSubscribers.clear();
    daemonSubscribers.clear();
  }

  return {
    attachSession(req: IncomingMessage, res: ServerResponse, id: string): void {
      attachSessionStream({ context, subscribers: sessionSubscribers, req, res, id });
    },
    attachDaemon(req: IncomingMessage, res: ServerResponse): Promise<void> {
      return attachDaemonStream({ context, subscribers: daemonSubscribers, req, res, ...heartbeatOptions() });
    },
    broadcast(eventName: string, data: string | EforgeEvent): void {
      for (const subscriber of sessionSubscribers) {
        try {
          writeNamedFrame(subscriber.res, eventName, data);
        } catch {
          // Subscriber may have disconnected.
        }
      }
    },
    subscriberCount,
    stop,
    buildHeartbeatObject,
    async flush(): Promise<void> {
      await runPollCycle();
      emitDaemonHeartbeat();
    },
  };
}

function unrefTimer(timer: TimerHandle): void {
  const candidate = timer as TimerHandle & { unref?: () => void };
  if (typeof candidate.unref === 'function') candidate.unref();
}
