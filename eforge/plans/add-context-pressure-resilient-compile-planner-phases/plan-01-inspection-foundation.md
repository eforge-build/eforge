---
id: plan-01-inspection-foundation
name: Planner Inspection Budget and Handoff Foundation
branch: add-context-pressure-resilient-compile-planner-phases/plan-01-inspection-foundation
agents:
  builder:
    effort: high
    rationale: The foundation touches context accounting and bounded evidence
      extraction; small mistakes can bypass the hard guard or leak oversized
      transcripts.
  reviewer:
    effort: high
    rationale: Review must verify the new soft-budget math shares semantics with the
      existing hard context guard.
---

# Planner Inspection Budget and Handoff Foundation

## Architecture Context

The engine already has prompt-source compaction, model-aware hard context limits, guard diagnostics, and compile scope/context recovery. This plan adds the internal foundation for a soft bounded-inspection phase without changing public event wire shapes yet. The existing hard live-context guard remains the final fail-closed safety net.

## Implementation

### Overview

Extract reusable planner-family context observation from the hard guard, then add a focused planner-inspection module that derives soft budgets, observes inspection events, extracts bounded evidence, formats a compact handoff, and can persist that handoff as a JSON artifact under the plan-set output directory.

### Key Decisions

1. Share usage accounting with the hard guard instead of duplicating token/turn logic, so soft and hard pressure decisions interpret `agent:usage` events the same way.
2. Keep the first plan internal to avoid event-shape churn before the engine integration exists.
3. Build deterministic compact evidence from tool calls, tool results, usage events, messages, source identity, and budget diagnostics rather than adding another LLM summarization call near the context limit.
4. Cap every list and text field at module constants aligned with the client compile-resilience bounds planned in plan 02.

## Scope

### In Scope

- Reusable observation helpers for planner-family context usage.
- Soft planner-inspection budget derivation from hard context guard limits, model-aware diagnostics, planner maxTurns, and bounded default tool-use caps.
- Deterministic compact handoff extraction with required fields: source/build identifiers, relevant files, observed facts, important findings, inferred implementation areas, unresolved questions, source/build context, budget diagnostics, and incomplete-inspection caveats.
- Markdown prompt formatting for resumed synthesis.
- JSON artifact writer for the compact handoff.
- Unit tests for budget thresholds, cap behavior, path extraction, and no-full-transcript formatting.

### Out of Scope

- Running a second planner synthesis call.
- Adding new client event schemas.
- CLI, Console, plugin, or Pi rendering changes.
- Queue cleanup behavior or Auto-drain behavior.

## Files

### Create

- `packages/engine/src/compile-resilience/planner-inspection.ts` — Soft-budget derivation, event observer, compact summary builder, markdown formatter, and JSON artifact writer for planner inspection handoff data.
- `test/planner-inspection.test.ts` — Unit tests for budget derivation, evidence extraction, caps, caveats, and handoff formatting.

### Modify

- `packages/engine/src/compile-resilience/context-guard.ts` — Extract shared observation state/types/functions used by both hard guard enforcement and planner-inspection soft thresholds while preserving current hard failure behavior.
- `test/planner-context-guard.test.ts` — Extend existing guard tests to cover the shared observation helper and confirm existing hard-guard assertions still pass.

## Verification

- [ ] Existing prompt-byte, per-turn input-token, turn-budget, and final-usage context guard tests pass with the refactored observation helper.
- [ ] `derivePlannerInspectionBudget` returns a soft input-token threshold lower than the hard `maxObservedInputTokens` for default and model-aware guard inputs.
- [ ] `derivePlannerInspectionBudget` returns an inspection turn budget lower than an 80-turn planner maxTurns value.
- [ ] Compact summaries include source/build identifiers, relevant files, observed facts, important findings, inferred implementation areas, unresolved questions, source/build context, budget diagnostics, and caveats.
- [ ] Compact summary arrays and text snippets are capped in tests with omitted-count diagnostics.
- [ ] The handoff formatter includes compact snippets and excludes raw oversized tool-result bodies.