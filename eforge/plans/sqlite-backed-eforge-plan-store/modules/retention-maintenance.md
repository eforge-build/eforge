# Retention Maintenance

## Architecture Reference

This module implements the `retention-maintenance` module from the architecture, especially the **Retention contract**, **FTS freshness contract**, **Shared data model**, **Action/UI contract**, **Quality attributes**, and **Shared File Registry** sections.

Key constraints from architecture:
- Compaction is explicit and observable. No maintenance path silently truncates canonical backlog items, epics, dependencies, session-plan metadata, item-plan joins, current recommendation/actionability state, or current lifecycle state.
- Eligible high-volume data is limited to raw lifecycle event payloads, old planning task raw request/result payloads, superseded recommendation runs, verbose import reports, diagnostic snapshots, and SQLite/FTS maintenance state.
- Durable `lifecycle_evidence` summaries and current SQL projection explainability must survive compaction.
- FTS rebuild/optimize is explicit and uses helpers from `fts-search-bounded-actions`; search actions report dirty state rather than hiding stale data.
- Board lanes, recommendation actionability, associated links, and duplicate coverage remain owned by `projections-lifecycle`; this module may validate preservation with those projection APIs but must not reimplement their policy.
- Database access stays behind typed SQLite repositories. Action handlers must not execute raw SQL or import `node:sqlite` directly.
- Store maintenance is local eforge-plan extension/workstation behavior, not an engine/kernel feature and not a remote SQL/sync feature.
- New implementation files stay under 600 lines; TypeScript files over 300 lines use durable semantic region markers.

## Scope

### In Scope

- Retention policy types and category normalization for explicit store compaction.
- Dry-run-first `compactPlanningStore(cwd, input)` with bounded candidate samples and row counts.
- Apply-mode compaction for eligible raw lifecycle event payloads while preserving `lifecycle_evidence.retained_summary_json`.
- Apply-mode compaction for terminal/old planning task raw request/result payloads while preserving task rows, selection summaries, compact result summaries, parent links, and applied timestamps.
- Apply-mode pruning or archiving of non-current superseded recommendation runs and their lanes/items while preserving the current recommendation run, lanes, lane items, and actionability projections.
- Apply-mode compaction of verbose import run reports and diagnostic detail snapshots while preserving import run counts/summaries and diagnostic severity/code/message/ref/path rows.
- Optional JSONL archive files for rows/payloads affected by compaction.
- Store maintenance run recording through `store_maintenance_runs` with counts, preserved evidence counts, categories, status, and error summaries.
- Store status reporting with DB file sizes, WAL/SHM sizes, schema version, table counts, retention eligibility counts, search index status, and recent maintenance runs.
- Public maintenance actions: `get-store-status`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store`.
- FTS rebuild and optimize action wiring using helpers produced by `fts-search-bounded-actions`.
- Explicit `VACUUM` and WAL checkpoint helpers with before/after byte counts.
- Console contribution entries and workstation allowlist entries for the maintenance actions.
- User-facing README and docs-site retention/compaction policy text.
- Focused tests for dry-run reports, pruning/archive behavior, protected canonical row preservation, projection preservation, FTS rebuild/optimize/vacuum helpers, action registration, and action output bounds.

### Out of Scope

- SQLite schema foundation, migrations, base repository upserts, or FTS table creation from `storage-schema`.
- Legacy import orchestration and import diagnostics generation from `importer-reporting`.
- Runtime capture/update/promote/handoff/lifecycle mutation rewrites from `canonical-write-paths`.
- Board lane, lifecycle, recommendation actionability, duplicate coverage, or associated-link policy from `projections-lifecycle`.
- FTS document projection, ranked search, snippets, and search action implementations from `fts-search-bounded-actions`.
- Workstation React UI screens for maintenance. This module registers bounded actions and types; a later workstation integration can render them.
- Claude Code plugin or Pi package edits. Existing generic extension contribution discovery exposes the new actions to both integrations.
- Remote SQL configuration, Postgres, synchronization, embeddings/vector search, team workflow semantics, or engine/kernel changes.
- Automatic background compaction. All mutation paths require an explicit maintenance action/helper call.

## Implementation Approach

### Overview

Add a focused maintenance layer under `eforge/extensions/eforge-plan/maintenance/` plus pruning/status repository helpers under `eforge/extensions/eforge-plan/sqlite/repositories/`. The maintenance layer opens the eforge-plan store through `openEforgePlanStore`, computes a retention cutoff, collects eligible candidates per category, optionally writes JSONL archives, preserves summarized lifecycle evidence, mutates only retention-eligible rows/columns inside a transaction, records a maintenance run, and returns a compact bounded report.

The core compaction flow is:

1. Open an existing migrated store. `get-store-status` returns `initialized: false` when the DB file is absent; mutation actions fail with a user-action error when the store is absent.
2. Normalize categories, cutoff, row limit, sample limit, archive flag, and safety knobs such as `keepLatestRecommendationRuns` and `keepLatestImportRuns`.
3. Query category eligibility counts and bounded candidate samples.
4. For dry-runs, return counts/samples without writing archives, rows, dirty markers, or maintenance run rows.
5. For apply mode, write JSONL archives first when `archive: true`.
6. Start one writable transaction. Record protected canonical row counts, preserve current lifecycle evidence summaries, clear/delete eligible rows or payload columns, rebuild recommendation search documents if recommendation rows were deleted, verify protected counts, record the maintenance run, and commit.
7. Return a bounded `MaintenanceReport` with counts, archive paths, preserved evidence counts, search refresh metadata, and warnings.

Vacuum is intentionally separate from compaction because SQLite `VACUUM` cannot run inside the same transaction as pruning. `vacuum-planning-store` checkpoints WAL when requested, runs `VACUUM`, records one maintenance run, and reports before/after sizes.

### Key Decisions

1. **Default maintenance reads before writes.** `compact-planning-store` defaults `dryRun` to `true`. Apply mode requires `dryRun: false`, making destructive or payload-clearing behavior explicit in action input and tests.
2. **Prune payload columns before deleting durable rows.** Lifecycle and planning task compaction clears `payload_json`, `raw_request_json`, and `raw_result_json` for eligible rows rather than deleting the rows. This preserves event/task identity, timestamps, status, joins, and summarized evidence for projections.
3. **Delete only non-current recommendation runs.** Superseded recommendation compaction deletes runs with `is_current = 0` older than the cutoff after respecting `keepLatestRecommendationRuns`. Current recommendation run/lane/item rows are protected by count checks and never archived/deleted by this module.
4. **Use JSONL archive files as optional escape hatches.** When `archive: true`, affected payloads/rows are written to `.eforge/storage/extensions/eforge-plan/archives/maintenance/<runId>/<category>.jsonl` before mutation. Archive paths and row counts are included in the report; archives are not read by normal projections.
5. **Validate protected row counts inside the transaction.** Protected counts include backlog items, epics, dependencies, session plans, session-plan joins, queue/build/session/landing rows, current lifecycle evidence, and current recommendation rows. A count mismatch throws before commit.
6. **Preserve lifecycle explainability before pruning raw payloads.** `preserveLifecycleEvidenceSummaries()` writes or refreshes `lifecycle_evidence.retained_summary_json` for current evidence rows using compact fields already consumed by projection/search code: state, reason code, status, summary, timestamps, linked session/task/queue/build/landing ids, and `links_json`.
7. **Depend on FTS helpers instead of duplicating search index code.** Recommendation-run pruning calls `rebuildSearchIndex(store, { types: ['recommendation'], reason })`. Public FTS maintenance actions call `rebuildSearchIndex()` and `optimizeSearchIndex()` from the search module.
8. **Keep action outputs bounded.** Reports return counts and at most `sampleLimit` candidate summaries per category. Raw archived payloads, import report JSON, lifecycle event payloads, and planning task payloads never appear in action output.
9. **Record observable maintenance metadata.** Apply-mode compaction, FTS rebuild/optimize, and vacuum record rows in `store_maintenance_runs`. Dry-run compaction writes no row and returns `status: 'dry-run'`.
10. **No hidden store creation from status reads.** `get-store-status` does not create `.eforge/storage/extensions/eforge-plan/`; it reports the expected path and `initialized: false` when the SQLite file is missing.

### Public API Contracts

Export these functions from `eforge/extensions/eforge-plan/maintenance/index.ts`:

```ts
export async function getPlanningStoreStatus(cwd: string, input?: GetStoreStatusInput): Promise<PlanningStoreStatus>;
export async function compactPlanningStore(cwd: string, input?: CompactPlanningStoreInput): Promise<MaintenanceReport>;
export async function rebuildPlanningSearchIndex(cwd: string, input?: RebuildSearchIndexInput): Promise<SearchIndexMaintenanceActionReport>;
export async function optimizePlanningSearchIndex(cwd: string): Promise<SearchIndexMaintenanceActionReport>;
export async function vacuumPlanningStore(cwd: string, input?: VacuumPlanningStoreInput): Promise<VacuumStoreReport>;
```

Core input and output contracts:

```ts
export type MaintenanceCategory =
  | 'lifecycle-event-payloads'
  | 'planning-task-payloads'
  | 'superseded-recommendation-runs'
  | 'import-report-payloads'
  | 'import-diagnostic-details';

export interface CompactPlanningStoreInput {
  dryRun?: boolean; // default true
  categories?: MaintenanceCategory[];
  olderThan?: string; // ISO timestamp; overrides olderThanDays
  olderThanDays?: number; // default 90
  archive?: boolean; // default false
  rowLimit?: number; // default 1000, max 10000
  sampleLimit?: number; // default 20, max 100
  keepLatestRecommendationRuns?: number; // default 5
  keepLatestImportRuns?: number; // default 10
  rebuildSearchAfter?: boolean; // default true when recommendations are pruned
}

export interface MaintenanceReport {
  schemaVersion: 1;
  runId: string;
  status: 'dry-run' | 'applied' | 'failed';
  dryRun: boolean;
  categories: MaintenanceCategory[];
  cutoff: string;
  archive: boolean;
  prunedCounts: Record<string, number>;
  archivedCounts: Record<string, number>;
  preservedEvidenceCounts: Record<string, number>;
  archivePaths: Array<{ category: MaintenanceCategory; path: string; rowCount: number }>;
  samples: Partial<Record<MaintenanceCategory, MaintenanceCandidateSample[]>>;
  searchRefresh?: SearchRefreshReport;
  warnings: string[];
}
```

Maintenance candidate samples include only identity/status/timestamp fields such as `eventKey`, `taskId`, `runId`, `diagnosticId`, `occurredAt`, `updatedAt`, and `summary`. They exclude raw payload text.

### Retention Categories

- `lifecycle-event-payloads`
  - Eligible rows: `lifecycle_events.payload_prunable = 1`, `payload_json IS NOT NULL`, and `timestamp < cutoff`.
  - Apply behavior: archive full payload when requested, refresh current `lifecycle_evidence.retained_summary_json`, set `payload_json = NULL`, preserve `event_key`, type, timestamp, correlation ids, and affected item refs.
- `planning-task-payloads`
  - Eligible rows: `planning_tasks.raw_payload_prunable = 1`, terminal/non-active `status_snapshot`, `updated_at < cutoff`, and at least one raw payload column non-null.
  - Apply behavior: archive raw request/result when requested, set `raw_request_json = NULL` and `raw_result_json = NULL`, preserve task id, purpose, status snapshot, selection summary, compact result summary, joins, parent task id, created/updated/applied timestamps.
- `superseded-recommendation-runs`
  - Eligible rows: `recommendation_runs.is_current = 0`, older than cutoff, not within the latest `keepLatestRecommendationRuns` non-current runs, and not referenced by current session-plan joins or current lifecycle evidence links.
  - Apply behavior: archive run/lane/lane-item compact JSON when requested, delete eligible runs with cascading lane/item rows, rebuild recommendation search documents when `rebuildSearchAfter !== false`.
- `import-report-payloads`
  - Eligible rows: `import_runs.verbose_report_prunable = 1`, `verbose_report_json IS NOT NULL`, older than cutoff, and not within the latest `keepLatestImportRuns` import runs.
  - Apply behavior: archive verbose report when requested, set `verbose_report_json = NULL`, preserve counts, summary, applied/dry-run flags, and timestamps.
- `import-diagnostic-details`
  - Eligible rows: import diagnostic `details_json IS NOT NULL` whose run is older than cutoff and outside the latest `keepLatestImportRuns`.
  - Apply behavior: archive details when requested, set `details_json = NULL`, preserve diagnostic id, run id, severity, code, message, ref, and path.

## Files

### Create

- `eforge/extensions/eforge-plan/maintenance/types.ts` — maintenance category literals, public action input/output contracts, report/sample/status types, archive metadata, protected-count types, and JSON-safe helpers.
- `eforge/extensions/eforge-plan/maintenance/policy.ts` — category normalization, cutoff calculation, row/sample limit caps, keep-latest defaults, terminal planning-task status predicates, and protected table definitions.
- `eforge/extensions/eforge-plan/maintenance/archive.ts` — JSONL archive path resolution, safe directory creation, archive writing, archive row counts, and project-relative archive path helpers.
- `eforge/extensions/eforge-plan/maintenance/evidence.ts` — `preserveLifecycleEvidenceSummaries()` and protected-count validation helpers that operate through SQLite repositories.
- `eforge/extensions/eforge-plan/maintenance/compact.ts` — `compactPlanningStore()` orchestration, dry-run report assembly, archive/write transaction flow, search rebuild call after recommendation pruning, maintenance run recording, rollback/failure handling, and bounded report mapping.
- `eforge/extensions/eforge-plan/maintenance/status.ts` — `getPlanningStoreStatus()`, DB/WAL/SHM file stat helpers, schema/table-count projection, retention eligibility counts, search index status, and recent maintenance run mapping.
- `eforge/extensions/eforge-plan/maintenance/sqlite-maintenance.ts` — `vacuumPlanningStore()`, WAL checkpoint helper, before/after byte reporting, and maintenance run recording for VACUUM.
- `eforge/extensions/eforge-plan/maintenance/search-actions.ts` — wrappers around `rebuildSearchIndex()` and `optimizeSearchIndex()` that open the store, record maintenance runs, and return action-safe reports.
- `eforge/extensions/eforge-plan/maintenance/actions.ts` — TypeBox schemas and extension actions for `get-store-status`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store`.
- `eforge/extensions/eforge-plan/maintenance/index.ts` — public exports for maintenance helpers, actions, and types.
- `eforge/extensions/eforge-plan/sqlite/repositories/maintenance-pruning.ts` — typed SQL candidate selectors, count queries, payload clearing, superseded recommendation deletion, protected canonical row counts, and named row-to-domain mappers.
- `eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-fixtures.ts` — test helpers that seed retention-eligible rows through repository/canonical/search fixture APIs and expose row-count assertions.
- `eforge/extensions/eforge-plan/__tests__/sqlite-retention-maintenance.test.ts` — compaction policy, dry-run, archive, payload clearing, recommendation pruning, import report/detail pruning, protected counts, and maintenance run tests.
- `eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-projection-preservation.test.ts` — before/after board, item detail, recommendation actionability, associated links, and search projection preservation tests after compaction.
- `eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-actions.test.ts` — extension dispatch tests for maintenance actions, default/max caps, bounded outputs, status for missing stores, action side effects, and raw payload omission.
- `eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-search-vacuum.test.ts` — FTS rebuild/optimize action tests, dirty-state clearing, recommendation-search stale-row removal after pruning, VACUUM/WAL checkpoint reports, and maintenance run recording.

### Modify

- `eforge/extensions/eforge-plan/sqlite/types.ts` — add maintenance category/report/status row contracts, pruning candidate row types, protected-count types, table-count types, and recent maintenance run projection types needed by repositories. This file is shared by several SQLite modules but is not in the architecture shared-file registry; use bounded exact edits near the existing maintenance/search contracts and avoid changing unrelated storage types.
- `eforge/extensions/eforge-plan/sqlite/repositories/maintenance.ts` — extend the base maintenance repository with recent-run listing, failed-run recording, and maintenance row mappers if `storage-schema` only created `recordMaintenanceRun`.
- `eforge/extensions/eforge-plan/sqlite/repositories/search-documents.ts` — add stale recommendation search-document deletion/count helpers only if the FTS module does not already expose them through `rebuildSearchIndex()`. This file is shared with `storage-schema`, `canonical-write-paths`, and `fts-search-bounded-actions` but is not in the architecture shared-file registry; keep edits in a small maintenance helper block and prefer importing FTS helpers over adding SQL here.
- `eforge/extensions/eforge-plan/sqlite/index.ts` — export maintenance pruning/status repository helpers and maintenance types required by `maintenance/*`.
- `eforge/extensions/eforge-plan/index.ts` — import `maintenanceActions`, register them after roadmap/planning action registrations and before console contribution registration, add console contribution buttons/forms for store status, dry-run compaction, search rebuild, search optimize, and vacuum, and add maintenance action ids to the planning workstation allowlist `[region: retention-maintenance, maintenance action imports and registration after roadmap/planning action registrations, before console contribution registration]`.
- `eforge/extensions/eforge-plan/README.md` — document maintenance actions in the Usage/Actions sections and add a retention/compaction subsection that explains dry-run default, eligible categories, archive paths, protected canonical rows, FTS rebuild/optimize, and VACUUM `[region: retention-maintenance, retention/compaction policy under Storage model and maintenance actions in the action reference]`.
- `web/content/docs/eforge-plan.md` — add a concise compaction policy subsection under storage/trust that names `get-store-status`, `compact-planning-store`, FTS rebuild/optimize, VACUUM, protected canonical rows, and archive behavior `[region: retention-maintenance, compaction policy subsection]`.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — include the five maintenance actions in expected registration lists, side-effect classifications, output-profile assertions, contribution blocks, and workstation allowlist assertions.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — assert the README documents maintenance actions, dry-run compaction, protected canonical rows, archive paths, FTS maintenance, and VACUUM behavior.
- `eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts` — update docs expectations if the docs-site summary adds a retention/compaction subsection.

Temporary source coordination markers in shared TypeScript files must use the compiled plan slug:

```ts
// --- eforge:region plan-06-retention-maintenance ---
// Maintenance action imports, registration, contribution entries, or schemas owned by this module.
// --- eforge:endregion plan-06-retention-maintenance ---
```

Use Markdown headings rather than source markers in documentation files. If a builder adds temporary markers in Markdown during parallel work, use HTML comments with the same compiled plan slug and remove them during cleanup.

## Testing Strategy

### Unit Tests

- Retention policy normalization:
  - Default categories include all five compaction categories.
  - `dryRun` defaults to `true`.
  - `olderThan` overrides `olderThanDays`.
  - `rowLimit` caps at `10000` and `sampleLimit` caps at `100`.
  - Invalid ISO timestamps throw a user-facing validation error before opening a writable store.
- Candidate mappers:
  - Lifecycle event candidates expose event key, type, timestamp, item refs, and summary only.
  - Planning task candidates expose task id, purpose, status snapshot, updated timestamp, and payload presence only.
  - Recommendation run candidates expose run id, created timestamp, lane count, lane item count, and `isCurrent: false` only.
  - Import report/diagnostic candidates omit verbose report JSON and diagnostic detail JSON.
- Evidence preservation:
  - `preserveLifecycleEvidenceSummaries()` writes `retained_summary_json` for current evidence rows with lifecycle state, reason code, status, summary, occurred timestamp, and compact link ids.
  - Existing retained summaries are updated when linked evidence fields change.
- Protected-count validation:
  - A mismatch in backlog item count throws and rolls back the transaction.
  - Current recommendation run/lane/item counts are compared separately from prunable non-current recommendation counts.
- Archive writer:
  - Archive paths stay under `.eforge/storage/extensions/eforge-plan/archives/maintenance/<runId>/`.
  - Archive JSONL contains one JSON object per archived row.
  - Archive writer rejects path traversal attempts in run id or category values.

### Integration Tests

- Seed a temp store with backlog items, epics, dependencies, current and historical recommendation runs, planning tasks, session plans, queue/build/session/landing links, lifecycle events/evidence, import runs/diagnostics, and search documents.
- Call `compactPlanningStore(cwd, {})` and assert no rows or files change, `status: 'dry-run'`, `dryRun: true`, non-zero eligible counts, bounded samples, and no `store_maintenance_runs` row is inserted.
- Call apply compaction with `archive: true` and explicit cutoff, then assert eligible lifecycle payload columns are `NULL`, planning task raw payload columns are `NULL`, verbose import report JSON is `NULL`, diagnostic details JSON is `NULL`, historical recommendation runs are deleted, current recommendation rows remain, archive files exist, and one maintenance run row is recorded.
- Compare `listBoardCompactProjection`, `getItemDetailProjection`, `getRecommendationProjection`, `findNonterminalCoverage`, and `searchPlanningRecords` before and after compaction for current records that are not eligible for pruning.
- Seed recommendation FTS documents for current and historical lanes, prune historical recommendation runs, and assert recommendation search documents are rebuilt so current lanes remain searchable and deleted historical lane ids are absent.
- Dispatch `get-store-status` on a temp project with no SQLite store and assert `initialized: false`, the expected store path, no storage directory creation, and no thrown error.
- Dispatch `get-store-status` on a populated store and assert schema version, file sizes, table counts, retention eligibility counts, search index status, and recent maintenance run summaries are present without raw payload fields.
- Dispatch `compact-planning-store` with `dryRun: false`, `sampleLimit: 500`, and `rowLimit: 50000`; assert the action output reports capped `sampleLimit: 100` and `rowLimit: 10000`.
- Dispatch `rebuild-search-index` with `types: ['backlog_item', 'epic']` and assert dirty markers for those types are cleared while other dirty types remain.
- Dispatch `optimize-search-index` and assert the FTS optimize helper runs and records a maintenance run category for search optimize.
- Dispatch `vacuum-planning-store` and assert before/after byte fields are numeric, WAL checkpoint metadata is present when requested, and a maintenance run category for vacuum is recorded.
- Dispatch all maintenance actions through the extension registry and assert output schemas reject raw lifecycle payloads, raw planning task payloads, raw recommendation model JSON, verbose import reports, and diagnostic details.

## Verification

- [ ] `get-store-status` on a project without a store returns `initialized: false` and leaves `.eforge/storage/extensions/eforge-plan/` absent.
- [ ] `compact-planning-store` with omitted input returns `dryRun: true`, `status: 'dry-run'`, retention eligibility counts, and inserts zero `store_maintenance_runs` rows.
- [ ] `compact-planning-store` with `dryRun: false` clears `lifecycle_events.payload_json` only for rows with `payload_prunable = 1` and `timestamp < cutoff`.
- [ ] The same apply run leaves `lifecycle_evidence` current rows present and writes non-null `retained_summary_json` for affected current evidence.
- [ ] The same apply run clears old terminal planning task `raw_request_json` and `raw_result_json` while leaving `planning_tasks.task_id`, `purpose`, `status_snapshot`, `selection_summary_json`, and `compact_result_summary_json` unchanged.
- [ ] The same apply run deletes non-current recommendation runs older than the cutoff and leaves exactly one current recommendation run when one current run existed before compaction.
- [ ] The same apply run clears old `import_runs.verbose_report_json` and leaves `counts_json` and `summary_json` unchanged.
- [ ] The same apply run clears old `import_diagnostics.details_json` and leaves `severity`, `code`, `message`, `ref`, and `path` unchanged.
- [ ] An apply run with `archive: true` writes one JSONL file per affected category under `.eforge/storage/extensions/eforge-plan/archives/maintenance/<runId>/`.
- [ ] Protected row counts for `backlog_items`, `epics`, `item_dependencies`, `session_plans`, `session_plan_items`, `session_plan_epics`, `queue_prds`, `build_runs`, `build_sessions`, `landing_links`, and current `lifecycle_evidence` match before and after compaction.
- [ ] `list-board-compact` returns the same current item ids, lanes, effective lifecycle values, and reason codes before and after compaction for seeded current records.
- [ ] `get-recommendations` returns the same current lane refs, item ids, dispositions, and actionability reason codes before and after compaction.
- [ ] `search-planning-records` returns current backlog item, epic, session-plan, and current recommendation hits after compaction and omits deleted historical recommendation lane ids.
- [ ] `rebuild-search-index` clears dirty markers for requested document types and returns a report with refreshed document counts.
- [ ] `optimize-search-index` records one maintenance run with a search optimize category.
- [ ] `vacuum-planning-store` returns numeric `beforeBytes`, `afterBytes`, and `walBytesAfter` fields and records one maintenance run with a vacuum category.
- [ ] Maintenance action outputs omit `payload_json`, `raw_request_json`, `raw_result_json`, `raw_model_json`, `verbose_report_json`, and `details_json` strings.
- [ ] Extension registration includes `get-store-status`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store` with declared local-read/local-write side effects matching each action.
- [ ] The planning workstation allowlist contains all five maintenance action ids.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/sqlite-retention-maintenance.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-projection-preservation.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-actions.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-maintenance-search-vacuum.test.ts` exits 0.

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
