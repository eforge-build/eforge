---
id: plan-01-conservative-test-thinning
name: Conservative Test Thinning
branch: conservatively-remove-high-confidence-low-value-automated-tests-while-preserving-coverage/plan-01-conservative-test-thinning
agents:
  builder:
    effort: high
    rationale: The work deletes or consolidates tests, so the builder must map every
      removal to retained coverage and avoid risky judgment-heavy changes.
  reviewer:
    effort: high
    rationale: Review must verify that every deleted or consolidated test has
      validator-visible retained coverage evidence.
---

# Conservative Test Thinning

## Architecture Context

This plan is test-suite maintenance only. The production code, route contracts, daemon wire shapes, package versions, and test framework configuration are out of scope. The goal is to reduce test count and runner overhead only where the current tests are exact duplicates, repetitive wrapper checks that can be covered in one looped test, or assertions already exercised by a stronger adjacent test.

When any test is deleted or consolidated, the builder must create `eforge/plans/conservatively-remove-high-confidence-low-value-automated-tests-while-preserving-coverage/deleted-test-coverage.md`. This file is a temporary plan artifact and must not be replaced by permanent committed documentation.

## Implementation

### Overview

Apply a narrow set of high-confidence test removals and consolidations across four existing test files. Preserve the same meaningful assertions by moving them into retained adjacent tests or looped contract tests, and document the retained coverage evidence in the temporary evidence file.

### Key Decisions

1. Restrict deletions to candidates with direct retained coverage in the same file or an adjacent lower-level contract test.
2. Prefer consolidation for repetitive route-wrapper tests so each route/harness case remains asserted while the Vitest test count drops.
3. Do not remove tests outside the candidates below unless the builder records a one-to-one retained coverage mapping in the evidence file.
4. Leave any candidate in place, or list it under a future-review section in the evidence file, when retained coverage cannot be identified during implementation.

## Scope

### In Scope

- Delete or consolidate the specific candidate tests listed below.
- Preserve the assertions from consolidated tests inside retained adjacent tests or looped tests.
- Create `eforge/plans/conservatively-remove-high-confidence-low-value-automated-tests-while-preserving-coverage/deleted-test-coverage.md` because this plan deletes and consolidates tests.
- Run targeted and full test validation after the edits.

### Out of Scope

- Production code changes.
- Broad test architecture rewrites.
- Test framework or Vitest configuration changes.
- Deleting regression tests or tests with unique coverage.
- Permanent documentation changes that exist only to justify removed tests.

## Files

### Create

- `eforge/plans/conservatively-remove-high-confidence-low-value-automated-tests-while-preserving-coverage/deleted-test-coverage.md` — temporary evidence file listing every deleted test and every consolidated test, the retained adjacent test or lower-level contract that covers the behavior, and the validation command or evidence used.

### Modify

- `web/__tests__/content.test.ts` — remove or consolidate duplicate public-doc coverage:
  - Consolidate `returns non-empty HTML for known doc slugs` into `keeps every public guide structurally valid and mirrored by slug` by asserting non-empty `page.html` inside that retained all-slug loop.
  - Delete `keeps new guide pages discoverable and structured`; its assertions are a subset of `keeps every public guide structurally valid and mirrored by slug` plus `keeps docs navigation aligned to the complete public guide set`.
  - Remove the now-unused `newGuideSlugs` constant.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` — consolidate repetitive wrapper tests:
  - Replace the individual successful GET route tests for `fetchSystemHealth`, `fetchSystemVersion`, `fetchSystemProjectContext`, `fetchSystemConfigShow`, `fetchSystemConfigValidate`, `fetchSystemProfileList`, `fetchSystemProfileShow`, `fetchSystemExtensionList`, `fetchSystemExtensionValidate`, `fetchSystemExtensionContributionManifest`, and `fetchSystemPlaybookList` with one looped test that asserts the expected `API_ROUTES` path or query string and response body for every case.
  - Replace the four harness-query tests for `fetchSystemModelProviders('pi')`, `fetchSystemModelProviders('claude-sdk')`, `fetchSystemModelList('pi')`, and `fetchSystemModelList('claude-sdk')` with one looped test that asserts route, `harness` query value, and response body for all four cases.
  - Delete `500 response on one endpoint does not affect other endpoints`; the retained success loop and `returns error message from HTTP status text on 500 response` cover the success/error contracts, and `system-fetches.ts` has no module-level mutable error state.
- `packages/console-ui/src/views/run-detail/__tests__/run-detail-view.test.tsx` — delete `renders the back button`; `calls onBack when back button is clicked` already queries the same accessible button and fails if the button is absent.
- `test/skills-docs-wiring.test.ts` — delete exact duplicate enum-drift tests while retaining the earlier equivalent assertions:
  - Delete `Pi config skill contains xhigh for both effort and thinkingLevel`; retain `Pi config skill contains xhigh for thinkingLevel and effort (profile-new no longer has tuning step)`.
  - Delete `Plugin config skill contains xhigh for both effort and thinkingLevel`; retain `Plugin config skill contains xhigh for thinkingLevel and effort (profile-new no longer has tuning step)`.
  - Delete `Pi and plugin config skills contain low as a thinkingLevel option`; retain `Pi and plugin config skills contain low as a thinkingLevel option (profile-new no longer has tuning step)`.

## Evidence File Requirements

Create the evidence file only because this plan deletes and consolidates tests. Use a table with at least these columns:

| File | Deleted or consolidated test | Action | Retained coverage | Validation or evidence |
| --- | --- | --- | --- | --- |

For each row:

- Name the exact deleted or consolidated `it(...)` title.
- Mark the action as `deleted` or `consolidated`.
- Name the retained test title or lower-level source contract.
- Name the validation command run, or cite source evidence such as lack of module-level mutable state for the stateless endpoint-independence deletion.

If a listed candidate is left in place, add it under `## Future review candidates` with the reason retained coverage was not identified. Do not create a permanent docs file for this evidence.

## Database Migration

Not applicable.

## Verification

- [ ] `eforge/plans/conservatively-remove-high-confidence-low-value-automated-tests-while-preserving-coverage/deleted-test-coverage.md` exists and contains one row for every deleted test and every consolidated test.
- [ ] Each evidence row names a retained test title or lower-level source contract plus a validation command or cited evidence.
- [ ] `web/__tests__/content.test.ts` no longer defines `newGuideSlugs`, and the retained all-guide structural test asserts non-empty HTML for each `expectedDocSlugs` entry.
- [ ] `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` contains a looped successful GET helper test covering every listed helper and a looped harness-query test covering both harness values for providers and models.
- [ ] `packages/console-ui/src/views/run-detail/__tests__/run-detail-view.test.tsx` no longer contains an `it` title equal to `renders the back button`, and `calls onBack when back button is clicked` remains.
- [ ] `test/skills-docs-wiring.test.ts` no longer contains the three duplicate enum-drift `it` titles listed in this plan, and the retained equivalent enum-drift tests remain.
- [ ] `pnpm test -- web/__tests__/content.test.ts packages/console-ui/src/views/system/__tests__/system-fetches.test.ts packages/console-ui/src/views/run-detail/__tests__/run-detail-view.test.tsx test/skills-docs-wiring.test.ts` exits 0.
- [ ] `pnpm test` exits 0.
