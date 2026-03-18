---
id: plan-01-remove-scope-add-skip
name: Remove plan:scope event and add plan:skip
depends_on: []
branch: remove-plan-scope-event-replace-complete-signal-with-plan-skip/remove-scope-add-skip
---

# Remove plan:scope event and add plan:skip

## Architecture Context

The `plan:scope` event and `ScopeAssessment` type communicate scope complexity (errand/excursion/expedition/complete) alongside profile selection. Profile selection already conveys the planner's complexity judgment, making scope redundant - and actively misleading with custom profiles. The only pipeline-significant use of scope is the `assessment === 'complete'` early-exit signal, which deserves its own purpose-built event type.

## Implementation

### Overview

Remove all `plan:scope` infrastructure (event variant, types, constants, XML parser, emission logic) and replace the "already complete" early-exit with a new `plan:skip` event. This plan covers engine core, agents, pipeline, CLI, and prompt changes.

### Key Decisions

1. `plan:skip` carries a `reason: string` instead of an assessment enum - it's a single-purpose "work is already done" signal, not a scope classification
2. `parseSkipBlock` parses `<skip>reason</skip>` XML - simpler than the old `<scope assessment="...">` format since there's no enum to validate
3. Pipeline context drops `scopeAssessment` field entirely - expedition detection uses `ctx.expeditionModules.length > 0` (already the meaningful signal)
4. The prd-passthrough compile stage no longer emits `plan:scope` - it was emitting `assessment: 'errand'` which was purely informational

## Scope

### In Scope
- Remove `SCOPE_ASSESSMENTS` constant, `ScopeAssessment` type from `src/engine/events.ts`
- Remove `plan:scope` variant from `EforgeEvent` union, add `plan:skip` variant
- Remove `ScopeDeclaration` interface, `VALID_ASSESSMENTS` set, `parseScopeBlock()` from `src/engine/agents/common.ts`
- Add `parseSkipBlock()` to `src/engine/agents/common.ts`
- Update planner agent (`src/engine/agents/planner.ts`): remove scope emission, add skip emission
- Update planner prompt (`src/engine/prompts/planner.md`): replace `<scope>` instructions with `<skip>`
- Update pipeline context (`src/engine/pipeline.ts`): remove `scopeAssessment` field, simplify expedition check, remove prd-passthrough scope emission
- Update CLI flow (`src/cli/index.ts`): replace `scopeComplete` with `skipReason`
- Update CLI display (`src/cli/display.ts`): remove `plan:scope` case, add `plan:skip` case
- Remove `ScopeAssessment` export from barrel (`src/engine/index.ts`)
- Update `formatProfileGenerationSection` in planner.ts to remove scope reference

### Out of Scope
- Changes to profile selection logic
- Changes to other event types
- Monitor UI changes (handled in plan-02)
- Test changes (handled in plan-02)

## Files

### Modify
- `src/engine/events.ts` — Remove `SCOPE_ASSESSMENTS`, `ScopeAssessment`, `plan:scope` variant; add `plan:skip` variant with `reason: string`
- `src/engine/agents/common.ts` — Remove `ScopeDeclaration`, `VALID_ASSESSMENTS`, `parseScopeBlock()`; remove `SCOPE_ASSESSMENTS`/`ScopeAssessment` imports; add `parseSkipBlock()`
- `src/engine/agents/planner.ts` — Remove `scopeEmitted` flag, all `plan:scope` emission logic, fallback scope derivation from profile name, `SCOPE_ASSESSMENTS`/`ScopeAssessment`/`parseScopeBlock` imports; add `parseSkipBlock` import and `plan:skip` emission
- `src/engine/prompts/planner.md` — Remove all `<scope>` block instructions; add `<skip>` block instruction for already-implemented work
- `src/engine/pipeline.ts` — Remove `scopeAssessment` from `PipelineContext`, remove `ScopeAssessment` import, remove scope tracking in planner stage, simplify expedition check to `ctx.expeditionModules.length > 0`, remove `plan:scope` emission in prd-passthrough stage
- `src/cli/index.ts` — Replace `scopeComplete` boolean with `skipReason` string; replace `plan:scope`/`complete` check with `plan:skip` check; update early-return and exit code logic
- `src/cli/display.ts` — Remove `plan:scope` case from `renderEvent()`; add `plan:skip` case with dim color + reason
- `src/engine/index.ts` — Remove `ScopeAssessment` type export

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `grep -r 'ScopeAssessment\|SCOPE_ASSESSMENTS\|parseScopeBlock\|ScopeDeclaration\|scopeEmitted\|scopeComplete\|plan:scope' src/` returns zero matches
- [ ] `plan:skip` variant exists in the `EforgeEvent` union in `src/engine/events.ts` with `{ type: 'plan:skip'; reason: string }`
- [ ] `parseSkipBlock('<skip>Already done</skip>')` returns `'Already done'`; `parseSkipBlock('no skip')` returns `null`
- [ ] `PipelineContext` in `src/engine/pipeline.ts` has no `scopeAssessment` field
- [ ] prd-passthrough stage in `src/engine/pipeline.ts` does not emit any scope-related event
- [ ] CLI `allPhases` generator in `src/cli/index.ts` checks for `plan:skip` event type (not `plan:scope`) and exits early with code 0
- [ ] `renderEvent` in `src/cli/display.ts` handles `plan:skip` and the exhaustive switch compiles without error
- [ ] Planner prompt (`src/engine/prompts/planner.md`) contains `<skip>` instruction and does not contain `<scope assessment=`
