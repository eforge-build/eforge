---
title: Harden tester result handling after late transport errors
created: 2026-06-01
---

# Harden tester result handling after late transport errors

## Problem / Motivation

Backlog source: `.eforge/backlog/items/backlog-2026-06-01-harden-tester-result-handling-after-late-transport-errors.md`.

Roadmap alignment: this directly supports `docs/roadmap.md` under **Kernel Resilience and Typed Recovery**, especially typed recovery paths and honest gates.

The tester agent can produce a valid `<test-issues>` block and `<test-summary>` and then encounter a late retryable transport/backend error. In that path, eforge currently loses the already-produced tester result and emits `plan:build:test:complete` with zero counts and no `productionIssues`.

The goal is to keep the dirty-worktree invariant strict while preventing tester transport failures from erasing already-produced test findings.

Why it matters:

- `test-cycle` uses `productionIssues` to decide whether to run evaluator.
- Dropping `productionIssues` causes evaluator to be skipped even when the tester intentionally left production fixes unstaged.
- The final dirty-worktree guard then fails the plan, which is correct as a guard but misleading as a root cause.
- In the observed expedition, this blocked dependent plans and failed the overall build.

Validated evidence from the failed run `migrate-monitor-server-to-a-maintainable-architecture` in `.eforge/monitor.db`:

- `plan-05-stream-hub` tester emitted an `agent:result` containing `<test-issues>` for `packages/monitor/src/http/response.ts` and `packages/monitor/src/streams/sse.ts`, plus `<test-summary passed="6769" failed="0" test_bugs_fixed="0">`.
- The same tester attempt then emitted `agent:stop` with `Backend error: WebSocket error`.
- eforge emitted `plan:build:test:complete` with `passed: 0`, `failed: 0`, `testBugsFixed: 0`, and `productionIssues: []`.
- The plan then failed via the final dirty-worktree guard with two uncommitted files: `packages/monitor/src/http/response.ts` and `packages/monitor/src/streams/sse.ts`.

Evidence:

- Backlog item: `.eforge/backlog/items/backlog-2026-06-01-harden-tester-result-handling-after-late-transport-errors.md`.
- Monitor DB events for `migrate-monitor-server-to-a-maintainable-architecture` show `plan-05-stream-hub` tester `agent:result` contained two production issues and `passed="6769" failed="0"`, followed by `agent:stop.error = Backend error: WebSocket error`, followed by `plan:build:test:complete` with zero counts and empty `productionIssues`.
- `packages/engine/src/agents/tester.ts` currently parses only after normal harness completion and swallows non-abort errors.

Confirmed historical reproduction from persisted run data:

1. Run an eforge build with a plan that reaches `test-cycle`.
2. Have the tester produce an `agent:result.resultText` containing a valid `<test-issues>` block and a valid `<test-summary>` block.
3. Have the harness emit or throw a late backend transport error after that result, such as `Backend error: WebSocket error`.
4. Observe that eforge emits `plan:build:test:complete` with `passed: 0`, `failed: 0`, `testBugsFixed: 0`, and `productionIssues: []` instead of the parsed tester result.
5. Observe that `test-cycle` skips evaluator because `ctx.reviewIssues` stays empty.
6. If the tester left production fixes unstaged, observe the final dirty-worktree guard failing the plan.

Concrete observed case:

- Run: `e4bc9c1c-62d8-4807-9c98-4d52b25ceeb9`.
- Plan: `plan-05-stream-hub`.
- Tester result text included production issues for `packages/monitor/src/http/response.ts` and `packages/monitor/src/streams/sse.ts`.
- Tester stop error was `Backend error: WebSocket error`.
- Final plan failure was `Plan pipeline completed with 2 uncommitted file(s) in the worktree`.

## Goal

Preserve tester-produced `<test-issues>` and `<test-summary>` output when a late non-abort transport/backend error occurs after an authoritative tester result. Keep hard tester failures with no usable output non-fatal and keep the final dirty-worktree guard strict.

## Approach

Relevant code inspected:

- `packages/engine/src/agents/tester.ts` accumulates `fullText` only from `agent:message`, parses `<test-issues>` and `<test-summary>` only after the harness loop completes normally, and swallows non-abort errors by emitting a zero-count `plan:build:test:complete`.
- `packages/engine/src/pipeline/stages/build-stages.ts` maps `plan:build:test:complete.productionIssues` into `ctx.reviewIssues`; the `test-cycle` evaluates only when `ctx.reviewIssues.length > 0`.
- `packages/engine/src/pipeline/runners.ts` correctly fails dirty worktrees at the end of a plan pipeline. This guard should remain strict.
- `packages/engine/src/agents/builder.ts` already contains a useful precedent: builder/evaluator code observes `agent:result.resultText`, and builder downgrades late transient errors after an authoritative committed result.
- `test/tester-wiring.test.ts` currently asserts the existing fallback behavior for a hard tester error with no output: complete event with zeroed counts and no production issues.
- `test/stub-harness.ts` supports `resultText`, but existing tester tests only cover normal text and immediate hard error cases.

Confirmed root cause in engine code:

- `packages/engine/src/agents/tester.ts` accumulates tester output only from `agent:message` events.
- `packages/engine/src/agents/tester.ts` parses `<test-issues>` and `<test-summary>` only after the harness async iterator exits normally.
- When the harness throws a non-abort error after yielding an authoritative tester result, control jumps to `catch`, the accumulated output is not parsed, and the code emits the default zero-count `plan:build:test:complete`.
- The catch block intentionally treats tester failures as non-fatal, but it currently conflates "tester produced no usable result" with "tester produced a usable result and then transport failed".
- `packages/engine/src/pipeline/stages/build-stages.ts` then overwrites `ctx.reviewIssues` from the empty `productionIssues` array.
- `test-cycle` breaks before evaluator because `ctx.reviewIssues.length === 0`.
- `packages/engine/src/pipeline/runners.ts` final dirty-worktree guard fails because the tester's production fixes remain unstaged and unevaluated.

Design direction:

- Preserve the dirty-worktree guard unchanged.
- Update tester result collection so `agent:result.resultText` contributes to the text parsed for tester XML, matching patterns already used by evaluator code in `packages/engine/src/agents/builder.ts`.
- Ensure `runTester` parses any accumulated authoritative tester XML even when a non-abort error occurs after output was produced.
- Keep the existing behavior for hard tester failures with no usable output: emit a non-fatal `plan:build:test:complete` with zero counts and no production issues.
- Emit an observable warning for swallowed tester errors when useful, but do not let a late retryable transport error erase parsed tester findings.

Fast unit reproduction target:

- Add a harness/test helper in `test/tester-wiring.test.ts` or adjacent test code that yields `agent:start`, yields `agent:result` with `result.resultText` containing tester XML, then throws `Error('Backend error: WebSocket error')` or emits `agent:stop` with that error in a way matching current harness behavior.
- Collect `runTester(...)` events and assert that the final `plan:build:test:complete` preserves the parsed `passed`, `failed`, `testBugsFixed`, and `productionIssues` values.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `runTester` is the primary fix target for preserving tester findings. | Read `packages/engine/src/agents/tester.ts`; it owns tester output accumulation and emits `plan:build:test:complete`. Read `packages/engine/src/pipeline/stages/build-stages.ts`; it consumes only that complete event to set `ctx.reviewIssues`. | high | low | Add a unit regression around `runTester`; optionally add a stage-level test if implementation finds existing harness support. | If wrong, production issues may still be lost before evaluator. |
| A late `Backend error: WebSocket error` is a retryable transient transport class in current eforge terminology. | Read `packages/engine/src/harness.ts`; `isTransientTransportError` returns true for messages containing `backend error: websocket error`, and `classifyAgentTerminalSubtype` maps it to `error_transient_transport`. Existing `test/pi-transport-resilience.test.ts` covers this classification. | high | low | Run the existing transport resilience test or add no new test because classifier is already covered. | If wrong, warning/retry labels could be inaccurate, but parsing accumulated tester output should still preserve the result. |
| Parsing accumulated tester XML after a caught non-abort error is safe only when the output contains a complete `<test-summary>` and `<test-issues>` block. | Read parser behavior in `packages/engine/src/agents/common.ts` and `packages/engine/src/agents/tester.ts`; missing blocks parse to empty/zero values today. The planned acceptance criteria preserves zero-count behavior for no-output errors. | medium | low | Add tests for post-result transport error and pre-output hard error. Consider a partial-output test if implementation changes parsing semantics. | If wrong, partial or stale tester text could be treated as authoritative. |
| The dirty-worktree guard should not be weakened. | Read `packages/engine/src/pipeline/runners.ts`; the guard prevents silent no-op merges when implementation work is uncommitted. The observed failure shows the guard caught the downstream symptom, not that the guard is wrong. | high | low | Do not edit guard logic except if tests require import changes; retain acceptance criterion for fail-closed behavior. | If wrong, eforge could hide uncommitted implementation work. |
| Recovery sidecar root-cause reporting can be out of scope for this bugfix. | The immediate failure can be fixed in tester result handling. The backlog evidence notes recovery sidecar obscured the root dependency, but that is a reporting improvement rather than the mechanism that caused dirty-worktree failure. | medium | medium | If time permits, inspect recovery summarization and add a follow-up backlog item or separate PRD. | If wrong, future failures may still be harder to diagnose even after tester handling is fixed. |

No low-confidence/high-impact assumption remains unresolved. The highest-impact assumptions were validated by reading the relevant engine code and persisted run evidence.

## Scope

Classification: this is a **bugfix / focused** change. Confidence: high. Override if needed.

In scope:

- Preserve tester findings from `agent:result.resultText`.
- Parse accumulated authoritative tester XML after late non-abort tester errors.
- Preserve existing zero-count `plan:build:test:complete` behavior for hard tester failures with no usable output.
- Add regression coverage for the late tester transport-error case in `test/tester-wiring.test.ts` or an equivalent engine test file.
- Potentially touch `packages/engine/src/agents/tester.ts`, `test/tester-wiring.test.ts`, and a small helper/test harness.

Out of scope:

- Weakening the dirty-worktree guard in `packages/engine/src/pipeline/runners.ts`.
- Adding tester retry policy registration to `DEFAULT_RETRY_POLICIES`.
- Implementing a broader tester retry policy.
- Improving recovery sidecar root-cause reporting unless the implementation naturally touches recovery summarization.
- Delegated module planning or an expedition.

Related but out of immediate root cause:

- Retry policy registration for `tester` is absent from `DEFAULT_RETRY_POLICIES`; that is acceptable if the fix preserves authoritative post-result output. A broader tester retry policy may be useful later but is not required for this bug.
- Recovery sidecar reporting identified the blocked downstream plan rather than the root failed dependency. That can be improved separately unless the implementation naturally touches recovery summarization.

Recommended profile: **Excursion**.

Rationale: this is a cohesive engine bugfix with a clear root cause and regression test target. It may touch multiple files (`packages/engine/src/agents/tester.ts`, `test/tester-wiring.test.ts`, and possibly a small helper/test harness), but it does not require delegated module planning or an expedition. It is larger than an errand because it affects agent-result semantics and must preserve existing tester failure behavior.

## Acceptance Criteria

- `runTester` includes `agent:result.resultText` in the text used to parse `<test-issues>`.
- `runTester` includes `agent:result.resultText` in the text used to parse `<test-summary>`.
- `runTester` does not duplicate parsed content when the same tester XML appears in both `agent:message.content` and `agent:result.resultText`.
- When the tester harness yields `agent:result.resultText` containing one valid `<test-issues>` block and one valid `<test-summary>` block and then throws `Error('Backend error: WebSocket error')`, `runTester` emits `plan:build:test:complete.passed` with the parsed `passed` count from the summary.
- When the tester harness yields `agent:result.resultText` containing one valid `<test-issues>` block and one valid `<test-summary>` block and then throws `Error('Backend error: WebSocket error')`, `runTester` emits `plan:build:test:complete.failed` with the parsed `failed` count from the summary.
- When the tester harness yields `agent:result.resultText` containing one valid `<test-issues>` block and one valid `<test-summary>` block and then throws `Error('Backend error: WebSocket error')`, `runTester` emits `plan:build:test:complete.testBugsFixed` with the parsed `testBugsFixed` count from the summary.
- When the tester harness yields `agent:result.resultText` containing one valid `<test-issues>` block and one valid `<test-summary>` block and then throws `Error('Backend error: WebSocket error')`, `runTester` emits `plan:build:test:complete.productionIssues` with the parsed issue fields from the tester XML.
- When the tester harness throws before producing any `agent:message` or `agent:result.resultText`, `runTester` emits a `plan:build:test:complete` event.
- When the tester harness throws before producing any `agent:message` or `agent:result.resultText`, `plan:build:test:complete.passed` is `0`.
- When the tester harness throws before producing any `agent:message` or `agent:result.resultText`, `plan:build:test:complete.failed` is `0`.
- When the tester harness throws before producing any `agent:message` or `agent:result.resultText`, `plan:build:test:complete.testBugsFixed` is `0`.
- When the tester harness throws before producing any `agent:message` or `agent:result.resultText`, `plan:build:test:complete.productionIssues` is `[]`.
- `test-cycle` continues to populate `ctx.reviewIssues` from `plan:build:test:complete.productionIssues`.
- The final dirty-worktree guard in `packages/engine/src/pipeline/runners.ts` remains fail-closed for uncommitted files at the end of a plan pipeline.
- A regression test in `test/tester-wiring.test.ts` or an equivalent engine test file covers the late tester transport-error case.
- `pnpm vitest run test/tester-wiring.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
