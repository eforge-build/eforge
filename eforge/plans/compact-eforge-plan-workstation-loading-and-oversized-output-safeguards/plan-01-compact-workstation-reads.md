---
id: plan-01-compact-workstation-reads
name: Compact Workstation Board Reads
branch: compact-eforge-plan-workstation-loading-and-oversized-output-safeguards/plan-01-compact-workstation-reads
agents:
  builder:
    effort: high
    rationale: The workstation data flow changes board API projections, UI state,
      lazy detail loading, and tests across the extension and iframe app.
  tester:
    effort: high
    rationale: The plan needs focused UI hook/component tests plus extension action
      tests to prove rich board data is off the initial path.
---

# Compact Workstation Board Reads

## Architecture Context

The eforge-plan workstation currently uses the rich `list-board` contribution during its initial refresh. That action returns full board cards, lifecycle rows, trace summaries, and item note data. The desired invariant is compact-first and lazy-detail: initial refresh loads bounded open-board shell data plus counts and identifiers; detail drawers and closed lanes load with targeted actions.

The extension already has compact query actions (`list-board-compact`, `get-item`, `get-epic`, `search-items`), but the workstation does not use them and the compact projections do not yet carry enough count/detail metadata for the existing UI without falling back to `list-board`.

## Implementation

### Overview

Replace the workstation initial board refresh with `list-board-compact` and adapter-backed board state. Extend compact projections only for the workstation shell, counts, identifiers, lifecycle summary, and lazy drawer/detail requirements. Keep rich `list-board` registered as compatibility/debug data, but remove it from the workstation hot path and workstation allowed-action surface.

### Key Decisions

1. Use a workstation adapter between compact contribution responses and existing `Board`/`BoardItem` components. This limits UI churn while preventing detail/body fields from entering initial state.
2. Make compact board defaults open-first. Closed `done` and `archive` items are excluded from initial `items`, while lane/count metadata reports their counts.
3. Fetch item drawer content through `get-item` only after a drawer opens. The adapter merges detail fields into the selected summary for drawer rendering and edit flow state.
4. Load closed lane records only through explicit UI actions: selecting the closed filter or expanding a closed lane rail requests a paginated compact lane read.

## Scope

### In Scope

- Extend `list-board-compact` output with explicit lane counts, total/open/closed counts, pagination metadata, and compact fields required by cards.
- Add compact item/detail types in the workstation source tree.
- Add an adapter that maps compact board, compact item detail, epics, lifecycle summary, and recommendations into existing board types.
- Update initial refresh to call `list-board-compact` with a bounded limit and never call `list-board`.
- Add lazy `get-item` detail fetch in `ItemDrawer`.
- Add explicit closed lane pagination/loading through `list-board-compact` inputs such as `lane`, `includeClosed`, `includeArchive`, `limit`, and `offset`.
- Remove `list-board` from `planning-workstation.allowedActions`.
- Update mock bridge and fixtures to cover compact board reads and lazy item detail.
- Update eforge-plan README sections describing compact vs rich board reads.

### Out of Scope

- Removing the rich `list-board` action.
- Replacing eforge-plan storage.
- New workflow scheduling or orchestration behavior.
- Adding new daemon routes.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.ts` — map compact board/detail responses into current workstation `Board`/`BoardItem` shapes, merge closed lane pages, compute derived selection/dependency metadata, and attach recommendation ranks from `get-recommendations`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.test.ts` — unit tests for compact lane rendering, closed counts, recommendation badges, dependency relation defaults, and detail merge behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/item-drawer.test.tsx` — component tests for lazy `get-item` fetch, loading/error rendering, and edit flow preservation.

### Modify

- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — add open-first compact board behavior, closed-lane opt-in inputs, lane/count metadata, continuation metadata, compact lifecycle summary fields, and detail output fields needed by the drawer (`sections`, dependency/dependent summaries, `linkRows`/`failureEvidence` where detail display needs them). Keep body output opt-in.
- `eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts` — assert default compact board excludes closed records but reports done/archive counts, and assert explicit closed lane reads return paginated closed records.
- `eforge/extensions/eforge-plan/index.ts` — remove `list-board` from workstation `allowedActions`; keep it registered and keep declarative compatibility/debug entry points if still present.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert the workstation allowlist excludes `list-board` while compact/detail actions remain allowed.
- `eforge/extensions/eforge-plan/README.md` — document compact initial workstation reads, lazy `get-item` detail, explicit closed lane reads, and rich `list-board` as compatibility/debug data.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add compact board/detail response interfaces, optional `BoardLane.count`/pagination/count fields, and a detail-loading state type.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — replace initial `list-board` invocation with bounded `list-board-compact`, preserve independent artifact/recommendation loading, expose a closed-lane loader if the board component needs it, and merge results through the adapter.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — assert initial refresh calls `list-board-compact` and not `list-board`; assert counts and recommendation status map into state.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board-model.ts` — support count-only lanes, avoid assuming note/detail fields are present on compact cards, and keep filters/selection derived from compact card fields.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board-model.test.ts` — assert count-only done/archive lanes produce collapsed rails and compact cards group by lane/epic/recommendation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board.tsx` — render done/archive counts without loaded cards, invoke closed-lane loading when users select closed filtering or expand a closed lane, and surface continuation text when a lane page is partial.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` — pass lane-loading handlers and selected summary item ids into the board/drawer flow.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/item-drawer.tsx` — fetch `get-item` lazily on open, display loading/error states, render detail sections/dependencies/lifecycle from the fetched detail, and continue to invoke `update-item` for status/priority/epic edits.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — support `list-board-compact` and `get-item` in the mock bridge.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add compact board/detail fixtures derived from the existing mock board without bodies in the initial compact payload.

## Verification

- [ ] `use-workstation-data` tests record zero `list-board` calls during initial refresh.
- [ ] Initial refresh tests record one bounded `list-board-compact` call.
- [ ] Compact board adapter tests render open lane cards from compact items without body or note text.
- [ ] Compact count tests report done/archive counts when closed cards are absent from initial `board.items`.
- [ ] Closed-lane tests invoke `list-board-compact` with explicit closed-lane input before closed card records enter board state.
- [ ] Drawer tests record a `get-item` call only after opening an item drawer.
- [ ] Drawer tests render fetched sections/dependency summaries and keep `update-item` save inputs unchanged.
- [ ] Registration tests assert `planning-workstation.allowedActions` excludes `list-board` and includes compact/detail actions.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test` exits 0.
- [ ] `pnpm exec vitest run eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
