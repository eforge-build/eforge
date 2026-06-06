# @eforge-build/console-ui

The active monitoring dashboard for eforge. Console replaces the deleted earlier dashboard package and is the canonical local-first control surface served by the monitor daemon at `/console/`.

## Route table

The canonical route list lives in [`src/lib/navigation.ts`](src/lib/navigation.ts). The current routes are:

| Path | Route ID | Description |
|------|----------|-------------|
| `/console/` | `now` | Now dashboard - active builds, queue, and live status |
| `/console/builds/:detailId` | `buildDetail` | Build detail view for a session (legacy `/console/runs/:detailId` still resolves and canonicalizes to this path) |
| `/console/plans` | `plans` | Planning Workspace - read-only browsing of flat session plans and grouped session plan sets |
| `/console/system` | `system` | System - configuration, profiles, playbooks, extensions, and diagnostic surfaces |
| `/console/workstations` | `workstations` | Workstations - extension-registered sandboxed iframe workstations |
| `/console/workstations/:workstationId` | `workstationDetail` | Workstation detail route for a selected extension workstation |

All unrecognized paths (including previously removed routes) redirect to `now`.

## Data flow

```
daemon SSE
  → useActiveSessionStreams  (src/hooks/use-active-session-streams.ts)
  → reducer at src/lib/run-state/
  → selectors                (src/lib/selectors/ and src/lib/run-state/selectors/)
  → views

Lane-model behavior (planning vs validation vs gap-close lanes, PRD pill on the planning lane) is verified end-to-end by `multi-plan-gap-close.e2e.test.tsx` against `fixtures/multi-plan-gap-close.json`.

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
  → fetchAcceptSuccessPreview / acceptRecoverySuccess  (accepted-success eligibility + apply)
  → fetchQueueRecoveryAnalysis / applyQueueRecovery (advanced queue-cascade only)
      all from @eforge-build/client/browser
  → QueueRecoveryDialog        (src/views/now-dashboard.tsx, hosted at page root)
  → API_ROUTES.queue refresh   (src/hooks/use-daemon-events.ts)
  → QUEUE_REFRESH_RECEIVED     (src/lib/project-state.ts)

daemon REST (Now extension trust)
  → API_ROUTES.extensionList   GET /api/extensions/list (via fetchSystemExtensionList)
  → useExtensionTrustList      (src/hooks/use-extension-trust-list.ts, stale-preserving)
  → selectNowAttentionItems    derives warning items via the System trust-needed definition
  → AttentionPanel             extension Trust/Re-trust rows
  → API_ROUTES.extensionTrust  POST /api/extensions/trust { path, trustedBy: 'console-ui' }
      via useExtensionTrustMutation → trustSystemExtension
  → useExtensionTrustList.refresh  re-reads the list so a trusted item disappears

daemon REST (Workstations)
  → fetchExtensionContributionManifest / API_ROUTES.extensionContributionManifest
  → use-workstation-manifest.ts loads actions and consoleWorkstations (`srcDoc` or client-contract `frameBundle` entries)
  → workstation selectors choose list/detail and allowed action metadata
  → workstation-iframe.tsx renders sandboxed iframe entries from either `srcDoc` or daemon-provided `frameBundle.frameUrl` sources
  → workstation-bridge.ts invokes allowed actions through invokeExtensionAction
  → WorkstationsView at `/console/workstations` and `/console/workstations/:workstationId`

  → useSystemSurfaces / system-fetches.ts   loads extension inventory, global validation, contribution manifest
  → ExtensionsSection selects a row         (src/views/system/extensions-section.tsx)
  → extension-management-selectors.ts        pure eligibility/label/consequence selectors over ExtensionEntry
  → useExtensionManagementMutations          (src/views/system/use-extension-management-mutations.ts)
      tracks pending action, per-target error/success, reload result, selected validation result
  → extension-management-confirm-dialog.tsx  AlertDialog gate for every mutating action
  → fetch helpers in system-fetches.ts (route constants only, types from @eforge-build/client/browser):
      reloadSystemExtensions            POST API_ROUTES.extensionReload   {}                         → ExtensionReloadResponse
      validateSelectedSystemExtension   GET  API_ROUTES.extensionValidate ?name|?path (exactly one)  (no body)
      trustSystemExtension              POST API_ROUTES.extensionTrust    { path, trustedBy: 'console-ui' }
      untrustSystemExtension            POST API_ROUTES.extensionUntrust  { path }
      promoteSystemExtension            POST API_ROUTES.extensionPromote  { path }   (default no-force/no-trust)
      demoteSystemExtension             POST API_ROUTES.extensionDemote   { path }   (default no-force)
  → useSystemSurfaces.refresh()              invoked after every successful mutation, before success feedback
```

The Queue card is forward-only (running / pending / waiting stacks): a failed or skipped PRD already ran, so it is not shown there. The collapsed Queue card loose-list preview (`selectNowQueueSummary` in `src/lib/selectors/queue-summary.ts`) is built from **pending/waiting rows only**: `topItems`, `allItems`, `total`, and `hiddenCount` are derived from those forward rows *before* the four-item truncation, so the preview still surfaces real queue work even when the raw queue input starts with several failed or skipped rows. Running rows appear through the active-build/stack views, and failed/skipped rows stay in the attention surfaces. The full-queue counts (`runningCount`, `failedCount`, `skippedCount`, `withRecoveryVerdictCount`) are still computed over the entire queue input, not the truncated forward slice. `queue-card.tsx` keeps its `isForwardItem()` filter and empty/disclosure counts aligned with this pending/waiting selector contract. Failures that need a decision surface in the **Needs attention** strip (`AttentionPanel`) at the top of the Now dashboard, each carrying an explicit **Recover…** control that opens the recovery dialog hosted at the dashboard root. Recovery rows whose sidecar already records durable applied state are suppressed or annotated by `selectNowAttentionItems` so they are not re-rendered as ordinary actionable **Recover…** prompts. Failures remain in Build history as the permanent record. Recovery data loads only when the dialog opens. The strip also carries REST-backed extension trust alerts: untrusted and changed project-team extensions (loaded via `useExtensionTrustList`, route constants only) render warning rows with a **Trust/Re-trust** control that POSTs to `API_ROUTES.extensionTrust` as `console-ui` through `useExtensionTrustMutation`, then refreshes the list so a now-trusted item drops off; a failed mutation keeps the warning visible with the daemon error inline. So the strip mixes stream-derived health and queue state with this REST-backed extension trust data rather than being entirely fetch-free.

The recovery dialog leads with sidecar verdict recovery and compiled-build resume:

- **Recovery report** - on open it fetches the recovery sidecar via `fetchRecoverySidecar`. A 404 is treated as `recovery pending` (not a fatal error) and offers a confirmed **Run recovery analysis** action (`triggerRecoveryAnalysis`); other failures surface the daemon error. When a sidecar exists the verdict/confidence are shown via `RecoveryVerdictChip` and the markdown report is rendered through `SafeMarkdown` (`marked` + `DOMPurify`) inside a `plan-prose` container.
- **Recommended recovery action** - the sidecar verdict drives a single confirmed primary action (`applySidecarRecovery`): `retry` → **Re-queue PRD**, `split` → **Enqueue successor PRD** (continuing from the preserved feature branch when the sidecar records landed partial work), `abandon` → **Archive failed PRD**. A `manual` verdict shows **Manual review required** with no apply button. The apply call is idempotent: when the sidecar already carries durable applied metadata (`sidecar.json.applied`, e.g. `applied.action === 'split'` with the successor PRD id), the panel opens straight into an **already-applied** completion state and does not re-call `applySidecarRecovery`, so re-opening a sidecar after a successful split never double-enqueues.
- **Accepted-success recovery** - on open the dialog also fetches the accepted-success preview (`fetchAcceptSuccessPreview`). When the preview reports the failed PRD is eligible, the report panel renders the accepted-success action: a form requiring a **reason category** and a non-whitespace **note**, plus dependent-change checkboxes (defaulting to selected only for unblockable candidates, with blocked candidates shown but disabled). The confirm action stays disabled until both reason category and trimmed note are present. Its confirmation preview lists the cleanup, landing/PR action, durable audit fields, and the selected dependent changes drawn from the preview response, then applies via `acceptRecoverySuccess`. Completion shows the reason category, freeform reason, cleanup result, landing/PR result, and dependent-unblock result from the response.
- **Compiled-build resume** - `fetchResumeEligibility` runs as a read-only preflight. When eligible, a confirmed **Resume compiled build** action calls `startResumeBuild`, queues the failed PRD for scheduler-owned resume, and transitions to a resume completion panel; when ineligible, the daemon `reason` is shown. Both `status: 'queued'` and `status: 'already-queued'` (`ResumeBuildResponse`) are treated as success completion - the panel shows the daemon `detail` when present, otherwise the `status`. After dispatch and a successful resume, the engine retires the failed queue item and reactivates skipped descendants automatically. If an activated resume fails, the engine rolls the PRD back to `failed/` and refreshes the recovery sidecar from the resumed-run evidence, or replaces/removes stale evidence when only degraded context is available.
- **Advanced: queue-cascade retry/reactivation** - the lower-level explicit retry/repair lives in a collapsed advanced section. It states that it *moves the failed upstream back to the queue* and *may reactivate skipped descendants*, warns when the verdict is `manual` or confidence is `low`, fetches `fetchQueueRecoveryAnalysis` only once the section is opened, and applies via `applyQueueRecovery` (never sidecar apply) after an explicit confirmation.

All mutating, queueing, or worker-spawning actions go through an `AlertDialog` confirmation. After a successful sidecar apply or queue-cascade apply the dialog refreshes `API_ROUTES.queue` and dispatches `QUEUE_REFRESH_RECEIVED` so skipped rows disappear without waiting for a full SSE reconnect. Console consumes the client-owned browser helpers and never inlines `/api/...` paths.

**Completion transitions.** Once a queue-affecting mutation succeeds - or a sidecar reports durable applied state on open - `QueueRecoveryDialog` replaces the report/actions body with a stable completion panel (`src/components/recovery/recovery-completion-panel.tsx`). Completion state is a discriminated union (`sidecar-apply`, `resume`, `already-applied`, `accepted-success`) carrying an optional `refreshError` string. Data fetching and mutation state stay in `QueueRecoveryDialog`; the completion panel and the accepted-success form (`src/components/recovery/accept-success-action.tsx`) are presentational. The panel includes a close button that calls `onOpenChange(false)` and cues the operator to inspect the Queue card after queue-affecting actions.

**Refresh-after-mutation.** The dialog still calls `refreshQueue()` after every successful mutation, but a refresh failure is secondary feedback rather than a failed mutation. Each handler (`handleApplySidecar`, `handleResume`, accepted-success apply) runs the mutation, then attempts `refreshQueue()`, then sets the completion state with any refresh error attached as `refreshError`. When the refresh rejects, the completion panel stays visible and renders the refresh error as follow-up text; the underlying mutation is never reported as failed.

## System extension management

The Extensions section under `/console/system` (`src/views/system/extensions-section.tsx`) is a first-class management surface for discovered native extensions, layered on top of the existing inventory, global validation summary, registration totals, and diagnostics. It keeps the inventory scannable while adding a details panel for the selected extension and a low-input action set wired to existing daemon APIs. Extension Contributions remain immediately after Extensions. The Now dashboard's **Needs attention** trust flow is unaffected: `useExtensionTrustMutation` and `TrustConfirmDialog` stay available to the attention strip, while System gets its own management hook (`useExtensionManagementMutations`) and confirmation dialog (`extension-management-confirm-dialog.tsx`).

**Route constants and contracts.** Every request uses an `API_ROUTES` constant and request/response types exported from `@eforge-build/client/browser`; Console declares no local daemon response interfaces and inlines no `/api/...` path literals. The management area covers a global `Reload extensions` control (`API_ROUTES.extensionReload`), per-extension selected validation (`API_ROUTES.extensionValidate`), project-team Trust/Re-trust (`API_ROUTES.extensionTrust`), project-team Untrust (`API_ROUTES.extensionUntrust`), project-local Promote (`API_ROUTES.extensionPromote`), and project-team Demote (`API_ROUTES.extensionDemote`).

**Targeting.** Each request carries exactly one target identifier. Trust, untrust, promote, and demote use `path` so duplicate extension names cannot select the wrong extension. Selected validation uses `path` for project-local and project-team entries and `name` for user/external entries whose paths may sit outside the project-root validation guard.

**Action eligibility.** Eligibility lives in pure selectors (`extension-management-selectors.ts`): reload is always available; validate is available for project-local, project-team, and user entries (and external entries when a name exists); trust is available for `project-team` + `untrusted`; re-trust for `project-team` + `changed`; untrust for `project-team` + `trusted`; promote for `project-local`; demote for `project-team`. User entries render no trust/untrust/promote/demote controls and instead show an unavailable note in the details panel.

**Confirmation and feedback.** Every mutating action (reload, trust/re-trust, untrust, promote, demote) is gated by an `AlertDialog` whose copy names the target extension identity, path, scope, and current trust state, states the action's consequences, and includes an unsandboxed-code / supply-chain warning (native code may execute after reload). The selected validation result and diagnostics render alongside - not in place of - the global validation summary. Reload success feedback surfaces the daemon message and watcher restart/replacement metadata from `ExtensionReloadResponse`. Daemon errors are shown verbatim in `role="alert"` elements, and rows stay rendered and actionable after a failed mutation.

**Refresh-after-mutation.** After every successful mutating action the management hook invokes the System refresh callback (`useSystemSurfaces.refresh()`) before recording success feedback. Failed mutations do not refresh.

**Deferred.** Package lifecycle workflows - `new`, `install`, `update`, `remove`, and `test` - are explicitly deferred from this surface, along with force-overwrite promote, promote-with-trust, package/source and replay-source input UX, global enable/disable workflows, and any arbitrary extension-supplied frontend bundles, React components, browser JavaScript, or extension-owned HTTP routes. Pi and Claude extension management are out of scope here.

The `useActiveSessionStreams` hook subscribes to per-session SSE streams for all active session IDs. Each stream's events are folded through the run-state reducer to produce a `RunState` snapshot. Selectors derive view-ready data from those snapshots without mutating state.

The run-state reducer is Console-owned and folds per-session SSE events into view-ready snapshots.

The Planning Workspace (`/console/plans`) uses REST requests rather than SSE and browses two read-only artifact kinds side by side: flat session plans and grouped session plan sets. On load it fetches both `API_ROUTES.sessionPlanList` and `API_ROUTES.sessionPlanSetList` (filtering to active artifacts by default, or including handed-off/submitted artifacts when the Include handed off toggle is enabled - the flag is forwarded to both list routes). The combined list is modeled as a discriminated union in `planning-artifacts.ts`, with selection keys encoded as `plan:<session>` and `plan-set:<planSetId>` so the two id spaces cannot collide. After the user selects an artifact, the detail fetch is dispatched by kind: flat plans call `API_ROUTES.sessionPlanShow` (metadata, readiness detail, markdown body via `SessionPlanDetail`), and plan sets call `API_ROUTES.sessionPlanSetShow` (manifest metadata, validation diagnostics, umbrella anchor content or a `missing-anchor` diagnostic, and per-child summary metadata via `SessionPlanSetDetail`). Plan-set child markdown is never fetched; only the summary returned by the show route is displayed. No daemon state is derived from the list responses alone, and the workspace exposes no mutation controls for either artifact kind.

## Lane model

The pipeline swimlane groups agent threads into lanes keyed by the agent-event `planId`. A single ordered lane registry (`src/lib/run-state/lane-registry.ts`) is the source of truth for display labels and sort order.

| Lane ID | Label | Order | Kind |
|---------|-------|-------|------|
| `planning` | Planning | 0 | phase |
| `plan-NN-*` | Plan NN | 1 | plan |
| `validation` | Validation | 2 | phase |
| `gap-close` | Gap Close | 3 | phase |
| `final-validation` | Final Validation | 4 | phase |

- **Phase lanes** are orchestrator-assigned lifecycle phases that do not appear in `earlyOrchestration.plans`. They render only when they have agent threads (activity-gated - no synthetic `planStatuses` entries).
- **Plan lanes** are per-PRD build lanes declared by the orchestrator. Within order tier 1, they are sub-sorted by orchestration declaration order.
- The `planning` lane has a dedicated row in the Now card (`selectPlanningLane`) and is excluded from `selectPlanLanes` extras to avoid duplication.
- The PRD source pill renders on the planning lane when planning threads exist; otherwise it falls back to the Compile/Source row.

Consumers (`plan-progress.ts`, `pipeline-colors.ts`, `thread-pipeline.tsx`) call `laneLabel(id)` and `laneOrder(id)` instead of maintaining local label/order maps.

## Adding a new control surface

- **Source-owned top-level Console route** - add route metadata and a nav item to `src/lib/navigation.ts` (update `ConsoleRouteBaseId`, `consoleRouteOrder`, `ROUTE_LABELS`, `toConsolePath`, `parseConsoleRoute`, and `buildNavItems`). `ControlSurfaceLinks` renders internal nav buttons automatically from `buildNavItems()`, so no direct edits to `src/components/header/control-surface-links.tsx` are needed for standard first-party routes.
- **Daemon-manifest declarative System contribution** - register the contribution with the extension manifest and render it under `/console/system` in the Extensions/System area. These contributions use the Console-owned declarative renderer set and do not require edits to `src/lib/navigation.ts` or new top-level routes.
- **Extension-registered workstation** - register `registerConsoleWorkstation` from a native extension. Console discovers it from the contribution manifest, lists it under `/console/workstations`, renders trusted iframe workstation entries, and invokes only manifest-allowed actions through the parent bridge. Source-authored entries use either `srcDoc` or `frameBundle`; bundle entries render from the manifest `frameBundle.frameUrl` with the bridge token in the URL fragment. This is the supported V1 rich extension UI path and does not require source-owned route edits.
- **Non-route or external links** - add them directly to `src/components/header/control-surface-links.tsx` when they do not belong in the top-level Console route list.
- **System route entry** - add a panel or section under `src/views/system/`. The system route is the home for configuration and diagnostic surfaces that do not need top-level navigation prominence.

Arbitrary extension-supplied frontend bundles outside the daemon-owned workstation frame/asset contract, direct React component loading, private React imports, browser JavaScript outside workstation documents, and extension-owned HTTP routes are deferred beyond the current declarative contribution and workstation models.

## Dev

```bash
pnpm dev:console
```

Starts the Vite dev server for console-ui only (alias for `pnpm --filter @eforge-build/console-ui dev`).
