---
id: plan-04-runs-filters-day-groups-detail-density
name: Runs Filters, Day Groups, and Detail Density
branch: polish-console-ui-state-branding-density-naming-and-theme-tokens/plan-04-runs-filters-day-groups-detail-density
agents:
  builder:
    effort: high
    rationale: Runs changes combine selector state, URL/detail selection, responsive
      layout, grouping, and component tests.
---

# Runs Filters, Day Groups, and Detail Density

## Architecture Context

Runs remains a read-only Console route backed by existing daemon run/session metadata. This plan changes only Console selectors/components and preserves `useRunDetail` API calls through shared client route helpers.

## Implementation

### Overview

Add status/command/search filtering, group historical runs by day, remove repeated project cwd from every row, display a single project chip once, and replace the duplicate responsive detail panel with one DOM instance.

### Key Decisions

1. Put filter predicates and day bucketing in `lib/selectors/runs.ts` so rendering components receive grouped view models.
2. Accept an optional `now` prop on `RunsView` for deterministic Today/Yesterday/Older tests.
3. Render a single `RunDetailPanel` instance in a responsive container rather than separate desktop/mobile instances.
4. Use `truncateId(..., 12)` for session identifiers in rows and move profile text from rows to the selected detail panel context.

## Scope

### In Scope

- Add Runs filter bar with status chips: all, running, failed, completed.
- Add command chips: all, enqueue, compile, build.
- Add one text input whose accessible name indicates run search.
- Filter by rollup status, command list, and normalized label/session text.
- Group historical rows under day headers `Today`, `Yesterday`, and `Older` using a pure helper that accepts `now`.
- Coalesce PRD-level rows from plan 02 remain visible under the correct day bucket.
- Hide repeated project `cwd` on history rows and active run rows.
- Render one project chip in the Runs header showing `basename(cwd)` once.
- Remove the Runs header shadcn `Card` wrapper.
- Remove top-level `p-4` from Runs view containers.
- Render session identifiers through `truncateId` with a maximum display length of 12 characters.
- Move profile display to the selected `RunDetailPanel` context and remove `profile:` text from row metadata.
- Replace stream status palette utility classes in Runs with theme-token or shadcn Badge variants.
- Add/update Runs component tests for filtering, day grouping, cwd display, project chip, truncated session id, and one detail panel instance.

### Out of Scope

- Full legacy monitor detail parity.
- New daemon routes or client wire types.
- Activity or System model progressive disclosure.

## Files

### Create

- `packages/console-ui/src/views/runs/runs-filter-bar.tsx` — status chips, command chips, and search input.
- `packages/console-ui/src/views/runs/runs-day-groups.tsx` — day-section rendering for grouped history rows.

### Modify

- `packages/console-ui/src/lib/selectors/runs.ts` — add filter state/types, `filterRunGroups`, `bucketRunGroupsByDay`, project basename helper if kept selector-local, and exported constants for chip options.
- `packages/console-ui/src/views/runs/runs-view.tsx` — manage filter state, remove `p-4`, render header without Card, show one project chip, render one detail panel, and pass `now` to day grouping.
- `packages/console-ui/src/views/runs/run-history-table.tsx` — render compact metadata without cwd/profile, use truncated session id, and support day-group composition.
- `packages/console-ui/src/views/runs/active-runs-panel.tsx` — remove repeated cwd, use tokenized stream status styling, and keep selected run behavior.
- `packages/console-ui/src/views/runs/run-detail-panel.tsx` — add a stable test id, accept selected group context when needed, and render profile in the detail area.
- `packages/console-ui/src/views/runs/status-pill.tsx` — ensure palette classes use semantic token/shadcn variants.
- `packages/console-ui/src/views/runs/time-format.ts` — reuse or align with shared format helpers where needed.
- `packages/console-ui/src/__tests__/runs-selectors.test.ts` — add day bucketing and filtering tests.
- `packages/console-ui/src/__tests__/runs-view.test.tsx` — add chip/filter/day/project/detail-panel assertions.
- `packages/console-ui/src/__tests__/use-run-detail.test.tsx` — update if `RunDetailPanel` props change tests indirectly.

## Verification

- [ ] Runs view renders status chips labeled all, running, failed, and completed.
- [ ] Runs view renders command chips labeled all, enqueue, compile, and build.
- [ ] Runs view renders one text input with an accessible name indicating run search.
- [ ] A fixed-time test groups two current-day runs under a `Today` header.
- [ ] Fixed-time tests render `Yesterday` and `Older` headers when fixtures include those timestamps.
- [ ] Selecting the `failed` status chip filters the history list to groups whose rollup status is `failed`.
- [ ] Runs history rows do not render the project cwd string on every row.
- [ ] Runs header renders one project chip using `basename(cwd)`.
- [ ] Rows with a session id render a truncated value from `truncateId` with length no greater than 12.
- [ ] Runs view top-level container className does not include `p-4`.
- [ ] Rendered Runs DOM contains exactly one `RunDetailPanel` instance.
- [ ] Runs `<h1>` is not wrapped in a shadcn `Card`.
- [ ] `packages/console-ui/src/views/runs/active-runs-panel.tsx` contains no `bg-green-100`, `bg-red-100`, or `bg-yellow-100` strings.
- [ ] `pnpm --filter @eforge-build/console-ui test runs-selectors runs-view` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.