---
title: First-pass Test Thinning for eforge Automated Tests
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# First-pass Test Thinning for eforge Automated Tests

## Problem / Motivation

The completed `test-thinning-audit` investigation identified low-value duplicate tests in the eforge automated test suite. The first implementation pass should reduce duplicated legacy `monitor-ui` test coverage while preserving confidence in active behavior.

Evidence reviewed:

- Repository guidance in `AGENTS.md` identifies `packages/console-ui/` as the active monitoring dashboard and `packages/monitor-ui/` as legacy retained during the port.
- A full local Vitest run completed successfully and wrote `.eforge/tmp/test-thinning-vitest.json`.
- Source scans identified duplicated test pairs, git-heavy test files, validation-matrix overlap, and large-but-fast client event schema tests.

Classification: maintenance / focused.

This is test-suite maintenance with a bounded implementation scope and explicit guardrails against reducing production confidence.

## Goal

Implement the concrete first-pass test-thinning plan produced by the completed audit. Remove or consolidate low-value duplicate legacy `monitor-ui` tests while preserving active `console-ui` behavioral coverage and confidence.

## Approach

Use the completed audit’s concrete 14-file target list rather than running another broad audit.

Implementation plan:

1. Leave all corresponding `packages/console-ui` duplicate files unchanged.
2. For each of the 14 listed `monitor-ui` files, replace the copied behavioral matrix with compact smoke/parity coverage.
3. The smoke/parity coverage must import through the `monitor-ui` path currently used by the file and exercise representative behavior; it must not be import-only coverage.
4. If a listed `monitor-ui` file contains `monitor-ui`-only assertions after inspection, keep those assertions or document why the file was not thinned.
5. Do not add new thinning targets during implementation.

Suggested replacement shape:

- Reducer/handler files should keep one or a small number of smoke tests per handler group that invokes representative `monitor-ui` handler behavior and asserts a meaningful state delta.
- Regression files should keep the smallest `monitor-ui`-specific regression smoke that proves the legacy reducer path still handles the scenario.
- Pipeline component/helper files should keep compact tests that exercise the `monitor-ui` component/helper import path and one representative behavior.

Architecture impact:

- No production architecture impact is expected.
- The implementation operates within existing test boundaries.
- A small `monitor-ui` test helper may be added if repeated smoke/parity setup would otherwise be duplicated.
- Active `console-ui` behavioral tests should remain the canonical coverage for shared dashboard reducer/handler behavior.

Design decisions:

- Thin legacy `monitor-ui` duplicates first because `console-ui` is the active dashboard and the sampled pairs are near-exact duplicates.
- Keep slow git-heavy and API-route validation thinning out of this PRD to avoid mixing low-risk duplicate removal with judgment-heavy integration coverage decisions.
- Keep `packages/client` event wire/schema tests intact because they are fast and protect daemon/client compatibility.
- Prefer smaller `monitor-ui` smoke/parity tests over shared factory refactors unless a helper is clearly simpler than repeated setup.

Documentation impact:

- No public documentation changes are expected.
- If a reusable test helper is introduced, include local comments only where needed to explain why `monitor-ui` keeps smoke/parity coverage while `console-ui` owns the full behavioral matrix.

Risks and mitigations:

- A supposedly duplicate `monitor-ui` test may contain `monitor-ui`-specific behavior.
  - Mitigation: inspect each pair before thinning and preserve `monitor-ui`-only cases.
- Smoke/parity coverage may be too thin if it only proves imports.
  - Mitigation: each thinned `monitor-ui` file should still exercise representative behavior, not just module loading.
- Narrow validation could miss cross-package setup issues.
  - Mitigation: run affected `monitor-ui` and `console-ui` tests plus maintainability checks, and run the full suite if practical.

Validation commands:

- Run the changed `monitor-ui` tests and the corresponding unchanged `console-ui` tests.
- Run `pnpm maintainability:check`.
- Run full `pnpm test` if practical; otherwise report the narrower validation explicitly.

Confirmed facts:

- The audit is complete; implementation should use the concrete 14-file target list rather than run another broad audit.
- `packages/console-ui/` is the active monitoring dashboard and `packages/monitor-ui/` is retained as legacy, per `AGENTS.md`.
- The full Vitest run completed successfully before planning and wrote `.eforge/tmp/test-thinning-vitest.json`.
- Pairwise source comparison identified 14 exact or near-exact `monitor-ui`/`console-ui` duplicate test pairs.
- The 14 `monitor-ui` targets total about 2,668 lines and 157 test cases before thinning.

Material assumptions:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The 14 listed `monitor-ui` files are the correct first-pass thinning targets. | Pairwise source comparison found exact or near-exact duplicates against active `console-ui` tests. | high | low | Inspect each listed file before editing it to catch `monitor-ui`-only assertions. | A `monitor-ui`-specific assertion could be thinned accidentally. |
| Active `console-ui` coverage can remain the behavioral source of truth for these shared dashboard behaviors. | `AGENTS.md` identifies `console-ui` as active and `monitor-ui` as legacy. | high | low | Keep `console-ui` tests unchanged and run their targeted tests after `monitor-ui` thinning. | Shared behavior coverage could be weakened if `console-ui` tests were changed or failing. |
| Compact `monitor-ui` smoke/parity tests are sufficient for legacy import-path confidence. | The target files are duplicates of active `console-ui` behavior, and `monitor-ui` is legacy. | medium | low | Ensure each thinned file still invokes representative behavior through the `monitor-ui` import path. | `monitor-ui`-specific integration regressions might have less detailed coverage. |

Implementation validation must be file-specific, but not exploratory: inspect the 14 listed files to preserve `monitor-ui`-only assertions, then thin those targets only.

Recommended profile: **Excursion**.

Rationale:

- The first implementation pass is cohesive test-suite maintenance, not a trivial single-file errand.
- A single planner session can enumerate the candidate files, guardrails, and validation paths without delegated module planning.
- Expedition is not warranted because the work should be split by judgment level rather than by independently planned subsystems.

## Scope

In scope:

- Thin the listed legacy `packages/monitor-ui` duplicate tests because equivalent active `packages/console-ui` behavioral coverage exists.
- Preserve the corresponding `packages/console-ui` files unchanged as the behavioral source of truth.
- Replace each thinned legacy `monitor-ui` behavioral matrix with compact smoke/parity coverage that proves the `monitor-ui` import path still works and exercises representative behavior.
- Add a small test helper only if it clearly reduces repeated smoke setup.

Out of scope:

- Do not remove active `packages/console-ui` behavioral coverage.
- Do not thin `packages/client` event wire/schema tests.
- Do not thin slow real-git landing/worktree/recovery integration tests in this pass.
- Do not thin playbook API route tests in this pass.
- Do not change production source behavior.
- Do not search for additional thinning opportunities beyond the concrete target list below, except for helper files needed to implement the target list.

Concrete target list from the audit:

- `packages/monitor-ui/src/lib/reducer/__tests__/handle-agent.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-daemon.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-enqueue.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-expedition.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-plan-build.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-planning.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-session.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-validation.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/regression-orchestration-gap.test.ts`
- `packages/monitor-ui/src/lib/reducer/__tests__/regression.test.ts`
- `packages/monitor-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx`
- `packages/monitor-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts`
- `packages/monitor-ui/src/components/pipeline/__tests__/compute-depth-map.test.ts`

Audit evidence for the target list:

- 14 `monitor-ui`/`console-ui` pairs were exact or near-exact duplicates after ignoring import-path differences.
- Candidate `monitor-ui` footprint: about 2,668 lines and 157 test cases.
- `handle-agent.test.ts`: 622 `monitor-ui` lines / 622 `console-ui` lines, 28 `monitor-ui` tests, normalized similarity 1.00.
- `handle-plan-build.test.ts`: 320 / 320 lines, 26 tests, normalized similarity 0.99.
- `handle-validation.test.ts`: 266 / 266 lines, 12 tests, normalized similarity 0.99.

Expected code impact:

- Expected code impact is limited to legacy `monitor-ui` test files and optional test helpers.

## Acceptance Criteria

- The implementation changes only files under `packages/monitor-ui/**/__tests__/**` and optional `monitor-ui` test helper files unless another changed file is explicitly justified in the implementation summary.
- No file under `packages/console-ui/**/__tests__/**` is changed.
- No `packages/client` event wire/schema test file is changed.
- No slow real-git landing, worktree, trunk-sync, recovery, or playbook API integration test is changed.
- Each of the 14 listed `monitor-ui` target files is either thinned to compact smoke/parity coverage or explicitly listed in the implementation summary as intentionally unchanged with a reason.
- Each thinned `monitor-ui` target file retains at least one assertion that exercises representative behavior through the `monitor-ui` import path.
- The implementation does not add additional thinning targets beyond the 14 listed `monitor-ui` files.
- The total test case count across the 14 listed `monitor-ui` files is lower after the change than before the change.
- The total line count across the 14 listed `monitor-ui` files is lower after the change than before the change.
- The implementation summary lists the before-and-after test case count across the 14 listed `monitor-ui` files.
- The implementation summary lists the before-and-after line count across the 14 listed `monitor-ui` files.
- A targeted Vitest command covering the changed `monitor-ui` tests exits 0.
- A targeted Vitest command covering the corresponding `console-ui` tests exits 0.
- `pnpm maintainability:check` exits 0.
