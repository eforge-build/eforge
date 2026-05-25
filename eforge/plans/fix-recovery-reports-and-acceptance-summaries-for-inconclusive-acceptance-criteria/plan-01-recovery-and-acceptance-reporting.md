---
id: plan-01-recovery-and-acceptance-reporting
name: Recovery and Acceptance Reporting for Inconclusive Criteria
branch: fix-recovery-reports-and-acceptance-summaries-for-inconclusive-acceptance-criteria/plan-01-recovery-and-acceptance-reporting
agents:
  builder:
    effort: high
    rationale: Crosses engine recovery synthesis, shared event schemas, PRD
      validator prompt/context flow, and user-facing final summaries; requires
      preserving fail-closed behavior while changing evidence plumbing and
      wording.
  reviewer:
    effort: high
    rationale: Review must check schema compatibility, fail-closed acceptance
      semantics, recovery sidecar safety, and that validation command evidence
      does not become a blanket pass.
  tester:
    effort: high
    rationale: Targeted tests span monitor DB recovery synthesis, event wire
      schemas, PRD validator prompt context, orchestrator PRD validation
      behavior, and final summary wording.
---

# Recovery and Acceptance Reporting for Inconclusive Criteria

## Architecture Context

The build engine emits all lifecycle and validation information as `EforgeEvent`s. Recovery analysis consumes a `BuildFailureSummary` built from monitor DB event history plus git history; the recovery analyst only sees that summary JSON and the PRD content. Acceptance validation is intentionally fail-closed: every acceptance verdict must be `pass` unless an explicit waiver is present. This plan preserves that gate while making terminal acceptance uncertainty visible in recovery summaries, sidecars, and final build summaries.

## Implementation

### Overview

Implement one coordinated engine/client change set:

1. Extend `BuildFailureSummary` with optional terminal failure, acceptance verdict, landing skip, and validation command evidence fields.
2. Synthesize build-run `phase:end` failures from monitor DB events when no `plan:build:failed` event exists, with special handling for final acceptance-validation rejection.
3. Render the new evidence in recovery sidecar Markdown/JSON and steer the recovery analyst away from high-confidence abandon when terminal failure evidence is inconclusive acceptance validation.
4. Pass deterministic validation command results into the PRD validator prompt so command-based acceptance criteria can cite successful command execution.
5. Replace the ambiguous final summary wording that labels all non-pass verdicts as “not met” with verdict-aware fail/unknown wording.

### Key Decisions

1. Add optional fields to `BuildFailureSummary` instead of overloading only `failingPlan.errorMessage`. Optional fields keep existing recovery payloads valid while giving the recovery analyst and sidecar renderer structured evidence.
2. Use the failed `phase:end` timestamp as `failedAt` for synthesized terminal build failures. Do not fall back to newest commit dates when monitor DB contains terminal failure events.
3. Represent final acceptance failures as a logical failing plan/stage such as `acceptance-validation` or `final-validation`, never `unknown`, when monitor DB contains the relevant terminal events.
4. Store validation command evidence from the final validation attempt in orchestrator context and pass it to `runPrdValidator()`. The prompt must instruct the validator to use command results only for criteria that the command outcome directly proves.
5. Add a small acceptance summary helper so final build summary wording and recovery count derivation use the same pass/fail/unknown counts.

## Scope

### In Scope

- Recovery event synthesis for build-run failed `phase:end` events without `plan:build:failed`.
- Structured optional `BuildFailureSummary` fields for terminal phase evidence, acceptance verdict counts/details, validation command outcomes, and skipped landing evidence.
- Recovery sidecar Markdown rendering for those optional fields.
- Recovery analyst prompt guidance for terminal acceptance uncertainty.
- PRD validator options and prompt template for deterministic validation evidence.
- Orchestrator validation evidence plumbing from validation command events into PRD validation.
- Final phase summary wording for acceptance validation failures with `fail` versus `unknown` verdict counts.
- Targeted tests and client schema/wire fixtures.

### Out of Scope

- Treating `unknown` acceptance verdicts as passing without an explicit waiver.
- Changing acceptance verdict wire event semantics.
- Monitor UI changes unless a touched shared renderer test requires a direct update.
- Daemon API version bump for the optional summary fields.
- Queue reordering, overseer, extensions, stacked-provider, or automated restack/sync features.

## Files

### Create

- `packages/engine/src/validation/acceptance-summary.ts` — Shared helpers to count acceptance verdicts, format failure summaries, and build compact acceptance evidence objects for recovery.
- `test/acceptance-summary.test.ts` — Focused tests for fail-only, unknown-only, mixed fail/unknown, waived, and empty/non-pass summary strings if the helper is exported from the engine package test path.

### Modify

- `packages/client/src/events.schemas.ts` — Add optional schemas to `BuildFailureSummary`:
  - `terminalFailure?: { stage: string; phaseSummary?: string; phaseStatus?: string; eventType?: string }`
  - `acceptanceValidation?: { passed: boolean; total: number; pass: number; fail: number; unknown: number; verdicts: AcceptanceCriterionVerdict[] }`
  - `validationCommands?: Array<{ command: string; exitCode: number; output?: string }>`
  - `landing?: { status: string; action?: string; reason?: string }`
  Keep every new field optional.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — Add a valid `recovery:summary` fixture that exercises the optional terminal/acceptance/validation/landing fields.
- `packages/client/src/__tests__/events-schemas.test.ts` — Add schema assertions for a `recovery:summary` event carrying the optional summary fields, including unknown acceptance verdicts.
- `packages/engine/src/recovery/event-history.ts` — Remove the build-run exclusion from failed `phase:end` fallback. Query the latest failed `phase:end`, latest relevant `acceptance_validation:complete`, `prd_validation:complete`, `validation:command:complete`, `validation:complete`, and `stack:landing:update` events for the run. When acceptance validation is the terminal failure, return a summary fragment with `failingPlan.planId = 'acceptance-validation'`, a failed plan entry for that logical stage, the phase summary, verdict counts/details, validation command outcomes, landing skipped evidence, and `failedAt` from the failed phase event. Preserve the existing compile-run agent:stop fallback for compile failures.
- `packages/engine/src/recovery/failure-summary.ts` — Merge the optional event-history fields into the returned `BuildFailureSummary` along with git-derived commits/models. Keep the partial fallback only when no monitor DB fragment is available.
- `packages/engine/src/recovery/sidecar.ts` — Render optional terminal failure, acceptance validation counts/verdicts, validation command outcomes, and landing status sections in Markdown. JSON sidecar already includes the full summary; ensure it serializes the new fields.
- `packages/engine/src/prompts/recovery-analyst.md` — Add guidance that terminal acceptance-validation failures with `unknown` verdicts indicate insufficient evidence, not PR creation failure or proven completion; require concrete evidence before choosing `abandon`, and prefer `manual` when acceptance uncertainty remains.
- `packages/engine/src/agents/prd-validator.ts` — Add optional `validationCommandEvidence` to `PrdValidatorOptions`, format a bounded validation evidence appendix for the prompt, and pass it through `loadPrompt()`. Preserve `acceptancePassed = verdicts.every(v => v.verdict === 'pass')`.
- `packages/engine/src/prompts/prd-validator.md` — Add a “Deterministic Validation Command Evidence” section. Instruct the validator that an exit code 0 command may support a matching command-based criterion, a non-zero/timeout result is failure evidence for that command criterion, and absence of a relevant command result remains `unknown`.
- `packages/engine/src/orchestrator.ts` — Extend the `PrdValidator` callback type with an optional context argument containing final validation command evidence, initialize the evidence array in `PhaseContext`, and keep existing one-argument test validators assignable.
- `packages/engine/src/orchestrator/phases.ts` — Add validation evidence storage to `PhaseContext`. Reset it at the start of each validation attempt, append each `validation:command:complete` result, and pass the final attempt’s evidence to `prdValidator()` inside `prdValidate()`.
- `packages/engine/src/eforge.ts` — Pass validation command evidence from the PRD validator callback into `runPrdValidator()`. Replace final acceptance failure summary construction with the shared verdict-aware helper.
- `test/recovery.test.ts` — Add a monitor DB recovery summary test for a build run with passing validation commands, passing PRD validation, failing acceptance validation due to unknown verdicts, skipped landing, and failed `phase:end`. Assert `failingPlan.planId !== 'unknown'`, `failedAt` equals the phase timestamp, terminal stage is `acceptance-validation`, unknown counts are present, validation commands are included, and landing skip evidence does not describe PR creation as attempted.
- `test/daemon-recovery.test.ts` or `test/recovery.test.ts` — If sidecar rendering is easier to test in the existing sidecar tests, add assertions that Markdown contains terminal failure and unknown acceptance verdict details.
- `test/prd-validator-fail-closed.test.ts` — Add a direct `runPrdValidator()` test asserting the prompt contains deterministic command evidence such as `pnpm type-check`, `exitCode: 0`, and bounded output. Keep existing unknown/malformed verdict tests unchanged.
- `test/prd-validate-phase.test.ts` — Add a PRD validation phase test where `PhaseContext.validationCommandEvidence` (or a preceding validation phase in an orchestrator-level test) is passed to the `prdValidator` callback. Assert the callback receives the command results and `unknown` verdicts still fail when emitted.
- `test/orchestration-logic.test.ts` — Update callback signatures only if TypeScript requires it; add an integration assertion here instead of `test/prd-validate-phase.test.ts` if the full validate→prdValidate evidence flow is simpler to verify through `Orchestrator.execute()`.

## Verification

- [ ] `synthesizeFromEvents()` returns a monitor-derived summary for build runs with failed `phase:end` and no `plan:build:failed`.
- [ ] The acceptance-validation recovery summary has `failingPlan.planId` set to `acceptance-validation` or another explicit logical stage, not `unknown`.
- [ ] The recovery summary includes phase summary text, unknown/fail/pass acceptance counts, acceptance verdict details, final validation command outcomes, and skipped landing reason when those events exist in monitor DB.
- [ ] The recovery sidecar Markdown contains the terminal stage, phase summary, unknown verdict count, at least one unknown criterion row, and the skipped landing reason.
- [ ] Existing fail-closed tests still show `unknown` verdicts produce `acceptance_validation:complete passed: false` unless a waiver is present.
- [ ] Final build summary text distinguishes explicit failed criteria from unknown/inconclusive criteria; an all-unknown failure does not contain only “not met”.
- [ ] `runPrdValidator()` prompt includes deterministic validation command evidence when supplied and omits fabricated pass evidence when no command result is supplied.
- [ ] Client event schema and wire parity tests accept `recovery:summary` payloads containing the new optional `BuildFailureSummary` fields.
