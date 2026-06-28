# Fix Removed Queue Coverage Cleanup

## Problem

A queue cleanup change removed coverage around completed and failed queue entries. The planner shape that exposed the failure involved inspecting queue scheduler dispatch, cleanup, monitor run state projection, and client-owned daemon wire shapes. This fixture is intentionally bounded and synthetic; it must not require provider calls.

## Required outcome

Restore focused coverage that proves queue cleanup does not remove active/running work and that removed completed entries no longer leak into queue snapshots.

## Relevant areas

- `packages/engine/src/queue/scheduler.ts`
- `packages/monitor/src/server.ts`
- `packages/client/src/api/queue.ts`
- `packages/console-ui/src/lib/run-state/handlers/index.ts`
- `test/queue-cleanup.test.ts`

## Constraints

- Do not inline daemon `/api/...` routes outside `@eforge-build/client`.
- Do not re-declare daemon queue wire shapes in monitor packages.
- Preserve existing retry-as-expedition and bounded-decomposition safeguards.
- Keep tests synthetic and StubHarness-driven.

## Acceptance criteria

- Queue cleanup coverage captures completed-item removal.
- Failed dispatch queue rows keep their failure diagnostics until explicitly resolved.
- Active/running rows are never removed by cleanup.
- The planner can summarize the inspection from bounded tool/usage events without replaying a full transcript.
