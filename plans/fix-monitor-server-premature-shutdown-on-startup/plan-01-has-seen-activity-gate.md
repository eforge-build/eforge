---
id: plan-01-has-seen-activity-gate
name: Add hasSeenActivity Gate to Prevent Premature Shutdown
depends_on: []
branch: fix-monitor-server-premature-shutdown-on-startup/has-seen-activity-gate
---

# Add hasSeenActivity Gate to Prevent Premature Shutdown

## Architecture Context

The monitor server (`src/monitor/server-main.ts`) runs as a detached child process with a WATCHING → COUNTDOWN → SHUTDOWN state machine. The CLI takes 20+ seconds before emitting its first event (engine setup, enqueue formatting agent call). During that gap the server sees no running runs and no events, hits the 10s idle threshold, transitions to COUNTDOWN, and shuts down before the CLI records anything.

The fix adds a startup-awareness gate: the server records when it started and refuses to enter the countdown path until it has observed at least one event with a timestamp >= its own start time. This preserves all existing shutdown behavior once events have flowed.

## Implementation

### Overview

Add a `serverStartedAt` timestamp and `hasSeenActivity` boolean flag to the state machine in `server-main.ts`. In the WATCHING state handler, after querying `db.getLatestEventTimestamp()`, check whether any event timestamp >= `serverStartedAt`. Only evaluate the idle/countdown logic once `hasSeenActivity` is true.

### Key Decisions

1. **Gate on event timestamp, not run existence** — The CLI may not have created a run record yet when the server starts. Checking event timestamps is more reliable since even early lifecycle events (like `session:start`) will satisfy the gate.
2. **`serverStartedAt` uses `Date.now()` at the top of `main()`** — This captures the actual process start, not the time after server binding. Keeps the comparison simple and avoids edge cases where server binding takes variable time.
3. **No new DB queries** — The existing `db.getLatestEventTimestamp()` call already provides everything needed. The gate piggybacks on that result.

## Scope

### In Scope
- Adding `serverStartedAt` constant and `hasSeenActivity` flag in `server-main.ts`
- Gating the WATCHING → COUNTDOWN transition on `hasSeenActivity`
- Adding a test in `test/monitor-shutdown.test.ts` that verifies the gate prevents premature shutdown

### Out of Scope
- Changes to the CLI event emission timing
- Changes to the monitor DB schema
- Changes to countdown/shutdown behavior after events have flowed

## Files

### Modify
- `src/monitor/server-main.ts` — Add `serverStartedAt` timestamp and `hasSeenActivity` flag; gate the idle-time evaluation in the WATCHING branch on `hasSeenActivity` being true
- `test/monitor-shutdown.test.ts` — Add a dedicated test suite for the server-main state machine `hasSeenActivity` gate (test that WATCHING does not transition to COUNTDOWN when no events have timestamps >= serverStartedAt, and does transition once an event satisfies the gate)

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 — including the new `hasSeenActivity` test case
- [ ] `pnpm build` exits with code 0
- [ ] In `server-main.ts`, the WATCHING state handler returns early (no countdown transition) when `hasSeenActivity` is false
- [ ] In `server-main.ts`, after an event with timestamp >= `serverStartedAt` is observed, the idle/countdown logic runs as before
- [ ] The `hasSeenActivity` flag is only set to true, never reset to false (one-way latch)
