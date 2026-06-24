# Importer Reporting

## Architecture Reference

This module implements the `importer-reporting` module from the architecture, especially the **Import contract**, **Shared data model**, **Lifecycle and actionability semantics**, **FTS freshness contract**, and **Action/UI contract** sections.

Key constraints from architecture:
- The importer is a one-time best-effort migration path from legacy private eforge-plan Markdown/JSON/session-plan/trace/queue/monitor artifacts into the SQLite store created by `storage-schema`.
- `dryRun` defaults to `true`; dry-runs write no SQLite rows and do not create or replace the SQLite database.
- Repeated apply imports use stable domain IDs and stable diagnostic IDs so canonical rows are idempotent.
- `replaceExisting: true` is required before deleting/replacing an existing SQLite store; dry-runs with `replaceExisting` report intent without deleting files.
- Import diagnostics include orphaned refs, missing files, duplicate IDs, invalid trace rows, stale recommendation refs, unreadable artifacts, and unsupported legacy payloads.
- Import normalizes legacy artifacts into repository upsert inputs owned by `storage-schema`; projection/search modules consume only canonical rows and diagnostics.
- Legacy Markdown/JSON readers are importer-only after SQLite is canonical; this module must not create a normal runtime fallback to file-backed reads.
- Session-plan Markdown remains the build artifact body; SQLite stores only queryable metadata, provenance, joins, summary, hashes, and downstream state.
- Import must mark affected search documents dirty through the storage layer; ranked search/rebuild actions remain owned by `fts-search-bounded-actions`.
- Keep engine/kernel boundaries intact: do not import eforge engine internals or implement queue scheduling/recovery behavior.
- Keep new implementation files under 600 lines; TypeScript files over 300 lines need durable semantic `// --- eforge:region <slug> ---` markers.

## Scope

### In Scope

- `runPlanningStoreImport(cwd, options)` with dry-run-first defaults, include filters, destructive replacement gating, source fingerprinting, bounded report output, and stable diagnostics.
- Legacy backlog item/epic import from:
  - `.eforge/storage/extensions/eforge-plan/backlog/items/*.md`
  - `.eforge/storage/extensions/eforge-plan/backlog/epics/*.md`
  - compatible legacy `.backlog/items/*.md`
  - compatible legacy `.backlog/epics/*.md`
- Backlog import of explicit user-authored `status`, tags, extracted sections, body/frontmatter hashes, epic refs, dependency refs, unresolved dependency preservation, and duplicate private/legacy ID diagnostics.
- Session-plan metadata/provenance import from `.eforge/session-plans/*.md`, including frontmatter, topic/status/type/depth/profile/agent profile, readiness summary, summary text, artifact body hash, source item/epic/recommendation refs, and many-to-many joins.
- Trace sidecar import from `.eforge/storage/extensions/eforge-plan/traces/*.json`, including promoted session plans, queue PRDs, build runs, build sessions, landing results, last-event metadata, item-plan joins, queue/build/landing rows, lifecycle events, and durable lifecycle evidence.
- Planning task workflow import from `.eforge/storage/extensions/eforge-plan/planning-tasks/index.json`, including task rows, selection provenance joins, parent task refs, requested sections, compact summaries, and prunable raw request/result payloads when available.
- Recommendation import from `.eforge/storage/extensions/eforge-plan/recommendations/current.json` and `status.json`, including one stable recommendation run, lanes, lane items, raw model JSON, summary/freshness JSON, lane provenance, and stale reference diagnostics.
- Queue/build/session/landing import from default local queue artifacts:
  - `.eforge/queue/*.md`
  - `.eforge/queue/waiting/*.md`
  - `.eforge/queue/failed/*.md`
  - `.eforge/queue/skipped/*.md`
  - `.eforge/queue/failed/*.recovery.json`
  - `.eforge/queue-locks/*.lock`
- Monitor DB import from `.eforge/monitor.db` by read-only SQLite queries against `runs` and `events`, with run/session rows, lifecycle events, and best-effort item correlation through imported trace/session/queue source refs.
- Public extension action `import-planning-store` with bounded output and clear side effects.
- README help text for the SQLite import workflow and destructive replacement flag.
- Tests for import mapping, diagnostics, idempotency, destructive replacement, trace/session/queue correlation, recommendation lane mapping, planning task mapping, and action registration/output bounds.

### Out of Scope

- The SQLite schema, migrations, pragma setup, and repository primitives implemented by `storage-schema`.
- Runtime capture/update/promote/handoff rewrites after the store is canonical.
- SQL-derived board lanes, lifecycle projections, recommendation actionability, duplicate planning policy, or associated plan/build link projections.
- Ranked FTS search, snippet generation, pagination search actions, FTS rebuild/optimize actions, or search response schemas.
- Retention compaction, archive deletion, VACUUM, or maintenance action wiring.
- Long-term dual-read compatibility after import.
- Remote SQL, Postgres, synchronization, team workflow semantics, embeddings, or vector search.
- Workstation React UI changes. The new action is exposed through extension contribution/action discovery; later workstation integration can call it.
- Direct `eforge-plugin/` or `packages/pi-eforge/` edits. Both integrations discover extension actions generically, so this module does not add integration-package-specific commands or skills.

## Implementation Approach

### Overview

Add an importer package under `eforge/extensions/eforge-plan/importer/`. The importer runs in two phases:

1. **Collect and normalize** legacy artifacts into an in-memory `LegacyImportGraph`. This phase reads files, parses JSON/Markdown/session plans, computes source hashes, resolves local references where possible, and records deterministic diagnostics. It never opens the SQLite store with `create: true` and never mutates files.
2. **Apply** the graph to SQLite only when `dryRun === false`. Apply optionally removes the existing SQLite database files when `replaceExisting === true`, opens the store through `openEforgePlanStore(cwd, { create: true, migrate: true, validateFts: true })`, and writes all repository upserts inside one transaction.

The apply order is deterministic and FK-aware:

1. Epics, epic tags, and epic sections.
2. Backlog items, item tags, item sections, and item dependencies.
3. Session-plan metadata plus session-plan item/epic joins.
4. Recommendation run, lanes, and lane items.
5. Planning task rows and task provenance joins.
6. Queue PRDs, build runs, build sessions, and landing links.
7. Lifecycle events and lifecycle evidence.
8. Import run and diagnostics.
9. Search dirty markers for imported backlog items, epics, session plans, and recommendations.

Dry-run reports and apply reports share the same report shape. Public action output is bounded with `diagnosticLimit` and includes `diagnosticCount` plus `diagnosticsOmitted` so large imports do not return unbounded payloads. Apply still records every diagnostic row in SQLite with deterministic IDs.

### Key Decisions

1. **Collector modules own legacy parsing; repository modules own SQLite writes.** Each collector returns typed normalized records and diagnostics. Only `apply-import.ts` calls `storage-schema` repository functions. This keeps importer parsing independent from SQL row shapes.
2. **Use visible-source precedence but diagnose duplicates.** Private backlog Markdown takes precedence over same-ID `.backlog` Markdown for canonical item/epic upserts. Duplicate private/legacy IDs emit `duplicate-id` diagnostics that identify both paths.
3. **Preserve unresolved refs instead of dropping them.** Dependency refs, recommendation refs, trace item refs, task selection refs, and session-plan source refs are kept in `*_ref` columns even when the referenced canonical row is missing. Missing internal refs emit `orphan-ref`, `missing-file`, or `stale-recommendation-ref` diagnostics.
4. **Use deterministic IDs for imported derived rows.** Examples: `legacy-recommendations:${rawModelSha}`, `runId:laneKind:laneRef`, `trace:${itemId}:queue:${prdId}`, `monitor:event:${eventRowId}`, and `import-diagnostic:${runId}:${sha256(canonicalDiagnostic)}`. Replaying the same import updates rows instead of appending duplicates.
5. **Do not depend on engine internals.** Queue PRD files are parsed with local YAML/Markdown helpers and lightweight frontmatter extraction. Monitor DB rows are read directly with `node:sqlite`. This avoids adding `@eforge-build/engine` as a runtime dependency of the extension package.
6. **Map lifecycle evidence conservatively.** Trace/queue/monitor evidence stores raw status plus a reason code; lifecycle state maps only when the source status is unambiguous (`planned`, `submitted`, `queued`, `build`, `pr-open`, `merged`, `shipped`, `failed`, `partial`). Ambiguous states remain explainable through `status`, `summary`, and `links_json` for later SQL projections.
7. **Session-plan body is hashed, not canonicalized into SQLite.** Import stores `artifact_body_hash`, summary text, readiness summary, source refs, path, and frontmatter JSON. Markdown body content remains in `.eforge/session-plans/*.md`.
8. **Search freshness is dirty-marker based in this module.** Importer marks affected documents dirty via `markSearchIndexDirty()` and `search_index_state`. The later FTS module owns document projection, rebuild, ranking, and snippets.
9. **Destructive replacement deletes only the eforge-plan SQLite files.** The deletion target is `resolveEforgePlanStorePath(cwd)` plus `-wal` and `-shm`. Legacy Markdown/JSON/session-plan/queue/monitor artifacts are never deleted by this module.
10. **Action output is additive.** Existing `import-legacy-backlog` stays registered for compatibility. The new `import-planning-store` action is the SQLite importer and does not change the old action’s schema or behavior.

### Import Report Shape

Implement these public TypeScript contracts in `importer/types.ts` and map them to TypeBox schemas in `importer/actions.ts`:

```ts
export const PLANNING_STORE_IMPORT_INCLUDES = [
  'backlog',
  'epics',
  'sessionPlans',
  'traces',
  'queue',
  'monitor',
  'recommendations',
  'planningTasks',
] as const;

export interface RunPlanningStoreImportOptions {
  dryRun?: boolean;
  replaceExisting?: boolean;
  include?: PlanningStoreImportInclude[];
  diagnosticLimit?: number;
}

export interface PlanningStoreImportReport {
  schemaVersion: 1;
  dryRun: boolean;
  applied: boolean;
  replacedExisting: boolean;
  storePath: string;
  include: PlanningStoreImportInclude[];
  sourceFingerprint: string;
  counts: Record<string, number>;
  diagnosticCount: number;
  diagnostics: ImportDiagnostic[];
  diagnosticsOmitted: number;
}
```

The underlying graph can keep full diagnostics; `toPublicImportReport(graph, limit)` truncates only the returned array.

### Legacy Source Mapping Details

#### Backlog items and epics

- Scan private and legacy Markdown roots independently to detect duplicate IDs.
- Parse frontmatter/body with existing `parseMarkdownRecord()` and normalize with `normalizeBacklogItem()` / `normalizeBacklogEpic()`.
- Upsert epics before items.
- Store:
  - `user_status` from frontmatter `status`
  - `frontmatter_json` from parsed frontmatter
  - `body_sha256` and `record_sha256` using `sha256(canonicalJson({ frontmatter, body }))`
  - `import_origin` as `private-markdown` or `legacy-backlog`
  - `import_path` as project-relative path
- Replace tags and sections for each row using extracted Markdown sections.
- Upsert dependencies with `dependency_ref` always set. Set `resolved_dependency_item_id` only when the dependency ID is imported or already present in the target store. Emit `orphan-ref` for missing internal dependency refs.
- Preserve `epic_ref`; set `epic_id` only when the epic ID is imported or already present.

#### Session plans

- Scan `.eforge/session-plans/*.md` directly instead of using `listSessionPlans()` so invalid files produce diagnostics instead of being silently skipped.
- Parse with `parseSessionPlan()` from `@eforge-build/input`.
- Use `resolveSessionPlanStorageRoot()` for path containment and `getReadinessDetail()` for `readiness_summary_json`.
- Derive `summary_text` from `## Executive Summary`, then `## Context`, then the first non-empty body paragraph, capped to a small internal summary string.
- Extract source refs from `plan.eforge_plan` directly:
  - `source_item_ids` / legacy singular `source_item_id`
  - `source_epic_ids` / legacy singular `source_epic_id`
  - `source_recommendation_ref`
  - `promoted_at`
- Link source items/epics with provenance:
  - `recommendation-lane-plan` when `source_recommendation_ref` is present
  - `selected-promote` when imported from session-plan metadata without a recommendation ref
- Emit `missing-file` for trace or queue references to session IDs whose Markdown file does not exist.

#### Trace sidecars

- Scan `.eforge/storage/extensions/eforge-plan/traces/*.json` per file and parse with `TraceSidecarSchema` via `safeParseWithSchema()` so one invalid file does not abort the import.
- For invalid JSON or schema mismatches, emit `invalid-trace-row` with the trace path.
- Upsert minimal session-plan rows for trace-promoted sessions that have no parsed Markdown file, preserving the trace path/status and emitting a `missing-file` diagnostic for the missing Markdown artifact.
- Link each trace item to promoted sessions with provenance `imported-trace` and source task/recommendation refs unset.
- Upsert queue/build/landing rows from trace arrays and create lifecycle evidence rows keyed by item ID plus trace entry key.
- Record a `lifecycle_events` row for `lastEvent` when present, using `trace:${itemId}:last-event:${sha}`.

#### Recommendations

- Read `current.json` through `readRecommendationsFromPath()` and catch parse/schema errors as `unsupported-legacy-payload`.
- Read derived status/freshness through `readDerivedRecommendationStatus()` so invalid status sidecars become reportable stale metadata rather than importer crashes.
- Use a stable recommendation run id `legacy-recommendations:${rawModelSha}`; set `is_current = 1` for the imported current model.
- Store raw model JSON, `summarizeRecommendations(model)` in `summary_json`, and derived status in `freshness_json`.
- Map recommendation arrays:
  - `activeWork`, `readyCandidates`, and `recommendedNextSequence`: one lane per entry, one member lane item.
  - `safeParallelizableGroups`: one lane per group, member lane items in group order.
  - `blockedChains`: one lane per chain, `blocked` lane items for `itemIds`, `blocker` lane items for `blockedBy`.
- Preserve item refs in lane items even when unresolved; set nullable `item_id` only for known imported/existing items.
- Emit `stale-recommendation-ref` for unknown item refs, unknown epic refs in group metadata, and closed item/epic refs when their user status is imported as `shipped`, `stale`, or `superseded`.

#### Planning tasks

- Read `planning-tasks/index.json` with a raw JSON parser plus `PlanningTaskWorkflowIndexSchema` validation so malformed indexes emit `unsupported-legacy-payload` instead of returning an empty index.
- Upsert each entry into `planning_tasks`:
  - `task_id`, `parent_task_id`, `purpose`, `source_fingerprint`, `requested_sections_json`, `selection_summary_json`, `raw_request_json`, `created_at`, `applied_at`
  - `status_snapshot` defaults to `indexed` because daemon task status is owned by the daemon task API, not this sidecar.
- Populate `planning_task_items`, `planning_task_epics`, and `planning_task_recommendation_refs` from selection fields.
- Emit `orphan-ref` for missing selected items/epics while preserving source refs.

#### Queue artifacts

- Scan default `.eforge/queue` roots for Markdown PRDs in root, `waiting`, `failed`, and `skipped` directories.
- Derive PRD id from filename, status from directory, and running status from a live `.eforge/queue-locks/<prdId>.lock` file containing a numeric PID.
- Parse frontmatter with existing Markdown/YAML helpers instead of engine `prd-queue` imports.
- Extract source item/epic/recommendation refs from `eforge_plan` frontmatter when present and from legacy text markers such as `Backlog item id:` as a fallback.
- Upsert `queue_prds` with source path, status, timestamps from frontmatter when available, compact title/status summary, and import fingerprint.
- For failed queue PRDs, read matching `<prdId>.recovery.json` when present. Store failure summaries as lifecycle evidence and landing/PR evidence when the sidecar includes accepted-success landing metadata.
- Emit `unreadable-artifact` for unreadable queue/recovery files and `unsupported-legacy-payload` for malformed recovery JSON.

#### Monitor DB

- If `.eforge/monitor.db` exists, open it read-only with `node:sqlite` and query only the `runs` and `events` tables after verifying they exist.
- Upsert `build_runs` for monitor `runs.id`; upsert `build_sessions` when `session_id` is present.
- Insert `lifecycle_events` for persisted events using stable keys `monitor:event:${id}` and parsed event data.
- Correlate events to item refs using imported trace keys, session-plan source refs, queue source refs, and event fields (`source`, `filePath`, `path`, `prdId`, `id`, `sessionId`, `runId`, `featureBranch`, `commitSha`).
- For correlated events, create lifecycle evidence and queue/build/landing rows with compact links.
- Emit `unreadable-artifact` for a monitor DB open/query failure and `unsupported-legacy-payload` for event rows with invalid JSON payloads.

## Files

### Create

- `eforge/extensions/eforge-plan/importer/types.ts` — import include literals, importer options, report/diagnostic contracts, normalized graph record types, count keys, and public report shape.
- `eforge/extensions/eforge-plan/importer/stable.ts` — deterministic JSON canonicalization wrappers, SHA-256 helpers, stable ID helpers, timestamp normalization, path-to-project-relative helpers, and bounded text summary helpers.
- `eforge/extensions/eforge-plan/importer/diagnostics.ts` — diagnostic builders, stable diagnostic ID generation, diagnostic sorting, and public report truncation helpers.
- `eforge/extensions/eforge-plan/importer/legacy-backlog.ts` — private/legacy backlog Markdown scanning, duplicate detection, item/epic normalization, tags/sections/dependency extraction, and backlog diagnostics.
- `eforge/extensions/eforge-plan/importer/legacy-session-plans.ts` — `.eforge/session-plans/*.md` scanning, session plan parsing, readiness/summary/hash extraction, and source-ref join normalization.
- `eforge/extensions/eforge-plan/importer/legacy-traces.ts` — trace sidecar scanning, per-file validation, trace entry normalization, lifecycle evidence derivation, and trace diagnostics.
- `eforge/extensions/eforge-plan/importer/legacy-recommendations.ts` — recommendation current/status reading, run/lane/lane-item normalization, stale ref diagnostics, and summary/freshness JSON mapping.
- `eforge/extensions/eforge-plan/importer/legacy-planning-tasks.ts` — planning task workflow index parsing, task/provenance normalization, and selection diagnostics.
- `eforge/extensions/eforge-plan/importer/legacy-queue.ts` — queue directory/lock/recovery sidecar scanning, PRD source-ref extraction, queue PRD normalization, and queue diagnostics.
- `eforge/extensions/eforge-plan/importer/legacy-monitor.ts` — read-only monitor DB scanning, run/event extraction, event JSON validation, and best-effort event-to-item correlation.
- `eforge/extensions/eforge-plan/importer/collect.ts` — include normalization, collector orchestration, cross-source reference catalog, source fingerprint creation, and `LegacyImportGraph` assembly.
- `eforge/extensions/eforge-plan/importer/apply-import.ts` — destructive replacement implementation, transactional repository upserts, import run/diagnostic recording, and search dirty marker writes.
- `eforge/extensions/eforge-plan/importer/run-import.ts` — public `runPlanningStoreImport(cwd, options)` entrypoint combining collect, dry-run reporting, apply, and store close handling.
- `eforge/extensions/eforge-plan/importer/actions.ts` — TypeBox input/output schemas and `importPlanningStoreAction` extension action.
- `eforge/extensions/eforge-plan/importer/index.ts` — public exports for the importer API and action.
- `eforge/extensions/eforge-plan/__tests__/sqlite-importer-reporting.test.ts` — focused importer/reporting tests for dry-run, apply, diagnostics, idempotency, replacement, and canonical row mapping.
- `eforge/extensions/eforge-plan/__tests__/sqlite-importer-artifacts.test.ts` — representative legacy fixture tests for session plans, traces, queue artifacts, monitor DB rows, recommendations, and planning tasks.
- `eforge/extensions/eforge-plan/__tests__/sqlite-importer-action.test.ts` — extension action registration/schema/output-bound tests for `import-planning-store`.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — import `importPlanningStoreAction`, register it immediately after `importLegacyBacklogAction`, and add a contribution action-form entry next to the existing legacy import entry `[region: importer-reporting, next to the current import-legacy-backlog action/import/registration/contribution blocks]`.
- `eforge/extensions/eforge-plan/README.md` — document the SQLite import workflow, dry-run default, include filters, destructive replacement flag, diagnostics, and the distinction between `import-legacy-backlog` and `import-planning-store` `[region: importer-reporting, under "## Storage model" and in the action reference near import actions]`.

If builders need temporary source coordination markers in `index.ts`, use the compiled plan slug:

```ts
// --- eforge:region plan-02-importer-reporting ---
// import-planning-store action import/registration/contribution entry
// --- eforge:endregion plan-02-importer-reporting ---
```

Do not use `importer-reporting` as a cleanup-targeted source marker; it is the module ID for plan annotations only.

## Testing Strategy

### Unit Tests

- Include normalization:
  - omitted `include` expands to all importer categories in deterministic order.
  - duplicate include values collapse to one entry.
  - invalid include values fail TypeBox action validation.
- Diagnostic helpers:
  - every diagnostic code from the architecture is accepted.
  - stable diagnostic IDs are identical for identical canonical diagnostic fields.
  - public report truncation returns `diagnosticCount` and `diagnosticsOmitted` values matching the full diagnostic array length.
- Backlog collectors:
  - private Markdown is selected over same-ID legacy Markdown.
  - duplicate private/legacy IDs emit `duplicate-id` diagnostics.
  - invalid frontmatter emits `unsupported-legacy-payload` without mutating the store.
  - dependencies preserve unresolved refs and emit `orphan-ref`.
- Session-plan collector:
  - invalid session plan frontmatter emits `unsupported-legacy-payload`.
  - `eforge_plan.source_item_ids`, singular legacy source fields, and `source_recommendation_ref` are extracted.
  - body hashes change when artifact body content changes.
- Trace collector:
  - malformed JSON and schema-invalid sidecars emit `invalid-trace-row` per file.
  - promoted plans, queue PRDs, build runs, build sessions, landing results, and last events produce deterministic normalized keys.
- Recommendation collector:
  - each recommendation array maps to expected lane kind and lane item roles.
  - unknown item/epic refs emit `stale-recommendation-ref` and remain preserved as refs.
- Planning task collector:
  - malformed index JSON emits `unsupported-legacy-payload`.
  - selection refs map to task item/epic/recommendation ref joins.
- Queue/monitor collectors:
  - queue directory status and numeric lock PID map to queue status.
  - monitor events with invalid JSON emit `unsupported-legacy-payload`.

### Integration Tests

- Dry-run default:
  - create representative legacy artifacts.
  - call `runPlanningStoreImport(cwd, {})`.
  - assert `dryRun: true`, `applied: false`, nonzero counts, expected diagnostics, and no SQLite database file at `resolveEforgePlanStorePath(cwd)`.
- Apply import:
  - call `runPlanningStoreImport(cwd, { dryRun: false })`.
  - open the SQLite store and assert imported epics, items, tags, sections, dependencies, session plans, session-plan joins, recommendation lanes/items, planning tasks, queue/build rows, lifecycle evidence, import run, import diagnostics, and search dirty rows exist.
- Idempotency:
  - run the same apply import twice.
  - assert canonical table row counts for backlog items, epics, dependencies, session plans, joins, recommendation lanes/items, planning tasks, queue/build rows, landing links, and lifecycle evidence are unchanged after the second run.
- Destructive replacement:
  - seed a store with an extra row not present in legacy input.
  - run apply import without `replaceExisting` and assert the extra row remains.
  - run apply import with `replaceExisting: true` and assert the extra row is absent after import.
- Transaction rollback:
  - introduce one artifact that triggers a repository constraint failure during apply.
  - assert no partially imported rows remain after the rejected import.
- Session-plan many-to-many import:
  - create two session plans linked to the same item and one plan linked to multiple items.
  - assert `session_plan_items` contains all unique joins with imported provenance.
- Trace/queue/build correlation:
  - create trace sidecars and monitor events for a recommendation-planned item handed off to a running build.
  - assert item -> session plan -> queue/build/run links are represented through session-plan joins, queue/build rows, and lifecycle evidence.
- Recommendation import:
  - create `current.json` with active, ready, next sequence, safe parallel, and blocked chain entries.
  - assert lane kinds, lane refs, item roles, sequence values, and stale-ref diagnostics.
- Action registration:
  - register the extension with the recorder and dispatch `import-planning-store` with omitted input.
  - assert the action returns the bounded report schema and the action ID appears in contribution registration.

## Verification

- [ ] `runPlanningStoreImport(cwd, {})` returns `dryRun: true`, `applied: false`, and leaves `eforge-plan-private.sqlite` absent for a temp project with only legacy artifacts.
- [ ] `runPlanningStoreImport(cwd, { dryRun: false })` creates `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite` and records one import run row.
- [ ] A duplicate item ID present in private backlog Markdown and `.backlog/items` emits one `duplicate-id` diagnostic that names both project-relative paths.
- [ ] A dependency on a missing item inserts an `item_dependencies.dependency_ref` row with `resolved_dependency_item_id` null and emits `orphan-ref`.
- [ ] A malformed trace JSON file emits `invalid-trace-row` and does not block valid trace files in the same directory.
- [ ] A recommendation item ref that is absent from imported backlog rows emits `stale-recommendation-ref` and inserts a lane item preserving `item_ref`.
- [ ] A session plan with two `source_item_ids` creates two `session_plan_items` rows for the same `session`.
- [ ] The same item linked by two session plans creates two `session_plan_items` rows for that item.
- [ ] A trace sidecar with a promoted session, queued PRD, running build session, and PR landing result creates rows in `session_plans`, `session_plan_items`, `queue_prds`, `build_sessions`, `landing_links`, and `lifecycle_evidence`.
- [ ] A monitor DB with one run and one valid lifecycle event imports one `build_runs` row and one `lifecycle_events` row.
- [ ] Running the same apply import twice leaves canonical row counts unchanged for backlog items, epics, dependencies, session plans, session-plan joins, recommendation lanes/items, planning tasks, queue/build rows, landing links, and lifecycle evidence.
- [ ] `replaceExisting: true` with `dryRun: false` removes a pre-seeded row that is absent from the legacy input.
- [ ] `replaceExisting: true` with default dry-run leaves the pre-existing SQLite file bytes in place.
- [ ] The public action output caps returned diagnostics at `diagnosticLimit` and reports the omitted count.
- [ ] The public action schema defaults `dryRun` behavior when the input object is empty.
- [ ] `import-planning-store` is registered immediately after `import-legacy-backlog` in `index.ts`.
- [ ] README text names `import-planning-store`, documents dry-run default input `{}`, documents apply input `{ "dryRun": false }`, and documents destructive replacement input `{ "dryRun": false, "replaceExisting": true }`.
- [ ] `pnpm --filter @eforge-build/eforge-plan type-check` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/sqlite-importer-reporting.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-importer-artifacts.test.ts eforge/extensions/eforge-plan/__tests__/sqlite-importer-action.test.ts` exits 0.

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
