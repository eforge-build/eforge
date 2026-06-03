---
id: plan-07-monitor-queue-tests
name: Split Monitor Reducer and Queue Scheduler Tests
branch: reduce-and-refactor-oversized-test-files/plan-07-monitor-queue-tests
---

# Split Monitor Reducer and Queue Scheduler Tests

## Architecture Context

Monitor reducer and queue scheduler tests validate event projection, selectors, queue dispatch gates, and runtime lock reconciliation. Event shapes and daemon wire projections are owned by `@eforge-build/client`; split reducer tests must keep importing shared event types and not redeclare daemon wire shapes.

## Implementation

### Overview

Split the legacy monitor-ui daemon reducer test, root monitor reducer test, and queue scheduler test by projection family, selector group, policy gate, completion outcome, lock behavior, and reconciliation behavior. Extract reducer event builders and scheduler fixtures into test-only helper modules.

### Key Decisions

1. Split monitor-ui daemon reducer tests into batch/session/queue events, auto-build/connection/selectors, activity/heartbeat/lifecycle/scheduler, recovery/orphan/warning, and stack projection coverage.
2. Split root monitor reducer tests into core reducer event handling, enqueue/batch status handling, stats/selectors, usage/thread fields, and daemon run projection coverage.
3. Split queue scheduler tests into input/policy/mutation behavior, completion outcomes, pause/suspension, lock-aware startup/claimed child results, and runtime lock reconciliation.

## Scope

### In Scope

- Reduce `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts`, `test/monitor-reducer.test.ts`, and `test/queue-scheduler.test.ts` to 1,000 lines or fewer.
- Create focused reducer and scheduler test files plus helper modules under their existing test directories.
- Preserve event projection, selector, queue dispatch, pause, lock, and reconciliation assertions.

### Out of Scope

- Migrating monitor-ui tests to console-ui.
- Changes to reducer implementations, selector implementations, queue scheduler production behavior, daemon wire types, or event schemas.

## Files

### Create

- `packages/monitor-ui/src/lib/__tests__/daemon-reducer-batch-session.test.ts` — batch seed, session, enqueue, queue discovery, and queue completion reducer tests.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer-auto-build-selectors.test.ts` — auto-build, connection status, and selector tests.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer-activity-lifecycle.test.ts` — activity ring buffer, heartbeat, lifecycle, scheduler, and auto-build extension tests.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer-recovery-stack.test.ts` — recovery, orphan, warning/error, stack layer, landing update, and stack selector tests.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer-test-helpers.ts` — shared monitor-ui reducer event builders.
- `test/monitor-reducer-core.test.ts` — core reducer event handling tests.
- `test/monitor-reducer-batch-stats.test.ts` — enqueue, batch load, server status, and summary stats tests.
- `test/monitor-reducer-agent-usage.test.ts` — agent usage and effort/thinking thread field tests.
- `test/monitor-reducer-run-projection.test.ts` — event-registry run projection tests.
- `test/monitor-reducer-helpers.ts` — shared root monitor reducer event builders.
- `test/queue-scheduler-policy.test.ts` — input type, dispatch policy gate, and queue mutation tests.
- `test/queue-scheduler-completion.test.ts` — completed, skipped, failed, pause, and suspended completion tests.
- `test/queue-scheduler-locks.test.ts` — lock-aware startup and already-claimed child result tests.
- `test/queue-scheduler-reconciliation.test.ts` — runtime lock reconciliation tests.
- `test/queue-scheduler-helpers.ts` — shared scheduler queue, tracker, lock, and event fixtures.

### Modify

- `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/monitor-reducer.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/queue-scheduler.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'packages/monitor-ui/src/lib/__tests__/daemon-reducer*.test.ts' 'test/monitor-reducer*.test.ts' 'test/queue-scheduler*.test.ts'` exits 0.
- [ ] `find packages/monitor-ui/src/lib/__tests__ test -maxdepth 1 -type f \( -name 'daemon-reducer*.ts' -o -name 'monitor-reducer*.ts' -o -name 'queue-scheduler*.ts' \) -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from the three source files appears exactly once across the resulting split files.
- [ ] Monitor reducer tests import exported client event and daemon wire types instead of declaring local wire-shape interfaces.