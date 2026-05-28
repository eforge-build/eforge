---
id: plan-01-build-dependency-core
name: Build Dependency Handoff Core Plumbing
branch: add-first-class-dependency-handoff-for-builds/plan-01-build-dependency-core
agents:
  builder:
    effort: high
    rationale: Touches shared queue semantics, daemon request validation, CLI
      delegation, and engine enqueue behavior with bounded edits in several
      large files.
  reviewer:
    effort: high
    rationale: The route and queue placement semantics need careful review for API
      compatibility and stale-id edge cases.
  tester:
    effort: high
    rationale: Needs targeted coverage for active vs completed-artifact placement
      and CLI/daemon plumbing.
---

# Build Dependency Handoff Core Plumbing

## Architecture Context

Normal build surfaces need a deterministic way to express that a build waits for a specific upstream queue item. Queue and stacking layers already operate on `depends_on`; this plan adds the public request, CLI, daemon, and engine path that converts `afterQueueId` into `depends_on` and chooses whether the new PRD belongs in `.eforge/queue/waiting/` or the queue root.

Constraints:

- Route constants and daemon request shapes are owned by `@eforge-build/client`.
- Queue mutation is filesystem state under `.eforge/queue/`; no DB migration is needed.
- Large files must receive bounded exact edits.
- Scheduler stack inference remains the owner of `stack_parent`; this plan only persists `depends_on`.

## Implementation

### Overview

Add `afterQueueId` to the normal enqueue contract. Implement a shared queue dependency placement helper in `prd-queue.ts`, use it from `EforgeEngine.enqueue()`, validate it in the daemon enqueue route before worker spawn, and pass it through CLI paths (`eforge enqueue --after`, `eforge build --after`, and daemon delegation). Explicit `afterQueueId` overrides dependency-detector output; dependency detection remains active for requests without `afterQueueId`.

### Key Decisions

1. Use `afterQueueId` as the public field name because autonomous playbooks already use that name.
2. Add a placement helper that returns `{ dependsOn: [id], intoWaiting }` for explicit handoffs. Active root/waiting queue items and live running upstreams map to `intoWaiting: true`; completed upstreams with a usable durable artifact map to `intoWaiting: false`; failed, skipped, unknown, or completed-without-artifact upstreams throw.
3. Re-run placement in the enqueue worker even when the daemon route already prevalidates. This handles races where the upstream completes between HTTP request validation and worker execution.
4. Bump `DAEMON_API_VERSION` and update the version test because older daemons would silently ignore `afterQueueId`, violating deterministic handoff semantics.

## Scope

### In Scope

- Add `afterQueueId?: string` to `EnqueueRequest` in `packages/client/src/routes.ts` with documentation.
- Bump `DAEMON_API_VERSION` from 43 to 44 in `packages/client/src/api-version-const.ts` and update `test/daemon-recovery.test.ts`.
- Add `afterQueueId?: string` to `EnqueueOptions` in `packages/engine/src/events.ts`.
- Add a shared dependency placement helper in `packages/engine/src/prd-queue.ts`; keep `validateDependsOnExists()` available and adapt it to share classification code.
- Update `packages/engine/src/eforge.ts` so explicit `afterQueueId` writes `depends_on: [id]`, sets `intoWaiting` from the helper, and skips dependency-detector output.
- Update `packages/monitor/src/server.ts` `POST /api/enqueue` to reject non-string `afterQueueId`, validate/classify string values before spawning a worker, include the invalid id in error text, and pass `--after <id>` to the enqueue worker.
- Update `packages/eforge/src/cli/index.ts` with `eforge enqueue --after <queue-id>` and `eforge build --after <queue-id>`.
- Update `packages/eforge/src/cli/run-or-delegate.ts` so daemon delegation sends `afterQueueId`, in-process enqueue passes it to `engine.enqueue()`, and active-upstream waiting handoff does not try to run a waiting PRD immediately.
- Add/update tests covering queue helper classification, engine explicit dependency precedence, daemon enqueue route validation, CLI flag plumbing, and API version.

### Out of Scope

- Multi-dependency selection for normal builds.
- Manual `stack_parent` selection.
- Scheduler stack inference changes beyond consuming the persisted `depends_on`.
- Pi and Claude tool/skill UX changes; those are handled in plan 03.
- Autonomous playbook route placement; that is handled in plan 02.

## Files

### Create

- None expected.

### Modify

- `packages/client/src/routes.ts` — add `afterQueueId?: string` to `EnqueueRequest`.
- `packages/client/src/api-version-const.ts` — bump to 44 and prepend a v44 note.
- `packages/engine/src/events.ts` — add `afterQueueId?: string` to `EnqueueOptions`.
- `packages/engine/src/prd-queue.ts` — add the placement helper and retain `validateDependsOnExists()` behavior.
- `packages/engine/src/eforge.ts` — thread explicit dependency through enqueue and bypass dependency detection when present.
- `packages/monitor/src/server.ts` — validate and forward `afterQueueId` in `POST /api/enqueue`.
- `packages/eforge/src/cli/index.ts` — add `--after <queue-id>` to `enqueue` and `build` commands.
- `packages/eforge/src/cli/run-or-delegate.ts` — include `afterQueueId` in `BuildRunOpts`, delegated `apiEnqueue` bodies, and foreground engine enqueue.
- `test/queue-piggyback.test.ts` — add placement helper cases for active root, live running, active waiting, completed artifact, failed, skipped, completed-without-artifact, and unknown ids.
- `test/acceptance-criteria-quality.test.ts` or a new focused engine enqueue test file — verify explicit `afterQueueId` persists `depends_on` and dependency-detector output is not used.
- `test/playbook-api.test.ts` — add `POST /api/enqueue` route tests for valid active, valid running, valid completed-artifact, non-string, unknown, failed, and skipped `afterQueueId` values.
- `test/extension-tooling-wiring.test.ts` or a focused CLI test file — verify `eforge enqueue --after q-abc` and `eforge build --after q-abc` pass `afterQueueId` through CLI/delegation paths.
- `test/daemon-recovery.test.ts` — update the expected daemon API version and version-history comment.

## Verification

- [ ] `EnqueueRequest` exposes optional `afterQueueId?: string` and `apiEnqueue({ body: { source, afterQueueId } })` type-checks.
- [ ] The placement helper returns `intoWaiting: true` for root queue items.
- [ ] The placement helper returns `intoWaiting: true` for live running upstreams.
- [ ] The placement helper returns `intoWaiting: true` for waiting queue items.
- [ ] The placement helper returns `intoWaiting: false` for completed upstreams with a usable artifact registry record.
- [ ] The placement helper throws for failed, skipped, completed-without-artifact, and unknown upstream ids.
- [ ] `EforgeEngine.enqueue()` writes `depends_on: ["q-abc"]` when called with `afterQueueId: "q-abc"`.
- [ ] `EforgeEngine.enqueue()` does not invoke or persist dependency-detector output when `afterQueueId` is provided.
- [ ] `POST /api/enqueue` returns 400 for non-string `afterQueueId`.
- [ ] `POST /api/enqueue` returns an error containing the invalid upstream id for unknown, failed, and skipped upstream ids.
- [ ] `POST /api/enqueue` spawns an enqueue worker with `--after <id>` for a valid upstream id.
- [ ] `eforge enqueue --after q-abc <source>` passes `afterQueueId: "q-abc"` into engine enqueue.
- [ ] `eforge build --after q-abc <source>` includes `afterQueueId: "q-abc"` in daemon `apiEnqueue` bodies.
- [ ] `eforge build --after q-abc --foreground <source>` passes `afterQueueId: "q-abc"` into foreground engine enqueue.
