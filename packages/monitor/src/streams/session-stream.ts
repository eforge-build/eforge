import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SessionStreamSnapshot } from '@eforge-build/client';
import type { MonitorContext } from '../context.js';
import { writeHello } from '../sse-handshake.js';
import { deriveSessionStreamStatus, hydrateEforgeEvent } from './event-parser.js';
import { parseLastEventIdHeader, safeEnd, writeJsonDataFrame, writeSseHeaders } from './sse.js';

export interface SessionSubscriber {
  res: ServerResponse;
  sessionId: string;
  lastSeenId: number;
}

export interface AttachSessionStreamInput {
  context: MonitorContext;
  subscribers: Set<SessionSubscriber>;
  req: IncomingMessage;
  res: ServerResponse;
  id: string;
}

export function buildSessionHello(context: MonitorContext, id: string): { sessionId: string; cursor: number; snapshot: SessionStreamSnapshot } {
  const sessionId = context.resolveSessionId(id);
  const allSessionEvents = context.db.getEventsBySession(sessionId);
  const cursor = allSessionEvents.length > 0 ? allSessionEvents[allSessionEvents.length - 1].id : 0;
  const status = deriveSessionStreamStatus(context.db.getSessionRuns(sessionId));
  return {
    sessionId,
    cursor,
    snapshot: {
      cursor,
      status,
      events: allSessionEvents.map((event) => ({ id: event.id, data: event.data })),
    },
  };
}

export function attachSessionStream(input: AttachSessionStreamInput): void {
  const { context, subscribers, req, res, id } = input;
  writeSseHeaders(res);

  const hello = buildSessionHello(context, id);
  writeHello(res, hello.cursor, hello.snapshot);

  if (hello.snapshot.status === 'completed' || hello.snapshot.status === 'failed') {
    safeEnd(res);
    return;
  }

  const lastEventId = parseLastEventIdHeader(req.headers);
  let lastSeenId = lastEventId ?? hello.cursor;

  if (lastEventId !== undefined) {
    lastSeenId = replaySessionEvents(context, res, hello.sessionId, lastEventId);
  }

  const subscriber: SessionSubscriber = { res, sessionId: hello.sessionId, lastSeenId };
  subscribers.add(subscriber);
  req.on('close', () => {
    subscribers.delete(subscriber);
  });
}

export function deliverSessionDeltas(context: MonitorContext, subscriber: SessionSubscriber): void {
  const newEvents = context.db.getEventsBySession(subscriber.sessionId, subscriber.lastSeenId);
  for (const event of newEvents) {
    const parsed = hydrateEforgeEvent(event);
    if (!parsed) continue;
    writeJsonDataFrame(subscriber.res, parsed, event.id);
    if (event.id > subscriber.lastSeenId) subscriber.lastSeenId = event.id;
  }
}

function replaySessionEvents(context: MonitorContext, res: ServerResponse, sessionId: string, lastEventId: number): number {
  let lastSeenId = lastEventId;
  const historicalEvents = context.db.getEventsBySession(sessionId, lastEventId);
  for (const event of historicalEvents) {
    const parsed = hydrateEforgeEvent(event);
    if (!parsed) continue;
    writeJsonDataFrame(res, parsed, event.id);
    if (event.id > lastSeenId) lastSeenId = event.id;
  }
  return lastSeenId;
}
