---
title: Fix Removed Queue Coverage Cleanup
created: 2026-06-27
---

# Fix Removed Queue Coverage Cleanup

## Problem / Motivation

Removing a failed or stale eforge queue item currently clears the runtime queue file and sidecars, but eforge-plan can retain canonical coverage for the linked backlog item or session plan.

The daemon queue-control implementation removes queue files and failed recovery sidecars, then returns `currentStatus: 'removed'`, but eforge-plan does not receive a durable canonical cleanup for that removal. As a result:

- A linked backlog item may remain in the In Progress lane.
- `planEligible` may remain `false`.
- `queue_prds` may still report a queued PRD.
- Current lifecycle evidence may still report `submitted-session-plan` or queued-build coverage.
- Console, CLI, MCP, Pi, and daemon removal surfaces can appear successful while eforge-plan board, detail, recommendations, and planning-task eligibility remain stale.

The root cause is that the extension lifecycle hook listens to enqueue, queue start/complete, session, and landing events, but not queue removal. Canonical SQL can therefore retain `queue_prds.status = 'queued'` and current lifecycle rows tied to the removed PRD. Projection code also synthesizes queue/build links from stored `queue_prds` rows and treats current submitted/queued evidence as blockers. Separately, abandoning a session plan clears planned-session evidence, but it does not clear submitted handoff evidence or stale queue rows linked to the removed PRD.

## Goal

Fix eforge-plan’s removed-queue coverage leak by adding a canonical queue-removal synchronization path for linked backlog items and session plans.

Successful queue removal should make linked queue records terminal or non-active, mark queue-tied lifecycle evidence non-current, and make board/search/get-item/recommendation projections derive eligibility from live coverage only.

## Approach

- Add a canonical queue-removal synchronization path shared by the existing daemon API, Console controls, CLI/MCP tools, and Pi tools.
- If a `queue:prd:removed` signal is added, update the client event contract and registry.
- Update monitor queue-control routes to trigger synchronization after successful removal.
- Update eforge-plan lifecycle hook registration to observe queue removal.
- Add a canonical queue-removal cleanup helper.
- Update projection/link coverage policy so removed queue records cannot project as active coverage.
- Update recommendation actionability to use live coverage only.
- Mark queue-tied current lifecycle evidence non-current or terminal with status `removed`.
- Update or remove linked `queue_prds` rows so they cannot project as active.
- Mark affected backlog projections stale.
- Mark affected recommendation projections stale.
- Keep CLI/MCP/Pi tests focused on existing shared daemon client behavior unless the response contract changes.
- Guard against over-clearing unrelated PR/result evidence.
- Guard against racing a queue claim.
- Guard against projection drift across canonical coverage, SQL projections, and legacy recommendation actionability.

Validation should use targeted SQLite/projection regressions, route/tool coverage, and the standard type/test/maintainability gates. A temp-project SQLite fixture should seed a candidate item, submitted session plan, `queue_prds` row, and current submitted/queued lifecycle evidence; simulate removal; and assert DB rows are terminal/non-current.

## Scope

### In scope

- Canonical queue-removal synchronization for linked backlog items.
- Canonical queue-removal synchronization for linked session plans.
- Removal cleanup for failed queue items.
- Removal cleanup for pending queue items.
- Removal cleanup for waiting queue items.
- Removal cleanup for skipped queue items.
- Stable behavior for the daemon removal API.
- Stable behavior for Console removal controls.
- Stable behavior for CLI/MCP removal tools.
- Stable behavior for Pi removal tools.
- Filtering removed queue records from board coverage.
- Filtering removed queue records from `search-items` coverage.
- Filtering removed queue records from `get-item` coverage.
- Filtering removed queue records from recommendations.
- Filtering removed queue records from planning-task eligibility.
- Preserving blockers from live pending/running queue items.
- Preserving blockers from active build sessions.
- Preserving blockers from open PR evidence.
- Preserving blockers from submitted handoffs with a live queue/build link.

### Out of scope

- Cancelling running builds.
- Changing queue dependency semantics.
- Deleting session-plan Markdown as a side effect of queue removal.
- Deleting backlog records as a side effect of queue removal.

## Acceptance Criteria

- Removing a failed queue item updates eforge-plan canonical queue state for any linked session plan or backlog item.
- Removing a pending queue item updates eforge-plan canonical queue state for any linked session plan or backlog item.
- Removing a waiting queue item updates eforge-plan canonical queue state for any linked session plan or backlog item.
- Removing a skipped queue item updates eforge-plan canonical queue state for any linked session plan or backlog item.
- A removed queue record no longer appears as active `queued-build` coverage in board projections.
- A removed queue record no longer appears as active `submitted-session-plan` coverage in board projections.
- A removed queue record no longer appears as active `queued-build` coverage in `search-items`.
- A removed queue record no longer appears as active `submitted-session-plan` coverage in `search-items`.
- A removed queue record no longer appears as active `queued-build` coverage in `get-item`.
- A removed queue record no longer appears as active `submitted-session-plan` coverage in `get-item`.
- A removed queue record no longer appears as active `queued-build` coverage in recommendations.
- A removed queue record no longer appears as active `submitted-session-plan` coverage in recommendations.
- A removed queue record no longer blocks planning-task eligibility.
- Current lifecycle evidence linked only to the removed queue PRD is marked non-current or excluded from active coverage.
- Queue-tied terminal lifecycle evidence created by cleanup uses status `removed`.
- Linked `queue_prds` rows for the removed PRD are updated or removed so they cannot project as active.
- Affected backlog projections are marked stale after successful queue removal.
- Affected recommendation projections are marked stale after successful queue removal.
- Candidate items with only abandoned session plans, applied planning tasks, and removed queue attempts return to Inbox.
- Candidate items with only abandoned session plans, applied planning tasks, and removed queue attempts report `planEligible: true`.
- Live pending queue items continue to suppress planning eligibility.
- Live running queue items continue to suppress planning eligibility.
- Active build sessions continue to suppress planning eligibility.
- Open PR evidence continues to suppress planning eligibility.
- Submitted handoffs with a live queue link continue to suppress planning eligibility.
- Submitted handoffs with a live build link continue to suppress planning eligibility.
- Running queue removal remains refused through the existing cancel-by-session guidance.
- Successful daemon `DELETE /api/queue/:prdId` removal triggers eforge-plan synchronization.
- Queue-removal synchronization does not run for not-found removal attempts.
- Queue-removal synchronization does not run for conflict removal attempts.
- Queue-removal synchronization does not run for running-refusal removal attempts.
- Console removal controls produce the same eforge-plan coverage result as the daemon removal route.
- `eforge queue remove` produces the same eforge-plan coverage result as the daemon removal route.
- MCP removal produces the same eforge-plan coverage result as the daemon removal route.
- Pi removal produces the same eforge-plan coverage result as the daemon removal route.
- Automated tests cover failed queue removal.
- Automated tests cover abandoned linked plans.
- Automated tests cover stale `queue_prds`.
- Automated tests cover terminal removed filtering.
- Automated tests cover `list-board-compact` projections.
- Automated tests cover `search-items` projections.
- Automated tests cover `get-item` projections.
- Automated tests cover recommendation actionability.
- `findCanonicalNonterminalCoverage` reports no live removed-queue coverage after removal plus abandoned plan when no other live blocker remains.
- SQL projection coverage reports `planEligible: true` after removal plus abandoned plan when no other live blocker remains.
- `list-board-compact` reports `planEligible: true` after removal plus abandoned plan when no other live blocker remains.
- `search-items` reports `planEligible: true` after removal plus abandoned plan when no other live blocker remains.
- `get-item` reports `planEligible: true` after removal plus abandoned plan when no other live blocker remains.
- Recommendation actionability reports `planEligible: true` after removal plus abandoned plan when no other live blocker remains.
- `planEligible` remains `false` while a live queue item remains.
- `planEligible` remains `false` while a live build remains.
- `planEligible` remains `false` while open PR evidence remains.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

Use the following reproduction and control scenarios for manual verification:

1. Start with a candidate eforge-plan backlog item linked to a session plan.
2. Submit or hand off the session plan so canonical SQL has a `queue_prds` row for the queue PRD and current lifecycle evidence such as `submitted-session-plan` or queued-build for the item.
3. Let the queue item become failed or stale, then remove it through an existing removal surface, such as daemon `DELETE /api/queue/:prdId`, Console controls, `eforge queue remove`, MCP, or Pi.
4. If testing the pure Inbox-return case, mark the linked session plan abandoned and ensure no running build, live queue item, open PR, or unresolved dependency remains.
5. Query eforge-plan via `list-board-compact`/board, `search-items`, `get-item`, and `get-recommendations`/planning-task start.
6. Confirm the removed queue coverage no longer blocks the item.
7. Confirm the item returns to Inbox and is plan eligible when no other live blocker remains.
8. Repeat with an actually pending/running queue item or open PR.
9. Confirm pending/running queue items and open PRs continue to suppress planning eligibility.