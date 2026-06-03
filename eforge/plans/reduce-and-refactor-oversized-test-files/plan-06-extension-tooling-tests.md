---
id: plan-06-extension-tooling-tests
name: Split Extension Tooling Route and Wiring Tests
branch: reduce-and-refactor-oversized-test-files/plan-06-extension-tooling-tests
---

# Split Extension Tooling Route and Wiring Tests

## Architecture Context

Extension tooling route and wiring tests span daemon routes, CLI registration, native runtime wiring, documentation assertions, plugin metadata, and MCP/Pi parity. This plan keeps consumer-facing behavior unchanged and avoids touching plugin or Pi versions because it only reorganizes tests.

## Implementation

### Overview

Split `extension-tooling-routes.test.ts` and `extension-tooling-wiring.test.ts` by operation family and consumer surface. Extract daemon route setup, extension package fixtures, and source-text assertions into test-only helper modules.

### Key Decisions

1. Split the single large extension route suite by list/show/validate/test, scaffold/promote/demote/trust, install/update/remove package management, and route error handling.
2. Split wiring tests by CLI preprocessing/registration, route constants/helpers, native runtime/docs, plugin metadata, MCP/Pi parity, and CLI `--after` forwarding.
3. Keep route constant assertions tied to `@eforge-build/client` helpers so route ownership remains in the client package.

## Scope

### In Scope

- Reduce `test/extension-tooling-routes.test.ts` and `test/extension-tooling-wiring.test.ts` to 1,000 lines or fewer.
- Create focused extension route and wiring suites.
- Preserve all route, CLI, docs, plugin metadata, MCP/Pi parity, native runtime, and `--after` assertions.

### Out of Scope

- Changes to extension daemon routes, extension package management behavior, CLI command behavior, plugin metadata, Pi extension behavior, docs, or package versions.
- New inline `/api/...` route literals.

## Files

### Create

- `test/extension-tooling-routes-list-show.test.ts` — list, show, validate, and test operation route coverage.
- `test/extension-tooling-routes-scaffold-trust.test.ts` — scaffold, promote, demote, trust, and untrust route coverage.
- `test/extension-tooling-routes-package-management.test.ts` — install, update, and remove route coverage.
- `test/extension-tooling-routes-errors.test.ts` — route error handling and invalid input coverage.
- `test/extension-tooling-routes-helpers.ts` — shared daemon route setup and extension fixture helpers.
- `test/extension-tooling-wiring-cli.test.ts` — CLI enqueue preprocessing, route constants/helpers, command registration, and `--after` wiring tests.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — native runtime wiring and documentation source assertion tests.
- `test/extension-tooling-wiring-consumer-parity.test.ts` — Claude plugin metadata and MCP/Pi parity tests.
- `test/extension-tooling-wiring-helpers.ts` — shared source-reading and assertion helpers.

### Modify

- `test/extension-tooling-routes.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/extension-tooling-wiring.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'test/extension-tooling*.test.ts'` exits 0.
- [ ] `find test -maxdepth 1 -type f -name 'extension-tooling*.ts' -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from the two source files appears exactly once across the resulting split files.
- [ ] Route tests use `API_ROUTES`, `buildPath()`, or typed client route helpers for daemon paths; no new inline `/api/...` route literals are added.
- [ ] No production file, docs file, plugin version file, or Pi package version file changes in this plan.