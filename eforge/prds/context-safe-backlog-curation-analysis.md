---
title: Context-Safe Backlog Curation Analysis
created: 2026-06-23
---

# Context-Safe Backlog Curation Analysis

## Problem / Motivation

The current `analyze-all` backlog curation path can assemble too much evidence into one planner request. The supplied backlog evidence reports a failed task with `context_length_exceeded` after the `analyze-all` flow built one combined source payload. Recent curation metadata was about 458 KB, with `gitDelta` and `fullImplementationAudit` each around 184–185 KB.

The desired behavior is not merely a smaller truncation threshold. `analyze-all` should be context-safe by construction: each open backlog item is audited in isolated per-item context, unchanged item findings are reused from cache, and the final reducer sees only global summaries plus compact item findings. The final user-visible output must remain compatible with the existing backlog curation preview/apply path.

## Goal

Convert `eforge-plan analyze-all` backlog curation from one large planner prompt into a bounded map/reduce workflow.

Source preparation should produce a small global context plus per-item packets, isolated item audit agents should produce cached compact findings, and a final reducer should emit the existing `backlogCurationDraft`/recommendations-compatible result with progress telemetry and bounded failure handling.

## Approach

Implement a dedicated eforge-plan backlog-curation map/reduce path triggered by the `analyze-all` workflow, while leaving ordinary session-plan planning tasks on the existing single-agent path.

Treat source preparation as deterministic and bounded. It should produce:

- A small global context containing curation guidance, roadmap summaries, recommendation summaries, dependency summaries, source fingerprint, caps, and diagnostics.
- Bounded per-item audit packets containing only that item's body summary/precondition, relevant dependency facts, current-source citations, historical navigation hints, and packet diagnostics.
- Canonical hashes and cap diagnostics.

Use the current source as closure authority. Historical git, PR, lifecycle, and session signals remain navigation hints in item packets. Per-item agents and the reducer must not close work from history alone.

Invoke an isolated per-item audit agent, or equivalent daemon-orchestrated agent unit, for each open item that is not served by cache. The first slice can use the existing planner runtime for both item audits and reducer work; model routing specialization can be deferred.

Make per-item audit output a compact structured finding, not a final backlog patch. The reducer owns final `backlogCurationDraft` and recommendation consistency across items.

Cache only schema-valid compact findings. Cache keys must include source fingerprint, item id, packet/body hash, prompt version, and model/runtime identity. Store enough diagnostics to explain cache reuse without rehydrating raw packet evidence into the reducer.

Feed the final reducer only global context, cross-item summaries, dependency summaries, recommendation summaries, and compact per-item findings.

Use strict byte/count caps at every boundary: packet input, item-agent output, cached finding, reducer input, validation error repair input, and progress metadata.

On item-level failure, synthesize bounded skip/needs-input findings with the item id, reason, and diagnostics instead of aborting the full run when safe.

Attempt at most one bounded reducer repair on schema/apply-preview validation errors. After that, return a bounded needs-input result or safe skipped findings rather than looping.

Prefer existing progress/event infrastructure for milestones before adding new public event variants. If new task metadata crosses package boundaries, define it in `@eforge-build/client`.

Likely implementation touch points include:

- `eforge/extensions/eforge-plan/backlog-curation-actions.ts`: keep `analyze-all-backlog` as the user action, preserve task reuse semantics by curation source/concurrency, and add any needed task metadata fields without changing user-facing behavior.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts`: return or persist a structured source bundle instead of only a large `sourceText`; continue writing preview metadata.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts`: refactor source assembly into global-context and per-item-packet builders, with canonical hashes and cap diagnostics.
- `eforge/extensions/eforge-plan/backlog-curation-full-audit.ts` and `eforge/extensions/eforge-plan/backlog-curation-source-first-audit.ts`: reuse current source-first evidence collection as packet evidence input, but stop relying on one giant reducer payload.
- New eforge-plan helpers such as `backlog-curation-packets.ts` and `backlog-curation-item-audit-cache.ts` may own packet schemas, byte caps, cache keys, cache read/write, and atomic sidecar writes.
- `packages/monitor/src/routes/extensions/agent-task-service.ts`: preserve structured source-provider output internally and branch backlog-curation tasks into the map/reduce runner while keeping generic planning tasks unchanged.
- `packages/engine/src/agents/extension-planning-task.ts` and/or new focused engine agent modules: factor common planner invocation so item-audit agents and the reducer can use strict submit tools, progress callbacks, abort handling, runtime/model identity capture, and validation repair.
- `packages/engine/src/prompts/`: add an item-audit prompt and adjust/add a reducer prompt that instructs the final planner to consume compact findings and emit existing result shapes.
- `packages/client/src/extension-agent-tasks.ts`: define shared wire shapes only if new task metadata/result-visible structures cross daemon/client boundaries; do not duplicate route or wire-shape interfaces in monitor code.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts`: should remain mostly unchanged; add compatibility tests rather than weakening validation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/*`: update progress/preview presentation only if new progress metadata is surfaced to the workstation.
- Tests may be added under `eforge/extensions/eforge-plan/__tests__/`, `packages/client/src/__tests__/`, `packages/monitor/src/__tests__/`, and engine agent tests as needed.

## Scope

In scope:

- Replace the monolithic `analyze-all` planner input with a bounded map/reduce backlog-curation workflow for `analyze-all-backlog`.
- Split source preparation into a small global context and bounded per-item audit packets.
- Include curation guidance, roadmap summaries, recommendation summaries, dependency summaries, source fingerprint, caps, and diagnostics in the global context.
- Include only the item body summary/precondition, relevant dependency facts, current-source citations, historical navigation hints, and packet diagnostics in each per-item audit packet.
- Invoke an isolated per-item audit agent, or equivalent daemon-orchestrated agent unit, for each open item that is not served by cache.
- Cache compact per-item findings by source fingerprint, item id, item body/evidence packet hash, prompt version, and model/runtime identity.
- Feed the final reducer only global context, cross-item summaries, dependency summaries, recommendation summaries, and compact per-item findings.
- Preserve existing final result shapes: `backlogCurationDraft`, `recommendations`, skip/needs-input semantics, and the current apply validation path.
- Emit progress/activity milestones for source preparation, packet creation, audit cache hits/misses, per-item audit progress, reduction, and validation.
- Add regression, size-bound, cache, validation, and failure-degradation tests.
- Reuse current source-first evidence collection as packet evidence input.
- Continue writing preview metadata.
- Add shared wire shapes in `packages/client/src/extension-agent-tasks.ts` only if new task metadata/result-visible structures cross daemon/client boundaries.
- Update workstation progress/preview presentation only if new progress metadata is surfaced to the workstation.

Out of scope:

- Replacing eforge-plan backlog storage or session-plan workflows.
- Generalizing this into a platform-wide multi-agent task framework unless a small internal helper is needed for this task.
- Changing the public `backlogCurationDraft` apply semantics except where shared wire/schema additions are required for task metadata or structured internal findings.

## Acceptance Criteria

- `analyze-all` source preparation no longer sends a combined raw backlog/evidence payload to one planner agent.
- Reducer input is bounded by an explicit byte cap.
- Reducer input excludes full raw evidence.
- Reducer input excludes full item bodies.
- Every open backlog item is represented by exactly one per-item outcome in a run.
- A cache-hit per-item outcome is supported.
- A successful item audit finding per-item outcome is supported.
- An oversized-packet bounded finding per-item outcome is supported.
- An item-agent failure bounded finding per-item outcome is supported.
- A cancellation per-item outcome is supported.
- Per-item packets are validated against strict schemas.
- Per-item packets are validated against explicit byte caps.
- Per-item packets are validated against explicit count caps.
- Per-item findings are validated against strict schemas.
- Per-item findings are validated against explicit byte caps.
- Per-item findings are validated against explicit count caps.
- Per-item findings are cached when source fingerprint, item id, packet/body hash, prompt version, and model/runtime identity are present.
- Cached per-item findings are reused when source fingerprint, item id, packet/body hash, prompt version, and model/runtime identity match.
- Cache misses invoke item audits with isolated context.
- Item audit prompts cannot see other items' full raw bodies.
- Item audit prompts cannot see other items' full raw evidence.
- The reducer receives only global context, dependency summaries, recommendation summaries, and compact per-item findings.
- The reducer returns a result accepted by the existing planning-result schema.
- Existing backlog curation apply validation accepts valid reducer output.
- Existing backlog curation apply validation rejects invalid preconditions as before.
- Existing backlog curation apply validation rejects invalid status as before.
- Existing backlog curation apply validation rejects invalid evidence as before.
- Oversized packets degrade into bounded `skipped` or `needsInput` findings when safe.
- Per-item audit failures degrade into bounded `skipped` or `needsInput` findings when safe.
- Invalid item findings degrade into bounded `skipped` or `needsInput` findings when safe.
- Reducer validation failures degrade into a bounded needs-input result when safe.
- A single item failure does not fail the entire task when safe degradation is possible.
- Task metadata/progress shows source preparation status.
- Task metadata/progress shows packet counts.
- Task metadata/progress shows cache reuse counts.
- Task metadata/progress shows per-item audit progress.
- Task metadata/progress shows reduction status.
- Task metadata/progress shows validation status.
- Unit tests assert per-item packet caps.
- Unit tests assert stable packet hashes.
- Unit tests assert full item preconditions.
- Unit tests assert per-item packets do not include unrelated item bodies.
- Cache tests assert hit/miss behavior changes when source fingerprint changes.
- Cache tests assert hit/miss behavior changes when item id changes.
- Cache tests assert hit/miss behavior changes when packet hash changes.
- Cache tests assert hit/miss behavior changes when prompt version changes.
- Cache tests assert hit/miss behavior changes when runtime/model identity changes.
- Orchestration tests with a stub harness assert all items are audited in isolation.
- Orchestration tests with a stub harness assert cache hits skip agent calls.
- Orchestration tests with a stub harness assert failures produce bounded findings.
- Orchestration tests with a stub harness assert abort cancels outstanding work.
- Orchestration tests with a stub harness assert progress counts are emitted.
- Reducer input tests assert reducer source stays below the configured cap.
- Reducer input tests assert reducer source excludes raw `gitDelta`.
- Reducer input tests assert reducer source excludes raw `fullImplementationAudit`.
- Reducer input tests assert reducer source excludes full item bodies.
- A context-length regression fixture approximates the reported large curation metadata.
- The context-length regression fixture proves `analyze-all` completes without constructing a monolithic final prompt.
- Existing backlog curation apply validation tests pass against reducer output.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.