---
title: Reduce and Refactor Oversized Test Files
created: 2026-06-03
---

# Reduce and Refactor Oversized Test Files

## Problem / Motivation

The repository contains oversized and near-oversized test files that make the suite harder to maintain, review, and validate.

Evidence gathered:

- `docs/llm-friendly-code.md` defines the relevant test-file hard cap: new test files are limited to **1,200 lines**, legacy oversized files are listed in `scripts/agent-maintainability-baseline.json`, and baseline files may shrink but must not grow beyond `noGrowthCeiling`.
- `scripts/agent-maintainability-baseline.json` currently lists oversized legacy test files, including the largest client event schema/parity tests and multiple root `test/*.test.ts` suites.
- A repository-wide line-count scan excluding `node_modules/`, `dist/`, and `.git` found 15 test files currently above the repository hard cap of 1,200 lines.
- After user feedback, the working cleanup cap is **1,000 lines**, which expands the target set to 21 test files and leaves buffer below the policy cap.
- `docs/roadmap.md` does not call out test-size cleanup directly, but this work supports the roadmap's “Honest gates” and maturity goals by keeping the test suite maintainable and validation-friendly.
- `AGENTS.md` requires grouping tests by logical unit, no mocks, using real code, fixtures only for I/O tests, and `StubHarness` for agent wiring tests.
- `AGENTS.md` requires `pnpm maintainability:check` before committing.

Oversized test files above 1,200 lines:

| Lines | File | Observed grouping evidence |
|---:|---|---|
| 4,144 | `packages/client/src/__tests__/events-schemas.test.ts` | 39 `describe` blocks / 249 tests across schema round trips, invalid payloads, registry diagnostics, stream snapshots, validation evidence, stack/landing/input-source events, etc. |
| 2,544 | `test/recovery.test.ts` | 10 `describe` blocks / 89 tests across verdict parsing/schema, sidecars, summary building, analyst wiring, engine recovery, deterministic verdict paths. |
| 2,329 | `test/agent-wiring.test.ts` | 23 `describe` blocks / 99 tests across planner/reviewer/builder/evaluator/module-planner wiring, stage registry, config resolution, retry policies, runtime registry, parallel review. |
| 2,263 | `packages/client/src/__tests__/events-wire-parity.test.ts` | 7 `describe` blocks / 39 tests, with large event fixture definitions before the first suite. |
| 2,201 | `test/retry.test.ts` | 27 `describe` blocks / 105 tests across policy definitions, continuation input builders, retry mechanics, terminal success logic, StubHarness integrations. |
| 1,984 | `test/config-backend-profile.test.ts` | 29 `describe` blocks / 97 tests across project/user/local profile scopes, migration, metadata, legacy parsing. |
| 1,695 | `test/orchestration-logic.test.ts` | 12 `describe` blocks / 49 tests across failure propagation, merge skipping, concurrency, executePlans behavior, state initialization, validation gates, resume seed. |
| 1,593 | `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` | 30 `describe` blocks / 90 tests across reducer events, selectors, heartbeat/lifecycle/scheduler/recovery/stack projections. |
| 1,474 | `test/playbook-api.test.ts` | 12 `describe` blocks / 51 tests across playbook list/show/save/run/promote/demote/validate plus enqueue landing/dependency validation. |
| 1,410 | `test/extension-tooling-routes.test.ts` | One large route suite / 38 tests, likely split by extension operation families. |
| 1,389 | `test/monitor-reducer.test.ts` | 7 `describe` blocks / 53 tests across reducer events, batch load, stats, usage, agent thread fields, run projection. |
| 1,338 | `test/queue-scheduler.test.ts` | 11 `describe` blocks / 27 tests across input types, policy gates, queue mutation/completion, pause, locks, reconciliation. |
| 1,324 | `test/landing-actions.test.ts` | 4 `describe` blocks / 20 tests across merge, leave branch, and PR issuing. |
| 1,280 | `test/stack-runtime-landing.test.ts` | 10 `describe` blocks / 39 tests across stack landing argv/events/persistence/failures/provider/non-stacked/automerge/metadata/preflight. |
| 1,279 | `test/daemon-session-plan-routes.test.ts` | 14 `describe` blocks / 49 tests across session-plan list/show/create/set/readiness/migration/enqueue/create-from-playbook/AC diagnostics/status gate. |

Near-threshold watchlist:

- `test/profile-wiring.test.ts` — 1,191 lines.
- `test/daemon-recovery.test.ts` — 1,190 lines, currently just under the cap but baseline-listed at 1,230.
- `test/pipeline.test.ts` — 1,158 lines.
- `test/config.test.ts` — 1,097 lines.
- `test/extension-tooling-wiring.test.ts` — 1,024 lines.
- `test/playbook.test.ts` — 1,002 lines.

Initial planning conclusion:

- This is a **refactor** rather than a behavior change: preserve coverage and assertions while moving logically distinct suites and shared fixture builders into smaller files.
- A focused plan is appropriate: the target list is large, but the work is mechanical and can be split into cohesive batches.
- No public API or runtime behavior should change.
- The plan should use a stricter **1,000-line working cap** for tests so the result does not leave files close to the 1,200-line policy limit.
- Assumption to validate during planning/build: splitting Vitest files by logical unit will not require changes to test setup or package scripts, because Vitest already discovers multiple `*.test.ts` files.
- The Vitest discovery assumption is high-confidence but should still be validated by running targeted tests and `pnpm maintainability:check`.

## Goal

Reduce oversized and near-oversized test files while preserving behavior, coverage, and assertion strength.

All test files that start above 1,000 lines should end at 1,000 lines or fewer, with no production behavior, public API, daemon route, event schema, or package version changes.

## Approach

Implement this as a test-only refactor:

- Split tests by existing logical `describe` boundaries and suite responsibilities.
- Preserve coverage and assertions.
- Extract repeated fixture builders, event factories, temporary-directory setup, route helpers, and assertion helpers into focused support modules when useful.
- Keep every changed or newly created test file at 1,000 lines or fewer.
- Prefer substantially smaller files when natural logical splits exist.
- Avoid moving helpers into production packages unless tests already depend on exported production utilities.
- Update `scripts/agent-maintainability-baseline.json` after files are reduced.
- Run targeted Vitest commands for changed suites.
- Run `pnpm maintainability:check`.
- Run `pnpm type-check`.

Primary implementation targets and suggested split strategy:

- `packages/client/src/__tests__/events-schemas.test.ts` should be split by event-domain families. Evidence: 4,144 lines, 39 `describe` blocks, and an existing nearby precedent `packages/client/src/__tests__/events-schemas-build-evaluator.test.ts`. Candidate files include schema lifecycle/core variants, auto-build/daemon snapshot variants, extension diagnostic/policy/input-source variants, queue/profile/landing/stack variants, dynamic perspective/reviewer variants, validation evidence/gap-close variants, and registry/projector diagnostics.
- `packages/client/src/__tests__/events-wire-parity.test.ts` should move large valid/invalid payload fixture definitions into a local fixture/helper module and split parity checks by valid payloads, invalid payloads, and stack-sync lifecycle cases. Evidence: 2,263 lines with only 7 `describe` blocks and the first suite starting around line 1,830, indicating large setup data dominates the file.
- `test/recovery.test.ts` should be split by recovery responsibilities: verdict parsing/schema/YAML, sidecar writing and movement, failure-summary reconstruction, recovery analyst wiring, and `EforgeEngine.recover` behavior. Evidence: 2,544 lines and 10 clear `describe` blocks spanning parser, sidecar, summary, wiring, and engine behavior.
- `test/agent-wiring.test.ts` should be split by agent stage families and shared config/runtime concerns: planner/review/build/evaluator wiring, module/architecture/PRD validator wiring, stage registry/validation metadata, agent config resolution/thinking coercion, retry policy registration, runtime registry/profile override, and parallel review. Evidence: 2,329 lines and 23 `describe` blocks.
- `test/retry.test.ts` should be split into retry policy tests, continuation input builder tests, generic `withRetry` control-flow tests, terminal-success/drop detection helper tests, and StubHarness integration tests. Evidence: 2,201 lines and 27 `describe` blocks.
- `test/config-backend-profile.test.ts` should be split by scope and migration concern: project-scope profile operations, user-scope profile operations, local/three-tier resolution, backend-to-profile migration, profile metadata, and legacy raw config parsing. Evidence: 1,984 lines and 29 `describe` blocks.
- `test/orchestration-logic.test.ts` should be split into state/failure/merge helpers, executePlans failure-handling, model tracking/concurrency isolation, validation/gap-close gates, and resume seeding. Evidence: 1,695 lines and 12 `describe` blocks.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` should be split by reducer projection family and selectors: batch seed/session/queue events, auto-build/connection/selectors, activity/heartbeat/lifecycle/scheduler, recovery/orphan/warning events, and stack-layer projections/selectors. Evidence: 1,593 lines and 30 `describe` blocks.
- `test/playbook-api.test.ts` should be split into playbook CRUD routes, playbook run/promote/demote/validate routes, playbook profile behavior, enqueue landing auto-merge validation, and enqueue dependency validation. Evidence: 1,474 lines and the file mixes playbook API with generic enqueue validation route coverage.
- `test/extension-tooling-routes.test.ts` should be split inside the single large route suite by operation family: list/show/validate/test, scaffold/promote/demote, trust/untrust, install/update/remove, and route error handling. Evidence: 1,410 lines with one `describe` block and 38 tests.
- `test/monitor-reducer.test.ts` should be split into core reducer event handling, enqueue/batch status handling, summary stats/selectors, agent usage/thread fields, and event-registry run projection. Evidence: 1,389 lines and 7 `describe` blocks.
- `test/queue-scheduler.test.ts` should be split into policy/input/queue mutation behavior, queue completion outcomes, pause/suspension behavior, lock-aware startup/claimed child results, and runtime lock reconciliation. Evidence: 1,338 lines and 11 `describe` blocks.
- `test/landing-actions.test.ts` should be split by landing action: merge to base, leave branch, issue PR, and shared setup/helpers. Evidence: 1,324 lines and only 20 tests, likely because integration-style setup is substantial.
- `test/stack-runtime-landing.test.ts` should be split by stack landing behavior: PR argv/events, URL discovery/persistence, non-PR/non-stacked paths, failure/provider errors, auto-merge, metadata editing, and base preflight/repair. Evidence: 1,280 lines and 10 `describe` blocks.
- `test/daemon-session-plan-routes.test.ts` should be split by route family: list/show/create/read/write/status routes, dimension selection/readiness/migration, traversal rejection, enqueue auto-submit, create-from-playbook, AC quality diagnostics/status gate. Evidence: 1,279 lines and 14 `describe` blocks.
- `test/profile-wiring.test.ts` should be split by consumer surface and parity concern: plugin metadata/skills, Pi skills, init/profile MCP registration, Pi native command modules, toolbelt preset/config source assertions, docs/README native command assertions, and enqueue dependency/forwarding parity. Evidence: 1,191 lines, 24 `describe` blocks, and 141 tests.
- `test/daemon-recovery.test.ts` should be split by route/helper/engine concern: API route constants and recovery routes, sidecar movement/path behavior, DB-backed fallback recovery scenarios, deterministic verdict metadata, and inline queue finalization. Evidence: 1,190 lines, 12 `describe` blocks, and baseline history at 1,230 lines.
- `test/pipeline.test.ts` should be split by pipeline phase and shared concerns: stage registry/metadata, compile pipeline, build pipeline, mutable context and agent config threading, parallel/dirty-worktree behavior, default stage list/options/model resolution, and planner dependency override cases. Evidence: 1,158 lines and 13 `describe` blocks.
- `test/config.test.ts` should be split by config responsibility: resolving/merging/defaults, schema validation, config file discovery/legacy detection, SDK/thinking/roles schemas, extension/pi/tier schemas, monitor/build fields, profile-name sanitization, waiver config, and stacking sync config. Evidence: 1,097 lines and 29 `describe` blocks.
- `test/extension-tooling-wiring.test.ts` should be split by wiring surface: CLI enqueue preprocessing, route constants/helpers, CLI command registration, native runtime wiring, documentation assertions, plugin metadata, MCP/Pi parity, and CLI `--after` wiring. Evidence: 1,024 lines and 8 `describe` blocks.
- `test/playbook.test.ts` should be split by input package responsibility: validation/frontmatter schemas, parse/serialize round trips, build-source conversion, plan seed conversion, read/write/list/move scoped behavior, bundled playbooks, and profile field behavior. Evidence: 1,002 lines and 14 `describe` blocks.

Shared helper impact:

- Existing helper files such as `test/stub-harness.ts`, `test/test-tmpdir.ts`, and `test/test-events.ts` should be reused where appropriate.
- New helper modules should be named by suite family, for example `test/recovery-helpers.ts`, `test/profile-test-helpers.ts`, or package-local `__tests__/events-schema-fixtures.ts` if they are test-only support files.
- Avoid moving helpers into production packages unless tests already depend on exported production utilities.

Validation impact:

- `vitest.main.config.ts` already includes `test/**/*.test.ts`, `packages/client/src/__tests__/**/*.test.ts`, and `packages/monitor-ui/src/**/*.test.ts`, so split files in those locations should be discovered without config changes.
- `package.json` already runs `vitest run` after the skill parity check in `pnpm test`.
- No script changes are expected.
- After split files fall under 1,000 lines, remove their test entries from `scripts/agent-maintainability-baseline.json` because they are also below the repository-enforced 1,200-line test cap.
- Run `pnpm maintainability:check` to confirm no cap or marker violations.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The cleanup target should be 1,000 lines rather than only the policy cap of 1,200. | User explicitly requested using 1,000 lines so tests are not left close to 1,200. | high | low | Final line-count scan using the same `find ... wc -l` command. | Files may still be too close to the policy cap if the build only targets 1,200. |
| Splitting tests into additional `*.test.ts` files in the same directories will be discovered by Vitest without config changes. | `vitest.main.config.ts` includes `test/**/*.test.ts`, `packages/client/src/__tests__/**/*.test.ts`, and `packages/monitor-ui/src/**/*.test.ts`. | high | low | Run targeted Vitest commands for changed split suites and inspect failures if any file is not discovered. | Split tests might not run, creating false confidence. |
| Moving assertions between files can preserve behavior without production changes. | The oversized files show many logical `describe` boundaries that can become separate files; project policy says tests should be grouped by logical unit. | high | medium | Run targeted Vitest commands and `pnpm type-check`; review diffs for deleted assertions. | Coverage could be weakened or hidden behavior changes could be introduced. |
| Shared test helper extraction will reduce file sizes without hiding test intent. | Several files have high line counts with relatively few tests, such as `events-wire-parity.test.ts` and `landing-actions.test.ts`, which suggests large setup/fixtures. | medium | medium | During implementation, extract only repeated setup or fixture data and keep assertions close to tests. | Over-abstracted helpers could make tests harder to understand. |
| All test baseline entries can be removed after this cleanup. | The existing test baseline entries are all at or above the 1,200 cap; the planned 1,000-line cap would make those entries unnecessary if all targeted files are reduced successfully. | high | low | Run `pnpm maintainability:check` after editing `scripts/agent-maintainability-baseline.json`. | Baseline could retain stale exemptions and weaken future ratcheting. |
| Running the full `pnpm test` may be slower than necessary during iterative splits. | The repository has a large Vitest suite and the plan spans many test files. | medium | low | Use targeted Vitest commands during edits, then run broader validation if feasible; always run `pnpm maintainability:check` and `pnpm type-check`. | A cross-suite interaction could be missed if only targeted tests run before final validation. |

No low-confidence/high-impact assumption is currently unresolved.

The main validation risk is accidental test non-discovery or assertion loss, and both are addressed by targeted Vitest runs, type-checking, maintainability checks, and final line-count reporting.

Recommended profile: **Excursion**.

Rationale:

- This is too broad for Errand because it touches many large test suites and requires careful preservation of test coverage.
- This does not require Expedition because the work is cohesive: split tests by existing logical `describe` boundaries, extract test-only helpers where useful, and validate with targeted Vitest commands plus maintainability checks.
- A single planner can enumerate the target files, split strategy, and validation criteria without delegating independent module-planning work.

## Scope

In scope:

- Use **1,000 lines** as the working cap for this cleanup, not merely the repository-enforced 1,200-line cap.
- Leave headroom so files are not immediately close to failing the hard cap again.
- Split every currently observed test file above 1,000 lines into smaller logical test files or helper modules.
- Prioritize the 21 confirmed files above 1,000 lines: `packages/client/src/__tests__/events-schemas.test.ts`, `test/recovery.test.ts`, `test/agent-wiring.test.ts`, `packages/client/src/__tests__/events-wire-parity.test.ts`, `test/retry.test.ts`, `test/config-backend-profile.test.ts`, `test/orchestration-logic.test.ts`, `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts`, `test/playbook-api.test.ts`, `test/extension-tooling-routes.test.ts`, `test/monitor-reducer.test.ts`, `test/queue-scheduler.test.ts`, `test/landing-actions.test.ts`, `test/stack-runtime-landing.test.ts`, `test/daemon-session-plan-routes.test.ts`, `test/profile-wiring.test.ts`, `test/daemon-recovery.test.ts`, `test/pipeline.test.ts`, `test/config.test.ts`, `test/extension-tooling-wiring.test.ts`, and `test/playbook.test.ts`.
- Keep every changed or newly created test file at 1,000 lines or fewer.
- Prefer substantially smaller files when natural logical splits exist.
- Extract repeated fixture builders, event factories, temporary-directory setup, route helpers, and assertion helpers into focused support modules when that reduces duplicated setup without hiding test intent.
- Update `scripts/agent-maintainability-baseline.json` by removing test entries that are no longer needed under the 1,200-line policy.
- Remove all test baseline entries if every previously baseline-listed test file is reduced below 1,000 lines.
- Run targeted Vitest commands for changed suites.
- Run `pnpm maintainability:check`.

Out of scope:

- Changing production behavior.
- Changing public APIs.
- Changing daemon routes.
- Changing event schemas.
- Changing package versions.
- Reducing assertion strength.
- Deleting coverage solely to reduce line counts.
- Rewriting large tests wholesale without bounded, reviewable moves.
- Refactoring implementation files except for possible test-only helper exports if absolutely necessary.
- Adding test-only production exports unless there is a clear existing pattern.
- Migrating `packages/monitor-ui` tests to `packages/console-ui`; monitor-ui can be split in place because it remains included in the main Vitest config.

## Acceptance Criteria

- Every test file that is above 1,000 lines at the start of this work is reduced to 1,000 lines or fewer.
- Every newly created test file is 1,000 lines or fewer.
- Every changed pre-existing test file is 1,000 lines or fewer.
- `scripts/agent-maintainability-baseline.json` contains no `category: "test"` entry for a test file that is 1,200 lines or fewer after the refactor.
- `pnpm maintainability:check` exits 0.
- Targeted Vitest commands for each changed package or split suite exit 0.
- `pnpm type-check` exits 0.
- No production file is changed unless the change is required for a test-only helper export and the session summary explains why the production change was necessary.
- Existing test assertions are preserved or strengthened.
- No test case is deleted solely to reduce line count.
- `vitest.main.config.ts` does not require include-pattern changes for split files under `test/`, `packages/client/src/__tests__/`, or `packages/monitor-ui/src/`.
- Files split out of `packages/client/src/__tests__/events-schemas.test.ts` continue to import event schemas and parser helpers from `@eforge-build/client` rather than redefining event wire shapes locally.
- Route tests continue to use `API_ROUTES` and `buildPath()` or typed client route helpers instead of introducing new inline `/api/...` path literals.
- The final line-count report shows zero test files above 1,000 lines outside `node_modules/`, `dist/`, and `.git`.
