---
id: plan-02-final-validation-gates
name: Final Validation Gates, Waivers, and Gap-Close Reruns
branch: harden-eforge-build-validation-gates/plan-02-final-validation-gates
agents:
  builder:
    effort: xhigh
    rationale: This plan changes core orchestrator success semantics, config schema,
      gap-close control flow, PRD closure fail-closed behavior, and
      artifact-recording ordering.
  reviewer:
    effort: high
    rationale: Final build status and artifact safety require careful code, API, and
      test review.
  tester:
    effort: high
    thinking:
      type: enabled
      budgetTokens: 8000
    rationale: Gap-close rerun behavior and no-artifact-on-failure tests require
      multi-phase event assertions.
---

# Final Validation Gates, Waivers, and Gap-Close Reruns

## Architecture Context

The orchestrator owns final build success sequencing: all plans merge into the merge worktree, deterministic validation runs there, PRD/acceptance validation runs over the integrated diff, queued-build artifacts are recorded, and landing/finalization follows. Provider-neutral artifact records must only be written after command validation and acceptance evidence have passed.

## Implementation

### Overview

Consume the event contract from plan-01 to make final success fail closed. Replace silent PRD validator skips with typed failure events, make no validation commands fail unless an explicit config waiver with a reason exists, treat gap-close completion as a hard terminal signal, and rerun both deterministic validation and PRD/acceptance validation after a successful gap-close before recording artifacts.

### Key Decisions

1. Add explicit config waivers under `build.validation` rather than relying on absent commands or empty diffs. Waivers must carry a reason string and must be surfaced through events or progress messages.
2. Gate artifact recording on the latest deterministic validation pass and latest acceptance validation pass, not on the absence of prior failures.
3. Allow at most one gap-close attempt per build using the existing `gapClosePerformed` flag.
4. Preserve `landing.action` / `landingAction` values `pr|merge|leave`; validation hardening must not alter landing vocabulary.

## Scope

### In Scope

- Add config schema/types/default/merge/docs support for explicit validation waivers such as `build.validation.allowNoCommands`, `build.validation.noCommandsReason`, `build.validation.allowEmptyPrdDiff`, and `build.validation.emptyPrdDiffReason`. Require reason strings when waiver booleans are true.
- Thread resolved validation-waiver config into `OrchestratorOptions` and `PhaseContext`.
- Change `validate(ctx)` so all-merged builds with zero combined validation commands emit a failing `validation:complete` and set run status failed unless the no-command waiver is configured.
- Emit a clear waiver event/progress message and `validation:complete passed:true` when the explicit no-command waiver is used.
- Change the PRD validator closure in `packages/engine/src/eforge.ts` so unreadable PRD content, diff-builder failure, and empty rendered diff emit or throw into a failing `prd_validation:complete` path with actionable synthetic gaps.
- Change `prdValidate(ctx)` to track both `prd_validation:complete` and `acceptance_validation:complete`; fail when acceptance evidence is absent, any verdict is `fail`/`unknown`, or unwaived acceptance criteria remain inconclusive.
- Change gap-close handling so `gap_close:complete passed:false`, missing terminal completion, or a gap closer throw makes the build fail.
- After `gap_close:complete passed:true`, rerun deterministic validation and PRD/acceptance validation before `recordArtifact(ctx)`. If either rerun fails or acceptance is inconclusive, no artifact record is written.
- Update `Orchestrator.execute()` so rerun sequencing is `validate -> prdValidate -> gap close if needed -> validate rerun -> prdValidate rerun -> recordArtifact` with status guards between phases.
- Update build loop summary handling in `packages/engine/src/eforge.ts` for `acceptance_validation:complete passed:false`.
- Add focused tests for fail-closed PRD closure cases, no-command policy, gap-close false/missing/pass-with-rerun, and no artifact recording after rerun failure.

### Out of Scope

- Reviewer output parsing; plan-03 handles invalid review XML.
- Dirty worktree enforcement; plan-04 handles committed-work checks.
- A rich policy approval UI for waivers.

## Files

### Modify

- `packages/engine/src/config.ts` — add `build.validation` schema, resolved config defaults, merge handling, cross-field reason validation, and config types.
- `docs/config.md` — document validation waiver fields and examples with reason strings.
- `README.md` — update build success wording to say command and acceptance validation evidence are required unless explicitly waived.
- `docs/architecture.md` — update phase sequencing and event table for acceptance validation and gap-close reruns.
- `packages/engine/src/orchestrator.ts` — thread validation policy into phase context and rerun PRD/acceptance validation after successful gap close.
- `packages/engine/src/orchestrator/phases.ts` — enforce zero-command policy, acceptance evidence status, strict gap-close terminal handling, and artifact-recording guards.
- `packages/engine/src/eforge.ts` — replace PRD validator closure returns with fail-closed synthetic gaps and update phase summary for acceptance failures.
- `test/prd-validate-phase.test.ts` — add acceptance evidence absence/fail/unknown and gap-close terminal tests.
- `test/prd-validator.test.ts` — update old gap-close-without-passed expectations to fail.
- `test/gap-closer.test.ts` — keep agent emission expectations aligned with required `passed`.
- `test/orchestration-logic.test.ts` — assert post-gap validation and PRD/acceptance rerun order.
- `test/validate-phase-timeout.test.ts` — update phase context helpers for validation policy defaults.
- `test/stack-artifact-recording.test.ts` — assert artifact registry writes are skipped after failed/inconclusive validation reruns.
- Config tests under `test/` that cover schema validation and merge/default behavior.

## Verification

- [ ] A build with all plans merged and zero validation commands emits `validation:complete passed:false` and final status `failed` when no waiver is configured.
- [ ] A config with `build.validation.allowNoCommands: true` and no reason is rejected by config validation.
- [ ] A config with `build.validation.allowNoCommands: true` and a non-empty reason emits a waiver/progress event and does not fail solely because command lists are empty.
- [ ] An unreadable PRD file produces `prd_validation:complete passed:false` with a gap requirement naming PRD read failure.
- [ ] A diff-builder failure produces `prd_validation:complete passed:false` with a gap requirement naming diff construction failure.
- [ ] An empty PRD validator diff fails unless the explicit empty-diff waiver with reason is configured.
- [ ] `gap_close:complete passed:false` sets run status to `failed` and prevents `recordArtifact(ctx)`.
- [ ] A gap closer that emits no `gap_close:complete passed:true` sets run status to `failed` and prevents `recordArtifact(ctx)`.
- [ ] After `gap_close:complete passed:true`, deterministic validation and PRD/acceptance validation run again before artifact recording.
- [ ] If the post-gap acceptance rerun emits any `fail` or `unknown` verdict, `.eforge/artifacts/builds.json` is not written for that PRD.
- [ ] Touched landing events and tests still use only `pr`, `merge`, and `leave` landing actions.