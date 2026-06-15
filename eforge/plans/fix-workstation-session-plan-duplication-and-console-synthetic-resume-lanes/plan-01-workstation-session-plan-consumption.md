---
id: plan-01-workstation-session-plan-consumption
name: Consume Applied Session-Plan Creation Tasks
branch: fix-workstation-session-plan-duplication-and-console-synthetic-resume-lanes/plan-01-workstation-session-plan-consumption
agents:
  builder:
    effort: medium
    rationale: Focused extension/workstation bugfix with existing workflow index
      primitives and test coverage patterns.
---

# Consume Applied Session-Plan Creation Tasks

## Architecture Context

The eforge-plan workstation lists durable Plan with AI workflow entries through `list-planning-agent-tasks`. Applying a completed `sessionPlanCreationDraft` currently creates the flat session plan through `applySessionPlanCreationDraft`, but the originating workflow entry remains visible and actionable. The workflow index already has `appliedAt` and `markPlanningTaskWorkflowEntryApplied`, currently used by backlog curation apply. This plan routes creation-draft consumption through that shared durable marker while preserving manual dismissal via `remove-planning-agent-task`.

Current exploration found the bug still open: `eforge/extensions/eforge-plan/planner-orchestration.ts` creates and returns the new session plan without marking the workflow entry applied, and `agent-task-actions.ts` lists every entry regardless of `appliedAt`.

## Implementation

### Overview

After a successful session-plan creation draft apply from a workflow-indexed task, mark the workflow entry consumed and hide it from normal task-list projection. Add a durable idempotency guard plus an in-process duplicate-click guard so the same completed task cannot create another session plan after success or during an in-flight apply. Leave cancel and failure paths unmarked and visible.

### Key Decisions

1. Use the existing workflow index `appliedAt` field as the durable consumed marker, rather than inventing a separate task store or mutating daemon task records.
2. Hide only consumed session-plan creation workflow entries from `list-planning-agent-tasks`; backlog curation entries with `appliedAt` keep their existing visible applied-state behavior.
3. Keep manual dismissal/removal unchanged: `remove-planning-agent-task` remains the explicit path for non-running unconsumed tasks.
4. If implementation starts and finds the creation flow already consumes the task, limit code changes to regression coverage and note the finding in the implementation summary.

## Scope

### In Scope

- Mark workflow-indexed `applySessionPlanCreationDraft` success as applied/consumed.
- Reject a second creation-draft apply for a task whose workflow entry already has `appliedAt`.
- Block concurrent duplicate creation-draft applies in the same daemon process while the first apply is in flight.
- Hide consumed session-plan creation tasks from the workstation task list projection.
- Remove the consumed task from local workstation hook state after a successful creation response and after reload.
- Regression tests for success, duplicate, failure, cancel, and manual dismissal behavior.

### Out of Scope

- Changing session-plan file format.
- Changing backlog curation apply semantics beyond avoiding regressions.
- Changing daemon-owned agent task status records.
- Enqueueing builds or marking backlog items shipped during creation-draft apply.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.test.tsx` — focused UI coverage for create-session-plan confirmation cancel/confirm behavior if existing tests cannot cover this without broad fixtures.

### Modify

- `eforge/extensions/eforge-plan/planner-orchestration.ts` — before creation-draft writes, reject when the workflow entry is already applied; add an in-flight guard keyed by cwd/task id; after successful `applySessionPlanCreationDraft`, call `markPlanningTaskWorkflowEntryApplied`; clear in-flight state on failure without writing `appliedAt`.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — filter consumed session-plan creation workflow entries out of `list-planning-agent-tasks` while leaving applied backlog-curation entries visible.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — after a successful apply response containing `sessionPlanCreationDraft`, remove that task id from local items before/alongside reload so the visible list consumes the task immediately.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx` — only if needed for testable cancel/confirm behavior; preserve the existing two-step confirmation UX.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — add action-level regressions for consumed marker, hidden list entry, duplicate rejection, failed apply leaving entry visible/actionable, and manual dismissal retention.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx` — add hook regression for successful creation apply refreshing artifacts and removing the task from local state.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` — extend existing card coverage only if needed to prove manual dismissal remains present for unconsumed completed tasks.

## Verification

- [ ] Applying a workflow-indexed `sessionPlanCreationDraft` creates `.eforge/session-plans/<session>.md` and writes `appliedAt` on the originating workflow entry.
- [ ] `list-planning-agent-tasks` omits the consumed session-plan creation task after the successful apply.
- [ ] Reapplying the same consumed task with `applySessionPlanCreationDraft` returns an invalid-input/error result and does not create a second session file, including when the second request supplies a different `session` override.
- [ ] A creation apply that fails target validation leaves the workflow entry without `appliedAt` and `list-planning-agent-tasks` still returns the task.
- [ ] Clicking Cancel in the UI confirmation leaves `onApply` uncalled and leaves the Create session plan button available.
- [ ] Existing manual Dismiss for non-running unconsumed tasks still removes the workflow entry.
- [ ] Targeted workstation tests exit 0: `pnpm exec vitest run eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx`.