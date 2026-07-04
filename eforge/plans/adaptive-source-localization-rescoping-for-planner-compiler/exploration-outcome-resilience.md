---
id: exploration-outcome-resilience
name: Structured exploration budget-exhaustion outcomes
branch: adaptive-source-localization-rescoping-for-planner-compiler/exploration-outcome-resilience
---

# Structured exploration budget-exhaustion outcomes

Implement the structured outcome contract and budget-exhaustion grace path for the read-only repository exploration agent.

## Scope

- In `packages/engine/src/planner-compiler/exploration-contracts.ts`, replace the hints-only `submit_exploration_hints` contract with a unified `submit_exploration_outcome` TypeBox-owned contract covering `completed`, `needs-rescope`, `budget-exhausted`, and `ambiguous` statuses. Do not keep a compatibility alias.
- Add `packages/engine/src/planner-compiler/localization-issue-contracts.ts` for the shared localization issue vocabulary. It must contain the existing repair issue kinds plus `too-broad` and `tool-budget`, and `source-localization-repair.ts` should consume the shared values without changing repair-loop trigger or semantics.
- Validate echoed `needId`, `criterionIds`, and `aspectIds` against the deterministic needs/criteria/aspects for the current scope. Drop unknown ids with a machine-readable diagnostic instead of rejecting the whole outcome.
- In `packages/engine/src/planner-compiler/exploration-agent.ts`, switch the completion tool to `submit_exploration_outcome`. When the read-only tool budget is reached, enter submit-only grace mode: reject further read-only calls with the budget-exhausted nudge, honor only the submit tool, and stay bounded by the existing/scaled turn ceiling.
- If the exploration agent finishes without submitting, synthesize a deterministic `budget-exhausted` outcome from known unresolved need ids, tool-use count, and empty rescope hints so downstream logic always receives a structured outcome.
- Apply the same submit-only grace-turn enforcement pattern in `packages/engine/src/planner-compiler/satisfaction-gate-agent.ts`, preserving its existing fail-open behavior.
- Extend `packages/engine/src/planner-compiler/compiler-diagnostics.ts` and `compiler-diagnostics-contracts.ts` so diagnostics record outcome status, unresolved needs, shared reasons, attempted queries, candidate paths, rescope hints, notes, unknown-id drops, and tool-use count.
- Do not update `packages/client/src/events/*` and do not add event wire variants. Rescope/diagnostic detail belongs in compiler diagnostics and existing `planning:*` events.

## Traceability

Criteria: ac-001, ac-002, ac-003
Aspects: ac-001:interface:schema, ac-001:interface:schema-contract, ac-001:subsystem:schema, ac-002:general:general, ac-003:general:general

## Validation

- `pnpm test -- test/planning-exploration-agent.test.ts test/planning-compiler-diagnostics.test.ts`
- `pnpm type-check`
- Verify schema validation accepts submitted and synthesized budget-exhausted outcomes, rejects/diagnoses malformed ids as specified, downstream compiler code receives structured outcomes in both cases, and diagnostics expose unresolved needs, reasons, attempted query context, and tool-use count.
