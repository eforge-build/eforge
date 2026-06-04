---
name: test-thinning-conservative
description: Conservatively remove high-confidence low-value automated tests while preserving coverage.
scope: project-team
mode: autonomous
---

## Goal

Reduce automated test execution time by removing tests that are clearly low-value, redundant, brittle, or misleading while preserving meaningful behavioral coverage.

Focus on high-confidence removals or consolidations only. Prefer no change over risky removal. When tests are deleted or consolidated, create validator-visible deleted-test coverage evidence at `eforge/plans/<plan-set>/deleted-test-coverage.md`.

## Out of scope

- Do not remove tests that provide unique coverage of important behavior.
- Do not remove regression tests for known historical bugs unless clearly obsolete.
- Do not perform broad test architecture rewrites.
- Do not replace test frameworks or restructure large test suites.
- Do not remove tests solely because they are slow if they provide important unique coverage.
- Do not require permanent committed documentation in the final tree solely to justify deleted or consolidated tests.

## Acceptance criteria

- Only tests with strong evidence of low value are removed or consolidated while critical behavior, edge cases, security-sensitive behavior, data integrity, and known regressions remain covered.
- Builders create `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory when tests are deleted.
- Builders create `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory when tests are consolidated.
- The evidence file is created only when tests are deleted or consolidated.
- The evidence file lists each deleted test, each consolidated test, the retained adjacent test or lower-level contract that still covers the behavior, and the validation command or evidence used to confirm coverage.
- The evidence file is a temporary plan artifact that may be removed by normal `cleanupPlanFiles` cleanup and must not require permanent committed documentation in the final tree.
- Builders leave a test in place or record it as a future review candidate when retained coverage cannot be identified.
- The relevant test command exits 0 after changes.

## Notes for the planner

Be conservative. This playbook should be safe to run autonomously. Favor removing obviously redundant or misleading tests, not making judgment-heavy tradeoffs.

Good candidates include duplicate coverage already exercised by clearer adjacent tests, tests that mostly validate mocks or framework behavior, brittle implementation-detail tests, tests for dead or unreachable behavior, broad snapshots with little behavioral signal, and low-assertion tests that do not validate meaningful outcomes.

When tests are deleted or consolidated, create `eforge/plans/<plan-set>/deleted-test-coverage.md` under the active plan set directory. The temporary evidence file must list each deleted test, each consolidated test, the retained adjacent test or lower-level contract that still covers the behavior, and the validation command or evidence used to confirm coverage. The file is a temporary plan artifact, may be removed by normal `cleanupPlanFiles` cleanup, and must not require permanent committed documentation in the final tree. If retained coverage cannot be identified, leave the test in place or record it as a future review candidate.
