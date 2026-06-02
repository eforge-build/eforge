---
id: plan-01-reviewer-late-transport-recovery
name: Reviewer Late Transport Recovery
branch: generalize-late-transient-transport-recovery-across-agent-roles/plan-01-reviewer-late-transport-recovery
---

# Reviewer Late Transport Recovery

## Architecture Context

The Pi harness can emit an `agent:result` event with final text and then throw an `AgentTerminalError` when a backend transport error arrives late. Tester and evaluator paths already preserve role-specific terminal evidence in this situation. Build review still parses only streamed `agent:message` content after the harness loop finishes, so a post-result transient error prevents parsing and lets `reviewStageInner()` synthesize a timeout-only `review-contract` issue.

This plan keeps reviewer recovery role-specific: a strict, parseable `<review-issues>` terminal block is the only checkpoint that authorizes downgrading a late retryable infrastructure error. Missing, malformed, duplicated, or pre-result reviewer output remains fail-closed.

## Implementation

### Overview

Update the single reviewer and per-perspective parallel reviewer paths to merge `agent:result.resultText` into the parse buffer, parse strict reviewer XML when a harness error is thrown, and downgrade only retryable transport/infrastructure errors after strict parser success. Emit an `agent:warning` when such a downgrade happens and still emit the parsed `plan:build:review:complete` event. Leave `reviewStageInner()` synthetic fallback and worktree drift detection in place.

### Key Decisions

1. Treat `parseReviewIssuesStrict(fullText).valid === true` as the reviewer checkpoint; an emitted `agent:result` event alone is not enough.
2. Reuse `classifyAgentTerminalSubtype()` plus the existing retryable infrastructure subtype helper instead of adding backend-error string matching.
3. Use a duplicate-avoidance merge helper for reviewer `resultText` so streaming text and final text do not create duplicate `<review-issues>` blocks.
4. Use the existing `agent:warning` event shape with a stable reviewer code such as `reviewer-late-infrastructure-error-downgraded`; do not change client schemas or daemon API versioning.
5. Keep perspective failures isolated: one perspective with parseable output survives its own late retryable error, while another perspective that fails before parseable output still contributes a synthetic critical `review-contract` issue.

### Detailed Steps

1. In `packages/engine/src/agents/reviewer.ts`:
   - Import `classifyAgentTerminalSubtype()` and the existing retryable infrastructure subtype predicate.
   - Add/export a small merge helper for reviewer final text, matching the tester pattern: empty-buffer replacement, `includes()` duplicate checks both directions, then concatenation.
   - Track the reviewer `agentId` from `agent:start` and `agent:result` when available.
   - Append streamed `agent:message.content` as today.
   - Merge `agent:result.resultText` into the same `fullText` buffer.
   - Wrap the harness loop in `try/catch`.
   - On catch, classify the error and parse the buffered text with `parseReviewIssuesStrict()`.
   - If the subtype is retryable infrastructure and the parse result is valid, emit `agent:warning` for the reviewer and then emit `plan:build:review:complete` with the parsed issues.
   - Otherwise rethrow so callers keep the existing fail-closed synthetic fallback for pre-result or invalid-output failures.
   - On normal completion, keep emitting `plan:build:review:complete` from `parseReviewIssuesStrict(fullText)`.

2. In `packages/engine/src/agents/parallel-reviewer.ts`:
   - Import the reviewer merge helper and the same classification/predicate helpers.
   - Apply the merge helper to both built-in perspective reviewers and extension perspective reviewers when `agent:result.resultText` appears.
   - Track a perspective reviewer `agentId` from agent lifecycle events.
   - In each perspective `catch`, parse the buffered output.
   - If the error subtype is retryable infrastructure and the parse result is valid, push the parsed issues into `allIssues`, emit a reviewer `agent:warning` that names the perspective in the message, emit `plan:build:review:parallel:perspective:complete` with the parsed issues, and return without adding a synthetic contract issue.
   - If the parse result is invalid or no parseable text exists, keep the existing synthetic critical `review-contract` issue and `plan:build:review:parallel:perspective:error` event.
   - Preserve the single-reviewer delegation branches; they inherit the fixed `runReview()` behavior.

3. Do not change `packages/engine/src/pipeline/stages/build-stages.ts` unless a regression test shows that an already-emitted review complete event is still overwritten. The expected result is that `runParallelReview()` emits a complete event for late-result-safe reviewer errors, so `reviewStageInner()` never enters its catch fallback for those cases. Existing drift detection must still append reviewer mutation contract issues.

4. Add regression tests with `StubHarness.lateError`:
   - Direct `runReview()` tests in `test/agent-wiring.test.ts` for resultText-only parsing, late transient downgrade after valid result text, pre-result transient failure, and late transient failure with invalid reviewer output.
   - `runParallelReview()` tests in `test/parallel-reviewer.test.ts` for single delegation, built-in per-perspective downgrade, extension per-perspective downgrade, and preservation of synthetic contract issues for a different perspective that fails before parseable output.
   - A review-stage regression in `test/reviewer-isolation.test.ts` or `test/build-evaluator-enforcement.test.ts` proving the aggregate review complete event contains the parsed reviewer issue and contains no timeout-only `review-contract` issue after a valid late-result reviewer error.
   - Keep existing tester and evaluator late-error tests passing; do not rewrite those paths.

## Scope

### In Scope

- Reviewer result text buffering from `agent:result.resultText`.
- Late retryable infrastructure downgrade after strict reviewer XML parser success.
- Single reviewer delegation through `runParallelReview()`.
- Built-in and extension per-perspective parallel reviewer paths.
- Synthetic critical issues for pre-output, missing-output, and invalid-output reviewer failures.
- Regression coverage using `StubHarness.lateError` and `AgentTerminalError('error_transient_transport', ...)`.

### Out of Scope

- Harness API changes.
- New backend error string matching.
- Daemon/client wire-shape changes.
- Daemon API version changes.
- Documentation updates unless existing troubleshooting content already enumerates warning codes.
- Changes to builder, review-fixer, tester, or evaluator success semantics beyond keeping existing tests green.

## Files

### Create

- None.

### Modify

- `packages/engine/src/agents/reviewer.ts` — merge `agent:result.resultText`, classify late errors, downgrade only retryable infrastructure errors after strict parser success, and emit the parsed review complete event.
- `packages/engine/src/agents/parallel-reviewer.ts` — apply the same result text and late-error handling to built-in and extension perspective tasks while preserving synthetic errors for perspectives without parseable output.
- `test/agent-wiring.test.ts` — add direct `runReview()` regressions for resultText-only parsing and late/pre-result transient failures.
- `test/parallel-reviewer.test.ts` — add single-delegation and parallel perspective regressions, including one perspective that succeeds after a late error and one that still fails before output.
- `test/reviewer-isolation.test.ts` or `test/build-evaluator-enforcement.test.ts` — add a stage-level regression showing `reviewStageInner()` emits parsed reviewer issues rather than a timeout-only synthetic contract issue when `runParallelReview()` handles the late error.

## Database Migration

Not applicable.

## Verification

- [ ] `runReview()` with `StubHarness([{ resultText: VALID_REVIEW_XML }])` emits one `plan:build:review:complete` event containing the expected parsed issue fields.
- [ ] `runReview()` with valid `resultText` plus `lateError: new AgentTerminalError('error_transient_transport', ...)` emits an `agent:warning` with code `reviewer-late-infrastructure-error-downgraded` and emits parsed reviewer issues.
- [ ] `runReview()` with a pre-result `AgentTerminalError('error_transient_transport', ...)` rethrows the terminal error and emits no review complete event.
- [ ] `runReview()` with malformed or missing `<review-issues>` text plus a late transient terminal error rethrows the terminal error and emits no downgrade warning.
- [ ] `runParallelReview({ strategy: 'single' })` with valid reviewer `resultText` plus a late transient terminal error emits parsed issues and no synthetic timeout-only `review-contract` issue.
- [ ] `runParallelReview({ strategy: 'parallel' })` preserves parsed issues from a built-in perspective that emits valid `resultText` before a late transient terminal error.
- [ ] `runParallelReview({ strategy: 'parallel' })` preserves parsed issues from an extension perspective that emits valid `resultText` before a late transient terminal error.
- [ ] A parallel perspective that fails before parseable output contributes a critical `review-contract` issue while parsed issues from another perspective remain in the aggregate complete event.
- [ ] The review build stage emits parsed reviewer issues after a late-result transient error and does not emit a synthetic timeout-only `review-contract` issue for that reviewer error.
- [ ] Existing reviewer worktree mutation tests still append a critical `review-contract` issue when reviewer-side file changes are detected.
- [ ] `packages/client/src/events.schemas.ts` and `packages/client/src/api-version.ts` are unchanged.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run test/agent-wiring.test.ts test/parallel-reviewer.test.ts test/reviewer-isolation.test.ts test/build-evaluator-enforcement.test.ts test/tester-wiring.test.ts test/retry.test.ts` exits 0.
