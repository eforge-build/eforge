---
id: plan-02-tests-and-monitor
name: Update tests and monitor UI for plan:skip
depends_on: [plan-01-remove-scope-add-skip]
branch: remove-plan-scope-event-replace-complete-signal-with-plan-skip/tests-and-monitor
---

# Update tests and monitor UI for plan:skip

## Architecture Context

After plan-01 removes `plan:scope` and adds `plan:skip` in the engine, all test files and the monitor UI need updating to match. Tests validate the new parsing and event wiring; the monitor UI renders `plan:skip` events in the timeline.

## Implementation

### Overview

Update four test files to remove scope-related tests, add skip-related tests, and update the monitor UI (types, event card, mock server) to handle the new `plan:skip` event instead of `plan:scope`.

### Key Decisions

1. Scope-related tests are removed entirely (not converted) since the scope concept no longer exists
2. New `parseSkipBlock` tests follow the same structure as the removed `parseScopeBlock` tests - valid input, null for missing/empty, surrounding text handling
3. New planner wiring test verifies `<skip>` block in agent output produces a `plan:skip` event
4. Monitor mock server replaces `plan:scope` events with `plan:skip` only where assessment was `complete`; other scope events are simply removed since they were informational
5. Session test updates the "generator returns early" test to use `plan:skip` instead of `plan:scope`/`complete`

## Scope

### In Scope
- Remove `parseScopeBlock` describe block and import from `test/xml-parsers.test.ts`; add `parseSkipBlock` tests
- Remove 3 scope-related tests from `test/agent-wiring.test.ts`; add `plan:skip` emission test
- Update `test/session.test.ts` "generator returns early" test to use `plan:skip`
- Remove `ScopeAssessment` import and `scopeAssessment` pipeline context test from `test/pipeline.test.ts`
- Remove `ScopeAssessment` import from monitor types (`src/monitor/ui/src/lib/types.ts`)
- Update event card (`src/monitor/ui/src/components/timeline/event-card.tsx`): remove `plan:scope` from classification and summary; add `plan:skip` handling
- Update mock server (`src/monitor/mock-server.ts`): replace `plan:scope` events with `plan:skip` where applicable, remove the rest

### Out of Scope
- Engine core changes (done in plan-01)
- Changes to profile selection tests
- Adding new test scenarios beyond what's needed to cover the skip/scope swap

## Files

### Modify
- `test/xml-parsers.test.ts` — Remove `parseScopeBlock` describe block (8 tests) and import; add `parseSkipBlock` describe block with tests for valid parse, null on missing block, null on empty content, surrounding text handling
- `test/agent-wiring.test.ts` — Remove "detects scope assessment from agent output" test (lines 37-51), "emits both plan:profile and plan:scope when profile name matches a built-in scope" test (lines 258-278), "emits only plan:scope when no profile block but scope block is present" test (lines 301-318); add test: planner emits `<skip>` block → `plan:skip` event with reason string
- `test/session.test.ts` — Update "emits session:end with completed result when generator returns early (scope-complete)" test (lines 115-130) to yield `plan:skip` event instead of `plan:scope`/`complete`; update test description
- `test/pipeline.test.ts` — Remove `ScopeAssessment` from events import; remove "scopeAssessment set by first stage is readable by subsequent stage" test (lines 352-375)
- `src/monitor/ui/src/lib/types.ts` — Remove `ScopeAssessment` from the import list
- `src/monitor/ui/src/components/timeline/event-card.tsx` — In `classifyEvent`: remove `plan:scope` from the info classification condition; add `plan:skip` to info classification. In `eventSummary`: remove `plan:scope` case; add `plan:skip` case returning `"Skipped — {reason}"`. In `eventDetail`: no changes needed (plan:scope had no detail handler)
- `src/monitor/mock-server.ts` — Remove all 6 `plan:scope` event insertions; no `plan:skip` replacements needed since mock data represents normal runs (not already-complete scenarios)

## Verification

- [ ] `pnpm test` passes with zero failures
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm build` completes with zero errors
- [ ] `grep -r 'ScopeAssessment\|SCOPE_ASSESSMENTS\|parseScopeBlock\|ScopeDeclaration\|scopeEmitted\|scopeComplete\|plan:scope' test/` returns zero matches
- [ ] `grep -r 'plan:scope' src/monitor/` returns zero matches
- [ ] `test/xml-parsers.test.ts` contains a `parseSkipBlock` describe block with at least 4 test cases
- [ ] `test/agent-wiring.test.ts` contains a test that verifies `<skip>reason</skip>` in agent output produces a `plan:skip` event
- [ ] `test/session.test.ts` "generator returns early" test yields `plan:skip` (not `plan:scope`)
- [ ] Monitor event card in `event-card.tsx` handles `plan:skip` in both `classifyEvent` and `eventSummary` functions
- [ ] No references to `plan:scope`, `ScopeAssessment`, `parseScopeBlock`, or `scopeAssessment` remain in `src/` or `test/`
