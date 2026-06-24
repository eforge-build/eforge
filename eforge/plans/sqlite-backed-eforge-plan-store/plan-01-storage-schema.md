---
id: plan-01-storage-schema
name: "Build the eforge-plan SQLite store foundation: DB path/opening, pragmas,
  migrations, schema constraints, core typed repositories, and FTS5 capability
  validation."
branch: sqlite-backed-eforge-plan-store/storage-schema
---

# Storage Schema

## Architecture Reference

This module implements the `storage-schema` module from the architecture, especially the **Store location and migration metadata**, **Canonical tables**, **FTS layer**, and **Store contract** sections.

Key constraints from architecture:
- Create the project-local SQLite store at `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite`.
- Use `node:sqlite` `DatabaseSync` and the required pragmas: WAL journal mode, `busy_timeout = 5000`, `synchronous = NORMAL`, and `foreign_keys = ON`.
- Track schema state with `PRAGMA user_version` and a `schema_migrations` table containing migration id, checksum, timestamp, and description.
- Validate FTS5 support at startup with an actionable error when FTS5 is unavailable.
- Keep database access behind typed store/repository modules; action handlers and later modules must not consume raw SQL rows.
- Make stable-ID upserts the primitive write behavior for canonical rows and joins.
- Preserve explicit backlog user status and source refs; do not silently discard unresolved legacy refs that later importer diagnostics need.
- Do not implement import orchestration, action handlers, board/search presentation, retention pruning, remote SQL, Postgres, sync, embeddings, or engine changes.
- Keep new implementation files under 600 lines; add durable semantic region markers in new TypeScript files that exceed 300 lines.

## Scope

### In Scope

- SQLite store path resolution for the eforge-plan extension storage directory.
- Store open/close lifecycle, readonly handling, schema version checks, pragmas, FTS5 capability validation, and transaction helper.
- Ordered SQL migration runner with immutable migration SQL, SHA-256 checksums, `PRAGMA user_version`, and migration idempotency.
- Initial v1 schema for canonical eforge-plan domains:
  - backlog items, item tags, item sections, and dependencies
  - epics, epic tags, and epic sections
  - recommendation runs, lanes, and lane items
  - planning tasks and task provenance joins
  - session plans and session-plan item/epic joins
  - queue PRDs, build runs, build sessions, and landing links
  - lifecycle events and durable lifecycle evidence
  - import runs and diagnostics
  - maintenance runs
  - search document metadata, FTS5 virtual table, and search dirty markers
- Core typed repository primitives for stable upserts, simple get/list reads, and row-to-domain mapping.
- Tests for empty DB initialization, migration idempotency, constraints, indexes, foreign keys, FTS objects, transactions, and repository stable upserts.
- Extension package TypeScript configuration updates so nested SQLite source files are type-checked.
- A short eforge-plan README storage-model note that names the SQLite database and its role.

### Out of Scope

- Best-effort legacy Markdown/JSON/session-plan/trace importer and dry-run reporting.
- Runtime mutation-path rewrites for capture/update/promote/handoff/lifecycle hooks.
- SQL-derived board lanes, lifecycle projections, recommendation actionability, duplicate planning policy, and associated plan/build link projections.
- Ranked search actions, snippets, pagination responses, FTS rebuild orchestration, and public contribution action schemas.
- Retention compaction, archive deletion, VACUUM action wiring, or maintenance policy enforcement beyond creating metadata tables.
- Workstation UI changes, Claude Code plugin changes, Pi integration changes, and engine/kernel changes.

## Implementation Approach

### Overview

Add a focused SQLite base layer under `eforge/extensions/eforge-plan/sqlite/`. The layer exports typed store and repository APIs from `sqlite/index.ts`; raw `DatabaseSync` access stays in internal helpers that are not re-exported. Later modules import these APIs and do not need to know the database file layout or SQL row shapes.

The first migration creates all canonical tables, constraints, indexes, the search document table, and the FTS5 virtual table. The migration runner records an immutable checksum for the SQL text. Reopening an existing database verifies migration checksums and leaves already-applied migrations unchanged.

Core repositories provide stable-ID upserts and small get/list helpers only. They do not implement importer diagnostics, board/actionability semantics, ranked search presentation, or retention policy. Repository functions return mapped domain rows with `undefined` for nullable optional fields and parsed JSON for JSON columns.

### Key Decisions

1. **Use a single v1 migration for the foundation.** The first migration creates the complete normalized schema needed by downstream modules. Future schema changes add new migration ids; migration SQL is immutable after merge so checksum drift is detectable.
2. **Use rebuildable FTS primitives, not triggers.** Create `search_documents` plus `search_documents_fts` and dirty-marker tables. Low-level repository functions can replace/delete individual documents, but the later FTS module owns ranked queries, snippets, rebuild/optimize helpers, and action outputs.
3. **Preserve unresolved source refs with optional resolved FK columns.** Tables that may receive legacy refs use `*_ref` text columns plus nullable resolved foreign-key columns where needed. Examples: `item_dependencies.dependency_ref` with `resolved_dependency_item_id`, recommendation lane item `item_ref` with nullable `item_id`, and session-plan joins with source refs. This lets the importer report stale/orphan refs without losing the original value.
4. **Store raw payloads with explicit retention metadata.** Raw lifecycle payloads, planning task request/result payloads, recommendation model JSON, verbose import report data, and diagnostics include prunable/summary columns, but this module never deletes those rows.
5. **Hide raw SQLite handles from public exports.** `store-internal.ts` exposes `getDatabase()` and `assertWritable()` only to repository modules. `sqlite/index.ts` exports store/repository functions and types, not `DatabaseSync`.
6. **Use explicit transaction depth tracking.** `store.transaction()` starts `BEGIN IMMEDIATE` for writable stores and `BEGIN` for readonly stores, reuses nested transactions, commits on return, and rolls back on thrown errors.
7. **Type-check nested source files.** Update `eforge/extensions/eforge-plan/tsconfig.json` from top-level-only `*.ts` inclusion to nested `**/*.ts` inclusion while retaining the current exclusions for tests, dist, workstation source, and packaged assets.

### Schema v1 Details

Create `schema_migrations` before running migrations, then apply migration `1_initial_schema` with these table groups.

#### Backlog and epics

- `backlog_items`
  - `id TEXT PRIMARY KEY`
  - `title TEXT NOT NULL`
  - `body TEXT NOT NULL DEFAULT ''`
  - `user_status TEXT NOT NULL CHECK (user_status IN ('candidate','planned','active','shipped','stale','superseded'))`
  - `priority`, `source`, `created_at`, `updated_at`, `last_checked_at`, `stale_after`
  - `epic_ref TEXT`, `epic_id TEXT REFERENCES epics(id) ON DELETE SET NULL`
  - `frontmatter_json TEXT NOT NULL DEFAULT '{}'`
  - `body_sha256`, `record_sha256`, `import_origin`, `import_path`
- `backlog_item_tags`
  - `(item_id, tag) PRIMARY KEY`
  - `item_id REFERENCES backlog_items(id) ON DELETE CASCADE`
- `backlog_item_sections`
  - `(item_id, section_name) PRIMARY KEY`
  - `content TEXT NOT NULL DEFAULT ''`
  - `content_sha256`
- `epics`, `epic_tags`, `epic_sections`
  - Mirror item metadata without membership duplication.
- `item_dependencies`
  - `(item_id, dependency_ref) PRIMARY KEY`
  - `dependency_kind TEXT NOT NULL DEFAULT 'depends-on'`
  - `dependency_status TEXT NOT NULL DEFAULT 'unknown' CHECK (dependency_status IN ('unknown','open','closed','external','missing'))`
  - `resolved_dependency_item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL`
  - `source_path`, `diagnostic_json`

Indexes:
- item status, updated timestamp, epic ref/id, tag, dependency ref, resolved dependency id
- epic status, updated timestamp, tag

#### Recommendations

- `recommendation_runs`
  - `run_id TEXT PRIMARY KEY`
  - `source_fingerprint`, `created_at`, `applied_at`, `last_refreshed_by`
  - `is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1))`
  - `raw_model_json`, `summary_json`, `freshness_json`, `import_origin`, `import_path`
- `recommendation_lanes`
  - `lane_id TEXT PRIMARY KEY`
  - `run_id TEXT NOT NULL REFERENCES recommendation_runs(run_id) ON DELETE CASCADE`
  - `lane_kind TEXT NOT NULL CHECK (lane_kind IN ('activeWork','readyCandidates','recommendedNextSequence','safeParallelizableGroup','blockedChain'))`
  - `lane_ref`, `title`, `sequence INTEGER NOT NULL DEFAULT 0`, `profile`, `rationale`
  - unique `(run_id, lane_kind, lane_ref)`
- `recommendation_lane_items`
  - `(lane_id, item_ref, role) PRIMARY KEY`
  - `lane_id REFERENCES recommendation_lanes(lane_id) ON DELETE CASCADE`
  - `item_ref TEXT NOT NULL`
  - `item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL`
  - `role TEXT NOT NULL CHECK (role IN ('member','blocked','blocker'))`
  - `sequence`, `rationale`, `confidence`

Indexes cover current runs, lane run/kind, lane item refs, and resolved item ids.

#### Planning tasks

- `planning_tasks`
  - `task_id TEXT PRIMARY KEY`
  - `purpose`, `status_snapshot`, `source_fingerprint`
  - `requested_sections_json`, `selection_summary_json`, `compact_result_summary_json`
  - `raw_request_json`, `raw_result_json`
  - `raw_payload_prunable INTEGER NOT NULL DEFAULT 1 CHECK (raw_payload_prunable IN (0,1))`
  - `created_at`, `updated_at`, `applied_at`, `parent_task_id REFERENCES planning_tasks(task_id) ON DELETE SET NULL`
- `planning_task_items`, `planning_task_epics`, `planning_task_recommendation_refs`
  - Preserve source refs and nullable resolved FKs for items/epics.
  - Include `role`, `sequence`, and source metadata columns.

Indexes cover purpose/source fingerprint/status and each join's resolved ids and refs.

#### Session plans

- `session_plans`
  - `session TEXT PRIMARY KEY`
  - `path`, `topic`, `status`, `planning_type`, `planning_depth`, `profile`, `agent_profile`
  - `eforge_session_id`, `submitted_at`, `created_at`, `updated_at`
  - `summary_text`, `artifact_body_hash`, `frontmatter_json`, `readiness_summary_json`
  - `import_origin`, `import_path`
  - Do not store the Markdown body as canonical content.
- `session_plan_items`
  - `(session, item_ref, role, provenance) PRIMARY KEY`
  - `session REFERENCES session_plans(session) ON DELETE CASCADE`
  - `item_ref TEXT NOT NULL`
  - `item_id TEXT REFERENCES backlog_items(id) ON DELETE SET NULL`
  - `role`, `provenance`, `source_task_id`, `source_recommendation_ref`, `promoted_at`, `sequence`
- `session_plan_epics`
  - Same pattern for epic refs and resolved epic ids.

Indexes cover session status, submitted/updated timestamps, item refs, resolved item ids, epic refs, and source recommendation refs.

#### Queue/build/session/landing correlation

- `queue_prds`
  - `prd_id TEXT PRIMARY KEY`
  - `session TEXT REFERENCES session_plans(session) ON DELETE SET NULL`
  - `source_id`, `source_path`, `external_ref`, `status`, timestamps, `status_summary`, `error_summary`, `import_fingerprint`
- `build_runs`
  - `run_id TEXT PRIMARY KEY`
  - `session TEXT REFERENCES session_plans(session) ON DELETE SET NULL`
  - `queue_prd_id TEXT REFERENCES queue_prds(prd_id) ON DELETE SET NULL`
  - `build_session_id`, `status`, started/finished timestamps, `plan_set`, `cwd`, `status_summary`, `error_summary`, `import_fingerprint`
- `build_sessions`
  - `build_session_id TEXT PRIMARY KEY`
  - `session TEXT REFERENCES session_plans(session) ON DELETE SET NULL`
  - `status`, started/finished timestamps, `status_summary`, `error_summary`, `import_fingerprint`
- `landing_links`
  - `landing_id TEXT PRIMARY KEY`
  - nullable links to session plan, item, queue PRD, build run, and build session
  - `status`, `pr_url`, `feature_branch`, `commit_sha`, `merge_ref`, `created_at`, `completed_at`, `summary_json`

Indexes cover session, status, queue/build ids, item id, PR URL, branch, and commit SHA.

#### Lifecycle evidence

- `lifecycle_events`
  - `event_key TEXT PRIMARY KEY`
  - `event_type`, `timestamp`, `session`, `run_id`, `build_session_id`, `queue_prd_id`, `landing_id`
  - `affected_item_refs_json TEXT NOT NULL DEFAULT '[]'`
  - `payload_json`, `payload_prunable INTEGER NOT NULL DEFAULT 1`, `source_fingerprint`
- `lifecycle_evidence`
  - `evidence_key TEXT PRIMARY KEY`
  - `item_id TEXT REFERENCES backlog_items(id) ON DELETE CASCADE`
  - `item_ref TEXT NOT NULL`
  - nullable links to session plan, planning task, queue PRD, build run, build session, landing link, and source event
  - `lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('none','planned','active','submitted','queued','build','pr-open','merged','shipped','failed','partial'))`
  - `reason_code`, `evidence_kind`, `status`, `is_current INTEGER NOT NULL DEFAULT 1`, `is_terminal INTEGER NOT NULL DEFAULT 0`
  - `occurred_at`, `superseded_at`, `summary`, `links_json`, `retained_summary_json`

Indexes cover current evidence by item, lifecycle state, session, queue/build/run/session ids, landing id, and source event key.

#### Import and maintenance metadata

- `import_runs`
  - `run_id TEXT PRIMARY KEY`, `dry_run`, `applied`, `replaced_existing`, timestamps, `counts_json`, `summary_json`, `verbose_report_json`, `verbose_report_prunable`
- `import_diagnostics`
  - `diagnostic_id TEXT PRIMARY KEY`, `run_id REFERENCES import_runs(run_id) ON DELETE CASCADE`
  - `severity`, `code`, `message`, `ref`, `path`, `details_json`
- `store_maintenance_runs`
  - `run_id TEXT PRIMARY KEY`, `categories_json`, `started_at`, `finished_at`, `pruned_counts_json`, `archived_counts_json`, `preserved_evidence_counts_json`, `status`, `error_summary`

#### Search metadata and FTS

- `search_documents`
  - `document_type TEXT NOT NULL CHECK (document_type IN ('backlog_item','epic','session_plan','recommendation'))`
  - `document_id TEXT NOT NULL`
  - `title`, `tags_text`, `summary_text`, `body_text`, `item_ids_text`, `epic_ids_text`, `recommendation_refs_text`
  - `source_sha256`, `updated_at`, `dirty INTEGER NOT NULL DEFAULT 0`
  - primary key `(document_type, document_id)`
- `search_documents_fts`
  - FTS5 virtual table with unindexed `document_type` and `document_id`, plus indexed text columns for title/tags/summary/body/item ids/epic ids/recommendation refs.
- `search_index_state`
  - single row keyed by `id = 1`, with `dirty`, `dirty_since`, `dirty_reason`, and `last_rebuilt_at`.
- `search_index_dirty_records`
  - `(document_type, document_id) PRIMARY KEY`, `reason`, `marked_at`.

The storage repository can insert, replace, delete, and mark dirty documents. The FTS/search module later owns ranked queries and snippets.

### Repository API Shape

Export these public APIs from `sqlite/index.ts`:

```ts
openEforgePlanStore(cwd: string, options?: StoreOpenOptions): EforgePlanStore;
resolveEforgePlanStorePath(cwd: string): string;
getEforgePlanSchemaVersion(store: EforgePlanStore): number;
assertFts5Available(store: EforgePlanStore): void;

upsertBacklogItem(store: EforgePlanStore, input: BacklogItemUpsert): BacklogItemRow;
getBacklogItem(store: EforgePlanStore, id: string): BacklogItemRow | undefined;
replaceBacklogItemTags(store: EforgePlanStore, itemId: string, tags: string[]): void;
replaceBacklogItemSections(store: EforgePlanStore, itemId: string, sections: SectionUpsert[]): void;
replaceItemDependencies(store: EforgePlanStore, itemId: string, dependencies: ItemDependencyUpsert[]): void;

upsertEpic(store: EforgePlanStore, input: EpicUpsert): EpicRow;
getEpic(store: EforgePlanStore, id: string): EpicRow | undefined;
replaceEpicTags(store: EforgePlanStore, epicId: string, tags: string[]): void;
replaceEpicSections(store: EforgePlanStore, epicId: string, sections: SectionUpsert[]): void;

upsertRecommendationRun(store: EforgePlanStore, input: RecommendationRunUpsert): RecommendationRunRow;
upsertRecommendationLane(store: EforgePlanStore, input: RecommendationLaneUpsert): RecommendationLaneRow;
replaceRecommendationLaneItems(store: EforgePlanStore, laneId: string, items: RecommendationLaneItemUpsert[]): void;

upsertPlanningTask(store: EforgePlanStore, input: PlanningTaskUpsert): PlanningTaskRow;
replacePlanningTaskRefs(store: EforgePlanStore, input: PlanningTaskRefsInput): void;

upsertSessionPlan(store: EforgePlanStore, input: SessionPlanUpsert): SessionPlanRow;
linkSessionPlanItems(store: EforgePlanStore, input: SessionPlanItemLinkInput): void;
linkSessionPlanEpics(store: EforgePlanStore, input: SessionPlanEpicLinkInput): void;

recordLifecycleEvent(store: EforgePlanStore, input: LifecycleEventInput): LifecycleEventRow;
recordLifecycleEvidence(store: EforgePlanStore, input: LifecycleEvidenceInput): LifecycleEvidenceRow;

upsertQueuePrd(store: EforgePlanStore, input: QueuePrdUpsert): QueuePrdRow;
upsertBuildRun(store: EforgePlanStore, input: BuildRunUpsert): BuildRunRow;
upsertBuildSession(store: EforgePlanStore, input: BuildSessionUpsert): BuildSessionRow;
upsertLandingLink(store: EforgePlanStore, input: LandingLinkUpsert): LandingLinkRow;
recordQueueBuildCorrelation(store: EforgePlanStore, input: QueueBuildCorrelationInput): void;

recordImportRun(store: EforgePlanStore, input: ImportRunInput): ImportRunRow;
recordImportDiagnostic(store: EforgePlanStore, input: ImportDiagnosticInput): ImportDiagnosticRow;
recordMaintenanceRun(store: EforgePlanStore, input: MaintenanceRunInput): MaintenanceRunRow;

replaceSearchDocument(store: EforgePlanStore, input: SearchDocumentUpsert): SearchDocumentRow;
markSearchIndexDirty(store: EforgePlanStore, input: SearchIndexDirtyInput): void;
clearSearchIndexDirty(store: EforgePlanStore, input?: { rebuiltAt?: string }): void;
getSearchIndexState(store: EforgePlanStore): SearchIndexStateRow;
```

Implementation notes:
- Upsert functions use `INSERT ... ON CONFLICT DO UPDATE` keyed by stable domain identifiers.
- Replace functions for child collections delete only the child rows for the parent key, then insert the supplied collection inside the caller's transaction.
- JSON columns are serialized with deterministic `JSON.stringify` of JSON-safe inputs and parsed in named row mappers.
- Row mappers are named, exported where tests need them, and convert SQLite `0`/`1` to booleans.
- Repository modules throw an `EforgePlanStoreError` with a stable `code` for readonly writes, schema mismatch, missing FTS5, invalid JSON column contents, and migration checksum mismatch.

## Files

### Create

- `eforge/extensions/eforge-plan/sqlite/constants.ts` — extension name, database filename, latest schema version, and schema/migration constants.
- `eforge/extensions/eforge-plan/sqlite/errors.ts` — `EforgePlanStoreError` and stable store error codes.
- `eforge/extensions/eforge-plan/sqlite/types.ts` — public store interfaces, open options, common JSON/page/import/search/maintenance contracts, row types, and repository input types.
- `eforge/extensions/eforge-plan/sqlite/store-internal.ts` — non-exported raw `DatabaseSync` access, writable assertions, row helper types, and transaction-depth state.
- `eforge/extensions/eforge-plan/sqlite/db.ts` — path resolution, store opening, pragma setup, readonly behavior, transaction helper, close handling, schema version reads, and startup validation calls.
- `eforge/extensions/eforge-plan/sqlite/fts.ts` — FTS5 capability validation and FTS object existence checks.
- `eforge/extensions/eforge-plan/sqlite/schema.ts` — immutable v1 SQL schema text and index/constraint declarations. Add durable semantic region markers if the file exceeds 300 lines.
- `eforge/extensions/eforge-plan/sqlite/migrations.ts` — migration registry, checksum generation, migration application, checksum verification, and `PRAGMA user_version` management.
- `eforge/extensions/eforge-plan/sqlite/repositories/sql.ts` — shared repository helpers for `one`, `all`, JSON columns, booleans, timestamps, and `ON CONFLICT` binding utilities.
- `eforge/extensions/eforge-plan/sqlite/repositories/items.ts` — backlog item, tag, section, and dependency repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/epics.ts` — epic, tag, and section repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/recommendations.ts` — recommendation run/lane/lane-item repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/planning-tasks.ts` — planning task and task provenance join repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/session-plans.ts` — session plan and session-plan item/epic join repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/lifecycle.ts` — lifecycle event and lifecycle evidence repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts` — queue PRD, build run, build session, landing link, and correlation repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/import-runs.ts` — import run and diagnostic metadata repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/maintenance.ts` — maintenance run metadata repository plus row mapper.
- `eforge/extensions/eforge-plan/sqlite/repositories/search-documents.ts` — search document, dirty record, and search index state repositories plus row mappers.
- `eforge/extensions/eforge-plan/sqlite/index.ts` — public exports for store types, open/path helpers, and repository functions.
- `eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts` — empty DB, migration, pragma, FTS, transaction, readonly, index, and constraint tests.
- `eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts` — repository stable upsert, child replace, FK, join, JSON mapper, and search dirty-state tests.

### Modify

- `eforge/extensions/eforge-plan/tsconfig.json` — include nested runtime files with `"**/*.ts"` so `sqlite/**/*.ts` is covered by `pnpm --filter @eforge-build/eforge-plan type-check`.
- `eforge/extensions/eforge-plan/README.md` — add a concise SQLite-private-store note to the existing storage model `[region: storage-schema, under existing "## Storage model" heading before the legacy Markdown file list]`.

## Testing Strategy

### Unit Tests

- Path resolution returns `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite` for a temp project.
- `openEforgePlanStore` creates parent directories, applies pragmas, exposes schema version `1`, and closes without leaving an unusable handle.
- Opening with `create: false` fails when the database file is missing.
- Readonly opening rejects repository writes with `EforgePlanStoreError` code `readonly-store`.
- `transaction()` commits returned writes and rolls back writes when the callback throws.
- Migration checksum verification detects a tampered `schema_migrations.checksum` row.
- FTS5 validation succeeds in the test runtime and `search_documents_fts` exists in `sqlite_master`.
- Row mapper tests cover nullable columns, JSON columns, boolean columns, and invalid JSON error paths.

### Integration Tests

- An empty-project DB contains every v1 canonical table, the FTS virtual table, and the expected indexes from `sqlite_master` / pragma introspection.
- `PRAGMA foreign_keys` returns `1`; inserting a child row with a missing required parent through raw SQLite rejects with a foreign-key error.
- CHECK constraints reject invalid backlog status, recommendation lane kind, lifecycle state, and boolean flag values.
- Reopening and migrating the same DB twice leaves `PRAGMA user_version = 1` and a single migration row for migration id `1`.
- Backlog item upserts preserve `user_status`, tags, sections, dependencies, source hashes, frontmatter JSON, and optional unresolved dependency refs.
- Epic upserts preserve metadata and do not duplicate item membership lists.
- Recommendation run/lane/lane-item upserts are idempotent by run id, lane id, and lane item key.
- Planning task joins preserve item refs, epic refs, recommendation refs, and parent task links.
- Session-plan item joins support multiple items per plan and multiple plans per item without duplicate rows.
- Queue/build/session/landing repositories preserve stable ids and nullable correlation links.
- Lifecycle event/evidence repositories preserve raw event payloads and durable current evidence rows.
- Search document replacement updates base document rows, FTS rows, and dirty-state metadata.

## Verification

- [ ] `resolveEforgePlanStorePath(cwd)` returns a path ending in `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite` for a temp project.
- [ ] Opening an empty temp project with `create: true` and `migrate: true` creates the SQLite file and parent directory.
- [ ] `PRAGMA user_version` returns `1` after initial migration.
- [ ] `schema_migrations` contains one row with id `1`, a non-empty checksum, and description `initial eforge-plan SQLite schema`.
- [ ] Reopening the same DB twice leaves the migration row count unchanged.
- [ ] `PRAGMA foreign_keys` returns `1` on an open store.
- [ ] Raw insertion of `backlog_items.user_status = 'blocked'` rejects with a CHECK constraint error.
- [ ] Raw insertion of a `backlog_item_tags` row for a missing item rejects with a foreign-key error.
- [ ] `sqlite_master` contains `search_documents_fts` with virtual table SQL containing `fts5`.
- [ ] `transaction()` leaves no inserted test row after the callback throws.
- [ ] Repeated `upsertBacklogItem` calls for the same id leave one `backlog_items` row.
- [ ] Replacing tags for one item leaves no duplicate `(item_id, tag)` rows.
- [ ] Linking two session plans to the same item creates two `session_plan_items` rows for that item.
- [ ] `replaceSearchDocument` followed by a direct FTS query can match the inserted document title.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/sqlite-storage-schema.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-repositories.test.ts` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "api"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
