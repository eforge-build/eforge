---
id: plan-03-hook-signature-and-consumers
name: Replace useActiveSessionStreams return shape with reduced RunState
branch: console-ui-monitoring-overhaul-port-reducer-replace-sidebar-with-header-consolidate-routes-into-now-add-build-detail-route-and-mini-gantt-active-build-cards/plan-03-hook-signature-and-consumers
agents:
  builder:
    effort: high
    rationale: Cross-cutting type change — hook return shape, selectors, and one UI
      consumer must update together to keep the project type-checking after
      merge.
---

---
id: plan-03-hook-signature-and-consumers
name: Replace useActiveSessionStreams return shape with reduced RunState
depends_on: [plan-01-reducer-port]
---

# Replace useActiveSessionStreams return shape with reduced RunState

## Architecture Context

`use-active-session-streams.ts` currently exposes `snapshotEvents` plus a capped 50-event rolling `liveEvents` buffer per active session. This plan replaces the per-session `ActiveSessionDetail` shape with a fully reduced `runState`. The reducer landed in plan-01 is now wired in via per-session reducer state. The text-only `ActiveBuildCard` and the `selectNowActiveBuildCards` selector are updated in lockstep so the workspace remains type-clean.

This is the type-change-with-consumers boundary: the hook signature, the selector that drives the active build card view models, and the active build card itself all change in the same commit.

## Implementation

### Overview

1. Update `packages/console-ui/src/hooks/use-active-session-streams.ts`:
   - Replace `snapshotEvents`, `liveEvents`, and `liveEventCount` fields with `runState: RunState` (imported from `@/lib/run-state`).
   - On `frame.kind === 'snapshot'`: initialize per-session `RunState` to `createInitialRunState()` then call `reduce` for each event in `snapshot.events` (dispatch `reset → replay` semantics). This must be re-run on reconnect snapshots without double-counting tokens or cost — the reducer test in plan-01 covers this invariant.
   - On `frame.kind === 'event'`: dispatch `reduce(state, event)` into the per-session reducer.
   - Preserve the existing `connectionStatus`, `status`, `lastEventAt`, `error`, and terminal-session preservation behavior.
2. Update `packages/console-ui/src/lib/selectors/now.ts` `selectNowActiveBuildCards` (or wherever active-build view models are built) to consume `runState` instead of `snapshotEvents`/`liveEvents`. Extend the `NowActiveBuildCard` interface with `planProgress`, `tokens`, `cost`, `cachePercent` fields driven by the new reducer selectors.
3. Update `packages/console-ui/src/components/now/active-build-card.tsx` to read from `runState` only. The card remains text-only in this plan — the mini-Gantt strip lands in plan-05.
4. Update tests under `packages/console-ui/src/hooks/__tests__/` and `packages/console-ui/src/lib/selectors/__tests__/` (if any) for the new shape. Delete assertions that rely on `liveEvents.length` or `snapshotEvents`.

### Key Decisions

1. **Signature replacement, not addition** (D3 from PRD). The 50-event rolling buffer is gone. There is no `liveEvents` field.
2. **Per-session reducer state held in the hook**. Use a `Ref<Map<string, RunState>>` (or equivalent) plus React state for triggering renders. State updates flow through `setSessions` so consumers re-render on each reduced event.
3. **`RunState` alias at consumer sites.** The new console-ui type lives at `@/lib/run-state`. Where the daemon wire `RunState` type (from `@eforge-build/client`) is also imported, alias one as `WireRunState` to disambiguate.
4. **Selector breadth limited.** This plan adds only the fields the existing text-only `ActiveBuildCard` reads (so it can continue rendering phase/agent) plus the four new fields documented in the PRD. The mini-Gantt selector lives in plan-05.

## Scope

### In Scope
- Replace `useActiveSessionStreams` return shape.
- Extend `NowActiveBuildCard` view model with `planProgress`, `tokens`, `cost`, `cachePercent`.
- Update `ActiveBuildCard` to read from `runState`; preserve current text-only rendering.
- Update tests that asserted against the old hook shape.

### Out of Scope
- Mini-Gantt strip (plan-05).
- Whole-card click target / Inspect affordance (plan-05).
- Any shell, route, or other UI changes.

## Files

### Modify
- `packages/console-ui/src/hooks/use-active-session-streams.ts` — replace return shape; wire reducer; reset on snapshot frames.
- `packages/console-ui/src/lib/selectors/now.ts` (or `active-builds.ts` if that is where `selectNowActiveBuildCards` lives — verify at implementation time) — consume `runState`; extend `NowActiveBuildCard` interface.
- `packages/console-ui/src/components/now/active-build-card.tsx` — read from `runState` only.
- `packages/console-ui/src/lib/selectors/index.ts` — update barrel exports if signatures shift.
- `packages/console-ui/src/__tests__/use-active-session-streams.test.tsx` (or wherever the hook is tested) — assert `runState` instead of `liveEvents`.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` (or equivalent) — assert the new `NowActiveBuildCard` fields.

## Verification

- [ ] `useActiveSessionStreams` returns sessions whose detail shape includes a `runState` field of type `RunState` from `@/lib/run-state`.
- [ ] The returned session detail shape no longer includes `snapshotEvents`, `liveEvents`, or `liveEventCount` fields.
- [ ] `grep -n "liveEvents\|snapshotEvents\|liveEventCount" packages/console-ui/src/components/now/active-build-card.tsx` returns zero matches.
- [ ] `grep -rn "liveEvents\|snapshotEvents\|liveEventCount" packages/console-ui/src/lib/selectors/` returns zero matches.
- [ ] The exported `NowActiveBuildCard` interface declares `planProgress`, `tokens`, `cost`, and `cachePercent` fields.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] A hook test asserts that two consecutive `stream:hello` snapshot frames produce the same `runState.tokens` totals (snapshot replay does not double-count).
- [ ] A hook test asserts that an `agent:result` event arriving over the live channel updates the session's `runState.tokens` accumulator.
