---
id: plan-01-client-traceability-contract
name: Client Event Traceability Contract
branch: add-review-cycle-issue-traceability/plan-01-client-traceability-contract
---

# Client Event Traceability Contract

## Architecture Context

`@eforge-build/client` owns eforge daemon/event wire shapes. Review-cycle issue traceability must start here so engine and Console consumers import the same optional fields instead of redeclaring wire contracts. The contract is additive: old event logs without issue IDs or references must still validate.

## Implementation

### Overview

Add shared review issue ID and issue-reference schemas, expose optional fields on review/fix/evaluate event payloads, and regenerate reference artifacts from the TypeBox schema output.

### Key Decisions

1. Use `issueId` on `ReviewIssue` and `issueIds` on evaluator verdicts to distinguish reviewer issue identity from event IDs.
2. Keep references optional and validate them as bounded non-empty strings only; existence checks are presentation metadata, not wire-parse requirements.
3. Model fixer output as `issueReferences?: Array<{ issueId, status, note? }>` on `plan:build:review:fix:complete`, with `status` limited to `addressed`, `deferred`, or `obsolete`.
4. Model evaluator relationships as `issueIds?: string[]` on each verdict summary to support many-to-many issue/hunk mappings.

## Scope

### In Scope

- Add optional `issueId` to `ReviewIssueSchema`.
- Add reusable client schemas and exported types for review issue IDs and review-fixer issue references.
- Add optional `issueReferences` to `plan:build:review:fix:complete`.
- Add optional `issueIds` to `plan:build:evaluate:complete.verdicts[]` and mirrored review-failure evaluation verdict shapes.
- Update client schema tests and valid wire fixtures for legacy and new payloads.
- Regenerate `web/content/reference/events.md`, `web/public/reference/events.md`, and `web/public/schemas/events.schema.json` with `pnpm docs:generate`.

### Out of Scope

- Engine generation or propagation of IDs.
- Console trace rendering.
- Backfilling historical logs.
- Breaking changes to event consumers.

## Files

### Create

- None expected.

### Modify

- `packages/client/src/events/shared/schemas.ts` — define `ReviewIssueIdSchema`, `ReviewFixIssueStatusSchema`, `ReviewFixIssueReferenceSchema`, add `issueId`, and mirror `issueIds` in review-failure verdicts.
- `packages/client/src/events/variants/build.ts` — add `issueReferences` to fix-complete and `issueIds` to evaluator verdict entries.
- `packages/client/src/events/root.ts` — export static types for the new schemas.
- `packages/client/src/events.schemas.ts` — export the new reusable schemas and types from the compatibility facade.
- `packages/client/src/index.ts` and `packages/client/src/browser.ts` — expose new public types through both barrels.
- `packages/client/src/__tests__/events-schemas-review-cycle.test.ts` — cover legacy no-ID payloads and new review/fixer reference payloads.
- `packages/client/src/__tests__/events-schemas-build-evaluator.test.ts` — cover evaluator verdict `issueIds`, including multiple IDs and unknown IDs.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — add or update valid fixtures for optional traceability fields.
- `web/content/reference/events.md`, `web/public/reference/events.md`, `web/public/schemas/events.schema.json` — generated reference artifacts.

## Database Migration

Not applicable.

## Verification

- [ ] `safeParseEforgeEvent` returns success for legacy review-complete, fix-complete, and evaluate-complete events with no issue fields.
- [ ] `safeParseEforgeEvent` returns success for a review issue containing `issueId`.
- [ ] `safeParseEforgeEvent` returns success for fix-complete `issueReferences` with all three statuses.
- [ ] `safeParseEforgeEvent` returns success for an evaluator verdict containing two `issueIds`.
- [ ] `safeParseEforgeEvent` returns success for an evaluator verdict referencing an ID not present in reviewer issues.
- [ ] Generated event reference artifacts include `issueId`, `issueReferences`, and `issueIds` fields.
