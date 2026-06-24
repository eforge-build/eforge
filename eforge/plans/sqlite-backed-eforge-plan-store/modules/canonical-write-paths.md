# Canonical Write Paths

## Architecture Reference

This module implements the `canonical-write-paths` module from the architecture, especially the **Core architectural principles**, **Lifecycle and actionability semantics**, **Recommendation actionability and duplicate planning policy**, **Store contract**, and **Action/UI contract** sections.

Key constraints from architecture:
- Runtime eforge-plan mutations write canonical SQLite rows through the `storage-schema` repository APIs; action handlers do not execute raw SQL.
- Session-plan Markdown remains the build artifact body under `.eforge/session-plans/`; SQLite owns queryable metadata, provenance, item-plan joins, lifecycle evidence, and queue/build/session links.
- Backlog item rows preserve explicit user-authored status in `backlog_items.user_status`; effective lifecycle evidence is stored separately.
- Multi-item and recommendation-derived plans use many-to-many `session_plan_items` / `session_plan_epics` rows with explicit provenance.
- Direct planning/promote/create attempts that overlap nonterminal plan/task/queue/build/PR-open evidence are rejected before new side effects.
- Canonical writes use stable-ID upserts and transaction helpers so retries are idempotent.
- Runtime writes mark affected search documents dirty through the storage/search metadata contract, but ranked search/rebuild behavior belongs to `fts-search-bounded-actions`.
- Lifecycle event handling records durable summarized evidence rows that explain current board/actionability states after retention compaction.
- This module does not implement importer orchestration, board/search presentation, retention pruning, remote SQL, Postgres, sync, embeddings, or engine/kernel changes.

## Scope

### In Scope

- Canonical SQLite write helpers for backlog item capture/update/replacement and epic upsert/replacement.
- Canonical SQLite write helpers for current recommendation model writes and freshness/status mutations used by existing recommendation actions and planner apply flows.
- Canonical SQLite write helpers for planning task workflow records, parent links, selection/provenance joins, applied/dismissed state, and compact result/request summaries.
- Canonical SQLite write helpers for flat session-plan artifact synchronization after create, section update, dimension selection, metadata update, ready/delete, promotion, creation-draft apply, and handoff.
- Canonical SQLite links from session plans to selected items, epics, recommendation refs, and planning task sources.
- Canonical SQLite lifecycle event correlation and queue/build/session/landing upserts from extension event hooks.
- Durable lifecycle evidence rows for planned, submitted, queued, build/running, PR-open, merged, shipped, failed, and partial/current-link explainability.
- A central SQL-backed duplicate coverage helper used by promote, draft-unit promotion through `promoteBacklogSelection`, planning task start/retry/redraft/apply, and session-plan creation-draft apply before side effects.
- Search dirty markers for affected backlog item, epic, session-plan, and recommendation documents.
- Focused tests for canonical writes, duplicate planning rejection, many-to-many item-plan joins, planning task records, handoff correlation, lifecycle event correlation, and search dirty marking.

### Out of Scope

- Legacy Markdown/JSON/session-plan/trace importer, dry-run reports, import diagnostics, and destructive replacement.
- SQL-derived board lanes, recommendation actionability presentation, associated link projections for read actions, and public search actions.
- FTS ranking, snippets, pagination, rebuild, and optimize behavior beyond dirty markers.
- Retention, compaction, archive, VACUUM, or FTS maintenance actions.
- Workstation UI updates and long-form user documentation; those belong to `workstation-docs-integration`.
- Plan-set canonicalization beyond leaving existing plan-set actions unchanged.
- Keeping backlog Markdown or trace sidecars as long-term dual-write stores.
- Engine/kernel changes and daemon API changes.

## Implementation Approach

### Overview

Add a small canonical writer facade under `eforge/extensions/eforge-plan/canonical/`. The facade opens the eforge-plan SQLite store with `create: true` and `migrate: true`, wraps multi-row mutations in `store.transaction()`, and maps existing domain inputs into repository upserts created by `storage-schema`.

Mutation callers move from direct Markdown/JSON sidecar writes to canonical writer functions. Flat session-plan actions still mutate `.eforge/session-plans/*.md` through `@eforge-build/input`, then immediately synchronize metadata, joins, and lifecycle evidence into SQLite. Promotion remains artifact-first for the build source body, but duplicate coverage checks run before the Markdown file is created. Backlog and trace sidecar helper modules remain available for importer/debug compatibility, but normal mutation paths stop depending on them for authoritative state.

Because this module has only `storage-schema` as a declared dependency, it will implement the write-side duplicate coverage query in a storage-only helper. The later `projections-lifecycle` module can expose public/read-oriented `findNonterminalCoverage` by wrapping the same helper instead of creating a parallel policy.

### Key Decisions

1. **Use a canonical facade instead of scattering repository calls.** Action handlers call named functions such as `captureCanonicalBacklogItem`, `promoteCanonicalSelection`, `syncSessionPlanArtifact`, and `recordCanonicalLifecycleEvent`. This keeps raw row details out of actions and gives later projection/search modules stable integration points.
2. **Do duplicate checks before filesystem or daemon side effects.** Promotion, planning task start, and creation-draft apply call the SQL coverage helper before writing a session plan, starting a daemon task, or marking a task applied. Rejection payloads include compact associated links and reason codes.
3. **Keep session-plan Markdown as artifact body only.** Session plan content is written/read by the input adapter. SQLite stores path, topic, status, planning type/depth/profile, agent profile, summary/readiness metadata, artifact body hash, source refs, item/epic joins, and lifecycle evidence; it does not store the Markdown body as canonical content.
4. **Record lifecycle evidence separately from user status.** Backlog mutations write `backlog_items.user_status`; promotions and events write `lifecycle_evidence` rows. Confirmed merged/auto-merged lifecycle events also update `backlog_items.user_status = 'shipped'` to preserve existing user-facing status behavior.
5. **Use stable keys for idempotency.** Session-plan joins key on `(session, item_ref, role, provenance)`, lifecycle evidence keys derive from item/session/source event/stage identifiers, queue/build/landing rows use daemon identifiers or deterministic source fingerprints, and recommendation run/lane keys derive from current source/model fingerprints plus lane refs.
6. **Mark search dirty, do not rebuild.** Canonical writes call `markSearchIndexDirty` for affected records. Rebuild/refresh and ranked search remain in `fts-search-bounded-actions`.
7. **Keep legacy readers importer-only.** Existing Markdown/JSON helper modules are not deleted in this module, but mutation call sites move to canonical helpers. If future importer code needs legacy reads, it can keep using those helpers without becoming a runtime fallback.

## Files

### Create

- `eforge/extensions/eforge-plan/canonical/store.ts` — `withCanonicalStore(cwd, fn)` and `withCanonicalTransaction(cwd, fn)` helpers that open/migrate the SQLite store, close it in `finally`, and expose stable timestamp/hash utilities.
- `eforge/extensions/eforge-plan/canonical/backlog-records.ts` — maps backlog item/epic writes to repository upserts, preserves `user_status`, replaces tags/sections/dependencies, resolves canonical item/epic reads needed by write flows, and marks item/epic search documents dirty.
- `eforge/extensions/eforge-plan/canonical/recommendation-records.ts` — maps `BacklogRecommendationModel` writes into `recommendation_runs`, `recommendation_lanes`, `recommendation_lane_items`, current-run flags, status/freshness metadata summaries, and recommendation search dirty markers.
- `eforge/extensions/eforge-plan/canonical/planning-task-records.ts` — replaces the JSON workflow-index write path with SQLite planning task upserts, provenance joins, applied/dismissed markers, list ordering, and compatibility helpers matching the current workflow-store API.
- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts` — synchronizes flat session-plan artifacts into `session_plans`, `session_plan_items`, `session_plan_epics`, readiness summaries, source metadata, planned/submitted evidence, and search dirty markers.
- `eforge/extensions/eforge-plan/canonical/lifecycle-records.ts` — correlates extension events against SQLite session/queue/build/landing keys, upserts queue/build/session/landing rows, records raw lifecycle events plus summarized lifecycle evidence, and updates shipped item status for merge evidence.
- `eforge/extensions/eforge-plan/canonical/coverage.ts` — storage-only duplicate coverage helper returning `CoverageResult`-style entries and associated links for nonterminal session plans, planning tasks, queue/build rows, PR-open landing rows, and current lifecycle evidence.
- `eforge/extensions/eforge-plan/canonical/search-dirty.ts` — small helpers that translate domain mutations into `markSearchIndexDirty` calls without rebuilding FTS documents.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts` — tests canonical item/epic writes, metadata preservation, child replacement, recommendation stale/dirty markers, and no backlog Markdown dependency.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts` — tests promotion, create/update/ready/delete/handoff sync, source metadata, item-plan many-to-many joins, and duplicate planning rejection before artifact creation.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts` — tests lifecycle event correlation, queue/build/session/landing upserts, shipped status updates, failed evidence, partial multi-item evidence, and idempotent event replay.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts` — tests planning task record/list/apply/dismiss behavior, parent links, selection joins, duplicate suppression before daemon task start, and exact active-task reuse cases for recommendation/background refresh flows.

### Modify

- `eforge/extensions/eforge-plan/sqlite/types.ts` — add exported internal types for coverage entries, associated plan/build links, session-plan source provenance, and planning task visibility/status snapshots if the storage-schema module did not already include them.
- `eforge/extensions/eforge-plan/sqlite/repositories/items.ts` — add list/get helpers needed by write flows, dependency resolution helpers, and optional item status update helpers while keeping existing upsert APIs stable.
- `eforge/extensions/eforge-plan/sqlite/repositories/epics.ts` — add list/get helpers needed for epic selections and recommendation validation.
- `eforge/extensions/eforge-plan/sqlite/repositories/recommendations.ts` — add current-run replacement helpers, lane deletion/replacement for a run, and current recommendation status/freshness helpers without changing v1 table names.
- `eforge/extensions/eforge-plan/sqlite/repositories/planning-tasks.ts` — add list/get, mark-applied, mark-dismissed, parent lookup, and selection/provenance join helpers.
- `eforge/extensions/eforge-plan/sqlite/repositories/session-plans.ts` — add artifact sync helpers, replace-all item/epic links for a session, and lookup helpers by source item/session.
- `eforge/extensions/eforge-plan/sqlite/repositories/lifecycle.ts` — add lifecycle correlation lookups, current-evidence supersede helpers, and idempotent evidence upsert helpers.
- `eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts` — add lookup helpers by source path, queue PRD id, build run id, build session id, branch, commit, and PR URL.
- `eforge/extensions/eforge-plan/sqlite/repositories/search-documents.ts` — add batch dirty-marker helper used by canonical writes.
- `eforge/extensions/eforge-plan/sqlite/index.ts` — export the added repository helpers and types needed by canonical writers.
- `eforge/extensions/eforge-plan/index.ts` — switch `captureItem`, `upsertEpic`, `updateItem`, `promoteItem`, `promoteSelection`, and lifecycle event hooks to canonical writers `[region: canonical-write-paths, existing mutation handlers and event hook block]`.
- `eforge/extensions/eforge-plan/promote.ts` — replace backlog frontmatter and trace sidecar writes with canonical promotion/session-plan link writes; run duplicate coverage checks before `writeFile(..., flag: 'wx')`.
- `eforge/extensions/eforge-plan/promotion-selection.ts` — resolve selected items, epics, and recommendation refs from SQLite-backed canonical reads for mutation flows.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — synchronize SQLite after create, set-section, select-dimensions, set-ready, delete, metadata update, and handoff operations; record submitted/handoff evidence and queue correlation on enqueue success/failure `[region: canonical-write-paths, SQL side effects in session-plan mutation handlers]`.
- `eforge/extensions/eforge-plan/session-plan-metadata.ts` — preserve Markdown metadata updates and call canonical sync helpers when source/profile/agent metadata changes.
- `eforge/extensions/eforge-plan/lifecycle.ts` — keep pure event decision/correlation helpers where useful, but route runtime `applyLifecycleEvent` through SQLite lifecycle correlation/upsert/evidence helpers instead of trace sidecar mutation.
- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts` — preserve exported workflow-store function names while implementing reads/writes through SQLite planning task repositories; keep legacy JSON path resolution for importer/report diagnostics only.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — call SQL duplicate coverage before starting selected planning tasks, record planning task rows after daemon start, and keep the cancel-on-record-failure safeguard.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — sync applied handoff drafts, session-plan creation drafts, session-plan section patches, source metadata, trace replacements, and applied task markers through canonical writers.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — replace backlog/recommendation mutation calls with canonical item/epic/recommendation writers while preserving existing validation and apply output shapes.
- `eforge/extensions/eforge-plan/recommendations-store.ts` — keep parsing/summary/path helpers, but route `writeRecommendations` and normal `readRecommendations` through SQLite current recommendation helpers; expose legacy file read/write helpers under clearly named importer-only functions if needed.
- `eforge/extensions/eforge-plan/recommendation-status.ts` — route recommendation freshness/stale/applied mutations through SQLite status metadata and canonical lifecycle/backlog fingerprints; keep pure validation/fingerprint projection helpers available for projections and importer diagnostics.

## Testing Strategy

### Unit Tests

- Backlog write mappers preserve `id`, `title`, `body`, `user_status`, priority, source timestamps, tags, dependencies, epic refs, frontmatter JSON, body hash, and record hash.
- Epic write mappers preserve frontmatter and sections without adding item membership data.
- Recommendation model mappers produce deterministic run/lane/lane-item stable ids for repeated identical writes.
- Planning task mappers preserve parent task id, purpose, source fingerprint, requested output sections, selection item/epic/recommendation refs, and applied/dismissed timestamps.
- Session-plan sync maps `eforge_plan.source_item_ids`, `source_epic_ids`, `source_recommendation_ref`, profile, agent profile, readiness summary, and artifact body hash without storing the Markdown body as canonical content.
- Duplicate coverage returns nonterminal entries for editable/submitted session plans, active planning tasks, queued PRDs, running build runs/sessions, and PR-open landing evidence.
- Duplicate coverage omits terminal shipped/merged/completed/abandoned rows when `includeTerminalReasons` is false.
- Lifecycle event mappers convert enqueue, queue, session, landing PR, landing merge, auto-merge, failed, skipped, and cancelled events into stable row/evidence inputs.

### Integration Tests

- Dispatching `capture-item`, `update-item`, and `upsert-epic` creates or updates SQLite rows and marks affected search records dirty.
- Dispatching `promote-selection` writes exactly one session-plan Markdown artifact, creates one `session_plans` row, creates one join per selected item, creates one join per selected epic, records planned lifecycle evidence, and leaves no duplicate joins after a repeated idempotent sync.
- Dispatching a second direct promotion for an item covered by nonterminal evidence returns an action error and does not create the requested second session-plan Markdown file.
- Dispatching `create-session-plan`, `set-session-plan-section`, `select-session-plan-dimensions`, `set-session-plan-ready`, `delete-session-plan`, and `update-session-plan-metadata` updates the Markdown artifact and leaves the corresponding SQLite session row with the latest status/profile/readiness fields.
- Dispatching `handoff-session-plan` with a fake build queue records submitted/handoff evidence and queue correlation rows that link back to the session plan and selected items.
- Event hook execution for enqueue/queue/session/landing events links item → session plan → queue/build/session/landing rows and updates current lifecycle evidence without reading trace sidecars.
- Event hook replay for the same event key leaves row counts unchanged except timestamp-preserving updates defined by the repository upsert.
- Starting a planning agent task for an item with active nonterminal coverage rejects before calling `ctx.agentTasks.start`.
- Starting a recommendation refresh or backlog curation background task with the same purpose/source fingerprint reuses the exact active task when existing behavior requires reuse, without creating duplicate nonterminal item plans.
- Applying a session-plan creation draft writes the Markdown artifact, source metadata, item/epic joins, planned evidence, and task applied timestamp in SQLite.
- Applying backlog curation changes writes canonical item/epic rows and current recommendation rows without writing backlog Markdown as authoritative state.

## Verification

- [ ] `capture-item` inserts one `backlog_items` row with `user_status = 'candidate'` and inserts no duplicate row for the same explicit id.
- [ ] `update-item` changes `backlog_items.user_status`, tags, dependencies, and epic ref while preserving the previous body text.
- [ ] `upsert-epic` inserts or updates one `epics` row and replaces only that epic's tags/sections.
- [ ] `promote-selection` creates `.eforge/session-plans/<session>.md` and one `session_plans` row with matching `session` and `path`.
- [ ] A promoted two-item selection creates two `session_plan_items` rows with the same `session` and distinct `item_id` values.
- [ ] A recommendation-lane promotion stores `source_recommendation_ref` on the session plan and item joins.
- [ ] A second direct promotion for an item covered by an editable session plan returns an error containing `planned-session-plan` and leaves the requested second Markdown path absent.
- [ ] A selected planning task start for an item covered by a running build returns an error containing `active-build` and calls `ctx.agentTasks.start` zero times.
- [ ] `handoff-session-plan` enqueue success records a submitted/handoff evidence row linked to the session plan.
- [ ] `applyLifecycleEvent` for `session:start` records a build-session row and current build lifecycle evidence linked to the source item.
- [ ] `applyLifecycleEvent` for PR-open landing records PR-open lifecycle evidence and leaves `backlog_items.user_status` unchanged.
- [ ] `applyLifecycleEvent` for merge or auto-merge records shipped lifecycle evidence and sets `backlog_items.user_status = 'shipped'`.
- [ ] Replaying the same lifecycle event twice leaves one `lifecycle_events` row for that event key.
- [ ] Repeated `writeRecommendations` calls for the same model leave one current recommendation run for the same stable run id.
- [ ] `markPlanningTaskWorkflowEntryApplied` stores `applied_at` in SQLite and list helpers exclude consumed session-plan creation entries using the existing predicate.
- [ ] Search dirty records exist for each mutated item, epic, session plan, and recommendation run touched by canonical writes.
- [ ] No runtime mutation path in `index.ts`, `promote.ts`, `session-plan-actions.ts`, `lifecycle.ts`, `planner-orchestration.ts`, or `backlog-curation-apply.ts` calls `writeBacklogItem`, `writeBacklogEpic`, `updateBacklogItemFrontmatter`, `upsertPromotedSessionPlan`, `upsertQueuePrd`, `upsertBuildRun`, `upsertBuildSession`, `upsertLandingResult`, or `updateLastEventMetadata`.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-canonical-lifecycle-writes.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-canonical-planning-tasks.test.ts` exits 0.

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
