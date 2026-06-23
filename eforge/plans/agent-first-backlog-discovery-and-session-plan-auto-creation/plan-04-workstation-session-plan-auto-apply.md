---
id: plan-04-workstation-session-plan-auto-apply
name: Workstation Session Plan Auto-Creation
branch: agent-first-backlog-discovery-and-session-plan-auto-creation/plan-04-workstation-session-plan-auto-apply
agents:
  builder:
    effort: high
    rationale: The workstation hook must coordinate polling, duplicate apply
      prevention, visible error state, data refresh, and navigation without
      introducing apply loops.
---

# Workstation Session Plan Auto-Creation

## Architecture Context

Recommendation lane `Plan` and selection planning already start daemon-owned `sessionPlanCreationDraft` planning tasks. Existing server-side `apply-planning-agent-task-result` validation remains authoritative for collisions, readiness, and non-abandoned plan overwrite protection. The workstation workflow layer can apply eligible completed creation tasks and move the user to Plans focus, leaving non-success states visible in Planning activity.

## Implementation

### Overview

Extend the planning-task workflow hook to auto-apply completed ready session-plan creation drafts exactly once per eligible task, surface apply failures without retry loops, refresh workstation data, and reuse the existing Plans-focus navigation behavior.

### Key Decisions

1. Auto-apply only completed, available, unapplied tasks whose result is a ready single-output `sessionPlanCreationDraft`.
2. Keep `needs-input`, failed, cancelled, unavailable, recommendation refresh, backlog curation, handoff, recommendation, patch, and ambiguous multi-output tasks visible for review.
3. Reuse existing `workflows.apply` behavior for server authority and data refresh, but suppress success toast for automatic creation.
4. Track in-flight, attempted, applied, and failed task ids in refs so polling/reload cycles do not create duplicate apply requests.
5. Keep collision/apply errors visible in Planning activity with a manual create/retry path.

## Scope

### In Scope

- Auto-apply detection in `use-planning-task-workflows.ts`.
- Duplicate prevention across initial load, polling, and reload.
- Apply error state surfaced in the Planning activity row/drawer/preview.
- Workstation navigation to `focus=plans&plan=<created-session-key>` after automatic creation.
- Tests for eligible auto-apply, duplicate prevention, non-eligible states, apply failures, collisions, and transient/manual retry behavior.
- README updates for the new workstation workflow.

### Out of Scope

- Server-side apply validation changes unless a test exposes a missing consumed/error marker required by the hook.
- Auto-handoff of created session plans to eforge builds.
- Removing readiness/sign-off gates.
- Auto-apply for backlog curation, recommendations, handoff drafts, or session-plan patch tasks.
- Build engine/kernel responsibilities.

## Files

### Create

- None expected.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — Add eligibility detection, auto-apply refs, apply error state, optional creation callback, and automated apply path.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/workstation-view.tsx` — Reuse a single helper that opens created session plans in Plans focus for manual and automatic apply.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/activity-rail.tsx` — Surface apply error summaries in Planning activity rows and pass error state into the drawer.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-drawer.tsx` — Pass apply error state into `PlanningTaskCard`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — Render apply-error/collision messaging with manual review/retry actions while keeping failed/cancelled/unavailable messaging visible.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx` — Keep manual creation controls for non-auto-applied and apply-error cases and show automatic apply failure text.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — Extend local workstation API types if apply error state is carried on workflow items or API objects.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx` — Add auto-apply, duplicate prevention, non-eligible, failure, and manual retry tests.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.test.tsx` — Add apply-error visibility and manual create control tests.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` — Add Planning activity messaging tests for failed, cancelled, unavailable, and apply-error states if not already covered.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — Add source-level guard assertions for auto-apply action wiring if existing asset tests cover workflow behavior.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — Add README contract assertions for auto-create and visible non-success states.
- `eforge/extensions/eforge-plan/README.md` — Document automatic session-plan creation, Plans-focus continuation, and visible non-success/apply-error cases.

## Implementation Notes

- Suggested eligibility predicate:
  - item is available;
  - status is `completed`;
  - `entry.appliedAt` is absent;
  - `entry.purpose` is absent;
  - `entry.requestedOutputSections` includes only `sessionPlanCreationDraft` or otherwise has no other applyable output in the task result;
  - `result.decision === 'ready'`;
  - `result.sessionPlanCreationDraft` has non-empty `session`, `topic`, `planningType`, `planningDepth`, and at least one section;
  - result does not include `backlogCurationDraft`, `recommendations`, `handoffDraft`, `handoffDrafts`, `sessionPlanPatch`, or `planRevisionTurn`.
- Call `apply-planning-agent-task-result` with exactly `{ taskId, applySessionPlanCreationDraft: {} }`.
- On success, remove the consumed task locally, call `onRefresh`, reload workflow tasks, and invoke the navigation callback with the applied `sessionPlanCreationDraft`.
- On failure, store the error message by task id, leave the task visible, and do not retry the same task from another poll/reload observation unless the user manually applies or starts a retry/redraft.
- Manual apply success must clear any stored apply error for the task.
- If a future transient retry policy is added, key attempts by task id plus result timestamp so collisions do not loop.

## Verification

- [ ] A completed available ready creation task invokes `apply-planning-agent-task-result` once with `applySessionPlanCreationDraft: {}`.
- [ ] Successful automatic apply calls workstation refresh, reloads task list, removes the consumed task locally, and invokes the created-plan callback with the created session id.
- [ ] Workstation view maps the automatic created-plan callback to `focus=plans` and the created `plan` query key.
- [ ] Polling and reload observing the same eligible task while apply is in flight still produce one apply request.
- [ ] `needs-input` completed tasks do not auto-apply and still render clarification/redraft controls.
- [ ] Failed, cancelled, and unavailable tasks do not auto-apply and still render retry/dismiss messaging.
- [ ] Recommendation refresh, backlog curation, handoff, recommendation, patch, and multi-output tasks do not auto-apply.
- [ ] Apply failure leaves the task visible and displays the error message in Planning activity.
- [ ] Collision error text from server apply validation is visible and no repeated automatic apply request is made for the same task.
- [ ] Manual creation apply remains available after an automatic apply error and clears the error on success.
- [ ] README contract test documents that readiness/sign-off stays in Plans focus after automatic creation.