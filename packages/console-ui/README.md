# @eforge-build/console-ui

The active monitoring dashboard for eforge. This package replaces `packages/monitor-ui/`, which is retained as the legacy implementation until the port is fully baked.

## Route table

The canonical route list lives in [`src/lib/navigation.ts`](src/lib/navigation.ts). The current routes are:

| Path | Route ID | Description |
|------|----------|-------------|
| `/console/` | `now` | Now dashboard - active builds, queue, and live status |
| `/console/runs/:detailId` | `runDetail` | Build detail view for a specific run |
| `/console/plans` | `plans` | Planning Workspace - read-only browsing of flat session plans and grouped session plan sets |
| `/console/system` | `system` | System - configuration, profiles, playbooks, extensions, and diagnostic surfaces |

All unrecognized paths (including previously removed routes) redirect to `now`.

## Data flow

```
daemon SSE
  → useActiveSessionStreams  (src/hooks/use-active-session-streams.ts)
  → reducer at src/lib/run-state/
  → selectors                (src/lib/selectors/ and src/lib/run-state/selectors/)
  → views

daemon REST (session plans + plan sets)
  → API_ROUTES.sessionPlanList     GET /api/session-plan/list[?includeSubmitted=true]
  → API_ROUTES.sessionPlanShow     GET /api/session-plan/show?session=:session
  → API_ROUTES.sessionPlanSetList  GET /api/session-plan-set/list[?includeSubmitted=true]
  → API_ROUTES.sessionPlanSetShow  GET /api/session-plan-set/show?planSetId=:planSetId
  → use-session-plans.ts           (src/views/plans/use-session-plans.ts)
  → PlansView

daemon REST (Now failed-build recovery)
  → fetchRecoverySidecar / fetchResumeEligibility   (lead: sidecar verdict + resume eligibility)
  → applySidecarRecovery / triggerRecoveryAnalysis / startResumeBuild
  → fetchQueueRecoveryAnalysis / applyQueueRecovery (advanced queue-cascade only)
      all from @eforge-build/client/browser
  → QueueRecoveryDialog        (src/components/now/queue-recovery-dialog.tsx)
  → API_ROUTES.queue refresh   (src/hooks/use-daemon-events.ts)
  → QUEUE_REFRESH_RECEIVED     (src/lib/project-state.ts)
```

The Now dashboard Queue card shows failed rows with an explicit **Recover…** control. Rendering and expanding rows is fetch-free; recovery data loads only when the dialog opens.

The recovery dialog leads with sidecar verdict recovery and compiled-build resume:

- **Recovery report** - on open it fetches the recovery sidecar via `fetchRecoverySidecar`. A 404 is treated as `recovery pending` (not a fatal error) and offers a confirmed **Run recovery analysis** action (`triggerRecoveryAnalysis`); other failures surface the daemon error. When a sidecar exists the verdict/confidence are shown via `RecoveryVerdictChip` and the markdown report is rendered through `SafeMarkdown` (`marked` + `DOMPurify`) inside a `plan-prose` container.
- **Recommended recovery action** - the sidecar verdict drives a single confirmed primary action (`applySidecarRecovery`): `retry` → **Re-queue PRD**, `split` → **Enqueue successor PRD** (continuing from the preserved feature branch when the sidecar records landed partial work), `abandon` → **Archive failed PRD**. A `manual` verdict shows **Manual review required** with no apply button.
- **Compiled-build resume** - `fetchResumeEligibility` runs as a read-only preflight. When eligible, a confirmed **Resume compiled build** action calls `startResumeBuild` and shows the returned session id and pid; when ineligible, the daemon `reason` is shown. On successful resume, the engine retires the failed queue item and reactivates skipped descendants automatically.
- **Advanced: queue-cascade retry/reactivation** - the lower-level explicit retry/repair lives in a collapsed advanced section. It states that it *moves the failed upstream back to the queue* and *may reactivate skipped descendants*, warns when the verdict is `manual` or confidence is `low`, fetches `fetchQueueRecoveryAnalysis` only once the section is opened, and applies via `applyQueueRecovery` (never sidecar apply) after an explicit confirmation.

All mutating or worker-spawning actions go through an `AlertDialog` confirmation. After a successful sidecar apply or queue-cascade apply the dialog refreshes `API_ROUTES.queue` and dispatches `QUEUE_REFRESH_RECEIVED` so skipped rows disappear without waiting for a full SSE reconnect. Console consumes the client-owned browser helpers and never inlines `/api/...` paths.

The `useActiveSessionStreams` hook subscribes to per-session SSE streams for all active session IDs. Each stream's events are folded through the run-state reducer to produce a `RunState` snapshot. Selectors derive view-ready data from those snapshots without mutating state.

The reducer implementation is shared with `packages/monitor-ui/` (dual-reducer constraint) to keep both dashboards in sync during the transition period.

The Planning Workspace (`/console/plans`) uses REST requests rather than SSE and browses two read-only artifact kinds side by side: flat session plans and grouped session plan sets. On load it fetches both `API_ROUTES.sessionPlanList` and `API_ROUTES.sessionPlanSetList` (filtering to active artifacts by default, or including handed-off/submitted artifacts when the Include handed off toggle is enabled - the flag is forwarded to both list routes). The combined list is modeled as a discriminated union in `planning-artifacts.ts`, with selection keys encoded as `plan:<session>` and `plan-set:<planSetId>` so the two id spaces cannot collide. After the user selects an artifact, the detail fetch is dispatched by kind: flat plans call `API_ROUTES.sessionPlanShow` (metadata, readiness detail, markdown body via `SessionPlanDetail`), and plan sets call `API_ROUTES.sessionPlanSetShow` (manifest metadata, validation diagnostics, umbrella anchor content or a `missing-anchor` diagnostic, and per-child summary metadata via `SessionPlanSetDetail`). Plan-set child markdown is never fetched; only the summary returned by the show route is displayed. No daemon state is derived from the list responses alone, and the workspace exposes no mutation controls for either artifact kind.

## Adding a new control surface

- **Top-level Console route** - add route metadata and a nav item to `src/lib/navigation.ts` (update `ConsoleRouteBaseId`, `consoleRouteOrder`, `ROUTE_LABELS`, `toConsolePath`, `parseConsoleRoute`, and `buildNavItems`). `ControlSurfaceLinks` renders internal nav buttons automatically from `buildNavItems()`, so no direct edits to `src/components/header/control-surface-links.tsx` are needed for standard routes.
- **Non-route or external links** - add them directly to `src/components/header/control-surface-links.tsx` (e.g., the Monitor back-link that points outside the Console).
- **System route entry** - add a panel or section under `src/views/system/`. The system route is the home for configuration and diagnostic surfaces that do not need top-level navigation prominence.

## Dev

```bash
pnpm dev:console
```

Starts the Vite dev server for console-ui only (alias for `pnpm --filter @eforge-build/console-ui dev`).
