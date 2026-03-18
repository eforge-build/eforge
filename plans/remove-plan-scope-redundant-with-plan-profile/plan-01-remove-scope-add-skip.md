---
id: plan-01-remove-scope-add-skip
name: Remove plan:scope Event and Add plan:skip Event
depends_on: []
branch: remove-plan-scope-redundant-with-plan-profile/remove-scope-add-skip
---

# Remove plan:scope Event and Add plan:skip Event

## Architecture Context

eforge's event system uses a discriminated union (`EforgeEvent`) in `src/engine/events.ts`. Events flow from agent runners through the pipeline, emitted as an `AsyncGenerator<EforgeEvent>`, consumed by CLI display and the web monitor. The planner agent parses XML blocks from LLM output and maps them to typed events. The `plan:scope` event is redundant with `plan:profile` - both communicate the planner's complexity classification. The `complete` scope assessment's early-exit behavior needs to survive as a new `plan:skip` event.

## Implementation

### Overview

Remove all `plan:scope` infrastructure (types, constants, parsing, emission, rendering, tests) and replace the "already complete" early-exit behavior with a new `plan:skip` event. The `plan:skip` event signals that the planner determined the source is already fully implemented - the CLI exits early (code 0) and the monitor renders the skip reason.

### Key Decisions

1. `plan:skip` has a single `reason: string` field rather than replicating `assessment`/`justification` - it's a binary signal ("skip" or "don't skip") with an explanation, not a classification.
2. The `<skip>` XML block uses `<skip>reason</skip>` format - simpler than `<scope assessment="complete">` since there's no assessment attribute needed.
3. The planner prompt's scope assessment section is replaced entirely - the Phase 3 instructions are updated to remove the scope table and `<scope>` block format, replacing only the "complete" case with `<skip>` block instructions. The dimension/file-count guidance remains for profile selection context but no longer produces a `<scope>` block.
4. `scopeAssessment` field in `PipelineContext` is removed - no pipeline logic branches on it except the expedition compilation suppression, which can use `expeditionModules.length > 0` instead (it already does).
5. The `formatProfileGenerationSection` function in `planner.ts` has a line "After generating a profile, still emit the `<scope>` block (both are required)" - this must be updated to remove the scope reference.

## Scope

### In Scope
- Remove `SCOPE_ASSESSMENTS` constant, `ScopeAssessment` type, and `plan:scope` event variant from `events.ts`
- Remove `ScopeAssessment` export from `index.ts`
- Remove `ScopeDeclaration`, `VALID_ASSESSMENTS`, `parseScopeBlock()` from `common.ts`
- Remove `scopeEmitted` flag and all `plan:scope` emission from `planner.ts`; remove scope-related imports
- Add `parseSkipBlock()` to `common.ts` - parses `<skip>reason</skip>`
- Add `plan:skip` emission to `planner.ts` when `<skip>` block detected
- Remove `scopeAssessment` field from `PipelineContext` in `pipeline.ts`
- Remove hardcoded `plan:scope` emission from `prd-passthrough` stage in `pipeline.ts`
- Remove `plan:scope` tracking in `planner` stage in `pipeline.ts`
- Replace `scopeComplete` early-exit in `cli/index.ts` with `plan:skip` check
- Remove `plan:scope` display case and add `plan:skip` case in `cli/display.ts`
- Remove `ScopeAssessment` re-export from `monitor/ui/src/lib/types.ts`
- Remove `plan:scope` from event classification and summary in `monitor/ui/src/components/timeline/event-card.tsx`; add `plan:skip`
- Replace mock `plan:scope` events in `monitor/mock-server.ts` - remove all of them (none were `complete`, so no conversion to `plan:skip` needed)
- Remove scope test cases from `test/agent-wiring.test.ts`; add `plan:skip` wiring test
- Remove `parseScopeBlock` tests from `test/xml-parsers.test.ts`; add `parseSkipBlock` tests
- Remove `ScopeAssessment` import and `scopeAssessment` mutable state test from `test/pipeline.test.ts`
- Update planner prompt to remove `<scope>` block instructions and add `<skip>` block instructions
- Update `formatProfileGenerationSection` to remove the "still emit the `<scope>` block" instruction

### Out of Scope
- Changes to `plan:profile` event or profile selection logic
- Changes to pipeline stage ordering or build workflow
- Changes to the eforge plugin (only a documentation reference to "scope", not code)

## Files

### Modify
- `src/engine/events.ts` - Remove `SCOPE_ASSESSMENTS` constant, `ScopeAssessment` type, `plan:scope` variant from the `EforgeEvent` union. Add `plan:skip` variant: `{ type: 'plan:skip'; reason: string }`.
- `src/engine/index.ts` - Remove `ScopeAssessment` from the type re-export list.
- `src/engine/agents/common.ts` - Remove `ScopeDeclaration` interface, `VALID_ASSESSMENTS` set, `parseScopeBlock()` function, and related imports (`SCOPE_ASSESSMENTS`, `ScopeAssessment`). Add `parseSkipBlock(text: string): string | null` function that parses `<skip>reason</skip>`.
- `src/engine/agents/planner.ts` - Remove `scopeEmitted` flag, all `plan:scope` emission logic (both direct XML parsing and fallback from profile name), and related imports (`SCOPE_ASSESSMENTS`, `ScopeAssessment`, `parseScopeBlock`). Import and use `parseSkipBlock`. Add `skipEmitted` flag and emit `plan:skip` when `<skip>` block detected. Update `formatProfileGenerationSection` to remove the scope block reference.
- `src/engine/pipeline.ts` - Remove `ScopeAssessment` import, `scopeAssessment` field from `PipelineContext`, `plan:scope` tracking in planner stage, and hardcoded `plan:scope` emission in prd-passthrough stage. In the planner stage, replace `ctx.scopeAssessment === 'expedition'` guard with `ctx.expeditionModules.length > 0` (already the primary guard on the same line).
- `src/cli/index.ts` - Replace `scopeComplete` flag and `plan:scope`-based early-exit with `planSkipped` flag and `plan:skip`-based early-exit.
- `src/cli/display.ts` - Remove `plan:scope` case from `renderEvent`. Add `plan:skip` case that renders the skip reason.
- `src/monitor/ui/src/lib/types.ts` - Remove `ScopeAssessment` from the re-export list.
- `src/monitor/ui/src/components/timeline/event-card.tsx` - Remove `plan:scope` from `classifyEvent` info check. Add `plan:skip` to info classification. Remove `plan:scope` case from `eventSummary`. Add `plan:skip` case to `eventSummary`.
- `src/monitor/mock-server.ts` - Remove all 6 `plan:scope` event insertions (lines 239, 322, 510, 564, 679, 841). None had `assessment: 'complete'`, so no conversion to `plan:skip` is needed.
- `test/agent-wiring.test.ts` - Remove the "detects scope assessment from agent output" test (lines 37-52). Remove the "emits both plan:profile and plan:scope" test (lines 258-278). Remove the "emits only plan:scope when no profile block" test (lines 301-318). Add a test for `plan:skip` emission when agent outputs `<skip>reason</skip>`.
- `test/xml-parsers.test.ts` - Remove the entire `parseScopeBlock` describe block (lines 117-186). Remove `parseScopeBlock` from the import. Add `parseSkipBlock` to the import and add a `parseSkipBlock` describe block with tests for: valid skip, empty content, no block, surrounding text.
- `test/pipeline.test.ts` - Remove `ScopeAssessment` from the import on line 10. Remove or update the "scopeAssessment set by first stage is readable by subsequent stage" test (lines 352-373) since the field no longer exists.
- `src/engine/prompts/planner.md` - In the "Scope Boundary" section, replace the instruction to emit `<scope assessment="complete">` with instruction to emit `<skip>reason</skip>`. Remove the entire "Phase 3: Scope Assessment" section (the assessment table, dimension table, file count table, split criteria, and the `<scope>` block format). Add a "Skip Detection" section near the scope boundary that instructs the agent to emit `<skip>reason</skip>` when the source is fully implemented. In the "Profile Selection" section, remove the line "After selecting a profile, still emit the `<scope>` block in Phase 3 (both are required)". In the "Phase 4: Plan Generation" section, reword line 128 "Output depends on your scope assessment:" to "Output depends on the number of plans:" (scope assessment no longer exists). In the orchestration.yaml format section, reword line 331 "`mode` must match your scope assessment: `errand` for 1 plan, `excursion` for 2-3 plans" to "`mode` must match the plan count: `errand` for 1 plan, `excursion` for 2-3 plans".

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all tests pass)
- [ ] `pnpm build` exits with code 0
- [ ] `grep -r 'ScopeAssessment' src/ test/` returns zero matches
- [ ] `grep -r 'SCOPE_ASSESSMENTS' src/ test/` returns zero matches
- [ ] `grep -r 'parseScopeBlock' src/ test/` returns zero matches
- [ ] `grep -r 'ScopeDeclaration' src/ test/` returns zero matches
- [ ] `grep -r 'VALID_ASSESSMENTS' src/ test/` returns zero matches
- [ ] `grep -r "'plan:scope'" src/ test/` returns zero matches
- [ ] `grep -r '"plan:scope"' src/ test/` returns zero matches
- [ ] `grep -r 'scopeAssessment' src/ test/` returns zero matches
- [ ] `grep 'plan:skip' src/engine/events.ts` returns exactly one match (the event variant)
- [ ] `grep 'parseSkipBlock' src/engine/agents/common.ts` returns a function definition
- [ ] `grep 'plan:skip' src/cli/display.ts` returns a display case
- [ ] `grep 'plan:skip' src/cli/index.ts` returns early-exit logic
- [ ] Planner prompt (`src/engine/prompts/planner.md`) contains `<skip>` instruction and does not contain `<scope assessment=`
- [ ] Planner prompt does not contain "Phase 3: Scope Assessment"
