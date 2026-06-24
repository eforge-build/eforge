# Projections Lifecycle

## Architecture Reference

This module implements the `projections-lifecycle` module from the architecture, especially the **Lifecycle and actionability semantics**, **Recommendation actionability and duplicate planning policy**, **Projection/search contract**, **Action/UI contract**, and **Shared data model** sections.

Key constraints from architecture:
- Board lanes, item effective lifecycle, recommendation actionability, active build linkage, and associated plan/build links are derived from canonical SQLite rows and durable lifecycle evidence, not Markdown/JSON/trace-sidecar reconstruction.
- `backlog_items.user_status` remains explicit user-authored metadata; effective lifecycle is projected from session-plan, planning-task, queue/build/session/landing, and lifecycle evidence joins.
- Session-plan Markdown remains the build artifact body; SQLite owns queryable metadata, provenance, item-plan joins, downstream state, and lifecycle evidence.
- Many-to-many `session_plan_items` and `session_plan_epics` joins preserve selected-item, selected-promote, recommendation-lane-plan, task-output, epic-selection, and imported-trace provenance.
- Recommendation actionability and direct duplicate checks use one nonterminal coverage policy with compact reason codes and associated links.
- Public action outputs are bounded with default limits, maximum caps, selected fields, counts, and pagination metadata. Broad raw reads remain debug-rich compatibility reads and do not feed workstation hot paths.
- Projection/read modules consume repository APIs from `storage-schema` and write-side coverage helpers from `canonical-write-paths`; action handlers must not execute raw SQL.
- This module must not implement FTS ranking/snippets, importer orchestration, canonical mutation side effects, retention pruning, remote SQL, Postgres, synchronization, embeddings, or engine/kernel changes.

## Scope

### In Scope

- SQL-backed item detail and epic detail projections for `get-item` and `get-epic`.
- SQL-backed compact board projection for `list-board-compact`, including lane counts, total counts, pagination, dependency summaries, effective lifecycle, user status, reason codes, and compact evidence links.
- SQL-backed debug/compatibility board data for `list-board` and `render-board-markdown` without legacy private Markdown/trace reads.
- SQL-derived item effective lifecycle from current durable evidence, session-plan joins, planning task joins, queue/build/session/landing rows, failed terminal evidence, partial multi-item evidence, and `user_status` fallback.
- SQL-derived board lane assignment for inbox, ready, blocked, in-progress, done, and archive.
- SQL-backed associated plan/build link projection from item IDs to session plans, planning tasks, queue PRDs, build runs, build sessions, PR/landing links, and lifecycle evidence.
- SQL-backed active build linkage for item detail, board rows, session-plan lifecycle, recommendation actionability, and duplicate coverage explanations.
- Read-oriented `findNonterminalCoverage` wrapper that reuses the canonical write-side coverage helper created by `canonical-write-paths`.
- SQL-backed recommendation current model/freshness/actionability projection for `get-recommendations`.
- Recommendation actionability dispositions for planned, submitted, queued, running/building, active build session, PR-open, merged, shipped, failed, partial, and active planning task evidence.
- SQL-backed lifecycle joins in `list-planning-artifacts` and `show-session-plan` for flat session plans.
- SQL-backed session-plan lifecycle projection for partial multi-item plans and item-to-session-to-build linkage.
- Focused tests for lifecycle priority, board lanes, recommendation actionability, associated links, duplicate coverage, session-plan lifecycle, and bounded action outputs.

### Out of Scope

- SQLite schema creation, migrations, base repository upserts, and FTS object creation from `storage-schema`.
- Runtime capture/update/promote/handoff/lifecycle mutation rewrites from `canonical-write-paths`.
- Legacy Markdown/JSON/session-plan/trace importer and import diagnostics from `importer-reporting`.
- FTS5 ranked search, snippets, search document rebuild/optimize helpers, and `search-items` handler replacement from `fts-search-bounded-actions`.
- Retention compaction, archive deletion, VACUUM, FTS maintenance actions, and post-compaction evidence preservation from `retention-maintenance`.
- Workstation React view changes and long-form user documentation from `workstation-docs-integration`.
- Plan-set canonicalization. Plan sets remain build artifacts listed through the existing input adapter; flat session-plan lifecycle data comes from SQLite.
- Plugin-specific or Pi-specific command changes. Existing integrations discover extension actions generically.

## Implementation Approach

### Overview

Add a focused projection layer under `eforge/extensions/eforge-plan/projections/` plus read-only projection repository helpers under `eforge/extensions/eforge-plan/sqlite/repositories/projections/`. Repository helpers own SQL and named row-to-domain mappers. Projection modules combine those typed rows into compact action outputs and lifecycle/actionability view models. Existing action handlers become thin adapters that validate input with their current schemas, call projection functions, and return JSON-safe output.

The projection layer opens an existing store for reads. If the SQLite store file is absent, list-style read actions return empty canonical projections with zero counts and detail actions return the existing not-found style error. Projection actions do not scan legacy Markdown/JSON as fallback and do not create or migrate a store as a hidden side effect. Store initialization/import and canonical writes remain the paths that create or migrate the database.

Effective lifecycle is computed from durable SQL evidence with the architecture priority order: shipped/landed, merged, PR-open, active build, queued/submitted build, editable nonterminal session plan or active planning task, failed terminal evidence with no later nonfailed superseding evidence, explicit user status fallback, then candidate/none fallback. The projection keeps existing public `lifecycleState` values for compatibility (`queue` represents submitted/queued evidence; `build` represents running/building evidence) and adds reason codes/links that distinguish submitted from queued and build-run from build-session evidence.

### Key Decisions

1. **Keep SQL inside repository modules.** Create `sqlite/repositories/projections/*.ts` for SELECT-heavy joins and row mappers. `projections/*.ts` modules consume typed rows and never import `DatabaseSync` or store internals.
2. **Reuse the canonical duplicate coverage helper.** `findNonterminalCoverage` wraps `canonical/coverage.ts` so recommendation suppression, direct planning duplicate checks, and board explanations share one nonterminal policy instead of drifting.
3. **Preserve current public shapes and add optional evidence fields.** Existing fields such as `status`, `lifecycleState`, `reasons`, `dependsOn`, and `unresolvedDependsOn` remain. `status` stays the explicit backlog user status. New fields such as `userStatus`, `effectiveLifecycle`, `reasonCodes`, and `associatedLinks` are additive and schema-declared.
4. **Represent recommendation disposition without breaking existing `state`.** Keep `state: 'actionable' | 'non-actionable'` for compatibility and add `disposition: 'actionable' | 'suppressed' | 'de-actioned' | 'relocated'` plus expanded reason codes. Terminal merged/shipped/failed/partial items are not fresh unlinked planning candidates.
5. **Use stable ordering for deterministic pages.** Board items order by lane priority, open-before-closed, priority, updated timestamp, and item id. Associated links order by lifecycle priority, timestamp, kind, and stable id. Recommendation lanes preserve stored lane sequence.
6. **Keep flat plan bodies artifact-backed.** `show-session-plan` reads SQLite metadata and lifecycle first, then loads the session-plan Markdown file through `@eforge-build/input` using the canonical session/path. SQLite body hashes and summaries are metadata; the Markdown artifact body remains the returned plan body.
7. **Leave `search-items` to the FTS module.** This module changes non-search get/list/board/session/recommendation projections only. The later FTS module owns `search-items`, ranked results, snippets, and all-domain search actions.
8. **Handle missing or unresolved refs explicitly.** Dependency, item, epic, recommendation, and lifecycle refs preserved by the schema appear as compact missing/unresolved references with reason codes rather than being dropped from projections.

### Projection APIs

Expose these functions from `eforge/extensions/eforge-plan/projections/index.ts`:

```ts
getItemDetailProjection(cwd: string, input: GetItemProjectionInput): Promise<GetItemProjectionOutput>;
getEpicDetailProjection(cwd: string, input: GetEpicProjectionInput): Promise<GetEpicProjectionOutput>;
listBoardCompactProjection(cwd: string, input: ListBoardCompactProjectionInput): Promise<ListBoardCompactProjectionOutput>;
buildBoardDebugProjection(cwd: string, input: BoardActionInput): Promise<BoardDebugProjection>;
getRecommendationProjection(cwd: string): Promise<GetRecommendationsProjection>;
buildRecommendationActionability(cwd: string, runId?: string): Promise<RecommendationActionabilityProjection>;
listPlanningArtifactsProjection(cwd: string, input: ListPlanningArtifactsInput): Promise<ListPlanningArtifactsProjection>;
getSessionPlanLifecycleProjection(cwd: string, session: string): Promise<SessionPlanLifecycleProjection>;
getAssociatedPlanBuildLinksForItems(cwd: string, input: { itemIds: string[] }): Promise<AssociatedPlanBuildLink[]>;
findNonterminalCoverage(cwd: string, input: { itemIds: string[]; includeTerminalReasons?: boolean }): Promise<CoverageResult>;
```

Internal repository helpers accept an `EforgePlanStore` instead of `cwd`; cwd wrappers open/close the store in `finally` blocks.

### Lifecycle Reason Codes

Use one reason-code vocabulary in board, actionability, associated links, and coverage outputs:

- `planned-session-plan`
- `submitted-session-plan`
- `active-planning-task`
- `queued-build`
- `running-build`
- `active-build-session`
- `open-pr`
- `merged-result`
- `shipped-result`
- `failed-result`
- `partial-plan`
- `unresolved-dependency`
- `explicit-active-status`
- `explicit-planned-status`
- `explicit-shipped-status`
- `explicit-archive-status`
- `candidate-no-evidence`

Map legacy actionability codes to the new vocabulary at the boundary where existing tests or UI still expect old names: `queued-trace` maps to `queued-build`, `building-trace` maps to `running-build`, `active-build-session-trace` maps to `active-build-session`, and `open-pr-trace` maps to `open-pr`.

## Files

### Create

- `eforge/extensions/eforge-plan/projections/types.ts` — projection input/output types, effective lifecycle/reason/disposition unions, compact item/epic/session/recommendation view models, `AssociatedPlanBuildLink`, and `CoverageResult` re-export aliases.
- `eforge/extensions/eforge-plan/projections/store.ts` — `withProjectionStore(cwd, fn)`, `projectionStoreExists(cwd)`, missing-store handling, and readonly open/close helpers.
- `eforge/extensions/eforge-plan/projections/pagination.ts` — shared default/max limit normalization, offset pagination metadata, field-selection helpers, and deterministic sort helpers.
- `eforge/extensions/eforge-plan/projections/lifecycle.ts` — effective lifecycle priority, public lifecycle-state mapping, reason-code selection, partial multi-item aggregation, and trace-summary-compatible lifecycle rows derived from SQL evidence.
- `eforge/extensions/eforge-plan/projections/links.ts` — associated plan/build link aggregation and compact link mappers used by items, board, session plans, recommendations, and coverage output.
- `eforge/extensions/eforge-plan/projections/items.ts` — item detail, epic detail, dependency/dependent summaries, compact item/epic mappers, section/body opt-ins, and board-card conversion.
- `eforge/extensions/eforge-plan/projections/board.ts` — SQL-derived board lane assignment, lane counts, counts by open/closed status, debug board projection, and Markdown rendering support.
- `eforge/extensions/eforge-plan/projections/recommendations.ts` — current recommendation model reconstruction from SQL lanes, derived freshness/status projection, actionability dispositions, group actionability, and active refresh metadata from stored planning task rows.
- `eforge/extensions/eforge-plan/projections/session-plans.ts` — flat session-plan list/detail lifecycle joins, item rows, source refs, failure evidence, and partial lifecycle aggregation.
- `eforge/extensions/eforge-plan/projections/index.ts` — public exports for projection wrappers and type contracts.
- `eforge/extensions/eforge-plan/sqlite/repositories/projections/items.ts` — read-only SQL for backlog item/epic rows, tags, sections, dependencies, dependent refs, epic item counts, and named row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/projections/lifecycle.ts` — read-only SQL for lifecycle evidence, current evidence by item/session, queue/build/landing correlation rows, associated links, and named row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/projections/recommendations.ts` — read-only SQL for current recommendation run, lanes, lane items, freshness JSON, status summaries, and named row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/projections/session-plans.ts` — read-only SQL for session-plan list/detail rows, item/epic joins, source refs, readiness summaries, and named row mappers.
- `eforge/extensions/eforge-plan/__tests__/sqlite-projection-fixtures.ts` — test-only helpers that seed canonical SQLite rows through public repositories/canonical helpers and create matching session-plan Markdown artifacts where body reads are required.
- `eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts` — lifecycle priority, partial aggregation, associated links, active build linkage, terminal superseding, and nonterminal coverage tests.
- `eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts` — board lane/actionability/status projection tests for draft/candidate, ready/planned, submitted, queued, running, PR-open, merged, failed, partial, shipped, blocked, and archive cases.
- `eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts` — recommendation lane/item/group actionability tests for planned, submitted, queued, running, PR-open, merged, shipped, failed, partial, and active planning task evidence.
- `eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts` — `list-planning-artifacts` and `show-session-plan` SQL lifecycle tests, including many-to-many item joins, recommendation provenance, source refs, body artifact loading, and pagination.
- `eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts` — extension action dispatch tests for `get-item`, `get-epic`, `list-board-compact`, `list-board`, `render-board-markdown`, and `get-recommendations` bounded SQL outputs.

### Modify

- `eforge/extensions/eforge-plan/sqlite/types.ts` — add projection row contracts, effective lifecycle/reason code types, associated link types, recommendation disposition types, and pagination contracts needed by projection repositories.
- `eforge/extensions/eforge-plan/sqlite/index.ts` — export the new projection repository helpers and projection row/domain types.
- `eforge/extensions/eforge-plan/canonical/coverage.ts` — export the canonical nonterminal coverage helper and its reason/link mappers for read-side reuse; keep write-side behavior unchanged.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — replace `get-item`, `get-epic`, and `list-board-compact` loading/mapping with SQL projection calls; add additive compact item fields to the non-search schemas; leave `search-items` schema/handler for `fts-search-bounded-actions` `[region: projections-lifecycle, GetItem/GetEpic/ListBoardCompact SQL projection loading and compact item/epic mapping]`.
- `eforge/extensions/eforge-plan/board-actions.ts` — route `buildBoard`, `projectBoardOutput`, and `renderBoard` through `buildBoardDebugProjection` so debug-rich board reads use SQLite-derived lanes/evidence and no trace-sidecar scan.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — use SQL flat session-plan list/detail lifecycle projections in `listPlanningArtifacts`, `showSessionPlan`, `buildLifecycleBySession`, and `buildLifecycleForPlan`; continue using the input adapter only for plan-set listings and flat plan artifact body loading `[region: projections-lifecycle, SQL lifecycle joins in list/show/buildLifecycle helpers]`.
- `eforge/extensions/eforge-plan/session-plan-view-model.ts` — accept SQL-projected flat plan list entries and lifecycle maps while preserving the existing plan-set view model and JSON-safe detail projection.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — use SQL-backed current recommendation, freshness/status, active refresh, and actionability projections in `get-recommendations` `[region: projections-lifecycle, SQL-backed current recommendation/freshness/actionability projection]`.
- `eforge/extensions/eforge-plan/recommendation-actionability.ts` — keep exported `buildRecommendationActionability` and `assertRecommendationSelectionActionable` names, but implement them through `projections/recommendations.ts` and `findNonterminalCoverage` instead of Markdown/session-plan/trace/planning-task scans.
- `eforge/extensions/eforge-plan/recommendation-actionability-schemas.ts` — add new reason codes and `disposition` fields while retaining the existing `state` fields and old reason-code literals for compatibility.
- `eforge/extensions/eforge-plan/schema.ts` — extend compact lifecycle/actionability schemas only where existing output schemas need additive fields; keep existing lifecycle literals and field names available.
- `eforge/extensions/eforge-plan/backlog-domain.ts` — add shared projection type aliases only if needed by existing non-SQL modules; do not move SQL row types here.
- `eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts` — update non-search get/list/board action setup to seed SQLite through canonical/repository helpers; leave search-specific assertions for the FTS module or seed temporary legacy data only inside search-owned test cases.
- `eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts` — replace trace sidecar and file-backed session-plan setup with canonical SQLite evidence/session-plan/planning-task rows.
- `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` — seed flat session-plan SQLite rows and joins alongside Markdown artifacts for body/readiness assertions; update lifecycle assertions to use SQL evidence.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update schema key assertions if additive fields change action output schema property lists.

For temporary coordination markers in shared files, use the compiled plan slug:

```ts
// --- eforge:region plan-04-projections-lifecycle ---
// SQL-backed projection imports, schemas, and handlers owned by this module.
// --- eforge:endregion plan-04-projections-lifecycle ---
```

Do not use `projections-lifecycle` as a cleanup-targeted source marker; it is only the module annotation ID for this plan.

## Testing Strategy

### Unit Tests

- Effective lifecycle priority:
  - shipped evidence outranks merged, PR-open, build, queue/submitted, planned, failed, and user status fallback.
  - merged evidence outranks PR-open, build, queue/submitted, planned, failed, and user status fallback.
  - failed terminal evidence is selected only when no later nonfailed downstream evidence exists.
  - mixed multi-item session-plan rows aggregate to `partial` and retain per-item lifecycle rows.
- Board lane derivation:
  - candidate items with no evidence produce inbox rows.
  - editable planned session-plan evidence produces ready rows when dependencies are resolved.
  - submitted, queued, running/building, build-session, and PR-open evidence produce in-progress rows.
  - unresolved dependencies, failed terminal evidence, and intervention-required partial evidence produce blocked rows.
  - shipped/landed/merged evidence produces done rows, with reason codes that identify the evidence kind.
  - stale and superseded user statuses produce archive rows when no higher-priority current evidence supersedes them.
- Associated link mapping:
  - item links include session plan, planning task, queue PRD, build run, build session, landing/PR, status, timestamp, path/URL, and affected item IDs.
  - missing refs are represented with source refs and missing flags instead of being removed.
- Recommendation actionability:
  - each supported reason code maps to the expected `state`, `disposition`, `lifecycleState`, message, and associated link.
  - safe-parallel groups report actionable, non-actionable, and partially-actionable group states with deterministic item ordering.
- Pagination and field selection:
  - default limits are applied when input omits `limit`.
  - limits above `100` are capped at `100`.
  - offsets return deterministic non-overlapping pages.
  - body/sections/link rows are omitted unless their include flags request them.

### Integration Tests

- Seed a temp SQLite store with epics, items, dependencies, session plans, planning tasks, queue/build/session/landing rows, recommendation lanes, and lifecycle evidence through public repository/canonical helpers.
- Dispatch `get-item` and assert the output contains `status` and `userStatus` from `backlog_items.user_status`, `lifecycleState` from SQL evidence, dependency/dependent summaries, sections by opt-in, body by opt-in, and associated links by opt-in.
- Dispatch `get-epic` and assert item counts, open item counts, paginated item summaries, optional body/sections, and dependency-array controls.
- Dispatch `list-board-compact` for each lane and assert total counts, lane counts, pagination metadata, open/closed counts, reason codes, and absence of item bodies.
- Dispatch `list-board` and `render-board-markdown` and assert their lanes match `list-board-compact` for the same SQLite seed.
- Dispatch `get-recommendations` and assert current recommendation reconstruction, freshness/status projection, actionability dispositions, and active refresh task summary from SQL rows.
- Dispatch `list-planning-artifacts` and assert flat session plans come from SQLite, plan sets still come from the input adapter, page totals are bounded, and lifecycle rows are included for flat plans.
- Dispatch `show-session-plan` and assert source refs/lifecycle come from SQLite while the plan body comes from the Markdown artifact path.
- Call `findNonterminalCoverage` for item sets with editable plans, active planning tasks, queued PRDs, running build runs, running build sessions, PR-open links, terminal shipped links, and failed links; assert nonterminal rows are included and terminal rows appear only with `includeTerminalReasons: true`.
- Seed an item planned from a recommendation lane and handed off to a running build; assert item detail links item → session plan → build session/run, `list-board-compact` does not return it in inbox, and recommendation actionability returns non-actionable with active-build evidence.

## Verification

- [ ] `get-item` reads `backlog_items.user_status` into both `status` and `userStatus` for a seeded item.
- [ ] `get-item` returns `lifecycleState: 'build'` and an associated build-run link for an item with current running build evidence.
- [ ] `get-item` omits `body`, `sections`, `linkRows`, and `failureEvidence` when their include flags are false.
- [ ] `get-epic` returns `totalItems`, `itemCount`, and `openItemCount` from SQLite rows for an epic with mixed open and shipped items.
- [ ] `get-epic` with `limit: 1, offset: 1` returns exactly one item from the second page and reports the original total item count.
- [ ] `list-board-compact` returns an inbox item only when the item has no dependency, plan, task, queue, build, PR, landing, lifecycle, failed, partial, or shipped evidence.
- [ ] `list-board-compact` maps editable session-plan evidence to the ready lane with reason code `planned-session-plan`.
- [ ] `list-board-compact` maps submitted session-plan evidence to the in-progress lane with reason code `submitted-session-plan`.
- [ ] `list-board-compact` maps queued PRD evidence to the in-progress lane with reason code `queued-build`.
- [ ] `list-board-compact` maps running build-run evidence to the in-progress lane with reason code `running-build`.
- [ ] `list-board-compact` maps PR-open evidence to the in-progress lane with reason code `open-pr`.
- [ ] `list-board-compact` maps failed terminal evidence with no later nonfailed evidence to the blocked lane with reason code `failed-result`.
- [ ] `list-board-compact` maps shipped evidence to the done lane with reason code `shipped-result`.
- [ ] `list-board-compact` caps `limit: 500` to `limit: 100` and reports `pagination.limit: 100`.
- [ ] `list-board` and `render-board-markdown` do not call `listBacklogItems`, `listBacklogEpics`, `listTraceSidecars`, or `summarizeProjectTraces` on their runtime read path.
- [ ] `get-recommendations` reconstructs the current recommendation model from `recommendation_runs`, `recommendation_lanes`, and `recommendation_lane_items`.
- [ ] `get-recommendations` returns `disposition: 'suppressed'` for a recommendation item covered by editable planned evidence.
- [ ] `get-recommendations` returns `disposition: 'de-actioned'` for recommendation items with merged, shipped, failed, or partial evidence.
- [ ] A safe-parallel group with one active item and one candidate item returns `state: 'partially-actionable'`, one suppressed/de-actioned item ID, and one actionable item ID.
- [ ] `findNonterminalCoverage` returns a nonterminal entry for an item covered by a running build session.
- [ ] `findNonterminalCoverage` omits shipped-only evidence when `includeTerminalReasons` is false.
- [ ] `findNonterminalCoverage` includes shipped-only evidence when `includeTerminalReasons` is true.
- [ ] `list-planning-artifacts` returns flat session-plan lifecycle rows from SQLite and plan-set entries from the input adapter in one paginated artifact list.
- [ ] `show-session-plan` returns SQLite source refs and lifecycle rows while returning the Markdown artifact body from `.eforge/session-plans/<session>.md`.
- [ ] An item planned from a recommendation lane and handed off to a running build has associated links for the recommendation ref, session plan, build run, and build session.
- [ ] The same item does not appear in the inbox lane for `list-board-compact`.
- [ ] No runtime projection path in `backlog-query-actions.ts`, `board-actions.ts`, `recommendation-actionability.ts`, `recommendation-actions.ts`, or `session-plan-actions.ts` scans `.eforge/storage/extensions/eforge-plan/backlog`, recommendation JSON sidecars, trace sidecars, or planning-task JSON sidecars.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-projection-actions.test.ts` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "api"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
