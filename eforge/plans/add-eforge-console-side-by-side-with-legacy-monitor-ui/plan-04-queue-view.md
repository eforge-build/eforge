---
id: plan-04-queue-view
name: Implement the Queue view with queue summaries, status grouping,
  dependencies, priority display, recovery verdict chips, and explicit omission
  of unavailable editing controls.
branch: add-eforge-console-side-by-side-with-legacy-monitor-ui/queue-view
---

# Queue View

## Architecture Reference

This module implements the `queue-view` Expedition Module Contract from the architecture: a project-local, read-only Console queue route with live queue summaries, status grouping, dependency display, priority display, recovery verdict chips, and explicit boundaries around queue editing features that do not exist in phase 1.

Key constraints from architecture:
- The Queue view consumes the shared Console project state created by `console-shell`; it must not open its own daemon SSE stream.
- Queue data comes from `ConsoleProjectState.queue`, which is seeded by the daemon `stream:hello` snapshot and updated by daemon stream deltas.
- Queue wire data must use `QueueItem` imported from `@eforge-build/client/browser`; do not duplicate daemon queue response interfaces.
- The route is `/console/queue` inside the Console SPA.
- The view must render loading/connecting, empty, disconnected/error, partial-data, and populated states.
- The view must not render queue reordering controls, priority editing controls, stack-sync operation controls, or multi-project/Overseer controls.
- The view must use the Console shell visual system: dark terminal-adjacent styling, bordered cards/tables, compact information density, and shadcn-style primitives.
- Shared-file edits must stay within `queue-view` regions declared by the architecture.

## Scope

### In Scope
- Replace the Queue route placeholder with a functional read-only Queue view.
- Add pure queue selectors for summary counts, status groups, sorting, attention items, dependency metadata, and recovery verdict extraction.
- Render queue status summary cards for total, running, pending, failed, waiting/blocked, dependency count, and recovery verdict count when the corresponding data exists.
- Render grouped queue sections for running, failed, waiting/blocked, pending, and other daemon-supplied statuses.
- Render each queue item with PRD id, title, daemon status, priority when present, created timestamp when present, dependency chips when present, and recovery verdict chip when present.
- Render a recovery-pending indicator for failed items without `recoveryVerdict`.
- Render client-side status filters/grouping controls that only change local presentation.
- Render a small read-only boundary note stating that queue reordering and priority editing are not available in this phase.
- Add selector tests covering queue summary derivation and status grouping.
- Add component tests covering empty, connecting, disconnected/error, populated, dependency, priority, recovery verdict, and no-edit-control rendering.

### Out of Scope
- Adding new daemon APIs or REST fetches for queue data.
- Opening a second daemon-wide SSE subscription from the Queue view.
- Queue reordering, priority editing, dependency editing, retry/apply recovery actions, stack-sync operation controls, or any mutating workflow controls.
- Importing `packages/monitor-ui` components such as the legacy `QueueSection`, `RecoverySidecarSheet`, or legacy reducers.
- Importing `@eforge-build/engine` or monitor server internals.
- Multi-project queue language or Overseer navigation.
- Root package scripts, monitor static serving, and legacy monitor links; those remain owned by `static-serving-package-integration`.

## Implementation Approach

### Overview

Build the Queue view as a new, self-contained Console route under `packages/console-ui/src/views/queue/`. The route receives the shared `ConsoleProjectState` (or the `UseDaemonEventsResult` shape exposed by `console-shell`) from `App`; it does not call `useDaemonEvents()` and does not fetch `/api/queue`.

The implementation has three layers:

1. **Selectors** in `src/lib/selectors/queue.ts` accept `QueueItem[]` and return derived UI data: counts, groups, sorted rows, dependency metadata, and attention rows. These functions are pure and import `QueueItem` from `@eforge-build/client/browser`.
2. **Queue components** in `src/views/queue/` render the derived data using shell primitives (`Card`, `Badge`, `Button`, `cn`) and local presentational components. Components receive `QueueItem` values or selector return values; they do not define daemon response interfaces.
3. **Route integration** in `src/app.tsx` swaps the shell placeholder for `<QueueView />` only for the `queue` route. The view uses the existing shell connection state to choose connecting, disconnected, stale/partial, empty, and populated presentation.

The primary route layout is:

- Header: title `Queue`, short project-local description, live/stale indicator from the shared connection state.
- Read-only boundary card: states `Read-only in this preview: queue reordering and priority editing are not available here.` It contains no disabled edit buttons.
- Summary grid: total queue items, running, pending, failed, waiting/blocked, items with dependencies, and items with recovery verdicts.
- Attention section: failed items first, with recovery verdict chips or recovery-pending text.
- Status groups: running, waiting/blocked, pending, other daemon statuses. Groups can be filtered with local filter buttons.
- Queue table/cards: compact row surface for each item with id, title, status, priority, dependencies, recovery verdict, and created timestamp.

### Key Decisions

1. **Use pure selectors for all derived queue data.** Selector tests can validate counts and grouping without rendering React. This also gives the Now dashboard a future option to reuse the same queue summaries through `src/lib/selectors/index.ts`.
2. **Keep the route read-only instead of rendering disabled edit buttons.** A read-only boundary note satisfies the requirement to make unavailable editing controls explicit while preventing a disabled-control UI from implying an API exists.
3. **Group by daemon status while preserving unknown statuses.** Known groups are ordered as `running`, `failed`, `waiting`/blocked, `pending`, then all other status strings sorted alphabetically. Unknown statuses are displayed verbatim in an `Other` group so new daemon states are visible instead of hidden.
4. **Sort within groups by priority descending, then created timestamp ascending, then id.** This mirrors the existing monitor convention that higher priority appears first while giving deterministic ordering for tests.
5. **Treat dependencies as display-only chips.** `dependsOn` values are rendered as PRD ids with labels such as `depends on`; no graph editing, dependency editing, or stack sync language appears.
6. **Implement a Console-local recovery verdict chip.** Reimplement the small badge mapping from `QueueItem['recoveryVerdict']` inside Console source rather than importing legacy monitor UI code. The component accepts `NonNullable<QueueItem['recoveryVerdict']>` to stay tied to the client wire type.
7. **Use connection state from `console-shell`.** If the stream is connecting and no snapshot has arrived, render a connecting state. If disconnected with no queue data, render unavailable. If disconnected with queue data, render the last queue snapshot with a stale warning.
8. **Use local filter state only.** Filtering by status is implemented with React `useState` in `QueueView` and never calls a daemon route.

## Files

### Create
- `packages/console-ui/src/lib/selectors/queue.ts` — pure queue selectors and derived UI types that reference `QueueItem` from `@eforge-build/client/browser`. Exports `selectQueueSummary`, `selectQueueStatusGroups`, `selectQueueAttentionItems`, `sortQueueItemsForDisplay`, `getQueueStatusTone`, and `formatQueueCreatedAt` if the formatter remains queue-specific.
- `packages/console-ui/src/views/queue/queue-view.tsx` — route-level component. Accepts shared Console project state and renders header, state panels, read-only boundary note, summary cards, filters, attention section, and status groups.
- `packages/console-ui/src/views/queue/queue-summary-cards.tsx` — bordered summary card grid for total/running/pending/failed/waiting/dependencies/recovery counts.
- `packages/console-ui/src/views/queue/queue-status-filter.tsx` — local status filter buttons with `aria-pressed`; no daemon calls.
- `packages/console-ui/src/views/queue/queue-status-group.tsx` — group heading plus table/card list for one status group.
- `packages/console-ui/src/views/queue/queue-item-row.tsx` — compact queue row/card showing id, title, status, priority, created timestamp, dependencies, and recovery verdict state.
- `packages/console-ui/src/views/queue/dependency-chips.tsx` — display-only dependency chips for `QueueItem.dependsOn` values.
- `packages/console-ui/src/views/queue/recovery-verdict-chip.tsx` — Console-local recovery verdict badge using `QueueItem['recoveryVerdict']` and shell `Badge` primitive.
- `packages/console-ui/src/views/queue/queue-state-panels.tsx` — connecting, empty, disconnected/unavailable, stale-snapshot, and partial-data panels for the Queue route.
- `packages/console-ui/src/views/queue/index.ts` — route component exports for concise imports from `app.tsx`.
- `packages/console-ui/src/__tests__/queue-selectors.test.ts` — unit tests for summary counts, grouping, sorting, dependency counts, recovery verdict counts, failed attention item selection, and unknown status preservation.
- `packages/console-ui/src/__tests__/queue-view.test.tsx` — component tests for route state rendering and absence of unavailable edit controls.

### Modify
- `packages/console-ui/src/app.tsx` — import and render `QueueView` for the Queue route, passing the existing shared daemon/project state from `console-shell`; do not create another daemon stream `[region: queue-view, Queue route component branch only]`.
- `packages/console-ui/src/lib/navigation.ts` — ensure the queue nav entry has label `Queue`, route id `queue`, and href `/console/queue` only if the shell dependency leaves per-view nav item regions to fill or update `[region: queue-view, queue nav item]`.
- `packages/console-ui/src/lib/selectors/index.ts` — export queue selectors for reuse by other Console views `[region: queue-view, exports from ./queue]`.

Shared-file code regions for implementation:

```tsx
// packages/console-ui/src/app.tsx
// --- eforge:region queue-view ---
import { QueueView } from '@/views/queue';

// In the route switch/render map, only for route id "queue":
<QueueView projectState={daemon.state} />
// --- eforge:endregion queue-view ---
```

```ts
// packages/console-ui/src/lib/navigation.ts
// --- eforge:region queue-view ---
{
  id: 'queue',
  label: 'Queue',
  href: toConsolePath('queue'),
  description: 'Queued, running, failed, and blocked project work',
}
// --- eforge:endregion queue-view ---
```

```ts
// packages/console-ui/src/lib/selectors/index.ts
// --- eforge:region queue-view ---
export * from './queue';
// --- eforge:endregion queue-view ---
```

If `console-shell` already creates a complete queue nav entry and does not expose a per-view marker in `navigation.ts`, leave that file unchanged and record in the implementation notes that the shell-owned nav item already satisfies the Queue route contract.

## Component and Data Contracts

### `QueueView` props

Use the actual state type exported by `console-shell`. If the shell exports `ConsoleProjectState`, prefer:

```ts
interface QueueViewProps {
  projectState: ConsoleProjectState;
}
```

The component reads only:
- `projectState.queue`
- `projectState.connectionStatus`
- `projectState.lastSnapshotAt`
- `projectState.lastEventAt`
- `projectState.error`

No `useDaemonEvents()` call appears inside `QueueView` or its child components.

### Selector return shapes

Derived types are UI-only and reference client wire data:

```ts
import type { QueueItem } from '@eforge-build/client/browser';

export interface QueueSummary {
  total: number;
  running: number;
  pending: number;
  failed: number;
  waiting: number;
  other: number;
  withDependencies: number;
  withRecoveryVerdict: number;
  recoveryPending: number;
  byStatus: Record<string, number>;
}

export interface QueueStatusGroup {
  key: string;
  label: string;
  tone: 'active' | 'attention' | 'waiting' | 'pending' | 'neutral';
  items: QueueItem[];
}
```

These interfaces describe derived presentation state, not daemon response shapes.

### Status and display rules

- `failed` items render in the attention section and in the failed group.
- `failed` item with `recoveryVerdict` renders a verdict chip containing verdict and confidence.
- `failed` item without `recoveryVerdict` renders text `recovery pending`.
- `priority` renders as `p{number}` or `Priority {number}`; no input, select, menu, or edit button appears near priority.
- `dependsOn` renders as chips containing dependency ids; no drag handles, remove buttons, or add-dependency controls appear.
- `created` renders as an absolute timestamp or compact relative label from a deterministic formatter; selector tests use fixed timestamps if relative formatting is implemented.
- Unknown statuses render with a neutral badge and appear in an `Other` group with the original status visible.

## Testing Strategy

### Unit Tests
- `queue-selectors.test.ts` constructs `QueueItem[]` values inline using `QueueItem` from `@eforge-build/client/browser`.
- Summary tests cover:
  - empty array returns zeros for every count.
  - one item for `running`, `pending`, `failed`, and `waiting` returns matching counts.
  - `dependsOn: ['a', 'b']` increments `withDependencies` once for that item.
  - failed item with `recoveryVerdict` increments `withRecoveryVerdict`.
  - failed item without `recoveryVerdict` increments `recoveryPending`.
- Grouping tests cover:
  - known statuses appear in deterministic order: running, failed, waiting, pending, other.
  - unknown status string is preserved on the row and counted in `other`.
  - higher numeric `priority` sorts before lower priority within the same group.
  - items with equal priority sort by `created` then `id`.
- Attention tests cover:
  - failed items appear in `selectQueueAttentionItems`.
  - non-failed items do not appear in `selectQueueAttentionItems`.

### Component Tests
- `queue-view.test.tsx` renders `QueueView` with stub `ConsoleProjectState` values from `console-shell` test helpers or a local factory that satisfies the exported shell type.
- State rendering tests cover:
  - `connectionStatus: 'connecting'`, no snapshot, and empty queue renders text matching `/connecting/i`.
  - `connectionStatus: 'connected'` and empty queue renders text matching `/queue is empty/i`.
  - `connectionStatus: 'disconnected'`, no queue data, and `error: 'boom'` renders `boom` and text matching `/unavailable|disconnected/i`.
  - `connectionStatus: 'disconnected'` with existing queue data renders the rows plus text matching `/stale|last snapshot/i`.
- Populated rendering tests cover:
  - two queue items render their ids and titles.
  - priority value renders for an item with `priority`.
  - dependency chips render every `dependsOn` value.
  - recovery verdict chip renders verdict and confidence for a failed item with `recoveryVerdict`.
  - failed item without `recoveryVerdict` renders `recovery pending`.
  - local status filter hides non-selected groups after a click and does not call `fetch`.
- Omission tests assert the rendered view has no buttons or links with accessible names matching `/reorder|move up|move down|edit priority|change priority|stack sync|overseer/i`.

### Integration Tests
- `pnpm --filter @eforge-build/console-ui test` runs selector and component tests under the package-local Vitest config from `console-shell`.
- `pnpm --filter @eforge-build/console-ui type-check` validates that the Queue view imports `QueueItem` from the browser-safe client entrypoint and does not duplicate queue wire types.
- `pnpm --filter @eforge-build/console-ui build` validates that the Queue route compiles into the Console Vite app.

## Verification

- [ ] `/console/queue` renders the Queue view instead of the shell placeholder.
- [ ] `QueueView` receives queue data from the shared Console project state and contains zero calls to `useDaemonEvents`.
- [ ] Queue selectors import `QueueItem` from `@eforge-build/client/browser`.
- [ ] Console source contains no new interface that redeclares the daemon queue item fields `id`, `title`, `status`, `priority`, `created`, `dependsOn`, and `recoveryVerdict` as a response shape.
- [ ] `selectQueueSummary([])` returns total `0`, running `0`, pending `0`, failed `0`, waiting `0`, other `0`, withDependencies `0`, withRecoveryVerdict `0`, and recoveryPending `0`.
- [ ] `selectQueueSummary` counts running, pending, failed, waiting, dependency-bearing, recovery-verdict, and recovery-pending items from a mixed `QueueItem[]` fixture.
- [ ] `selectQueueStatusGroups` preserves an unknown status string in a neutral group.
- [ ] Queue item sorting places higher numeric priority before lower numeric priority within the same status group.
- [ ] Queue item sorting uses `created` and then `id` for items with equal status and priority.
- [ ] The Queue view renders a connecting state when `connectionStatus` is `connecting` and no queue snapshot is present.
- [ ] The Queue view renders an empty state containing `queue is empty` when connected with an empty queue.
- [ ] The Queue view renders a disconnected or unavailable state containing the stream error message when disconnected with no queue data.
- [ ] The Queue view renders existing queue rows and a stale warning when disconnected with queue data.
- [ ] A populated Queue view renders each item id, title, daemon status, priority when present, and created timestamp when present.
- [ ] An item with `dependsOn: ['a', 'b']` renders chips or labels for both `a` and `b`.
- [ ] A failed item with `recoveryVerdict: { verdict: 'retry', confidence: 'high' }` renders `retry` and `high` in the row.
- [ ] A failed item without `recoveryVerdict` renders `recovery pending`.
- [ ] The Queue view contains no rendered button or link with accessible name matching `reorder`, `move up`, `move down`, `edit priority`, `change priority`, `stack sync`, or `Overseer`.
- [ ] The Queue view renders text stating that queue reordering and priority editing are not available in this phase.
- [ ] Queue status filter controls change only local rendered groups and do not call `fetch`.
- [ ] `packages/console-ui/src/lib/selectors/index.ts` exports the queue selector module inside the `queue-view` region.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
