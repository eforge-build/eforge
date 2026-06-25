---
name: test-thinning-audit
description: Audit automated tests for parallel thinning opportunities and create independent implementation plans before removal.
scope: project-team
mode: planning
---

## Goal

Investigate the automated test suite for meaningful opportunities to reduce `pnpm test` runtime and maintenance burden while preserving valuable confidence.

Produce a user-reviewed thinning plan set with multiple independent implementation build plans. Each build plan should cover a separate package, subsystem, or test cluster; avoid overlapping file scopes; and be suitable to run in parallel with the other plans. When a generated implementation plan includes deleting or consolidating tests, carry forward a validator-visible deleted-test coverage evidence requirement at `eforge/plans/<plan-set>/deleted-test-coverage.md` for that plan's active plan set.

The objective is lean, fast CI: keep tests that provide meaningful behavioral, regression, integration, contract, security, data-integrity, or edge-case confidence; remove or consolidate tests whose cost outweighs their signal.

## Out of scope

- Do not remove tests during investigation without explicit approval.
- Do not optimize production code unless directly necessary to understand test value.
- Do not replace the test framework or perform broad suite rewrites unless proposed separately.
- Do not treat speed alone as sufficient reason to remove a high-value test.
- Do not create implementation plans whose file scopes overlap or require serialized coordination.
- Do not require permanent committed documentation in the final tree solely to justify deleted or consolidated tests.

## Acceptance criteria

- The generated work is split into multiple independent implementation build plans scoped by package, subsystem, or coherent test cluster.
- Each implementation build plan lists its owned files or directories and does not overlap another plan's intended edit scope.
- Each plan can run in parallel with the others without depending on another plan's branch or edits.
- Candidate tests or groups of tests are identified with file names, test names, low-value evidence, removal risk, estimated runtime or maintenance cost when available, and a recommended action.
- The prioritized plan separates high-confidence safe removals from judgment-heavy decisions requiring additional review.
- Each plan states the expected CI/runtime or maintenance benefit and explains why retained tests still provide sufficient confidence.
- Long-running tests are strongly discouraged unless they provide unique high-value coverage; expensive retained tests include a keep rationale.
- Generated implementation plans that delete tests require `eforge/plans/<plan-set>/deleted-test-coverage.md` under that plan's active plan set directory.
- Generated implementation plans that consolidate tests require `eforge/plans/<plan-set>/deleted-test-coverage.md` under that plan's active plan set directory.
- The evidence file is created only when the generated implementation plan deletes or consolidates tests.
- The evidence file lists each deleted test, each consolidated test, the retained adjacent test or lower-level contract that still covers the behavior, and the validation command or evidence used to confirm coverage.
- The evidence file is a temporary plan artifact that may be removed by normal `cleanupPlanFiles` cleanup and must not require permanent committed documentation in the final tree.
- A generated plan leaves a test in place or records it as a future review candidate when retained coverage cannot be identified.
- Each plan prefers targeted validation commands for its shard over full-suite validation when sufficient, while preserving enough final validation guidance to keep CI confidence.
- User approval is requested before implementation work is enqueued.

## Notes for the planner

Start by partitioning the test suite into independent areas that can be investigated and changed separately. Prefer package boundaries, subsystem ownership, test directory clusters, or command-level shards. Avoid assigning the same source file, test file, snapshot, fixture, or helper to more than one implementation plan.

Use test runtime data if available, but do not rely on runtime alone. Prefer evidence from code, assertions, mocks, coverage overlap, retained contract tests, integration coverage, and test purpose. Clearly distinguish confirmed facts from judgment calls.

Good thinning candidates include duplicate coverage already exercised by clearer adjacent tests, tests that mostly validate mocks or framework behavior, brittle implementation-detail tests, tests for dead or unreachable behavior, broad snapshots with little behavioral signal, low-assertion tests that do not validate meaningful outcomes, and integration-style tests whose behavior is already covered by lower-level contracts plus one representative end-to-end path.

For each proposed implementation build plan, include: owned scope, candidate removals or consolidations, retained coverage rationale, expected benefit, targeted validation command, and fallback guidance if retained coverage cannot be confirmed. Prefer commands such as package-specific Vitest invocations or focused test files where they provide adequate validation; reserve full `pnpm test` for final confidence or cases where targeted validation is insufficient.

When deletion or consolidation is in scope for a generated implementation session plan, include instructions for the builder to write `eforge/plans/<plan-set>/deleted-test-coverage.md` under that plan's active plan set directory. The temporary evidence file must list each deleted test, each consolidated test, the retained adjacent test or lower-level contract that still covers the behavior, and the validation command or evidence used to confirm coverage. The file is a temporary plan artifact, may be removed by normal `cleanupPlanFiles` cleanup, and must not require permanent committed documentation in the final tree. If retained coverage cannot be identified, the generated plan must leave the test in place or record it as a future review candidate.
