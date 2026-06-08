---
id: plan-02-eforge-plan-task-workflows
name: Add eforge-plan Durable Task Workflows and Creation Draft Apply
branch: make-eforge-plan-workstation-ai-first-for-session-plan-generation/plan-02-eforge-plan-task-workflows
agents:
  builder:
    effort: high
    rationale: This plan adds extension-owned durable workflow metadata,
      retry/redraft actions, and safe session-plan creation using existing
      adapters.
  reviewer:
    effort: high
    rationale: Review must verify no deterministic promotion path is used for
      creation draft apply and no build enqueue side effects are introduced.
---

# Add eforge-plan Durable Task Workflows and Creation Draft Apply

## Architecture Context

The eforge-plan extension owns product workflow state while daemon task records remain authoritative for task status, result, cancellation, and errors. Extension action handlers already receive `ctx.paths` for project-local extension storage and `ctx.agentTasks` for owner-scoped daemon task access.

This plan consumes the shared task contract from plan-01 and creates the action layer that the workstation will use in plan-03.

## Implementation

### Overview

Persist eforge-plan planning task workflow references outside React state, add list/retry/redraft actions, derive AI promotion requests from selected backlog context when no prompt is supplied, and apply AI-authored session-plan creation drafts through the session-planning workflow adapter.

### Key Decisions

1. Store workflow index metadata under project-local extension storage, for example `.eforge/storage/extensions/eforge-plan/planning-tasks/index.json`, and keep daemon task records authoritative for live status/result/error fields.
2. Make `start-planning-agent-task` able to derive a planning goal from selected items or a recommendation ref when `userGoal` is omitted, while still accepting explicit goals for compatibility.
3. Implement retry and clarification re-draft as new single-shot tasks linked by parent task id in the extension-owned index, not as daemon-owned chat transcripts.
4. Apply `sessionPlanCreationDraft` by composing adapter-backed create/select-dimensions/set-section/metadata/readiness operations; do not call `promoteBacklogSelection`, enqueue builds, mark backlog items shipped, or mark session plans submitted.
5. Extract planning-task action schemas from the already-large `schema.ts` into a focused schema module if needed to keep implementation files under the maintainability cap.

## Scope

### In Scope

- Durable eforge-plan planning task workflow index with task id, parent task id, original request, derived request, selected item ids or recommendation ref, requested output sections, and timestamps.
- `list-planning-agent-tasks` action that projects indexed workflows and fetches owner-scoped daemon task records by id, surfacing missing records as stale/unavailable entries.
- `retry-planning-agent-task` action that reuses preserved request context and records the new task id.
- `redraft-planning-agent-task` action that includes original request context, previous task summary/questions, and user answers or steering in bounded planner context.
- `start-planning-agent-task` changes for optional `userGoal`, derived goal generation, default `sessionPlanCreationDraft` output for selected backlog promotion, and workflow index persistence.
- `apply-planning-agent-task-result` support for explicit session-plan creation draft apply.
- Action schemas, registration, allowed action list additions, and tests.

### Out of Scope

- Workstation component rendering or generated assets.
- Removing the registered `promote-selection` action, integration command, or deep link.
- Daemon task list routes or daemon-owned chat state.
- Automatic queue enqueue, backlog shipment, or session-plan submitted status changes.

## Files

### Create

- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — focused TypeBox schemas/types for planning task workflow actions if moving them out of `schema.ts` keeps file sizes within policy.
- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts` — read/write helpers for the project-local workflow index with atomic writes, JSON-safe projection, stale task handling, and stable ordering.

### Modify

- `eforge/extensions/eforge-plan/schema.ts` — re-export or define new action schemas/types for task workflow list/retry/redraft, creation draft apply selections, and workflow projections while keeping existing imports stable.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — derive default AI promotion goals, start tasks with `sessionPlanCreationDraft` requested output when selected/recommended backlog context is supplied, write workflow index entries, implement list/retry/redraft actions, and expose missing daemon records as stale entries.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — resolve and validate selected `sessionPlanCreationDraft` output, reject duplicate explicit session ids before writes, create the session plan through the adapter, select generated planning type/depth dimensions, write selected sections, apply profile/agentProfile/openQuestions metadata, return relative path plus readiness detail, and avoid deterministic promotion helpers for creation draft apply.
- `eforge/extensions/eforge-plan/session-plan-metadata.ts` — reuse or lightly extend metadata update helpers if creation draft apply needs shared profile/agentProfile/openQuestions mutation logic.
- `eforge/extensions/eforge-plan/index.ts` — register `list-planning-agent-tasks`, `retry-planning-agent-task`, and `redraft-planning-agent-task`; add them to the workstation allowed action list for plan-03; keep `promote-selection` registered for compatibility.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — cover workflow index persistence/reload projection, retry request preservation, redraft context construction, and list projection with running/completed/failed/cancelled/missing daemon task records.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — cover creation draft apply, duplicate session rejection, metadata application, readiness detail return, and no backlog shipment.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update action registration, side-effect classification, and workstation allowed action expectations for new actions.
- `test/eforge-plan-agent-task-actions.test.ts` — add root-level schema/application edge cases for creation draft apply, retry context, and no enqueue/shipped/submitted side effects.

## Verification

- [ ] Starting a planning task with selected item ids and no `userGoal` records a workflow index entry containing the daemon task id, selected item ids, derived planning request, requested output sections, and creation timestamp.
- [ ] `list-planning-agent-tasks` returns indexed running, completed, failed, cancelled, and missing/stale entries without requiring a caller-supplied task id.
- [ ] Retrying a failed task with preserved context starts a new daemon task using the same item selection, roadmap flag, session, planning type, planning depth, and requested output sections.
- [ ] Redrafting from a needs-input parent starts a new daemon task whose bounded source text contains the original request, previous summary or questions, and user answers or steering.
- [ ] Applying a creation draft creates `.eforge/session-plans/<session>.md` through adapter-backed operations and returns `{ session, relativePath, readiness }` for the created plan.
- [ ] Applying a creation draft with an existing target session id fails before any recommendation or session-plan writes occur.
- [ ] Applying creation draft output leaves backlog item statuses unchanged, does not enqueue a build, and leaves the created session plan out of `submitted` status.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts test/eforge-plan-agent-task-actions.test.ts` exits 0.
