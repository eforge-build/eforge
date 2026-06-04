---
title: Add Queued PRD Priority and Removal Controls
created: 2026-06-04
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Add Queued PRD Priority and Removal Controls

## Problem / Motivation

Users can assign queue priority only at enqueue time. After a PRD is written to `.eforge/queue/`, there is no supported way to reprioritize it or remove a non-running queued item through daemon/client/CLI/Console/Pi/MCP surfaces.

This matters because auto-build can dispatch items while the user is staging or correcting queue state. Current alternatives are unsafe or incomplete:

- Editing `.eforge/queue/*.md` by hand bypasses typed validation and scheduler notifications.
- `POST /api/cancel/:sessionId` only cancels active workers.
- Queue-cascade recovery targets failed/skipped dependency repair, not normal pending queue surgery.

Backlog source: `.eforge/backlog/items/backlog-2026-06-03-add-first-class-queued-prd-priority-and-removal-controls.md`.

Roadmap alignment: `docs/roadmap.md` explicitly calls for daemon/MCP/web UI controls to change queued PRD priority at runtime, and Console Observability lists queue management as an actionable build-control surface.

Classification: feature / deep. This is a cross-package user-facing control surface covering engine queue filesystem helpers, daemon/client route contract, CLI, MCP/Pi tools, Console UI, docs, and tests, but it fits one cohesive implementation plan rather than delegated module planning.

Confirmed current state:

- Queue priority already exists as optional PRD frontmatter in `packages/engine/src/prd-queue.ts`.
- `resolveQueueOrder()` sorts dependency waves by lower numeric `priority` first, then `created`.
- The daemon exposes `GET /api/queue`, queue recovery, and scheduler kick routes.
- `packages/client/src/routes/route-map.ts` has no priority mutation or queue-item removal route.
- `packages/client/src/api/queue.ts` exposes enqueue, cancel, and queue reads.
- Cancel targets active `sessionId` workers, not queued PRD ids.
- Queue projection reads root, `waiting/`, `failed/`, and `skipped/` directories in `packages/monitor/src/projections/queue-items.ts`.
- Failed sidecar verdicts are projected from `<prdId>.recovery.json`.
- Scheduler reconciliation in `packages/engine/src/queue/scheduler.ts` refreshes existing PRD frontmatter but currently preserves original `orderedPrds` ordering.
- Scheduler reconciliation removes only phantom running entries.
- Deleted pending entries and reprioritized pending entries need explicit reconciliation.
- CLI queue commands currently support `list`, `run`, and internal `exec`.
- CLI queue commands do not include `priority` or `remove`.
- Console Now queue rows display priority but have no mutation actions.
- Pi and Claude/MCP currently expose `eforge_queue_list` only.
- Project policy says consumer-facing CLI/MCP/Pi behavior should stay in sync when feasible.

## Goal

Add first-class, typed controls to reprioritize queued PRDs and remove non-running queued PRDs across the daemon API, shared client, CLI, Claude/MCP, Pi, and Console UI.

Successful mutations should update queue files safely, notify the scheduler, reconcile dispatch order from filesystem state, and preserve running-build safety and dependency safety.

## Approach

### Route shape and ownership

- Add route constants under `@eforge-build/client`.
- Dispatch through monitor route modules.
- Do not inline `/api/...` strings in CLI, MCP, Pi, Console, or tests.
- Recommended priority route: `POST /api/queue/:prdId/priority` with body `{ priority: number }`.
- Recommended removal route: `DELETE /api/queue/:prdId`.
- If `DELETE` with no body is awkward for existing request helpers, use `POST /api/queue/:prdId/remove`.
- Keep the route constant named by behavior.
- The client package owns daemon route contracts.
- New clients must fail version verification against stale daemons.

### Priority mutation semantics

- Allow priority mutation for `pending` root PRDs.
- Allow priority mutation for `waiting` PRDs.
- Reject live `running` PRDs with HTTP 409.
- Running rejection messages must state that running builds must be cancelled by session id through the existing cancel route.
- Reject `failed` priority mutation with HTTP 409.
- Reject `skipped` priority mutation with HTTP 409.
- Failed and skipped terminal queue items are not dispatch candidates.
- Recovery/requeue remains the path to make terminal items runnable again.
- Accept only finite integers.
- Preserve existing ordering semantics where lower numeric priority runs first and absent priority sorts last.
- This first slice avoids implying that priority changes affect already-terminal items.

### Removal semantics

- Allow removal for non-running queue items in root pending.
- Allow removal for non-running queue items in `waiting/`.
- Allow removal for non-running queue items in `failed/`.
- Allow removal for non-running queue items in `skipped/`.
- Refuse a root item with a live lock as running.
- For stale or corrupt locks, remove the lock best-effort and then remove the file, matching existing scheduler reconciliation behavior for stale/corrupt locks.
- When removing a failed PRD, remove `<prdId>.recovery.md` from the same failed directory if present.
- When removing a failed PRD, remove `<prdId>.recovery.json` from the same failed directory if present.
- Return 404 for unknown ids.
- Return 409 for live running ids.
- Return 409 for dependency-safety refusals.
- Queue state is gitignored runtime state.
- Failed sidecars are meaningful only while the failed PRD exists.

### Dependency safety for removal

- Before removing a live upstream with dependents, fail closed unless every dependent is already terminal or outside the live queue response.
- The error should list dependent ids.
- The error should tell callers to remove dependents first or use future cascade controls.
- Do not silently cascade-skip in this first slice.
- Do not silently cascade-delete in this first slice.
- Cascade-aware cancellation is explicitly deferred.
- Accidental orphaning would be worse than a conservative refusal.

### Scheduler reconciliation

- Treat successful priority and remove mutations like any other queue mutation.
- The daemon notifies the scheduler.
- The scheduler re-reads the root queue before launching more work.
- Rebuild dispatch order from `resolveQueueOrder(freshPrds)` on every discovery tick.
- Preserve per-PRD state from `prdState`.
- Remove stale pending in-memory PRDs whose root file disappeared.
- Remove stale blocked in-memory PRDs whose root file disappeared.
- Keep conservative handling for live running locks.
- Correctness should come from one reconciliation path, not route-specific scheduler surgery.

### UI and UX

- CLI commands should be explicit and scriptable.
- Add `eforge queue priority <prdId> <priority>`.
- Add `eforge queue remove <prdId>`.
- Console row actions should be narrow.
- Console should support numeric priority update.
- Console should support remove with confirmation.
- Failed/skipped terminal removal may stay in CLI/MCP for the first PR if threading it into Needs Attention would expand the UI scope too much.
- If failed/skipped terminal removal is exposed in Console, it must not remove during render.
- If failed/skipped terminal removal is exposed in Console, it must refresh queue on success.
- MCP/Pi should expose equivalent mutation actions to maintain consumer-facing parity.

### Events

- No new engine build event is required for the first slice unless tests reveal Console/SSE needs an explicit audit event.
- Queue list refresh after `queue:mutation` is sufficient for current UI state.
- If a new event is added for observability, define it in `packages/client/src/events.schemas.ts`.
- If a new event is added for observability, project it through daemon streams.
- Otherwise avoid expanding the closed event contract.

### Client route and wire contract impact

- Update `packages/client/src/routes/route-map.ts` with route keys such as `queuePriority` and `queueRemove`.
- Bump `DAEMON_API_VERSION` in `packages/client/src/api-version-const.ts` because new clients will rely on daemon support.
- Update `packages/client/src/routes.ts` or a focused queue route type file to export request/response types for priority/remove operations.
- Update `packages/client/src/api/queue.ts` with `apiUpdateQueuePriority`.
- Update `packages/client/src/api/queue.ts` with `apiUpdateQueuePriorityIfRunning`.
- Update `packages/client/src/api/queue.ts` with `apiRemoveQueueItem`.
- Update `packages/client/src/api/queue.ts` with `apiRemoveQueueItemIfRunning`.
- Use `API_ROUTES` and `buildPath` rather than inline path literals.
- Update `packages/client/src/index.ts`.
- Update browser exports for CLI, MCP/Pi, and Console.

### Engine queue helper impact

- Update `packages/engine/src/prd-queue.ts`.
- Add helper(s) to find a PRD by id across queue root, `waiting/`, `failed/`, and `skipped/`.
- Classify status using root lock state.
- Update `priority` frontmatter for pending PRDs.
- Update `priority` frontmatter for waiting PRDs.
- Remove non-running queue items.
- Delete failed recovery sidecars with a failed PRD.
- Reject live running PRDs.
- Reuse existing `setQueuedPrdFrontmatterFields`.
- Reuse existing `readPrdLockStatus`.
- Reuse existing `loadQueue`.
- Reuse existing `releasePrd`.
- Reuse path-safe queue-dir resolution patterns.
- Add a removal helper instead of open-coding deletes in daemon routes.

### Daemon route impact

- Add a queue-control route module or extend control-plane routes.
- Keep route keys registered in `CONTROL_MONITOR_ROUTE_KEYS`.
- Keep route coverage tests updated.
- Use local mutation security via `localMutation`.
- Use JSON body validation conventions from existing control routes.
- On success, call `context.notifyQueueMutation('external')` or a more specific existing reason if the reason union is expanded.
- Keep scheduler notifications after successful filesystem mutation only.
- Return typed minimal mutation results containing `id`.
- Return typed minimal mutation results containing previous/current status.
- Return priority where applicable.
- Return removed sidecar paths/count where applicable if useful.

### Scheduler impact

- Update `packages/engine/src/queue/scheduler.ts`.
- Update `discoverNewPrds()`.
- Update `reconcileQueueState()`.
- Fresh queue order should replace stale in-memory ordering for root PRDs.
- Pending PRDs whose root file disappeared should be removed from `prdState`.
- Blocked PRDs whose root file disappeared should be removed from `prdState`.
- Pending PRDs whose root file disappeared should be removed from `orderedPrds`.
- Blocked PRDs whose root file disappeared should be removed from `orderedPrds`.
- Add tests proving a priority mutation changes the next dequeued PRD before dispatch.
- Add tests proving a deleted pending PRD is not launched after a queue mutation.

### CLI and host integration impact

- Update `packages/eforge/src/cli/index.ts`.
- Add `eforge queue priority <prdId> <priority>`.
- Add `eforge queue remove <prdId>`.
- Commands must call typed daemon helpers.
- Commands must render clear success messages.
- Commands must render clear error messages.
- Update `packages/eforge/src/cli/mcp-proxy.ts`.
- Add or extend queue mutation tool support for Claude/MCP.
- Update `packages/pi-eforge/extensions/eforge/index.ts`.
- Mirror the MCP tool behavior in Pi.
- Keep the Pi package version unchanged per project policy.
- Bump only the Claude plugin version if plugin files change.

### Console UI impact

- Update `packages/console-ui/src/hooks/use-daemon-events.ts` with queue mutation callbacks, or keep queue mutation handlers in `NowDashboard` using browser-safe client helpers.
- Always call `refreshQueue()` after successful mutation.
- Update `packages/console-ui/src/views/now-dashboard.tsx`.
- Update `packages/console-ui/src/components/now/queue-card.tsx`.
- Pass row action handlers.
- Render set-priority controls for forward queue rows.
- Render remove controls for forward queue rows.
- Use existing shadcn components such as `Button` and `AlertDialog`.
- Use native number input if needed.
- Avoid mutating during render.
- Update `packages/console-ui/src/components/now/queue-stack-card.tsx`.
- Add equivalent actions for stacked/waiting rows if stack rendering owns those rows.

### Documentation impact

- Update human-authored queue docs.
- Regenerate reference docs when route surfaces change.
- Regenerate reference docs when CLI surfaces change.
- Regenerate reference docs when tool surfaces change.
- The roadmap line can remain if follow-up queue controls are still planned.
- The roadmap line can be narrowed to hold/pause/cascade controls after this first slice ships.
- Update `docs/architecture.md` to describe runtime priority mutation.
- Update `docs/architecture.md` to describe non-running queue removal.
- Update `docs/architecture.md` to describe failed-sidecar cleanup.
- Update `docs/architecture.md` to describe dependency-safety refusal.
- Update `docs/architecture.md` to describe scheduler reconciliation.
- Update `docs/config.md` queue behavior around `prdQueue.dir`, `priority`, and queue commands if this section remains the canonical user-facing config doc.
- Update `README.md` runtime queue-file overview if it currently implies queue mutations are enqueue/recovery only.
- Update `docs/roadmap.md` after implementation so the roadmap remains future-focused.
- Leave follow-up queue hold/pause/cascade controls in the roadmap if still unshipped.
- Update public docs under `web/content/docs/`.
- Update concepts/configuration/glossary/troubleshooting or integrations pages that mention queue priority and queue commands.
- Regenerate or update generated reference docs under `web/content/reference/*`.
- Regenerate or update generated reference docs under `web/public/*`.
- Pi/Claude skills likely do not need broad workflow changes unless new queue-control skills are added.
- Tool descriptions must reflect the new mutation surface.
- Reference artifacts must reflect the new mutation surface.

### Tests likely touched

- `test/queue-scheduler-policy.test.ts`.
- `test/queue-piggyback.test.ts`.
- `packages/monitor/src/__tests__/routes-control-plane*.test.ts`.
- `packages/monitor/src/__tests__/routes-index-coverage.test.ts`.
- `test/client-no-start-api-helpers.test.ts`.
- Console queue-card tests.
- MCP/Pi tests.

### Architecture impact

- This change adds a typed queue-control API surface.
- This change stays within existing boundaries.
- Engine owns queue-file semantics.
- Locating queue items belongs in `packages/engine/src/prd-queue.ts`.
- Frontmatter mutation belongs in `packages/engine/src/prd-queue.ts`.
- Lock-state checks belong in `packages/engine/src/prd-queue.ts`.
- File deletion belongs in `packages/engine/src/prd-queue.ts`.
- File deletion should not be implemented as ad hoc route code.
- Client owns daemon route constants and wire types.
- New route keys belong in `@eforge-build/client`.
- Request/response interfaces belong in `@eforge-build/client`.
- API helpers belong in `@eforge-build/client`.
- Version bump belongs in `@eforge-build/client`.
- Monitor/daemon owns HTTP mutation orchestration.
- Route handlers validate HTTP inputs.
- Route handlers call engine helpers.
- Route handlers notify scheduler.
- Route handlers return typed responses.
- Scheduler remains event/reconciliation driven.
- Routes should not mutate scheduler internals directly.
- Routes should emit queue mutation notifications.
- Routes should rely on `discoverNewPrds()` / reconciliation.
- Console remains a renderer/controller over typed daemon APIs.
- UI actions call browser-safe helpers.
- UI actions refresh queue state.
- Console does not inspect filesystem paths.
- Console does not infer locks.
- Pi/Claude integrations remain thin host surfaces over the same daemon/client primitives.

### Public API impact

- New daemon API routes are additive.
- New client helper exports are additive.
- A daemon API version bump is still required so stale daemon/client combinations fail early.
- Queue item wire shape may not need to change unless UI capability metadata is added.
- Avoid adding capability metadata in this first slice because a separate backlog item tracks richer queue controls.

### Operational impact

- Queue mutations remain filesystem-only.
- Queue mutations remain gitignored.
- No git commits are produced.
- Successful mutations should be visible through refreshed `/api/queue` responses.
- Successful mutations should be visible through scheduler behavior.
- Successful mutations should not rely on artifact history.

### Risks and mitigations

- Scheduler race with auto-build: a PRD might be selected while a priority/remove request is in flight.
- Mitigate scheduler race by refusing live locks.
- Mitigate scheduler race by notifying scheduler only after successful mutation.
- Mitigate scheduler race by reconciling from filesystem before launching.
- Mitigate scheduler race by adding race-oriented scheduler tests.
- Stale in-memory scheduler state: current scheduler preserves original `orderedPrds` ordering and does not remove all deleted pending state.
- Mitigate stale in-memory scheduler state by making reconciliation rebuild fresh root ordering.
- Mitigate stale in-memory scheduler state by deleting missing pending/blocked entries.
- Dependency orphaning: removing an upstream pending/waiting item could leave dependents blocked forever or inconsistently displayed.
- Mitigate dependency orphaning by failing closed when live dependents exist.
- Mitigate dependency orphaning by deferring cascade semantics to the separate follow-up item.
- Failed sidecar drift: removing a failed PRD without sidecars would leave misleading recovery artifacts.
- Mitigate failed sidecar drift by deleting matching `.recovery.md` and `.recovery.json` sidecars in the failed directory.
- API drift across clients: Console, CLI, MCP, Pi, and daemon could diverge.
- Mitigate API drift by adding route constants/types/helpers in `@eforge-build/client`.
- Mitigate API drift by bumping daemon API version.
- Mitigate API drift by updating both host integrations.
- Mitigate API drift by testing helper/route parity.
- Over-scoped Console UI: adding rich queue management could spill into hold/pause/cascade workflows.
- Mitigate Console scope risk by exposing only set-priority and remove with explicit confirmation.
- Mitigate Console scope risk by not adding pause/hold/cascade metadata in this slice.
- Test fragility: scheduler timing tests can be flaky.
- Mitigate test fragility by using existing deterministic scheduler helper patterns.
- Mitigate test fragility by avoiding subprocess timing where possible.
- Backward compatibility risk: old daemons will not know new routes.
- Mitigate backward compatibility risk with a daemon API version bump.
- Mitigate backward compatibility risk with client helper tests for stale daemon behavior.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Lower numeric `priority` should continue to mean earlier dispatch. | Verified in `packages/engine/src/prd-queue.ts`: `resolveQueueOrder()` sorts priority ascending and nulls last. | high | low | Existing queue-order tests plus new priority-mutation scheduler test. | Medium; UI/CLI wording would invert behavior if misunderstood. |
| Priority mutation should be limited to pending/waiting PRDs for the first slice. | Verified failed/skipped items are terminal in `loadQueueItems()` projection and recovery docs; terminal items are not forward dispatch candidates. | medium | low | Confirm with implementation review; add 409 route tests for failed/skipped priority mutation. | Low/medium; users might expect setting priority before recovery retry, but that can be added later. |
| Removal should include pending, waiting, failed, and skipped items but refuse live running locks. | Backlog explicitly lists pending/waiting/failed/skipped removal; `readPrdLockStatus()` provides live/stale/corrupt/absent classification for root queue locks. | high | low | Add helper tests for each status and lock state. | High if wrong; unsafe deletion of running PRDs could corrupt builds. |
| Deleting failed PRDs should delete matching recovery sidecars. | `loadQueueItems()` reads failed sidecars only for failed PRD ids; recovery docs describe sidecars as tied to the failed PRD. | high | low | Add removal helper and daemon route tests for sidecar cleanup. | Medium; stale sidecars could confuse recovery surfaces. |
| Dependency-safe removal should fail closed rather than cascade. | Separate backlog item tracks cascade-aware cancellation; `propagateSkip()` currently cascades only on terminal completion, not arbitrary user removal. | high | low | Add route/helper tests that removal of an upstream with live dependents returns 409 and leaves files unchanged. | High; silent cascade/delete would exceed scope and surprise users. |
| Scheduler can reconcile priority changes through filesystem re-read without a new event type. | `QueueScheduler` already responds to `queue:mutation` by calling `tick()` and uses filesystem state as source of truth for enqueue/recovery changes. | medium | medium | Implement and test reorder/deletion reconciliation with deterministic scheduler tests. | High if wrong; UI/API would report success while scheduler dispatches stale order or deleted items. |
| CLI should require a running daemon for mutation commands rather than directly editing files. | Goal is typed daemon/client support and scheduler notification; direct file edits would bypass auto-build scheduler. Existing queue list is direct, but mutations need live daemon coordination. | medium | low | Confirm during implementation against CLI daemon helper patterns. | Medium; if daemonless mutation is required, CLI UX must be extended carefully. |
| Console can use native number input or existing UI primitives without adding a new component dependency. | Existing UI package includes Button, AlertDialog, Dialog, Select, Dropdown, but not an Input component. | high | low | Implement with native input or add a small local component if needed; test with React Testing Library. | Low; mostly UI implementation detail. |
| Updating Pi and Claude/MCP host tools is required for parity. | Project instructions state consumer-facing CLI/MCP/tool behavior should be synced between `eforge-plugin/` and `packages/pi-eforge/`; current search found `eforge_queue_list` in both. | high | low | Update both surfaces and tool/reference tests. | Medium; otherwise users see inconsistent integration behavior. |

No unresolved low-confidence/high-impact assumptions remain. The highest-impact scheduler reconciliation and running-lock safety assumptions are validated enough to plan, and the plan includes mandatory tests that will prove them before landing.

### Profile signal

Recommended profile: `excursion`.

Rationale: this is a cross-package feature touching engine queue helpers, daemon/client route contracts, scheduler reconciliation, CLI/MCP/Pi integrations, Console UI, docs, and tests. The work is broad but cohesive: a single planner can enumerate the files, contracts, semantics, risks, and tests without delegating independent subsystem planning. It is not an `errand` because the scheduler and multi-surface route contract need coordinated tests. It is not an `expedition` because there are no separate modules requiring independent module-planner discovery.

## Scope

In scope:

- Add client-owned route constants for queued PRD priority mutation.
- Add client-owned route constants for queued PRD removal.
- Add client-owned wire types for queued PRD priority mutation.
- Add client-owned wire types for queued PRD removal.
- Add daemon HTTP routes that mutate queue files under the configured `prdQueue.dir`.
- Notify the scheduler with `context.notifyQueueMutation(...)` after successful mutations.
- Add engine-owned queue filesystem helpers for locating queue items.
- Add engine-owned queue filesystem helpers for validating mutable statuses.
- Add engine-owned queue filesystem helpers for rewriting `priority` frontmatter.
- Add engine-owned queue filesystem helpers for deleting PRD files.
- Add engine-owned queue filesystem helpers for deleting failed recovery sidecars when a failed PRD is removed.
- Add engine-owned queue filesystem helpers for refusing live running PRDs.
- Update scheduler reconciliation so a deleted pending root PRD is removed from in-memory scheduler state.
- Update scheduler reconciliation so a changed priority affects subsequent dispatch order before the next launch.
- Add typed `@eforge-build/client` helpers.
- Add browser-safe helpers if Console needs them.
- Add client exports.
- Add `eforge queue priority <prdId> <priority>`.
- Add `eforge queue remove <prdId>`.
- Add host integration controls in Claude/MCP.
- Add host integration controls in Pi.
- Support queue priority actions in host integrations either by extending the queue tool surface or by adding clear companion tools.
- Support queue remove actions in host integrations either by extending the queue tool surface or by adding clear companion tools.
- Keep Claude/MCP and Pi consumer-facing behavior in sync when feasible.
- Add Console Now queue row actions for forward queue items with status `pending`.
- Add Console Now queue row actions for forward queue items with status `waiting`.
- Add Console Now set-priority actions.
- Add Console Now remove actions.
- Failed/skipped removal can be exposed in the attention/recovery area only if it is cheap and consistent with the existing Needs Attention model.
- Update docs for API routes.
- Update docs for CLI commands.
- Update docs for tools.
- Update docs for queue behavior.
- Update docs for Console controls.
- Update generated reference artifacts.
- Add focused tests for engine helper behavior.
- Add focused tests for daemon route contracts/security.
- Add focused tests for client helpers.
- Add focused tests for CLI surfaces.
- Add focused tests for MCP surfaces.
- Add focused tests for Pi surfaces.
- Add focused tests for scheduler reconciliation.
- Add focused tests for Console UI actions.

Out of scope:

- Per-PRD hold/unhold.
- Global queue pause/resume UI.
- Cascade-aware soft cancellation.
- Per-item capability metadata.
- Cancelling a live running worker by queued PRD id.
- Running cancellation changes outside the existing session/worker-oriented cancel route.
- Changing dependency relationships after enqueue.
- Changing stack parents after enqueue.
- Changing landing action after enqueue.
- Changing profile after enqueue.
- Changing PRD body content after enqueue.
- Automatic cascade deletion of dependents when removing an upstream.
- Arbitrary Console frontend extension surfaces.
- Any hold, pause, cascade, and capability metadata work tracked by the separate follow-up backlog item.
- Any implementation that silently or unsafely orphans live dependents.

## Acceptance Criteria

- `@eforge-build/client` exports typed route constants for queued PRD priority mutation.
- `@eforge-build/client` exports typed route constants for queued PRD removal.
- `@eforge-build/client` exports request types for queued PRD priority mutation.
- `@eforge-build/client` exports request types for queued PRD removal.
- `@eforge-build/client` exports response types for queued PRD priority mutation.
- `@eforge-build/client` exports response types for queued PRD removal.
- `@eforge-build/client` exports daemon API helpers for queued PRD priority mutation.
- `@eforge-build/client` exports daemon API helpers for queued PRD removal.
- No inline `/api/...` queue-control literals are added outside the client route map.
- The daemon API version is bumped.
- Stale daemon/client version checks fail before new queue-control helpers are used against a daemon that lacks the new routes.
- A priority mutation request for a pending root PRD rewrites that PRD's `priority` frontmatter.
- A priority mutation request for a pending root PRD preserves the PRD body.
- A priority mutation request for a pending root PRD preserves unrelated frontmatter fields.
- A priority mutation request for a pending root PRD returns the updated priority in the response.
- A successful priority mutation request for a pending root PRD notifies the queue scheduler.
- A priority mutation request for a pending root PRD causes the next scheduler dispatch wave to use the new priority order.
- A priority mutation request for a waiting PRD rewrites that PRD's `priority` frontmatter in `waiting/`.
- A priority mutation request for a waiting PRD preserves the PRD body.
- A priority mutation request for a waiting PRD preserves unrelated frontmatter fields.
- A priority mutation request for a waiting PRD returns the updated priority in the response.
- A priority mutation request for a waiting PRD preserves its dependency frontmatter.
- A priority mutation request with a non-integer priority returns HTTP 400.
- A priority mutation request with a non-integer priority leaves the queue file unchanged.
- A priority mutation request for a live running PRD returns HTTP 409.
- A priority mutation request for a live running PRD identifies the item as running.
- A priority mutation request for a live running PRD leaves the PRD file unchanged.
- A priority mutation request for a live running PRD leaves the lock file unchanged.
- A priority mutation request for a failed PRD returns HTTP 409.
- A priority mutation request for a failed PRD leaves the queue file unchanged.
- A priority mutation request for a failed PRD leaves recovery sidecars unchanged.
- A priority mutation request for a skipped PRD returns HTTP 409.
- A priority mutation request for a skipped PRD leaves the queue file unchanged.
- A priority mutation request for a skipped PRD leaves recovery sidecars unchanged.
- A remove request for a pending root PRD deletes that PRD file.
- A successful remove request for a pending root PRD notifies the queue scheduler.
- The scheduler does not dispatch a pending root PRD after it has been removed by a successful remove request.
- A remove request for a waiting PRD deletes that PRD file from `waiting/`.
- A remove request for a waiting PRD does not modify unrelated waiting queue items.
- A remove request for a waiting PRD does not modify unrelated pending queue items.
- A remove request for a waiting PRD does not modify unrelated failed queue items.
- A remove request for a waiting PRD does not modify unrelated skipped queue items.
- A remove request for a failed PRD deletes the failed PRD file.
- A remove request for a failed PRD deletes the matching `.recovery.md` sidecar file when it exists.
- A remove request for a failed PRD deletes the matching `.recovery.json` sidecar file when it exists.
- A remove request for a skipped PRD deletes the skipped PRD file.
- A remove request for a skipped PRD does not modify unrelated skipped queue items.
- A remove request for a live running PRD returns HTTP 409.
- A remove request for a live running PRD leaves the PRD file unchanged.
- A remove request for a live running PRD leaves the lock file unchanged.
- A remove request for an upstream PRD with live pending dependents returns HTTP 409.
- A remove request for an upstream PRD with live waiting dependents returns HTTP 409.
- A remove request for an upstream PRD with live pending dependents lists the dependent ids.
- A remove request for an upstream PRD with live waiting dependents lists the dependent ids.
- A remove request for an upstream PRD with live pending or waiting dependents leaves the upstream file unchanged.
- A remove request for an upstream PRD with live pending or waiting dependents leaves dependent files unchanged.
- A remove request for an unknown PRD id returns HTTP 404.
- A remove request for an unknown PRD id leaves the queue directory unchanged.
- `eforge queue priority <prdId> <priority>` calls the typed daemon helper.
- `eforge queue priority <prdId> <priority>` prints a success message that includes the PRD id on success.
- `eforge queue priority <prdId> <priority>` prints a success message that includes the new priority on success.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on validation failure.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on not-found failure.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on conflict failure.
- `eforge queue priority <prdId> <priority>` exits non-zero with the daemon error message on daemon-unavailable failure.
- `eforge queue remove <prdId>` calls the typed daemon helper.
- `eforge queue remove <prdId>` prints a success message that includes the PRD id on success.
- `eforge queue remove <prdId>` prints a success message that includes the removed status on success.
- `eforge queue remove <prdId>` exits non-zero with the daemon error message on not-found failure.
- `eforge queue remove <prdId>` exits non-zero with the daemon error message on conflict failure.
- `eforge queue remove <prdId>` exits non-zero with the daemon error message on daemon-unavailable failure.
- Claude/MCP host integrations expose a queue priority action backed by the same daemon route constants.
- Claude/MCP host integrations expose a queue remove action backed by the same daemon route constants.
- Pi host integrations expose a queue priority action backed by the same daemon route constants.
- Pi host integrations expose a queue remove action backed by the same daemon route constants.
- Claude/MCP queue priority actions return typed success payloads consistent with CLI behavior.
- Claude/MCP queue priority actions return typed error payloads consistent with CLI behavior.
- Claude/MCP queue remove actions return typed success payloads consistent with CLI behavior.
- Claude/MCP queue remove actions return typed error payloads consistent with CLI behavior.
- Pi queue priority actions return typed success payloads consistent with CLI behavior.
- Pi queue priority actions return typed error payloads consistent with CLI behavior.
- Pi queue remove actions return typed success payloads consistent with CLI behavior.
- Pi queue remove actions return typed error payloads consistent with CLI behavior.
- Console Now queue rows for pending items provide a set-priority action.
- Console Now queue rows for pending items provide a confirmed remove action.
- Console Now queue rows for waiting items provide a set-priority action.
- Console Now queue rows for waiting items provide a confirmed remove action.
- Each successful Console set-priority action refreshes queue state through the typed client/browser helper path.
- Each successful Console remove action refreshes queue state through the typed client/browser helper path.
- Console does not render remove actions for live running rows.
- Console does not render priority actions for live running rows.
- Queue-control docs describe priority ordering semantics.
- Queue-control docs describe allowed removal statuses.
- Queue-control docs describe running-item refusal.
- Queue-control docs describe dependency-safety refusal.
- Queue-control docs describe CLI commands.
- Queue-control docs describe host tool actions.
- Queue-control docs describe Console actions.
- Engine helper behavior tests exit 0.
- Daemon route contract tests exit 0.
- Daemon route security tests exit 0.
- Client helper tests exit 0.
- Scheduler reconciliation tests exit 0.
- CLI queue priority tests exit 0.
- CLI queue remove tests exit 0.
- MCP queue priority tests exit 0.
- MCP queue remove tests exit 0.
- Pi queue priority tests exit 0.
- Pi queue remove tests exit 0.
- Console queue action tests exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm docs:check` exits 0 after generated API, CLI, and tool references are updated.

## Manual Verification Notes

- Validation commands expected before landing include `pnpm type-check`.
- Validation commands expected before landing include targeted queue tests.
- Validation commands expected before landing include targeted route tests.
- Validation commands expected before landing include targeted client tests.
- Validation commands expected before landing include targeted Console tests.
- `pnpm test` should be run after targeted tests if feasible.
- `pnpm docs:check` should be run if docs/reference artifacts change.
- `pnpm docs:generate` is part of the docs/reference update workflow when route, CLI, or tool references change.
- Console failed/skipped terminal removal may remain outside the first PR if threading it into Needs Attention would expand the UI scope too much.