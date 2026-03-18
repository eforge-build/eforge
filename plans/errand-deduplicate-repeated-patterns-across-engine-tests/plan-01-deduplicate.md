---
id: plan-01-deduplicate
name: Deduplicate Repeated Patterns Across Engine and Tests
depends_on: []
branch: errand-deduplicate-repeated-patterns-across-engine-tests/deduplicate
---

# Deduplicate Repeated Patterns Across Engine and Tests

## Architecture Context

The codebase has four copy-pasted patterns that each appear in 3+ locations - past the project's colocate-until-reused threshold. All four extractions are mechanical: define once, import everywhere. No behavioral changes.

## Implementation

### Overview

Extract four duplicated patterns into shared locations: `SEVERITY_ORDER` into the engine events module, a `formatIssueSummary()` helper in display.ts, shared test event helpers, and a shared temp dir factory.

### Key Decisions

1. `SEVERITY_ORDER` goes in `src/engine/events.ts` next to the `ReviewIssue` interface it references - keeps the type and its ordering co-located.
2. `formatIssueSummary()` stays private in `display.ts` since it's a rendering concern with chalk dependencies - not worth a separate module.
3. Test helpers go in `test/test-events.ts` and `test/test-tmpdir.ts` following the project convention that shared test utils are extracted once 3+ files use them.
4. `useTempDir()` returns a `makeTempDir` function and registers its own `afterEach` cleanup via vitest - callers just call `const makeTempDir = useTempDir('prefix')` inside their describe block.

## Scope

### In Scope
- Extract `SEVERITY_ORDER` to `src/engine/events.ts`, update 3 consumers
- Extract `formatIssueSummary()` as private helper in `src/cli/display.ts`, replace 3 inline blocks
- Create `test/test-events.ts` with `collectEvents`, `findEvent`, `filterEvents` - update all consuming test files
- Create `test/test-tmpdir.ts` with `useTempDir()` factory - update all 7 consuming test files

### Out of Scope
- `collectEventsAndResult()` in `formatter-agent.test.ts` (unique variant, stays inline)
- Any behavioral changes

## Files

### Create
- `test/test-events.ts` - shared `collectEvents()`, `findEvent()`, `filterEvents()` helpers typed against `EforgeEvent`
- `test/test-tmpdir.ts` - shared `useTempDir(prefix?)` factory that registers `afterEach` cleanup via vitest

### Modify

**Engine (SEVERITY_ORDER extraction):**
- `src/engine/events.ts` - Add `export const SEVERITY_ORDER: Record<ReviewIssue['severity'], number>` with values `{ critical: 0, warning: 1, suggestion: 2 }`
- `src/engine/pipeline.ts` - Remove local `SEVERITY_ORDER` definition (lines 248-252), add import from `./events.js`
- `src/engine/agents/review-fixer.ts` - Remove local `SEVERITY_ORDER` inside `formatIssuesForPrompt`, add import from `../events.js`
- `src/engine/agents/parallel-reviewer.ts` - Remove local `SEVERITY_ORDER` inside `deduplicateIssues`, add import from `../events.js`

**CLI (formatIssueSummary extraction):**
- `src/cli/display.ts` - Add private `formatIssueSummary(issues: ReviewIssue[]): string` helper that filters by severity, counts, and returns chalk-colorized string. Replace the three inline filter-count-colorize blocks at:
  - Lines 161-168 (plan:review:complete handler)
  - Lines 198-205 (plan:cohesion:complete handler)
  - Lines 259-266 (build:review:complete handler)
  - Import `ReviewIssue` type from engine events if not already imported

**Test event helpers (13 files):**
- `test/agent-wiring.test.ts` - Remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/staleness-assessor.test.ts` - Remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/parallel-reviewer.test.ts` - Remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/doc-updater-wiring.test.ts` - Remove inline `collectEvents`, `findEvent`; import from `./test-events.js`
- `test/dynamic-profile-generation.test.ts` - Remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/cohesion-review.test.ts` - Remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/validation-fixer.test.ts` - Remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/sdk-event-mapping.test.ts` - Remove inline `collectEvents`; import from `./test-events.js`
- `test/sdk-mapping.test.ts` - Remove inline `collectEvents`; import from `./test-events.js`
- `test/assessor-wiring.test.ts` - Remove inline `collectEvents`, `findEvent`, `filterEvents`; import from `./test-events.js`
- `test/merge-conflict-resolver.test.ts` - Remove inline `collectEvents`, `findEvent`; import from `./test-events.js`
- `test/watch-queue.test.ts` - Remove inline `collectEvents`; import from `./test-events.js`
- `test/hooks.test.ts` - Remove inline `collectEvents` (inside describe block); import from `./test-events.js`
- `test/formatter-agent.test.ts` - Remove inline `findEvent`, `filterEvents`; import from `./test-events.js`. Keep `collectEventsAndResult` inline.

**Test temp dir helpers (7 files, some with multiple describe blocks):**
- `test/plan-parsing.test.ts` - Remove `tempDirs`/`makeTempDir`/`afterEach` boilerplate; use `const makeTempDir = useTempDir('eforge-inject-profile-')` from `./test-tmpdir.js`
- `test/adopt.test.ts` - Remove boilerplate in both describe blocks; use `useTempDir('eforge-adopt-test-')` and `useTempDir('eforge-adopt-artifacts-')`
- `test/prd-queue-enqueue.test.ts` - Remove boilerplate; use `useTempDir('eforge-enqueue-test-')`
- `test/prd-queue.test.ts` - Remove boilerplate; use `useTempDir('eforge-prd-status-')`
- `test/dynamic-profile-generation.test.ts` - Remove boilerplate; use `useTempDir('eforge-dynamic-profile-test-')`
- `test/agent-wiring.test.ts` - Remove boilerplate in both describe blocks; use `useTempDir('eforge-planner-test-')` and `useTempDir('eforge-planner-profile-test-')`
- `test/state.test.ts` - Remove boilerplate; use `useTempDir('eforge-state-test-')`

## Verification

- [ ] `SEVERITY_ORDER` is exported from `src/engine/events.ts` and no local definitions of `SEVERITY_ORDER` exist in `pipeline.ts`, `review-fixer.ts`, or `parallel-reviewer.ts`
- [ ] `display.ts` contains a `formatIssueSummary` function and the three inline filter-count-colorize blocks are replaced with calls to it
- [ ] `test/test-events.ts` exports `collectEvents`, `findEvent`, and `filterEvents`
- [ ] No test file (other than `formatter-agent.test.ts`'s `collectEventsAndResult`) defines `collectEvents`, `findEvent`, or `filterEvents` inline
- [ ] `test/test-tmpdir.ts` exports `useTempDir`
- [ ] No test file defines inline `makeTempDir` + `tempDirs` + `afterEach` cleanup boilerplate
- [ ] `formatter-agent.test.ts` still defines `collectEventsAndResult` inline
- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
