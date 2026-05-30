---
id: plan-01-runtime-recovery
name: Validation Provider Recovery Runtime
branch: recoverable-validation-provider-failures/plan-01-runtime-recovery
agents:
  builder:
    effort: high
    rationale: Core pipeline control-flow changes touch provider normalization,
      build-stage delegation, and recovery-loop tests while preserving an
      oversized file ceiling.
  reviewer:
    effort: high
    rationale: Review needs to verify failure-classification boundaries, event
      ordering, and recovery budget behavior.
  tester:
    effort: high
    rationale: Tests cover async generator loops, fake timers, command providers,
      and callback-driven recovery.
---

# Validation Provider Recovery Runtime

## Architecture Context

Per-plan validation providers run in the build pipeline's `validate` stage. Today a failed provider sets `ctx.buildFailed`, emits `plan:build:failed`, and prevents review-fixer/evaluator stages from repairing deterministic quality-gate failures. This plan keeps validation providers as fail-closed gates while adding a bounded recovery loop that reuses the existing review-fixer/evaluator path.

Key constraints:

- Do not add client event schema variants.
- Do not change final post-merge validation command semantics.
- Keep `packages/engine/src/pipeline/stages/build-stages.ts` at or below its no-growth line-count ceiling.
- Keep provider thrown exceptions, timeouts, and unexpected return values as hard failures.

## Implementation

### Overview

Add internal failure classification and annotation preservation to the validation-provider runtime, create a focused recovery helper for the `validate` build stage, and replace the existing inline validate-stage failure logic with a thin delegation.

### Key Decisions

1. Classify failures in `NormalizedValidationResult` using `failureKind?: 'result' | 'command' | 'timeout' | 'exception' | 'unexpected-return'` so the build stage can distinguish recoverable gate failures from provider/runtime failures.
2. Treat `result` and `command` failures as recoverable. Treat `timeout`, `exception`, and `unexpected-return` failures as hard failures.
3. Keep recovery state local to the new helper instead of expanding `BuildStageContext`.
4. Use callbacks for review fixing and evaluation so the helper does not import private functions from `build-stages.ts`.
5. Restart the provider suite from the first provider after every recovery attempt.

## Scope

### In Scope

- Preserve structured validation annotations in normalized results.
- Convert recoverable validation failures to `ReviewIssue[]`.
- Map annotation severity: `error -> critical`, `warning -> warning`, `info -> suggestion`.
- Synthesize one critical `ReviewIssue` with `category: 'validation-provider'` when annotations are absent.
- Include provider name, message, details, command, and exit code in synthesized issue descriptions when present.
- Use a stable pseudo-file for synthesized or file-less issues, for example `.eforge/validation-providers/<provider>.txt`.
- Bound recovery attempts with `ctx.review.maxRounds`.
- Emit `plan:build:progress` for recovery attempts and exhausted recovery.
- Emit `plan:build:failed` only for hard failures or exhausted recoverable failures.
- Add focused runtime and recovery-stage tests.

### Out of Scope

- Public `failurePolicy` configuration.
- New event schema variants.
- Approval workflow/state.
- Final post-merge validation command retry changes.
- Extension management projections of raw command strings.

## Files

### Create

- `packages/engine/src/pipeline/stages/validation-provider-recovery.ts` — recovery-loop helper, recoverability predicates, and failure-to-`ReviewIssue` conversion utilities.
- `test/validation-provider-recovery-stage.test.ts` — focused tests for recovery callbacks, restart behavior, hard failures, budget exhaustion, command providers, and annotation issue conversion.

### Modify

- `packages/engine/src/extensions/validation-provider-runtime.ts` — add `failureKind`, annotation types, annotation preservation, and classifications for string, structured, command, timeout, exception, and unexpected-return failures.
- `packages/engine/src/extensions/index.ts` — export new runtime types if added, such as `NormalizedValidationFailureKind` and `NormalizedValidationAnnotation`.
- `packages/engine/src/pipeline/stages/build-stages.ts` — remove inline validate-stage failure handling and delegate to `runValidationProviderRecoveryStage(ctx, callbacks)`; keep the net line count at or below 1,527.
- `test/validation-provider-runtime.test.ts` — assert failure classifications and structured annotation preservation.
- `test/validation-provider-build-stage.test.ts` — update expectations for recoverable failures; keep this file focused on stage registration/delegation and hard-failure behavior.

## Implementation Notes

### Runtime classification

- `normalizeValidationResult(null | undefined | '' | whitespace)` returns passed without `failureKind`.
- A non-empty string returns `{ status: 'failed', message, failureKind: 'result' }`.
- A structured failed result returns `{ status: 'failed', message, details, annotations, failureKind: 'result' }`.
- A structured passed/skipped result preserves message and annotations only if needed by the type, without `failureKind`.
- An unexpected return shape returns `{ status: 'failed', message: ..., failureKind: 'unexpected-return' }`.
- Command-form non-zero exits return `{ status: 'failed', message, command, exitCode, failureKind: 'command' }`.
- Command and function timeouts return `failureKind: 'timeout'`.
- Function throws/rejections return `failureKind: 'exception'`.

### Recovery helper contract

Define a helper shaped like:

```ts
export interface ValidationProviderRecoveryCallbacks {
  runReviewFix: () => AsyncIterable<EforgeEvent>;
  runEvaluate: (overrides?: { strictness?: 'strict' | 'standard' | 'lenient' }) => AsyncIterable<EforgeEvent>;
}

export async function* runValidationProviderRecoveryStage(
  ctx: BuildStageContext,
  callbacks: ValidationProviderRecoveryCallbacks,
): AsyncGenerator<EforgeEvent>;
```

The `validate` stage passes:

```ts
yield* runValidationProviderRecoveryStage(ctx, {
  runReviewFix: () => reviewFixStageInner(ctx),
  runEvaluate: (overrides) => evaluateStageInner(ctx, overrides),
});
```

### Recovery loop behavior

- No providers: return without events.
- Passing or skipped providers: emit existing lifecycle events and continue.
- First recoverable failure in a pass:
  - If attempts are exhausted, emit progress, emit `plan:build:failed`, set `ctx.buildFailed = true`, and return.
  - Otherwise increment the attempt count, set `ctx.reviewIssues`, emit progress, run review-fix, run evaluate with `ctx.review.evaluatorStrictness`, and restart from provider index 0.
- Hard failure: emit lifecycle events, emit `plan:build:failed`, set `ctx.buildFailed = true`, and return.
- If callbacks set `ctx.buildFailed`, return immediately.

## Verification

- [ ] `normalizeValidationResult('lint error')` returns `failureKind: 'result'`.
- [ ] `normalizeValidationResult({ status: 'failed', annotations: [...] })` returns the annotation array.
- [ ] Command-form non-zero exit returns `failureKind: 'command'`.
- [ ] Function throw returns `failureKind: 'exception'` and does not invoke recovery callbacks in helper tests.
- [ ] Function timeout returns `failureKind: 'timeout'` and does not invoke recovery callbacks in helper tests.
- [ ] Unexpected return value returns `failureKind: 'unexpected-return'` and does not invoke recovery callbacks in helper tests.
- [ ] A legacy string failure invokes review-fix and evaluate before any terminal `plan:build:failed` event.
- [ ] A structured failed result invokes review-fix and evaluate before any terminal `plan:build:failed` event.
- [ ] A command-form failure invokes review-fix and evaluate before any terminal `plan:build:failed` event.
- [ ] After provider B fails and recovery runs, provider A is invoked again before provider B is retried.
- [ ] If providers pass after recovery, `ctx.buildFailed` remains unset.
- [ ] If a recoverable failure persists after `ctx.review.maxRounds` attempts, helper emits `plan:build:failed` and sets `ctx.buildFailed = true`.
- [ ] Annotation issues use `category: 'validation-provider'`, mapped severity, annotation file, and annotation line.
- [ ] `pnpm test -- validation-provider-runtime validation-provider-build-stage validation-provider-recovery-stage` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.