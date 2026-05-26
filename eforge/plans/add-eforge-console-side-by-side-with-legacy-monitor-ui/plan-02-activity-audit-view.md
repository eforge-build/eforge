---
id: plan-02-activity-audit-view
name: Implement the Activity/audit view with live event log, recent activity
  projection, filtering/grouping, event summaries, and raw event debugging
  affordances.
branch: add-eforge-console-side-by-side-with-legacy-monitor-ui/activity-audit-view
---

# Activity Audit View

## Architecture Reference

This module implements the **Activity/Audit View** contract from the architecture for the new `@eforge-build/console-ui` package.

Key constraints from architecture:
- The Activity view is available at `/console/activity` inside the Console SPA and remains project-local.
- Activity data comes from the shared daemon-wide stream state created by `console-shell`; this module does not open another daemon SSE stream.
- Recent snapshot activity and subsequent live daemon events are rendered from the shared `ConsoleProjectState.recentActivity` ring.
- Heartbeats must not dominate the default activity list.
- Event summaries use browser-safe client exports such as `getEventSummary`, `eventRegistry`, and `EforgeEvent` from `@eforge-build/client/browser`.
- Filters and grouping are client-side only and do not add daemon routes.
- Raw event debugging affordances expose the typed event payload without duplicating daemon wire interfaces.
- Empty, connecting, disconnected/error, and filtered-empty states are visible.
- No queue editing, stack-sync operation controls, multi-project navigation, or Overseer language belongs in this view.

## Scope

### In Scope
- Implement the `/console/activity` route content.
- Render a live audit/event log from the shared Console project state.
- Normalize snapshot `recentActivity` entries and live daemon events into display rows.
- Generate one-line event summaries via `getEventSummary(event)` with deterministic fallback copy when the registry has no summary.
- Show event type, event scope, event family, timestamp, relative receive age, session id, plan id, run id, queue/prd id, source, and attention classification when those fields are present on the typed event object.
- Add client-side filters for event family, attention events, event type text search, and identifier text search.
- Add grouping/count chips for all, daemon, scheduler, queue, session, agent, extension, stack, and other event families.
- Add expandable raw JSON panels for debugging each visible event.
- Add selectors/projection helpers for filtering, grouping, summaries, timestamp formatting, and raw JSON serialization.
- Add view-level empty, connecting, disconnected/error, and filtered-empty states.
- Add Activity view tests and selector tests.

### Out of Scope
- Creating or modifying daemon API routes.
- Opening a second daemon-wide SSE subscription.
- Opening per-session streams for this view.
- Importing legacy monitor UI application components, reducers, drawer code, or timeline code.
- Importing `@eforge-build/engine`.
- Rendering mutating workflow controls.
- Rendering queue reorder, priority edit, stack-sync operation, or Overseer controls.
- Persisting filters to the daemon or browser storage.
- Full historical audit pagination beyond the shared in-memory activity ring supplied by `console-shell`.

## Implementation Approach

### Overview

The Activity view consumes the shared project state passed through the Console app. It projects `ConsoleProjectState.recentActivity` into `ActivityEventRowModel[]` with selectors in `src/lib/selectors/activity.ts`. The selectors own display concerns such as family classification, attention classification, registry summary lookup, identifier extraction, filtering, grouping, and stable sorting.

The route component renders three regions:

1. **Header and state summary** — route title, stream state, total activity count, visible count, last event time, and a small note that the feed is daemon-stream backed.
2. **Filters and groups** — family chips with counts, an attention-only toggle, and two text inputs for event type and id/source search.
3. **Event list** — newest-first rows with timestamp, family badge, type, summary, identifiers, source, scope, and a native `<details>` raw JSON panel.

The module adds no direct fetches. The view receives `projectState.connectionStatus`, `projectState.error`, `projectState.lastSnapshotAt`, `projectState.lastEventAt`, and `projectState.recentActivity` from the shell-created store. If the shell stores the activity array under a different exported property name, the builder must add a small adapter in `ActivityAuditView` rather than editing `use-daemon-events.ts`.

### Key Decisions

1. **Use selectors for all activity projection.** Components render `ActivityEventRowModel` objects and do not inspect arbitrary event fields except for displaying raw JSON. This keeps event classification testable and avoids duplicating wire contracts in React components.
2. **Newest-first ordering.** The list sorts by `receivedAt` descending, then numeric/string event id descending when receive times match, so the latest daemon activity is visible without scrolling.
3. **Heartbeat exclusion is enforced in selectors.** The shell reducer is expected to exclude `daemon:heartbeat`; `selectActivityRows` also filters it out to protect the Activity view if a future reducer change includes heartbeat entries.
4. **Event summaries use client registry metadata.** `getEventSummary(event)` is the first summary source. If it returns `undefined`, the fallback is `Event ${event.type}` plus any extracted identifier labels, never a fabricated system action.
5. **Attention classification is explicit and conservative.** Mark an event as attention when its type contains `error`, `failed`, `failure`, `warning`, `blocked`, `timeout`, or `cancel`, or when an event has a string `status`/`result.status` equal to `failed`, `failure`, `error`, `cancelled`, or `canceled`. This is display-only and does not change daemon state.
6. **Scheduler family is a derived filter, not a backend concept.** Scheduler includes `daemon:auto-build:*`, `daemon:scheduler:*`, queue events, and `daemon:error` events whose `source` is `scheduler` or `auto-build`, matching existing monitor UI semantics without importing its drawer.
7. **Native details for raw JSON.** A `<details><summary>Raw event JSON</summary><pre>...</pre></details>` affordance avoids adding new UI primitive dependencies and remains keyboard-accessible.
8. **No route literals.** The module adds no `/api/` strings and relies on the existing shell route path metadata for `/console/activity`.

## Files

### Create
- `packages/console-ui/src/lib/selectors/activity.ts` — activity display model types, family/scope/attention classification, identifier extraction, event summary helper, timestamp helpers, filtering, grouping, and sorting.
- `packages/console-ui/src/views/activity/activity-view.tsx` — top-level `ActivityAuditView` route component that receives shared project state and renders header, filters, state panels, and event list.
- `packages/console-ui/src/views/activity/activity-toolbar.tsx` — filter controls, family count chips, attention toggle, type search input, and id/source search input.
- `packages/console-ui/src/views/activity/activity-event-list.tsx` — list container, filtered-empty state, and row mapping.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` — single event row with timestamp, badges, summary, identifiers, source/scope metadata, and raw JSON disclosure.
- `packages/console-ui/src/views/activity/index.ts` — exports `ActivityAuditView` and activity view props.
- `packages/console-ui/src/__tests__/activity-selectors.test.ts` — pure selector tests for summary fallback, heartbeat exclusion, family grouping, attention filtering, identifier search, and newest-first ordering.
- `packages/console-ui/src/__tests__/activity-view.test.tsx` — React tests for populated, connecting, disconnected/error, empty, filtered-empty, filter interaction, and raw JSON rendering states.

### Modify
- `packages/console-ui/src/app.tsx` — wire the `activity` route branch to `ActivityAuditView` and pass the shell-owned project state `[region: activity-audit-view, Activity route component branch]`.
- `packages/console-ui/src/lib/navigation.ts` — add or refine the `activity` route metadata with label `Activity`, href `/console/activity`, and project-local description text `[region: activity-audit-view, activity nav item]`.
- `packages/console-ui/src/lib/selectors/index.ts` — export activity selector helpers `[region: activity-audit-view, exports from ./activity]`.

No changes are planned for `packages/console-ui/src/hooks/use-daemon-events.ts` or `packages/console-ui/src/hooks/use-active-session-streams.ts`. If implementation discovers that `ConsoleProjectState` does not expose `recentActivity`, `connectionStatus`, `error`, `lastSnapshotAt`, and `lastEventAt`, the builder must add a minimal append-only return-shape field in the shell-owned hook region only after coordinating with the shell module contract.

## Shared File Region Declarations

`packages/console-ui/src/app.tsx`:

```tsx
// --- eforge:region activity-audit-view ---
if (route.id === 'activity') {
  return <ActivityAuditView projectState={projectState} />;
}
// --- eforge:endregion activity-audit-view ---
```

`packages/console-ui/src/lib/navigation.ts`:

```ts
// --- eforge:region activity-audit-view ---
{
  id: 'activity',
  label: 'Activity',
  href: toConsolePath('activity'),
  description: 'Live daemon event log and audit details',
}
// --- eforge:endregion activity-audit-view ---
```

`packages/console-ui/src/lib/selectors/index.ts`:

```ts
// --- eforge:region activity-audit-view ---
export * from './activity';
// --- eforge:endregion activity-audit-view ---
```

These regions do not overlap with the `console-shell` regions declared in the dependency plan. View implementation files under `src/views/activity/` are owned entirely by this module.

## Component and Selector Contracts

### `ActivityAuditView` props

```ts
interface ActivityAuditViewProps {
  projectState: Pick<ConsoleProjectState,
    | 'recentActivity'
    | 'connectionStatus'
    | 'error'
    | 'lastSnapshotAt'
    | 'lastEventAt'
  >;
  now?: number;
}
```

`now` is optional and exists for deterministic tests. Production callers omit it.

### Activity filter state

```ts
export type ActivityFamily =
  | 'all'
  | 'daemon'
  | 'scheduler'
  | 'queue'
  | 'session'
  | 'agent'
  | 'extension'
  | 'stack'
  | 'other';

export interface ActivityFilterState {
  family: ActivityFamily;
  attentionOnly: boolean;
  typeQuery: string;
  identifierQuery: string;
}
```

Default filter state:

```ts
export const defaultActivityFilters: ActivityFilterState = {
  family: 'all',
  attentionOnly: false,
  typeQuery: '',
  identifierQuery: '',
};
```

### Display row model

```ts
export interface ActivityEventRowModel {
  id: string;
  event: EforgeEvent;
  eventType: EforgeEvent['type'];
  family: Exclude<ActivityFamily, 'all'>;
  scope: EventScope | 'unknown';
  summary: string;
  timestampLabel: string;
  receivedLabel: string;
  identifiers: Array<{ label: string; value: string }>;
  source: string | null;
  attention: boolean;
  rawJson: string;
  receivedAt: number;
}
```

Identifier extraction must look for known optional string fields without defining new wire interfaces: `sessionId`, `runId`, `planId`, `prdId`, `queueId`, `id`, `agent`, `source`, and nested `result.status` for status display. Use `Record<string, unknown>` casts inside selector helpers only.

### State rendering rules

- Connecting state: `connectionStatus === 'connecting' && lastSnapshotAt === null` renders `Connecting to daemon activity stream…`.
- Disconnected/error state: `connectionStatus === 'disconnected' && error` renders `Daemon activity unavailable` plus the error string.
- Empty state: connected with zero source activity renders `No daemon activity has been received yet.`.
- Filtered-empty state: source activity exists but visible rows are empty renders `No activity matches the current filters.` and a button that resets filters.
- Partial state: disconnected with existing activity renders the existing rows plus a banner `Stream disconnected; showing last received activity.`.

## Testing Strategy

### Unit Tests
- `activity-selectors.test.ts`:
  - `selectActivityRows` excludes `daemon:heartbeat` entries even when they appear in input.
  - Rows sort newest first by `receivedAt`.
  - `getEventSummary` output is used for an event type with registry summary metadata.
  - Summary fallback returns `Event <type>` for an event with no registry summary.
  - `groupActivityRows` returns counts for `all`, `daemon`, `scheduler`, `queue`, `session`, `agent`, `extension`, `stack`, and `other` keys.
  - Scheduler family includes `daemon:auto-build:*`, `daemon:scheduler:*`, queue events, and `daemon:error` with `source: 'scheduler'`.
  - Attention filter includes events with `error`, `failed`, `warning`, `blocked`, `timeout`, or cancel-family types and excludes ordinary lifecycle events.
  - Type query matches against `event.type` case-insensitively.
  - Identifier query matches extracted `sessionId`, `planId`, `prdId`, `runId`, `agent`, and `source` values case-insensitively.
  - `rawJson` equals `JSON.stringify(event, null, 2)` for a representative event.

### Component Tests
- `activity-view.test.tsx`:
  - Populated render shows route heading `Activity`, total count, visible count, event type text, registry summary text, and identifier chips.
  - Clicking a family chip filters the list to that family and updates the visible count text.
  - Enabling `Attention only` hides non-attention events and keeps error/failed/blocked events visible.
  - Typing in the event type filter updates the visible rows without network calls.
  - Typing an identifier filter matches rows by `sessionId` or `planId`.
  - The raw JSON disclosure renders a `<pre>` containing the selected event JSON.
  - Connecting state renders `Connecting to daemon activity stream…` when no snapshot has arrived.
  - Disconnected state renders `Daemon activity unavailable` and the supplied error text.
  - Disconnected with existing rows renders the stream-disconnected banner and keeps existing event rows in the document.
  - Connected empty state renders `No daemon activity has been received yet.`.
  - Filtered-empty state renders `No activity matches the current filters.` and a reset button that restores all rows.

### Integration Checks
- `pnpm --filter @eforge-build/console-ui test -- activity` runs selector and component tests for this module.
- `pnpm --filter @eforge-build/console-ui type-check` verifies the view imports only browser-safe client types and the shell-owned project state type.
- Existing Console source guard tests continue to pass because this module contains no hardcoded quoted `/api/` literals and no `@eforge-build/engine` import.

## Verification

- [ ] `/console/activity` renders the Activity view instead of the shell placeholder.
- [ ] The Activity view heading contains `Activity`.
- [ ] The Activity view consumes `projectState.recentActivity` from the shell and does not call `subscribeWithSnapshot`.
- [ ] The Activity view source contains zero quoted `/api/` literals.
- [ ] The Activity view source contains zero imports from `@eforge-build/engine`.
- [ ] Event summaries call `getEventSummary` from `@eforge-build/client/browser`.
- [ ] Event scope metadata reads from `eventRegistry` from `@eforge-build/client/browser`.
- [ ] Heartbeat entries with type `daemon:heartbeat` are absent from rendered activity rows.
- [ ] Rows render newest event first when two entries have different `receivedAt` values.
- [ ] Family chips display counts for all, daemon, scheduler, queue, session, agent, extension, stack, and other.
- [ ] The scheduler filter includes `daemon:auto-build:*`, `daemon:scheduler:*`, queue events, and scheduler-sourced daemon errors.
- [ ] The attention filter includes error, failed, warning, blocked, timeout, and cancel-family events.
- [ ] Type search filters rows by event type without issuing a fetch.
- [ ] Identifier search filters rows by session id, plan id, run id, prd id, agent, or source without issuing a fetch.
- [ ] Each visible event row includes event type, summary, timestamp, family, scope, and at least one identifier chip when the event has an extracted identifier.
- [ ] Each visible event row includes an expandable raw JSON panel.
- [ ] Raw JSON panel content equals `JSON.stringify(event, null, 2)` for the row event.
- [ ] Connecting state text `Connecting to daemon activity stream…` appears when no snapshot has arrived.
- [ ] Disconnected error state text `Daemon activity unavailable` appears with the stored error string.
- [ ] Disconnected state with existing rows displays `Stream disconnected; showing last received activity.` and keeps the existing rows visible.
- [ ] Connected empty state text `No daemon activity has been received yet.` appears when the source activity array is empty.
- [ ] Filtered-empty state text `No activity matches the current filters.` appears when filters hide every source row.
- [ ] Filtered-empty reset button restores all source rows.
- [ ] `pnpm --filter @eforge-build/console-ui test -- activity` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "single",
    "perspectives": ["code"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
