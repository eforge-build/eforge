---
id: plan-01-recovery-run-selection
name: Prefer Failed Build Runs for Recovery Summaries
branch: show-recovered-plan-context-in-resumed-build-details/plan-01-recovery-run-selection
---

# Prefer Failed Build Runs for Recovery Summaries

## Architecture Context

Compiled-build resume relies on `buildFailureSummary()` to reconstruct the failed build that produced the preserved plan artifacts. The event-history synthesizer currently selects the newest run for a plan set, which lets a newer running `resume` session shadow the original failed `build` session. This plan fixes that selection before adding resume artifact projection.

## Implementation

### Overview

Update recovery event-history run lookup so failure-summary synthesis chooses the latest failed `build` run for `runs.plan_set = ?`. Keep the current newest-run query as a conservative fallback when no failed build run exists.

### Key Decisions

1. Prefer `command = 'build' AND status = 'failed'` because resume eligibility is based on a prior build failure, not the active resume attempt.
2. Keep fallback to the previous newest-run behavior to preserve summaries for legacy databases where command or status values are absent or not terminal.
3. Limit this plan to recovery run selection; the new resume artifact event and UI projection are implemented in the dependent plan.

## Scope

### In Scope
- Change `synthesizeFromEvents()` run selection for failure-summary reconstruction.
- Add regression coverage for a failed build run followed by a running resume run for the same plan set.

### Out of Scope
- Resume artifact event contract and rendering.
- Monitor route changes.
- Console UI changes.
- Database migrations.

## Files

### Create
- None.

### Modify
- `packages/engine/src/recovery/event-history.ts` — replace the single newest-run query with a preferred failed-build query plus fallback newest-run query.
- `test/recovery-terminal-failure.test.ts` — add a regression test that seeds monitor DB with an older failed `build` run and a newer running `resume` run for the same `plan_set`, then asserts `buildFailureSummary()` uses the failed build evidence.

## Verification

- [ ] `buildFailureSummary()` returns the failing plan from the failed `build` run when a newer running `resume` run exists for the same plan set.
- [ ] The fallback newest-run path returns a summary when no failed build run exists.
- [ ] `pnpm test -- --run test/recovery-terminal-failure.test.ts` exits 0.
