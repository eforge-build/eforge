---
title: Support Second Resume Attempts From Latest Failed Resume Run
created: 2026-06-01
landing: pr
---

# Support Second Resume Attempts From Latest Failed Resume Run

## Problem / Motivation

Compiled-build resume currently reconstructs resume state from the latest failed `build` run for a plan set before considering newer attempts. This was intentional to prevent a newer running resume attempt from hiding the original failed build evidence. However, when a resumed build itself fails after successfully merging additional plans, a second resume still seeds from the original failed build instead of the latest failed resume attempt.

Observed case: `migrate-monitor-server-to-a-maintainable-architecture` first failed with Plan 05 failed and Plans 06/07 blocked. A resume then merged Plan 05 and Plan 06, but failed on Plan 07. A second resume should seed Plans 01-06 as merged and only Plan 07 as pending. Today it would likely seed only Plans 01-04 as merged and rerun Plans 05-07.

## Goal

Make compiled-build resume support repeated resume attempts by selecting the newest failed build/resume attempt with authoritative plan-state evidence, while preserving the existing guard that a newer running resume must not hide the original failed build.

## Approach

Update recovery event-history run selection in `packages/engine/src/recovery/event-history.ts`:

- Prefer the newest failed run for the same plan set where:
  - `command IN ('build', 'resume')`
  - `status = 'failed'`
  - The run has plan-state evidence such as `plan:status:change`, `plan:build:failed`, or `plan:merge:complete` events.
- Fall back to the existing latest failed `build` run behavior if no such failed attempt with evidence exists.
- Keep the final newest-run fallback for legacy/no-build-run cases.

This should make `buildFailureSummary()` and `checkResumeEligibility()` reconstruct state from the latest failed resume attempt when appropriate, which in turn makes `deriveResumeSeedState()` seed newly merged plans from the failed resume attempt.

## Scope

In scope:

- Engine recovery event-history run selection.
- Regression tests for repeated resume attempts.
- Tests proving a newer running resume still does not hide the original failed build.
- Tests proving the latest failed resume with plan-state evidence is selected and produces the expected merged/pending resume seed.

Out of scope:

- Changing the resume API shape.
- Adding runId/sessionId parameters to `eforge_resume_build`.
- Regenerating or redesigning recovery sidecar/report storage.
- Preserving uncommitted partial work from the failed Plan 07 worktree.
- Console UX changes for displaying stale sidecars versus latest failed run evidence.

## Acceptance Criteria

- `synthesizeFromEvents()` selects the latest failed `resume` run with plan-state evidence when it is newer than the original failed build run.
- `synthesizeFromEvents()` selects the original failed `build` run when a newer resume run has status `running`.
- A regression test models an original failed build followed by a failed resume where Plans 05 and 06 have `plan:merge:complete` evidence and Plan 07 fails.
- In the repeated resume regression test, `deriveResumeSeedState(fragment.plans)` returns Plans 05 and 06 in `seededMerged`.
- In the repeated resume regression test, `deriveResumeSeedState(fragment.plans)` returns Plan 07 in `seededPending`.
- Existing recovery/resume tests pass.
- No daemon API version bump is included unless the implementation changes public wire/API shapes.
- Targeted recovery/resume tests exit 0.
- `pnpm type-check` exits 0.
