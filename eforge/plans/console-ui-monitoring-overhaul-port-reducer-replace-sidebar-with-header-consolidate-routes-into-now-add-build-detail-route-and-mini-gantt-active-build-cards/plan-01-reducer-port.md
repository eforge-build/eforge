---
id: plan-01-reducer-port
name: Port session reducer into console-ui
branch: console-ui-monitoring-overhaul-port-reducer-replace-sidebar-with-header-consolidate-routes-into-now-add-build-detail-route-and-mini-gantt-active-build-cards/plan-01-reducer-port
agents:
  builder:
    effort: high
    rationale: Pure-logic port of 11 handlers plus tests; mechanical but volume is
      high and reducer correctness is the foundation everything downstream
      depends on.
---

---
id: plan-01-reducer-port
name: Port session reducer into console-ui
depends_on: []
---

# Port session reducer into console-ui

## Architecture Context

The console-ui currently retains only a 50-event rolling buffer per active session in `use-active-session-streams.ts`, so per-session aggregates (tokens, cost, cache stats, plan statuses, agent threads, decisions, file changes, validation commands) are unavailable to any view. The legacy `monitor-ui` package has a fully-tested reducer at `packages/monitor-ui/src/lib/reducer.ts` plus 11 handler files under `packages/monitor-ui/src/lib/reducer/handle-*.ts` that reduce `EforgeEvent` streams into a `RunState`.

This plan ports that reducer subsystem into `packages/console-ui/src/lib/run-state/` as a pure subsystem with no React, DOM, or fetch dependencies. It depends only on `@eforge-build/client` for `EforgeEvent` types. No UI is wired to the reducer in this plan — that happens in plan-03.

Monitor-ui keeps its own copy. Dual-ship constraint is acknowledged: new daemon event types require updating both reducers until monitor-ui is deleted (a future PRD).

## Implementation

### Overview

Create `packages/console-ui/src/lib/run-state/` with `reducer.ts`, `types.ts`, a `format.ts` helper, a `handlers/` directory containing the 11 handler files plus a `handler-types.ts` and `index.ts` registry, a `selectors/` directory with `summary-stats.ts`, `plan-progress.ts`, and `stack-layers.ts`, and a `__tests__/` directory with one test file per handler plus `reducer.test.ts` and `selectors.test.ts`.

Port verbatim from the monitor-ui equivalents, adjusting only:
- Module-relative import paths.
- Any imports of `@eforge-build/client` types — keep wire-type imports identical.
- The `RunState` type name stays the same; place the type in `types.ts` so import sites alias as needed.

Add a top-of-file comment block to `reducer.ts` documenting the dual-reducer constraint and pointing at the monitor-ui counterpart (R1 mitigation).

Export the public API from `src/lib/run-state/index.ts`: `reduce`, `createInitialRunState`, `RunState`, `AgentThread`, `DecisionPoint`, `PipelineStage`, selector functions.

### Key Decisions

1. **Pure subsystem, no React.** `src/lib/run-state/` imports nothing from `react` or `react-dom`. Tests use vitest directly without `@testing-library/react`.
2. **Selectors co-located.** `selectors/summary-stats.ts` (aggregates for `SummaryCards`), `selectors/plan-progress.ts` (plan status counts, current stage per plan, mini-Gantt rows), `selectors/stack-layers.ts` (ported `selectStackLayersForRun`). Each is pure and testable in isolation.
3. **One test file per handler.** Ports the existing monitor-ui handler tests one-to-one so behavior parity is enforced.

## Scope

### In Scope
- Create `src/lib/run-state/` directory with files listed below.
- Port reducer, 11 handlers, selectors, and tests from monitor-ui.
- Wire the public exports via `src/lib/run-state/index.ts`.

### Out of Scope
- Any change to `use-active-session-streams.ts` (plan-03).
- Any change to selectors in `src/lib/selectors/` (plan-03).
- Any UI component changes (plan-03 onwards).
- Deletion or modification of the monitor-ui reducer (future PRD).

## Files

### Create
- `packages/console-ui/src/lib/run-state/index.ts` — public exports.
- `packages/console-ui/src/lib/run-state/types.ts` — `RunState`, `AgentThread`, `DecisionPoint`, `PipelineStage`, related types ported from monitor-ui `src/lib/types.ts` and `src/lib/reducer/handler-types.ts`.
- `packages/console-ui/src/lib/run-state/reducer.ts` — top-level reduce dispatch with dual-reducer constraint comment.
- `packages/console-ui/src/lib/run-state/format.ts` — format helpers used by handlers (ported from `monitor-ui/src/lib/format.ts` only the symbols the reducer needs; leave UI-only formatters in monitor-ui).
- `packages/console-ui/src/lib/run-state/handlers/handler-types.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-agent.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-daemon.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-decisions.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-enqueue.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-expedition.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-misc.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-plan-build.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-plan-lifecycle.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-planning.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-session.ts`
- `packages/console-ui/src/lib/run-state/handlers/handle-validation.ts`
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — handler registry.
- `packages/console-ui/src/lib/run-state/selectors/summary-stats.ts`
- `packages/console-ui/src/lib/run-state/selectors/plan-progress.ts`
- `packages/console-ui/src/lib/run-state/selectors/stack-layers.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-expedition.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-misc.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-plan-lifecycle.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-planning.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-session.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-validation.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/reducer.test.ts` — covers the snapshot-replay-without-double-counting case (mitigates R3).
- `packages/console-ui/src/lib/run-state/__tests__/selectors.test.ts`

### Modify
None in this plan.

## Verification

- [ ] `packages/console-ui/src/lib/run-state/reducer.ts` exists on disk.
- [ ] `packages/console-ui/src/lib/run-state/handlers/` contains exactly 12 files: 11 `handle-*.ts` files plus `handler-types.ts` and `index.ts`.
- [ ] `packages/console-ui/src/lib/run-state/selectors/` contains exactly 3 files: `summary-stats.ts`, `plan-progress.ts`, `stack-layers.ts`.
- [ ] `packages/console-ui/src/lib/run-state/__tests__/` contains at least 13 test files (11 handler tests + reducer.test.ts + selectors.test.ts).
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `reducer.test.ts` includes an assertion that reducing two `agent:result` events accumulates `tokensIn`, `tokensOut`, `cacheRead`, `cacheCreation`, and `totalCost` to the sum of both event payloads.
- [ ] `reducer.test.ts` includes an assertion that reducing a sequence of plan lifecycle events transitions `planStatuses[planId]` through `pending` → `running` → `completed` in order.
- [ ] `reducer.test.ts` includes an assertion that reducing a sequence ending in `session:end` with `result.status === 'failed'` produces `RunState.resultStatus === 'failed'`.
- [ ] `reducer.test.ts` includes an assertion that reducing `agent:start` followed by `agent:result` produces an `AgentThread` with populated `startedAt`, `durationMs`, `inputTokens`, `outputTokens`, `costUsd`, `numTurns`, and `model` fields.
- [ ] `reducer.test.ts` includes an assertion that re-receiving a `stream:hello` snapshot frame resets `RunState` and replays the snapshot events without double-counting tokens or cost.
- [ ] `reducer.ts` contains a top-of-file comment referencing the dual-reducer constraint and pointing to `packages/monitor-ui/src/lib/reducer.ts`.
- [ ] `grep -rn "from 'react'" packages/console-ui/src/lib/run-state/` returns zero matches.
- [ ] No file under `packages/console-ui/src/lib/run-state/` imports from `react-dom`, `fetch`, or any DOM API.
