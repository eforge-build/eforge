---
id: plan-02-refresh-invalidation
name: Recommendation Refresh Action and Stale Invalidation
branch: maintain-recommended-backlog-implementation-order-and-next-work-plan/plan-02-refresh-invalidation
agents:
  builder:
    effort: high
    rationale: Coordinates daemon-owned task reuse, workflow-index metadata,
      synchronous lifecycle hooks, and mutation-triggered stale marking.
  reviewer:
    effort: high
    rationale: The plan changes extension action registration, lifecycle behavior,
      and apply semantics for daemon task results.
---

# Recommendation Refresh Action and Stale Invalidation

## Architecture Context

This plan builds on the freshness foundation. It adds the explicit refresh workflow and synchronous invalidation markers while preserving the existing boundary: daemon-owned agent tasks execute AI work; extension actions prepare context and apply selected output; lifecycle hooks never start or apply AI tasks.

## Implementation

### Overview

Add a recommendation-only refresh action, dedupe active refresh tasks for the current source fingerprint, track active refresh task IDs, and mark recommendations stale after extension-owned backlog changes and correlated lifecycle trace updates.

### Key Decisions

1. Register a new `refresh-recommendations` action that starts or reuses an `eforge-plan.planning-draft` task with `requestedOutputSections: ["recommendations"]` and `includeRoadmap: true`.
2. Store refresh workflow metadata in the existing planning-task workflow index with optional fields such as `purpose: "recommendation-refresh"` and `sourceFingerprint`. Older entries remain valid because the new fields are optional.
3. Deduplicate by `(purpose, sourceFingerprint)` and an active daemon status (`queued` or `running`). Completed, failed, cancelled, missing, or different-fingerprint tasks do not block a new refresh.
4. Mark stale synchronously after successful extension-owned mutations and correlated lifecycle trace updates. Hooks update sidecars and freshness metadata only; they do not call `ctx.agentTasks.start` or apply task results.
5. Applying a completed refresh task compares the workflow-entry fingerprint with the current source fingerprint. A mismatch never blocks an explicit apply; it leaves the model written and records a drift stale reason.

## Scope

### In Scope

- Recommendation refresh action and output schema.
- Active refresh task tracking and dedupe.
- Workflow-index optional metadata for recommendation refresh tasks.
- Stale reasons for capture/update/epic/promotion mutations.
- Stale reasons for correlated enqueue, queue PRD, session, landing, and auto-merge lifecycle updates.
- Uncorrelated or ambiguous lifecycle events leaving freshness unchanged.
- Planning-task apply behavior for matching vs drifted source fingerprints.
- Backend action-runtime and lifecycle tests.

### Out of Scope

- Automatic application of generated recommendations.
- Event-hook-launched AI tasks.
- Queue dependency mutation, build enqueueing, or plan-set generation.
- Global daemon queue DB reads.
- New daemon HTTP routes or extension-owned raw HTTP routes.

## Files

### Create

- `eforge/extensions/eforge-plan/recommendation-refresh.ts` — refresh action/helper that builds bounded recommendation context, starts or reuses daemon planning tasks, records workflow metadata, and updates active refresh state.
- `eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts` — refresh action start/reuse, request payload, bounded context, active-task status, and workflow-index coverage.
- `eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts` — backlog mutation stale reasons, preservation of `current.json`, and apply drift behavior.

### Modify

- `eforge/extensions/eforge-plan/recommendation-status-schemas.ts` — add refresh action input/output schemas if not included in plan 01.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — export/register the refresh action with `get`/`put`, and include active refresh task status in `get-recommendations` when a tracked task can be read.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — add optional workflow-entry metadata for `purpose` and `sourceFingerprint` without changing existing required fields.
- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts` — add helper(s) to find recommendation refresh entries by fingerprint and to list entries using the new optional metadata.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — read workflow metadata during `applyCompletedPlanningAgentTaskResult` and update freshness for matching or drifted recommendation-only tasks.
- `eforge/extensions/eforge-plan/index.ts` — register the refresh action, add it to workstation `allowedActions`, add a System contribution control if needed, and mark recommendations stale after `capture-item`, `upsert-epic`, `update-item`, `promote-item`, and `promote-selection` succeed.
- `eforge/extensions/eforge-plan/promote.ts` — expose affected item IDs or call the stale marker after successful session-plan promotion so planner-result handoffs are covered too.
- `eforge/extensions/eforge-plan/lifecycle.ts` — mark recommendations stale only after correlated trace/status updates for enqueue, queue PRD, session, landing, and auto-merge events.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — assert recommendation-only apply uses source fingerprints and preserves explicit apply semantics.
- `eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts` — add correlated enqueue, queue PRD, session, landing/auto-merge stale coverage and uncorrelated no-change coverage.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — include the new action, side effects, allowedActions entry, and no-build-queue assertions.

## Verification

- [ ] `eforge-plan:refresh-recommendations` starts one daemon task when no matching active refresh exists.
- [ ] The started task request uses kind `eforge-plan.planning-draft`, `input.requestedOutputSections` equal to `["recommendations"]`, and `input.includeRoadmap` equal to `true`.
- [ ] The refresh task source text includes open backlog items, epics, dependency/blocker projections, roadmap excerpts, current recommendations, trace summaries, and a source fingerprint.
- [ ] Calling `refresh-recommendations` again with the same source fingerprint returns the existing queued/running task and does not call `agentTasks.start` a second time.
- [ ] A completed, failed, cancelled, missing, or different-fingerprint refresh task does not prevent a new refresh task from starting.
- [ ] After `update-item` changes an open backlog item, `get-recommendations` returns `status.state: "stale"` and a stale reason with code/message naming the backlog mutation.
- [ ] The previous `current.json` bytes remain unchanged after stale marking from a backlog mutation.
- [ ] Correlated enqueue, queue PRD, session, `landing:complete`, and `landing:auto-merge:complete` lifecycle events update trace sidecars and record lifecycle stale reasons for the matched item IDs.
- [ ] Uncorrelated and ambiguous lifecycle events leave the freshness sidecar byte-for-byte unchanged.
- [ ] Lifecycle hook tests prove hook handlers never call `agentTasks.start`, `agentTasks.get`, or apply helpers.
- [ ] Applying a completed recommendation-only task with valid refs writes `current.json` and clears stale status when the task source fingerprint matches the current source fingerprint.
- [ ] Applying a completed recommendation-only task with valid refs writes `current.json` and records a drift stale reason when the task source fingerprint differs from the current source fingerprint.
- [ ] Applying a completed recommendation-only task with unknown refs returns an actionable handler error before `current.json` changes.
- [ ] No refresh, stale, lifecycle, or apply path writes `.backlog/recommendations.json`.