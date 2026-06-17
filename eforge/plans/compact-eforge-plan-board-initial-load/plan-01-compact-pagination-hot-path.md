---
id: plan-01-compact-pagination-hot-path
name: Harden Compact Board Pagination Hot Path
branch: compact-eforge-plan-board-initial-load/plan-01-compact-pagination-hot-path
---

# Harden Compact Board Pagination Hot Path

## Architecture Context

The workstation compact-board migration is already largely present: `use-workstation-data` loads `list-board-compact` with a bounded limit on refresh, item drawers call `get-item` lazily, the workstation allowlist omits `list-board`, and README/tests document the rich action as compatibility/debug-only.

The remaining compact-load risk is pagination state coupling in the local adapter. `list-board-compact` uses the top-level `pagination` field for both global open-board pages and selected-lane pages. The current merge helper can treat a closed-lane page as the global board page, which can overwrite open load-more state; a later global open page can also clear stored closed-lane pagination because unrelated lane summaries do not carry lane pagination.

## Implementation

### Overview

Harden the compact response merge path so global open-board pagination and explicit closed-lane pagination are stored independently while preserving the existing board view model.

### Key Decisions

1. Keep `Board.pagination` as the global open-board page cursor used by `loadMoreBoard`.
2. Keep each `BoardLane.pagination` as that lane's explicit page cursor used by `loadClosedLane`.
3. Infer selected-lane page responses from `response.lanes` entries that carry `pagination`, or add a small explicit merge option if inference is too implicit for the builder's final design.
4. Preserve existing lane pagination when a fresh global page has updated counts but no lane-specific pagination.
5. Do not change compact API schemas or action registrations unless a failing test exposes a schema mismatch.

## Scope

### In Scope

- Fix `mergeCompactLanePage` so selected-lane compact pages update only lane pagination and leave `Board.pagination` unchanged.
- Fix global open-page merges so they update `Board.pagination` and do not erase existing closed-lane pagination when the response lane summary lacks `pagination`.
- Preserve item de-duplication when open, done, and archive pages are merged in different orders.
- Add regression tests for adapter pagination isolation and hook-level action inputs after mixed open/closed page loads.
- Verify that compact pagination flows never invoke `list-board`.

### Out of Scope

- Rewriting the Backlog board components.
- Changing compact action schemas, `backlog-query-actions.ts`, or `board-actions.ts` without a demonstrated projection gap.
- Redesigning recommendation loading or item drawer behavior.
- Removing the debug-rich `list-board` action registration.

## Files

### Create

- None.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.ts` — separate global board pagination from selected-lane pagination during page merges, preserve existing lane pagination when absent from a fresh response, and keep current item de-duplication semantics.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.test.ts` — add regression tests for closed-lane page merges that do not clobber open-board pagination and global open-page merges that do not erase closed-lane cursors.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — add a hook regression test where `loadClosedLane('done')` is followed by `loadMoreBoard()` and the second call still uses the initial global open-page `nextOffset` with no `lane` input.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — modify only if the adapter fix uses an explicit merge-scope option instead of response inference; pass board scope from `loadMoreBoard` and lane scope from `loadClosedLane`.

## Verification

- [ ] Adapter tests cover a `done` lane compact page merge that leaves existing `board.pagination.nextOffset` unchanged.
- [ ] Adapter tests cover a later global open compact page merge that preserves an existing `done` lane `pagination.nextOffset`.
- [ ] Hook tests cover `loadClosedLane('done')` followed by `loadMoreBoard()` invoking `list-board-compact` with `{ limit: 50, includeArchive: true, offset: <initial nextOffset> }` and no `lane` property.
- [ ] Hook and adapter tests assert zero `list-board` invocations in compact pagination flows.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] A search for workstation `invokeAction` calls to `list-board` returns only tests or mock/debug bridge code.
