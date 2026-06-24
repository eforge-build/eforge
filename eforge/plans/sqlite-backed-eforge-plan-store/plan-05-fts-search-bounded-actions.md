---
id: plan-05-fts-search-bounded-actions
name: Implement FTS5 ranked/snippet search and swap agent-facing
  list/search/read contribution actions to bounded SQL-backed projections with
  filters and pagination.
branch: sqlite-backed-eforge-plan-store/fts-search-bounded-actions
---

# FTS Search Bounded Actions

## Architecture Reference

This module implements the `fts-search-bounded-actions` module from the architecture, especially the **FTS layer**, **Projection/search contract**, **Action/UI contract**, **Retention contract**, **Shared data model**, and **Shared File Registry** sections.

Key constraints from architecture:
- FTS5 search is built from canonical SQLite rows and `search_documents`; normal search/read paths do not scan legacy Markdown, recommendation JSON sidecars, trace sidecars, or planning task sidecars.
- Search covers backlog item titles, item IDs, tags, claims/evidence/acceptance criteria, epics, session-plan summaries, and recommendation text.
- Search APIs return ranked results, snippets, counts, filters, selected fields, and pagination metadata with default limits and max caps.
- `search-items` remains the existing backlog item search action ID, but it becomes SQL/FTS-backed and bounded; output additions are optional/additive.
- Add an all-domain FTS action such as `search-planning-records` for backlog items, epics, session-plan summaries, and recommendation text.
- FTS freshness is explicit: canonical writes/imports may mark dirty records; search actions expose dirty/unhealthy index metadata instead of hiding stale-index risk.
- Rebuild/refresh/optimize helpers are produced here for use by importer, canonical writes, search actions, and the later retention-maintenance module; public compaction/VACUUM action wiring belongs to retention-maintenance.
- This module may hydrate backlog item search hits through public projection helpers from `projections-lifecycle` so effective lifecycle, lane, and associated compact item fields are not recomputed in the search layer.
- This module does not implement lifecycle/actionability policy beyond applying caller-supplied filters, importer diagnostics, canonical mutation paths, retention pruning, embeddings/vector search, remote SQL, Postgres, synchronization, or engine/kernel changes.

## Scope

### In Scope

- FTS document projection for canonical backlog items, epics, flat session-plan metadata/provenance, and recommendation runs/lanes.
- Search document refresh helpers for individual records, dirty records, selected types, and full rebuilds.
- FTS5 optimize helper and search-index status projection for later maintenance actions.
- Ranked FTS query helpers using SQLite `bm25()` and deterministic tie-breaking.
- Snippet generation through SQLite FTS `snippet()` with compact JSON-safe snippet metadata.
- SQL-backed `search-items` action that preserves the existing action ID and compatibility fields while adding optional rank/snippet/count/index metadata.
- SQL-backed `search-planning-records` action across backlog items, epics, session-plan summaries, and recommendation text.
- Search filters for backlog status, effective lane, epic, tags, archive inclusion, document type, item refs, epic refs, session refs, and recommendation refs where those filters map to canonical rows.
- Offset pagination with default limit `20` and max cap `100` for search actions.
- Selected-field controls for all-domain search results and compatibility projection flags for `search-items`.
- Dirty-index metadata in search action outputs, including dirty count, dirty types, dirty reason, dirty timestamp, and last rebuild timestamp when available.
- Tests for document projection, rebuild/dirty clearing, FTS ranking, snippets, filters, pagination, action schemas, output bounds, selected fields, and no broad raw payloads.
- README action/search documentation updates for FTS-backed search behavior and stale-index reporting.
- Workstation TypeScript response types for new search result/snippet/index metadata.

### Out of Scope

- SQLite schema/table/FTS object creation and base repository upserts from `storage-schema`.
- Legacy importer orchestration, dry-run reports, destructive replacement, and import diagnostics from `importer-reporting`.
- Runtime backlog/session/recommendation/lifecycle mutation rewrites from `canonical-write-paths`.
- Board lane, item lifecycle, recommendation actionability, duplicate coverage, and associated link policy from `projections-lifecycle`.
- Retention pruning/archive/VACUUM action handlers from `retention-maintenance`.
- Workstation UI views that render a full planning search screen; the later `workstation-docs-integration` module may consume the response types added here.
- Claude Code plugin or Pi package changes. Extension actions are discovered generically by both integrations.
- FTS triggers. This plan uses explicit rebuild/refresh helpers against `search_documents` and `search_documents_fts`.
- Embedding/vector search, semantic reranking, remote SQL, Postgres, multi-user synchronization, or team workflow semantics.

## Implementation Approach

### Overview

Add a focused search layer under `eforge/extensions/eforge-plan/search/` plus FTS query/document repositories under `eforge/extensions/eforge-plan/sqlite/repositories/`. The search layer has three responsibilities:

1. **Project canonical rows into FTS documents.** Backlog items, epics, session-plan summaries, and recommendation lanes are converted into `SearchDocumentUpsert` rows. The projection uses stable document IDs and SHA-256 source hashes so repeated refreshes are idempotent and no raw session-plan Markdown body is copied into the database.
2. **Maintain the FTS index explicitly.** `refreshSearchDocuments()`, `refreshDirtySearchDocuments()`, `rebuildSearchIndex()`, and `optimizeSearchIndex()` update `search_documents`, `search_documents_fts`, dirty-record rows, and `search_index_state`. They are exported from `search/index.ts` and re-exported from `sqlite/index.ts` only where repository-level helpers belong.
3. **Serve bounded search actions.** `search-items` queries backlog item FTS documents, then hydrates ordered compact item summaries through `projections-lifecycle` hydration helpers. `search-planning-records` returns compact all-domain records with rank, snippet, refs, counts by type, and pagination metadata.

Read-only search actions do not silently rebuild a dirty index. They return `indexDirty: true` and an `indexStatus` object when dirty markers exist. Callers that need fresh results invoke the refresh/rebuild helper through importer/canonical/maintenance flows. Tests that assert ranking/snippets call `rebuildSearchIndex()` after seeding canonical rows.

### Key Decisions

1. **Use explicit rebuildable documents.** Search freshness is controlled by `search_documents`, `search_documents_fts`, `search_index_state`, and `search_index_dirty_records`. No FTS triggers are added in this module, so rebuilds are deterministic and available to retention-maintenance.
2. **Keep lifecycle hydration in projections.** `search-items` obtains ranked matching item IDs from FTS and calls a new projection helper such as `hydrateCompactItemSearchResults()` for lane/effective-lifecycle/status/dependency fields. The search module applies rank/snippet metadata after hydration and does not duplicate board lane logic.
3. **Preserve the existing `search-items` shape.** The action still returns `schemaVersion`, `items`, optional `epics`, `total`, `limit`, and `offset`. Additive fields include `snippets`, `counts`, `pagination`, `indexDirty`, and `indexStatus`; item rows may include `rank`, `snippet`, and `matchedFields` when requested or when a text query is present.
4. **Add one all-domain action instead of broad raw reads.** `search-planning-records` returns compact `SearchResult` records for `backlog_item`, `epic`, `session_plan`, and `recommendation` documents. It does not return backlog bodies, raw recommendation JSON, session-plan Markdown bodies, lifecycle event payloads, or import reports.
5. **Treat blank `search-items.query` as filtered compact listing.** When `query` is omitted or trims to an empty string, `search-items` delegates to projection-backed item listing with filters and pagination, sets `rank`/`snippet` metadata absent, and still returns index status if dirty markers exist.
6. **Use a sanitized FTS query builder.** User input is tokenized, quoted, and bound as a query parameter. Column-scoped queries honor `searchBody: false` by searching title/tag/id/ref columns only; `searchBody: true` adds claim/evidence/acceptance/body-summary columns. Special characters never become raw SQL.
7. **Use deterministic ranking ties.** Results sort by `bm25()` ascending, then document type priority (`backlog_item`, `epic`, `session_plan`, `recommendation`), updated timestamp descending, and stable document ID ascending.
8. **Keep maintenance helpers separate from public compaction actions.** This module exports `rebuildSearchIndex()` and `optimizeSearchIndex()`; retention-maintenance wires those helpers into `compact-planning-store`, `rebuild-search-index`, or store-status actions if that module chooses to expose them.

### Search Contracts

Export these public functions from `eforge/extensions/eforge-plan/search/index.ts`:

```ts
export async function searchItems(cwd: string, input: SearchItemsInput): Promise<SearchItemsOutput>;
export async function searchPlanningRecords(cwd: string, input: SearchPlanningRecordsInput): Promise<SearchPlanningRecordsOutput>;
export function refreshSearchDocuments(store: EforgePlanStore, input: RefreshSearchDocumentsInput): void;
export function refreshDirtySearchDocuments(store: EforgePlanStore, input?: { limit?: number; reason?: string }): SearchRefreshReport;
export function rebuildSearchIndex(store: EforgePlanStore, input?: { types?: SearchDocumentType[]; reason?: string }): SearchRefreshReport;
export function optimizeSearchIndex(store: EforgePlanStore): SearchMaintenanceReport;
export function getSearchIndexStatus(store: EforgePlanStore): SearchIndexStatus;
```

Core response types:

```ts
export type SearchDocumentType = 'backlog_item' | 'epic' | 'session_plan' | 'recommendation';

export interface SearchSnippet {
  text: string;
  field?: 'title' | 'tags' | 'summary' | 'body' | 'itemIds' | 'epicIds' | 'recommendationRefs';
  highlights: string[];
}

export interface SearchIndexStatus {
  dirty: boolean;
  dirtyCount: number;
  dirtyTypes: SearchDocumentType[];
  dirtySince?: string;
  dirtyReason?: string;
  lastRebuiltAt?: string;
}

export interface SearchResult {
  type: SearchDocumentType;
  id: string;
  title: string;
  rank?: number;
  snippet?: SearchSnippet;
  refs?: {
    itemIds?: string[];
    epicIds?: string[];
    session?: string;
    recommendationRef?: string;
    runId?: string;
  };
  updatedAt?: string;
}
```

Action schemas should expose only JSON-safe compact values. `fields` is a whitelist for optional all-domain result fields such as `rank`, `snippet`, `refs`, and `updatedAt`; `id`, `type`, and `title` are always returned.

### Search Document Projection Details

- **Backlog item documents**
  - `document_type = 'backlog_item'`, `document_id = backlog_items.id`.
  - `title` contains the item title.
  - `tags_text` contains tags and priority.
  - `summary_text` contains item ID, epic ref/id, dependency refs, and section headings.
  - `body_text` contains extracted Claim, Evidence, Acceptance Criteria, and selected section content from `backlog_item_sections`; include the canonical `body` only if storage-schema retained it for items.
  - `item_ids_text` contains the item ID and normalized ID tokens.
  - `epic_ids_text` contains resolved and unresolved epic refs.
- **Epic documents**
  - `document_type = 'epic'`, `document_id = epics.id`.
  - `title`, tags, status, body/summary sections, and epic ID tokens are indexed.
  - `item_ids_text` may contain child item IDs from canonical item rows to support item-to-epic ref searches.
- **Session-plan documents**
  - `document_type = 'session_plan'`, `document_id = session_plans.session`.
  - Index topic, status, planning type/depth/profile, `summary_text`, readiness summary JSON text, source item/epic IDs, session ID, path, and recommendation refs.
  - Do not read or store the Markdown artifact body in FTS projection.
- **Recommendation documents**
  - One document per recommendation lane, with `document_id = recommendation_lanes.lane_id`.
  - Index lane ref, kind, title, profile, rationale, confidence/rationale from lane items, item refs/IDs, run ID, and run-level rationale/assumption summaries from `recommendation_runs.summary_json`.
  - Current and historical runs can be indexed; default action filters prefer current runs unless `includeHistoricalRecommendations: true` is set.

### SQL Query Details

- Use bound parameters for the FTS `MATCH` expression and all filters.
- Build column-scoped MATCH expressions from a tokenized/quoted query; return an empty projection for inputs that tokenize to zero terms in `search-planning-records`.
- Use `bm25(search_documents_fts, ...) AS rank` and `snippet(search_documents_fts, -1, '<mark>', '</mark>', '…', 24) AS snippet` where the runtime supports the automatic column selector. If the test runtime rejects `-1`, use per-column snippets and choose the first highlighted snippet in the row mapper.
- Join `search_documents` to `search_documents_fts` by `(document_type, document_id)` for metadata and filter columns.
- Compute counts by document type from the same FTS/filter predicate used for results.
- `search-items` retrieves ranked IDs first, then calls the projection hydration helper with the ranked ID order, filters, `limit`, `offset`, `includeArchive`, and dependency/epic options.
- For no-query `search-items`, skip FTS `MATCH` and call the projection hydration/listing helper with filters and pagination.

## Files

### Create

- `eforge/extensions/eforge-plan/search/types.ts` — search document type unions, public input/output contracts, snippet/index status types, refresh report types, selected-field unions, and JSON-safe helpers.
- `eforge/extensions/eforge-plan/search/schemas.ts` — TypeBox schemas for `search-items`, `search-planning-records`, snippets, counts, pagination, index status, selected fields, and document type filters.
- `eforge/extensions/eforge-plan/search/query-builder.ts` — tokenization, quoting, column-scoped FTS query construction, query-empty detection, and tests for punctuation/hyphenated IDs.
- `eforge/extensions/eforge-plan/search/documents.ts` — canonical row-to-search-document projection functions, source hash calculation, text normalization, and per-type refresh orchestration.
- `eforge/extensions/eforge-plan/search/maintenance.ts` — `refreshSearchDocuments`, `refreshDirtySearchDocuments`, `rebuildSearchIndex`, `optimizeSearchIndex`, dirty-state clearing, and refresh reports.
- `eforge/extensions/eforge-plan/search/actions.ts` — `searchItemsAction`, `searchPlanningRecordsAction`, action handlers, output mapping, and `searchActions` tuple.
- `eforge/extensions/eforge-plan/search/index.ts` — public exports for actions, search functions, document refresh helpers, maintenance helpers, and types.
- `eforge/extensions/eforge-plan/sqlite/repositories/search-document-projections.ts` — read-only SQL for canonical backlog item, epic, session-plan, and recommendation projection rows used to build FTS documents, plus named row mappers.
- `eforge/extensions/eforge-plan/sqlite/repositories/search-queries.ts` — FTS query SQL, count-by-type queries, dirty-status reads, snippet/rank row mappers, and no raw SQL exports to action handlers.
- `eforge/extensions/eforge-plan/__tests__/sqlite-search-fixtures.ts` — test helpers that seed canonical rows through storage/canonical/projection fixture APIs and call `rebuildSearchIndex()` for search tests.
- `eforge/extensions/eforge-plan/__tests__/sqlite-search-documents.test.ts` — document projection, rebuild idempotency, dirty clearing, source hash, and no session-plan body indexing tests.
- `eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts` — ranked FTS results, snippets, filters, counts, pagination, type filters, and query-builder edge cases.
- `eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts` — extension action dispatch tests for `search-items` and `search-planning-records`, including default/max limits, selected fields, index dirty metadata, and raw payload omission.

### Modify

- `eforge/extensions/eforge-plan/sqlite/types.ts` — add search projection row contracts, FTS hit row types, search refresh report types, search index status type, and search selected-field/page contracts needed by repository helpers.
- `eforge/extensions/eforge-plan/sqlite/repositories/search-documents.ts` — add batch replace/delete helpers, FTS table rebuild helpers, optimize helper, dirty-record list helpers, and stale-document deletion by type/id.
- `eforge/extensions/eforge-plan/sqlite/index.ts` — export search document projection/query repositories and search index status helpers needed by `search/*` and retention-maintenance.
- `eforge/extensions/eforge-plan/projections/types.ts` — add order-preserving compact item hydration input/output types for FTS item search results.
- `eforge/extensions/eforge-plan/projections/items.ts` — expose `hydrateCompactItemSearchResults(store, input)` or equivalent so `search-items` can apply lifecycle/lane filters and return compact item summaries without recomputing lifecycle policy.
- `eforge/extensions/eforge-plan/projections/index.ts` — export the new search hydration helper for the search module.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — remove the legacy in-memory `search-items` schema/handler; keep non-search projections owned by `projections-lifecycle` unchanged.
- `eforge/extensions/eforge-plan/search/actions.ts` — define the FTS-backed `search-items` and `search-planning-records` action schemas, handlers, snippets/counts output, pagination, and dirty-index metadata `[region: fts-search-bounded-actions, SearchItemsInputSchema/SearchItemsOutputSchema/search-items handler and snippets/counts output]`.
- `eforge/extensions/eforge-plan/index.ts` — import `searchActions`, register them immediately after `backlogQueryActions`, add `search-planning-records` to workstation `allowedActions` after `search-items`, and add a console contribution button/form for the all-domain search if a contribution block is added `[region: fts-search-bounded-actions, search action imports and registration after backlogQueryActions registration]`.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — no default change. If implementation adds recommendation-specific search snippets/counts to this file, restrict the edit to a separate search import/action block and do not change freshness or actionability semantics `[region: fts-search-bounded-actions, search-related action wiring only if needed]`.
- `eforge/extensions/eforge-plan/schema.ts` — export shared search result/snippet/index schemas only if action schemas need to be referenced by existing schema barrels; keep search-specific schemas in `search/schemas.ts` when possible.
- `eforge/extensions/eforge-plan/README.md` — update usage/action/storage text for FTS-backed `search-items`, add `search-planning-records`, document snippets/ranking/counts/pagination, and explain dirty-index metadata `[region: fts-search-bounded-actions, search behavior and changed search actions under Usage/Storage model/Actions]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add `SearchSnippet`, `SearchIndexStatus`, `SearchResult`, `SearchPlanningRecordsResponse`, and optional search metadata fields on compact item search rows `[region: fts-search-bounded-actions, action response/search types]`.
- `eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts` — replace search-specific legacy Markdown expectations with SQLite/FTS seeded expectations; leave non-search tests owned by `projections-lifecycle` intact.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert `search-planning-records` registration, output profile, read/write side-effects if selected, and workstation allowlist inclusion; update `search-items` output schema property assertions for additive snippet/count/index fields.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — include `search-planning-records` and FTS search behavior in README action/help assertions.

For temporary coordination markers in shared TypeScript files, use the compiled plan slug:

```ts
// --- eforge:region plan-05-fts-search-bounded-actions ---
// FTS-backed search action imports, registration, or schemas owned by this module.
// --- eforge:endregion plan-05-fts-search-bounded-actions ---
```

Use JSX comment markers if a future workstation view edit adds markup:

```tsx
{/* --- eforge:region plan-05-fts-search-bounded-actions --- */}
{/* Search UI markup owned by this module. */}
{/* --- eforge:endregion plan-05-fts-search-bounded-actions --- */}
```

## Testing Strategy

### Unit Tests

- Query builder tokenization:
  - hyphenated item IDs are tokenized into matchable terms.
  - punctuation-only queries produce no FTS query.
  - quotes, colon characters, boolean operators, and parentheses are escaped or quoted before binding.
  - `searchBody: false` builds a column-scoped query that excludes `body_text` and `summary_text`.
  - `searchBody: true` includes `body_text` and `summary_text`.
- Search document projection:
  - backlog item documents include title, ID, tags, Claim, Evidence, Acceptance Criteria, dependency refs, and epic refs.
  - epic documents include title, ID, tags, summary/body sections, and child item refs.
  - session-plan documents include session, topic, summary, source item/epic/recommendation refs, status, and readiness summary, and exclude Markdown artifact body content.
  - recommendation documents include run ID, lane ID/ref/kind/title/rationale, item refs, and run-level assumptions.
  - source hashes stay identical across repeated projection of unchanged canonical rows.
- Search maintenance:
  - `refreshSearchDocuments()` replaces selected documents and clears matching dirty records.
  - `refreshDirtySearchDocuments()` refreshes only listed dirty records up to the requested limit.
  - `rebuildSearchIndex()` deletes stale documents for rebuilt types and clears global dirty state.
  - `optimizeSearchIndex()` executes the FTS optimize command and returns a report row.
- Row mappers:
  - FTS hit rows map rank numbers, snippets, refs, updated timestamps, and document types.
  - malformed JSON/ref text in search metadata produces an `EforgePlanStoreError` with a stable code.

### Integration Tests

- Seed canonical backlog items, epics, dependencies, session plans, recommendation lanes, lifecycle evidence, queue/build links, and planning tasks through storage/canonical/projection fixture helpers.
- Rebuild the search index, invoke `search-items` with a title query, and assert rank ordering places the title hit before body-only hits.
- Invoke `search-items` with an item ID query and assert ID-only matches are returned.
- Invoke `search-items` with a tag query and assert tag matches are returned without `searchBody: true`.
- Invoke `search-items` with a Claim/Evidence/Acceptance Criteria query and assert no result when `searchBody` is false, then assert the item appears when `searchBody` is true.
- Invoke `search-items` with `epic`, `status`, `lane`, `tags`, `includeArchive`, and `includeDependencies` filters and assert results match projection-hydrated lifecycle/lane fields.
- Invoke `search-items` with `limit: 500` and assert the returned `limit` is `100`.
- Invoke `search-items` with `limit: 1, offset: 1` and assert deterministic second-page output plus `pagination.nextOffset` when more rows exist.
- Invoke `search-planning-records` across all document types and assert `countsByType` includes backlog item, epic, session plan, and recommendation counts.
- Invoke `search-planning-records` with `types: ['session_plan']` and assert only session-plan result records are returned.
- Invoke `search-planning-records` with `fields: ['snippet']` and assert result records include `id`, `type`, `title`, and `snippet`, and omit `rank`, `refs`, and `updatedAt`.
- Mark an item dirty after rebuild, invoke both search actions, and assert `indexDirty: true` plus `indexStatus.dirtyCount > 0` without an implicit rebuild.
- Dispatch actions through the extension registry and assert output schemas accept snippets/counts/index status while raw item bodies, raw recommendation JSON, lifecycle event payloads, and import diagnostics are absent.

## Verification

- [ ] `rebuildSearchIndex(store)` inserts one `search_documents` row and one FTS row for each seeded backlog item, epic, flat session plan, and recommendation lane.
- [ ] Running `rebuildSearchIndex(store)` twice for unchanged seed data leaves the same document row count and clears all dirty records.
- [ ] `search-items` with query equal to a backlog item title returns that item before a body-only match for the same term.
- [ ] `search-items` with query equal to a backlog item ID returns that item when the title does not contain the ID.
- [ ] `search-items` with query equal to a tag returns tagged items when `searchBody` is omitted.
- [ ] `search-items` with an acceptance-criteria-only term returns zero items when `searchBody` is false.
- [ ] `search-items` with the same acceptance-criteria-only term returns the matching item when `searchBody` is true.
- [ ] `search-items` with `epic`, `status`, `lane`, and `tags` filters returns only items matching all supplied filters.
- [ ] `search-items` with `limit: 500` returns `limit: 100` and no more than 100 item rows.
- [ ] `search-items` with `limit: 1, offset: 1` returns one second-page item and `pagination.offset: 1`.
- [ ] `search-items` output contains a snippet with `<mark>` tags for a text query hit.
- [ ] `search-items` output omits backlog item body text for both default input and `searchBody: true` input.
- [ ] `search-items` output contains `indexDirty: true` and `indexStatus.dirtyCount` after a seeded dirty marker exists.
- [ ] `search-planning-records` with a query matching seeded item, epic, session-plan, and recommendation text returns at least one result of each document type.
- [ ] `search-planning-records` returns `countsByType.backlog_item`, `countsByType.epic`, `countsByType.session_plan`, and `countsByType.recommendation` for the all-domain seed.
- [ ] `search-planning-records` with `types: ['epic']` returns only results whose `type` is `epic`.
- [ ] `search-planning-records` with `fields: ['snippet']` returns `id`, `type`, `title`, and `snippet`, and omits `rank`, `refs`, and `updatedAt`.
- [ ] `search-planning-records` with `limit: 500` returns `page.limit: 100` and no more than 100 result rows.
- [ ] Search action dispatch through the extension registry registers `search-items` and `search-planning-records` with `agent-paginated` output profiles.
- [ ] Runtime search paths in `search/*`, `backlog-query-actions.ts`, and `index.ts` do not call `listBacklogItems`, `listBacklogEpics`, `readRecommendationsFromPath`, `listTraceSidecars`, `summarizeProjectTraces`, or `readPlanningTaskWorkflowIndex`.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/sqlite-search-documents.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-fts-search.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-search-actions.test.ts` exits 0.

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
