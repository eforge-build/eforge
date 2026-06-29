---
id: plan-02-eforge-plan-cleanup
name: Clean Removed Queue Coverage in eforge-plan
branch: fix-removed-queue-coverage-cleanup/plan-02-eforge-plan-cleanup
agents:
  builder:
    effort: high
    rationale: The implementation spans canonical SQLite writes, lifecycle evidence,
      projection filtering, and recommendation actionability with several
      non-over-clearing edge cases.
  tester:
    effort: high
    rationale: Regression coverage must exercise SQLite fixtures and multiple
      projection/action surfaces for the same canonical cleanup path.
  reviewer:
    effort: high
    rationale: Review must check that queue cleanup does not erase unrelated build,
      PR, landing, or result evidence.
---

# Clean Removed Queue Coverage in eforge-plan

## Architecture Context

eforge-plan stores canonical backlog lifecycle evidence in SQLite, then derives board, search, get-item, recommendation, and planning-task eligibility from canonical rows and projection helpers. The current lifecycle hook records enqueue/start/complete/session/landing events but not queue removal, so `queue_prds` and current queue-tied lifecycle evidence can remain active after the daemon has removed the runtime PRD.

This plan consumes the `queue:prd:removed` signal from `plan-01-queue-removal-signal` and adds a single canonical cleanup path. Projection code must derive blockers from live coverage only: removed queue PRDs are terminal/non-active, while live pending/running queue records, active builds, open PRs, and submitted handoffs with live queue/build links continue to block planning eligibility.

## Implementation

### Overview

Add an eforge-plan cleanup helper for removed queue PRDs, register it in the extension lifecycle hook, and update coverage/projection/recommendation queries so terminal removed queue rows cannot synthesize active `queued-build` or `submitted-session-plan` coverage.

### Key Decisions

1. Centralize cleanup in one canonical helper invoked by the event hook and tests; do not duplicate queue-removal SQL in board/search/recommendation code.
2. Prefer updating matching `queue_prds` rows to terminal status `removed` over deleting them, unless existing canonical conventions require deletion, because terminal rows preserve audit evidence without projecting active coverage.
3. Mark only lifecycle evidence tied to the removed PRD as non-current or superseded with status `removed`; preserve current evidence tied to other queue PRDs, active build sessions, open PRs, landing/result evidence, and submitted handoffs with live queue/build links.
4. Share one live/terminal queue-status policy across canonical coverage, SQL projections, and recommendation actionability to prevent drift.

## Scope

### In Scope

- eforge-plan event hook for `queue:prd:removed`.
- Canonical cleanup of linked backlog items and linked session plans.
- Terminal/non-active handling for stale `queue_prds` rows.
- Non-current or terminal handling for current lifecycle evidence tied only to the removed PRD.
- Stale marking for affected backlog projections and recommendation projections.
- Filtering removed queue records from board, `list-board-compact`, `search-items`, `get-item`, recommendations, and planning-task eligibility.
- SQLite/projection regressions for failed, pending, waiting, and skipped removal cleanup.
- Edge-case regressions that keep live queue, live build, open PR, and live submitted handoff blockers active.

### Out of Scope

- Running build cancellation.
- Deleting session-plan Markdown files.
- Deleting backlog items.
- Changing queue dependency semantics.
- Console/CLI/MCP/Pi command rewrites when they already use the daemon client route.

## Files

### Create

- `eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts` — canonical helper such as `synchronizeRemovedQueuePrdCoverage(cwd, prdId, options?)` that runs in a canonical transaction, updates matching `queue_prds`, demotes/supersedes queue-tied lifecycle evidence, and marks affected projections/recommendations stale.
- `eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts` — focused SQLite regression fixture for removed queue cleanup across canonical rows and public eforge-plan projections.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — register handling for `queue:prd:removed` in the existing lifecycle hook and invoke the cleanup helper. Keep existing enqueue/session/landing behavior unchanged.
- `eforge/extensions/eforge-plan/planning-state-policy.ts` — add or extend queue status helpers, for example `isLiveQueuePrdStatus` and `isTerminalQueuePrdStatus`, with `removed` classified as terminal/non-live.
- `eforge/extensions/eforge-plan/canonical/coverage.ts` — update `findCanonicalNonterminalCoverage` so removed queue rows and removed queue-tied lifecycle evidence do not return nonterminal coverage.
- `eforge/extensions/eforge-plan/canonical/lifecycle-records.ts` — adjust only if the cleanup helper needs an existing record/supersede primitive for terminal status `removed`.
- `eforge/extensions/eforge-plan/canonical/store.ts` or SQLite store helpers — adjust only if a small shared transaction/query helper is needed.
- Board/list projection files under `eforge/extensions/eforge-plan/sqlite/` that implement `list-board-compact` and lane/coverage SQL — filter queue rows by live status and exclude terminal `removed` lifecycle evidence.
- Search/detail action implementation files under `eforge/extensions/eforge-plan/` that implement `search-items` and `get-item` coverage fields — use the same live queue policy as board projections.
- Recommendation implementation files under `eforge/extensions/eforge-plan/` that compute recommendation actionability and `planEligible` — use live canonical coverage only and mark affected recommendation projections stale after cleanup.
- `eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts` — add board/list compact assertions for removed queue and abandoned-plan scenarios if not covered by the new test file.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts` — add or extend assertions for terminal `removed` lifecycle evidence if this file already covers canonical lifecycle writes.
- Existing recommendation/actionability tests under `eforge/extensions/eforge-plan/__tests__/` — add regression coverage for removed queue attempts and live blocker preservation.

## Cleanup Helper Requirements

The helper must perform these steps in one canonical transaction:

1. Select all `queue_prds` rows matching the removed PRD id and collect affected backlog item refs/session plan ids.
2. Select current lifecycle evidence that references the removed PRD through queue/build/submitted-session-plan metadata and add those item refs to the affected set.
3. Update or remove matching `queue_prds` rows so the removed PRD cannot appear in active queue coverage. If rows are retained, set status to exactly `removed`.
4. Mark current lifecycle rows tied only to the removed PRD as non-current, or write a terminal replacement lifecycle row with status exactly `removed` and then mark the prior row non-current.
5. Leave lifecycle rows current when they are tied to another live queue PRD, an active build session, open PR evidence, landing/result evidence, or a submitted handoff with a live queue/build link.
6. Mark affected backlog projections stale using the existing projection invalidation mechanism.
7. Mark affected recommendations stale using `markRecommendationsStaleForLifecycleUpdate` or the existing recommendation invalidation mechanism.
8. Return a deterministic summary for tests, including affected item refs and counts of updated queue/lifecycle rows.

## Database Migration

No database migration is required; use existing canonical tables and status fields.

## Verification

- [ ] Removing a failed linked queue PRD changes matching `queue_prds` rows to terminal/non-active state and records status `removed` when a terminal row is retained.
- [ ] Removing pending, waiting, and skipped linked queue PRDs uses the same cleanup helper and yields terminal/non-active queue rows.
- [ ] Current `queued-build` lifecycle evidence tied only to the removed PRD becomes non-current or terminal with status `removed`.
- [ ] Current `submitted-session-plan` lifecycle evidence tied only to the removed PRD becomes non-current or terminal with status `removed`.
- [ ] Current lifecycle evidence tied to a different live queue PRD remains current.
- [ ] Current lifecycle evidence tied to an active build session remains current.
- [ ] Current open PR evidence remains current.
- [ ] `findCanonicalNonterminalCoverage` returns no live removed-queue coverage after queue removal plus abandoned plan when no other live blocker exists.
- [ ] SQL projection coverage reports `planEligible: true` after queue removal plus abandoned plan when no other live blocker exists.
- [ ] `list-board-compact` places a candidate with only abandoned session plans, applied planning tasks, and removed queue attempts in Inbox with `planEligible: true`.
- [ ] `search-items` reports no active `queued-build` or `submitted-session-plan` coverage from the removed PRD and returns `planEligible: true` for the no-other-blocker fixture.
- [ ] `get-item` reports no active `queued-build` or `submitted-session-plan` coverage from the removed PRD and returns `planEligible: true` for the no-other-blocker fixture.
- [ ] Recommendation actionability reports `planEligible: true` for the removed-queue plus abandoned-plan fixture.
- [ ] `planEligible` remains `false` while a live pending queue PRD remains linked.
- [ ] `planEligible` remains `false` while a live running queue PRD remains linked.
- [ ] `planEligible` remains `false` while active build evidence remains linked.
- [ ] `planEligible` remains `false` while open PR evidence remains linked.
- [ ] Submitted handoff evidence with a live queue link continues to suppress planning eligibility.
- [ ] Submitted handoff evidence with a live build link continues to suppress planning eligibility.
- [ ] The eforge-plan hook does not run cleanup for removal attempts that produced no `queue:prd:removed` event.
- [ ] Affected backlog projections are marked stale after cleanup.
- [ ] Affected recommendation projections are marked stale after cleanup.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/queue-removal-coverage-cleanup.test.ts` passes when the targeted test path is supported by the Vitest wrapper.
