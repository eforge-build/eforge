---
id: plan-08-landing-stack-tests
name: Split Landing Action and Stack Runtime Landing Tests
branch: reduce-and-refactor-oversized-test-files/plan-08-landing-stack-tests
---

# Split Landing Action and Stack Runtime Landing Tests

## Architecture Context

Landing action and stack runtime landing tests are integration-style suites that exercise real git repositories, fake `gh` binaries, stack landing events, auto-merge behavior, metadata editing, and base preflight repair. This plan moves test code and extracts setup helpers only.

## Implementation

### Overview

Split `landing-actions.test.ts` and `stack-runtime-landing.test.ts` by landing action and stack landing behavior. Move repeated repository setup, worktree setup, fake GitHub CLI creation, config/state builders, and event-drain helpers into test-only helper modules under `test/`.

### Key Decisions

1. Split landing action tests into merge-to-base, leave-branch, issue-PR, and shared setup/helper coverage.
2. Split stack runtime tests into PR argv/events, URL discovery/persistence, non-PR/non-stacked paths, failure/provider errors, auto-merge, metadata editing, and base preflight/repair.
3. Preserve real git command usage and fake `gh` binaries; do not replace integration setup with mocks.

## Scope

### In Scope

- Reduce `test/landing-actions.test.ts` and `test/stack-runtime-landing.test.ts` to 1,000 lines or fewer.
- Create focused landing and stack runtime test files plus helper modules.
- Preserve merge, leave branch, PR creation/editing, stack landing event, failure, auto-merge, metadata, and preflight assertions.

### Out of Scope

- Changes to landing action production code, stack runtime production code, provider behavior, git helpers, or GitHub CLI invocation behavior.

## Files

### Create

- `test/landing-actions-merge.test.ts` — merge-to-base-branch landing tests.
- `test/landing-actions-branch.test.ts` — leave-branch landing tests.
- `test/landing-actions-pr.test.ts` — issue-PR, existing PR, PR edit, and auto-merge landing tests.
- `test/landing-actions-helpers.ts` — shared git repository, remote, fake `gh`, config/state, and event-drain helpers.
- `test/stack-runtime-landing-pr.test.ts` — PR action argv construction and event sequence tests.
- `test/stack-runtime-landing-url-persistence.test.ts` — PR URL discovery and persistence tests.
- `test/stack-runtime-landing-failures.test.ts` — non-PR paths, missing provider, failure handling, and non-stacked build tests.
- `test/stack-runtime-landing-auto-merge.test.ts` — PR auto-merge tests.
- `test/stack-runtime-landing-metadata-preflight.test.ts` — PR metadata editing and base preflight/repair tests.
- `test/stack-runtime-landing-helpers.ts` — shared stack landing fixture builders and fake provider helpers.

### Modify

- `test/landing-actions.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/stack-runtime-landing.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'test/landing-actions*.test.ts' 'test/stack-runtime-landing*.test.ts'` exits 0.
- [ ] `find test -maxdepth 1 -type f \( -name 'landing-actions*.ts' -o -name 'stack-runtime-landing*.ts' \) -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from the two source files appears exactly once across the resulting split files.
- [ ] Tests continue to create real temporary git repositories and fake `gh` binaries; no mock framework is introduced.