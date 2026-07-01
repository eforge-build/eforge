---
id: plan-02-console-level-terminology
name: Console Reduce Level Terminology
branch: planner-compiler-map-to-reduce-pipelining/plan-02-console-level-terminology
---

# Console Reduce Level Terminology

## Architecture Context

The engine/client event contract uses `depth`/`maxDepth` as structural fields for reduce-tree nodes. Console and run-state selectors currently expose that grouping as "wave" or "depth" in board sections, summary copy, stories, and tests. With pipelined reducers, those labels imply phase barriers. This plan changes surfaced Console/run-state grouping terminology to `level` while keeping wire fields unchanged.

## Implementation

### Overview

Update run-state derived view models and map/reduce components so reduce-tree grouping displays as "Reduce level N" and the summary displays the active level. Preserve folding behavior for reduce-tree and reducer-status events that arrive before all map atoms are terminal.

### Key Decisions

1. Keep client event schemas and engine event payload fields named `depth`/`maxDepth` to avoid a wire contract change.
2. Rename or add derived selector fields for presentation (`currentLevel`, `maxLevel`, `Reduce level`) instead of exposing "wave" labels to components.
3. Update tests and stories to exercise reduce-tree snapshots and reducer status events interleaved with non-terminal map atoms.

## Scope

### In Scope

- Console run-state selector terminology for reduce grouping.
- Map/reduce summary, board titles, comments, and stories that currently say "wave" or present reduce grouping as depth.
- Tests for early reduce-tree/reducer-status events before map completion.
- User-facing event summary copy for map/reduce reduce-tree events if it surfaces in Console logs.

### Out of Scope

- Engine scheduler implementation.
- Client event wire-shape changes.
- Non-map/reduce queue depth, graph depth, and planning decomposition depth labels.
- Redesign of the Console map/reduce board layout.

## Files

### Create

- None.

### Modify

- `packages/console-ui/src/lib/run-state/selectors/map-reduce.ts` — replace `currentWave` presentation naming with `currentLevel`, add `maxLevel` if useful for display, rename reduce board section keys/titles from `reduce-wave-*`/`Reduce wave N` to `reduce-level-*`/`Reduce level N`, and update comments.
- `packages/console-ui/src/components/map-reduce/orchestration-summary.tsx` — display `level` instead of `wave` and consume the renamed selector fields.
- `packages/console-ui/src/components/map-reduce/stage-board.tsx` — update comments/copy that describe reduce sections as waves.
- `packages/console-ui/src/components/map-reduce/orchestration-summary.stories.tsx` — update fixture field names and story descriptions to level terminology.
- `packages/console-ui/src/components/map-reduce/orchestration-panel.stories.tsx` — update story prose to describe reduce levels.
- `packages/console-ui/src/test-support/factories.ts` — update map/reduce fixture comments to level terminology.
- `packages/console-ui/src/lib/run-state/types.ts` — clarify that stored `depth` mirrors the wire event, while Console grouping labels use levels.
- `packages/console-ui/src/lib/run-state/__tests__/handle-map-reduce.test.ts` — update expectations for `currentLevel`, section keys/titles, and early reduce status folding while atoms remain running/queued.
- `packages/client/src/event-registry.ts` — if the map/reduce reduce-tree summary is shown in Console logs, change the summary text from `depth` to `level` without changing event fields.

## Implementation Notes

- If `MapReduceSummary.currentWave` is renamed, update every TypeScript consumer in the same plan so `pnpm type-check` catches no stale references.
- Use 1-indexed display levels (`Reduce level 1`) while retaining 0-indexed `depth` internally for wire compatibility and ordering.
- Add or update a run-state test that folds atom snapshot, atom statuses, reduce-tree snapshot, and reducer status in an interleaved order with one atom still running. The expected summary must count map and reduce statuses from the same state.

## Verification

- [ ] `buildMapReduceSummary()` returns the active reduce level for a state with a running reducer and at least one map atom still running or queued.
- [ ] `buildMapReduceBoard()` returns reduce section titles `Reduce level 1`, `Reduce level 2`, with stable keys using `reduce-level-0`, `reduce-level-1`.
- [ ] `OrchestrationSummary` renders the label `level` and does not render the label `wave` for map/reduce reduce grouping.
- [ ] Run-state tests fold a reduce-tree snapshot and reducer `running` status before all atoms are terminal and report atom/reduce counts from that interleaved state.
- [ ] `rg -n "Reduce wave|reduce wave|currentWave|wave" packages/console-ui/src/components/map-reduce packages/console-ui/src/lib/run-state packages/console-ui/src/test-support/factories.ts` returns no map/reduce terminology hits.
- [ ] `pnpm test -- handle-map-reduce.test.ts` passes.