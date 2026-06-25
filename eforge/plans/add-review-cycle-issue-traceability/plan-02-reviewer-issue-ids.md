---
id: plan-02-reviewer-issue-ids
name: Reviewer Issue ID Assignment
branch: add-review-cycle-issue-traceability/plan-02-reviewer-issue-ids
agents:
  builder:
    effort: high
    rationale: Coordinates parser changes, deterministic ID generation, parallel
      review emission, and synthetic issue paths across several engine review
      surfaces.
---

# Reviewer Issue ID Assignment

## Architecture Context

The engine is responsible for canonical review issue IDs in newly emitted build review-cycle events. Agent-supplied IDs are optional input hints; the engine must assign IDs before emitting reviewer issues so downstream fixer, evaluator, and Console traces can rely on unique IDs within a review cycle.

## Implementation

### Overview

Parse optional issue IDs from reviewer XML, add a deterministic ID assignment helper, apply it to single and parallel review events, and update reviewer prompts/tests.

### Key Decisions

1. Generate IDs from review context using a stable format such as `review-r{round}-{lane}-{ordinal}` where lane is `single`, a perspective key, `aggregate`, or `review-contract`.
2. Treat missing `round` as `0` for ID generation while leaving the event `round` field omitted for standalone stages.
3. Preserve a valid supplied `issueId` when it is unique; replace or suffix duplicates and generated collisions so emitted issue arrays contain no duplicate IDs.
4. Keep invalid supplied ID strings non-fatal by ignoring them and generating an engine ID.
5. Assign IDs to synthetic reviewer contract issues, perspective errors, and drift-detection issues before review-complete events are emitted.

## Scope

### In Scope

- Add engine helper(s) for normalizing supplied issue IDs and assigning deterministic IDs with collision handling.
- Parse optional XML attributes `issueId` and `issue-id` in both fail-open and strict reviewer parsers.
- Ensure `runReview` emits issue IDs for single-review issues.
- Ensure `runParallelReview` emits issue IDs for per-perspective and aggregate review-complete events.
- Ensure build-stage injected reviewer contract issues receive issue IDs.
- Update reviewer prompt examples to show optional `issueId` and to state that the engine assigns canonical IDs when omitted.
- Add parser, assignment, propagation, duplicate, collision, and synthetic-issue tests.

### Out of Scope

- Review-fixer issue-reference output.
- Evaluator verdict issue references.
- Console trace presentation.
- Semantic matching across independent reruns.

## Files

### Create

- `packages/engine/src/review-issue-traceability.ts` — ID normalization and deterministic assignment helpers shared by reviewer/fixer/evaluator prompt formatting.

### Modify

- `packages/engine/src/schemas.ts` — add optional `issueId` to review issue prompt schemas by importing/reusing the client issue ID schema.
- `packages/engine/src/agents/reviewer.ts` — parse optional issue IDs and assign IDs before review-complete emission, including late-infrastructure recovery.
- `packages/engine/src/agents/parallel-reviewer.ts` — assign IDs for perspective issues, synthetic perspective-error issues, and the aggregate review-complete payload.
- `packages/engine/src/pipeline/stages/build-stages.ts` — run a final ID pass on buffered review-complete issues so build-stage synthetic failures and drift issues receive IDs.
- `packages/engine/src/prompts/reviewer.md` and `packages/engine/src/prompts/reviewer-*.md` — add optional `issueId` examples and rules.
- `test/xml-parsers.test.ts` — cover optional reviewer issue ID parsing and legacy no-ID output.
- `test/schemas.test.ts` and `test/reviewer-verify.test.ts` — verify prompt schema YAML exposes optional `issueId` for general and verify schemas.
- `test/parallel-reviewer.test.ts` — verify parallel perspective issue IDs and duplicate/collision behavior.
- `test/review-cycle-round-metadata.test.ts` or a new logical test file under `test/` — verify review-cycle emitted reviewer issues include unique IDs by round and lane.

## Database Migration

Not applicable.

## Verification

- [ ] `parseReviewIssuesStrict` returns an `issueId` when reviewer XML includes `issueId="custom-1"`.
- [ ] `parseReviewIssuesStrict` returns valid issues when reviewer XML omits issue IDs.
- [ ] Single-review `plan:build:review:complete` events include unique `issueId` values for all emitted issues.
- [ ] Parallel perspective complete events include generated IDs containing the round and perspective lane.
- [ ] Aggregate review-complete events contain no duplicate `issueId` values after supplied duplicate IDs and generated collisions.
- [ ] A synthetic reviewer contract issue emitted after malformed reviewer output contains an `issueId`.
