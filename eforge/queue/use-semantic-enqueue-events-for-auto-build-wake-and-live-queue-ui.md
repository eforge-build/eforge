---
title: Use Semantic Enqueue Events for Auto-Build Wake and Live Queue UI
created: 2026-05-18
profile: gpt-claude-combo
---

# Use Semantic Enqueue Events for Auto-Build Wake and Live Queue UI

## Problem / Motivation

Auto-build and live queue updates can fail after daemon-backed enqueue because the daemon currently treats worker process exit as the signal for semantic enqueue completion.

Evidence reviewed:

- User-observed failure: after `/eforge:build` enqueued `runtime-reviewer-perspective-extension-point`, auto-build did not start and the monitor queue did not update until browser refresh.
- Live daemon snapshot showed auto-build desired/enabled/running, scheduler alive, queue depth `1`, running builds `0`, capacity `0/2 running`, but `Last queue wake-up` was `none since startup`. This indicates the FSM/scheduler was healthy but did not receive the queue-mutation input.
- `eforge_status` reported no active sessions while `eforge_queue_list` showed the pending PRD.
- Manual `POST /api/scheduler/kick` immediately emitted `queue:prd:discovered`, `daemon:scheduler:dequeued`, `queue:prd:start`, and a build `phase:start`, confirming the queue item was valid and the scheduler could build it once woken.
- The enqueue worker log `.eforge/worker-daemon-1779137529108-8ebe9ac941fa.log` contains `Session ended: completed`, but `ps/lsof` showed the child process still alive with stdout/stderr open to that log. This confirms the daemon's child `exit` callback may lag or never run even after semantic enqueue completion.
- `packages/monitor/src/server.ts` currently wires `POST /api/enqueue` as `spawnWorker('enqueue', args, () => notifyQueueMutation(..., 'enqueue'))`. Therefore auto-build wake is tied to process exit, not to `enqueue:complete`.
- `packages/monitor/src/__tests__/auto-build-route.test.ts` explicitly asserts this brittle behavior: no scheduler mutation before the worker-exit callback, mutation only after invoking the callback.
- `packages/monitor/src/recorder.ts` already observes semantic lifecycle events. On `enqueue:complete`, it updates run plan set/status and yields a persisted `daemon:run:upsert`. This is the natural point to trigger enqueue-complete side effects.
- `packages/client/src/event-registry.ts` intentionally removed `enqueue:*` projectors from `DaemonState.runs` in favor of `daemon:run:upsert`, but `enqueue:complete` also has no queue projector.
- Live queue insertion currently depends on later scheduler discovery (`queue:prd:discovered`), while refresh/stream hello uses filesystem snapshot loading from `packages/monitor/src/server.ts`.
- Roadmap alignment: `docs/roadmap.md` lists daemon/MCP direction as making the daemon the single orchestration authority. Moving enqueue wake and queue projection to semantic daemon events supports that direction.
- Recent git history includes multiple fixes around auto-build FSM/card reporting and durable daemon-scoped event persistence. Evidence-backed conclusion: those fixes improved health reporting and event durability but did not remove the process-lifecycle coupling that caused this incident.

Classification: **bugfix / deep**. It fixes incorrect recurring behavior, but the root cause is an orchestration boundary/design issue, so the plan should prefer durable semantic event handling over another local wake workaround.

Affected users:

- Pi/Claude integration users invoking eforge build/enqueue through daemon-backed tools.
- Monitor UI users relying on live queue/run state.
- Maintainers debugging repeated auto-build failures despite a healthy scheduler FSM.

Why it matters now:

- This has recurred across several prior fixes. Recent FSM work improved watcher/scheduler health reporting, but this incident shows the scheduler never received the queue-mutation input even though the FSM was healthy.
- The daemon is intended to be the single orchestration authority. A domain event (`enqueue:complete`) exists, but the current wake path depends on subprocess exit, which is not the same lifecycle and can lag or fail independently.

Confirmed reproduction:

1. Start with persistent daemon auto-build enabled and watcher running.
2. Run `/eforge:build` to enqueue a plan/session source.
3. Observe the enqueue session completes successfully:
   - Worker log shows `Enqueued: Runtime Reviewer Perspective Extension Point -> .../eforge/queue/runtime-reviewer-perspective-extension-point.md`.
   - Worker log shows `Session ended: completed`.
   - SQLite events include `enqueue:complete` and `session:end` for the enqueue run.
4. Observe actual behavior:
   - `eforge_queue_list` shows the PRD remains `pending`.
   - `eforge_status` reports no active build sessions.
   - Daemon activity card shows auto-build desired/enabled/running and scheduler alive, but `Last queue wake-up` is `none since startup`.
   - Monitor UI does not show the newly enqueued item until refresh/reconnect.
5. Confirm workaround:
   - Manually `POST /api/scheduler/kick`.
   - Scheduler immediately emits `queue:prd:discovered`, `daemon:scheduler:dequeued`, `queue:prd:start`, and build `phase:start`.
   - This proves the queue file was valid and the scheduler could act once woken.

Expected behavior:

- As soon as `enqueue:complete` is recorded, the daemon should:
  - project the new queue item into live daemon state as pending if not already present;
  - notify the auto-build controller of an `enqueue` queue mutation;
  - have the scheduler discover/dequeue the PRD when capacity/dependencies allow.

Actual behavior:

- The daemon currently waits for the enqueue worker process to exit before calling `notifyQueueMutation('enqueue')`.
- In this incident, the worker process remained alive after semantic completion, so no mutation was delivered.

Known workaround:

- Manual scheduler kick starts the build, but this is not acceptable as product behavior.

Confirmed primary root cause: **the daemon uses worker process exit as the signal for semantic enqueue completion.**

Evidence:

- `packages/monitor/src/server.ts` handles `POST /api/enqueue` by spawning an `enqueue` worker and passing an `onExit` callback:
  - `spawnWorker('enqueue', args, () => notifyQueueMutation(options.daemonState, 'enqueue'))`
- `packages/monitor/src/__tests__/auto-build-route.test.ts` encodes this behavior by asserting no mutation before the worker-exit callback and a mutation only after it.
- In the observed incident, semantic enqueue completed (`enqueue:complete`, `session:end`, queue file present), but the worker process was still alive. Therefore the `onExit` wake callback had not fired.
- Manual scheduler kick immediately started processing, which rules out invalid queue content, disabled auto-build, scheduler capacity, or dependency blocking as the primary cause.

Confirmed secondary/root-adjacent issue: **live queue UI insertion is coupled to scheduler discovery rather than enqueue completion.**

Evidence:

- `packages/client/src/event-registry.ts` has no `project` function for `enqueue:complete`; comments only discuss not using `enqueue:*` for `DaemonState.runs` because `daemon:run:upsert` is authoritative for runs.
- Live queue projection currently happens on `queue:prd:discovered` and other queue lifecycle events. If the scheduler is never woken, `queue:prd:discovered` is never emitted, so the UI queue remains stale.
- Refresh/reconnect works because `stream:hello`/`GET /api/queue` load queue files from disk via `loadQueueItemsSync`/`loadQueueItems`, bypassing the missed live projection.

What is not the root cause:

- The scheduler FSM itself is not shown to be broken in this incident. It reported healthy desired/running/scheduler-alive state and responded to `/api/scheduler/kick`.
- Durable daemon event persistence is not the missing piece for this incident; `enqueue:complete` and `daemon:run:upsert` were persisted. The problem is that the semantic event was not used to drive scheduler wake or queue projection.

Long-term root-cause framing:

- The daemon currently mixes process lifecycle and domain lifecycle.
- Process exit is an implementation detail and may be delayed by open handles, stuck SDK/background resources, stdout/stderr behavior, or signal handling.
- Domain orchestration should consume domain events (`enqueue:complete`, `enqueue:failed`, `queue:*`, `daemon:*`).
- The right boundary is: worker processes produce events; recorder/daemon event pipeline persists and projects them; auto-build controller receives queue-mutation inputs from semantic queue/enqueue events; worker exit performs cleanup/reaping only.

## Goal

Successful enqueue completion should durably and immediately update daemon live state and wake auto-build based on semantic enqueue lifecycle, not on worker process exit.

Browser refresh should not be needed to see a newly enqueued pending item, and the fix should be maintainable and consistent with the existing event/projector architecture rather than another ad-hoc polling or process-exit workaround.

## Approach

Early design conclusion:

- Make enqueue completion a first-class domain event consumed by daemon orchestration/UI projection.
- Worker exit should remain cleanup-only.
- The scheduler FSM should continue to own watcher/scheduler runtime state, but it must receive inputs from domain events rather than subprocess termination.

Key design decisions:

1. **Use semantic enqueue lifecycle as the source of truth for enqueue side effects.**
   - Decision: `enqueue:complete` should trigger scheduler wake and live queue insertion. Worker `exit` must not be required for either behavior.
   - Rationale: `enqueue:complete` means the queue file was written and committed; that is the domain condition the scheduler needs. Worker exit is an implementation detail and can be delayed by open handles.

2. **Keep the auto-build FSM focused on runtime state, not event discovery.**
   - Decision: The FSM remains responsible for desired/mode/watcher/scheduler state and for handling `notifyQueueMutation`. The fix supplies the missing input at the correct semantic time.
   - Rationale: This avoids overloading the FSM with queue-domain detection and explains why FSM work alone could not fix the problem.

3. **Add idempotent queue projection for `enqueue:complete`.**
   - Decision: `enqueue:complete` should add `{ id, title, status: 'pending' }` to `DaemonState.queue` only if absent. Later scheduler events update/remove it.
   - Rationale: The UI should reflect a successful enqueue immediately. Missing optional snapshot fields (`created`, `priority`, `dependsOn`) can be filled by reconnect/snapshot or future richer event metadata, but live correctness of presence/status must not wait for scheduler discovery.

4. **Preserve `daemon:run:upsert` as the only run-state projector.**
   - Decision: Do not reintroduce `enqueue:*` run projection. The new `enqueue:complete` projector only touches queue state.
   - Rationale: Recent v25 design intentionally centralized run shape in `daemon:run:upsert`. The fix should not regress that architecture.

5. **Centralize daemon-owned event side effects.**
   - Decision: Implement a narrow daemon-side semantic-event reaction path for persisted worker events. It should dedupe by event id/type and call `autoBuildController.notifyQueueMutation('enqueue')` on `enqueue:complete`.
   - Rationale: Worker subprocesses already emit events; the daemon already polls/publishes persisted events. A daemon-owned event reaction keeps engine pure and avoids relying on subprocess exit.

6. **Make duplicate signals harmless.**
   - Decision: If both `enqueue:complete` and later `queue:prd:discovered` are seen, state remains correct. If an old worker exit callback remains temporarily during migration, duplicate `notifyQueueMutation('enqueue')` should be safe but the final design should remove process-exit dependency.
   - Rationale: Event streams are eventually consistent and reconnect/replay can happen; projectors and scheduler kicks should be idempotent.

7. **Treat playbook/recovery enqueue paths consistently but avoid unnecessary rewrites.**
   - Decision: Existing in-process `playbook-enqueue` and `apply-recovery` route mutations may remain direct if they already mutate the queue synchronously and call `notifyQueueMutation`. If they emit or should emit queue events, their live UI projection should also be covered by queue/enqueue projectors.
   - Rationale: The specific bug is subprocess-backed daemon enqueue. The architectural rule is semantic queue mutation, not necessarily forcing all paths through `enqueue:complete` if their domain event differs.

Expected code changes:

1. `packages/monitor/src/server.ts`
   - Stop relying on `spawnWorker(..., onExit)` to call `notifyQueueMutation('enqueue')` for daemon enqueue.
   - Add a clean mechanism for daemon event recording to notify semantic side effects when an `enqueue:complete` event is observed.
   - Keep process exit handling for worker map cleanup/cancellation only.

2. `packages/monitor/src/server-main.ts` / worker wrapping path
   - The persistent daemon wraps watcher events with `withRecording(...)` in-process; worker subprocesses are monitored indirectly through DB event polling.
   - The implementation needs a daemon-owned place to observe persisted semantic events from all workers and trigger side effects exactly once.
   - Candidate long-term implementation: centralize daemon-owned reaction to persisted daemon events in the daemon process, for example in the daemon-events poll loop or a small event-side-effects service, rather than placing side effects inside the engine or CLI worker.

3. `packages/monitor/src/recorder.ts`
   - It already recognizes `enqueue:complete` to update run status and emit `daemon:run:upsert`.
   - It may need an optional callback/hook for semantic lifecycle side effects, or the daemon may consume the persisted event separately.
   - Avoid making recorder itself a broad orchestration sink unless the callback is narrow and explicitly daemon-owned.

4. `packages/client/src/event-registry.ts`
   - Add a `project` function for `enqueue:complete` to insert a pending `QueueItem` if not already present.
   - Preserve the existing rule that `enqueue:*` does not project run state; `daemon:run:upsert` remains authoritative for runs.
   - Ensure idempotency with later `queue:prd:discovered` and `queue:prd:start` events.

5. `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` and parity tests
   - Add/adjust tests proving live `enqueue:complete` projection matches the minimum queue snapshot shape and dedupes with `queue:prd:discovered`.

6. `packages/monitor/src/__tests__/auto-build-route.test.ts`
   - Replace the current assertion that mutation happens only on worker exit with a regression test that semantic enqueue completion wakes auto-build even if the worker process does not exit.
   - Depending on implementation, this may use real DB/event insertion plus daemon poll/side-effect service rather than an onExit callback.

7. `packages/client/src/api-version.ts`
   - Bump `DAEMON_API_VERSION` only if the wire contract changes.
   - If this is purely server/client projection behavior using existing `enqueue:complete` fields, no API bump may be necessary.

Material assumptions to validate:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `enqueue:complete` is emitted only after the queue file exists and is safe for scheduler discovery. | `packages/engine/src/eforge.ts` writes the queue file via `enqueuePrd`, then attempts `commitEnqueuedPrd`, then yields `enqueue:complete`. Manual scheduler kick after observed `enqueue:complete` discovered/dequeued the file. | High | Low | Add regression test using real temp queue and event reaction; optionally assert file exists before reaction in unit test. | If wrong, scheduler wake could race before queue file exists. |
| Process exit can lag semantic completion and is therefore an invalid required signal. | Current incident: worker log and DB showed completion while `ps/lsof` showed the process still alive. Existing route test proves wake currently waits for exit. | High | Low | Add test simulating worker never invoking exit callback while persisted `enqueue:complete` appears. | If wrong, fixing semantic wake still works, but root-cause narrative would be incomplete. |
| A daemon-side persisted-event reactor can observe `enqueue:complete` independent of browser subscribers. | `db.getDaemonEventsAfter()` already returns persisted daemon event types regardless of `run_id`, and SSE uses it. A separate cursor/timer can use the same DB method without subscriber dependency. | High | Low | Implement reactor in `server.ts`/daemon state path and test with zero subscribers. | If wrong, implementation may accidentally remain UI-coupled. |
| `enqueue:complete` has enough data to project a useful pending queue item. | Event schema includes `id`, `title`, `filePath`, `planSet`; `QueueItem` minimally requires `id`, `title`, `status`. Optional snapshot fields are not required for presence/status. | High | Low | Add event-registry projector test comparing minimal live item shape to expected `QueueItem`. | If wrong, UI may need richer event schema/API version bump. |
| Duplicate wake/discovery is safe. | `AutoBuildSupervisor.notifyQueueMutation` records last mutation and injects scheduler event; queue discovery/projectors already dedupe `queue:prd:discovered` by id. Need specific enqueue-complete dedupe test. | Medium | Low | Add tests for duplicate `enqueue:complete`, then `queue:prd:discovered`, then `queue:prd:start`. | If wrong, UI could duplicate queue rows or scheduler could perform redundant scans. |
| Existing watcher startup handles pending queue items on daemon startup, so event reactor can start from current max event id and not replay old enqueue completions. | `watchQueue` emits `queue:start` and scans queue; observed manual kick worked. This is inferred from scheduler design and tests but not revalidated for startup here. | Medium | Low | Check existing watchQueue startup tests or add one: daemon starts with pending PRD and autoBuild enabled -> discovered/dequeued. | If wrong, daemon restart after missed wake might still leave items pending. |
| Playbook enqueue and recovery apply are not affected by the process-exit bug because they run in-process route code and already call `notifyQueueMutation`. | `packages/monitor/src/server.ts` playbook enqueue and apply recovery routes call `notifyQueueMutation` directly after queue mutation. | High | Low | Add/confirm tests for these route paths and live queue projection behavior. | If wrong, similar stale UI/wake issues may remain in alternate enqueue paths. |
| No DAEMON_API_VERSION bump is needed if only behavior/projectors change and no wire fields/routes change. | Existing `enqueue:complete` fields are sufficient for minimal queue projection; scheduler wake uses existing route/controller/event mechanisms. | Medium | Low | During implementation, if schema fields are added, bump version and update docs/tests. | If wrong, daemon/UI version compatibility could be ambiguous. |

Additional assumptions and validation:

- `enqueue:complete` carries enough fields to live-project a pending queue item (`id`, `title`; optional snapshot fields like `created`, `priority`, and `dependsOn` may be absent until scheduler discovery or refresh).
- Hooking side effects in or adjacent to the recorder can be done without violating the project principle that engine emits and consumers render, and without making the recorder an uncontrolled orchestration sink.
- Playbook enqueue and recovery paths should remain consistent: they already call `notifyQueueMutation` directly in HTTP route code and may need only queue projection parity, not the new worker-event hook.
- No low-confidence/high-impact assumptions remain.
- The main implementation choice to validate is where to host the daemon-owned event reaction loop so it is subscriber-independent and does not make the recorder or UI poll loop responsible for orchestration.

Risks:

- **Subscriber-coupled side effects:** If implementation hooks semantic wake into the existing SSE subscriber loop only, auto-build would still fail when no browser is open. The event reaction path must run independent of connected subscribers.
- **Historical replay causing duplicate wakes:** A daemon-side event reactor should initialize its cursor carefully, for example to current max daemon event id at startup, and process only new events, or otherwise dedupe by event id. Existing pending queue on daemon startup should be handled by watcher startup scanning, not by replaying arbitrary old enqueue completions.
- **Recorder responsibility creep:** `withRecording` is already a central place for DB mutation and `daemon:run:upsert`. Adding side effects directly there could make it harder to reason about. Prefer a narrow callback or separate daemon event reactor with explicit ownership and tests.
- **Queue projection parity:** `enqueue:complete` lacks optional queue metadata (`priority`, `created`, `dependsOn`) that filesystem snapshots include. The live projection should be idempotent/minimal and documented in tests; later discovery/snapshot can enrich if needed. If exact parity is required, the event schema would need additional fields and likely an API version bump.
- **Duplicate queue events:** `enqueue:complete` and `queue:prd:discovered` may both add the same item. Projectors must dedupe by id and preserve the most useful status.
- **Playbook/recovery drift:** Existing non-worker queue mutation routes may have different event shapes. The plan must avoid fixing only `/api/enqueue` if other enqueue-like paths still leave UI stale.
- **Current active build:** A manual kick already started the pending build during investigation. Implementation/tests should use isolated temp directories and not depend on current runtime state.

Recommended profile: **Excursion**.

Rationale: This is a cross-cutting but cohesive bugfix. It spans daemon event handling, auto-build wake wiring, client event projection, monitor UI reducer tests, and route/server tests. A single planner can describe the required sequence and boundaries without delegated module planning. Errand is too small because the failure is architectural and recurring; Expedition is unnecessary because the work does not require independent subsystem planners.

## Scope

In scope:

- Use `enqueue:complete` as the semantic trigger for scheduler wake and live queue insertion.
- Ensure the daemon event reaction path is daemon-owned, centralized, narrow, documented, and deduped by event id or equivalent cursor.
- Ensure the daemon event reaction path works independent of connected browser/SSE subscribers.
- Keep worker process exit for cleanup/reaping/cancellation bookkeeping only.
- Add idempotent `enqueue:complete` queue projection in `packages/client/src/event-registry.ts`.
- Preserve `daemon:run:upsert` as authoritative for run state.
- Update tests for monitor server/routes, client event registry/schema, and monitor-ui daemon reducer.
- Validate playbook enqueue and recovery path consistency.
- Bump `DAEMON_API_VERSION` only if the wire contract changes.

Out of scope:

- Major changes to engine queue scheduling algorithms; manual scheduler kick proved existing scheduler behavior works when woken.
- Changes to `packages/engine/src/eforge.ts` enqueue event shape unless optional queue metadata is intentionally added.
- User-facing behavior changes in `packages/pi-eforge/` and `eforge-plugin/`, unless docs/help text mentions the guarantee.
- Adding polling in the UI as the primary fix.
- Making the scheduler depend on filesystem watch events alone.
- Broadening the enqueue worker's responsibilities beyond emitting semantic events unless a narrowly scoped daemon API call is explicitly chosen and justified.

Architectural constraints:

- The engine remains an event emitter and does not import daemon/HTTP/server concerns.
- The auto-build FSM remains responsible for runtime state transitions; the change supplies a correct semantic queue-mutation input rather than embedding queue file discovery in the FSM.
- `daemon:run:upsert` remains authoritative for daemon run state. `enqueue:complete` projection, if added, affects queue state only.
- Daemon event side effects are centralized, narrow, documented, and deduped by event id or equivalent cursor.

## Acceptance Criteria

Functional behavior:

- After daemon-backed `/eforge:build` or `POST /api/enqueue` produces an `enqueue:complete` event, auto-build receives a queue-mutation wake without requiring the enqueue worker process to exit.
- If auto-build is enabled/running and scheduler is alive, the wake injects `queue:mutation` into the scheduler and the pending PRD is discovered/dequeued according to existing capacity/dependency rules.
- If auto-build is desired enabled but watcher/scheduler is inert, the existing FSM repair path still applies when semantic enqueue wake is delivered.
- Worker process exit is no longer the only path, and ideally no longer any path, for enqueue scheduler wake. Exit remains for process cleanup/cancellation bookkeeping.
- Monitor UI daemon queue state updates live on `enqueue:complete` by showing the new PRD as pending without requiring browser refresh or scheduler discovery first.
- Later `queue:prd:discovered`, `queue:prd:start`, `queue:prd:complete`, `queue:prd:skip`, and `queue:complete` events remain idempotent and produce the same final queue state as a fresh snapshot/reconnect.
- The solution works with no browser/SSE subscriber connected; UI subscriptions are consumers, not prerequisites for daemon side effects.

Tests:

- Replace/update the existing `POST /api/enqueue` route test that expects mutation only after worker exit.
- New regression test proves an `enqueue:complete` event wakes auto-build even when the worker does not exit.
- Add a test that the semantic event reaction path is subscriber-independent.
- Add daemon reducer/event-registry tests showing `enqueue:complete` inserts a pending `QueueItem`, dedupes if the item already exists, and does not mutate run state.
- Add a parity/idempotency test for `enqueue:complete` followed by `queue:prd:discovered` and `queue:prd:start`.
- Existing auto-build supervisor tests still pass; add/adjust tests only if supervisor API semantics change.
- Run at least targeted tests for monitor server/routes, client event registry/schema, and monitor-ui daemon reducer.
- Run `pnpm type-check` if feasible.
