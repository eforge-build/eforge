---
title: Fix Recovery Reports and Acceptance Summaries for Inconclusive Acceptance Criteria
created: 2026-05-24
profile: gpt-claude-combo
landing: pr
---

# Fix Recovery Reports and Acceptance Summaries for Inconclusive Acceptance Criteria

## Problem / Motivation

A failed build recovery sidecar can contradict the actual terminal failure. In the observed `close-stacked-pr-follow-up-gaps` run, the build failed before landing because final acceptance validation was inconclusive (`acceptance_validation:complete passed:false` with 4 `unknown` verdicts), but the recovery sidecar reported `ABANDON` and rationalized that only PR creation remained.

There is also a presentation/diagnostic ambiguity: the engine summary says `Acceptance criteria validation failed: 4 criterion/criteria not met`, even when the non-passing criteria are `unknown` rather than explicit `fail`. Since `unknown` is intentionally fail-closed, the build rejection is correct, but the report should make clear that the issue is insufficient evidence/inconclusive validation, not necessarily proven unmet requirements.

Affected users: anyone reviewing failed eforge builds or applying recovery verdicts. A misleading `abandon` verdict is risky because `applyRecoveryAbandon()` removes the failed queue item and sidecars, while the surviving branch may still need human review or PR handling.

### Observed evidence

Evidence from the failed `close-stacked-pr-follow-up-gaps` run shows two related defects:

- The build did **not** fail during PR creation. Monitor DB events for run `ba561322-7a1f-496a-859d-5f564f98139c` show deterministic validation passed, `prd_validation:complete` emitted `passed: true` with no gaps, then `acceptance_validation:complete` emitted `passed: false` because 4 criteria were `unknown`. The engine then emitted `planning:progress` with `Acceptance criteria validation failed — build rejected`, `stack:landing:update` with `status: skipped` / `reason: Build failed before landing could be attempted`, and `phase:end` with `Acceptance criteria validation failed: 4 criterion/criteria not met`.
- The recovery sidecar nevertheless chose `ABANDON` and rationalized that only manual PR creation remained. That happened because recovery event synthesis in `packages/engine/src/recovery/event-history.ts` only captures `plan:build:failed` events, and has a compile-only fallback for failed `phase:end`. For this build command, there was no `plan:build:failed`, so `buildFailureSummary()` fell back to git history timestamps and produced `plans: []`, `failingPlan.planId: "unknown"`, and `failedAt` equal to the newest commit date. This let the recovery analyst infer a landing/PR-creation failure from incomplete evidence.

### Reproduction steps

Observed reproduction from local monitor DB and sidecar files:

1. Build queued PRD `close-stacked-pr-follow-up-gaps` with landing action `pr`.
2. Let build complete implementation and validation. Evidence from monitor DB run `ba561322-7a1f-496a-859d-5f564f98139c`:
   - `validation:complete` emitted `passed: true` after `pnpm install`, `pnpm build`, `pnpm type-check`, `pnpm test`, `node scripts/check-skill-parity.mjs`, `pnpm docs:check`, and targeted vitest all exited 0.
   - First `prd_validation:complete` found 2 gaps, gap-close ran, validation reran, and final `prd_validation:complete` emitted `passed: true`, `gaps: []`, `completionPercent: 97`.
   - Final `acceptance_validation:complete` emitted `passed: false` with 19 verdicts: 15 `pass`, 4 `unknown`.
   - Engine emitted `planning:progress` message `Acceptance criteria validation failed — build rejected`.
   - `stack:landing:update` emitted `status: skipped`, `reason: Build failed before landing could be attempted`.
   - `phase:end` summary was `Acceptance criteria validation failed: 4 criterion/criteria not met`.
3. Run recovery for that failed PRD.
4. Inspect `.eforge/queue/failed/close-stacked-pr-follow-up-gaps.recovery.md` / `.json`.

### Expected behavior

- Recovery summary should identify final acceptance validation as the terminal failure, include enough verdict detail to show 4 `unknown` criteria, and not imply PR creation was attempted.
- Recovery analyst should be steered toward `manual` or a concrete `split` if real remaining work exists, not high-confidence `abandon`, when the terminal failure is acceptance-validation uncertainty.
- User-facing build summary should distinguish `unknown`/inconclusive verdicts from explicit failed criteria.

### Actual behavior

- Summary given to the analyst had `plans: []`, `failingPlan.planId: "unknown"`, and `failedAt` derived from newest git commit rather than terminal failure event.
- The sidecar rationale inferred post-review PR creation failure and recommended opening a PR manually while the machine verdict was `ABANDON`.
- Build summary said `4 criterion/criteria not met`, even though the details were `unknown` rather than explicit `fail`.

### Root cause

Root cause is a combination of incomplete recovery event synthesis and ambiguous acceptance-failure wording.

1. **Recovery event synthesis ignores build-phase terminal failures unless there is a plan failure.**
   - `packages/engine/src/recovery/event-history.ts` first looks for `plan:build:failed`.
   - If absent, its fallback explicitly returns `null` unless `run.command === 'compile'`.
   - The observed failed run was `command = 'build'`, had no `plan:build:failed`, and failed at final acceptance validation. Therefore `synthesizeFromEvents()` returned `null`.
   - `packages/engine/src/recovery/failure-summary.ts` then fell back to git history. With landed commits present, it set `failedAt` from the newest commit date and left `plans: []` / `failingPlan.planId: 'unknown'`. This made the failure appear to be after successful implementation rather than an acceptance gate rejection.

2. **Recovery summary lacks structured validation/acceptance evidence.**
   - `BuildFailureSummary` has commits, diff stat, plan summary, and model list, but no terminal phase summary, validation command outcomes, or acceptance verdict summary.
   - The recovery analyst prompt only sees the summary JSON. Without terminal acceptance details, the analyst rationalized from branch completeness and commit timing.

3. **Acceptance validation intentionally fail-closes on `unknown`, but the final summary collapses all non-pass verdicts into `not met`.**
   - `packages/engine/src/agents/prd-validator.ts` computes `acceptancePassed = verdicts.every((v) => v.verdict === 'pass')`.
   - `packages/engine/src/orchestrator/phases.ts` also treats `unknown` as failed acceptance evidence.
   - `packages/engine/src/eforge.ts` summarizes all non-pass verdicts as `criterion/criteria not met`, losing the distinction between explicit `fail` and `unknown`.

4. **Command-based acceptance criteria are vulnerable to `unknown` even when validation commands passed.**
   - The PRD validator prompt says verdicts are based on implementation diff and instructs `unknown` when the diff alone is insufficient.
   - Deterministic validation results are emitted as events, but are not provided directly to `runPrdValidator()` as acceptance evidence. For criteria like `pnpm docs:check passes` and `pnpm type-check passes`, the validator may correctly classify them as `unknown` if it only trusts diff evidence.

Confirmed non-root-cause: `unknown` being fail-closed is not itself a bug. Existing prompt and tests (`test/prd-validate-phase.test.ts`, `test/prd-validator-fail-closed.test.ts`) intentionally require unknown/missing acceptance evidence to fail the build.

## Goal

Fix recovery summaries, sidecars, and user-facing acceptance validation summaries so terminal acceptance-validation failures caused by `unknown` verdicts are reported accurately as inconclusive/insufficient evidence, not as PR creation failures or proven unmet criteria.

Preserve fail-closed acceptance validation behavior while improving recovery evidence, validation command context, and test coverage.

## Approach

### High-level implementation direction

- Update recovery event synthesis so `synthesizeFromEvents()` handles failed `phase:end` events for build runs, not only compile runs, when no `plan:build:failed` event exists.
- Ensure recovery summaries for final acceptance-validation failures include terminal failure evidence:
  - phase summary
  - failing logical stage, for example `acceptance-validation` or `final-validation`
  - enough acceptance verdict counts/detail to distinguish `unknown` from `fail`
  - landing skip evidence when monitor DB has `stack:landing:update status: skipped` with `Build failed before landing could be attempted`
- Extend `BuildFailureSummary` compatibly with optional terminal/acceptance/validation detail fields if useful for recovery prompt quality, or encode equivalent detail into existing `failingPlan.errorMessage` / `plans.error` fields if schema friction makes optional fields noisy.
- Keep `unknown` acceptance verdicts fail-closed.
- Change user-facing final build summary wording so explicit `fail` and `unknown`/inconclusive verdicts are distinguishable.
- Pass deterministic validation command outcomes, or an equivalent validation evidence appendix, to the PRD validator so command-based criteria can be marked `pass` when commands actually ran and exited 0.
- Add/update tests in the recovery and PRD/acceptance validation areas without weakening schema validation.
- Run targeted recovery synthesis and PRD/acceptance validation tests, plus `pnpm type-check`.

### Relevant code and current behavior

- `packages/engine/src/agents/prd-validator.ts` intentionally fail-closes acceptance validation: `acceptancePassed = verdicts.every((v) => v.verdict === 'pass')`. `unknown` verdicts therefore fail the build by design.
- `packages/engine/src/orchestrator/phases.ts` enforces the acceptance gate in `prdValidate()`. If PRD validation passed but acceptance evidence is absent or not passing, it marks state failed and emits a progress event. Existing tests in `test/prd-validate-phase.test.ts` already assert that `unknown` verdicts fail.
- `packages/engine/src/eforge.ts` converts `acceptance_validation:complete` into a final summary of `Acceptance criteria validation failed: N criterion/criteria not met`.
- `packages/client/src/events.schemas.ts` defines `BuildFailureSummary` without fields for terminal phase failure, validation commands, or acceptance verdicts. The recovery analyst sees `summary` plus PRD content/diff/git history, but not the acceptance validation terminal event unless summary synthesis is extended.
- Deterministic validation command events are already in monitor DB (`validation:command:complete` with command, exitCode, output). In the observed failure, those commands all passed, but the acceptance validator returned `unknown` for command-based acceptance criteria because its prompt/diff context did not make the command outcomes easy to rely on.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| `unknown` acceptance verdicts should remain fail-closed. | `packages/engine/src/prompts/prd-validator.md` instructs validators to use `unknown` when uncertain; `packages/engine/src/agents/prd-validator.ts` requires every verdict to be `pass`; tests assert unknown fails. | high | low | Keep existing tests passing and add wording-only tests if needed. | Weakening this would regress validation hardening and allow unproven builds to pass. |
| Recovery should prefer `manual` over `abandon` for terminal acceptance uncertainty. | `packages/engine/src/prompts/recovery-analyst.md` says `manual` is safe default for ambiguous/unclear evidence; acceptance `unknown` means insufficient proof, not proof that goals are met. | high | medium | Add prompt or summary test that feeds acceptance-failure summary to stub/manual verdict path; live analyst behavior remains probabilistic. | If wrong, automated recovery could remove failed queue items too aggressively. |
| Extending `BuildFailureSummary` with optional terminal/acceptance/validation fields is backward-compatible. | TypeBox schemas generally accept explicitly declared optional fields; existing payloads omit them. Did not yet inspect every consumer. | medium | low | Implement optional fields and run client event schema/wire parity tests. If noisy, use existing `failingPlan.errorMessage` instead for the first slice. | If wrong, could require daemon API versioning or broader client updates. |
| Passing validation command outcomes to PRD validator will reduce `unknown` for command-based criteria without weakening fail-closed behavior. | Observed unknown criteria included command execution criteria despite command events showing exit code 0. Prompt currently emphasizes diff-only validation. | medium/high | medium | Add validation evidence appendix and test prompt/options content with a stub harness; confirm unknown still fails when command evidence is absent. | If wrong, validators may still mark command criteria unknown; recovery/reporting fixes still help but build false negatives remain. |
| The fix can stay within engine/client tests and does not require monitor UI changes. | Event registry already summarizes acceptance validation; the core defect is summary synthesis and wording. No UI-specific bug was observed beyond sidecar report. | medium | low | Search monitor UI rendering after implementation; update only if new summary fields need display. | If wrong, users may still see confusing status in monitor despite engine-side correctness. |

No low-confidence/high-impact assumptions remain. The highest-risk choice is whether to add optional summary fields or encode details into existing fields; that can be decided during implementation based on schema/test friction.

### Early assumptions / unknowns

- Assumption: `unknown` should continue to fail builds. Evidence: current prompt (`packages/engine/src/prompts/prd-validator.md`) and tests explicitly require fail-closed behavior for unknown/missing evidence. Confidence: high.
- Assumption: the recovery analyst should generally choose `manual`, not `abandon`, when a build branch appears complete but the terminal failure was acceptance validation. Evidence: recovery prompt says `manual` is safe default when evidence is ambiguous; an acceptance failure means at least one criterion lacks proof and should not be automatically discarded. Confidence: high.
- Assumption: summary schema can be extended compatibly with optional terminal/acceptance/validation detail fields, or equivalent detail can be encoded into existing `failingPlan.errorMessage` / `plans.error` fields. Validation path: inspect schema wire tests and add backward-compatible optional fields only if useful for recovery prompt quality. Confidence: medium.

### Profile signal

**Recommended profile:** Excursion.

**Rationale:** This is a focused bugfix that crosses a few engine/client seams: recovery event synthesis, acceptance-validation summary wording/evidence, and tests. A single planner can enumerate the changes and dependencies; Expedition is not warranted because there are no independently planned subsystems or delegated architecture slices. Errand is too small because the fix must preserve fail-closed behavior while improving recovery evidence and validator context.

## Scope

### In scope

- Recovery event synthesis in `packages/engine/src/recovery/event-history.ts`.
- Recovery failure summary generation in `packages/engine/src/recovery/failure-summary.ts`.
- Optional compatible extension of `BuildFailureSummary` in `packages/client/src/events.schemas.ts`, or equivalent encoding into existing summary fields.
- Recovery sidecar correctness for terminal acceptance-validation failures.
- Acceptance-validation final summary wording in `packages/engine/src/eforge.ts`.
- PRD/acceptance validation evidence flow, including deterministic validation command outcomes or equivalent validation evidence appendix passed to `runPrdValidator()`.
- Tests in:
  - `test/daemon-recovery.test.ts`
  - a focused recovery-summary test
  - `test/prd-validate-phase.test.ts`
  - `test/prd-validator-fail-closed.test.ts`
  - or a new focused acceptance/PRD validation test
- Client wire/schema tests if `BuildFailureSummary` gains optional fields.
- Targeted tests for recovery synthesis and PRD/acceptance validation.
- `pnpm type-check`.

### Out of scope

- Weakening or removing fail-closed behavior for `unknown` acceptance verdicts.
- Treating `unknown` as a passing acceptance verdict unless explicitly waived.
- Roadmap-deferred queue reordering.
- Overseer work.
- Extensions work.
- Stacked-provider work.
- Automated restack/sync scope.
- Monitor UI changes, unless search after implementation shows new summary fields need display.

### Roadmap alignment

This is Integration & Maturity work. It improves lifecycle/failure reporting and acceptance evidence handling; it does not add roadmap-deferred queue reordering, overseer, extensions, stacked-provider, or automated restack/sync scope.

## Acceptance Criteria

### Recovery summary / sidecar correctness

- `synthesizeFromEvents()` handles failed `phase:end` for build runs, not only compile runs, when no `plan:build:failed` event exists.
- For final acceptance-validation failures, recovery summary includes terminal failure evidence:
  - phase summary
  - failing logical stage, for example `acceptance-validation` or `final-validation`
  - enough acceptance verdict counts/detail to distinguish `unknown` from `fail`
- Recovery sidecars for acceptance-validation failures no longer present `plans: []` / `failingPlan.planId: "unknown"` when monitor DB contains terminal failure events.
- Recovery sidecar rationale cannot reasonably infer PR creation/landing failure when monitor DB has `stack:landing:update status: skipped` with `Build failed before landing could be attempted`.
- Tests cover a build run with:
  - passing deterministic validation
  - passing PRD validation
  - failing acceptance validation due to unknown verdicts
  - skipped landing
  - expected synthesized summary identifying acceptance validation as the failure

### Acceptance validation evidence and wording

- `unknown` acceptance verdicts still fail the build unless explicitly waived; existing fail-closed tests remain valid.
- User-facing final build summary distinguishes explicit failures from inconclusive/unknown verdicts, e.g. `Acceptance criteria validation failed: 4 unknown/inconclusive criterion/criteria` or equivalent, instead of only `not met`.
- PRD validator receives deterministic validation command outcomes or an equivalent validation evidence appendix so command-based criteria can be marked `pass` when the commands actually ran and exited 0.
- Tests cover command-based acceptance criteria where validation command events show success and the validator/prompt context contains those results.

### Regression / integration validation

- Add or update tests in the recovery area (`test/daemon-recovery.test.ts` or a focused recovery-summary test) and acceptance/PRD validation area (`test/prd-validate-phase.test.ts`, `test/prd-validator-fail-closed.test.ts`, or a new focused test) without weakening schema validation.
- Existing event schema tests continue to pass.
- If `BuildFailureSummary` gains optional fields, client wire tests include a valid payload exercising those fields.
- Run targeted tests for recovery synthesis and PRD/acceptance validation, plus `pnpm type-check`.
