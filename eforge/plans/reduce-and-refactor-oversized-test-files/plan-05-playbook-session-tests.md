---
id: plan-05-playbook-session-tests
name: Split Playbook and Session Plan Route Tests
branch: reduce-and-refactor-oversized-test-files/plan-05-playbook-session-tests
---

# Split Playbook and Session Plan Route Tests

## Architecture Context

Playbook and session-plan tests cover the `@eforge-build/input` package plus daemon route behavior. Route tests must continue to use route constants and typed helpers owned by `@eforge-build/client`, and input-package tests must keep fixtures inline except where I/O setup is repeated.

## Implementation

### Overview

Split `playbook.test.ts`, `playbook-api.test.ts`, and `daemon-session-plan-routes.test.ts` into validation, conversion, storage, route CRUD, run/profile, enqueue validation, readiness, migration, auto-submit, playbook-derived session plan, and AC diagnostics suites. Extract route server setup and raw playbook/session-plan builders into test-only helper modules.

### Key Decisions

1. Keep input package unit tests separate from daemon API route tests.
2. Keep playbook API CRUD/run/profile behavior separate from generic enqueue validation coverage currently housed in the playbook API file.
3. Keep session-plan route tests grouped by route family and AC diagnostics/status-gate behavior.

## Scope

### In Scope

- Reduce `test/playbook.test.ts`, `test/playbook-api.test.ts`, and `test/daemon-session-plan-routes.test.ts` to 1,000 lines or fewer.
- Create focused playbook input, playbook API, and session-plan route test files.
- Preserve route coverage for playbook list/show/save/run/promote/demote/validate, enqueue landing/dependency validation, session-plan CRUD/readiness/migration/enqueue/create-from-playbook, and AC quality gates.

### Out of Scope

- Changes to daemon route constants, input package public types, playbook serialization formats, or session-plan behavior.
- New inline `/api/...` route literals.

## Files

### Create

- `test/playbook-validation.test.ts` — playbook validation and frontmatter schema tests.
- `test/playbook-conversion.test.ts` — parse/serialize round trips, build-source conversion, and plan seed conversion tests.
- `test/playbook-storage.test.ts` — write/load/list/move scoped behavior and bundled playbook tests.
- `test/playbook-profile.test.ts` — optional profile field validation, serialization, conversion, and listing tests.
- `test/playbook-helpers.ts` — shared playbook fixture builders for input-package suites.
- `test/playbook-api-crud.test.ts` — playbook list/show/save and removed old enqueue route tests.
- `test/playbook-api-run-profile.test.ts` — playbook run/promote/demote/validate/profile persistence tests.
- `test/playbook-api-enqueue-validation.test.ts` — enqueue landing auto-merge and dependency validation tests.
- `test/playbook-api-helpers.ts` — shared monitor server, profile, and playbook route fixtures.
- `test/daemon-session-plan-routes-crud.test.ts` — session-plan list/show/create/read/write/status route tests.
- `test/daemon-session-plan-routes-readiness.test.ts` — dimension selection, readiness, migration, traversal rejection, and AC diagnostics tests.
- `test/daemon-session-plan-routes-enqueue.test.ts` — session-plan auto-submit and status-gate enqueue route tests.
- `test/daemon-session-plan-routes-playbook.test.ts` — create-from-playbook route tests.
- `test/daemon-session-plan-routes-helpers.ts` — shared server setup, post helper, raw session plan builders, and stub tracker builders.

### Modify

- `test/playbook.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/playbook-api.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/daemon-session-plan-routes.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'test/playbook*.test.ts' 'test/daemon-session-plan-routes*.test.ts'` exits 0.
- [ ] `find test -maxdepth 1 -type f \( -name 'playbook*.ts' -o -name 'daemon-session-plan-routes*.ts' \) -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from the three source files appears exactly once across the resulting split files.
- [ ] Route tests use `API_ROUTES`, `buildPath()`, or typed client route helpers for daemon paths.