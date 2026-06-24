---
title: SQLite-backed eforge-plan store
created: 2026-06-24
depends_on: ["clean-up-the-eforge-plan-workstation"]
stack_parent: clean-up-the-eforge-plan-workstation
---

# SQLite-backed eforge-plan store

## Problem / Motivation

eforge-plan currently relies on scattered Markdown, frontmatter, JSON sidecars, session-plan files, trace sidecars, queue/build/session/landing records, and recommendation artifacts to reconstruct private planning state. This makes backlog records, epics, dependencies, recommendations, planning tasks, session-plan provenance, lifecycle evidence, queue/build/session links, and search difficult to query through one canonical local model.

This work creates a SQLite-first private planning store so workstation/planning state is queryable, bounded, and canonical while session-plan Markdown remains the build artifact.

## Goal

Migrate eforge-plan private planning state to a canonical SQLite database with typed store/repository APIs, SQL-backed projections, lifecycle/actionability evidence, FTS5 search, and a best-effort one-time importer for existing local dogfooding data.

## Approach

- Make SQLite authoritative immediately after initialization/import.
- Keep session-plan Markdown as the canonical build artifact body only.
- Store all source item IDs, source epic IDs, source recommendation refs, planning task linkage, submitted/handoff state, queue PRD, build run/session, PR/landing, and item progress state in SQLite.
- Preserve each backlog item row’s explicit user-authored status as metadata.
- Compute effective lifecycle/status from linked nonterminal plans, submitted/queued/running builds, PR-open results, merged/landed results, failed runs, and partial multi-item plans.
- Model item-plan relationships explicitly as many-to-many joins so lane-generated plans, selected-item plans, and multi-item plans preserve provenance.
- Treat recommendation lane Plan records as lane-provenance records.
- Treat selected Plan/Promote records as explicit item-provenance records.
- Detect duplicate direct planning calls for item sets already covered by nonterminal plan/task/build and reject, reuse, or de-duplicate according to a single policy.
- Provide dry-run diagnostics by default for import.
- Use stable-ID upserts so repeated imports are idempotent.
- Require an explicit flag for destructive replacement of an existing SQLite store.
- Return compact projections from public/contribution list actions with defaults, maximum limits, snippets, counts, filters, selected fields, and pagination.
- Remove broad unbounded raw reads or mark them debug-only.
- Implement FTS5 search first with ranked results, snippets, filters, and pagination.
- Reserve optional embedding/vector tables for later without making them part of acceptance.
- Store durable lifecycle evidence rows/links so board lanes and recommendation suppression can explain why an item is planned, active, PR-open, merged, failed, partial, or shipped.
- Never silently auto-truncate canonical backlog items, epics, dependencies, session-plan metadata, item-plan joins, current recommendation/actionability state, or current lifecycle state.
- Allow explicit, observable pruning/archiving for raw lifecycle event history, old planning task payloads/results, superseded recommendation runs, verbose import reports, and diagnostic snapshots.
- Preserve enough summarized evidence after pruning/archiving to explain current board/search/actionability projections.
- Keep database access behind typed store/repository modules so a future alternate backend is not made impossible.
- Do not implement remote SQL, Postgres, or synchronization semantics in this plan.
- Keep engine/kernel boundaries intact.
- Treat this as an extension/workstation storage concern, not an eforge engine feature.
- Keep Claude Code plugin and Pi integration behavior aligned for user-facing eforge-plan capabilities.
- Suggested implementation sequence:
  1. Add the isolated SQLite store/schema/migration layer.
  2. Add importer/reporting.
  3. Add SQL projection helpers.
  4. Swap read paths for board/recommendation/search/actions.
  5. Remove or quarantine legacy broad reads.
- Expected architecture shape:
  - Storage layer: an eforge-plan-private SQLite database with schema versioning, migrations, pragma setup, and transaction helpers.
  - Domain tables: `backlog_items`, `epics`, `item_dependencies`, `recommendation_runs`, `recommendation_lanes`, `recommendation_lane_items`, `planning_tasks`, `session_plans`, `session_plan_items`, lifecycle events/evidence, `queue_prds`, build runs/build sessions/landing links, and derived projection/query helpers.
  - FTS layer: FTS5 virtual tables/triggers or rebuild helpers for backlog items, epics, session-plan summaries, and recommendation text.
  - Import layer: legacy readers normalize existing Markdown/frontmatter/JSON/sidecar/session-plan/build traces into stable upserts and diagnostics.
  - Projection layer: board lanes, recommendation actionability, item effective lifecycle, active build linkage, duplicate planning detection, and agent-facing compact list/read responses are SQL queries with hard limits.
  - Retention/maintenance layer: canonical planning records are retained, while high-volume derived/history data has explicit compaction policies plus SQLite maintenance helpers such as FTS optimize/rebuild and VACUUM where appropriate.
  - UI/action layer: existing eforge-plan workstation and extension actions consume typed projections rather than raw records.
- Likely impacted areas include:
  - `packages/pi-eforge/`
  - `eforge-plugin/`
  - eforge-plan private storage modules
  - contribution/action handlers
  - workstation/server/UI surfaces
  - tests
- Assumptions to validate early:
  - eforge-plan remains local and single-developer focused, so SQLite is an appropriate default store and does not need multi-user synchronization semantics.
  - Existing private Markdown/JSON data is useful enough to justify a best-effort importer, but not authoritative enough to require permanent compatibility.
  - FTS5 is available in the selected SQLite runtime or can be required/validated at startup.
  - Store growth can be controlled with explicit retention/compaction of high-volume history without losing canonical planning records or current-state explainability.
  - All current workstation/action use cases can be served by compact projections rather than full raw records.
- Key risks to watch:
  - Data loss during migration.
  - Scope creep into embeddings.
  - Scope creep into team workflows.
  - Scope creep into long-term dual compatibility.
  - Lifecycle projection bugs.
  - SQLite/FTS runtime support.
  - Unbounded legacy payloads remaining reachable.
  - Plugin/Pi integration drift.
  - Oversized schema/import/projection modules.

## Scope

In scope:

- SQLite schema initialization and forward migration mechanics.
- Typed store/repository APIs for item queries.
- Typed store/repository APIs for epic queries.
- Typed store/repository APIs for recommendation queries.
- Typed store/repository APIs for planning task queries.
- Typed store/repository APIs for session-plan queries.
- Typed store/repository APIs for lifecycle queries.
- Typed store/repository APIs for queue/build correlation queries.
- Typed store/repository APIs for search queries.
- One-time best-effort importer for this repository’s existing dogfooding data from private eforge-plan Markdown/JSON storage.
- One-time best-effort importer for session-plan files.
- One-time best-effort importer for trace sidecars.
- One-time best-effort importer for queue/build/session/landing records.
- One-time best-effort importer for recommendation artifacts.
- Idempotent dry-run/report import mode.
- Diagnostics for orphaned legacy data.
- Diagnostics for invalid legacy data.
- Diagnostics for duplicate legacy data.
- Explicit destructive replacement mode.
- SQL-derived board lanes.
- SQL-derived recommendation actionability.
- SQL-derived item effective lifecycle/status.
- SQL-derived active build linkage.
- SQL-derived duplicate planning suppression/reuse.
- SQL-derived associated plan/build links.
- Bounded SQL-backed agent contribution projections with limits, selected fields, snippets, counts, and pagination.
- SQLite FTS5 search across backlog item titles.
- SQLite FTS5 search across backlog item IDs.
- SQLite FTS5 search across backlog item tags.
- SQLite FTS5 search across backlog item claims/evidence.
- SQLite FTS5 search across backlog item acceptance criteria.
- SQLite FTS5 search across epics.
- SQLite FTS5 search across session-plan summaries.
- SQLite FTS5 search across recommendation text.

Out of scope for the first implementation:

- Long-term dual-write compatibility.
- Backward-compatible legacy Markdown/JSON read path after import.
- Embedding/vector search.
- Team/project-management features beyond the local single-developer eforge-plan workstation focus.
- Remote SQL configuration.
- Postgres configuration.
- Multi-user synchronization.
- Implementing a future backend.

## Acceptance Criteria

- SQLite schema initializes reliably in a clean eforge-plan private storage directory.
- SQLite schema migrations run reliably in a clean eforge-plan private storage directory.
- SQLite is canonical for backlog items.
- SQLite is canonical for epics.
- SQLite is canonical for dependencies.
- SQLite is canonical for recommendation runs.
- SQLite is canonical for recommendation lanes.
- SQLite is canonical for recommendation lane items.
- SQLite is canonical for planning task records.
- SQLite is canonical for session-plan metadata/provenance.
- SQLite is canonical for item-plan joins.
- SQLite is canonical for lifecycle evidence.
- SQLite is canonical for queue/build/session links.
- SQLite is canonical for recommendation/actionability projections.
- Session-plan Markdown remains a build artifact.
- Session-plan provenance is queryable in SQLite rather than reconstructed from sidecars.
- Session-plan downstream state is queryable in SQLite rather than reconstructed from sidecars.
- Backlog board lanes are derived from SQL joins.
- Recommendation actionability is derived from SQL joins.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate already planned items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate submitted items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate queued items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate running items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate PR-open items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate merged items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate shipped items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate failed items/lanes.
- SQL-derived board lanes and recommendation actionability suppress, de-action, or relocate partial items/lanes.
- Item effective lifecycle/status is projected from session-plan relationships.
- Item effective lifecycle/status is projected from downstream build/lifecycle relationships.
- Explicit backlog status metadata is preserved.
- An item planned from a recommendation lane and handed off to a running build can be queried from item to session plan.
- An item planned from a recommendation lane and handed off to a running build can be queried from item to build session/build run.
- An item planned from a recommendation lane and handed off to a running build no longer appears as an unlinked Inbox candidate.
- Lane Plan semantics are unambiguous.
- Selected Plan semantics are unambiguous.
- Selected Promote semantics are unambiguous.
- Duplicate planning calls are rejected, reused, or de-duplicated for item sets already covered by nonterminal work.
- Agent-facing contribution actions use bounded SQL-backed projections.
- Agent-facing contribution actions provide default limits.
- Agent-facing contribution actions enforce maximum limits.
- Agent-facing contribution actions return selected fields.
- Agent-facing contribution actions return counts.
- Agent-facing contribution actions return snippets.
- Agent-facing contribution actions support filters.
- Agent-facing contribution actions support pagination.
- Broad unbounded payloads are removed or explicit debug-only.
- FTS5 search covers backlog item titles.
- FTS5 search covers backlog item IDs.
- FTS5 search covers backlog item tags.
- FTS5 search covers backlog item claims/evidence.
- FTS5 search covers backlog item acceptance criteria.
- FTS5 search covers epics.
- FTS5 search covers session-plan summaries.
- FTS5 search covers recommendation text.
- FTS5 search returns ranked results.
- FTS5 search returns snippets.
- FTS5 search supports filters.
- FTS5 search supports pagination.
- Store growth is governed by an explicit retention/compaction policy.
- Canonical planning data is not auto-truncated.
- High-volume historical records can be pruned or archived through an observable maintenance path.
- High-volume derived records can be pruned or archived through an observable maintenance path.
- Current lifecycle projections remain explainable after compaction.
- Current actionability projections remain explainable after compaction.
- Current search projections remain explainable after compaction.
- The one-time importer maps existing local dogfooding data into the schema.
- The one-time importer emits diagnostics for orphaned refs.
- The one-time importer emits diagnostics for missing files.
- The one-time importer emits diagnostics for duplicate IDs.
- The one-time importer emits diagnostics for invalid trace rows.
- The one-time importer emits diagnostics for stale recommendation refs.
- The one-time importer supports dry-run/report mode.
- The one-time importer is idempotent by stable IDs.
- The one-time importer requires an explicit destructive flag for replacement.
- Tests cover schema initialization.
- Tests cover schema migration.
- Tests cover import mapping.
- Tests cover import diagnostics.
- Tests cover import idempotency.
- Tests cover item-plan many-to-many joins.
- Tests cover recommendation lane actionability.
- Tests cover active lifecycle projection.
- Tests cover submitted lifecycle projection.
- Tests cover queue/build correlation.
- Tests cover duplicate planning behavior.
- Tests cover FTS ranking.
- Tests cover FTS snippets.
- Tests cover FTS pagination.
- Tests cover bounded contribution action outputs.
- Schema tests create a clean DB.
- Schema tests apply migrations.
- Schema tests verify indexes.
- Schema tests verify constraints.
- Schema tests verify foreign keys.
- Schema tests verify FTS objects.
- Schema tests verify migration idempotency.
- Import fixture tests include representative legacy fixtures for items.
- Import fixture tests include representative legacy fixtures for epics.
- Import fixture tests include representative legacy fixtures for dependencies.
- Import fixture tests include representative legacy fixtures for recommendation lanes.
- Import fixture tests include representative legacy fixtures for session plans.
- Import fixture tests include representative legacy fixtures for trace sidecars.
- Import fixture tests include representative legacy fixtures for invalid refs.
- Import fixture tests include representative legacy fixtures for orphaned refs.
- Import fixture tests assert stable upserts.
- Import fixture tests assert diagnostics.
- Projection tests assert board lane/actionability/status projections for draft cases.
- Projection tests assert board lane/actionability/status projections for ready cases.
- Projection tests assert board lane/actionability/status projections for submitted cases.
- Projection tests assert board lane/actionability/status projections for queued cases.
- Projection tests assert board lane/actionability/status projections for running cases.
- Projection tests assert board lane/actionability/status projections for PR-open cases.
- Projection tests assert board lane/actionability/status projections for merged/landed cases.
- Projection tests assert board lane/actionability/status projections for failed cases.
- Projection tests assert board lane/actionability/status projections for partial cases.
- Projection tests assert board lane/actionability/status projections for shipped cases.
- Search tests assert ranked FTS results across item records.
- Search tests assert ranked FTS results across epic records.
- Search tests assert ranked FTS results across session-plan records.
- Search tests assert ranked FTS results across recommendation records.
- Search tests assert snippets across item records.
- Search tests assert snippets across epic records.
- Search tests assert snippets across session-plan records.
- Search tests assert snippets across recommendation records.
- Search tests assert filters across item records.
- Search tests assert filters across epic records.
- Search tests assert filters across session-plan records.
- Search tests assert filters across recommendation records.
- Search tests assert pagination across item records.
- Search tests assert pagination across epic records.
- Search tests assert pagination across session-plan records.
- Search tests assert pagination across recommendation records.
- Contribution action tests assert default limits.
- Contribution action tests assert maximum caps.
- Contribution action tests assert selected fields.
- Contribution action tests assert counts.
- Contribution action tests assert pagination tokens/offsets.
- Contribution action tests assert broad unbounded payloads are not returned.
- Retention/maintenance tests assert compaction preserves canonical rows.
- Retention/maintenance tests assert compaction preserves current projection explainability.
- Retention/maintenance tests assert compaction prunes or archives eligible historical records.
- Retention/maintenance tests assert compaction prunes or archives eligible derived records.
- Retention/maintenance tests validate FTS maintenance helpers where supported.
- User-facing docs/help text explain the new storage model.
- User-facing docs/help text explain the import workflow.
- User-facing docs/help text explain the retention/compaction policy.
- User-facing docs/help text explain search behavior.
- User-facing docs/help text explain lifecycle/actionability semantics.
- User-facing docs/help text explain any changed actions or commands.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Dogfood the migration by running a dry-run import against the current repository state.
- Inspect dry-run import diagnostics during the dogfood run.
- Import the current repository state into a local SQLite store during the dogfood run.
- Verify during the dogfood run that the motivating active-build item no longer appears as an unlinked Inbox candidate.