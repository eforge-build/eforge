---
title: Retry planner on dropped submission tool call
created: 2026-04-22
---

# Retry planner on dropped submission tool call

## Problem / Motivation

In a 10-run eval of `pi-qwen-3-6` on `todo-api-errand-health-check`, 2/10 runs (3 and 9) failed with:

> ✖ Planning failed: Planner agent completed without calling a submission tool (submit_plan_set) or emitting `<skip>`

The model reasoned correctly about the change (logs show coherent analysis and even the final "Profile: trivial, mechanical change" summary) but never invoked `submit_plan_set`. This is a structured-tool-use reliability gap typical of smaller local models, not a reasoning failure — every run that cleared the planner produced a passing artifact (8/8 validated).

Eforge already has a bounded-retry scaffold for the planner (`maxContinuations = 2` via `AGENT_MAX_CONTINUATIONS_DEFAULTS`), but it only triggers on `error_max_turns` exceptions. The "completed without submitting" case is emitted as a `plan:error` event that is *yielded*, not *thrown*, so it slips past the existing retry loop.

Expected impact (for the same 20%-per-attempt dropout rate): worst-case pipeline failure drops from 20% to 20%³ = 0.8%.

## Goal

Detect the "completed without submitting" planner failure and route it into the same continuation path used for `error_max_turns`, turning the current 2/10 failure mode into a first-try failure with up to 2 recovery attempts, at the cost of extra planner invocations only when the first attempt drops the tool call.

## Approach

Convert the `plan:error` event at planner completion into a thrown error, and add a sibling clause to the existing continuation catch block. Reuse the existing continuation loop, counter, checkpoint logic, and event type — no new config, no new knobs.

Also specialize the continuation prompt so the retry attempt is told *why* it's retrying (currently the prompt hardcodes "hit the max turns limit").

### Change 1 — Throw instead of yield on dropped submission

**File:** `/Users/markschaake/projects/eforge-build/eforge/packages/engine/src/agents/planner.ts:343-353`

Replace the `yield { type: 'plan:error', ... }` terminal with a thrown `PlannerSubmissionError` (new error class co-located in the same file or added to a local errors module). Keep the error message identical so downstream logs don't regress.

```ts
// Before:
yield { timestamp: ..., type: 'plan:error', reason: `Planner agent completed without calling a submission tool (${injectedNames}) or emitting <skip>` };

// After:
throw new PlannerSubmissionError(`Planner agent completed without calling a submission tool (${injectedNames}) or emitting <skip>`);
```

Add an exported type guard `isPlannerSubmissionError(err): err is PlannerSubmissionError` alongside `isMaxTurnsError` (whichever module hosts the latter — find via `rg "isMaxTurnsError"`).

### Change 2 — Handle it in the continuation loop

**File:** `/Users/markschaake/projects/eforge-build/eforge/packages/engine/src/pipeline.ts:926-944`

Add a sibling branch to the existing `isMaxTurnsError` handler:

```ts
} catch (err) {
  tracker.cleanup();

  const isRetryable = isMaxTurnsError(err) || isPlannerSubmissionError(err);
  if (isRetryable && attempt < maxContinuations) {
    await commitPlanArtifacts(ctx.planCommitCwd ?? ctx.cwd, ctx.planSetName, ctx.cwd, ctx.config.plan.outputDir);
    span.end();
    yield {
      timestamp: new Date().toISOString(),
      type: 'plan:continuation',
      attempt: attempt + 1,
      maxContinuations,
      reason: isPlannerSubmissionError(err) ? 'dropped_submission' : 'max_turns',
    } as EforgeEvent;
    continue;
  }

  span.error(err as Error);
  throw err;
}
```

The `reason` field on `plan:continuation` is additive — if the `EforgeEvent` discriminated union enforces the shape, extend it in the event type module to include an optional `reason: 'max_turns' | 'dropped_submission'`.

For a dropped-submission retry, no plan files exist yet, so `commitPlanArtifacts` will find nothing to commit — that's fine, the existing function no-ops on empty. Verify this by reading its implementation before merging (it's called from line 932 today; if it throws on empty, guard the call with `if (isMaxTurnsError(err))`).

### Change 3 — Specialize the continuation prompt

**File:** `/Users/markschaake/projects/eforge-build/eforge/packages/engine/src/agents/planner.ts:171-182`

Thread the failure reason through `continuationContext` so the retry prompt can say the right thing:

```ts
continuationContext?: { attempt: number; maxContinuations: number; existingPlans: string; reason: 'max_turns' | 'dropped_submission' };
```

Then branch `continuationContextText`:

- `max_turns` → existing wording (`"hit the max turns limit on the previous attempt"` + existing-plans list).
- `dropped_submission` → `"The previous attempt completed reasoning but did not call ${submitTool}. You MUST call ${submitTool} with your final plan set to complete this run — reasoning alone does not submit plans."` (No existing-plans list — nothing was written.)

Caller side in `pipeline.ts:828-853` already builds the `continuationContext`; add `reason` by stashing it from the catch block into a local the next loop iteration reads.

### Change 4 — (Optional) Shared vs. separate retry budget

The existing `maxContinuations = 2` counter will be shared between max-turns and dropped-submission retries. This is the simplest choice and recommended here: either failure mode indicates the model is struggling, and the cheap extra attempts are bounded either way.

If a separate budget turns out to matter, introduce `AGENT_MAX_SUBMISSION_RETRIES_DEFAULTS` later. Not worth the config surface now.

## Scope

**In scope:**

- `eforge/packages/engine/src/agents/planner.ts` (lines 23, 171-182, 343-353) — throw new error, thread `reason` into continuation context, branch prompt text.
- `eforge/packages/engine/src/pipeline.ts` (lines 820-945) — add sibling retry clause, wire `reason` into the next iteration's `continuationContext`.
- Wherever `isMaxTurnsError` lives (find via `rg "export.*isMaxTurnsError" eforge/packages/engine/src`) — add sibling guard `isPlannerSubmissionError` and export the new error class.
- Wherever `EforgeEvent` / `plan:continuation` is typed — add optional `reason` field.
- Shared retry budget with existing `maxContinuations = 2`.

**Out of scope:**

- New config knobs or a separate `AGENT_MAX_SUBMISSION_RETRIES_DEFAULTS` budget (deferred until proven necessary).
- Changes to backends that don't drop the tool call (claude-sdk-4-7, pi-anthropic-4-7) — first-attempt path is unchanged.

## Acceptance Criteria

1. **End-to-end eval:** Run the eval harness against `pi-qwen-3-6` with `--repeat 10` on `todo-api-errand-health-check` (same shape as `results/2026-04-22T03-51-40/`). Validation pass rate goes from 8/10 toward 10/10; `plan:continuation` events with `reason: 'dropped_submission'` appear in the logs (~20% of runs).
2. **Retry effectiveness:** For each retried run, confirm the second-attempt planner call does call `submit_plan_set` (grep the `eforge.log` for submission events).
3. **Unit test for `planner.ts`:** Simulate an agent turn stream that ends without `submit_plan_set` or `<skip>`; assert that `PlannerSubmissionError` is thrown (not yielded).
4. **Integration test for `pipeline.ts` continuation loop:** Mock `runPlanner` to throw `PlannerSubmissionError` on attempt 0 and succeed on attempt 1; assert that two spans are created, a `plan:continuation` event with `reason: 'dropped_submission'` is yielded, and the final `plan:complete` is emitted.
5. **Regression:** Existing max-turns retry test continues to pass — the shared branch must still engage on `isMaxTurnsError`.
6. **Non-regression on cost/duration** for backends that don't drop the tool call (claude-sdk-4-7, pi-anthropic-4-7): the first-attempt path is unchanged, so tokens/duration should be within noise.
