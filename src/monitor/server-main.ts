/**
 * Detached monitor server entry point.
 *
 * Runs as a detached child process. Polls SQLite for new events,
 * serves SSE to subscribers, detects orphaned runs, and auto-shuts
 * down when idle using a WATCHING → COUNTDOWN → SHUTDOWN state machine.
 *
 * Usage: node dist/server-main.js <dbPath> <port> <cwd>
 */

import { openDatabase } from './db.js';
import { startServer } from './server.js';
import { writeLockfile, removeLockfile, isPidAlive } from './lockfile.js';

const ORPHAN_CHECK_INTERVAL_MS = 5000;
const STATE_CHECK_INTERVAL_MS = 2000;
const COUNTDOWN_WITH_SUBSCRIBERS_MS = 60_000;
const COUNTDOWN_WITHOUT_SUBSCRIBERS_MS = 10_000;
const IDLE_FALLBACK_MS = 10_000;

export type ServerState = 'WATCHING' | 'COUNTDOWN' | 'SHUTDOWN';

export interface StateCheckContext {
  state: ServerState;
  lastActivityTimestamp: number;
  hasSeenActivity: boolean;
  serverStartedAt: number;
  getRunningRuns: () => { id: string }[];
  getLatestEventTimestamp: () => string | undefined;
  transitionToCountdown: () => void;
  cancelCountdown: () => void;
}

/**
 * Core state-check logic extracted for testability.
 * Returns updated mutable fields (state, lastActivityTimestamp, hasSeenActivity).
 */
export function evaluateStateCheck(ctx: StateCheckContext): {
  state: ServerState;
  lastActivityTimestamp: number;
  hasSeenActivity: boolean;
} {
  const runningRuns = ctx.getRunningRuns();
  const hasRunning = runningRuns.length > 0;
  let { state, lastActivityTimestamp, hasSeenActivity } = ctx;

  if (hasRunning) {
    lastActivityTimestamp = Date.now();
    if (state === 'COUNTDOWN') {
      ctx.cancelCountdown();
      state = 'WATCHING';
    }
    return { state, lastActivityTimestamp, hasSeenActivity };
  }

  // No running runs
  if (state === 'WATCHING') {
    const latestTimestamp = ctx.getLatestEventTimestamp();
    if (latestTimestamp) {
      const eventTime = new Date(latestTimestamp).getTime();
      if (eventTime > lastActivityTimestamp) {
        lastActivityTimestamp = eventTime;
      }
      if (!hasSeenActivity && eventTime >= ctx.serverStartedAt) {
        hasSeenActivity = true;
      }
    }

    if (!hasSeenActivity) {
      return { state, lastActivityTimestamp, hasSeenActivity };
    }

    const idleMs = Date.now() - lastActivityTimestamp;
    if (idleMs >= IDLE_FALLBACK_MS) {
      ctx.transitionToCountdown();
      state = 'COUNTDOWN';
    }
    return { state, lastActivityTimestamp, hasSeenActivity };
  }

  return { state, lastActivityTimestamp, hasSeenActivity };
}

async function main(): Promise<void> {
  const serverStartedAt = Date.now();
  const [dbPath, portStr, cwd] = process.argv.slice(2);
  if (!dbPath || !portStr || !cwd) {
    console.error('Usage: server-main <dbPath> <port> <cwd>');
    process.exit(1);
  }

  const preferredPort = parseInt(portStr, 10);
  const db = openDatabase(dbPath);

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(db, preferredPort, { cwd });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      // Another server won the race — exit cleanly
      db.close();
      process.exit(0);
    }
    throw err;
  }

  // Write lockfile
  writeLockfile(cwd, {
    pid: process.pid,
    port: server.port,
    startedAt: new Date().toISOString(),
  });

  // --- State machine ---
  let state: ServerState = 'WATCHING';
  let countdownStartedAt = 0;
  let lastActivityTimestamp = Date.now();
  let hasSeenActivity = false;

  function countdownDurationMs(): number {
    return server.subscriberCount > 0
      ? COUNTDOWN_WITH_SUBSCRIBERS_MS
      : COUNTDOWN_WITHOUT_SUBSCRIBERS_MS;
  }

  function transitionToCountdown(): void {
    if (state === 'COUNTDOWN') return;
    state = 'COUNTDOWN';
    countdownStartedAt = Date.now();
    const durationSec = Math.round(countdownDurationMs() / 1000);
    server.broadcast('monitor:shutdown-pending', JSON.stringify({ countdown: durationSec }));
  }

  function cancelCountdown(): void {
    if (state !== 'COUNTDOWN') return;
    state = 'WATCHING';
    countdownStartedAt = 0;
    lastActivityTimestamp = Date.now();
    server.broadcast('monitor:shutdown-cancelled', JSON.stringify({}));
  }

  // Wire keep-alive to reset countdown
  server.onKeepAlive = () => {
    lastActivityTimestamp = Date.now();
    if (state === 'COUNTDOWN') {
      // Reset countdown rather than transitioning back to WATCHING -
      // this avoids re-entering the watching state without an actual running run
      countdownStartedAt = Date.now();
      const durationSec = Math.round(countdownDurationMs() / 1000);
      server.broadcast('monitor:shutdown-cancelled', JSON.stringify({}));
      server.broadcast('monitor:shutdown-pending', JSON.stringify({ countdown: durationSec }));
    }
  };

  // Orphan detection loop
  const orphanTimer = setInterval(() => {
    try {
      const runningRuns = db.getRunningRuns();
      for (const run of runningRuns) {
        if (run.pid && !isPidAlive(run.pid)) {
          db.updateRunStatus(run.id, 'killed');
        }
      }
    } catch {
      // DB might be closed during shutdown
    }
  }, ORPHAN_CHECK_INTERVAL_MS);
  orphanTimer.unref();

  // State machine check loop
  const stateTimer = setInterval(() => {
    try {
      const result = evaluateStateCheck({
        state,
        lastActivityTimestamp,
        hasSeenActivity,
        serverStartedAt,
        getRunningRuns: () => db.getRunningRuns(),
        getLatestEventTimestamp: () => db.getLatestEventTimestamp(),
        transitionToCountdown,
        cancelCountdown,
      });
      state = result.state;
      lastActivityTimestamp = result.lastActivityTimestamp;
      hasSeenActivity = result.hasSeenActivity;

      if (state === 'COUNTDOWN') {
        const elapsed = Date.now() - countdownStartedAt;
        if (elapsed >= countdownDurationMs()) {
          state = 'SHUTDOWN';
          shutdown();
        }
      }
    } catch {
      // DB might be closed during shutdown
    }
  }, STATE_CHECK_INTERVAL_MS);
  stateTimer.unref();

  let isShuttingDown = false;

  function shutdown(): void {
    if (isShuttingDown) return;
    isShuttingDown = true;

    clearInterval(orphanTimer);
    clearInterval(stateTimer);

    removeLockfile(cwd);

    server.stop().then(() => {
      db.close();
      process.exit(0);
    }).catch(() => {
      db.close();
      process.exit(1);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Disconnect stdio so the parent process can exit
  if (process.stdout.isTTY === false || process.send === undefined) {
    // We're a detached child — detach stdio
    process.stdin.destroy();
    process.stdout.destroy();
    process.stderr.destroy();
  }
}

// Only auto-execute when run as an entry point (not when imported for testing)
const isEntryPoint = process.argv[1] &&
  (process.argv[1].endsWith('server-main.js') || process.argv[1].endsWith('server-main.ts'));
if (isEntryPoint) {
  main().catch((err) => {
    console.error('Monitor server failed:', err);
    process.exit(1);
  });
}
