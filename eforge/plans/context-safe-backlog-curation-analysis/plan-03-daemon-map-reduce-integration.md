---
id: plan-03-daemon-map-reduce-integration
name: Daemon Map/Reduce Orchestration and Compatibility
branch: context-safe-backlog-curation-analysis/plan-03-daemon-map-reduce-integration
agents:
  builder:
    effort: high
    rationale: Coordinates monitor background task orchestration, dynamic provider
      hooks, progress telemetry, cache usage, reducer validation, and
      compatibility tests across packages.
  reviewer:
    effort: high
    rationale: Daemon task branching and extension-provider boundaries need review
      for ordinary planning task isolation and API compatibility.
---

# Daemon Map/Reduce Orchestration and Compatibility

## Architecture Context

`packages/monitor/src/routes/extensions/agent-task-service.ts` currently resolves an optional deferred source provider into `{ sourceText }`, then always calls `runEforgePlanPlanningDraftTask`. For `analyze-all-backlog`, that sends the combined curation source into one planner prompt. After plans 01 and 02, the source provider can return a structured map/reduce bundle and the engine can run isolated item audits plus a reducer. This plan wires those pieces into the daemon-owned task lifecycle while keeping generic planning tasks on the existing path.

## Implementation

### Overview

Branch only eforge-plan backlog-curation source-provider tasks into a monitor-owned map/reduce runner. The runner prepares progress metadata, validates packets, reuses cached findings, audits cache misses in isolated agent calls, degrades item failures into bounded outcomes, builds a capped reducer input, validates the reducer result, performs at most one bounded repair, and completes the task with the existing planning-result shape.

### Key Decisions

1. Branch on the structured provider result kind, not on generic requested output sections alone. Ordinary session planning, recommendation refresh, plan revision, and direct daemon route tasks continue through `runEforgePlanPlanningDraftTask`.
2. Keep cache storage and curation-specific validation hooks owned by the eforge-plan provider module. The monitor resolves optional hooks from the already-imported provider module and calls them through a narrow duck-typed interface.
3. Emit progress through existing `progressMessage` and `sectionProgress` metadata plus existing `extension:agent-task:progress` events. No new public event variant is added.
4. Complete the daemon task with the same `EforgePlanPlanningDraftResult` schema that preview/apply already consumes.
5. Validate reducer output with schema checks and an eforge-plan apply-preview validation hook before task completion when the hook is present. Validation errors are capped before repair.

## Scope

### In Scope

- Preserve structured source-provider output internally in the monitor.
- Map/reduce runner for backlog-curation tasks only.
- Cache hit/miss handling and per-item isolated audits.
- Per-item degraded outcomes for oversized packets, item-agent failures, invalid findings, and cancellation support.
- Reducer input construction with explicit byte cap and no raw evidence.
- Progress messages for source preparation, packet counts, cache counts, item audit progress, reduction, and validation.
- One bounded reducer repair attempt, then bounded needs-input degradation.
- Compatibility tests for preview/apply validation against reducer output.
- Context-length regression fixture approximating the reported large metadata case.

### Out of Scope

- New daemon HTTP routes.
- New public event variants.
- Workstation UI changes beyond existing progress message rendering.
- Model routing specialization for item audits or reducer.
- Changes to backlog storage or session-plan workflows.

## Files

### Create

- `packages/monitor/src/routes/extensions/backlog-curation-map-reduce-runner.ts` — monitor orchestration for cache lookup, item audit scheduling, degraded outcomes, reducer input capping, reducer invocation, validation repair, and progress callbacks.
- `packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts` — daemon/service tests with stub harnesses for isolated item audits, cache hits, failures, cancellation, and progress events.
- `test/extension-backlog-curation-map-reduce-integration.test.ts` — integration-level regression tests that exercise source-provider output, monitor orchestration, and reducer prompt bounds with large curation metadata fixtures.

### Modify

- `packages/monitor/src/routes/extensions/agent-task-service.ts` — return a richer deferred source resolution internally, branch structured backlog-curation tasks to the new runner, keep the generic planning task path unchanged, and keep stored task records projected through `@eforge-build/client` schemas.
- `packages/monitor/src/routes/extensions/agent-task-events.ts` — use existing metadata sanitization for new progress messages; avoid schema additions unless a structured field is introduced during implementation.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts` — export provider hooks used by the monitor runner for cache read/write and reducer result validation.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — expose a validation helper that reuses existing preview/apply checks without weakening precondition, status, dependency, recommendation, or evidence validation.
- `eforge/extensions/eforge-plan/backlog-curation-actions.ts` — keep the `analyze-all-backlog` action id, task start request shape, and curation-source-and-concurrency-based active task reuse; update tests only for structured source-provider metadata when needed.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — keep retry/redraft backlog-curation tasks on the same structured source-provider path and pass redraft context through packet/global summary construction.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — add reducer-output compatibility cases while preserving existing invalid precondition/status/evidence rejection cases.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts` — add assertions that analyze-all source preparation exposes packet counts and structured source metadata without changing user-facing action output.
- `packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts` and `packages/client/src/__tests__/extension-agent-tasks.test.ts` — update only if implementation adds a structured metadata field; otherwise leave client task metadata schemas unchanged.

## Implementation Details

- Extend deferred source-provider handling to return `{ sourceText, structuredSource, providerHooks }` internally. Only `sourceText` is copied into generic planner input.
- Detect curation map/reduce by validating `structuredSource` against the shared map/reduce source bundle schema and confirming the provider owner is `eforge-plan` or the bundle kind is the eforge-plan curation map/reduce kind.
- The runner resolves planner runtime once, then uses the same harness/config for item audits and reducer. Runtime identity includes harness kind, model id, optional provider, tier, toolbelt, prompt version, and max-turn/runtime parameters needed by the cache key.
- For each packet:
  - Validate schema and byte/count caps.
  - Produce an oversized-packet degraded outcome when validation fails due to packet size.
  - Read cache when all cache-key dimensions are present.
  - Skip the agent call on cache hit and record a cache-hit outcome.
  - Run an isolated item audit agent on cache miss.
  - Validate item finding schema, bytes, and counts before writing cache.
  - Convert item-agent errors or invalid findings into bounded skipped/needs-input findings.
- The reducer input builder accepts global context, cross-item summaries, dependency summaries, recommendation summaries, and compact outcomes. It rejects or compacts inputs above the reducer cap and never inserts raw packets, full bodies, raw `gitDelta`, or raw `fullImplementationAudit`.
- Progress messages include capped strings such as `Preparing curation source`, `Built 12 item packets`, `Cache hits 7, misses 5`, `Audited 9/12 items`, `Reducing 12 item outcomes`, and `Validating curation draft`.
- On cancellation, abort outstanding harness runs through the task abort controller. The item outcome schema supports `cancelled`; the daemon task remains `cancelled` when the user cancels the task.
- Reducer result validation uses the existing planning-result parser plus the eforge-plan validation hook. If validation errors occur, pass a capped repair source to the reducer once. If repair fails, complete with a bounded top-level needs-input result that references the source fingerprint and validation stage.

## Verification

- [ ] Monitor tests assert generic planning tasks still call `runEforgePlanPlanningDraftTask` with `sourceText` and do not enter the map/reduce runner.
- [ ] Monitor tests assert backlog-curation tasks audit all non-cached items with one packet per agent call.
- [ ] Monitor tests assert cache-hit outcomes skip item audit harness calls.
- [ ] Monitor tests assert one item-agent failure produces a bounded per-item skipped or needs-input outcome and the task still reaches the reducer.
- [ ] Monitor tests assert cancelling a running curation task aborts outstanding harness runs and persists a cancelled task record.
- [ ] Progress tests assert task metadata/events contain source preparation, packet count, cache count, audit progress, reduction, and validation messages.
- [ ] Reducer input tests assert final reducer prompt length is less than or equal to the exported reducer cap.
- [ ] Reducer input tests assert reducer prompt/source excludes raw `gitDelta`, raw `fullImplementationAudit`, and full item body sentinel strings.
- [ ] Action tests assert active task reuse keys include curation source and item audit concurrency.
- [ ] Compatibility tests assert a valid reducer `backlogCurationDraft` passes existing preview/apply validation.
- [ ] Compatibility tests assert invalid preconditions, invalid statuses, invalid dependency references, and invalid evidence prefixes still fail through existing validation paths.
- [ ] Context-length regression test constructs large curation metadata near the reported size and proves analyze-all completes without a monolithic final prompt.
- [ ] `pnpm --filter @eforge-build/monitor type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
