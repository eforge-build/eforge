---
id: plan-04-evaluator-issue-references
name: Evaluator Verdict Issue References
branch: add-review-cycle-issue-traceability/plan-04-evaluator-issue-references
agents:
  builder:
    effort: high
    rationale: Touches evaluator schemas, XML fallback parsing, tool submissions,
      build-stage emission, and feedback loops while retaining strict evaluator
      coverage checks.
---

# Evaluator Verdict Issue References

## Architecture Context

Evaluator verdicts already summarize patch disposition and issue outcomes by file/hunk. Adding optional reviewer issue ID arrays lets one verdict reference multiple reviewer issues and lets one issue appear in multiple verdicts, without changing evaluator acceptance rules.

## Implementation

### Overview

Add `issueIds` to engine evaluation schemas, parsing, prompt context, structured tool submissions, review-cycle feedback, and evaluate-complete summaries.

### Key Decisions

1. Reuse the client-owned review issue ID schema for `evaluationVerdictSchema.issueIds`.
2. Do not validate `issueIds` against the current reviewer issue list in the evaluator tool; unknown IDs remain valid observability metadata.
3. Provide the evaluator a reviewer issue context section listing issue IDs, files, severities, descriptions, and fixer statuses when available.
4. Support fallback XML attributes `issueIds="id-a,id-b"` and `issue-ids="id-a,id-b"` for agents without structured tools.
5. Preserve `issueIds` in `summarizeEvaluationVerdicts` and review-cycle feedback so emitted events and next-round prompts retain traceability metadata.

## Scope

### In Scope

- Add optional `issueIds` to engine evaluator verdict and submission schemas.
- Parse evaluator XML fallback issue IDs.
- Update evaluator prompt examples and schema text to request issue IDs when reviewer IDs are known.
- Pass current reviewer issues into `builderEvaluate` from build-stage evaluation.
- Include `issueIds` in evaluate-complete verdict summaries and review-cycle feedback formatting.
- Add tests for structured submissions, XML fallback, multiple IDs on one verdict, unknown IDs, and missing references.

### Out of Scope

- Changing evaluator strictness semantics.
- Blocking builds because evaluator references are absent.
- Applying evaluator verdicts differently based on issue IDs.
- Console rendering of evaluator references.

## Files

### Create

- None expected.

### Modify

- `packages/engine/src/evaluation-schemas.ts` — add optional `issueIds` to `evaluationVerdictSchema`.
- `packages/engine/src/agents/common.ts` — parse fallback XML issue ID attributes into `EvaluationVerdict.issueIds`.
- `packages/engine/src/agents/builder.ts` — add evaluator reviewer-issue context to `BuilderOptions`, prompt variables, and structured result handling.
- `packages/engine/src/pipeline/stages/build-stages.ts` — pass current reviewer issues into evaluator attempts and emit summarized `issueIds` on evaluate-complete.
- `packages/engine/src/pipeline/review-cycle-feedback.ts` — carry `issueIds` in feedback items, summaries, and prompt lines.
- `packages/engine/src/prompts/evaluator.md` — document optional `issueIds` in structured and XML submissions.
- `test/xml-parsers.test.ts` — cover evaluator XML fallback `issueIds` parsing.
- `test/build-evaluator-enforcement.test.ts` — cover structured verdict references, multiple issue IDs, unknown IDs, and missing references.
- `test/evaluation-tools.test.ts` and `test/evaluation-application.test.ts` — confirm tool validation/application accepts references without changing patch coverage behavior.
- `test/review-cycle-round-metadata.test.ts` or another StubHarness build-stage test — verify evaluate-complete includes verdict `issueIds` from a structured evaluator submission.

## Database Migration

Not applicable.

## Verification

- [ ] `evaluationSubmissionSchema` accepts a verdict with `issueIds: ['review-r0-code-1', 'review-r0-security-1']`.
- [ ] `parseEvaluationBlock` extracts two issue IDs from an XML verdict attribute.
- [ ] Evaluator prompt text includes current reviewer issue IDs when `ctx.reviewIssues` contains IDs.
- [ ] `plan:build:evaluate:complete.verdicts[]` preserves `issueIds` from structured tool submissions.
- [ ] Unknown issue IDs in evaluator verdicts do not emit `plan:build:failed`.
- [ ] Omitting `issueIds` keeps legacy evaluator behavior and event validation success.
