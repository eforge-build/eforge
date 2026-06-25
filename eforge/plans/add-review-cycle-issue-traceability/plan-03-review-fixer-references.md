---
id: plan-03-review-fixer-references
name: Review-Fixer Issue References
branch: add-review-cycle-issue-traceability/plan-03-review-fixer-references
agents:
  builder:
    effort: high
    rationale: Adds a new structured agent submission path while preserving legacy
      review-fixer behavior and max-turn continuation semantics.
---

# Review-Fixer Issue References

## Architecture Context

After reviewer issues carry IDs, the review-fixer can emit informational per-issue status metadata without changing build success semantics. The metadata must be optional, best-effort, and safe for legacy agent output that contains only prose.

## Implementation

### Overview

Expose reviewer issue IDs in the review-fixer prompt, add a structured submission tool for issue-reference statuses, parse a fallback XML block when present, and emit collected references on fix-complete events.

### Key Decisions

1. Prefer a custom tool named `submit_review_fixer_issue_references` with input `{ issueReferences: [...] }` using the client-owned reference schema.
2. Keep the tool best-effort: missing submissions leave `issueReferences` omitted, and invalid fallback XML yields no references instead of failing the fixer stage.
3. Preserve unknown but syntactically valid `issueId` references for Console to render as unmatched metadata.
4. Include issue IDs next to each issue in the prompt so StubHarness and real agents can tie statuses to reviewer findings.
5. Emit `issueReferences` only when at least one valid reference was collected.

## Scope

### In Scope

- Add review-fixer issue-reference submission schema/getter in engine prompt schemas using client shared schemas.
- Add a review-fixer custom tool that accepts statuses `addressed`, `deferred`, and `obsolete`.
- Add optional fallback XML parsing for `<issue-references>` output with one issue ID per entry.
- Update `runReviewFixer` to capture structured or fallback references and include them on `plan:build:review:fix:complete`.
- Update the review-fixer prompt with the tool name, schema, status meanings, and legacy fallback format.
- Add StubHarness tests proving issue IDs appear in the fixer prompt and references are emitted when supplied.

### Out of Scope

- Evaluator verdict references.
- Build failure when references are missing.
- Validation that referenced IDs exist in the reviewer issue set.
- Console rendering of references.

## Files

### Create

- `packages/engine/src/agents/review-fixer-issue-references.ts` — structured tool construction, fallback parser, and reference formatting helpers for review-fixer output.

### Modify

- `packages/engine/src/schemas.ts` — export review-fixer issue-reference submission schema YAML for prompts.
- `packages/engine/src/agents/review-fixer.ts` — format issue IDs in prompts, inject the custom tool, collect references, and emit them on fix-complete.
- `packages/engine/src/prompts/review-fixer.md` — document issue IDs, status values, structured tool submission, and fallback XML.
- `test/review-fixer-continuation.test.ts` or a new logical test file under `test/` — verify references with normal completion and legacy no-reference completion.
- `test/review-cycle-round-metadata.test.ts` or another build-stage StubHarness test — verify review-cycle propagation passes reviewer issue IDs into the fixer prompt.
- `test/schemas.test.ts` — verify the review-fixer reference submission schema YAML includes all three statuses.

## Database Migration

Not applicable.

## Verification

- [ ] The review-fixer prompt contains the reviewer `issueId` for each input issue.
- [ ] A StubHarness tool call to `submit_review_fixer_issue_references` emits fix-complete `issueReferences`.
- [ ] Fix-complete references preserve `addressed`, `deferred`, and `obsolete` statuses.
- [ ] Legacy review-fixer output with no structured submission emits fix-complete without `issueReferences`.
- [ ] A syntactically valid unknown `issueId` reference remains present in the emitted fix-complete event.
- [ ] Invalid fallback reference entries are skipped without emitting `plan:build:failed`.
