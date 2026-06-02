---
id: plan-01-recovery-run-selection
name: Update Recovery Event-History Resume Run Selection
branch: support-second-resume-attempts-from-latest-failed-resume-run/plan-01-recovery-run-selection
---

# Update Recovery Event-History Resume Run Selection

## Architecture Context

Compiled-build resume reconstructs plan state through `buildFailureSummary()`, which delegates monitor DB synthesis to `synthesizeFromEvents()` in `packages/engine/src/recovery/event-history.ts`. `checkResumeEligibility()` consumes that summary, and `deriveResumeSeedState()` classifies plans with `mergedAt` evidence as dependency-satisfied for the next resume attempt.

The current run selection always prefers the latest failed `build` run before looking at newer attempts. That preserves the guard for a newer `running` resume, but it also hides a newer failed `resume` run that contains additional plan-state evidence.

## Implementation

### Overview

Change only the recovery event-history run selection path so synthesis starts from the newest failed `build` or `resume` run for the plan set that has authoritative plan-state evidence. Keep the existing failed-build fallback and final newest-run fallback.

### Key Decisions

1. Add a local run-selection helper in `event-history.ts` rather than interleaving more SQL in `synthesizeFromEvents()`. This keeps the synthesis body focused on reconstructing the selected run.
2. Treat `plan:status:change`, `plan:build:failed`, and `plan:merge:complete` as the plan-state evidence types for the preferred query.
3. Preserve the fallback cascade: preferred failed build/resume with evidence → latest failed build → newest run.
4. Add DB-backed regression tests that exercise `synthesizeFromEvents()` directly, then feed the returned `plans` into `deriveResumeSeedState()`.

## Scope

### In Scope

- Run selection in `packages/engine/src/recovery/event-history.ts`.
- Regression tests for repeated resume attempts.
- Regression coverage for a newer `running` resume not hiding the original failed `build` run.
- Verification that the repeated resume fixture seeds `plan-05` and `plan-06` as merged and `plan-07` as pending.

### Out of Scope

- Resume API shape changes.
- New runId/sessionId parameters.
- Recovery sidecar/report storage changes.
- Uncommitted partial work preservation from failed plan worktrees.
- Console or daemon API changes.
- `DAEMON_API_VERSION` changes.

## Files

### Create

- None.

### Modify

- `packages/engine/src/recovery/event-history.ts` — Replace the initial run selection with a prioritized failed-evidence query for `command IN ('build', 'resume')`, followed by the existing latest failed `build` fallback and newest-run fallback.
- `test/resume-compiled-build-engine.test.ts` — Import `synthesizeFromEvents` and add DB-backed regression tests for repeated resume selection and the running-resume guard.

## Implementation Notes

The preferred SQL can use `EXISTS` against `events`:

```sql
SELECT r.id, r.command, r.started_at AS startedAt
FROM runs r
WHERE r.plan_set = ?
  AND r.command IN ('build', 'resume')
  AND r.status = 'failed'
  AND EXISTS (
    SELECT 1
    FROM events e
    WHERE e.run_id = r.id
      AND e.type IN ('plan:status:change', 'plan:build:failed', 'plan:merge:complete')
  )
ORDER BY r.started_at DESC, r.id DESC
LIMIT 1
```

Keep the existing `build`-only failed query as the second branch. Keep the current newest-run query as the final branch for legacy/no-build-run cases.

For tests, seed monitor DB rows with `openDatabase()`:

- Original failed `build` run at `T0` for the same `planSet`, with `plan-05` failed evidence.
- Newer failed `resume` run at `T1`, with `plan:merge:complete` evidence for `plan-05` and `plan-06`, plus `plan:build:failed` evidence for `plan-07`.
- Newer `running` resume run variant at `T1`, with evidence rows that must not affect synthesis.

## Verification

- [ ] `synthesizeFromEvents({ setName, prdId, dbPath })` returns a fragment whose `failingPlan.planId` is `plan-07` for a DB with an older failed build and a newer failed resume containing plan-state evidence.
- [ ] `deriveResumeSeedState(fragment.plans).seededMerged` contains `plan-05` and `plan-06` for the repeated resume fixture.
- [ ] `deriveResumeSeedState(fragment.plans).seededPending` contains `plan-07` for the repeated resume fixture.
- [ ] A DB with a failed build and a newer `running` resume returns the failed build fragment with `failingPlan.planId === 'plan-05'`.
- [ ] No code changes modify daemon API route constants, daemon wire types, or `DAEMON_API_VERSION`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run test/resume-compiled-build-engine.test.ts test/recovery.test.ts test/recovery-recommendation.test.ts` exits 0.