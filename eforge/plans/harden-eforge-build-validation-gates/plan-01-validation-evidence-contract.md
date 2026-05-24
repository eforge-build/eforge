---
id: plan-01-validation-evidence-contract
name: Validation Evidence Contract and PRD Validator Output
branch: harden-eforge-build-validation-gates/plan-01-validation-evidence-contract
agents:
  builder:
    effort: high
    rationale: Adds client-owned event schema variants and changes PRD validator
      structured output, which requires synchronized type exports, event
      registry updates, prompt changes, and tests.
  reviewer:
    effort: high
    rationale: Wire-protocol changes and fail-closed validator semantics require API
      and test-focused review.
  tester:
    effort: high
    rationale: Existing PRD validator and event parity fixtures encode old behavior
      and need focused regression coverage.
---

# Validation Evidence Contract and PRD Validator Output

## Architecture Context

`@eforge-build/client` owns all event discriminants and TypeBox schemas. The engine re-exports event types from the client package, so acceptance-criteria evidence must be defined in `packages/client/src/events.schemas.ts` before engine orchestration can gate on it. The PRD validator agent is the natural producer for final integrated acceptance verdicts because it already compares the original PRD to the merged implementation diff.

## Implementation

### Overview

Add a typed acceptance-criteria verdict model and event, make `gap_close:complete.passed` required in the wire schema, and update the PRD validator agent/prompt to produce per-criterion verdict evidence. The PRD validator parser must fail closed when verdict evidence is missing or malformed.

### Key Decisions

1. Use a dedicated `acceptance_validation:complete` event instead of overloading review output. This separates quality review from final PRD/AC certification.
2. Keep `prd_validation:complete` for gap summaries and emit acceptance verdicts as a separate terminal evidence event in the same PRD validation pass.
3. Treat missing per-criterion verdicts as `unknown`/failing evidence rather than silently passing with an empty `gaps` array.
4. Make `gap_close:complete.passed` required in the schema and update fixtures in the same plan so client wire parity remains synchronized.

## Scope

### In Scope

- Add `AcceptanceCriterionVerdict` and optional waiver/reference helper schemas in `packages/client/src/events.schemas.ts`.
- Add `acceptance_validation:complete` with fields sufficient for the final gate: `passed`, `verdicts`, optional `waivers`, and a source label such as `prd`.
- Export the new type from `packages/client/src/events.ts`, `packages/client/src/index.ts`, `packages/client/src/browser.ts`, and `packages/engine/src/events.ts`.
- Update `packages/client/src/event-registry.ts` summaries for `acceptance_validation:complete` and `gap_close:complete`.
- Update event schema tests and wire parity fixtures, including a negative fixture for `gap_close:complete` without `passed`.
- Update `packages/engine/src/prompts/prd-validator.md` to require positive evidence per acceptance criterion and remove the instruction to assume correctness when uncertain.
- Update `packages/engine/src/agents/prd-validator.ts` to parse verdicts, synthesize failing `unknown` verdicts for missing/unparseable evidence, and emit `acceptance_validation:complete`.
- Update PRD validator agent tests to cover pass/fail/unknown verdict parsing and unparseable verdict evidence.

### Out of Scope

- Orchestrator gating on the new event; plan-02 consumes the contract.
- Reviewer XML contract changes; plan-03 handles reviewer parsing and prompts.
- Worktree dirty-state enforcement; plan-04 handles git safety checks.

## Files

### Modify

- `packages/client/src/events.schemas.ts` — add acceptance verdict schemas/event and make `gap_close:complete.passed` required.
- `packages/client/src/events.ts` — re-export `AcceptanceCriterionVerdict` and any waiver/reference types added to the schema file.
- `packages/client/src/index.ts` — expose new public types and schemas through the package barrel.
- `packages/client/src/browser.ts` — mirror client public type exports for browser consumers.
- `packages/client/src/event-registry.ts` — add event metadata and stricter gap-close summary text.
- `packages/client/src/__tests__/events-schemas.test.ts` — add schema acceptance/rejection cases for the new event and required gap-close field.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add parity fixtures for `acceptance_validation:complete` and update `gap_close:complete` fixture with `passed`.
- `packages/engine/src/events.ts` — re-export the new client-owned types.
- `packages/engine/src/agents/prd-validator.ts` — parse verdict evidence and emit the acceptance validation event.
- `packages/engine/src/prompts/prd-validator.md` — require AC-by-AC verdicts with evidence and classify uncertainty as `unknown`.
- `test/prd-validator.test.ts` — update expected event streams and add verdict parsing tests.
- `test/prd-validator-fail-closed.test.ts` — assert missing verdict evidence fails closed.
- `test/agent-wiring.test.ts` — update PRD validator stubs that now need acceptance verdict JSON.
- Any other focused tests that construct `gap_close:complete` without `passed`.

## Verification

- [ ] `safeParseEforgeEvent({ type: 'acceptance_validation:complete', passed: true, verdicts: [...] })` succeeds with one `pass` verdict that includes non-empty evidence.
- [ ] `safeParseEforgeEvent({ type: 'gap_close:complete' })` fails because `passed` is missing.
- [ ] `runPrdValidator` emits `acceptance_validation:complete` with `passed: false` when agent JSON omits the verdict array.
- [ ] `runPrdValidator` emits at least one `unknown` verdict when the agent reports a criterion without evidence.
- [ ] `packages/engine/src/prompts/prd-validator.md` contains no phrase that instructs the validator to assume implementation correctness when uncertain.
- [ ] Focused tests for PRD validator parsing and client event parity pass.