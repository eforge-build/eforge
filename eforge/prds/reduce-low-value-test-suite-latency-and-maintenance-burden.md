---
title: Reduce Low-Value Test Suite Latency and Maintenance Burden
created: 2026-06-04
landing: pr
landing_auto_merge: true
---

# Reduce Low-Value Test Suite Latency and Maintenance Burden

## Problem / Motivation

The test suite has measurable latency and maintenance burden in specific areas, especially timer-heavy scheduler/watch/stream tests and repeated matrix-style coverage. This work is a conservative first thinning pass based on confirmed audit findings, not a request to re-run the audit.

This session was seeded from the `test-thinning-audit` planning playbook and already includes the investigation findings. The current handoff identifies conservative implementation targets from confirmed evidence.

Roadmap alignment: this is maintenance/tooling work that reduces suite latency and test maintenance burden without introducing new user-facing behavior.

Evidence sources used during investigation:
- Static inventory/search over `test/`, `packages/`, and `web/` for Vitest test files, timers, mocks, snapshot assertions, and skipped tests.
- Targeted Vitest run for timer-heavy candidates.
- Targeted Vitest run for client event schema/parity suites.
- Direct reads of representative high-latency and high-maintenance test files.

Confirmed investigation evidence:
- The repository currently has 482 Vitest-style test files under `test/`, `packages/`, and `web/`, totaling 135,500 test lines.
- The largest test concentrations are `test/` with 330 files, `packages/console-ui/src` with 69 files, `packages/monitor/src` with 59 files, and `packages/client/src` with 19 files.
- Static timer scan found real waits in scheduler/watch/stream tests, including `test/artifact-aware-scheduler.test.ts`, `test/auto-build-resume-after-failure.test.ts`, `test/watch-queue.test.ts`, `test/periodic-file-check.test.ts`, `packages/monitor/src/__tests__/streams-stream-hub.test.ts`, and related queue/daemon tests.
- A targeted run of timer-heavy candidates passed before any edits: 39 tests across 5 files passed in 3.51s wall time, with 7.04s aggregate test time.
- `packages/monitor/src/__tests__/streams-stream-hub.test.ts` had a broadcast test that took 1005ms.
- `test/auto-build-resume-after-failure.test.ts` had a first test that took 624ms.
- Several `test/artifact-aware-scheduler.test.ts` cases took approximately 186–355ms each.
- Snapshot-heavy low-signal tests were not found: `toMatchSnapshot` and `toMatchInlineSnapshot` both had 0 hits.
- Skipped tests are mostly platform/privilege guards, not stale dead tests.
- Skipped-test hits were `test/exec-with-timeout.test.ts`, `test/queue-scheduler-reconciliation.test.ts`, and `packages/monitor/src/__tests__/http-static-assets.test.ts`.
- Over-mocking is limited but present in UI/command boundary tests: 64 `vi.mock` occurrences across 15 files.
- The highest `vi.mock` concentration was `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` with 25 client-helper mocks.
- Event schema tests are large in count but cheap at runtime: 13 client schema/parity files ran 513 tests in 263ms wall time and 99ms aggregate test time.
- Client event schema/parity suites should be treated as maintenance-burden candidates only, not speed candidates.
- There are no snapshot assertion hits in the audited test files.

## Goal

Reduce test-suite latency and maintenance burden without reducing coverage of user-facing behavior.

Implement a conservative first thinning pass focused on deterministic synchronization, table-driven consolidation, and only high-confidence removal of redundant low-value tests.

## Approach

Relevant project conventions:
- Tests should use real code rather than mocks when practical.
- UI/command boundary tests may still mock external clients and UI surfaces.
- New and edited files must respect maintainability guardrails.
- Run `pnpm maintainability:check` before submitting.
- Route constants and daemon wire shapes are owned by `@eforge-build/client`.
- Any test thinning must preserve wire-contract confidence.

High-level implementation approach:
- Replace real-time sleeps and polling waits in high-latency tests with deterministic synchronization, fake timers, explicit queue drains, extracted tick helpers, or small testability seams where behavior remains covered.
- Collapse obviously redundant variants into table-driven coverage where the same code path is exercised repeatedly.
- Remove only high-confidence low-value tests whose behavior is already covered by an adjacent test or a lower-level contract test.
- Keep route/API, wire-contract, and real integration tests when they provide unique confidence.

Implementation targets:
- For `test/artifact-aware-scheduler.test.ts`, `test/auto-build-resume-after-failure.test.ts`, `test/watch-queue.test.ts`, `test/periodic-file-check.test.ts`, and `packages/monitor/src/__tests__/streams-stream-hub.test.ts`, replace arbitrary `setTimeout`/`sleep` waits with deterministic events, explicit queue drains, fake timers, or extracted tick helpers.
- In timer-heavy scheduler and stream tests, collapse or table-drive tests where two tests exercise the same state transition with only a status literal difference.
- In `test/watch-queue.test.ts`, evaluate removing or collapsing the `abortableSleep` “returns false with no signal provided” case because it appears redundant with the normal timer completion case unless `undefined` handling has a documented regression.
- In `test/queue-scheduler-onsuccess-propagation.test.ts`, evaluate whether the file still provides unique confidence after `prd-frontmatter-onsuccess`, `playbook-api-run-profile`, queue recovery, and landing action tests.
- Prefer deleting or reducing `test/queue-scheduler-onsuccess-propagation.test.ts` to one representative test if no unique scheduler-specific behavior remains.
- Treat `test/queue-scheduler-onsuccess-propagation.test.ts` as possible implementation-detail coverage because it appears to test that the scheduler passes through a `QueuedPrd` object unchanged.
- In `test/playbook-api-run-profile.test.ts`, preserve route-level behavior while consolidating repeated planning-mode bypass cases and repeated autonomous error-precedence cases into table-driven tests.
- In `test/playbook-api-run-profile.test.ts`, keep one full filesystem/queue assertion for autonomous enqueue.
- In `test/playbook-api-run-profile.test.ts`, keep one full no-write assertion for planning mode.
- In `test/playbook-api-run-profile.test.ts`, lighter variants can assert status/body only if the shared no-write behavior is already covered.
- In `test/pi-playbook-commands.test.ts`, table-drive `landingAction`, `afterQueueId`, fallback, and `landingAutoMerge` propagation cases.
- Do not delete `packages/client/src/__tests__/events-schemas*.test.ts` or `packages/client/src/__tests__/events-wire-parity*.test.ts` for runtime reasons.
- Optionally reduce client event schema suite maintenance burden later by moving repeated accept/reject shape cases into fixture-driven tables.
- Keep client event schema/parity suites because they are cheap and protect the daemon wire contract.

Recommended eforge profile: **Excursion**.

Rationale: this is a cohesive maintenance/refactor-style pass across several test files. A single planner can enumerate the implementation targets and dependencies with enough detail. It is not trivial enough for Errand because it requires judgment about coverage preservation and deterministic test design, but it does not require delegated module planning or architecture-level decomposition, so Expedition would be overkill.

## Scope

In scope:
- Replace real-time sleeps / polling waits in high-latency tests with deterministic synchronization, fake timers, or narrower helpers where the behavior remains covered.
- Collapse obviously redundant test variants into table-driven coverage where the same code path is exercised repeatedly.
- Remove only high-confidence low-value tests whose behavior is already covered by an adjacent test or a lower-level contract test.
- Keep route/API, wire-contract, and real integration tests when they provide unique confidence.

Out of scope:
- Do not broadly delete scheduler, stream, playbook, or event-schema coverage.
- Do not change production behavior except small testability seams needed to remove real-time waits.
- Do not replace Vitest, rewrite the whole test harness, or perform a full suite rearchitecture.
- Do not thin snapshot tests; none were found because `toMatchSnapshot` and `toMatchInlineSnapshot` count was 0.

## Acceptance Criteria

- `pnpm vitest run test/artifact-aware-scheduler.test.ts test/auto-build-resume-after-failure.test.ts test/watch-queue.test.ts test/periodic-file-check.test.ts packages/monitor/src/__tests__/streams-stream-hub.test.ts --reporter verbose` exits 0 after timer-heavy tests are changed.
- If playbook or command tests are changed, `pnpm vitest run test/pi-playbook-commands.test.ts test/cli-playbook.test.ts test/playbook-api-run-profile.test.ts --reporter verbose` exits 0.
- Scheduler dependency/artifact success behavior remains covered by tests.
- Scheduler dependency/artifact failure behavior remains covered by tests.
- Scheduler dependency/artifact skipped behavior remains covered by tests.
- Scheduler dependency/artifact stale artifact behavior remains covered by tests.
- Scheduler dependency/artifact ambiguous stack-parent behavior remains covered by tests.
- Planning-mode playbooks remain covered for bypassing enqueue writes.
- Planning-mode playbooks remain covered for bypassing session-plan writes.
- Autonomous playbooks remain covered for enqueue behavior.
- Landing action propagation remains covered for immediate paths through individual tests or a clear table-driven matrix.
- Landing action propagation remains covered for delayed paths through individual tests or a clear table-driven matrix.
- Landing action propagation remains covered for stale-upstream fallback paths through individual tests or a clear table-driven matrix.
- `landingAutoMerge` propagation remains covered for immediate paths through individual tests or a clear table-driven matrix.
- `landingAutoMerge` propagation remains covered for delayed paths through individual tests or a clear table-driven matrix.
- `landingAutoMerge` propagation remains covered for stale-upstream fallback paths through individual tests or a clear table-driven matrix.
- Real-time waits in `test/artifact-aware-scheduler.test.ts` are reduced by using deterministic waits, fake timers, explicit event drains, extracted tick helpers, or small testability seams instead of arbitrary sleep constants.
- Real-time waits in `test/auto-build-resume-after-failure.test.ts` are reduced by using deterministic waits, fake timers, explicit event drains, extracted tick helpers, or small testability seams instead of arbitrary sleep constants.
- Real-time waits in `test/watch-queue.test.ts` are reduced by using deterministic waits, fake timers, explicit event drains, extracted tick helpers, or small testability seams instead of arbitrary sleep constants.
- Real-time waits in `test/periodic-file-check.test.ts` are reduced by using deterministic waits, fake timers, explicit event drains, extracted tick helpers, or small testability seams instead of arbitrary sleep constants.
- Real-time waits in `packages/monitor/src/__tests__/streams-stream-hub.test.ts` are reduced by using deterministic waits, fake timers, explicit event drains, extracted tick helpers, or small testability seams instead of arbitrary sleep constants.
- Each deleted test is mentioned in the implementation summary with the adjacent test or lower-level contract that still covers the behavior.
- `pnpm maintainability:check` exits 0.
- Any production testability seam added for deterministic tests is small.
- Any production testability seam added for deterministic tests is documented by tests.
- Any production testability seam added for deterministic tests does not change runtime behavior.

## Manual Verification Notes

Assumptions to validate during implementation:
- Some queue scheduler waits are assumed to be arbitrary stabilization waits rather than required wall-clock behavior.
- Validate queue scheduler wait replacement by replacing one file at a time with deterministic event observation and proving the tests remain non-flaky locally.
- `test/queue-scheduler-onsuccess-propagation.test.ts` may be redundant because it checks pass-through of a `QueuedPrd` object rather than user-visible behavior.
- Validate `test/queue-scheduler-onsuccess-propagation.test.ts` against `test/prd-frontmatter-onsuccess.test.ts`, `test/playbook-api-run-profile.test.ts`, and landing action tests before deleting or collapsing.
- Several planning-mode playbook route variants appear to repeat the same bypass guarantee.
- Validate planning-mode playbook route variants by retaining representative cases for each distinct precedence rule before table-driving or removing variants.

Validation approach:
- Make one thinning/refactor category at a time and run the targeted Vitest command listed in the acceptance criteria before moving to the next category.
- Prefer measuring before/after wall time for the targeted files and include the timing delta in the implementation summary.
- If a proposed deletion lacks an adjacent test or lower-level contract, keep the test and mark it as a non-goal for this pass.