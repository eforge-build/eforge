---
name: test-thinning-audit
description: Audit automated tests for broader thinning opportunities and create a review plan before removal.
scope: project-team
mode: planning
---

## Goal

Investigate the automated test suite for meaningful opportunities to reduce execution time and maintenance burden while preserving valuable confidence.

Produce a prioritized thinning plan for user review before making larger or judgment-heavy changes. When the generated implementation session plan includes deleting or consolidating tests, carry forward a validator-visible deleted-test coverage evidence requirement at `eforge/plans/<plan-set>/deleted-test-coverage.md`.

## Out of scope

- Do not remove tests during investigation without explicit approval.
- Do not optimize production code unless directly necessary to understand test value.
- Do not replace the test framework or perform broad suite rewrites unless proposed separately.
- Do not treat speed alone as sufficient reason to remove a high-value test.
- Do not require permanent committed documentation in the final tree solely to justify deleted or consolidated tests.

## Acceptance criteria

- Candidate tests or groups of tests are identified with file names, test names, low-value evidence, removal risk, and a recommended action.
- The prioritized plan separates high-confidence safe removals from judgment-heavy decisions requiring additional review.
- Generated implementation plans that delete tests require `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory.
- Generated implementation plans that consolidate tests require `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory.
- The evidence file is created only when the generated implementation plan deletes or consolidates tests.
- The evidence file lists each deleted test, each consolidated test, the retained adjacent test or lower-level contract that still covers the behavior, and the validation command or evidence used to confirm coverage.
- The evidence file is a temporary plan artifact that may be removed by normal `cleanupPlanFiles` cleanup and must not require permanent committed documentation in the final tree.
- A generated plan leaves a test in place or records it as a future review candidate when retained coverage cannot be identified.
- User approval is requested before implementation work is enqueued.

## Notes for the planner

Use test runtime data if available, but do not rely on runtime alone. Prefer evidence from code, assertions, mocks, coverage overlap, and test purpose. Clearly distinguish confirmed facts from judgment calls.

When deletion or consolidation is in scope for a generated implementation session plan, include instructions for the builder to write `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory. The temporary evidence file must list each deleted test, each consolidated test, the retained adjacent test or lower-level contract that still covers the behavior, and the validation command or evidence used to confirm coverage. The file is a temporary plan artifact, may be removed by normal `cleanupPlanFiles` cleanup, and must not require permanent committed documentation in the final tree. If retained coverage cannot be identified, the generated plan must leave the test in place or record it as a future review candidate.
