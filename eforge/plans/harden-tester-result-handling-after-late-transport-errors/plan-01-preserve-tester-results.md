---
id: plan-01-preserve-tester-results
name: Preserve Tester Results After Late Transport Errors
branch: harden-tester-result-handling-after-late-transport-errors/plan-01-preserve-tester-results
---

# Preserve Tester Results After Late Transport Errors

## Architecture Context

`runTester` in `packages/engine/src/agents/tester.ts` owns tester output collection, parses `<test-issues>` plus `<test-summary>`, and emits `plan:build:test:complete`. `testStageInner` in `packages/engine/src/pipeline/stages/build-stages.ts` maps `plan:build:test:complete.productionIssues` into `ctx.reviewIssues`; `test-cycle` then invokes the evaluator only when those review issues exist. The final dirty-worktree guard in `packages/engine/src/pipeline/runners.ts` is the fail-closed safety net and is not the bug source.

The gap is isolated to `runTester`: it only accumulates `agent:message.content`, parses after normal harness completion, and drops already-yielded tester XML when the harness later throws a non-abort transport/backend error.

## Implementation

### Overview

Update tester output collection so `agent:result.resultText` participates in the same parse buffer as streamed messages, and parse that buffer after both normal completion and caught non-abort errors. Add a regression test that models a harness yielding `agent:result.resultText` with complete tester XML and then throwing `Error('Backend error: WebSocket error')`.

### Key Decisions

1. Keep tester failures non-fatal: only `AbortError` is rethrown. Non-abort errors still end with `plan:build:test:complete`.
2. Preserve parsed output over transport failure: if complete tester XML was accumulated before the error, the complete event carries parsed counts and issues instead of zero defaults.
3. Avoid duplicate parsing: if `agent:result.resultText` duplicates already-streamed text, do not append it a second time.
4. Do not edit the dirty-worktree guard or `test-cycle` issue mapping; the fix is in tester result handling.

## Scope

### In Scope

- Include `agent:result.resultText` in `runTester`'s parser input.
- Parse accumulated tester XML after non-abort tester errors.
- Preserve the existing zero-count complete event for a tester error with no accumulated output.
- Add a test helper path that can yield `agent:result` and then throw a late error.
- Add regression coverage in `test/tester-wiring.test.ts` for the late transport-error case.

### Out of Scope

- Changes to `packages/engine/src/pipeline/runners.ts` dirty-worktree guard behavior.
- Changes to `packages/engine/src/pipeline/stages/build-stages.ts` `ctx.reviewIssues` mapping.
- Tester retry policy registration in `DEFAULT_RETRY_POLICIES`.
- Broad retry policy design for tester agents.
- Recovery sidecar root-cause reporting changes.

## Files

### Create

- None.

### Modify

- `packages/engine/src/agents/tester.ts` — collect `agent:result.resultText` without duplicating streamed output, keep the parse buffer available after caught non-abort errors, parse that buffer before emitting `plan:build:test:complete`, and optionally emit an `agent:warning` for a swallowed late tester error after output exists.
- `test/stub-harness.ts` — add a narrowly scoped scripted response option such as `lateError?: Error` / `errorAfterResult?: Error` that throws after `agent:result` emission so tests can model backend errors that arrive after a final result.
- `test/tester-wiring.test.ts` — add regression tests for resultText-only tester XML followed by `Backend error: WebSocket error`, and keep/assert the no-output hard-error zero fallback.

## Implementation Notes

- In `runTester`, declare the tester parse buffer outside the `try` block so the `catch` path can still inspect text accumulated before the throw.
- Keep `agent:message` accumulation as-is for streaming text.
- Add result-text accumulation in the event loop, following the evaluator precedent in `packages/engine/src/agents/builder.ts`, with duplicate protection. A helper can use this ordering:
  1. Empty existing buffer -> return `resultText`.
  2. Existing buffer already contains `resultText` -> return existing buffer.
  3. `resultText` contains existing buffer -> return `resultText`.
  4. Otherwise append `resultText`.
- Parse the buffer once after the `try`/`catch` using existing `parseTestIssues` and `parseTestSummary` semantics. Empty or unparsable buffers still produce zero counts and no production issues.
- For the late error regression, configure the harness with no `text`, a `resultText` containing one `<test-issues>` block and one `<test-summary passed="6769" failed="0" test_bugs_fixed="0">`, then throw `Error('Backend error: WebSocket error')` after `agent:result`.
- The regression issue XML must include at least the observed file paths `packages/monitor/src/http/response.ts` and `packages/monitor/src/streams/sse.ts` so the assertion proves production issues survive.

## Verification

- [ ] A `runTester` regression test with `resultText` plus late `Error('Backend error: WebSocket error')` emits `plan:build:test:complete.passed === 6769`.
- [ ] The same regression test emits `failed === 0` and `testBugsFixed === 0`.
- [ ] The same regression test emits two `productionIssues` with files `packages/monitor/src/http/response.ts` and `packages/monitor/src/streams/sse.ts`.
- [ ] A tester error before any `agent:message` or `agent:result.resultText` still emits `passed === 0`, `failed === 0`, `testBugsFixed === 0`, and `productionIssues === []`.
- [ ] When the same tester XML appears in both `text` and `resultText`, the complete event contains one parsed issue, not two.
- [ ] `git diff -- packages/engine/src/pipeline/stages/build-stages.ts packages/engine/src/pipeline/runners.ts` produces empty output.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run test/tester-wiring.test.ts` exits 0.
- [ ] `pnpm test` exits 0.
