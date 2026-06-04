import { isPersistedDaemonEventType } from '@eforge-build/client';
import type { MonitorDB } from './db.js';

/**
 * Write a daemon-scoped persisted event to the SQLite event log as a daemon-owned row.
 * Best-effort: DB failures are swallowed so diagnostics never crash the daemon.
 */
export function writeDaemonEvent(
  db: MonitorDB,
  event: { type: string } & Record<string, unknown>,
  daemonSessionId: string,
): void {
  try {
    if (!isPersistedDaemonEventType(event.type)) return;
    const now = new Date().toISOString();
    db.insertDaemonEvent({
      type: event.type,
      data: JSON.stringify({ sessionId: daemonSessionId, ...event, timestamp: now }),
      timestamp: now,
    });
  } catch {
    // Best-effort: DB may be closed or temporarily unavailable during shutdown.
  }
}
