# SQLite-backed eforge-plan store architecture

## Vision and goals

Move eforge-plan private planning state from file-scattered reconstruction to one project-local SQLite store at `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite`.

The store becomes authoritative after schema initialization and/or explicit import. Session-plan Markdown remains the build artifact body under `.eforge/session-plans/`; SQLite owns queryable metadata, provenance, item-plan joins, lifecycle evidence, recommendation state, queue/build/session links, search documents, and maintenance metadata.

This is an eforge-plan extension/workstation storage change. The eforge engine/kernel remains unchanged except for existing public APIs the extension already consumes.

## Current implementation delta

Codebase exploration found these current file-backed sources:

- `eforge/extensions/eforge-plan/markdown-store.ts` stores backlog items/epics as Markdown under `.eforge/storage/extensions/eforge-plan/backlog/...` with `.backlog/...` legacy read-through.
- `recommendations-store.ts` and `recommendation-status.ts` store `recommendations/current.json` and `recommendations/status.json` sidecars.
- `trace-store.ts` stores one trace sidecar JSON per item and `lifecycle.ts` mutates those sidecars from events.
- `planning-task-workflow-store.ts` stores planning task workflow rows in `planning-tasks/index.json`.
- `promote.ts` writes session-plan Markdown and item trace sidecars.
- `board-actions.ts`, `backlog-query-actions.ts`, `recommendation-actionability.ts`, and `session-plan-actions.ts` build projections by loading Markdown/JSON files and in-memory joins.
- `packages/monitor/src/db.ts` already demonstrates the project’s `node:sqlite` pattern, but eforge-plan has no SQLite store or FTS5 layer today.

Therefore the source is not implemented: there is no eforge-plan SQLite schema, importer, SQL-backed projection layer, FTS5 search, or retention/maintenance path.

## Core architectural principles

1. **SQLite authoritative, Markdown artifact-only.** Backlog, epics, dependencies, recommendations, planning tasks, session-plan provenance, item-plan joins, lifecycle evidence, queue/build/session links, and current projections are read from SQLite after initialization/import. Session-plan Markdown remains the build source body.
2. **Typed store boundary.** All database access goes through focused store/repository modules. Actions and workstation code consume repository/projection functions, not raw SQL.
3. **Stable-ID upserts.** Import and mutation paths use stable domain keys (`item_id`, `epic_id`, `session`, `task_id`, recommendation run/ref, queue/build IDs) so repeated imports and event replays are idempotent.
4. **No silent canonical truncation.** Canonical rows for backlog items, epics, dependencies, session-plan metadata, item-plan joins, current recommendation/actionability state, and current lifecycle state are never auto-truncated. Only explicitly eligible high-volume history is compacted through observable maintenance actions.
5. **Durable explainability.** Current board/search/actionability projections must retain summarized evidence after pruning raw history.
6. **Bounded public projections.** Agent/workstation-facing reads have defaults, maximum limits, filters, selected fields, counts, snippets where search is involved, and pagination metadata. Broad raw reads are marked debug-rich or removed from hot paths.
7. **Local single-developer scope.** Use project-local SQLite via Node’s `node:sqlite`; do not add remote SQL, Postgres, sync, multi-user semantics, embeddings, or vector search.
8. **Integration parity.** User-facing eforge-plan capabilities remain reachable through generic extension contribution discovery in Claude Code/Pi. If implementation edits `eforge-plugin/`, bump `.claude-plugin/plugin.json`; do not bump `packages/pi-eforge/package.json`.
9. **Acyclic implementation modules.** Store/schema types form the base layer; importer, canonical writes, projections, search, retention, and workstation/docs integrate through named repository/action contracts rather than importing one another’s handlers.

## Module catalogue and dependency graph

The module names below are the architecture-level responsibilities referenced by the shared file registry. Planners may compile them to concrete plan slugs, but they should preserve these boundaries.

| Module | Primary responsibility | Produces | Consumes | Must not own |
| --- | --- | --- | --- | --- |
| `storage-schema` | SQLite path resolution, opening/closing, pragmas, migrations, table/index/FTS object creation, transaction helper, repository type definitions. | `EforgePlanStore`, migrations, internal row/domain types, base upsert/query primitives. | Node FS/path APIs and `node:sqlite`. | Legacy file import orchestration, user-facing action handlers, board/search presentation. |
| `importer-reporting` | One-time best-effort legacy import, dry-run/apply reports, destructive replacement gate, import diagnostics, import action/help text. | `ImportReport`, `ImportDiagnostic` rows, stable canonical upserts, imported lifecycle evidence, import-run summaries. | Legacy readers, `storage-schema` repositories, search refresh/rebuild contract. | Normal runtime fallback to Markdown/JSON, ongoing canonical mutation handlers. |
| `canonical-write-paths` | Runtime mutations after the store is canonical: capture/update item, upsert epic, promote/create/select/ready/delete/handoff session plans, queue/build/lifecycle event correlation. | Canonical rows, item-plan joins, queue/build/session/landing links, durable lifecycle evidence, search refresh requests. | `storage-schema` repositories, `findNonterminalCoverage`, FTS refresh contract. | Board/search rendering, importer diagnostics, retention policy. |
| `projections-lifecycle` | SQL-derived item/epic details, board lanes, planning artifact details, recommendation actionability, active build links, duplicate/nonterminal coverage. | Compact projection outputs and reason-coded lifecycle/actionability results. | Canonical rows and evidence from `storage-schema`. | Canonical mutation side effects except read-only duplicate checks. |
| `fts-search-bounded-actions` | FTS document projection, FTS rebuild/optimize helpers, bounded search actions, snippets, rank/count/page metadata, search response types. | `SearchPage`, snippets/counts, `refreshSearchDocuments`, search maintenance helpers. | Canonical rows from `storage-schema`; refresh requests from importer/canonical writes/retention. | Lifecycle/actionability policy beyond applying filters supplied by callers. |
| `retention-maintenance` | Explicit compaction/archive/VACUUM/FTS maintenance actions and status reporting. | `MaintenanceReport`, `store_maintenance_runs`, preserved evidence summaries after pruning. | `storage-schema` repositories, FTS rebuild/optimize helpers. | Deleting canonical planning rows or hiding maintenance side effects. |
| `workstation-docs-integration` | Workstation/UI adapters, view-model types, docs/help text for storage/import/search/lifecycle/retention behavior. | Updated user-facing docs/help and UI types that consume bounded action outputs. | Action contracts from projection/search/import/maintenance modules. | Direct filesystem scans of `.eforge/storage/extensions/eforge-plan/` or direct SQL. |

### Cross-module dependency graph

- `storage-schema` is the base layer and imports no other architecture module.
- `importer-reporting` depends on `storage-schema` and may call `fts-search-bounded-actions` only through `refreshSearchDocuments`/`rebuildSearchIndex` after an apply import.
- `canonical-write-paths` depends on `storage-schema`, may call the `projections-lifecycle` duplicate coverage query `findNonterminalCoverage`, and may call the FTS refresh contract after successful writes.
- `projections-lifecycle` depends only on `storage-schema` repositories/types.
- `fts-search-bounded-actions` depends only on `storage-schema` repositories/types for document projection and on SQLite FTS primitives.
- `retention-maintenance` depends on `storage-schema` and FTS maintenance helpers.
- `workstation-docs-integration` depends on public action contracts only.
- No store/repository module imports action handlers, workstation components, or docs. Projection/search modules do not import canonical mutation handlers. This keeps the graph acyclic.

## Shared data model

### Store location and migration metadata

- Database path: `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite`.
- Use `node:sqlite` `DatabaseSync`, mirroring monitor DB pragmas where applicable:
  - `PRAGMA journal_mode = WAL`
  - `PRAGMA busy_timeout = 5000`
  - `PRAGMA synchronous = NORMAL`
  - `PRAGMA foreign_keys = ON`
- Maintain schema version with `PRAGMA user_version` plus a `schema_migrations` table containing migration id, checksum, applied timestamp, and description.
- Startup validates FTS5 by creating/dropping a temp FTS table or querying known virtual table support; fail with an actionable error if unavailable.

### Canonical tables

The first migration should create these normalized domains, indexes, constraints, and FTS objects. Names may be adjusted by module planners, but the model must preserve the listed relationships.

- `backlog_items`
  - `id` primary key, `title`, `body`, `user_status`, `priority`, `source`, `created_at`, `updated_at`, `last_checked_at`, `stale_after`, `frontmatter_json`, `body_sha256`, `record_sha256`, `import_origin`, `import_path`.
  - `user_status` preserves the explicit user-authored backlog status.
- `backlog_item_tags` and `backlog_item_sections`
  - Tags and extracted sections such as Claim, Evidence, Acceptance Criteria for filters/search/snippets.
- `epics`, `epic_tags`, `epic_sections`
  - Same metadata pattern as items, without item membership duplication.
- `item_dependencies`
  - `(item_id, dependency_ref)` primary key, dependency kind/status, optional `resolved_dependency_item_id` foreign key, and diagnostic/source fields.
  - `item_id` must be a foreign key to `backlog_items.id`. `dependency_ref` preserves unresolved or external dependency IDs so invalid legacy data remains diagnosable instead of being silently dropped; `resolved_dependency_item_id` is populated only when it can satisfy a foreign key.
- `recommendation_runs`
  - Stable run id, `source_fingerprint`, `created_at`, `applied_at`, `last_refreshed_by`, `is_current`, `raw_model_json`, `summary_json`, freshness fields.
- `recommendation_lanes`
  - Run id, lane kind (`activeWork`, `readyCandidates`, `recommendedNextSequence`, `safeParallelizableGroup`, `blockedChain`), ref, title, sequence, profile, rationale.
  - Lane Plan records are lane-provenance records.
- `recommendation_lane_items`
  - Lane id, item id, role (`member`, `blocked`, `blocker`), sequence, rationale/confidence.
- `planning_tasks`
  - Task id, purpose, status snapshot, source fingerprint, requested sections, selection summary, created/updated/applied timestamps, parent task id, compact result summary, optional raw request/result payload marked eligible for explicit pruning.
- `planning_task_items`, `planning_task_epics`, `planning_task_recommendation_refs`
  - Explicit selection/provenance joins.
- `session_plans`
  - Session primary key, path, topic, status, planning type/depth/profile, agent profile, eforge session id, submitted timestamp, created/updated timestamps, summary text, artifact body hash, frontmatter json, readiness summary.
  - Do not treat the DB copy as canonical body content; the Markdown file remains the build artifact body.
- `session_plan_items` and `session_plan_epics`
  - Many-to-many joins with role/provenance (`selected-plan`, `selected-promote`, `recommendation-lane-plan`, `task-output`, `epic-selection`, `imported-trace`), source task id, source recommendation ref, promoted timestamp.
- `queue_prds`, `build_runs`, `build_sessions`, `landing_links`
  - Stable queue/build/session/landing identifiers linked to session plans and item joins.
  - Minimum stored correlation fields include source id, source path or external ref, session plan session, status, created/submitted/started/finished timestamps where available, queue/build/session identifiers, PR URL or merge/landing ref where available, compact status/error summary, and import/source fingerprint.
- `lifecycle_events`
  - Raw correlated lifecycle event history; raw payloads are eligible for explicit retention/archival.
- `lifecycle_evidence`
  - Durable summarized current/history evidence rows linked to affected items/session plans. This table powers board lanes, recommendation suppression, active build linkage, PR-open/merged/shipped/failed/partial states, and explainability after compaction.
- `import_runs` and `import_diagnostics`
  - Dry-run/apply reports, orphan/missing/duplicate/invalid diagnostics, and source fingerprints. Verbose reports are eligible for explicit pruning after summary preservation.
- `store_maintenance_runs`
  - Compaction/VACUUM/FTS rebuild/optimize runs with counts and timestamps.

### FTS layer

Create FTS5 virtual tables or rebuild helpers for these document types:

- `backlog_item` documents: item id, title, tags, claim, evidence, acceptance criteria, selected body sections.
- `epic` documents: epic id, title, tags, summary/body sections.
- `session_plan` documents: session id, topic, summary text, source item/epic ids, recommendation refs.
- `recommendation` documents: recommendation lane/ref/title/rationale/item ids/assumptions.

Search APIs return ranked results (`bm25` or equivalent), snippets using SQLite `snippet()`, filters, counts by type, and pagination. Embeddings/vector tables are reserved for a later plan set and must not be part of this implementation.

FTS freshness is an explicit cross-module contract: importer and canonical write paths either update affected FTS documents in the same transaction as the canonical write or mark a durable `search_index_dirty` status that `rebuildSearchIndex()` clears before search is considered healthy. Search actions should report an unhealthy/dirty index in debug/status metadata rather than silently returning stale canonical data.

## Lifecycle and actionability semantics

### Effective lifecycle/status

SQL projections compute effective lifecycle from durable joins and evidence, not from `backlog_items.user_status` alone. Preserve `user_status` in outputs.

Priority for a single item:

1. shipped / landed / auto-merged evidence
2. merged evidence
3. PR-open evidence
4. active build session/run evidence
5. queued/submitted build evidence
6. editable nonterminal session plan or active planning task evidence
7. failed terminal evidence when no later nonfailed downstream evidence supersedes it
8. explicit user status fallback (`active`, `planned`, `shipped`, etc.)
9. none/candidate fallback

For multi-item session plans, aggregate mixed item lifecycle states as `partial` and keep per-item evidence rows.

### Board lanes

Board lanes are SQL-derived:

- `inbox`: true candidates with no item-plan/task/queue/build/PR/landing/lifecycle evidence and no unresolved dependency evidence. Failed, partial, planned, submitted, queued, running, PR-open, merged, and shipped items must never be returned as unlinked inbox candidates.
- `ready`: planned or editable nonterminal plan, no unresolved dependencies, not active/queued/running/PR-open/merged/shipped/failed/partial.
- `blocked`: unresolved dependencies, blocking evidence, failed terminal evidence with no later nonfailed superseding evidence, or partial aggregate evidence that requires intervention.
- `in-progress`: active user status or nonterminal submitted/queued/running/build/PR-open evidence. Partial aggregate evidence remains here only when at least one affected item still has nonterminal downstream work.
- `done`: shipped/landed evidence or explicit shipped status.
- `archive`: stale/superseded explicit status.

Board item projections include `effectiveLifecycle`, `userStatus`, reason codes, and compact evidence links so failed and partial cases can be explained and de-actioned even when mapped into an existing lane vocabulary.

An item planned from a recommendation lane and handed off to a running build must join item -> session plan -> build session/run and must not appear as an unlinked inbox candidate.

### Recommendation actionability and duplicate planning policy

Use one SQL helper, e.g. `findNonterminalCoverage(itemIds)`, for recommendation suppression, direct planning duplicate detection, promotion duplicate checks, and board explanations.

Policy:

- Direct planning/promote/create-plan attempts for any item set with overlapping nonterminal plan/task/queue/build/PR-open evidence are rejected before new side effects.
- The rejection includes compact associated links and reason codes, so callers can reuse the existing session plan/task/build manually.
- Purpose-specific background refresh flows that already have reuse semantics (`analyze-all-backlog`, `refresh-recommendations`) may reuse exact active tasks by purpose/source fingerprint, but they must not create duplicate nonterminal item plans.

Recommendation actionability projections classify each lane/item as actionable, suppressed, de-actioned, or relocated with compact reasons. Reason codes should cover planned, submitted, queued, running/building, active build session, PR-open, merged, shipped, failed, partial, and active planning task evidence. Failed and partial recommendation members are never offered as fresh unlinked planning candidates; they are de-actioned or relocated with evidence links according to the board/actionability projection.

## Integration contracts between modules

### Shared internal types and API ownership

`storage-schema` owns internal row/domain types in the SQLite store directory. Action-specific wire schemas stay in the existing focused action/schema modules, but they should be mapped from these internal contracts through named mapper functions.

Minimum shared contracts:

```ts
interface EforgePlanStore {
  path: string;
  readonly: boolean;
  transaction<T>(fn: (store: EforgePlanStore) => T): T;
  close(): void;
}

interface PageInput {
  limit?: number;
  cursor?: string;
  offset?: number;
  filters?: Record<string, unknown>;
  fields?: string[];
}

interface PageInfo {
  limit: number;
  nextCursor?: string;
  offset?: number;
  total?: number;
}

interface ImportReport {
  dryRun: boolean;
  applied: boolean;
  replacedExisting: boolean;
  counts: Record<string, number>;
  diagnostics: ImportDiagnostic[];
}

interface ImportDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: 'orphan-ref' | 'missing-file' | 'duplicate-id' | 'invalid-trace-row' | 'stale-recommendation-ref' | 'unreadable-artifact' | 'unsupported-legacy-payload';
  message: string;
  ref?: string;
  path?: string;
}

interface CoverageResult {
  itemIds: string[];
  hasNonterminalCoverage: boolean;
  entries: CoverageEntry[];
  associatedLinks: AssociatedPlanBuildLink[];
}

interface SearchPage {
  results: SearchResult[];
  countsByType: Record<string, number>;
  page: PageInfo;
  indexDirty?: boolean;
}

interface MaintenanceReport {
  runId: string;
  categories: string[];
  prunedCounts: Record<string, number>;
  archivedCounts: Record<string, number>;
  preservedEvidenceCounts: Record<string, number>;
}
```

`CoverageEntry`, `AssociatedPlanBuildLink`, `SearchResult`, and projection-specific view models are defined in the relevant repository/action type modules and must include reason codes plus compact item/session/build/recommendation refs rather than raw payloads.

### Store contract

Create a focused SQLite store layer under `eforge/extensions/eforge-plan/sqlite/` (or an equivalent focused directory):

- `db.ts`: path resolution, `openEforgePlanStore(cwd, options?)`, close handling, transaction helper.
- `migrations.ts` / `schema.ts`: ordered migrations and schema tests.
- `types.ts`: row and domain projection types. Keep wire/action schemas in focused existing schema modules rather than growing `schema.ts` unless unavoidable.
- `repositories/*`: item, epic, recommendation, planning task, session plan, lifecycle, queue/build, search, import, maintenance repositories.

Repository functions accept typed input and return typed domain rows/projections. SQL row-to-domain mapping helpers must be named and tested. Do not leak raw SQL rows into action handlers.

Minimum API signatures:

```ts
openEforgePlanStore(cwd: string, options?: {
  create?: boolean;
  migrate?: boolean;
  readonly?: boolean;
  validateFts?: boolean;
}): EforgePlanStore;

upsertBacklogItem(store: EforgePlanStore, input: BacklogItemUpsert): BacklogItemRow;
upsertEpic(store: EforgePlanStore, input: EpicUpsert): EpicRow;
upsertRecommendationRun(store: EforgePlanStore, input: RecommendationRunUpsert): RecommendationRunRow;
upsertPlanningTask(store: EforgePlanStore, input: PlanningTaskUpsert): PlanningTaskRow;
upsertSessionPlan(store: EforgePlanStore, input: SessionPlanUpsert): SessionPlanRow;
linkSessionPlanItems(store: EforgePlanStore, input: SessionPlanItemLinkInput): void;
recordLifecycleEvidence(store: EforgePlanStore, input: LifecycleEvidenceInput): LifecycleEvidenceRow;
recordQueueBuildCorrelation(store: EforgePlanStore, input: QueueBuildCorrelationInput): void;
```

### Import contract

Primary importer API:

```ts
runPlanningStoreImport(cwd, {
  dryRun: true,
  replaceExisting: false,
  include: ['backlog', 'epics', 'sessionPlans', 'traces', 'queue', 'monitor', 'recommendations', 'planningTasks'],
}) => ImportReport
```

- `dryRun` defaults to `true` and writes no canonical rows.
- Repeated apply imports are idempotent by stable IDs.
- `replaceExisting: true` is required before deleting/replacing an existing store or canonical rows.
- Diagnostics include orphaned refs, missing files, duplicate IDs, invalid trace rows, stale recommendation refs, unreadable monitor/queue artifacts, and unsupported legacy payloads.
- Import maps legacy private `.eforge/storage/extensions/eforge-plan/...`, compatible `.backlog/...`, `.eforge/session-plans/*.md`, trace sidecars, queue directories/locks/recovery sidecars, monitor DB runs/events where available, and recommendation/status artifacts.
- Producer/consumer contract: `importer-reporting` normalizes legacy artifacts into repository upsert inputs owned by `storage-schema`; `projections-lifecycle` and `fts-search-bounded-actions` consume only the resulting canonical rows and diagnostics, never legacy reader outputs.

### Projection/search contract

Projection functions return compact shapes consumed by existing actions:

- `getItemDetail`, `getEpicDetail`, `listBoardCompact`, `buildBoardDebug`, `listPlanningArtifacts`, `getRecommendationActionability`, `getAssociatedPlanBuildLinks`, `findNonterminalCoverage`.
- `searchItems` remains bounded and SQL-backed.
- Add or expose an all-domain FTS action such as `search-planning-records` for backlog items, epics, session-plan summaries, and recommendation text.
- Limits default to current action defaults where possible (`20` for item search/board reads, `50` for planning artifacts/tasks) and cap at `100` unless a stricter existing cap applies.

Minimum API signatures:

```ts
getItemDetail(store: EforgePlanStore, input: { id: string; fields?: string[] }): ItemDetailProjection;
getEpicDetail(store: EforgePlanStore, input: { id: string; fields?: string[] }): EpicDetailProjection;
listBoardCompact(store: EforgePlanStore, input: PageInput & { lane?: string }): BoardPage;
listPlanningArtifacts(store: EforgePlanStore, input: PageInput): PlanningArtifactsPage;
getRecommendationActionability(store: EforgePlanStore, input: { runId?: string; laneRef?: string; fields?: string[] }): RecommendationActionabilityProjection;
getAssociatedPlanBuildLinks(store: EforgePlanStore, input: { itemIds: string[] }): AssociatedPlanBuildLink[];
findNonterminalCoverage(store: EforgePlanStore, input: { itemIds: string[]; includeTerminalReasons?: boolean }): CoverageResult;
searchPlanningRecords(store: EforgePlanStore, input: PageInput & { query: string; types?: string[] }): SearchPage;
refreshSearchDocuments(store: EforgePlanStore, input: { types?: string[]; ids?: string[]; reason: string }): void;
```

### Action/UI contract

- Existing action IDs remain registered where feasible. Output additions must be optional or versioned to avoid breaking current workstation tests.
- `list-board` remains debug-rich or compatibility-only and is removed from workstation hot paths.
- `list-board-compact`, `get-item`, `get-epic`, `search-items`, `get-recommendations`, `list-planning-artifacts`, `show-session-plan`, and planning task list/read actions use SQL projections.
- Add store/import/maintenance actions with bounded output and clear side effects, for example `get-store-status`, `import-planning-store`, and `compact-planning-store`.
- Workstation code consumes the bounded SQL-backed actions; it must not scan `.eforge/storage/extensions/eforge-plan/` directly.

### Retention contract

Maintenance functions are explicit and observable:

- `compactPlanningStore({ olderThan, categories, archive })`
- `rebuildSearchIndex()`
- `optimizeSearchIndex()`
- `vacuumStore()`
- `getStoreStatus()`

Compaction may prune/archive raw lifecycle event payloads, old planning task payload/results, superseded recommendation runs, verbose import reports, and diagnostic snapshots. It must preserve canonical rows and enough summarized evidence for current lifecycle/actionability/search projections.

Producer/consumer contract: `retention-maintenance` may delete or archive only rows marked retention-eligible by schema metadata. Before pruning raw lifecycle or derived rows, it writes/validates durable `lifecycle_evidence` and actionability/search summary rows that `projections-lifecycle` and `fts-search-bounded-actions` consume after compaction.

## Shared File Registry

| File | Modules | Region Strategy |
| --- | --- | --- |
| `eforge/extensions/eforge-plan/index.ts` | importer-reporting, canonical-write-paths, fts-search-bounded-actions, retention-maintenance | Each module owns a small import/action-registration block. Existing mutation handlers are owned only by canonical-write-paths. |
| `eforge/extensions/eforge-plan/backlog-query-actions.ts` | projections-lifecycle, fts-search-bounded-actions | projections-lifecycle owns non-search compact board/item/epic projections; fts-search-bounded-actions owns `search-items` schema/action/handler and any all-domain search action wiring. |
| `eforge/extensions/eforge-plan/session-plan-actions.ts` | canonical-write-paths, projections-lifecycle | canonical-write-paths owns mutation/handoff SQL writes; projections-lifecycle owns list/show lifecycle SQL reads and helper functions. |
| `eforge/extensions/eforge-plan/recommendation-actions.ts` | projections-lifecycle, fts-search-bounded-actions | projections-lifecycle owns actionability/freshness SQL projection; fts-search-bounded-actions may add recommendation search snippets/counts via a separate action import. |
| `eforge/extensions/eforge-plan/README.md` | storage-schema, importer-reporting, fts-search-bounded-actions, retention-maintenance, workstation-docs-integration | Module-owned documentation sections under stable headings: storage model, import workflow, search behavior, retention/compaction, changed actions. |
| `web/content/docs/eforge-plan.md` | workstation-docs-integration, retention-maintenance | workstation-docs-integration owns storage/import/search user guide text; retention-maintenance owns compaction policy subsection. |
| `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` | fts-search-bounded-actions, workstation-docs-integration | fts-search-bounded-actions owns action response/search types; workstation-docs-integration owns view-model/UI state types. |

If implementation discovers another file that must be edited by more than one architecture module, module planners must add it to this registry before making overlapping edits. Files edited by only one module are intentionally omitted from the shared-file registry.

### Region Declarations

When module planners emit implementation plans for shared TypeScript files, use temporary plan-ID markers matching the compiled plan slug, for example `// --- eforge:region plan-01-storage-schema ---`. Do not use module ids as source markers.

**`eforge/extensions/eforge-plan/index.ts`**:

- `importer-reporting`: add import/store-init/import action block next to current `importLegacyBacklogAction` and register it immediately after the legacy import action.
- `canonical-write-paths`: owns existing `captureItem`, `upsertEpic`, `updateItem`, `promoteItem`, `promoteSelection`, and event hook mutation changes.
- `fts-search-bounded-actions`: add search action imports and registration after `backlogQueryActions` registration.
- `retention-maintenance`: add maintenance action imports and registration after roadmap/planning action registrations, before console contribution registration.

**`eforge/extensions/eforge-plan/backlog-query-actions.ts`**:

- `projections-lifecycle`: owns `GetItem`, `GetEpic`, `ListBoardCompact` SQL projection loading and compact item/epic mapping.
- `fts-search-bounded-actions`: owns `SearchItemsInputSchema`, `SearchItemsOutputSchema`, `search-items` handler, snippets/counts output, and any new all-domain search action.

**`eforge/extensions/eforge-plan/session-plan-actions.ts`**:

- `canonical-write-paths`: owns SQL side effects in create/set/select/ready/delete/update/handoff handlers.
- `projections-lifecycle`: owns SQL lifecycle joins in `listPlanningArtifacts`, `showSessionPlan`, `buildLifecycleBySession`, and `buildLifecycleForPlan`.

**`eforge/extensions/eforge-plan/recommendation-actions.ts`**:

- `projections-lifecycle`: owns SQL-backed current recommendation, freshness, actionability, and active refresh projection.
- `fts-search-bounded-actions`: adds only search-related action wiring if needed; it must not change freshness/actionability semantics.

**Documentation files**:

- Use existing headings where possible. If a module must add a new heading, prefer appending a subsection rather than interleaving bullets inside another module’s section.

## Technical decisions and rationale

1. **Use `node:sqlite`, not a new dependency.** The repo already requires Node >= 22 and monitor DB uses `node:sqlite`; this keeps packaging simpler and avoids native dependency drift.
2. **Use SQL migrations in extension source.** eforge-plan is a package loaded as an extension; migrations must travel with its runtime bundle and run on open.
3. **Keep legacy readers as importer-only.** Existing Markdown/JSON readers can be reused by the importer, but normal action read paths should not fall back to legacy files after the store is initialized.
4. **Prefer rebuildable FTS helpers over complex triggers unless tests show triggers stay small.** Rebuild helpers are explicit, easy to test, and support retention rebuilds. If triggers are used, schema tests must verify them.
5. **Reject duplicate direct planning with evidence.** Existing user-facing behavior already fails closed for selected work with active evidence; SQL centralizes it and makes the policy consistent.
6. **Keep raw payloads prunable, summary rows durable.** This satisfies bounded growth without losing current-state explainability.
7. **Avoid growing oversized files.** New implementation files stay under 600 lines and use durable semantic region markers if over 300 lines. Existing large files receive bounded exact edits only.

## Quality attributes

- **Data safety:** import defaults to dry-run; destructive replacement requires an explicit flag; imports run in transactions; schema foreign keys and uniqueness constraints are tested.
- **Idempotency:** stable IDs and upserts make repeated imports/replays produce unchanged row counts except diagnostics/import-run metadata.
- **Boundedness:** all public list/search actions enforce default and maximum limits with pagination metadata.
- **Explainability:** current lifecycle/actionability/search projections retain summarized evidence after maintenance compaction.
- **Testability:** schema, importer, projection, search, action, and retention modules have focused Vitest coverage with temporary clean DBs and representative legacy fixtures.
- **Boundary preservation:** no engine feature creep, no remote SQL/sync, no embeddings, no team workflow semantics.

## Module plan guidance

Each module must include code and tests for its behavior; do not create test-only follow-up plans. Run focused tests during module implementation and rely on final validation for full-suite integration.

Expected validation commands for the full plan set:

```bash
pnpm type-check
pnpm test
pnpm maintainability:check
```
