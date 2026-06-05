---
title: Preserve authoritative acceptance-validation details in recovery sidecars
created: 2026-06-05
landing: pr
landing_auto_merge: true
---

# Preserve authoritative acceptance-validation details in recovery sidecars

## Problem / Motivation

Roadmap alignment: this is a Kernel Resilience and Typed Recovery bugfix. It directly supports typed recovery paths and honest gates by making recovery sidecars preserve authoritative monitor DB evidence instead of falling back to a misleading partial PRD-validation summary.

Backlog source `.backlog/items/backlog-2026-06-04-recovery-sidecar-loses-authoritative-acceptance-validation-d.md` describes a failed build where recovery analysis reported partial/manual monitor DB unavailability even though `.eforge/monitor.db` contained detailed acceptance-validation evidence.

Affected path:
- `packages/engine/src/recovery/event-history.ts` `synthesizeFromEvents()`.

Observed symptom:
- For monitor DB run `eb347758-af20-41f9-965c-520d3690746a`, the database has authoritative `build:terminal-failure` evidence for `scope: acceptance-validation` and a detailed `acceptance_validation:complete` event with 50 verdicts, including failed `ac-010` and one acceptance conflict.
- Current `synthesizeFromEvents()` output for that run instead reports a partial PRD-validation failure with `partial: true`, `terminalFailure.authoritative: false`, and no `acceptanceValidation`.

Why it matters:
- Recovery analysts and sidecars lose the strongest available failure evidence and may present misleading manual/partial rationale.
- Downstream recovery actions that rely on `summary.acceptanceValidation` cannot distinguish failed/unknown verdicts or acceptance conflicts when the data actually exists.

Validated evidence:
- `packages/engine/src/recovery/event-history.ts` lines found by `rg` show that, inside the authoritative terminal path, `authTerminal.scope === 'acceptance-validation'` checks the latest `prd_validation:complete`; when it has `passed === false`, the function returns a partial PRD-validation summary before calling `extractAuthoritativeAcceptanceValidation()`.
- `packages/engine/src/recovery/event-history.ts` later has a legacy fallback branch that intentionally prefers PRD validation over acceptance validation when no authoritative terminal event exists. That behavior should remain separate from authoritative terminal handling.
- `.eforge/monitor.db` run `eb347758-af20-41f9-965c-520d3690746a` contains `build:terminal-failure` with `scope: acceptance-validation`, `authoritative: true`, and `sourceEventType: acceptance_validation:complete`.
- The same run contains `prd_validation:complete` with `passed: false` and one gap.
- The same run contains `acceptance_validation:complete` with 50 acceptance verdicts, `ac-010` failed, and one `acceptanceConflicts` entry.
- A direct call to current `packages/engine/dist/recovery/event-history.js` `synthesizeFromEvents({ runId: 'eb347758-af20-41f9-965c-520d3690746a' })` returned `partial: true`, `failingPlan.planId: prd-validation`, `terminalFailure.authoritative: false`, and no `acceptanceValidation` field.
- Existing tests in `test/recovery-terminal-failure.test.ts` cover authoritative acceptance-validation enrichment only when PRD validation passed.
- Existing tests do not cover the coexistence of failed PRD validation and authoritative acceptance-validation terminal failure.
- Existing tests in `test/recovery-failure-summary.test.ts` and `test/recovery-terminal-failure.test.ts` cover legacy/no-authoritative PRD-validation preference and should continue to pass.

Assumption status: the main claim has been validated by source inspection, monitor DB evidence, and direct current-function output. Remaining decisions are implementation-shape assumptions with low validation cost.

## Goal

Recovery sidecar synthesis preserves authoritative acceptance-validation terminal-failure evidence even when PRD validation also failed in the same validation phase. Legacy fallback behavior that prefers PRD-validation failures when no authoritative `build:terminal-failure` exists remains unchanged.

## Approach

Root cause:
- In `packages/engine/src/recovery/event-history.ts`, the authoritative terminal-failure branch begins after `findAuthoritativeTerminalEvent(db, runId, failedPhaseRow.id)` returns an event.
- When `authTerminal.scope === 'acceptance-validation'`, the code immediately queries the latest `prd_validation:complete` and returns a partial PRD-validation fragment if `parsedPrdValidation?.passed === false`.
- That early return happens before reconstructing plan maps, extracting validation commands, extracting landing/review evidence, calling `extractAuthoritativeAcceptanceValidation()`, or calling `buildAuthoritativeFragment()`.
- Because the early return constructs `terminalFailure.authoritative: false` and omits `acceptanceValidation`, it contradicts the already-found authoritative `build:terminal-failure` event.

Design decision:
- Treat `build:terminal-failure` with `authoritative: true` as the authoritative terminal source for the authoritative branch.
- A failed PRD-validation event may still be context/evidence, but it must not override an authoritative acceptance-validation terminal failure.
- Leave the no-authoritative legacy fallback branch unchanged.
- The current legacy fallback rule should still prefer failed PRD validation over acceptance validation when no authoritative terminal event exists, because it was explicitly added to avoid mislabeling older runs where `runPrdValidator` emitted acceptance events despite unresolved PRD gaps.

Implementation targets:
- Update `packages/engine/src/recovery/event-history.ts` so the authoritative branch does not return the partial PRD-validation fragment when `authTerminal.scope === 'acceptance-validation'`.
- Ensure the authoritative branch always reaches `extractAuthoritativeAcceptanceValidation(db, runId, authTerminal)` for acceptance-validation terminal failures and passes the result into `buildAuthoritativeFragment()`.
- Add or update a nearby comment to distinguish authoritative terminal precedence from legacy fallback PRD-validation preference.
- Add a regression test in `test/recovery-terminal-failure.test.ts` covering failed PRD validation plus authoritative acceptance-validation terminal failure.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `build:terminal-failure` with `authoritative: true` should take precedence over a failed `prd_validation:complete` in the authoritative branch. | `packages/engine/src/recovery/terminal-failure-history.ts` documents `build:terminal-failure` as authoritative; existing `test/recovery-terminal-failure.test.ts` asserts authoritative precedence; roadmap emphasizes typed recovery paths. | high | low | Add the regression test and run `pnpm test -- test/recovery-terminal-failure.test.ts test/recovery-failure-summary.test.ts`. | If wrong, the fix would intentionally surface acceptance failures where product semantics wanted PRD failures; however that conflicts with the authoritative event contract and the recorded terminal failure. |
| The legacy fallback PRD-validation preference should remain unchanged when no authoritative `build:terminal-failure` exists. | `event-history.ts` contains an explicit comment explaining this legacy behavior; existing tests assert PRD-validation reporting for no-authoritative failed PRD validation. | high | low | Keep the legacy branch unchanged and run the existing recovery summary/terminal-failure tests. | If wrong, older runs could be classified differently, increasing recovery sidecar behavior drift. |
| Removing the authoritative-branch early return is sufficient to preserve acceptance-validation details. | Source inspection shows `extractAuthoritativeAcceptanceValidation()` and `buildAuthoritativeFragment()` already handle authoritative acceptance-validation evidence when reached; direct current-function reproduction confirms the early return is what prevents reaching them. | high | low | Add the mixed PRD-fail/auth-acceptance regression test before or alongside the code change. | If wrong, additional data extraction or ordering fixes may be needed, but the new test will expose that. |
| The regression belongs in `test/recovery-terminal-failure.test.ts`. | That file already owns authoritative terminal failure precedence and authoritative acceptance-validation enrichment tests. | high | low | Add the test near the existing authoritative acceptance-validation tests and run the target file. | If wrong, test organization becomes less ideal but behavior coverage remains valid. |

No unresolved low-confidence/high-impact assumptions remain. The core bug claim was validated by source inspection, direct monitor DB evidence, and direct current-function output.

Recommended profile: Excursion.

Profile rationale: this is a focused recovery bugfix with one primary implementation file and one regression-test file, but correctness depends on preserving the distinction between authoritative terminal-failure reconstruction and legacy fallback behavior. A single cohesive plan can cover the work without delegated module planning. Errand is too light because the failure mode is subtle and recovery sidecar semantics are high-value; Expedition is unnecessary because no independent subplans or architecture delegation are needed.

## Scope

In scope:
- Fix authoritative terminal-failure synthesis for acceptance-validation scope.
- Preserve existing legacy fallback behavior that prefers PRD-validation failures when there is no authoritative `build:terminal-failure` event.
- Update `packages/engine/src/recovery/event-history.ts`.
- Add or update a nearby comment distinguishing authoritative terminal precedence from legacy fallback PRD-validation preference.
- Add a regression test in `test/recovery-terminal-failure.test.ts`.

Out of scope:
- Do not change event schemas.
- Do not change `extractAuthoritativeAcceptanceValidation()` parsing semantics.
- Do not change recovery analyst prompts.
- Do not change legacy fallback behavior for runs without authoritative `build:terminal-failure` evidence.

## Acceptance Criteria

- A regression test in `test/recovery-terminal-failure.test.ts` seeds a failed `prd_validation:complete` event.
- A regression test in `test/recovery-terminal-failure.test.ts` seeds a failed `acceptance_validation:complete` event.
- A regression test in `test/recovery-terminal-failure.test.ts` seeds an authoritative `build:terminal-failure` event scoped to `acceptance-validation`.
- A regression test in `test/recovery-terminal-failure.test.ts` seeds a failed `phase:end` event.
- The new regression test asserts the synthesized summary has `terminalFailure.scope === 'acceptance-validation'`.
- The new regression test asserts the synthesized summary has `terminalFailure.authoritative === true`.
- The new regression test asserts the synthesized summary has `terminalFailure.sourceEventType === 'acceptance_validation:complete'`.
- The new regression test asserts the synthesized summary has `partial === undefined`.
- The new regression test asserts the synthesized summary includes `acceptanceValidation.passed === false`.
- The new regression test asserts the synthesized summary preserves at least one failed acceptance verdict from the `acceptance_validation:complete` event.
- The new regression test asserts the synthesized summary preserves at least one acceptance conflict from the `acceptance_validation:complete` event.
- `synthesizeFromEvents()` does not return the partial PRD-validation fragment after finding an authoritative `build:terminal-failure` with `scope === 'acceptance-validation'`.
- An existing or updated test asserts the legacy/no-authoritative path reports PRD validation when the latest `prd_validation:complete` event failed.
- `pnpm test -- test/recovery-terminal-failure.test.ts test/recovery-failure-summary.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

Validated reproduction path using current local artifacts:

1. Confirm `.eforge/monitor.db` exists in this repo.
2. Query run `eb347758-af20-41f9-965c-520d3690746a` for these event types:
   - `build:terminal-failure`
   - `prd_validation:complete`
   - `acceptance_validation:complete`
   - `phase:end`
3. Expected database evidence:
   - `build:terminal-failure` has `failure.scope === 'acceptance-validation'`, `failure.authoritative === true`, and `failure.acceptanceValidationPassed === false`.
   - Latest `prd_validation:complete` before `phase:end` has `passed === false` and one gap.
   - Latest `acceptance_validation:complete` before terminal failure has `passed === false`, 50 verdicts, one failed verdict for `ac-010`, and one acceptance conflict.
4. Run current built synthesis against that run:

   ```bash
   node --no-warnings - <<'NODE' ... synthesizeFromEvents({ setName: 'complete-host-queue-controls-race-safety-fixes-and-docs', prdId: 'complete-host-queue-controls-race-safety-fixes-and-docs', dbPath: '.eforge/monitor.db', runId: 'eb347758-af20-41f9-965c-520d3690746a' }) ... NODE
   ```

5. Actual current output:
   - `partial === true`
   - `failingPlan.planId === 'prd-validation'`
   - `terminalFailure.scope === 'prd-validation'`
   - `terminalFailure.authoritative === false`
   - `acceptanceValidation` is missing.
6. Expected fixed output:
   - `partial` is omitted or undefined.
   - `terminalFailure.scope === 'acceptance-validation'`.
   - `terminalFailure.authoritative === true`.
   - `terminalFailure.sourceEventType === 'acceptance_validation:complete'` is preserved.
   - `acceptanceValidation` is present with failed verdict/conflict details from the acceptance event.