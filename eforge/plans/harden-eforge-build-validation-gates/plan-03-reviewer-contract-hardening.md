---
id: plan-03-reviewer-contract-hardening
name: Reviewer Contract Hardening
branch: harden-eforge-build-validation-gates/plan-03-reviewer-contract-hardening
agents:
  builder:
    effort: high
    rationale: Reviewer parser behavior is used by single, parallel, and extension
      perspectives; changing fail-open semantics requires fixture updates across
      several build-cycle tests.
  reviewer:
    effort: high
    rationale: Agent contract hardening must not break dynamic perspectives or
      review-cycle termination semantics.
  tester:
    effort: high
    rationale: Many existing tests use empty review XML stubs and need targeted
      updates to distinguish valid empty output from invalid contract output.
---

# Reviewer Contract Hardening

## Architecture Context

Review cycles are quality gates, but they are not final acceptance evidence. They still must fail closed when the reviewer output contract is missing or malformed because review-cycle termination currently treats `ctx.reviewIssues.length === 0` and zero perspective errors as success. Parser failures must produce explicit review issues or perspective errors.

## Implementation

### Overview

Replace the permissive reviewer XML parser with a strict parse result that distinguishes valid empty review output from invalid/missing contract output. Route contract violations into synthetic critical review issues or perspective errors so the review cycle cannot terminate on invalid reviewer output. Update reviewer prompts to include acceptance-criteria review evidence requirements while keeping final AC certification in the PRD/acceptance gate from plans 01-02.

### Key Decisions

1. Keep the existing `<review-issues>` protocol for this hardening pass and add strict validation around it; do not replace all reviewer XML with a new global structured-output system.
2. Represent parser/contract failures as synthetic `ReviewIssue` objects where possible, because existing review-fix/evaluate stages already operate on review issues.
3. Treat reviewer harness errors in `reviewStageInner` as a build failure or synthetic critical issue instead of swallowing the error and returning empty metadata.
4. Keep valid `<review-issues></review-issues>` as a valid empty review, but it does not satisfy final acceptance evidence from plan-02.

## Scope

### In Scope

- Add a strict parser result type in `packages/engine/src/agents/reviewer.ts` that reports `valid`, parsed issues, and error messages.
- Keep `parseReviewIssues(text)` compatibility if needed by tests, but make runtime review paths use the strict parser.
- Detect missing `<review-issues>`, malformed blocks, multiple terminal blocks when exactly one is required, invalid severity values, missing required issue attributes, and empty issue descriptions.
- Generate synthetic critical issues for contract violations with stable category/file values such as `review-contract` and `reviewer-output`.
- Update `runReview` and built-in/extension perspective paths in `packages/engine/src/agents/parallel-reviewer.ts` to use strict parsing.
- Update `reviewStageInner` catch handling so reviewer runtime failures no longer produce an empty successful review.
- Update reviewer prompt files to require explicit evidence that the plan acceptance criteria were considered, while preserving exactly one `<review-issues>` block as the machine-readable terminal contract.
- Update tests for XML parsing, review-cycle termination, dynamic/extension perspectives, and fixtures that rely on invalid empty/no XML.

### Out of Scope

- The final acceptance-validation event/gate; plans 01-02 implement that.
- New event discriminants for review contract failures unless existing synthetic issues cannot express a required case.
- Replacing XML output with JSON across all reviewer prompts.

## Files

### Modify

- `packages/engine/src/agents/reviewer.ts` — add strict parse API, synthetic issue helpers, and runtime use in `runReview`.
- `packages/engine/src/agents/parallel-reviewer.ts` — use strict parse results for built-in and extension perspectives and surface perspective contract failures.
- `packages/engine/src/pipeline/stages/build-stages.ts` — ensure reviewer exceptions produce failure evidence and review cycles do not terminate after invalid reviewer output.
- `packages/engine/src/prompts/reviewer.md` — require acceptance-criteria consideration evidence in prose before the terminal XML block.
- `packages/engine/src/prompts/reviewer-code.md` — mirror strict contract instructions for code perspective.
- `packages/engine/src/prompts/reviewer-security.md` — mirror strict contract instructions for security perspective.
- `packages/engine/src/prompts/reviewer-api.md` — mirror strict contract instructions for API perspective.
- `packages/engine/src/prompts/reviewer-docs.md` — mirror strict contract instructions for docs perspective.
- `packages/engine/src/prompts/reviewer-tests.md` — mirror strict contract instructions for test perspective.
- `packages/engine/src/prompts/reviewer-verify.md` — stop describing passing commands as sufficient AC proof and require terminal XML plus evidence prose.
- `test/xml-parsers.test.ts` — add missing XML, malformed XML, invalid attrs, invalid severity, and valid empty block cases.
- `test/review-cycle-adaptive.test.ts` — update fixtures and assert invalid reviewer output prevents no-issues termination.
- `test/build-evaluator-enforcement.test.ts` — update review-cycle fixtures for strict parser behavior.
- `test/reviewer-verify.test.ts` — update verify-review prompt/output expectations.
- `test/agent-wiring.test.ts` and extension reviewer perspective tests — replace non-contract stubs with valid terminal XML or assert synthetic issue behavior.

## Verification

- [ ] `parseReviewIssuesStrict('no xml')` returns `valid: false` and at least one synthetic critical issue.
- [ ] `parseReviewIssuesStrict('<review-issues><issue severity="bogus" category="bugs" file="x">bad</issue></review-issues>')` returns `valid: false`.
- [ ] `parseReviewIssuesStrict('<review-issues></review-issues>')` returns `valid: true` and zero issues.
- [ ] `runReview` emits a `plan:build:review:complete` event with a synthetic critical issue when the reviewer omits the terminal block.
- [ ] Parallel review emits no clean `plan:build:review:complete` result when one perspective returns malformed XML; the aggregate contains a synthetic critical issue or a perspective error.
- [ ] Review-cycle termination on `no-issues` occurs only after every active perspective produced a valid contract.
- [ ] A reviewer returning `<review-issues></review-issues>` without acceptance verdict events does not make the final acceptance gate pass in an end-to-end/focused orchestration test from plan-02.