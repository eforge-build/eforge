---
id: plan-02-deterministic-recovery-verdicts
name: Deterministic Recovery Verdicts and Analyst Validation
branch: improve-recovery-sidecar-accuracy-and-robustness/plan-02-deterministic-recovery-verdicts
agents:
  builder:
    effort: high
    rationale: This plan adds a new policy layer, invariant validation, prompt
      changes, and recovery flow integration without changing apply-recovery
      semantics.
  reviewer:
    effort: high
    rationale: Review must verify verdict precedence, source metadata, and
      conservative transient-failure classification.
  test-writer:
    effort: high
    rationale: Tests need to cover deterministic policy, analyst parse fallbacks,
      invariant rejection, and integration sidecars.
---

# Deterministic Recovery Verdicts and Analyst Validation

## Architecture Context

After `plan-01-recovery-summary-reconstruction`, recovery summaries contain complete deterministic facts for a failed run. The current recovery flow still depends on `runRecoveryAnalyst()` as the only decision maker; parse failures, timeouts, or incomplete analyst output fall back to an empty manual verdict. This plan adds an engine-owned deterministic recommendation layer and validates analyst output against summary invariants before sidecars are written.

## Implementation

### Overview

Create a recovery recommendation module that turns `BuildFailureSummary` facts into a conservative `RecoveryVerdict` candidate. Use that candidate when the analyst fails, times out, or returns unparsable output. Accept analyst verdicts only when invariant checks confirm that every failed and remaining plan is accounted for. Record verdict-source metadata in JSON and Markdown sidecars.

### Key Decisions

1. Deterministic policy is narrow: use retry or split only for high-confidence transient API/transport failures; mixed, missing, corrupt, or insufficient context yields manual review.
2. Partial completion changes the transient recommendation from retry to split when completed or merged plans, landed commits, or preserved work indicate that a successor PRD covering the failed/remaining plans is safer than re-running the original full PRD.
3. Analyst verdicts are accepted only after invariant validation; invalid analyst verdicts are downgraded to manual with `verdictInvalidationReason` metadata.
4. `runRecoveryAnalyst()` remains tool-free, but its prompt includes the deterministic recommendation and explicit invariant requirements.

## Scope

### In Scope

- Deterministic recommendation generation under `packages/engine/src/recovery/`.
- Recovery verdict source metadata in shared client and engine schemas.
- Analyst verdict invariant validation against failed plan IDs and split successor coverage.
- Final verdict selection in inline queue finalization and manual `EforgeEngine.recover()`.
- `agent:result.resultText` fallback parsing in `runRecoveryAnalyst()`.
- Recovery analyst prompt updates with deterministic recommendation evidence and failed-plan coverage requirements.
- Sidecar Markdown display of verdict source and invalidation reason.
- Regression tests for deterministic transient policy, manual fallbacks, invariant rejection, malformed output, and resultText parsing.

### Out of Scope

- Granting filesystem, git, or database tools to the recovery analyst.
- Asynchronous recovery after queue finalization.
- Broad scheduling or wrapper-application workflows.
- Applying recovery actions automatically from the deterministic recommendation.
- Changing the retry, split, abandon, or manual apply helpers beyond accepting optional verdict metadata.

## Files

### Create

- `packages/engine/src/recovery/recommendation.ts` — deterministic recommendation, failure classification helpers, analyst invariant validation, and final verdict selection helpers used by both recovery entry points.

### Modify

- `packages/client/src/events.schemas.ts` — extend `RecoveryVerdictSchema` with optional `recommendationSource`, `recommendationRationale`, and `verdictInvalidationReason` fields; use a closed union for source values if practical.
- `packages/engine/src/schemas.ts` — mirror the optional recovery verdict metadata so `parseWithSchema(recoveryVerdictSchema, ...)` accepts new sidecars and legacy sidecars.
- `packages/engine/src/recovery/sidecar.ts` — render final verdict source, deterministic rationale, and analyst invalidation reason when present.
- `packages/engine/src/agents/recovery-analyst.ts` — include `agent:result.resultText` in the parse buffer when no streamed message contains the verdict; pass deterministic recommendation and invariant text into the prompt.
- `packages/engine/src/prompts/recovery-analyst.md` — require every failed plan ID to appear in the rationale; require split successors to cover every failed or remaining plan; instruct the analyst to explain disagreements with deterministic evidence.
- `packages/engine/src/eforge.ts` — use the final-verdict helper in inline queue finalization and manual recover flow; use deterministic policy for failed, timed-out, or unparsable analyst runs; use manual invalidation for analyst contradictions.
- `test/recovery.test.ts` — add unit coverage for recommendation policy, invariant validation, resultText fallback parsing, and manual `EforgeEngine.recover()` final verdict behavior.
- `test/daemon-recovery.test.ts` — add integration coverage for sidecar verdict source metadata and deterministic fallback when analyst output is malformed.
- `packages/client/src/__tests__/events-schemas.test.ts` — add schema coverage for recovery verdict metadata.
- `test/apply-recovery.test.ts` and `test/apply-recovery-route.test.ts` — add or adjust compatibility assertions only if schema parsing rejects sidecars carrying optional verdict metadata.

## Verification

- [ ] All failed plans with `terminalSubtype: "error_transient_transport"`, API 529 error text, and zero recorded tool-use counts produce a deterministic retry verdict when no completed or merged work exists.
- [ ] The same transient failure facts produce a deterministic split verdict when at least one plan completed or merged before the failed plans.
- [ ] Mixed transient and non-transient failed plans produce a deterministic manual verdict.
- [ ] Missing or corrupt monitor DB context represented by a partial summary with unknown failing plan produces a deterministic manual verdict.
- [ ] A malformed analyst response produces a final verdict with `recommendationSource` set to deterministic policy when the deterministic recommendation is retry or split.
- [ ] A timed-out or thrown analyst run produces a final verdict with deterministic source metadata when the deterministic recommendation is retry or split.
- [ ] An analyst verdict that omits a failed plan ID from its rationale is not emitted as the final analyst verdict.
- [ ] A split analyst verdict without a successor PRD mentioning every failed and remaining plan is not emitted as the final split verdict.
- [ ] A valid analyst verdict is emitted with source metadata indicating analyst validation.
- [ ] `runRecoveryAnalyst()` parses a recovery XML block supplied only through `agent:result.resultText`.
- [ ] Sidecar JSON records `recommendationSource` for deterministic, analyst-validated, and manual-fallback paths.
- [ ] Sidecar Markdown displays the final verdict source and any analyst invalidation reason.
- [ ] Legacy sidecars without verdict metadata still validate through apply-recovery schemas.
