---
id: plan-02-engine-acceptance-gates
name: Engine Acceptance Gate Enforcement
branch: harden-build-validation-evidence-gates/plan-02-engine-acceptance-gates
agents:
  builder:
    effort: high
    rationale: Changes final build success semantics across PRD validation, no-PRD
      flows, and waiver event evidence.
  tester:
    effort: high
    rationale: Gate behavior must fail closed across several combinations of PRD
      source, plan source, validator output, and waivers.
---

# Engine Acceptance Gate Enforcement

## Architecture Context

The orchestrator runs deterministic validation and PRD validation before artifact recording. This plan consumes the acceptance evidence foundation from plan-01 so final build success requires expected criterion coverage and explicit waiver evidence.

## Implementation

### Overview

Pass expected acceptance criteria into the build validation path, require verdict coverage for every expected criterion, fail when no validation source exists unless waived, and fail closed on malformed validator gap entries. Preserve the existing gap-close rerun ordering: after a successful gap close, rerun deterministic validation and PRD/acceptance validation before artifact recording.

### Key Decisions

1. Treat expected criteria as the source of truth. Validator-produced verdicts certify only criteria that match the expected inventory by ID or normalized text.
2. Missing expected criteria produce synthetic `unknown` verdicts with evidence such as `Validator did not provide evidence for expected criterion ac-002.`
3. Empty-diff and no-criteria waivers populate `acceptance_validation:complete.waivers` and retain explicit verdicts for expected criteria when available; do not fabricate `pass` evidence.
4. When `prdValidator` is absent, derive an inventory from plan-file bodies. If no inventory exists, emit `acceptance_validation:complete passed:false` and fail unless `allowNoAcceptanceCriteria` is configured with a reason.
5. Treat malformed `gaps` array entries as synthetic PRD validation gaps instead of filtering them out.

## Scope

### In Scope

- Add `expectedAcceptanceCriteria` / source metadata to `PhaseContext` and `OrchestratorOptions`.
- In `EforgeEngine.build()`, read queued PRD content when `options.prdFilePath` exists and derive expected criteria from that content.
- In direct/no-PRD builds, derive expected criteria from parsed plan files using the helper from plan-01.
- Pass expected criteria into `runPrdValidator()` and/or apply cross-checking in `prdValidate()` so a subset verdict list fails.
- Update the PRD validator prompt input if IDs are used, instructing the agent to return `criterionId` when available while still accepting exact criterion text.
- Emit missing expected criteria as `unknown` verdicts before marking state failed.
- Use `waivers` for `allowEmptyPrdDiff` instead of a synthetic passing verdict.
- Fail no-validator/no-inventory builds unless `allowNoAcceptanceCriteria` is configured with a reason; waived events must include the waiver reason.
- Make malformed `gaps` entries create a synthetic failure gap.
- Add tests for multi-AC subset verdicts, generic verdict mismatch, all pass, one unknown, one fail, no-PRD failure, no-PRD waiver pass, plan-derived AC validation, empty-diff waiver metadata, and malformed gap entries.

### Out of Scope

- Reviewer XML strictness.
- Built-on-merge committed-diff enforcement.
- UI rendering.
- A human approval workflow for waivers.

## Files

### Modify

- `packages/engine/src/orchestrator.ts` — carry expected acceptance criteria and validation policy into `PhaseContext`.
- `packages/engine/src/orchestrator/phases.ts` — enforce expected-criterion coverage, synthesize missing `unknown` verdicts, fail no-validator/no-inventory paths, and preserve gap-close rerun semantics.
- `packages/engine/src/eforge.ts` — derive PRD-source and plan-source inventories, pass them into the orchestrator, and change empty-diff waiver events to use `waivers`.
- `packages/engine/src/agents/prd-validator.ts` — accept optional expected criteria, include IDs/text in prompt variables, cross-check or preserve enough data for the orchestrator, and fail closed on malformed `gaps` entries.
- `packages/engine/src/prompts/prd-validator.md` — request one verdict per expected criterion and include IDs when provided.
- `test/prd-validate-phase.test.ts` — add phase-level coverage for subset/generic/missing verdict failures and all-pass success.
- `test/prd-validator-fail-closed.test.ts` — add malformed `gaps` entry coverage and expected-criteria verdict coverage.
- `test/prd-validator.test.ts` — update PRD validation gate expectations for expected inventory.
- `test/orchestration-logic.test.ts` — add no-PRD/no-inventory failure and waiver scenarios.
- `test/agent-wiring.test.ts` — update PRD validator stubs to emit per-criterion verdicts when expected criteria are present.
- `test/stack-artifact-recording.test.ts` — assert no artifact recording after new acceptance failures and maintain rerun ordering after gap close.

## Verification

- [ ] A PRD with two expected criteria and a validator response containing one matching passing verdict emits a second `unknown` verdict and fails the build.
- [ ] A validator response with one generic passing criterion for a multi-criterion PRD fails with missing expected-criterion evidence.
- [ ] A validator response with all expected criteria passing leaves `state.status` non-failed after `prdValidate()`.
- [ ] Any expected criterion with `fail` or `unknown` fails unless a non-empty waiver reason is present in the event.
- [ ] A build with no `prdValidator` and no derived plan criteria emits a validation-not-possible message and fails without `allowNoAcceptanceCriteria`.
- [ ] The same no-criteria path passes only when `allowNoAcceptanceCriteria` has a non-empty reason and the acceptance event includes that reason in `waivers`.
- [ ] Malformed `gaps` entries produce at least one synthetic PRD gap and `prd_validation:complete passed:false`.
- [ ] Empty PRD diffs with `allowEmptyPrdDiff` emit `waivers` and do not emit `evidence: "Waiver: ..."` as pass evidence.