---
id: plan-01-fix-zero-plans-crash
name: Fix Build Phase Crash When Planner Generates 0 Plans
dependsOn: []
branch: fix-build-phase-crash-when-planner-generates-0-plans/fix-zero-plans-crash
---

# Fix Build Phase Crash When Planner Generates 0 Plans

## Architecture Context

The eforge pipeline flows: compile (planner agent) -> build (builder agent). The planner can emit a `<skip>` XML block when a PRD is already satisfied, which triggers a `plan:skip` event and halts the pipeline before the build phase. However, if the planner generates 0 plan files *without* emitting `<skip>` (LLM format non-compliance), the engine proceeds to the build phase which crashes with ENOENT trying to read `orchestration.yaml`.

Three layers of defense are needed: (1) strengthen the prompt so the agent reliably emits `<skip>`, (2) defensive engine code treating 0 plans as implicit skip, (3) a guard in `build()` against missing `orchestration.yaml`.

## Implementation

### Overview

This plan implements all five changes from the PRD: planner prompt strengthening, defensive 0-plans handling in the planner agent, `orchestration.yaml` existence guard in `build()`, test updates, and MCP proxy `INFO_EVENTS` addition.

### Key Decisions

1. **Emit `plan:skip` with reason `'No plans generated'` when 0 plans are found** - This reuses the existing skip infrastructure (the `buildSinglePrd` method already checks for `plan:skip` and routes to `prdResult = { status: 'skipped' }`), avoiding any new event types or control flow changes.
2. **Guard `build()` with `existsSync` before `validatePlanSet`** - The `validatePlanSet` function reads `orchestration.yaml` and throws ENOENT if missing. Adding a pre-check with a descriptive failure message is cleaner than wrapping in try/catch.
3. **Prompt changes use three-point reinforcement** - Early-exit rule near the top, cross-reference in the existing location, and reinforcement at the end. This follows prompt engineering best practice for critical instructions.

## Scope

### In Scope
- Planner prompt (`packages/engine/src/prompts/planner.md`): add "Critical Rule: Skip When Fully Implemented" section after Source, replace existing skip paragraph with cross-reference, add reinforcement in Output section
- Planner agent (`packages/engine/src/agents/planner.ts`): emit `plan:skip` instead of `plan:complete` when `plans.length === 0`
- Engine build guard (`packages/engine/src/eforge.ts`): add `existsSync(configPath)` check before `validatePlanSet`
- Test updates (`test/agent-wiring.test.ts`): update "emits plan lifecycle events for a basic run" test to assert `plan:skip` with reason
- MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`): add `'plan:skip'` to `INFO_EVENTS` set

### Out of Scope
- Changes to Pi/Codex backend prompt delivery mechanism
- Broader planner prompt restructuring beyond the skip instruction
- Changes to existing `<skip>` block parsing or `plan:skip` event infrastructure

## Files

### Modify
- `packages/engine/src/prompts/planner.md` - Add "Critical Rule: Skip When Fully Implemented" section after the `{{continuation_context}}` template variable (around line 14), replace the skip paragraph at line 47-51 with a cross-reference to the new section, and add output reinforcement at lines 466-468
- `packages/engine/src/agents/planner.ts` - After plan scanning loop (line 203-205), check `plans.length === 0` and yield `plan:skip` with reason `'No plans generated'` instead of `plan:complete` with empty plans
- `packages/engine/src/eforge.ts` - Before the `validatePlanSet(configPath)` call (line 489), add `existsSync(configPath)` guard that sets `status = 'failed'` with descriptive summary and returns
- `test/agent-wiring.test.ts` - Update the "emits plan lifecycle events for a basic run" test (lines 24-38) to expect `plan:skip` with reason `'No plans generated'` instead of `plan:complete` with empty plans
- `packages/eforge/src/cli/mcp-proxy.ts` - Add `'plan:skip'` to the `INFO_EVENTS` set (line 67-73)

## Verification

- [ ] `pnpm test` passes - the updated "emits plan lifecycle events for a basic run" test asserts `findEvent(events, 'plan:skip')` is defined and `findEvent(events, 'plan:skip')!.reason` equals `'No plans generated'`
- [ ] `pnpm type-check` passes with zero type errors
- [ ] In `packages/engine/src/prompts/planner.md`, a "## Critical Rule: Skip When Fully Implemented" heading exists between the `{{continuation_context}}` line and the `## Plan Set` heading
- [ ] In `packages/engine/src/prompts/planner.md`, the old skip paragraph (lines 47-51 starting with "If the source is fully implemented") is replaced with a one-line cross-reference mentioning "Critical Rule"
- [ ] In `packages/engine/src/prompts/planner.md`, the Output section (line 466+) contains text about `<skip>` block completing output
- [ ] In `packages/engine/src/agents/planner.ts`, when `plans.length === 0` after scanning, the function yields `{ type: 'plan:skip', reason: 'No plans generated' }` and returns (does not yield `plan:complete`)
- [ ] In `packages/engine/src/eforge.ts`, a `!existsSync(configPath)` check exists before the `validatePlanSet(configPath)` call, setting `status = 'failed'` and returning
- [ ] The `INFO_EVENTS` set in `packages/eforge/src/cli/mcp-proxy.ts` contains `'plan:skip'`
