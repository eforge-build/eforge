---
title: Recoverable Validation Provider Failures
created: 2026-05-30
profile: pi-codex-5-5
landing: pr
landing_auto_merge: true
---

# Recoverable Validation Provider Failures

## Problem / Motivation

Validation providers currently behave as terminal per-plan gates inside the build pipeline. When a provider returns a failing result or a command-form provider exits non-zero, the `validate` build stage immediately emits `plan:build:failed`, sets `ctx.buildFailed = true`, and returns. `packages/engine/src/pipeline/runners.ts` then stops the build pipeline before review-fixer/evaluator stages can repair the issue.

The recent `fix-changedfiles-propagation-for-extension-contexts` build exposed this problem. Implementation and tests passed, but the project-local `.eforge/extensions/eforge-guardrails.ts` validation provider returned `status: 'failed'` for `pnpm maintainability:check`. Re-running that branch showed deterministic line-count ratchet violations in:

- `packages/engine/src/extensions/agent-context-runtime.ts`
- `packages/engine/src/pipeline/stages/build-stages.ts`

These are exactly the kind of issues an agent could fix by shrinking or extracting code, but the current control flow made them terminal and forced manual intervention.

Affected users are eforge users and extension authors who use validation providers for project-specific quality gates. Hard gates are still useful, but normal deterministic gate failures should be recoverable before becoming terminal.

Relevant current behavior and evidence:

- `docs/extensions.md` documents validation providers as plan-failing quality gates: any failure outcome fails the current plan and emits `plan:build:failed`.
- `packages/engine/src/pipeline/stages/build-stages.ts` registers the per-plan `validate` build stage.
- The `validate` stage runs each `runValidationProvider(...)`, yields provider lifecycle events, and on `result.outcome.status === 'failed'` immediately emits `plan:build:failed`, sets `ctx.buildFailed = true`, and returns.
- `packages/engine/src/pipeline/runners.ts` stops the build pipeline whenever `ctx.buildFailed` is set.
- `review-cycle` already has a reusable local pattern: `reviewStageInner` fills `ctx.reviewIssues`, `reviewFixStageInner` applies fixes, `evaluateStageInner` accepts or rejects them, and the cycle can iterate up to `ctx.review.maxRounds`.
- Final post-merge validation in `packages/engine/src/orchestrator/phases.ts` has a separate retry/fixer loop for shell validation commands, but that runs after all plan worktrees are merged and uses `validationFixer`, not the per-plan review-fixer/evaluator path.
- `packages/engine/src/extensions/validation-provider-runtime.ts` normalizes failure details for function and command providers into `NormalizedValidationResult` plus `extension:validation-provider:*` events.
- Command-form failures include `command` and `exitCode`.
- Structured function failures can include `details`.
- Roadmap alignment: this fits the Console Workbench “Actionable build control” and Extensibility goals by making extension-owned quality gates steerable and recoverable without moving orchestration out of the engine or weakening hard guardrails.

This is a **feature / focused** change. It adds new recoverable quality-gate behavior within the existing per-plan build pipeline and should not require delegated module planning.

## Goal

Make normal per-plan validation-provider gate failures recoverable before terminally failing the plan.

Validation providers should remain hard gates: if recovery cannot satisfy them, the plan still fails closed.

## Approach

Implement recovery inside the existing per-plan `validate` build stage by converting normal validation-provider failures into `ReviewIssue` values, running the existing review fixer and evaluator path, and rerunning the full provider suite from the beginning after accepted fixes.

Key implementation targets:

- `packages/engine/src/extensions/validation-provider-runtime.ts`
  - Extend `NormalizedValidationResult` with internal failure classification, likely `failureKind?: 'result' | 'command' | 'timeout' | 'exception' | 'unexpected-return'`.
  - Preserve structured `annotations` from `ValidationProviderResult` so provider-supplied file-level diagnostics can become precise `ReviewIssue` entries.
  - Set `failureKind` for legacy string failures.
  - Set `failureKind` for structured failures.
  - Set `failureKind` for command failures.
  - Set `failureKind` for thrown exceptions.
  - Set `failureKind` for timeouts.
  - Set `failureKind` for unexpected return values.

- New helper module, recommended: `packages/engine/src/pipeline/stages/validation-provider-recovery.ts`
  - Own most new logic to avoid growing the already-oversized `build-stages.ts` baseline.
  - Provide a generator helper such as `runValidationProviderRecoveryStage(ctx, callbacks)`.
  - Use callbacks that wrap `reviewFixStageInner(ctx)` and `evaluateStageInner(ctx, { strictness: ctx.review.evaluatorStrictness })`.
  - Run providers in order.
  - Emit provider lifecycle events.
  - Convert recoverable failures to review issues.
  - Run the fixer and evaluator.
  - Rerun the provider suite from the beginning.
  - Emit `plan:build:progress` messages for recovery attempts and exhausted recovery.
  - Avoid new event schema variants unless required.
  - Set `ctx.buildFailed = true` and emit `plan:build:failed` only for hard failures or exhausted recoverable failures.

- `packages/engine/src/pipeline/stages/build-stages.ts`
  - Replace the current inline `validate` stage body with a thin delegation to the new helper.
  - Keep direct growth minimal because `build-stages.ts` is an oversized legacy file with a no-growth maintainability ceiling.

- `packages/engine/src/pipeline/types.ts`
  - Change only if needed.
  - Avoid adding fields if callbacks are enough.
  - If shared recovery state is needed, keep it localized rather than expanding `BuildStageContext`.

- `packages/extension-sdk/src/hooks.ts`
  - Update validation-provider failure semantics.

- `docs/extensions.md`
  - Update validation-provider failure semantics.
  - Document recoverable versus hard validation-provider failures.
  - Document that structured annotations improve recovery precision.

- `docs/extensions-api.md`
  - Update validation-provider failure semantics.
  - Document recoverable versus hard validation-provider failures.
  - Document that structured annotations improve recovery precision.

- Package README/reference docs
  - Update validation-provider failure semantics.
  - Document recoverable versus hard validation-provider failures.
  - Document that structured annotations improve recovery precision.

- `test/validation-provider-runtime.test.ts`
  - Cover failure classification.
  - Cover annotation preservation.

- New focused test file, recommended `test/validation-provider-recovery-stage.test.ts`
  - Test the helper loop using real provider runtime registrations.
  - Use stubbed fixer/evaluator callbacks.

- `test/validation-provider-build-stage.test.ts`
  - Update expectations from immediate terminal failure to recovery-loop behavior, or keep only thin delegation coverage if the new helper has the detailed assertions.

Existing patterns to reuse:

- `reviewCycleStage` demonstrates the fix/evaluate loop over `ctx.reviewIssues`.
- `testIssueToReviewIssue` in `packages/engine/src/agents/common.ts` shows the existing pattern of converting another diagnostic type into `ReviewIssue`.
- Final validation in `packages/engine/src/orchestrator/phases.ts` demonstrates retrying a gate after a fixer, but should not be reused directly because it operates after plan merge and uses a different fixer contract.

Design decisions:

- Recover normal gate failures, not provider/runtime failures.
- Normal provider-returned failures should enter recovery because they usually describe defects in the plan worktree.
- Legacy non-empty string failures should enter recovery.
- Structured `{ status: 'failed' }` failures should enter recovery.
- Command-form non-zero exits should enter recovery.
- Provider thrown exceptions should remain hard failures because they usually indicate extension/runtime bugs, hung tools, or contract violations rather than actionable implementation defects.
- Provider timeouts should remain hard failures because they usually indicate extension/runtime bugs, hung tools, or contract violations rather than actionable implementation defects.
- Unexpected return shapes should remain hard failures because they usually indicate extension/runtime bugs, hung tools, or contract violations rather than actionable implementation defects.
- Use the existing review-fixer/evaluator path rather than inventing a new validation fixer agent.
- Convert validation-provider failure output into `ReviewIssue[]` and set `ctx.reviewIssues` before calling `reviewFixStageInner(ctx)`.
- Call `evaluateStageInner(ctx, { strictness: ctx.review.evaluatorStrictness })` after the fixer so accepted recovery changes are committed and rejected changes are discarded according to the existing evaluator discipline.
- Rerun the full provider suite from the beginning after each accepted recovery attempt.
- If provider B fails and the fixer changes code, provider A must be rerun too because the fix could invalidate an earlier passing gate.
- Stop on the first recoverable failure each pass, recover it, and restart.
- Bound recovery with the existing review budget in this slice.
- Use `ctx.review.maxRounds` as the maximum number of validation-provider recovery fix attempts.
- Define clear behavior when the recovery budget is exhausted.
- Avoid adding config/API surface in this slice.
- Prefer a new helper module to minimize `build-stages.ts` growth.
- Avoid adding public `failurePolicy?: 'hard' | 'recoverable' | 'advisory'` in the first implementation unless implementation uncovers a compatibility blocker.
- Use annotations when available.
- Otherwise synthesize one issue from message/details.
- Map validation-provider annotations to `ReviewIssue` values: `error -> critical`, `warning -> warning`, `info -> suggestion`.
- If no annotations exist, create one critical issue with `category: 'validation-provider'`.
- If no annotations exist, set `file` to a stable provider-output pseudo-file or annotated file when inferable.
- If no annotations exist, include provider name, message, details, command, and exit code as applicable in the description.
- Do not add event schema variants unless the implementation needs them.
- Emit existing provider lifecycle events.
- Emit `plan:build:progress` messages such as “Validation provider X failed; running recovery attempt N of M”.
- Keep terminal failure as `plan:build:failed` only after hard failure or exhausted recovery.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Normal provider-returned failures are safe to attempt to recover before terminal failure. | Docs define providers as quality gates over the plan worktree; recent maintainability failure was deterministic and actionable; final validation already has a fixer retry model. | medium | medium | Implement focused tests and run a dogfood build with a synthetic provider that fails once then passes after callback changes. | If wrong, eforge may spend time attempting fixes for intentionally terminal gates; exhausted recovery still fails closed. |
| Provider thrown exceptions and timeouts should remain hard failures. | Runtime code maps thrown errors/timeouts to failed outcomes today, but these represent provider/runtime reliability rather than plan defects; recovery fixer would lack actionable target context. | high | low | Add tests confirming no recovery callback invocation for timeout/exception classifications. | If wrong, some fixable command/tool failures may still require manual intervention; command-form non-zero failures remain recoverable. |
| `ctx.review.maxRounds` is an acceptable recovery budget for validation-provider fix attempts. | `BuildStageContext.review` is required and already drives review-cycle iteration; using it avoids new config/API surface. | medium | low | Add build-stage/helper tests with explicit `review.maxRounds` values, including zero or one. | If wrong, recovery may retry too much or too little; a future config knob may be needed. |
| A helper module with callbacks can reuse private build-stage fixer/evaluator functions without increasing `build-stages.ts` beyond maintainability ceilings. | `reviewFixStageInner` and `evaluateStageInner` are in `build-stages.ts`; callbacks allow the helper to orchestrate without importing private functions back from the helper. | high | low | Implement with `pnpm maintainability:check` as a gate. | If wrong, implementation may require further extraction or exported helpers. |
| Existing events are sufficient for observability. | Provider start/error/complete events already exist, and `plan:build:progress` is available for stage progress messages. | medium | medium | Inspect console/UI consumers during implementation; add schema events only if existing rendering cannot communicate recovery attempts. | If wrong, users may not clearly see that a provider failure was recovered; adding events would require client schema/docs updates. |
| Not adding public `failurePolicy` is acceptable for this slice. | Existing provider contract says failures fail the plan, and they still do after exhausted recovery; recovery is an internal pre-terminal repair attempt. | medium | medium | Review extension docs/tests and check whether any existing provider relies on no mutation attempts after failure. | If wrong, a follow-up or same-build addition of `failurePolicy` may be needed to preserve strict opt-out semantics. |

Recommended profile: **Excursion**.

Profile rationale: this is a cohesive engine/extensibility feature that touches runtime normalization, one build-stage control-flow slice, docs, and focused tests. A single planner can enumerate the implementation targets and dependencies with quality. Expedition is not needed because this does not require delegated module planning across independently designed subsystems.

## Scope

In scope:

- Make the per-plan `validate` build stage recover from normal validation-provider gate failures before terminally failing the plan.
- Treat normal provider failures as recoverable when they come from a provider-returned failing result.
- Treat legacy non-empty string returns as recoverable.
- Treat structured `{ status: 'failed' }` results as recoverable.
- Treat command-form non-zero exits as recoverable.
- Keep provider runtime crashes hard-failing by default.
- Keep provider timeouts hard-failing by default.
- Keep unexpected return shapes hard-failing by default.
- Convert recoverable validation-provider failures into `ReviewIssue` values that can be passed to the existing `reviewFixStageInner` and `evaluateStageInner` path.
- Rerun validation providers after accepted recovery fixes.
- Restart the provider suite from the first provider after accepted recovery fixes so an attempted fix cannot silently break an earlier provider.
- Limit recovery attempts with the existing per-plan review retry budget, `ctx.review.maxRounds`.
- Do not add a new configuration knob in this slice.
- Preserve existing provider lifecycle diagnostics: `extension:validation-provider:start`, `extension:validation-provider:complete`, `extension:validation-provider:error`, and `extension:validation-provider:timeout`.
- Avoid adding new event schema variants unless implementation evidence shows existing `plan:build:progress` plus agent/evaluator events are insufficient.
- Preserve final post-merge validation command retry behavior.
- Target only the per-plan extension validation-provider `validate` build stage.
- Update extension docs/API reference to describe recoverable versus hard validation-provider failures.
- Add focused tests for recovery-loop behavior.
- Add focused tests for runtime failure classification.

Out of scope:

- Do not add approval workflow/state.
- Do not add `beforeValidation`.
- Do not add `modify`.
- Do not add other deferred extension phases.
- Do not implement a public `failurePolicy` option in this slice unless necessary to preserve existing behavior during implementation.
- Do not make maintainability advisory as the durable fix.
- Maintainability should remain capable of blocking landing if recovery cannot satisfy it.
- Do not change final validation command semantics in `packages/engine/src/orchestrator/phases.ts`.
- Do not expose raw validation-provider command strings in extension management projections.

## Acceptance Criteria

- A validation provider that returns a non-empty string failure causes the validate stage to run a recovery fixer/evaluator attempt before emitting any terminal `plan:build:failed` event.
- A validation provider that returns `{ status: 'failed' }` causes the validate stage to run a recovery fixer/evaluator attempt before emitting any terminal `plan:build:failed` event.
- A command-form validation provider that exits non-zero causes the validate stage to run a recovery fixer/evaluator attempt before emitting any terminal `plan:build:failed` event.
- A provider failure caused by a thrown exception emits `plan:build:failed` without invoking the recovery fixer callback.
- A provider timeout emits `plan:build:failed` without invoking the recovery fixer callback.
- After a recovery fixer/evaluator attempt completes, the validate stage reruns validation providers starting with the first registered provider.
- If validation providers pass after a recovery attempt, the validate stage does not set `ctx.buildFailed`.
- If the same recoverable validation-provider failure persists after the configured recovery attempt budget is exhausted, the validate stage emits `plan:build:failed`.
- If the same recoverable validation-provider failure persists after the configured recovery attempt budget is exhausted, the validate stage sets `ctx.buildFailed = true`.
- Structured validation-provider annotations are preserved by `runValidationProvider`.
- Structured validation-provider annotations are converted into `ReviewIssue` entries for recovery.
- Validation-provider recovery progress is observable through existing event types without adding a new client event schema variant.
- `packages/engine/src/pipeline/stages/build-stages.ts` does not exceed its maintainability baseline line-count ceiling after the implementation.
- `pnpm type-check` exits 0.
- `pnpm test -- validation-provider-runtime validation-provider-build-stage validation-provider-recovery-stage` exits 0.
- `pnpm maintainability:check` exits 0.
