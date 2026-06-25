---
id: plan-05-console-linked-traces
name: Console Linked Review-Cycle Traces
branch: add-review-cycle-issue-traceability/plan-05-console-linked-traces
---

# Console Linked Review-Cycle Traces

## Architecture Context

Console already groups review-cycle events by round and displays reviewer, fixer, and evaluator lanes. With optional issue IDs and references, the detail model can derive causal traces while preserving legacy side-by-side lanes for old or incomplete logs.

## Implementation

### Overview

Extend the review-cycle detail model with linked issue traces, dangling reference handling, and unlinked legacy lanes. Render linked traces before the existing reviewer/fixer/evaluator lanes.

### Key Decisions

1. Build traces by `ReviewIssue.issueId`; attach fixer `issueReferences` by `issueId`; attach evaluator verdicts to every ID in `verdict.issueIds`.
2. Create dangling trace entries for syntactically valid references with no matching reviewer issue, instead of dropping them.
3. Keep evaluator verdicts and fixer references without issue IDs in unlinked lanes so old logs remain visible.
4. Render linked traces first, then render reviewer/fixer/evaluator lanes filtered to unlinked data for legacy or incomplete references.
5. Keep derived Console types local to the model, but import all event wire shapes from `@eforge-build/client/browser` through existing run-state types.

## Scope

### In Scope

- Add linked trace derivation to `buildReviewCycleDetail`.
- Preserve dangling/unmatched issue references in the model.
- Render linked reviewer → fixer → evaluator trace cards in the review-cycle detail sheet.
- Render unlinked reviewer, fixer, and evaluator lanes when IDs or references are absent.
- Add model tests for a fully linked issue, a dangling evaluator reference, and a legacy unlinked round.
- Add sheet tests for linked trace labels/statuses and old no-ID visibility.

### Out of Scope

- Backfilling historical logs.
- Cross-run issue identity.
- Editing run-state storage or daemon SSE snapshots beyond consuming new optional fields.
- Changing timeline cards outside the review-cycle detail sheet.

## Files

### Create

- None expected.

### Modify

- `packages/console-ui/src/components/pipeline/review-cycle-detail-model.ts` — derive linked traces, unlinked lanes, and dangling reference metadata per round.
- `packages/console-ui/src/components/pipeline/review-cycle-detail-sheet.tsx` — render linked traces before lane cards and label unmatched references.
- `packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-model.test.ts` — add fully linked, dangling evaluator, and legacy unlinked cases.
- `packages/console-ui/src/components/pipeline/__tests__/review-cycle-detail-sheet.test.tsx` — assert linked labels/statuses and legacy lane visibility.
- `packages/console-ui/src/components/pipeline/thread-pipeline.stories.tsx` if story fixtures require type updates after model changes.

## Database Migration

Not applicable.

## Verification

- [ ] `buildReviewCycleDetail` returns one linked trace for a reviewer issue, fixer reference, and evaluator verdict sharing the same ID.
- [ ] `buildReviewCycleDetail` returns a dangling trace for an evaluator verdict that references an unknown ID.
- [ ] `buildReviewCycleDetail` keeps reviewer issues without `issueId` in an unlinked reviewer lane.
- [ ] The sheet renders the linked trace before reviewer/fixer/evaluator lane headings.
- [ ] The sheet renders fixer statuses `addressed`, `deferred`, and `obsolete` in trace cards.
- [ ] The sheet renders legacy no-ID reviewer and evaluator data after trace rendering.
