---
id: plan-02-consolidate-playbook-test-matrices
name: Consolidate Playbook and Command Test Matrices
branch: reduce-low-value-test-suite-latency-and-maintenance-burden/plan-02-consolidate-playbook-test-matrices
agents:
  builder:
    effort: high
    rationale: Consolidation changes many assertions; the builder must preserve
      route, command, and landing propagation coverage while deleting only
      redundant tests.
  reviewer:
    effort: high
    rationale: Review must verify that each removed or table-driven case still has
      adjacent coverage.
---

# Consolidate Playbook and Command Test Matrices

## Architecture Context

Playbook route tests and Pi command tests protect user-facing enqueue behavior, planning-mode bypass behavior, and landing propagation. The goal is to reduce maintenance burden by consolidating repeated setup/assertion matrices while preserving route-level and command-boundary confidence. Client event schema/parity suites are cheap wire-contract coverage and remain untouched.

## Implementation

### Overview

Refactor repeated playbook route and Pi command cases into explicit tables with named scenarios. Keep one full filesystem assertion for autonomous enqueue and one full planning-mode no-write assertion. Delete the scheduler landing pass-through file only if the implementation summary maps each removed assertion to existing frontmatter/precedence tests.

### Key Decisions

1. Keep route-level tests for autonomous enqueue, planning-mode requires-agent responses, dependency classification, and landing propagation.
2. Use tables for scenarios that share setup, request shape, and assertions with only body fields or status literals changing.
3. Treat `test/queue-scheduler-onsuccess-propagation.test.ts` as redundant implementation-detail coverage because it verifies the scheduler passes an already-loaded `QueuedPrd` object through unchanged; lower-level PRD frontmatter tests and precedence tests cover the user-visible behavior.

## Scope

### In Scope

- Table-drive repeated planning-mode bypass cases in `test/playbook-api-run-profile.test.ts`.
- Table-drive repeated autonomous error-precedence cases in `test/playbook-api-run-profile.test.ts`.
- Preserve one full autonomous enqueue filesystem/queue assertion and one full planning-mode session-plan/queue no-write assertion.
- Table-drive Pi playbook command `landingAction`, `afterQueueId`, fallback, and `landingAutoMerge` propagation cases.
- Delete or reduce `test/queue-scheduler-onsuccess-propagation.test.ts`; if deleted, document the adjacent coverage in the implementation summary.

### Out of Scope

- Deleting client event schema or wire parity suites.
- Broadly deleting scheduler, playbook, or landing coverage.
- Changing route constants, daemon wire shapes, or client API helpers.
- Plugin or Pi user-facing behavior changes.

## Files

### Modify

- `test/playbook-api-run-profile.test.ts` — Extract route-test helpers for writing playbooks, posting `API_ROUTES.playbookRun`, checking requires-agent bodies, checking queue markdown absence, and reading frontmatter. Consolidate planning-mode bypass cases into a table while keeping the existing full no-session-plan/no-queue assertion as the representative no-write test. Consolidate repeated autonomous AC/error precedence cases into a table while keeping one full no-write assertion. Consider table-driving failed/skipped upstream dependency 404 cases because only the terminal directory differs.
- `test/pi-playbook-commands.test.ts` — Extract command scenario helpers for queue state, landing-gate result, mock enqueue behavior, and expected enqueue body. Convert project-default, explicit `leave`, delayed `afterQueueId`, stale-upstream fallback, and `landingAutoMerge` cases into named `it.each` tables. Preserve planning-mode delegation, landing-gate ordering, and cancellation tests.

### Delete

- `test/queue-scheduler-onsuccess-propagation.test.ts` — Delete if the implementation summary cites the adjacent coverage: `test/prd-frontmatter-onsuccess.test.ts` covers schema/write/loadQueue round-trip for `landing` and `landing_auto_merge`; `test/onsuccess-override-precedence.test.ts` covers PRD-frontmatter precedence; playbook route/command tests cover request-to-frontmatter propagation.

## Verification

- [ ] `pnpm vitest run test/pi-playbook-commands.test.ts test/cli-playbook.test.ts test/playbook-api-run-profile.test.ts test/prd-frontmatter-onsuccess.test.ts test/onsuccess-override-precedence.test.ts --reporter verbose` exits 0.
- [ ] `test/playbook-api-run-profile.test.ts` contains one full autonomous enqueue assertion that reads the queued PRD from disk.
- [ ] `test/playbook-api-run-profile.test.ts` contains one full planning-mode assertion that verifies no session-plan write, no queue PRD, and no auto-build wake.
- [ ] Planning-mode table cases cover `afterQueueId`, invalid acceptance criteria, missing profile, and valid `landingAction` bypass inputs.
- [ ] Autonomous error-precedence table cases cover AC-before-dependency and AC-before-profile errors.
- [ ] Pi command table cases cover immediate, delayed, and stale-upstream fallback bodies for explicit `landingAction`.
- [ ] Pi command table cases cover immediate, delayed, and stale-upstream fallback bodies for `landingAutoMerge: true`.
- [ ] Pi command table cases cover project-default bodies that omit `landingAction` in immediate, delayed, and fallback paths.
- [ ] Each deleted test from `test/queue-scheduler-onsuccess-propagation.test.ts` is named in the implementation summary with the adjacent test file that still covers the behavior.
- [ ] `pnpm maintainability:check` exits 0.