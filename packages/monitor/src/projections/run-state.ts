import type { RunState } from '@eforge-build/client';
import type { MonitorDB } from '../db.js';
import { deriveRunStateStatus, hydrateEventRecordForRunState } from './event-hydration.js';

export function buildRunState(db: MonitorDB, sessionId: string): RunState {
  return {
    status: deriveRunStateStatus(db.getSessionRuns(sessionId)),
    events: db.getEventsBySession(sessionId).flatMap((row) => {
      const hydrated = hydrateEventRecordForRunState(row);
      return hydrated ? [hydrated] : [];
    }),
  };
}
