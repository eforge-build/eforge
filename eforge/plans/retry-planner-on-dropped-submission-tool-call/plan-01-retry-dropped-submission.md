---
id: plan-01-retry-dropped-submission
name: Retry planner on dropped submission tool call
depends_on: []
branch: retry-planner-on-dropped-submission-tool-call/retry-dropped-submission
---

# Retry planner on dropped submission tool call

## Architecture Context

The planner agent (`packages/engine/src/agents/planner.ts`) runs inside a continuation loop in `pipeline.ts` (lines 822-945). The loop already retries on `AgentTerminalError` subtype `error_max_turns` via `isMaxTurnsError()` — it catches the thrown error, commits any partial plan artifacts as a checkpoint, yields a `plan:continuation` event, and restarts with a `continuationContext` baked into the prompt. The loop budget is sourced from `AGENT_MAX_CONTINUATIONS_DEFAULTS['planner']` (currently 2).

A second planner failure mode — the agent completes without ever calling `submit_plan_set` / `submit_architecture` and without emitting `<skip>` — exists but does NOT reach the catch block. Instead, `runPlanner` *yields* a terminal `plan:error` event and returns (planner.ts:349-353). The stream terminates cleanly, the `try` block finishes, and the continuation loop exits via `break`.

Eval data (`pi-qwen-3-6` on `todo-api-errand-health-check`, 10 runs, 2/10 dropped-submission failures) shows this is a structured-tool-use reliability gap, not a reasoning failure. Routing it into the existing retry path turns a 20%-per-attempt dropout into a 0.8% worst-case pipeline failure while leaving the first-attempt path untouched for well-behaved backends (claude-sdk-4-7, pi-anthropic-4-7).

The existing `commitPlanArtifacts` helper (pipeline.ts:2105-2117) already no-ops safely when the plan directory does not exist (`if (!existsSync(planDir)) return`) and when nothing is staged, so the retry path can call it unconditionally on a dropped-submission retry where no plan files were written yet.

## Implementation

### Overview

Replace the yielded terminal `plan:error` with a thrown `PlannerSubmissionError`, then extend the existing retry catch in `pipeline.ts` with a sibling guard `isPlannerSubmissionError`. Extend `continuationContext` with a `reason: 'max_turns' | 'dropped_submission'` discriminator and branch the retry prompt text so the model is told specifically why it is retrying. Extend the `plan:continuation` event type with an optional `reason` field so consumers (CLI display, monitor) see the cause. Share the existing `maxContinuations = 2` budget between the two failure modes.

### Key Decisions

1. **Co-locate `PlannerSubmissionError` with `AgentTerminalError` in `backend.ts`.** `AgentTerminalError` and `isMaxTurnsError` already live there. Putting `PlannerSubmissionError` and `isPlannerSubmissionError` next to them keeps the "terminal error types plus type guards" surface in one module. The class is a plain `Error` subclass (not an `AgentTerminalSubtype`) because the failure is engine-level, not SDK-level — it's eforge detecting that the agent stream ended without a required tool call, not the SDK reporting a structural failure.

2. **Keep the error message string identical to the pre-existing `plan:error` reason** so log greps continue to work: `Planner agent completed without calling a submission tool (${injectedNames}) or emitting <skip>`.

3. **Remove the `plan:error` yield from the success path entirely.** The new terminal is always thrown; the `plan:error` *event type* stays in `events.ts` (and in `display.ts` case handling) so future callers can still emit it if needed, but the planner no longer produces it. Three existing tests assert on this event and must be updated to assert on a thrown `PlannerSubmissionError` instead.

4. **Shared retry budget.** No new `AGENT_MAX_SUBMISSION_RETRIES_DEFAULTS`. Either failure mode indicates the model is struggling; the cheap extra attempts are bounded either way. If evidence later shows the budgets want to diverge, a separate knob is cheap to add.

5. **Thread `reason` via `continuationContext`, not via a separate parameter.** The prompt-building code already reads `continuationContext`, and the retry loop already constructs it. Adding a `reason` field is the minimum-surface-area change and keeps the data flow localized. For `dropped_submission` the `existingPlans` summary is suppressed in the prompt (nothing was written), but the `continuationContext` shape stays uniform.

6. **No changes to `plan:error` event shape or the `display.ts` case for it.** It becomes dead in the planner path but is preserved as a valid event type for forward compatibility.

## Scope

### In Scope

- Add `PlannerSubmissionError` class and `isPlannerSubmissionError` type guard to `packages/engine/src/backend.ts`.
- Replace the terminal `yield { type: 'plan:error', ... }` in `packages/engine/src/agents/planner.ts` with a `throw new PlannerSubmissionError(...)`; keep the message text identical.
- Extend `PlannerOptions.continuationContext` in `planner.ts` with an optional `reason: 'max_turns' | 'dropped_submission'` field.
- Branch the `continuationContextText` construction in `buildPrompt()` (`planner.ts` lines 171-182) so `dropped_submission` produces a retry prompt that says: "The previous attempt completed reasoning but did not call ${submitTool}. You MUST call ${submitTool} with your final plan set to complete this run — reasoning alone does not submit plans." and omits the existing-plans list. `max_turns` keeps the current wording + existing-plans list.
- Extend the `plan:continuation` variant of the `EforgeEvent` union in `packages/engine/src/events.ts` with an optional `reason?: 'max_turns' | 'dropped_submission'` field.
- In `packages/engine/src/pipeline.ts`:
  - Import `isPlannerSubmissionError` from `./backend.js`.
  - Extend the catch block at lines 926-944 to treat `isPlannerSubmissionError(err)` as a retryable error alongside `isMaxTurnsError(err)`. Yield `plan:continuation` with `reason: isPlannerSubmissionError(err) ? 'dropped_submission' : 'max_turns'`.
  - Persist the retry reason in a loop-scoped variable set in `catch` and consumed by the next iteration's `continuationContext` construction (lines 828-852). On `dropped_submission` retries the `existingPlans` field is set to `'[No existing plans — previous attempt did not submit]'` (since no files were written); the `reason` field is always populated when `attempt > 0`.
  - Keep the existing `commitPlanArtifacts` call on both retry branches — it already no-ops when the plan directory is empty, so the dropped-submission case is safe.
- Update tests whose assertions depend on the removed `plan:error` yield:
  - `test/planner-submission.test.ts` — the `yields plan:error when neither submission nor skip occurs` test (lines 128-141) must assert that `runPlanner` rejects with `PlannerSubmissionError` (message match on `Planner agent completed without calling a submission tool`).
  - `test/agent-wiring.test.ts` — three tests (lines 34-35, 140-141, 164-165, 286-296) assert `findEvent(events, 'plan:error')`; rewrite each to `await expect(collectEvents(...)).rejects.toThrow(PlannerSubmissionError)` (or instance check), and for the `reports backend-visible names` case, assert the thrown error's `.message` contains the expected backend-visible names.
- Add new unit test in `test/planner-submission.test.ts`:
  - Simulate a `StubBackend` response that ends without `submit_plan_set`, `submit_architecture`, or a `<skip>` block; assert that `collectEvents(runPlanner(...))` rejects with a `PlannerSubmissionError` whose message matches the expected text.
- Add new integration test in `test/planner-continuation.test.ts`:
  - Construct a `StubBackend` whose queue is `[{ error: new PlannerSubmissionError('...') }, { toolCalls: [{ tool: 'submit_plan_set', ... valid payload ... }] }]`.
  - Drive `runPlanner` twice manually? No — the continuation loop lives in `pipeline.ts`, not in `runPlanner`. The correct integration surface is the `plannerCompileStage` inside `pipeline.ts`. Since that stage is not directly exported as a standalone function, the test exercises it indirectly: it creates a minimal pipeline context, runs the stage, and asserts that two planner spans are recorded via a stub tracer, a `plan:continuation` event with `reason: 'dropped_submission'` is yielded, and a `plan:complete` event follows. If a minimal pipeline driver is not practical within the existing test plumbing, fall back to unit-testing the catch-block reason mapping by extracting the reason calculation into a tiny internal helper (e.g. `continuationReasonForError(err)`) and testing that plus a `runPlanner`-level test that the second invocation succeeds with a prompt containing the dropped-submission retry wording.
  - Add a regression test confirming the existing max-turns retry continues to yield `reason: 'max_turns'` (or an absent/default reason) — proves the shared branch still engages on `isMaxTurnsError`.

### Out of Scope

- New config knobs; separate `AGENT_MAX_SUBMISSION_RETRIES_DEFAULTS` budget.
- Changes to backends (claude-sdk, pi-anthropic, pi-qwen) — first-attempt path is unchanged.
- Removing the `plan:error` event type from the union or from `display.ts`.
- Changes to the planner prompt template file itself (`packages/engine/prompts/planner.md` or equivalent) — the fix threads a different value into the existing `continuation_context` placeholder.
- Running the live eval (`pi-qwen-3-6` x10) — that's a post-merge validation step, not a plan task.

## Files

### Create

- (none) — all changes extend existing files.

### Modify

- `packages/engine/src/backend.ts` — add `PlannerSubmissionError extends Error` class and `isPlannerSubmissionError(err): err is PlannerSubmissionError` type guard; place them immediately after `isMaxTurnsError` (around line 216) so they share the "typed terminal errors" section. Export both.
- `packages/engine/src/agents/planner.ts`
  - Line 5: import `PlannerSubmissionError` from `../backend.js` (add to existing import).
  - Line 23: extend `continuationContext` type: `{ attempt: number; maxContinuations: number; existingPlans: string; reason: 'max_turns' | 'dropped_submission' }` (make `reason` required to keep the discriminator explicit at call sites; callers already construct this fresh per attempt).
  - Lines 171-182: branch `continuationContextText` on `reason`. `max_turns` branch keeps the existing wording + existing-plans list. `dropped_submission` branch emits the submission-focused wording (see scope) and omits the existing-plans list. Both branches use `submitTool` resolved below.
  - Lines 343-353: delete the `yield { type: 'plan:error', ... }` block and replace with `throw new PlannerSubmissionError(`Planner agent completed without calling a submission tool (${injectedNames}) or emitting <skip>`);`. Keep the `injectedNames` derivation line intact so the message text matches the pre-existing reason string exactly.
- `packages/engine/src/events.ts` (line 159): extend the `plan:continuation` variant with `reason?: 'max_turns' | 'dropped_submission'`.
- `packages/engine/src/pipeline.ts`
  - Line 31: extend import to pull in `isPlannerSubmissionError` from `./backend.js`.
  - Lines 822-945 (planner continuation loop): add a loop-scoped `let lastRetryReason: 'max_turns' | 'dropped_submission' | undefined;` before the `for` loop. In the `attempt > 0` branch that builds `continuationContext` (lines 828-852), set `reason: lastRetryReason ?? 'max_turns'` on the constructed object (the `??` fallback handles the theoretical case where `attempt > 0` is reached without a prior error, which should never happen but keeps TypeScript happy without a `!`). On `dropped_submission` retries, set `existingPlans = '[No existing plans — previous attempt did not submit]'` rather than scanning the plan directory (which will be empty). In the catch block (lines 926-944), compute `const retryReason: 'max_turns' | 'dropped_submission' | null = isMaxTurnsError(err) ? 'max_turns' : isPlannerSubmissionError(err) ? 'dropped_submission' : null;`, then `if (retryReason && attempt < maxContinuations) { ... lastRetryReason = retryReason; yield { ..., type: 'plan:continuation', attempt: attempt + 1, maxContinuations, reason: retryReason }; continue; }`. Keep the `await commitPlanArtifacts(...)` call inside this retryable branch — it no-ops safely on an empty plan directory.
- `test/planner-submission.test.ts` — rewrite the `yields plan:error when neither submission nor skip occurs` test (around line 128) to assert `await expect(collectEvents(runPlanner(...))).rejects.toThrow(PlannerSubmissionError)` and that the thrown error's message contains the expected substring. Add an import for `PlannerSubmissionError`. Remove assertions that filter for `plan:error` events in the lines 139-141 and 341 regions, replacing them with the rejection-based assertion pattern.
- `test/agent-wiring.test.ts` — for the three sites (lines 34-35, 140-141, 164-165) that use `findEvent(events, 'plan:error')`, rewrite each `it(...)` to await a rejection and assert on the thrown error instance and message. For the `reports backend-visible names in plan:error when no submission tool was called` test (lines 286-296), rename the `it` description to reflect the new thrown-error behavior and assert that the rejected error's `.message` contains the backend-visible names. Add any needed imports.
- `test/planner-continuation.test.ts`
  - Extend the `plan:continuation event type` describe (around line 64) with a second case verifying that `reason: 'dropped_submission'` is accepted by the discriminated union.
  - Add a new describe block `runPlanner throws PlannerSubmissionError on dropped submission` that uses `StubBackend` with a response containing no submission tool call and no skip, then asserts `collectEvents(runPlanner(...))` rejects with `PlannerSubmissionError`.
  - Add a new describe block `continuationContext threads reason into prompt` with two cases: (a) `reason: 'dropped_submission'` produces a prompt containing the submission-focused wording and NOT the existing-plans list, (b) `reason: 'max_turns'` produces the existing prompt containing the existing-plans list.

## Verification

- [ ] `PlannerSubmissionError` is exported from `packages/engine/src/backend.ts` and is a subclass of `Error` with `name === 'PlannerSubmissionError'`.
- [ ] `isPlannerSubmissionError(new PlannerSubmissionError('x'))` returns `true`; `isPlannerSubmissionError(new AgentTerminalError('error_max_turns', 'y'))` returns `false`; `isPlannerSubmissionError(new Error('z'))` returns `false`.
- [ ] Running `runPlanner` against a `StubBackend` that ends without calling a submission tool and without emitting `<skip>` causes the returned async iterator to reject with a `PlannerSubmissionError`; the `.message` equals `Planner agent completed without calling a submission tool (<injectedNames>) or emitting <skip>` where `<injectedNames>` matches the pre-existing wording.
- [ ] `runPlanner` no longer yields any event of type `plan:error` under any input; assert `events.filter(e => e.type === 'plan:error').length === 0` in all updated planner tests.
- [ ] With `options.continuationContext = { attempt: 1, maxContinuations: 2, existingPlans: '...', reason: 'dropped_submission' }`, the prompt sent to the backend contains the literal substring `did not call` and the literal substring `MUST call`, and does NOT contain `hit the max turns limit` nor the `existingPlans` string.
- [ ] With `options.continuationContext = { ..., reason: 'max_turns' }`, the prompt contains `hit the max turns limit` and the `existingPlans` string, matching the pre-existing wording byte-for-byte.
- [ ] In `pipeline.ts`, when `runPlanner` throws `PlannerSubmissionError` on attempt 0 and succeeds on attempt 1, the stream yields exactly one `plan:continuation` event with `attempt === 1` and `reason === 'dropped_submission'`, followed by one `plan:complete` event; no `plan:error` event is yielded.
- [ ] In `pipeline.ts`, when `runPlanner` throws `AgentTerminalError('error_max_turns', ...)` on attempt 0 and succeeds on attempt 1, the stream yields exactly one `plan:continuation` event with `attempt === 1` and `reason === 'max_turns'`, followed by one `plan:complete` event (regression for existing behavior).
- [ ] In `pipeline.ts`, when `runPlanner` throws `PlannerSubmissionError` on every attempt up to and including `attempt === maxContinuations`, the final throw re-propagates (`.rejects.toThrow(PlannerSubmissionError)`) and exactly `maxContinuations` `plan:continuation` events were yielded before the throw.
- [ ] `commitPlanArtifacts` is called on the dropped-submission retry path and does not throw when the plan directory does not exist (covered by its existing `existsSync` guard at line 2110).
- [ ] All pre-existing tests that previously asserted `findEvent(events, 'plan:error')` now assert rejection with `PlannerSubmissionError`; the test file compiles and passes.
- [ ] `pnpm type-check` passes with zero errors.
- [ ] `pnpm test` passes with zero failures.
- [ ] `pnpm build` completes with zero errors.
