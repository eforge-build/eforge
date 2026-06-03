---
id: plan-01-client-event-tests
name: Split Client Event Schema and Wire Parity Tests
branch: reduce-and-refactor-oversized-test-files/plan-01-client-event-tests
agents:
  builder:
    effort: high
    rationale: The client event schema file is the largest test file in the repo and
      requires careful movement of many event-domain suites without weakening
      schema coverage.
---

# Split Client Event Schema and Wire Parity Tests

## Architecture Context

`packages/client/src/events.schemas.ts` and the client event registry are the wire-protocol source of truth. The existing package-local precedent `packages/client/src/__tests__/events-schemas-build-evaluator.test.ts` already keeps a focused schema suite separate from the monolithic event-schema file. This plan continues that pattern and keeps all schema/parser imports pointed at the client source or client barrel already used by the suite; no event wire shapes are duplicated in test files.

## Implementation

### Overview

Split the two oversized client event tests into event-domain files and fixture modules. Keep `events-schemas.test.ts` and `events-wire-parity.test.ts` as small suites or move their contents entirely when a new file owns the domain. Move fixture data out of `events-wire-parity.test.ts` into multiple package-local fixture modules so no helper module exceeds the 1,000-line working cap.

### Key Decisions

1. Split by existing `describe` titles instead of rewriting assertions, because those titles already encode event-domain boundaries.
2. Keep wire-parity fixtures package-local under `packages/client/src/__tests__/` and split fixture modules by valid, invalid, and stack-sync families so fixture files stay below 1,000 lines.
3. Preserve runtime validation through `safeParseEforgeEvent`, `safeParseDaemonStreamSnapshot`, `eventRegistry`, and persisted-event helpers; do not introduce local event interfaces.

## Scope

### In Scope

- Reduce `packages/client/src/__tests__/events-schemas.test.ts` to 1,000 lines or fewer.
- Reduce `packages/client/src/__tests__/events-wire-parity.test.ts` to 1,000 lines or fewer.
- Create focused event-schema suites for lifecycle/core, auto-build, extension diagnostics/input sources, queue/profile/landing/stack, validation/recovery, dynamic perspective/reviewer, and review-cycle metadata coverage.
- Create focused wire-parity fixture modules and split valid, invalid, and stack-sync lifecycle assertions.

### Out of Scope

- Changes to `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, route constants, daemon API versions, or production wire shapes.
- Deleting assertions to reduce line count.

## Files

### Create

- `packages/client/src/__tests__/events-schema-test-helpers.ts` — shared schema parse/assertion helpers used by split event-schema suites.
- `packages/client/src/__tests__/events-schemas-auto-build.test.ts` — `daemon:auto-build:*` event and stream snapshot schema tests.
- `packages/client/src/__tests__/events-schemas-extension-diagnostics.test.ts` — extension diagnostics, policy gates, reviewer perspective, and agent-context registry tests.
- `packages/client/src/__tests__/events-schemas-extension-inputs.test.ts` — extension input-source and PRD enricher schema/registry tests.
- `packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts` — queue profile, landing workflow, stack layer, landing conflict, and stack sync schema tests.
- `packages/client/src/__tests__/events-schemas-validation-recovery.test.ts` — acceptance validation, gap close, validation evidence, and recovery summary schema tests.
- `packages/client/src/__tests__/events-schemas-review-cycle.test.ts` — review-fixer continuation, retry payload, dynamic perspective, and round metadata tests.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — valid parity fixture groups small enough for the working cap.
- `packages/client/src/__tests__/events-wire-parity-invalid-fixtures.ts` — invalid parity fixture groups small enough for the working cap.
- `packages/client/src/__tests__/events-wire-parity-stack-fixtures.ts` — stack sync lifecycle parity fixtures.
- `packages/client/src/__tests__/events-wire-parity-invalid.test.ts` — invalid parity assertions split from the monolithic parity test.
- `packages/client/src/__tests__/events-wire-parity-stack.test.ts` — stack sync lifecycle parity assertions.

### Modify

- `packages/client/src/__tests__/events-schemas.test.ts` — retain only a focused core/lifecycle suite or move all suites into new files; final file must be 1,000 lines or fewer.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — retain only the valid parity suite or a small smoke suite; fixture definitions move to helper modules and final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'packages/client/src/__tests__/events-schemas*.test.ts' 'packages/client/src/__tests__/events-wire-parity*.test.ts'` exits 0.
- [ ] `find packages/client/src/__tests__ -type f \( -name 'events-schema*.ts' -o -name 'events-schemas*.ts' -o -name 'events-wire-parity*.ts' \) -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from `events-schemas.test.ts` and `events-wire-parity.test.ts` appears exactly once across the resulting client event test files.
- [ ] Split files import event schemas, parser helpers, and registry helpers from the client source or client barrel; no new local event wire-shape interfaces are introduced.