---
title: Fix workstation session-plan duplication and Console synthetic resume lanes
created: 2026-06-15
---

# Fix workstation session-plan duplication and Console synthetic resume lanes

## Problem / Motivation

Two independent user-visible UX bugs need to be fixed.

In the eforge-plan workstation, after a user confirms **Create session plan** from a completed Plan with AI task, the session plan is created but the completed task remains visible and still offers **Create session plan**. This enables accidental duplicate session-plan creation from the same completed task.

In Console resume pipeline rendering, resume state can seed a synthetic `acceptance-validation` ID as pending after an acceptance-validation gate failure. Console treats the seeded ID like a plan status and renders an empty raw `acceptance-validation` swimlane even though no orchestration plan, artifact, agent thread, or validation lane content backs it.

## Goal

Successful session-plan creation from a completed Plan with AI task should consume or dismiss the originating completed task and prevent duplicate creation. Console should not emit or render synthetic resume IDs like `acceptance-validation` as resumable plan lanes unless they are backed by real orchestration artifacts or valid phase-lane content.

## Approach

For the completed Plan with AI task flow, update the successful session-plan creation branch so it creates and persists the session plan and then transitions, dismisses, removes, or otherwise marks the originating completed workflow task as consumed. Add an idempotency guard so the same completed task cannot create duplicate session plans after success. The failure and cancel branches should keep the existing task state unchanged.

Before implementing the workstation fix, confirm the completed Plan with AI task bug is still open. If current code already fixed it, limit work to regression coverage and backlog follow-up rather than reworking the flow.

If task-list/session-plan behavior is exposed through multiple first-party integration surfaces, keep those surfaces in sync or route the behavior through shared code.

For the synthetic resume swimlane issue, address the cross-layer resume projection problem instead of merely adding `acceptance-validation` to the lane registry. Adding it to the lane registry would rename an empty bogus row instead of preventing synthetic resume IDs from becoming lanes.

The known cross-layer issue is:

- `packages/engine/src/recovery/event-history.ts` can synthesize a summary plan entry with `planId: "acceptance-validation"` and `status: "failed"` as recovery evidence.
- `packages/engine/src/resume/resume-projection.ts::deriveResumeSeedState` copies every summary plan into seeded pending/merged state.
- `packages/engine/src/eforge.ts` emits `build:resume:state` before filtering against actual orchestration artifacts.
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts` adds every seeded pending ID to `planStatuses`.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` renders every `planStatuses` key as a lane.
- `lane-registry.ts` has no `acceptance-validation` entry, so Console displays the raw synthetic ID.

Filter resume seed state and resume context to actual orchestration plan IDs after `orchestration.yaml` and artifacts are known, or make `deriveResumeSeedState` accept an allowed-plan-id set. Console should also defensively ignore seeded IDs absent from orchestration/resume artifacts unless they are registered phase lanes with actual thread or validation-command content.

Treat this as a focused bugfix session because both backlog items are user-visible bugs with no declared dependencies and the recommendation group marks them safe to plan together as an excursion.

## Scope

In scope:

- Fix successful **Create session plan** handling for completed Plan with AI tasks.
- Prevent duplicate session-plan creation from the same completed task after success.
- Preserve cancel and failure behavior for the **Create session plan** flow.
- Preserve existing manual dismissal/removal behavior.
- Filter synthetic resume seeded plan IDs against real orchestration plan IDs.
- Preserve acceptance-validation failure evidence in recovery and terminal-failure summaries.
- Add Console defensive handling for seeded IDs absent from orchestration/resume artifacts.
- Preserve backed Validation, Gap Close, and Final Validation lanes.
- Add regression coverage for the workstation flow, resume projection, and Console rendering behavior.
- Run relevant targeted tests, `pnpm type-check`, and `pnpm maintainability:check` when implementation adds or substantially edits source files.

Out of scope:

- Do not fix the resume swimlane bug by merely adding `acceptance-validation` to the lane registry.
- Do not rework the completed Plan with AI task flow if the bug is already fixed; limit that case to regression coverage and backlog follow-up.

## Acceptance Criteria

- After a user confirms **Create session plan** from a completed Plan with AI task and session-plan creation succeeds, the originating completed task is dismissed, removed, transitioned, or otherwise marked consumed so it no longer appears in the visible workflow/task list.
- After successful session-plan creation from a completed Plan with AI task, the **Create session plan** action cannot be used again from the same completed task to create a duplicate session plan.
- If the **Create session plan** confirmation is cancelled, the completed task remains visible and actionable.
- If session-plan creation fails, the completed task remains visible and actionable.
- Existing manual dismissal/removal behavior for completed tasks continues to work.
- Regression coverage verifies the successful-create path consumes or dismisses the originating completed task.
- Regression coverage verifies duplicate session-plan creation is prevented after successful creation from the same completed task.
- Regression coverage verifies the cancelled creation path leaves the completed task visible and actionable.
- Regression coverage verifies the failed creation path leaves the completed task visible and actionable.
- Regression coverage verifies existing manual dismissal/removal behavior continues to work.
- A resumed build whose failure summary contains synthetic `acceptance-validation` evidence does not emit `acceptance-validation` as a resumable plan lane when `acceptance-validation` is absent from the actual orchestration artifacts.
- A resumed build whose failure summary contains synthetic `acceptance-validation` evidence does not render `acceptance-validation` as a resumable plan lane when `acceptance-validation` is absent from the actual orchestration artifacts.
- `build:resume:state` seeded plan IDs are filtered to real orchestration plan IDs.
- Resume context seeding is filtered to real orchestration plan IDs.
- Synthetic `acceptance-validation` failure evidence remains available in recovery summaries.
- Synthetic `acceptance-validation` failure evidence remains available in terminal-failure summaries.
- Console UI ignores resume seeded IDs that are absent from orchestration/resume artifacts and do not have registered phase-lane thread or validation-command content.
- Regression coverage includes a resume run with `seededPending: ["acceptance-validation"]`, real artifacts for `plan-01..N`, and no agent threads with `plan_id = acceptance-validation`.
- Regression coverage verifies the rendered pipeline has no empty raw `acceptance-validation` row for a resume run with `seededPending: ["acceptance-validation"]`, real artifacts for `plan-01..N`, and no agent threads for the synthetic ID.
- Existing Validation lanes still render when backed by agent threads or validation command spans.
- Existing Gap Close lanes still render when backed by agent threads or validation command spans.
- Existing Final Validation lanes still render when backed by agent threads or validation command spans.
- Engine/resume projection coverage shows synthetic `acceptance-validation` is retained as failure evidence when absent from orchestration artifacts.
- Engine/resume projection coverage shows synthetic `acceptance-validation` is excluded from seeded plan IDs when absent from orchestration artifacts.
- The relevant targeted test files for changed workstation behavior exit 0.
- The relevant targeted test files for changed resume projection behavior exit 0.
- The relevant targeted test files for changed Console pipeline behavior exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0 if implementation adds or substantially edits source files.

## Manual Verification Notes

Completed Plan with AI task dismissal reproduction:

1. Complete a Plan with AI task that produces a draft session plan.
2. Click **Create session plan**.
3. Confirm **Create session plan**.
4. Observe that the new session plan exists, but the completed task still appears in the visible workflow/task list with the **Create session plan** button.
5. Click again or reason about the enabled action: the same completed task can be used to attempt duplicate plan creation.

Failure/cancel control case:

1. Start the same **Create session plan** flow.
2. Cancel confirmation or force/observe a creation failure.
3. The completed task should remain visible and actionable.

Synthetic resume swimlane reproduction:

1. Resume a build whose resume events include `build:resume:state` with `seededPending: ["acceptance-validation"]`.
2. Ensure orchestration/resume artifacts contain only real plan IDs such as `plan-01..N` and no `agent:start` thread uses `plan_id = acceptance-validation`.
3. Open the Console pipeline view.
4. Current behavior renders an empty raw `acceptance-validation` swimlane.
5. Expected behavior is no empty synthetic row, while real Validation, Gap Close, and Final Validation lanes still render when backed by agent threads or validation command spans.