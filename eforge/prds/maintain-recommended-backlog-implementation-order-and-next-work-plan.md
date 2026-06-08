---
title: Maintain Recommended Backlog Implementation Order and Next-Work Plan
created: 2026-06-08
---

# Maintain Recommended Backlog Implementation Order and Next-Work Plan

## Problem / Motivation

`eforge-plan` already has several recommendation pieces: a legacy volatile `.backlog/recommendations.json`, private recommendation storage/actions, planner context preparation, AI planning tasks, apply paths, lifecycle trace sidecars, and workstation rendering.

What is missing is durable recommendation maintenance. After backlog content changes, session-plan promotion, queue/run events, or landing events, the stored recommendation model can silently become stale and the workstation has no first-class freshness/status or safe refresh workflow.

## Goal

Build an extension-owned recommendation maintenance slice that keeps the private recommendation model trustworthy, roadmap-aware, trace-aware, and ready for future plan-set/parallelization work while preserving current boundaries.

## Approach

- Add private recommendation freshness/status state alongside the strict `current.json` recommendation model.
- Keep the recommendation model and freshness metadata separate because `BacklogRecommendationModelSchema` is intentionally strict and should stay focused on planner output.
- Track source fingerprint, last applied refresh, stale/fresh/missing status, stale reasons, and any active recommendation-refresh task id.
- Extend recommendation context so refresh tasks can reason over open backlog items, epics, dependency/blocker projections, roadmap excerpts, current recommendations, and lifecycle trace summaries.
- Mark recommendations stale after extension-owned backlog mutations and after correlated lifecycle trace updates for enqueue, queue PRD, session, landing, and auto-merge events.
- Do not mark recommendations stale for uncorrelated or ambiguous lifecycle events.
- Treat lifecycle hooks as synchronous stale markers only.
- Lifecycle hooks may update trace sidecars and recommendation freshness metadata, but they must not start or apply AI tasks from non-blocking event hooks.
- Add a recommendation refresh action that starts or reuses a daemon-owned `eforge-plan.planning-draft` task with `requestedOutputSections: ["recommendations"]`, `includeRoadmap: true`, and bounded open-backlog context.
- Reuse daemon-owned planning tasks instead of creating a new AI runtime.
- Recommendation refresh is a recommendation-only planning-draft task whose result is applied through existing safe apply paths.
- Use a source fingerprint to detect drift between task start and apply.
- A stale generated model can still be applied explicitly, but the status must make any drift visible.
- Harden apply paths so generated recommendation models are reference-validated before writing `current.json`.
- Unknown item IDs, empty parallel groups, and malformed blocker references should fail before `current.json` changes.
- Applying a matching-fingerprint model clears stale state.
- Applying after context drift records that another refresh is needed.
- Update the workstation to show missing/fresh/stale recommendation status, stale reasons, active refresh task status, and an explicit refresh/apply flow.
- Generated AI output remains read-only until the user confirms apply.
- Safe parallelizable groups are planning guidance only.
- Safe parallelizable groups must not enqueue builds, alter queue dependencies, or create plan sets automatically in this slice.
- The private extension store is authoritative.
- Do not read from or write to `.backlog/recommendations.json` in this feature; it remains a legacy volatile analyze-all artifact.
- The recommendation refresh context should be bounded and JSON-safe.
- Prefer deterministic projections of backlog frontmatter, sections, dependency context, roadmap excerpts, and trace summaries over raw filesystem dumps.

Likely implementation areas:

- `eforge/extensions/eforge-plan/recommendations-store.ts`: keep `current.json` strict and add helpers or a companion module for recommendation freshness metadata.
- New focused module such as `eforge/extensions/eforge-plan/recommendation-refresh.ts` or `recommendation-status.ts`: source fingerprinting, stale reason normalization, active task tracking, model reference validation, and freshness transitions.
- `eforge/extensions/eforge-plan/schema.ts`: add TypeBox schemas for recommendation status/freshness and any new action input/output shapes; keep `BacklogRecommendationModelSchema` backward-compatible and strict.
- `eforge/extensions/eforge-plan/recommendation-actions.ts`: extend `get-recommendations` output with optional status metadata or add a focused status action; add a refresh action if it is not kept in a separate action module.
- `eforge/extensions/eforge-plan/planner-orchestration.ts`: include trace summaries in planner context and clear/mark freshness when recommendations are applied through `applyCompletedPlanningAgentTaskResult` or `applyPlannerResult`.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` and `planning-task-workflow-store.ts`: reuse the durable planning-task workflow index for recommendation-only refresh tasks; dedupe active tasks for the same source fingerprint.
- `eforge/extensions/eforge-plan/index.ts`: register new actions, add workstation `allowedActions`, and call stale-marking helpers after successful mutating actions/lifecycle trace updates.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/**`: add types, fixture data, recommendation status badges, refresh controls, and active-task/apply affordances without importing parent Console internals.
- Tests under `eforge/extensions/eforge-plan/__tests__/` and project-level workstation tests should cover storage paths, schema validation, refresh task starts, lifecycle invalidation, apply behavior, and UI/action contracts.
- Update `eforge/extensions/eforge-plan/README.md` storage/actions/workstation documentation.
- Only update `eforge-plugin/` or `packages/pi-eforge/` if this adds host-specific commands or skills rather than generic extension actions.

Architecture constraints:

- The change should remain mostly inside the first-party `eforge-plan` extension.
- The change should not expand the build engine into input authoring or queue orchestration.
- Daemon-owned agent task primitives are reused through the existing extension action context.
- The workstation continues to call extension actions through the frame bridge.
- No new daemon HTTP routes should be needed.
- If a wire shape must be shared outside the extension, use the existing client-owned schema conventions rather than inlining route literals or daemon DTOs.
- Event types remain client-owned and should not be re-declared.

Documentation updates:

- Update `eforge/extensions/eforge-plan/README.md` to document that the private recommendation model remains at `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- Update `eforge/extensions/eforge-plan/README.md` to document the new freshness/status sidecar path and what stale/fresh/missing mean.
- Update `eforge/extensions/eforge-plan/README.md` to document the recommendation refresh action and its explicit apply semantics.
- Update `eforge/extensions/eforge-plan/README.md` to document workstation behavior for stale recommendations, refresh tasks, and generated output preview.
- Update `eforge/extensions/eforge-plan/README.md` to document non-goals: no auto-mode backlog draining, no automatic queue orchestration, no unattended build enqueueing, and no `.backlog/recommendations.json` import/export.
- If public docs or generated extension references include registered actions, regenerate/update them according to repository conventions.

Risks and mitigations:

- Over-eager invalidation could make recommendations look perpetually stale. Mitigate with normalized stale reasons, deduplication, and tests that uncorrelated lifecycle events do not invalidate.
- AI output may reference stale or nonexistent backlog IDs. Mitigate by validating all recommendation refs before writing and by preserving the previous model on validation failure.
- Context may drift while a recommendation task is running. Mitigate with source fingerprints and visible drift status after apply.
- Refresh source text can exceed task limits. Mitigate by using existing bounded-source utilities and compact trace/roadmap projections.
- Users may confuse legacy `.backlog/recommendations.json` with private recommendation storage. Mitigate with README/workstation labels and tests proving the legacy file is not written.
- Event hook cwd resolution is already fragile. If touched, keep changes minimal and covered by lifecycle tests.

Assumptions to validate during implementation:

- The existing planning-agent task workflow index can represent recommendation-only tasks by storing an empty selection and `requestedOutputSections: ["recommendations"]`.
- Trace sidecars provide enough queue/run/landing evidence for recommendation refresh in this slice; global daemon queue snapshots are not required.
- Recommendation freshness metadata can be stored as a private extension sidecar without changing the strict current recommendation model schema.
- Explicit user confirmation before applying AI recommendations is acceptable for this first automatic-maintenance slice.

## Scope

In scope:

- Add private recommendation freshness/status state alongside the strict `current.json` recommendation model.
- Track source fingerprint, last applied refresh, stale/fresh/missing status, stale reasons, and any active recommendation-refresh task id.
- Extend recommendation context so refresh tasks can reason over open backlog items, epics, dependency/blocker projections, roadmap excerpts, current recommendations, and lifecycle trace summaries.
- Mark recommendations stale after extension-owned backlog mutations.
- Mark recommendations stale after correlated lifecycle trace updates for enqueue, queue PRD, session, landing, and auto-merge events.
- Avoid marking recommendations stale for uncorrelated or ambiguous lifecycle events.
- Add a recommendation refresh action that starts or reuses a daemon-owned `eforge-plan.planning-draft` task with `requestedOutputSections: ["recommendations"]`, `includeRoadmap: true`, and bounded open-backlog context.
- Harden apply paths so generated recommendation models are reference-validated before writing `current.json`.
- Ensure applying a matching-fingerprint model clears stale state.
- Ensure applying after context drift records that another refresh is needed.
- Update the workstation to show missing/fresh/stale recommendation status, stale reasons, active refresh task status, and an explicit refresh/apply flow.
- Keep generated AI output read-only until the user confirms apply.

Out of scope:

- Autonomous backlog draining.
- Automatic queue selection.
- Unattended build enqueueing.
- Direct build enqueueing.
- Queue orchestration.
- Event-hook-launched AI tasks.
- Raw daemon route additions.
- Raw extension-owned HTTP routes.
- Global queue DB introspection.
- `.backlog/recommendations.json` migration/import/export.
- Legacy `.backlog/recommendations.json` writes.

## Acceptance Criteria

- Dispatching `eforge-plan:get-recommendations` in a project with no private model returns `recommendations: null`.
- Dispatching `eforge-plan:get-recommendations` in a project with no private model returns a machine-readable missing/stale recommendation status.
- Dispatching `eforge-plan:get-recommendations` in a project with no private model does not create `.backlog/recommendations.json`.
- After `eforge-plan:update-item` changes an open backlog item, a subsequent recommendation status read reports a stale reason naming the backlog mutation.
- After `eforge-plan:update-item` changes an open backlog item, the previous `current.json` recommendation model is preserved.
- After a correlated `landing:complete` lifecycle event updates a trace sidecar, a subsequent recommendation status read reports a lifecycle stale reason for the correlated item.
- After a correlated `landing:auto-merge:complete` lifecycle event updates a trace sidecar, a subsequent recommendation status read reports a lifecycle stale reason for the correlated item.
- An uncorrelated lifecycle event leaves recommendation freshness unchanged.
- Dispatching the new recommendation refresh action starts one active daemon planning task for the current source fingerprint when no matching active task exists.
- Dispatching the new recommendation refresh action returns one active daemon planning task for the current source fingerprint when a matching active task already exists.
- The recommendation refresh task input contains `requestedOutputSections: ["recommendations"]`.
- Applying a completed recommendation-only planning task with valid item IDs writes `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- Applying a completed recommendation-only planning task with valid item IDs updates the recommendation summary.
- Applying a completed recommendation-only planning task with valid item IDs clears stale status when the source fingerprint still matches.
- Applying a generated recommendation model that references an unknown backlog item fails before `current.json` is modified.
- Applying a generated recommendation model that references an unknown backlog item returns an actionable validation error.
- The workstation Backlog tab renders the missing recommendation state from fixture data.
- The workstation Backlog tab renders the fresh recommendation state from fixture data.
- The workstation Backlog tab renders the stale recommendation state from fixture data.
- The workstation Backlog tab renders recommendation states from live action data.
- The workstation Backlog tab exposes a refresh control when recommendations are stale.
- The workstation Backlog tab exposes a refresh control when recommendations are missing.
- The workstation Backlog tab requires explicit confirmation before applying generated recommendations.
- `pnpm test` exits 0.
- The test suite covers recommendation freshness storage.
- The test suite covers refresh task creation and deduplication.
- The test suite covers lifecycle invalidation.
- The test suite covers apply validation.
- The test suite covers workstation action contracts.
- `pnpm type-check` exits 0 with the updated TypeBox schemas and workstation TypeScript types.
- `pnpm build` exits 0 after rebuilding the `eforge-plan` workstation assets.
- `pnpm maintainability:check` exits 0.
- Any new large files use balanced durable region markers.

## Manual Verification Notes

- Inspect `eforge/extensions/eforge-plan/recommendations-store.ts`, `planner-orchestration.ts`, `agent-task-actions.ts`, `lifecycle.ts`, `schema.ts`, and workstation data flow before editing.
- Add backend tests for storage/status/fingerprint/ref-validation before UI changes.
- Add action-runtime tests for refresh task inputs and apply semantics.
- Add lifecycle tests for correlated and uncorrelated invalidation.
- Update workstation fixture and component tests for fresh/stale/missing recommendation states.
- Run the full repository gates listed in the acceptance criteria.