---
id: plan-01-readiness-contract
name: Enforce AI Session-Plan Creation Readiness Contract
branch: ensure-ai-session-plans-satisfy-readiness-dimensions/plan-01-readiness-contract
agents:
  builder:
    effort: high
    rationale: Coordinates a shared client task contract, prompt context, an
      input-package validator, extension apply ordering, and regression tests
      while avoiding growth in a baseline-capped source file.
---

# Enforce AI Session-Plan Creation Readiness Contract

## Architecture Context

AI session-plan creation flows cross three layers:

- `@eforge-build/input` owns the canonical session-plan readiness dimension map and acceptance-criteria diagnostics.
- `@eforge-build/client` owns the daemon task wire schema consumed by monitor, extension actions, workstation UI, and tests.
- `eforge/extensions/eforge-plan` owns recommendation-lane workflow context and the final apply semantics that write `.eforge/session-plans/*.md`.

The fix must keep non-creation planning output flexible, but make `sessionPlanCreationDraft` fail closed: model-friendly headings such as `Goal`, `Scope`, and `Validation` must never create a persisted not-ready plan.

## Implementation

### Overview

Add an input-package validator and dimension-contract export, pass canonical readiness dimensions into creation-draft agent tasks, tighten only the creation-draft schema shape, update the prompt and submit-tool behavior, and validate drafts before any write in the recommendation-lane apply path.

### Key Decisions

1. Keep the dimension map in `packages/input/src/session-plan.ts` as the source of truth. Export the existing dimension-spec resolver by renaming the private helper to `getSessionPlanDimensionSpec` without adding net lines to this baseline-capped file.
2. Put creation-draft readiness validation in a new input-package module so extension apply code can simulate readiness in memory before persistence and reuse existing acceptance-criteria diagnostics.
3. Add a `sessionPlanCreationReadiness` task-input context in `@eforge-build/client`: a full canonical type/depth contract plus a resolved entry when callers already know `planningType` and `planningDepth`.
4. Generate that task-input context in `eforge-plan` start/retry/redraft paths only when `sessionPlanCreationDraft` is requested. Non-creation outputs and plan-revision outputs keep their current dimension behavior.
5. Reject invalid creation drafts in `validatePlanningAgentTaskApplyTargets()` before recommendations, handoff drafts, session sections, metadata, source linkage, or session-plan files are written.

## Scope

### In Scope

- `sessionPlanCreationDraft` prompt instructions, structured context, submit-tool validation, and apply-time validation.
- Canonical `bugfix/focused` required dimensions: `problem-statement`, `reproduction-steps`, `root-cause`, `acceptance-criteria`, and `assumptions-and-validation`.
- Acceptance-criteria quality diagnostics as a hard gate for generated creation drafts that contain acceptance criteria.
- Recommendation-lane apply behavior and regression coverage for `group-fast-ux-bugfixes` model-friendly headings.
- Tests for the input validator, client schema, agent-task context, extension apply behavior, and prompt text.

### Out of Scope

- Plan revision patch enforcement.
- Manual session-plan creation behavior.
- Non-creation planning output dimension enforcement.
- Failure or cancel flow behavior except shared diagnostic text for rejected creation drafts.

## Files

### Create

- `packages/input/src/session-plan-creation-draft.ts` — validation helper for generated session-plan creation drafts. It must build an in-memory plan with `createSessionPlan`, `setSessionPlanDimensions`, `setSessionPlanSection`, `skipDimension`, and `getReadinessDetail`, then report required dimensions, unknown dimensions, missing dimensions, skipped dimensions, covered dimensions, AC diagnostics, and actionable messages.
- `test/session-plan-creation-draft-validator.test.ts` — unit tests for `bugfix/focused` coverage, explicit skips, missing dimensions, unknown display-heading aliases, and invalid acceptance criteria.

### Modify

- `packages/input/src/session-plan.ts` — export the dimension spec type and resolver with bounded exact edits only. Do not increase this file beyond its current baseline ceiling; avoid new helper bodies here.
- `packages/input/src/index.ts` — export the dimension resolver, creation-draft validator, and related types.
- `packages/client/src/extension-agent-tasks.ts` — add a kebab-case creation-draft dimension id schema, apply it only to `sessionPlanCreationDraft.sections[].dimension` and `skippedDimensions[].dimension`, and add the optional `sessionPlanCreationReadiness` input-context schema/type.
- `packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts` — verify creation-draft schemas reject display-heading aliases such as `Goal` and accept `sessionPlanCreationReadiness` context.
- `packages/engine/src/agents/extension-planning-task.ts` — reuse the client creation-draft schema in the submit tool, pass `sessionPlanCreationReadiness` into the prompt, and reject a submitted creation draft when the context identifies unknown or missing required dimensions before accepting the final task result.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — add model-facing instructions for `sessionPlanCreationDraft`: use only exact kebab-case readiness dimension ids from the provided contract, never display-heading aliases, cover or explicitly skip every required id, and emit `needs-input` if a ready draft cannot be produced.
- `test/prompts.test.ts` — supply the new prompt variable and assert the prompt includes exact-id and no-alias guidance.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — compute `sessionPlanCreationReadiness` from exported input-package helpers for start/retry/redraft when `sessionPlanCreationDraft` is requested. Include all type/depth entries and include the resolved required ids when the request or workflow entry has both planning type and depth.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — verify recommendation-lane start requests include the canonical `bugfix/focused` required ids in the contract and verify resolved `bugfix/focused` requests include the exact resolved ids.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — validate the resolved creation draft before any persistence. Throw `userActionError` with a message that lists expected ids, unknown ids, missing ids, and AC diagnostic messages. Keep section-patch apply behavior unchanged.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — update existing creation-draft fixtures to produce ready feature/focused plans, add a successful recommendation-lane `bugfix/focused` apply with covered/skipped required ids and `ready:true`, add the `group-fast-ux-bugfixes` friendly-heading regression, and add an acceptance-criteria diagnostic rejection case.
- `test/eforge-plan-agent-task-actions.test.ts` — update the AI creation apply fixture to cover all feature/focused required dimensions and assert `readiness.ready === true` with required covered/skipped ids.
- `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` — update any “ready creation draft” fixture wording or section data if schema tightening or prompt context assertions require it.

## Implementation Notes

### Input validator behavior

The new validator must return invalid when any of these conditions is present:

- A section or skipped dimension is not one of the exact required ids for the draft’s `planningType` and `planningDepth`.
- A required id is neither covered by substantive section content nor skipped with a non-empty reason.
- `acceptance-criteria` has content and `getReadinessDetail()` returns `acDiagnostics`.
- A skipped dimension has a blank reason.

The error message used by extension apply must include:

- `planningType/planningDepth`.
- `expected required dimension ids: ...`.
- `unknown dimension ids: ...` when present.
- `missing required dimension ids: ...` when present.
- Acceptance-criteria diagnostic messages when present.
- A no-alias instruction naming examples such as `Goal`, `Scope`, and `Validation`.

### Schema behavior

Only `sessionPlanCreationDraft` dimension fields get the kebab-case pattern. Keep `sessionPlanPatch.sections[].dimension` as a free string so existing non-creation and revision paths retain arbitrary section support.

### Prompt context behavior

Format `sessionPlanCreationReadiness` as JSON in the prompt. The prompt must tell the model:

- If `resolved` exists, copy `resolved.planningType` and `resolved.planningDepth` and use exactly `resolved.requiredDimensions`.
- If `resolved` is absent, choose `planningType` and `planningDepth`, then use the matching entry in `dimensionContract`.
- Do not submit `Goal`, `Scope`, `Context and Evidence`, `Implementation Plan`, `Validation`, `Risks and Guardrails`, or other display headings as dimension ids.

## Verification

- [ ] `validateSessionPlanCreationDraftReadiness()` returns valid for a `bugfix/focused` draft covering all five required ids.
- [ ] `validateSessionPlanCreationDraftReadiness()` returns valid for a `bugfix/focused` draft that covers four required ids and skips `root-cause` with a non-empty reason.
- [ ] `validateSessionPlanCreationDraftReadiness()` returns invalid and lists `problem-statement` when that required id is missing and not skipped.
- [ ] `validateSessionPlanCreationDraftReadiness()` returns invalid and lists `Goal` and `Validation` as unknown ids for a friendly-heading draft.
- [ ] A generated creation draft with invalid acceptance criteria content is rejected before `.eforge/session-plans/<session>.md` exists.
- [ ] Applying the `group-fast-ux-bugfixes` friendly-heading draft rejects with an actionable message and leaves `.eforge/session-plans/group-fast-ux-bugfixes.md` absent.
- [ ] Applying a recommendation-lane `bugfix/focused` creation draft with all required ids covered or skipped returns `readiness.ready === true`.
- [ ] The successful recommendation-lane readiness result includes all five `bugfix/focused` ids across `coveredDimensions` and `skippedDimensions`.
- [ ] `sessionPlanPatch` parsing still accepts arbitrary section names in existing tests.
- [ ] Prompt tests confirm exact kebab-case id guidance and no-alias guidance appear in `eforge-plan-planning-draft`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test` exits 0.
