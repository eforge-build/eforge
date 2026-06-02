---
title: Generalize Late Transient Transport Recovery Across Agent Roles
created: 2026-06-02
---

# Generalize Late Transient Transport Recovery Across Agent Roles

## Problem / Motivation

A late retryable transport/infrastructure error can arrive after an agent has already produced an authoritative result. In the observed build, the reviewer emitted a valid `agent:result.resultText` with a `<review-issues>` block, then Pi reported a backend connection timeout. The engine discarded the valid reviewer output, synthesized a critical `review-contract` issue, skipped evaluation, and failed the review cycle.

Affected users are anyone running eforge builds through Pi or other harnesses where backend/socket errors can be reported after final result text. The issue is especially costly in build review cycles because a late backend error can turn a valid reviewer finding into an unfixable synthetic issue and block landing despite successful implementation and tests.

This matters now because evaluator and tester late-error hardening already exists or is active, but the reviewer path still has the same failure mode. The system should consistently preserve role-specific authoritative checkpoints instead of failing mechanically after useful output is already available.

Roadmap alignment: this bug fix directly supports `docs/roadmap.md` → Kernel Resilience and Typed Recovery, especially typed recovery paths and honest gates. The change should keep behavior in the build-engine kernel and avoid expanding host workflow UX.

Observed failure evidence from monitor DB for run `6895fa35-2fe0-4567-a832-851a9a012523` (`support-second-resume-attempts-from-latest-failed-resume-run`):

- The reviewer emitted `agent:result` with a valid `<review-issues>` block containing a substantive `warning` about `packages/engine/src/recovery/event-history.ts`.
- Immediately after `agent:result`, the reviewer emitted `agent:stop` with `Backend error: upstream connect error or disconnect/reset before headers... connection timeout`.
- The engine emitted `plan:build:review:complete` with only a synthetic critical `review-contract` issue describing the timeout, losing the valid reviewer output.
- The review fixer skipped the timeout-only issue, no evaluator ran, and `review-cycle` failed with `Review cycle exhausted 1 round(s) without a final evaluation verdict.`

Relevant implementation evidence:

- `packages/engine/src/harnesses/pi.ts` emits `agent:result`, then throws if a late transport error was captured, so consumers can observe a valid result followed by a thrown transient error.
- `packages/engine/src/agents/reviewer.ts` currently accumulates only `agent:message` text and ignores `agent:result.resultText`, then parses after the harness loop completes. If the harness throws after `agent:result`, parsing is skipped.
- `packages/engine/src/pipeline/stages/build-stages.ts` catches reviewer errors and synthesizes a critical `review-contract` issue when no `plan:build:review:complete` was emitted.
- `packages/engine/src/agents/builder.ts` already has evaluator-specific late infrastructure downgrade behavior after verdict evidence.
- `packages/engine/src/agents/tester.ts` already merges `agent:result.resultText` and swallows late non-abort tester errors when output exists.
- `test/stub-harness.ts` supports `lateError`, so the reviewer regression can be covered without new harness test infrastructure.

Related backlog:

- `backlog-2026-06-01-downgrade-evaluator-late-transport-errors-after-verdict-subm` covers evaluator-specific late transport downgrades.
- `backlog-2026-06-01-harden-tester-result-handling-after-late-transport-errors` shipped tester-specific hardening.
- `backlog-2026-06-01-generalize-late-transient-transport-recovery-across-agent-ro` was added for the broader all-agent checkpoint principle.

Observed production reproduction from monitor DB:

1. Run build `support-second-resume-attempts-from-latest-failed-resume-run`.
2. Let `plan-01-recovery-run-selection` reach the review stage.
3. The reviewer emits `agent:result` containing a valid `<review-issues>` block.
4. The harness emits `agent:stop` with a late transient backend timeout after the result.
5. The engine emits `plan:build:review:complete` with a synthetic critical `review-contract` issue instead of the parsed reviewer issue.
6. The review fixer sees only the synthetic timeout issue and makes no changes.
7. The evaluator does not run because there are no candidate fixer changes.
8. The review cycle emits `cycle-terminated` with `finalEvaluationRan: false` and fails the plan.

Minimal test reproduction path:

1. Use `StubHarness` with a reviewer response that has `resultText: '<review-issues>...</review-issues>'` and `lateError: new AgentTerminalError('error_transient_transport', 'Backend error: connection timeout')` or an equivalent transient backend error.
2. Run `runReview()` or `reviewCycleStage` with that harness.
3. Current behavior: `plan:build:review:complete` is missing or contains a synthetic timeout-only `review-contract` issue.
4. Expected behavior: the valid `<review-issues>` block from `agent:result.resultText` is parsed and emitted, and a non-fatal warning records that a late transport error was downgraded after reviewer output evidence.

Confirmed root cause from code inspection:

- `packages/engine/src/harnesses/pi.ts` can yield `agent:result` and then throw a retryable transport error if the backend reported an error late in the session. This creates an event sequence where valid output exists but the async generator terminates with an exception.
- `packages/engine/src/agents/reviewer.ts` accumulates only `agent:message` content. It does not merge `agent:result.resultText`, unlike tester/evaluator/recovery paths.
- `runReview()` parses reviewer XML only after the harness loop completes normally. If the harness throws after `agent:result`, `parseReviewIssuesStrict()` is never reached.
- `reviewStageInner()` in `packages/engine/src/pipeline/stages/build-stages.ts` treats the thrown reviewer error as a reviewer failure and synthesizes a critical `review-contract` issue. This is correct for pre-result failures but incorrect for post-result transient failures with parseable reviewer output.

Broader root cause: late-error handling is role-local and inconsistent. Some roles preserve authoritative checkpoints (`tester` parses accumulated result text after late errors; evaluator can downgrade late infrastructure errors after verdict evidence), while reviewer lacks equivalent checkpoint-aware recovery. A safe generalization should preserve valid checkpoints per role, not blanket-swallow all agent errors.

## Goal

Preserve valid, parseable reviewer output when a retryable late transport/infrastructure error occurs after authoritative reviewer result evidence has already been emitted.

Keep the engine fail-closed for missing, malformed, or pre-result reviewer failures, while making reviewer behavior consistent with existing evaluator and tester late-error hardening.

## Approach

Primary implementation targets:

- `packages/engine/src/agents/reviewer.ts`
  - Merge `agent:result.resultText` into the reviewer parse buffer, using the same duplicate-avoidance pattern already used by evaluator/plan-evaluator or the merge helper pattern used by tester.
  - Track whether a parseable terminal reviewer block was available before a late error.
  - On retryable late transport/infrastructure errors after parseable reviewer evidence, emit a non-fatal `agent:warning` and still emit `plan:build:review:complete` with parsed issues.
  - Preserve fail-closed behavior when reviewer output is missing, malformed, or the error occurs before any parseable reviewer evidence.

- `packages/engine/src/agents/parallel-reviewer.ts`
  - Ensure the single-reviewer delegation path inherits the fixed `runReview()` behavior.
  - For per-perspective parallel reviewer tasks, merge `agent:result.resultText` into each perspective's `fullText` before parsing.
  - If a perspective has parseable reviewer output and then hits a retryable late transport error, treat the parsed perspective issues as authoritative and emit a warning or perspective error metadata that does not replace parsed issues with a synthetic contract issue.
  - If a perspective fails before parseable output, keep the existing synthetic critical `review-contract` behavior.

- `packages/engine/src/harness.ts` / retry helpers if useful
  - Reuse existing `classifyAgentTerminalSubtype()` and retryable infrastructure subtype helpers.
  - Do not introduce duplicate string matching for backend errors.
  - If a small shared helper is useful, keep it focused on "append resultText without duplication" or "downgrade late retryable error after evidence" and avoid a broad harness API change.

- `packages/engine/src/pipeline/stages/build-stages.ts`
  - Ideally no major change if reviewer agents emit `plan:build:review:complete` despite late result-safe transport errors.
  - Keep the synthetic critical issue fallback for reviewer failures that do not emit a review complete event.

Test targets:

- Add or extend tests in `test/parallel-reviewer.test.ts` and/or `test/build-evaluator-enforcement.test.ts` for reviewer late-error behavior.
- Add a `runReview()`-level test if there is an existing reviewer-specific test file with direct agent tests; otherwise use `parallel-reviewer.test.ts` for both single and parallel paths.
- Use `StubHarness` `lateError` support rather than adding new harness machinery.

Documentation impact:

- No documentation impact is expected unless the implementation introduces a new warning code that is worth documenting in troubleshooting.
- If a new warning code is added, update `web/content/docs/troubleshooting.md` and generated public docs only if the docs already enumerate similar warning codes.

Risks and mitigations:

- Fail-open risk: swallowing reviewer errors too broadly would allow malformed or absent review output to pass as clean.
  - Mitigation: downgrade only retryable infrastructure/transport subtypes and only when `parseReviewIssuesStrict()` succeeds on captured output.
- Contract preservation risk: reviewers must remain read-only and must emit exactly one terminal `<review-issues>` block.
  - Mitigation: keep strict parser semantics and keep worktree drift detection in `reviewStageInner()` unchanged.
- Parallel reviewer nuance: one perspective may have valid output while another fails before output.
  - Mitigation: preserve valid perspective issues and keep synthetic contract issues for perspectives without parseable output; do not let one successful perspective hide another failed perspective.
- Warning/event compatibility risk: adding new warning codes can affect tests or UI expectations.
  - Mitigation: use existing `agent:warning` shape and avoid daemon/client wire-shape changes.
- Overgeneralization risk: mutating roles such as builder and review-fixer need stronger success checkpoints than read-only reviewer output.
  - Mitigation: this plan generalizes the principle and fixes reviewer paths now, while requiring role-specific evidence for any broader helper.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---|---|---|---|
| The observed reviewer output was valid enough to parse if preserved. | Monitor DB event `407003` contained exactly one `<review-issues>` block with a complete issue. The current strict parser accepts exactly one terminal block with valid issue attributes. | high | low | Add a unit test using the captured shape through `runReview()` and `StubHarness.resultText`. | If wrong, the fix should still fail closed because parser validity is the checkpoint. |
| The late timeout is classified as retryable transport/infrastructure by existing helpers. | Error text matches existing transient backend/socket patterns used by evaluator/tester hardening. `classifyAgentTerminalSubtype()` and retry helpers already exist. | medium | low | Add tests with `AgentTerminalError('error_transient_transport', ...)` and one representative backend timeout string. | If wrong, reviewer would still synthesize a contract issue for this exact timeout until classifier coverage is expanded. |
| Fixing reviewer-level output preservation is sufficient to prevent `reviewStageInner()` from synthesizing the timeout-only issue. | `reviewStageInner()` only synthesizes the issue in the catch path when `runParallelReview()` throws before yielding `plan:build:review:complete`. | high | low | Add a stage-level or review-cycle test where reviewer result text is valid and late error occurs. | If wrong, `reviewStageInner()` may also need to inspect buffered `agent:result` events or downgrade specific catch cases. |
| The right scope is reviewer plus shared checkpoint principle, not a full rewrite of every agent role in one change. | Tester and evaluator paths already contain role-specific hardening; builder/review-fixer are mutating and require different success evidence. | high | medium | Audit all agent roles after reviewer fix and promote any remaining role-specific gaps to follow-up backlog if not covered. | If wrong, another role may still fail mechanically after result evidence; this plan includes acceptance criteria preserving existing evaluator/tester coverage. |
| No daemon/client wire shape changes are required. | The implementation can use existing `agent:warning` and existing review complete event shapes. | high | low | Confirm diff does not touch `packages/client/src/events.schemas.ts` or `DAEMON_API_VERSION`. | If wrong, API version and docs updates would be required. |

Profile signal:

- Recommended profile: Excursion.
- Rationale: this is a focused engine bug fix with several related files and regression tests, but a single cohesive planner can enumerate the implementation targets and dependencies. It does not require delegated module planning or a new architecture decomposition. Errand is too small because the fix touches review semantics, parallel reviewer behavior, and transport-resilience regression coverage.

## Scope

In scope:

- Preserve authoritative reviewer checkpoints after retryable late transport/infrastructure errors.
- Fix `runReview()` to read and parse valid reviewer output from `agent:result.resultText`.
- Fix `runReview()` to downgrade late retryable transport/infrastructure errors only after parseable reviewer evidence exists.
- Fix `runParallelReview()` single-reviewer delegation behavior through the `runReview()` path.
- Fix per-perspective parallel reviewer parsing to include `agent:result.resultText`.
- Preserve parsed issues from a parallel reviewer perspective that produced valid output before a retryable late transport error.
- Preserve synthetic critical `review-contract` issues for reviewer or perspective failures that occur before parseable output exists.
- Preserve strict reviewer XML parser semantics.
- Preserve reviewer read-only contract behavior.
- Preserve worktree drift detection in `reviewStageInner()`.
- Reuse existing terminal subtype classification and retryable infrastructure helpers.
- Add targeted regression coverage using `StubHarness.lateError`.
- Keep existing evaluator late infrastructure downgrade behavior passing.
- Keep existing tester late error result preservation behavior passing.

Out of scope:

- Expanding host workflow UX.
- Blanket-swallowing all agent errors.
- A broad harness API change.
- Duplicate string matching for backend errors.
- A full rewrite of every agent role in one change.
- Changing daemon/client wire shapes.
- Bumping the daemon API version.
- Documentation changes unless a new warning code is added and existing troubleshooting docs already enumerate similar warning codes.

## Acceptance Criteria

- `runReview()` parses valid reviewer issues from `agent:result.resultText` when no `agent:message` content is emitted.
- `runReview()` emits `plan:build:review:complete` with parsed reviewer issues when a retryable transport error occurs after valid reviewer result text is emitted.
- `runReview()` emits an `agent:warning` for a downgraded late reviewer transport error after valid reviewer result text is emitted.
- `runReview()` preserves fail-closed behavior when a retryable transport error occurs before any valid reviewer result text is emitted.
- `runReview()` preserves fail-closed behavior when reviewer result text is missing the required `<review-issues>` block.
- The single-reviewer path in `runParallelReview()` inherits the late transport downgrade behavior from `runReview()`.
- The parallel reviewer path preserves parsed issues from a perspective that emits valid result text before a late retryable transport error.
- The parallel reviewer path still emits a synthetic critical `review-contract` issue for a perspective that fails before parseable reviewer output exists.
- `reviewStageInner()` does not synthesize a timeout-only `review-contract` issue when `runParallelReview()` already emitted a valid `plan:build:review:complete` for a late-result-safe reviewer error.
- Worktree drift detection after reviewer execution remains active and still appends a critical `review-contract` issue when reviewer-side mutations are detected.
- Existing evaluator late infrastructure downgrade behavior remains covered by tests and still passes.
- Existing tester late error result preservation behavior remains covered by tests and still passes.
- No daemon API version bump is included.
- `pnpm type-check` exits 0.
- Targeted reviewer and transport-resilience tests exit 0.
