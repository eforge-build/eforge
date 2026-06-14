---
title: Ensure AI Session Plans Satisfy Readiness Dimensions
created: 2026-06-14
---

# Ensure AI Session Plans Satisfy Readiness Dimensions

## Problem / Motivation

AI-generated session-plan creation drafts can currently create session plans that are immediately not ready because the model emits friendly section headings instead of the exact readiness dimension ids required by the selected planning type and depth.

A dogfood failure created `.eforge/session-plans/group-fast-ux-bugfixes.md` with `planning_type: bugfix` and `planning_depth: focused`, but the AI task returned `Goal`, `Scope`, `Context and Evidence`, `Implementation Plan`, `Validation`, and `Risks and Guardrails` rather than the required readiness dimensions. The extension applied the draft, wrote the plan, and only then reported `ready:false`, `coveredDimensions:[]`, and missing dimensions for `problem-statement`, `reproduction-steps`, `root-cause`, `acceptance-criteria`, and `assumptions-and-validation`.

Root cause details:

- The creation flow accepts arbitrary section dimension strings from the AI task and does not enforce the readiness contract before persisting the plan.
- The prompt in `packages/engine/src/prompts/eforge-plan-planning-draft.md` asks for generated sections for `sessionPlanCreationDraft` but does not require exact kebab-case readiness dimension ids for the resolved planning type and depth.
- The task schemas in `packages/client/src/extension-agent-tasks.ts` and `packages/engine/src/agents/extension-planning-task.ts` accept arbitrary strings.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` applies the draft and reports readiness after writing, rather than validating or rejecting non-matching dimensions first.
- Existing tests allow the gap by using a non-readiness `scope` section and asserting readiness as `expect.any(Boolean)`.
- The canonical dimension contract exists in `packages/input/src/session-plan.ts`, but the AI creation flow does not use it as a hard precondition.

## Goal

Successful AI session-plan creation should produce a ready plan. If the AI emits invalid or unknown dimensions, the flow should fail closed or request a redraft before persisting a not-ready plan.

## Approach

- Keep `packages/input/src/session-plan.ts` or exported helpers from that package as the source of truth for readiness dimensions and acceptance-criteria diagnostics.
- Improve the AI prompt or structured task context so `sessionPlanCreationDraft` generation receives the resolved `planningType`, resolved `planningDepth`, and exact required readiness dimension ids.
- Validate generated `sessionPlanCreationDraft` content before persistence.
- Reject or redraft generated creation drafts that contain unknown dimensions such as `Goal`, `Scope`, or `Validation`.
- Require existing acceptance-criteria quality diagnostics to pass before a draft with acceptance criteria content is considered ready or apply succeeds.
- Scope enforcement to `sessionPlanCreationDraft` creation and apply paths.
- Preserve existing arbitrary section support for non-creation planning outputs where valid.
- Add regression coverage for the `group-fast-ux-bugfixes` failure mode.

## Scope

In scope:

- AI planning tasks that request `sessionPlanCreationDraft`.
- Prompt or structured task context changes for `sessionPlanCreationDraft`.
- Validation of generated session-plan creation drafts before persistence.
- Recommendation-lane apply behavior in `eforge/extensions/eforge-plan/planner-orchestration.ts`.
- `bugfix/focused` readiness dimensions: `problem-statement`, `reproduction-steps`, `root-cause`, `acceptance-criteria`, and `assumptions-and-validation`.
- Acceptance-criteria quality diagnostics for generated drafts.
- Tests for validator behavior, orchestration or extension apply behavior, successful AI creation readiness, and the `Goal`/`Validation` regression case.

Out of scope:

- Behavior changes for non-creation outputs, except shared diagnostic text needed to explain failed AI creation.
- Behavior changes for plan revision patches.
- Behavior changes for manual session-plan creation.
- Behavior changes for failure or cancel paths.

## Acceptance Criteria

- An AI planning task that requests `sessionPlanCreationDraft` and resolves `planningType` and `planningDepth` provides the model with the exact required readiness dimension ids for that type and depth via `packages/engine/src/prompts/eforge-plan-planning-draft.md` or structured task context.
- The model-facing instructions for `sessionPlanCreationDraft` tell the model to emit only exact required readiness dimension ids.
- The model-facing instructions for `sessionPlanCreationDraft` tell the model not to emit display-heading aliases.
- A generated `bugfix/focused` `sessionPlanCreationDraft` can be applied only if it covers or explicitly skips `problem-statement`.
- A generated `bugfix/focused` `sessionPlanCreationDraft` can be applied only if it covers or explicitly skips `reproduction-steps`.
- A generated `bugfix/focused` `sessionPlanCreationDraft` can be applied only if it covers or explicitly skips `root-cause`.
- A generated `bugfix/focused` `sessionPlanCreationDraft` can be applied only if it covers or explicitly skips `acceptance-criteria`.
- A generated `bugfix/focused` `sessionPlanCreationDraft` can be applied only if it covers or explicitly skips `assumptions-and-validation`.
- A generated creation draft containing unknown dimensions such as `Goal`, `Scope`, or `Validation` is rejected before persistence or routed to redraft.
- Applying a generated creation draft with unknown dimensions from a recommendation lane does not silently create a not-ready session plan.
- The rejection or redraft response for unknown dimensions includes a clear actionable message.
- A generated draft with acceptance criteria content is not considered ready unless the existing acceptance-criteria quality diagnostics pass.
- A generated draft with acceptance criteria content cannot be applied successfully unless the existing acceptance-criteria quality diagnostics pass.
- Successful AI creation from a recommendation set produces readiness `ready:true`.
- Successful AI creation from a recommendation set shows all required dimensions as covered or intentionally skipped in the Plans tab readiness section.
- Non-creation outputs continue through their existing flows without new readiness-dimension enforcement.
- Plan revision patches continue through their existing flows without new readiness-dimension enforcement.
- Manual session-plan creation continues through its existing flow without new readiness-dimension enforcement from the AI creation path.
- Failure and cancel paths continue through their existing flows except for shared diagnostic text needed to explain failed AI creation.
- A regression test exercises the `group-fast-ux-bugfixes` failure mode with model-friendly headings.
- The `group-fast-ux-bugfixes` regression test proves the old not-ready plan cannot be created silently.
- Unit tests cover the session-plan creation draft validator for `bugfix/focused` required dimensions.
- Unit tests cover unknown-heading rejection.
- Orchestration or extension tests cover applying an AI-generated draft from a recommendation lane.
- Orchestration or extension tests include the `Goal`/`Validation` regression case.
- Tests verify successful AI creation yields readiness `ready:true`.
- Tests verify successful AI creation covered or skipped dimensions include the required `bugfix/focused` ids.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0 when files with region markers or size-sensitive changes are touched.

## Manual Verification Notes

Original reproduction steps to preserve context:

1. Open the eforge-plan workstation and use a recommendation set that exposes a Plan / Plan lane action, such as the dogfooded `group-fast-ux-bugfixes` recommendation.
2. Start AI planning for a session-plan creation draft from that lane.
3. Let the planning task produce model-friendly headings such as `Goal`, `Scope`, `Context and Evidence`, `Implementation Plan`, `Validation`, and `Risks and Guardrails`.
4. Apply the generated `sessionPlanCreationDraft`.
5. Observe that the created session plan has `planning_type: bugfix` and `planning_depth: focused`, but readiness reports `ready:false`, `coveredDimensions:[]`, and missing dimensions for `problem-statement`, `reproduction-steps`, `root-cause`, `acceptance-criteria`, and `assumptions-and-validation`.
6. Confirm the Plans tab and handoff flow do not treat the created plan as ready despite the AI creation flow completing.

Manual validation note:

- Manually dogfood the recommendation-lane Plan action and confirm the created plan is ready immediately after apply.