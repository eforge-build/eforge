---
title: Queue Dependency Visibility and Override Controls
created: 2026-06-05
depends_on: ["fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation"]
landing: pr
landing_auto_merge: true
stack_parent: fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation
---

# Queue Dependency Visibility and Override Controls

## Problem / Motivation

Console currently fails to reliably show queued PRD dependencies in the live Now dashboard. REST/eforge status can show a queued PRD blocked by a running upstream, while the connected UI can render the dependent as a loose Pending row with no `blocked by` label or Build stack. This makes queue state misleading and hides why a PRD is not dispatching.

Users also need a deliberate Console action to override a dependency when an engineer judges the dependency low-risk and safe to run before the upstream has landed. Today this requires manually editing queue frontmatter or waiting for the upstream, neither of which provides a clear audit trail or safe UX.

This matters because dependency-aware queue ordering is part of eforge's scheduling safety model. Console must make that model visible, and any bypass must be explicit, validated, and auditable.

Evidence gathered during investigation on 2026-06-05:

- `eforge_status` showed the active build `fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation` with an internal plan dependency: `plan-02-console-resolved-status` depends on `plan-01-engine-monitor-reconciliation`.
- `eforge_queue_list` showed the queued PRD `bound-recovery-analyst-prompts-and-concise-recovery-sidecars` depends on the running PRD `fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation`.
- `.eforge/queue/bound-recovery-analyst-prompts-and-concise-recovery-sidecars.md` contains `depends_on: ["fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation"]`.
- `packages/console-ui/src/components/now/queue-card.tsx` already renders `blocked by ...` for loose queue rows when `NowQueueItem.dependsOn` is present.
- `packages/console-ui/src/components/now/queue-stack-card.tsx` already renders dependency-linked queue stacks when the selector receives related queue items.
- `packages/console-ui/src/lib/selectors/queue-stacks.ts` builds stack components from `QueueItem.dependsOn` relationships among pending, waiting, and running queue items.
- `packages/client/src/event-registry.ts` currently projects `enqueue:complete` and `queue:prd:discovered` into minimal queue items containing only id, title, and status; it does not preserve or merge dependency metadata.
- `packages/client/src/events/queue-events.ts` defines `queue:prd:discovered` with only `prdId` and `title`.
- `packages/client/src/event-registry.ts` has no projector for `daemon:scheduler:dependency-blocked`, even though the event carries `prdId` and `blockedBy`.
- `packages/monitor/src/projections/queue-items.ts` can load `depends_on` from queue frontmatter into `QueueItem.dependsOn` for REST and `stream:hello` snapshots.
- `packages/engine/src/queue/control.ts`, `packages/monitor/src/routes/queue-control.ts`, `packages/client/src/routes/queue-control.ts`, and `packages/client/src/browser-queue-control.ts` already implement the pattern for queue mutation routes: `priority`, `remove`, and browser helpers.
- `docs/roadmap.md` aligns this work with **Console Observability and Control** (`Actionable build control`) and **Integration & Maturity** (`Queue lifecycle controls`).

Classification: **feature / focused**. This is a unified feature because it combines one correctness fix, dependency visibility in live state, with a new user-facing Console queue-control action backed by typed daemon/client APIs.

## Goal

Fix live Console queue state so dependency metadata is visible without a page reload, and add a typed, auditable Console control that removes one dependency from one pending or waiting queued PRD.

## Approach

Treat this as one unified queue-dependency control slice. The override feature is unsafe and confusing unless dependency visibility is correct. The same queue metadata, `dependsOn`, drives both the display fix and the button eligibility.

Prefer live-state projection parity with REST queue projection. `queue:prd:discovered` should carry enough metadata to project the same dependency state as `loadQueueItemsSync`, and projectors should merge fields into existing queue items rather than dropping dependency data when the item already exists. A `daemon:scheduler:dependency-blocked` projector may be added as a defensive live patch, but it should not be the only source of dependency metadata.

The override API removes exactly one dependency from exactly one queued PRD. Use a request body like `{ dependencyId: string; reason?: string }` and a response that includes `id`, `previousStatus`, `currentStatus`, `removedDependency`, `previousDependsOn`, `currentDependsOn`, and whether the PRD was moved from `waiting` to the queue root.

Dependency override is allowed only for pending or waiting queue items. A running PRD has already been claimed, and failed/skipped items are terminal/recovery states. This matches the safety posture in existing priority and removal controls.

Waiting PRDs must become dispatchable when the override removes their last active dependency. If the target is in `waiting/` and the remaining `depends_on` list is empty, move the PRD to the queue root after rewriting frontmatter. If remaining dependencies still exist, keep it in `waiting/`. If remaining dependencies are completed with usable artifacts, it is acceptable to move it to root, but the minimal required behavior is to move only when no dependencies remain.

The action must be auditable. Add a typed daemon event such as `queue:dependency:overridden` or `queue:prd:dependency-overridden` with `prdId`, `title`, `removedDependency`, `previousDependsOn`, `currentDependsOn`, optional `reason`, and timestamp. Persist it as a daemon-scoped event so it appears in recent activity and stream replay.

Console UX must make the risk explicit. Show an `Override dependency` action only when a pending/waiting row has non-empty `dependsOn`/`blockedBy`. The confirmation copy should say that this bypasses queue dependency ordering based on an engineer's judgment and that pre-PR merge/reconciliation must handle overlap. If multiple dependencies exist, require selecting the dependency to remove or render one action per dependency.

Use existing queue-control route patterns. Add route constants and wire types in `@eforge-build/client`, implement monitor route security with `localMutation('Queue control mutations')`, implement engine mutation in `packages/engine/src/queue/control.ts`, call `context.notifyQueueMutation('external')` after success, and refresh Console queue state through existing callback plumbing.

Do not introduce Console-local wire interfaces or literal `/api/...` paths. Project instructions require daemon route constants and wire shapes to be owned by `@eforge-build/client`.

Place dependency override with the existing per-row queue controls for the first slice. Expose `Override dependency` beside the existing Set priority / Remove controls for blocked pending or waiting rows. Keep it as a distinct action, not a hidden global affordance, because it acts on a specific row dependency. If row actions become too crowded as queue controls grow, refactor the row controls into a compact `Actions` menu or split destructive/risky actions into a secondary menu. For multiple dependencies, the confirmation dialog should require choosing the dependency to remove, or render one explicit override action per dependency.

Expected implementation targets:

- `packages/client/src/events/queue-events.ts`: add optional dependency metadata to queue discovery events, or add a new dedicated event variant if needed for dependency projection.
- `packages/client/src/event-registry.ts`: update `enqueue:complete` and `queue:prd:discovered` projectors to merge queue metadata instead of no-oping when an item already exists, and add a projector for `daemon:scheduler:dependency-blocked` when appropriate.
- `packages/client/src/events/snapshots.ts` and `packages/client/src/types.ts`: ensure queue-item and new route/event wire shapes remain the single source of truth.
- `packages/client/src/routes/route-map.ts`: add a route constant for dependency override, likely under the existing queue-control family.
- `packages/client/src/routes/queue-control.ts`: add request/response types for dependency override.
- `packages/client/src/browser-queue-control.ts` and `packages/client/src/api/queue.ts`: add browser and Node helpers that use `API_ROUTES` + `buildPath()`.
- `packages/client/src/api-version-const.ts`: bump `DAEMON_API_VERSION` because first-party Console will rely on the new route/event contract.
- `packages/engine/src/queue/control.ts`: add an override function that validates safe PRD id and dependency id, loads the target from root or waiting queue, refuses running/failed/skipped targets, rewrites `depends_on`, and returns previous/current dependency metadata.
- `packages/monitor/src/routes/queue-control.ts`: add the daemon route handler, local mutation security, JSON body validation, queue-control error mapping, `context.notifyQueueMutation('external')`, and audit-event emission.
- `packages/console-ui/src/components/now/queue-card.tsx`: show the override control for loose blocked pending/waiting rows.
- `packages/console-ui/src/components/now/queue-stack-card.tsx`: show the override control for blocked stack rows.
- `packages/console-ui/src/components/now/queue-row-actions.tsx`: either extend the shared queue row action component or add a sibling dependency action component with confirmation UX.
- `packages/console-ui/src/hooks/use-daemon-events.ts` or `packages/console-ui/src/app.tsx`: wire the Console callback through existing refresh/mutation plumbing.
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx`, `packages/console-ui/src/components/now/__tests__/queue-stack-card.test.tsx`, and selector tests under `packages/console-ui/src/lib/selectors`: add rendering and projection regressions.
- `packages/monitor/src/__tests__/routes-queue-control.test.ts`: add route-level validation and mutation tests for dependency override.
- `packages/client/src/__tests__/events-schemas*.test.ts` and queue-control client tests: cover new event/route contracts.

Evidence for these targets:

- Queue dependency rendering already exists in `queue-card.tsx` and `queue-stack-card.tsx`, so the visibility defect is in live state/projection rather than the presentational components.
- Queue mutation route patterns already exist in `queue-control.ts`, `queue-control` route types, and browser helpers.
- Project instructions require route constants and daemon wire shapes to live in `@eforge-build/client` and forbid local `/api/...` literals or duplicated wire interfaces.
- The engine helper must perform the file/frontmatter mutation because queue files are engine-owned operational state.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---|---|---|---|
| The missing dependency display is caused by live event projection losing `dependsOn`, not by the Queue card renderer. | Read `queue-card.tsx`, `queue-stack-card.tsx`, `queue-stacks.ts`, `event-registry.ts`, and `queue-events.ts`; renderers already consume `dependsOn`, while live projectors create minimal queue items. | high | low | Add a focused projector test that replays `queue:prd:discovered`/`daemon:scheduler:dependency-blocked` and asserts `selectNowQueueStacks` output. | If wrong, work may need additional Console state or selector fixes. |
| Existing REST and `stream:hello` queue snapshots can carry correct dependency metadata. | Read `packages/monitor/src/projections/queue-items.ts`; it maps `depends_on` to `QueueItem.dependsOn` and filters to live ids. Current `eforge_queue_list` returned `dependsOn` for the queued item. | high | low | Add or update stream/REST parity tests with a dependency-linked running and pending pair. | If wrong, monitor queue projection also needs correction before Console can rely on snapshots. |
| A waiting PRD with no remaining dependencies should be moved to the queue root by the override mutation. | Read `unblockWaiting` in `packages/engine/src/prd-queue.ts`; waiting items are normally moved to root only when dependencies are satisfied. A dependency override that removes the last dependency should make the item dispatchable. | high | medium | Implement route tests that assert file movement from `waiting/` to root after removing the last dependency. | If wrong, override would appear successful but the PRD would remain undispatchable. |
| It is acceptable to scope override to one dependency at a time. | User requested an engineer override action; no requirement for bulk override was stated. Existing queue controls are item-scoped. | medium | low | Confirm UX in implementation by rendering one action per dependency or a chooser in the dialog. | If wrong, UI may require a multi-select dialog and broader route semantics. |
| A new daemon API route and typed event require a daemon API version bump. | Project instructions and `api-version-const.ts` history show first-party Console route/event dependencies trigger version bumps. | high | low | Update `DAEMON_API_VERSION` and run type/API tests. | If omitted, stale daemon/client combinations may fail silently or route 404. |
| No Pi/MCP tool change is required for this session. | User specifically asked for Console UI button/action. Existing queue priority/remove controls are Console-facing and not necessarily mirrored as Pi tools beyond route helpers. | medium | low | Re-check AGENTS.md consumer-facing sync guidance if adding CLI/MCP commands becomes part of scope. | If wrong, plugin/Pi integration work may be required before completion. |

Recommended profile: **Excursion**.

Rationale: the work is cross-package but cohesive. A single planner can enumerate the route contract, engine queue mutation, monitor handler, client helpers, event projection, and Console UI/tests without needing delegated module planning. It is not an Errand because it changes daemon/client wire contracts and queue mutation semantics. It is not Expedition because the work has one clear dependency chain and does not require independent architecture/module planning.

## Scope

In scope:

- Fix live Console queue state so dependency metadata is visible without a page reload when queue items are discovered or dependency-blocked events arrive.
- Add a typed queue dependency override control that removes one dependency from one pending or waiting queued PRD.
- Expose the override through the shared client route contract and browser helper instead of inlining route literals in Console.
- Add a Console action for blocked queue rows and dependency-stack rows, guarded by an explicit confirmation dialog that states the engineering risk.
- Emit a durable daemon event for dependency overrides so the action appears in activity/history and can be audited.
- Notify queue mutation / scheduler after a successful override so an unblocked PRD can dispatch when capacity is available.
- Refresh or project queue state after override so the Console row immediately reflects the removed dependency.

Out of scope:

- Automatically deciding whether a dependency is safe to override.
- Overriding dependencies for running, failed, or skipped PRDs.
- Removing all dependencies as a bulk action unless the selected row only has one dependency.
- Changing plan-level dependencies inside an already-running build's orchestration.
- Adding Pi/MCP queue override tools; this session targets Console control backed by daemon/client APIs.
- Implementing cascade-aware queue removal or queue hold/pause controls.

## Acceptance Criteria

- A live `queue:prd:discovered` event for a PRD whose frontmatter contains `depends_on: ["upstream"]` causes Console project state to contain that PRD with `dependsOn` including `upstream` without requiring a page reload.
- A live `daemon:scheduler:dependency-blocked` event for `prdId: "child"` and `blockedBy: ["parent"]` updates Console project state so the child queue item exposes `dependsOn` including `parent` when the child item is present.
- The Now Queue card renders a blocked pending or waiting loose row with text containing `blocked by` and the dependency display label.
- The Now Queue card renders a dependency-linked running-plus-blocked queue pair as a Build stack instead of duplicating the blocked item in Other queued items.
- The client route map exports a dependency-override route constant and all dependency-override client helpers build paths through `API_ROUTES` and `buildPath()`.
- The daemon dependency-override route rejects an invalid PRD id or dependency id with a 400 response.
- The daemon dependency-override route rejects a running, failed, or skipped target PRD with a 409 response.
- The daemon dependency-override route rejects a pending or waiting target PRD when the requested dependency is not present in its `depends_on` frontmatter with a 409 response.
- A successful dependency override rewrites the target PRD frontmatter so the removed dependency no longer appears in `depends_on`.
- A successful dependency override that removes the only dependency from a PRD in `waiting/` moves that PRD to the queue root.
- A successful dependency override calls the queue mutation notifier so the scheduler can dispatch the unblocked PRD when capacity is available.
- A successful dependency override persists a typed daemon-scoped audit event containing the target PRD id, removed dependency id, previous dependency list, and current dependency list.
- Console renders an override action for pending or waiting queue rows that have at least one dependency.
- Console does not render an override action for queue rows whose status is running, failed, skipped, or dependency-free.
- Console requires an explicit confirmation before calling the dependency-override helper.
- Console refreshes queue state after a successful dependency override.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0 when route or API reference docs are affected.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

N/A