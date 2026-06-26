---
title: Thin Automated Test Suite
created: 2026-06-26
---

# Thin Automated Test Suite

## Problem / Motivation

`pnpm test` has runtime and maintenance cost from duplicated, low-value, or overly granular tests. This work thins the automated test suite while preserving valuable confidence, using the six independent areas identified by planning task `task-a257ed1b-efd0-4c02-bb18-0219fb671789`.

## Goal

Reduce automated test-suite runtime and ongoing maintenance cost while preserving meaningful behavioral, contract, security-adjacent, package-publication, and integration confidence.

## Approach

The implementation should remain conservative. Remove or consolidate only tests with clear retained coverage, prefer table-driven consolidation over behavioral deletion where appropriate, and keep expensive tests when they provide unique high-value confidence.

The expected edit scope is test-only, plus temporary plan evidence under `eforge/plans/<plan-set>/deleted-test-coverage.md` if the build deletes or consolidates tests.

Do not edit production implementation files unless a test-only import/helper cleanup requires it and the reason is documented. Keep changes bounded in large files, and use targeted edits rather than rewrites.

Assumptions:

- Runtime timings were not collected during planning.
- Cost estimates are based on static evidence such as real git repositories, real HTTP servers, npm pack/build calls, subprocess calls, repeated one-assertion tests, and duplicated fixture lists.
- This plan intentionally consolidates six independent draft areas into one build.
- Consolidating the six areas is simpler to manage but gives up some parallelism.
- The builder should still keep commits and edits organized by area.
- Each deletion or consolidation must be backed by retained coverage evidence.
- Speed alone is not enough to remove a high-value test.

Risks and guardrails:

- Consolidating all six areas into one build increases branch size and review complexity.
- Edits must stay organized by area.
- Opportunistic changes outside the listed scope must be avoided.
- Security-adjacent monitor static-serving tests should be thinned conservatively.
- If retained coverage is ambiguous, keep the test.
- Package publication/build tests may be slow but high-value.
- Keep expensive tests when they uniquely prove public package artifacts, fresh-project imports, or npm-pack contents.
- Table-driven test consolidation can reduce readability if case labels are vague.
- Use descriptive labels so failures remain diagnosable.
- Large test files must be edited with bounded exact diffs.
- Do not rewrite entire oversized files.
- If targeted validation reveals unexpected production behavior coupling, stop thinning that area and record the candidate as future review instead.

## Scope

In scope:

- Client event wire-contract duplicate cleanup.
- Console selector micro-test consolidation.
- Monitor static UI duplicate coverage thinning.
- Engine provenance GitHub remote integration thinning.
- First-party extension package publication/build test consolidation.
- Extension package-management route test thinning.

Out of scope:

- Production-code refactors unrelated to proving retained test coverage.
- Replacing test frameworks or rewriting broad test architecture.
- Removing security-sensitive, regression, data-integrity, contract, package-publication, or integration coverage without an explicit retained-coverage rationale.
- Requiring permanent committed documentation solely to justify deleted tests.

Owned test files by work area:

1. Client event wire-contract duplicate cleanup
   - `packages/client/src/__tests__/events.test.ts`
   - `packages/client/src/__tests__/events-schemas.test.ts`
   - `packages/client/src/__tests__/events-schema-test-helpers.ts` only for helper exports that become unused

2. Console selector micro-test consolidation
   - `packages/console-ui/src/__tests__/labels.test.ts`
   - `packages/console-ui/src/views/system/__tests__/extension-management-selectors.test.ts`

3. Monitor static UI duplicate coverage thinning
   - `packages/monitor/src/__tests__/http-static-assets.test.ts`
   - `packages/monitor/src/__tests__/static-ui-serving.test.ts`

4. Engine provenance GitHub remote integration thinning
   - `test/provenance.test.ts`

5. First-party extension package publication/build test consolidation
   - `eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts`
   - `eforge/extensions/eforge-plan/__tests__/package-publication.test.ts`
   - `eforge/extensions/eforge-playbooks/__tests__/package-foundation.test.ts`
   - `eforge/extensions/eforge-playbooks/__tests__/package-publication.test.ts`
   - Validate adjacent retained coverage in `eforge/extensions/eforge-playbooks/__tests__/registration.test.ts` and `eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts` as needed.

6. Extension package-management route test thinning
   - `test/extension-tooling-routes-package-management.test.ts`

## Acceptance Criteria

- The build creates `eforge/plans/<plan-set>/deleted-test-coverage.md` before deleting or consolidating any tests.
- The evidence file lists each deleted or consolidated test.
- The evidence file identifies the retained adjacent test or lower-level contract that still covers each deleted or consolidated behavior.
- The evidence file records the targeted validation command or evidence used to confirm retained coverage for each deleted or consolidated test.
- The evidence file may remain a temporary plan artifact.
- The final tree does not require permanent committed documentation solely to justify deleted tests.
- Each candidate test without identified retained coverage is left in place or recorded as a future review candidate.
- Client event-contract cleanup removes JSON-only or stale duplicate event tests only when retained `safeParseEforgeEvent`, wire-parity, focused schema, or registry coverage is explicitly identified.
- Console selector tests are consolidated into labeled table-driven cases.
- Console selector consolidation does not drop behavioral input/output cases.
- Console selector failure labels remain descriptive.
- Monitor static UI thinning preserves security-adjacent traversal coverage through direct-helper tests or full-server integration tests.
- Monitor static UI thinning preserves malformed escape coverage through direct-helper tests or full-server integration tests.
- Monitor static UI thinning preserves symlink coverage through direct-helper tests or full-server integration tests.
- Monitor static UI thinning preserves route wiring coverage through direct-helper tests or full-server integration tests.
- Monitor static UI thinning preserves SPA fallback coverage through direct-helper tests or full-server integration tests.
- Monitor static UI thinning preserves API 404 confidence through direct-helper tests or full-server integration tests.
- Engine provenance thinning keeps parser coverage for remote URL variants.
- Engine provenance thinning keeps at least one representative collector integration that proves GitHub blob URL construction.
- First-party extension package tests keep unique public-package confidence for metadata.
- First-party extension package tests keep unique public-package confidence for build/import safety.
- First-party extension package tests keep unique public-package confidence for package files.
- First-party extension package tests keep unique public-package confidence for workspace/type-check/release wiring.
- First-party extension package tests keep unique public-package confidence for publication artifacts.
- Each expensive retained first-party extension package test has a keep rationale in the evidence file.
- Extension package-management route tests remove brittle source-string inspection only if retained behavior tests cover the public contract.
- Extension package-management route tests keep version override rejection cases explicit by source kind.
- Only tests with strong low-value evidence are removed or consolidated.
- Long-running tests are retained when they provide unique high-value confidence.
- No production behavior changes are introduced except incidental test-only helper or import cleanup.
- Any production implementation edit required for test-only import/helper cleanup has its reason documented.
- `pnpm vitest run --config vitest.main.config.ts packages/client/src/__tests__/events-wire-parity.test.ts packages/client/src/__tests__/events-wire-parity-invalid.test.ts packages/client/src/__tests__/events-schemas.test.ts packages/client/src/__tests__/events-schemas-auto-build.test.ts packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts --silent` exits 0.
- `pnpm --filter @eforge-build/client type-check` exits 0.
- `pnpm vitest run --config packages/console-ui/vitest.config.ts packages/console-ui/src/__tests__/labels.test.ts packages/console-ui/src/views/system/__tests__/extension-management-selectors.test.ts --silent` exits 0.
- `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- `pnpm vitest run --config vitest.main.config.ts packages/monitor/src/__tests__/http-static-assets.test.ts packages/monitor/src/__tests__/static-ui-serving.test.ts packages/monitor/src/__tests__/server-security.test.ts --silent` exits 0.
- `pnpm --filter @eforge-build/monitor type-check` exits 0.
- `pnpm vitest run --config vitest.main.config.ts test/provenance.test.ts --silent` exits 0.
- `pnpm --filter @eforge-build/engine type-check` exits 0 if engine provenance imports or types change.
- `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts eforge/extensions/eforge-plan/__tests__/package-publication.test.ts eforge/extensions/eforge-playbooks/__tests__/package-foundation.test.ts eforge/extensions/eforge-playbooks/__tests__/package-publication.test.ts eforge/extensions/eforge-playbooks/__tests__/registration.test.ts eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts --silent` exits 0.
- `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- `pnpm --filter @eforge-build/eforge-playbooks type-check` exits 0.
- `pnpm vitest run --config vitest.main.config.ts test/extension-tooling-routes-package-management.test.ts --silent` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0 if large test files were edited.
- If full-suite validation is intentionally skipped locally, the final implementation notes justify the skipped validation with CI or full-suite confidence guidance.
- If one final local `pnpm test` run is used for full-suite confidence, it exits 0.