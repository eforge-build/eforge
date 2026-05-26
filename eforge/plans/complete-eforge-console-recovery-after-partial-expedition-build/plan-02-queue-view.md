---
id: plan-02-queue-view
name: Implement Read-Only Console Queue View
branch: complete-eforge-console-recovery-after-partial-expedition-build/plan-02-queue-view
---

# Implement Read-Only Console Queue View

## Architecture Context

This plan fills the original failed `plan-04-queue-view` scope on top of the recovered Console shell. The Queue route is a project-local, read-only Console view. It consumes `ConsoleProjectState.queue` from the shared daemon-wide stream created by the shell and does not open a second daemon-wide SSE subscription or add daemon APIs.

## Implementation

### Overview

Replace the Queue placeholder with a live-data route under `packages/console-ui/src/views/queue/`. Add pure selectors for queue summaries and grouping, then render summary cards, local status filters, status groups, dependency chips, priority display, and recovery verdict chips. Include loading, empty, disconnected, stale-snapshot, and populated states.

### Key Decisions

1. **Selectors own derived data.** `packages/console-ui/src/lib/selectors/queue.ts` derives summary counts, groups, attention items, dependency counts, recovery counts, and deterministic ordering from `QueueItem[]`.
2. **Queue remains read-only.** Render a boundary note instead of disabled mutation controls. Do not render buttons or links for reordering, priority editing, dependency editing, retry/apply recovery, stack sync, or Overseer navigation.
3. **Use client wire types.** Import `QueueItem` from `@eforge-build/client/browser`; do not define local daemon queue response interfaces.
4. **Use shared Console state.** `QueueView` receives `ConsoleProjectState` from `App`; neither `QueueView` nor child components call `useDaemonEvents()`.
5. **Preserve unknown statuses.** Unknown daemon status strings remain visible and are grouped after known groups.

## Scope

### In Scope

- Add queue selectors and selector exports.
- Add Queue route components and state panels.
- Wire `QueueView` into `packages/console-ui/src/app.tsx` for route id `queue`.
- Add Queue selector tests.
- Add Queue view component tests.
- Keep all Queue UI text project-local.

### Out of Scope

- Daemon queue API changes.
- Additional daemon-wide SSE subscriptions.
- Queue mutation controls or disabled mutation buttons.
- Stack-sync operation controls.
- Multi-project or Overseer navigation.
- Static serving, root scripts, monitor package dependencies, legacy monitor link, or docs.
- Broad rewrites of completed Console shell, Now, Activity, Runs, or System view code.

## Files

### Create

- `packages/console-ui/src/lib/selectors/queue.ts` — pure selectors and UI-derived types tied to `QueueItem` from `@eforge-build/client/browser`.
- `packages/console-ui/src/views/queue/queue-view.tsx` — route component for header, state panels, read-only note, summaries, filters, attention rows, and status groups.
- `packages/console-ui/src/views/queue/queue-summary-cards.tsx` — total/running/pending/failed/waiting/dependencies/recovery count cards.
- `packages/console-ui/src/views/queue/queue-status-filter.tsx` — local status filter buttons with `aria-pressed`.
- `packages/console-ui/src/views/queue/queue-status-group.tsx` — group heading and row list.
- `packages/console-ui/src/views/queue/queue-item-row.tsx` — compact row/card showing id, title, status, priority, created timestamp, dependencies, and recovery state.
- `packages/console-ui/src/views/queue/dependency-chips.tsx` — display-only `dependsOn` chips.
- `packages/console-ui/src/views/queue/recovery-verdict-chip.tsx` — Console-local recovery verdict badge tied to `QueueItem['recoveryVerdict']`.
- `packages/console-ui/src/views/queue/queue-state-panels.tsx` — connecting, empty, unavailable, stale, and partial-data panels.
- `packages/console-ui/src/views/queue/index.ts` — Queue view exports.
- `packages/console-ui/src/__tests__/queue-selectors.test.ts` — selector tests for counts, grouping, sorting, dependencies, and recovery verdicts.
- `packages/console-ui/src/__tests__/queue-view.test.tsx` — component tests for states, populated rows, local filters, and absence of unavailable controls.

### Modify

- `packages/console-ui/src/app.tsx` — import `QueueView` and render it when `currentRoute === 'queue'`, passing the existing `projectState`.
- `packages/console-ui/src/lib/selectors/index.ts` — export queue selectors.
- `packages/console-ui/src/lib/navigation.ts` — only adjust Queue nav metadata if the recovered shell lacks the Queue route entry or description required by the view.

## Component and Data Contracts

`QueueView` accepts the recovered shell state type:

```ts
interface QueueViewProps {
  projectState: ConsoleProjectState;
}
```

The view reads only:

- `projectState.queue`
- `projectState.connectionStatus`
- `projectState.lastSnapshotAt`
- `projectState.lastEventAt`
- `projectState.error`

Selector return types may define UI-only shapes such as `QueueSummary` and `QueueStatusGroup`, but no local type may redeclare the daemon queue response shape as an API contract.

Status display rules:

- Failed items appear in the attention section and in the failed group.
- Failed items with `recoveryVerdict` show verdict and confidence.
- Failed items without `recoveryVerdict` show `recovery pending`.
- Priority is text such as `Priority 2` or `p2`, never an input/select/menu.
- Dependencies render as chips containing dependency ids and no remove/add controls.
- Unknown statuses show a neutral badge and the original status string.

## Verification

- [ ] `/console/queue` renders `QueueView` instead of `RoutePlaceholder`.
- [ ] `QueueView` and files under `packages/console-ui/src/views/queue/` contain zero calls to `useDaemonEvents`.
- [ ] Queue selectors import `QueueItem` from `@eforge-build/client/browser`.
- [ ] No Console source file defines a daemon queue response interface with fields `id`, `title`, `status`, `priority`, `created`, `dependsOn`, and `recoveryVerdict`.
- [ ] Selector tests cover empty counts, running count, pending count, failed count, waiting count, dependency count, recovery verdict count, recovery-pending count, unknown status preservation, priority sorting, created-time sorting, and failed attention item selection.
- [ ] Component tests cover connecting, empty, disconnected unavailable, disconnected stale snapshot, populated rows, priority text, dependency chips, recovery verdict chip, recovery-pending text, and local status filter behavior.
- [ ] Component tests find no controls with accessible names matching `/reorder|move up|move down|edit priority|change priority|stack sync|overseer/i`.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
