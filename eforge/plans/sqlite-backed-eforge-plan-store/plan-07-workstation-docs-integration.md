---
id: plan-07-workstation-docs-integration
name: Update the eforge-plan workstation, user-facing docs/help text, and
  integration parity notes to consume and explain the SQLite-backed store,
  import workflow, search, lifecycle, and retention semantics.
branch: sqlite-backed-eforge-plan-store/workstation-docs-integration
---

# Workstation Docs Integration

## Architecture Reference

This module implements the `workstation-docs-integration` module from the architecture, especially the **Action/UI contract**, **Projection/search contract**, **FTS layer**, **Lifecycle and actionability semantics**, **Retention contract**, **Integration parity**, and **Shared File Registry** sections.

Key constraints from architecture:
- Workstation/browser code consumes bounded extension actions and public action contracts only. It must not import SQLite repositories, call `node:sqlite`, scan `.eforge/storage/extensions/eforge-plan/`, or reconstruct planning state from legacy Markdown/JSON sidecars.
- SQLite-backed board, recommendation, session-plan, lifecycle, search, import, and maintenance behavior is owned by dependency modules. This module renders those action outputs and documents them; it does not implement store/schema, importer, SQL projections, FTS ranking, or compaction policy.
- Session-plan Markdown remains the build artifact body; the workstation treats SQLite session-plan metadata, source refs, lifecycle evidence, and build links as action-projected metadata.
- Workstation reads remain bounded: startup uses `list-board-compact`, `list-planning-artifacts`, `get-recommendations`, `get-roadmap-state`, `list-draft-units`, and `get-store-status`; broad debug reads such as `list-board` stay out of hot paths.
- Search UI uses `search-planning-records` / FTS-backed `search-items` outputs with snippets, counts, pagination, and dirty-index metadata; the browser does not rebuild the index implicitly.
- Store maintenance UI is explicit and observable. The workstation may display status and invoke safe/confirmed maintenance actions, but it does not auto-compact or silently delete/prune data.
- User-facing docs must explain the SQLite store, dry-run import workflow, FTS search behavior, lifecycle/actionability semantics, retention/compaction, and changed action outputs.
- Claude Code and Pi integrations reach eforge-plan capabilities through generic extension contribution discovery/invocation. If an implementation adds host-specific plugin/Pi skill text, both packages must be updated together and the Claude plugin version must be bumped.
- Shared-file edits must use the architecture registry regions. Temporary source coordination markers, if needed, use the compiled slug `plan-07-workstation-docs-integration`, not the module id.

## Scope

### In Scope

- Workstation startup integration for `get-store-status`, including non-blocking status/error handling and a header/status-card summary.
- A workstation store status and maintenance card that renders schema/store/search/retention status and invokes explicit bounded actions through `window.eforge.invokeAction`.
- A backlog-side all-domain planning search panel backed by `search-planning-records`, including snippets, counts by type, pagination metadata, dirty-index warnings, and result navigation into item/plan routes where possible.
- Workstation view-model/type updates for SQLite-derived `userStatus`, `effectiveLifecycle`, reason codes, associated plan/build links, recommendation dispositions (`actionable`, `suppressed`, `de-actioned`, `relocated`), and store/search status metadata.
- Adapter and component updates so board cards, item drawers, lifecycle panels, recommendation suppression rows, and plan context render SQL-projected lifecycle/actionability evidence instead of trace-only wording.
- Mock bridge and fixture updates for store status, search results, dirty-index state, maintenance reports, and new lifecycle/actionability reason codes.
- Workstation developer docs updates that prohibit direct filesystem/SQL access and describe the action-projected SQLite/search/maintenance contracts.
- Extension README updates for storage model, import workflow, search behavior, lifecycle/actionability semantics, retention/maintenance, changed actions, workstation behavior, and generic Claude/Pi integration parity.
- Docs-site eforge-plan guide updates for SQLite storage, import, FTS search, lifecycle/actionability, retention, and generic host invocation notes.
- Focused tests for workstation data loading, search panel behavior, store status/maintenance UI, lifecycle/actionability rendering, docs contracts, and asset-source boundaries.

### Out of Scope

- SQLite schema, migrations, repository implementation, `node:sqlite` access, or FTS object creation.
- Legacy importer parsing/mapping, destructive replacement implementation, or import diagnostics generation.
- Runtime capture/update/promote/handoff rewrites and lifecycle event correlation writes.
- SQL board/recommendation/session projection policy, duplicate planning checks, or actionability decisions.
- FTS document projection, ranking, snippet SQL, rebuild implementation, or search action registration.
- Retention pruning/archive/VACUUM implementation or maintenance action registration.
- Embedding/vector search, remote SQL, Postgres, synchronization, multi-user/team workflow semantics, or engine/kernel changes.
- Dedicated Claude Code plugin commands, Pi slash commands, MCP tools, or package-version changes unless implementation adds host-specific docs/skills beyond generic extension contribution notes.
- Parent Console React imports, private Console routes, direct daemon HTTP calls, `fetch`, `XMLHttpRequest`, or local `git`/`gh` execution from workstation code.

## Implementation Approach

### Overview

Treat the dependency modules as the authoritative backend contract and make the workstation a thin action-backed consumer. The implementation adds two user-facing workstation surfaces:

1. **Planning search panel** on the Backlog focus. It submits bounded all-domain searches to `search-planning-records`, renders snippets and type counts, warns when `indexDirty` is true, and routes backlog-item/session-plan results through existing URL helpers. It does not replace the board's local loaded-page filter; it augments it for canonical SQLite/FTS search across items, epics, session-plan summaries, and recommendation text.
2. **Store status card** on the Roadmap/storage context rail plus a compact header badge. It reads `get-store-status` during workstation refresh, displays initialization/schema/file-size/search/retention/recent-maintenance summaries, explains dry-run import when no store exists, and offers explicit bounded maintenance invocations (`compact-planning-store` dry-run, `rebuild-search-index`, `optimize-search-index`, and confirmed `vacuum-planning-store`). It never invokes destructive import replacement or apply compaction without a dedicated confirm path.

Update adapters and display components to carry SQL-derived lifecycle/actionability metadata through existing board, recommendation, and plan views. The UI labels should distinguish explicit authored `userStatus` from computed `effectiveLifecycle`, and trace-only strings should become storage-neutral evidence labels such as queue/build/session/PR/landing links.

Docs are updated after the UI contracts are wired so action names, defaults, output metadata, and host parity notes match the final code. Generated public docs are refreshed through the normal docs generator rather than edited directly.

### Key Decisions

1. **Status is non-blocking.** `get-store-status` failures populate a store-status error state but do not blank the board, plans, recommendations, roadmap, or drafts. This matches the current independent-loading pattern in `useWorkstationData`.
2. **Search is explicit.** The planning search panel uses a form/search button or debounced submit with a minimum non-empty query. Blank board filtering remains local to the loaded board page; all-domain FTS searches go through `search-planning-records` and show `indexDirty` rather than rebuilding automatically.
3. **Maintenance UI defaults to dry-run or confirmation.** The visible compaction control sends `{ dryRun: true, sampleLimit: 5 }`. Search rebuild/optimize are explicit local-write buttons. VACUUM uses a two-step in-app confirmation. Apply compaction and destructive import replacement remain available through action/contribution invocation, not one-click workstation controls.
4. **No import side effects from workstation startup.** When the store is absent, the status card explains `import-planning-store` dry-run/apply inputs and links users to generic extension contribution invocation; it does not call the importer automatically and does not create the database.
5. **Lifecycle labels are storage-neutral.** UI helper functions map reason codes (`queued-build`, `running-build`, `open-pr`, `merged-result`, `shipped-result`, `failed-result`, `partial-plan`, etc.) to display text without mentioning trace sidecars. Legacy trace reason codes are accepted as compatibility aliases where existing outputs or fixtures still include them.
6. **Type growth is contained.** Add SQLite/search/store UI contracts in focused new type modules and keep `src/types.ts` as a thin re-export/extension surface. If dependency modules have pushed `src/types.ts` over 600 lines, extract added search/store view types into focused files before adding workstation fields.
7. **Generic integration parity is documented, not duplicated.** The extension README/docs state that Claude Code and Pi expose the same eforge-plan actions through generic extension contribution tooling. No dedicated plugin/Pi command is added in this module; if a builder adds host-specific skill text, update both skill trees and bump `eforge-plugin/.claude-plugin/plugin.json`.
8. **Docs update current-state semantics.** Legacy Markdown/JSON paths are described as import inputs or artifact bodies, not as canonical runtime read paths. SQLite path, import workflow, search freshness, lifecycle/actionability evidence, and retention policy become the user-facing storage model.

### Shared-file coordination

Shared files from the architecture registry touched by this module:

- `eforge/extensions/eforge-plan/README.md` — documentation sections for storage/import/search/lifecycle/retention/workstation/generic host parity `[region: workstation-docs-integration, storage/import/search/lifecycle/retention and integration parity docs under stable README headings]`.
- `web/content/docs/eforge-plan.md` — docs-site guide text for SQLite storage, import/search workflow, lifecycle/actionability, and generic host invocation `[region: workstation-docs-integration, storage/import/search user guide text outside the retention-maintenance compaction subsection]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — minimal view-model extensions/re-exports only; keep FTS action response/search types in the fts-owned region/file and storage UI types in a focused module `[region: workstation-docs-integration, view-model/UI state type extensions and re-exports]`.

If temporary source markers are used in shared TypeScript files, use:

```ts
// --- eforge:region plan-07-workstation-docs-integration ---
// Workstation view-model type extensions or imports owned by this module.
// --- eforge:endregion plan-07-workstation-docs-integration ---
```

If implementation discovers that `eforge/extensions/eforge-plan/index.ts` must be changed for workstation subviews or allowlist entries, treat it as a shared-file-registry gap. Add a small workstation-docs region after the dependency modules' allowlist additions and avoid overlapping the importer, FTS, or retention registration blocks. Prefer avoiding `index.ts` edits because `search-planning-records` and maintenance actions are added to the allowlist by dependency modules.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/workstation-view-model-types.ts` — SQLite lifecycle/actionability reason-code aliases, associated link UI contracts, store status/maintenance report UI contracts, and narrow helpers used by workstation components without growing `types.ts`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/sqlite-lifecycle-labels.ts` — pure label/tone helpers for effective lifecycle, reason codes, recommendation dispositions, store/search status summaries, and byte/count formatting.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/sqlite-lifecycle-labels.test.ts` — unit tests for new reason codes, legacy compatibility reason aliases, lifecycle labels, disposition labels, and byte/count summaries.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/search/planning-search-panel.tsx` — Backlog rail all-domain search UI that invokes `search-planning-records`, renders snippets/counts/page metadata/index dirty warnings, and routes supported results.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/search/planning-search-panel.test.tsx` — component tests for bounded search inputs, type filters, selected field rendering, dirty-index warnings, pagination, and item/plan navigation callbacks.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.ts` — pure helper that maps all-domain search result records to workstation navigation intents (`item`, `plan`, or read-only display).
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/search-result-routing.test.ts` — unit tests for backlog item/session-plan navigation keys and non-navigable epic/recommendation rendering intents.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/storage/store-status-card.tsx` — Roadmap/storage rail card and header summary helpers for `get-store-status`, dry-run compaction, search rebuild/optimize, and confirmed vacuum actions.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/storage/store-status-card.test.tsx` — component tests for missing-store import guidance, initialized-store summaries, dirty-index status, dry-run compaction input, rebuild/optimize actions, vacuum confirmation, and raw payload omission.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-storage.ts` — mock store status, search result pages, maintenance reports, and helper functions used by the mock bridge and workstation tests.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add minimal optional lifecycle/actionability fields to `CompactBoardItem`, `BoardItem`, `CompactItemDetail`, `PlanLifecycleProjection`, and recommendation actionability types; re-export focused workstation view-model/store contracts without adding large inline blocks `[region: workstation-docs-integration, view-model/UI state type extensions and re-exports]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — load `get-store-status` during refresh, expose `storeStatus`, `storeStatusError`, and `refreshStoreStatus`, and keep status failures isolated from other sources.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/App.tsx` — render a compact SQLite/store status badge in the header using `storeStatus` and `storeStatusError` without triggering additional action calls.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/workstation-view.tsx` — add `PlanningSearchPanel` to the Backlog context rail and `StoreStatusCard` to the Roadmap context rail; pass existing route/navigation/data-refresh callbacks.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/compact-board-adapter.ts` — carry through optional `userStatus`, `effectiveLifecycle`, `reasonCodes`, `associatedLinks`, lifecycle evidence links, and search metadata from compact SQL projections into `BoardItem` view models.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/lib/plan-links.ts` — tolerate SQL-associated plan/build links when artifact summaries omit legacy source-ref shapes; keep URL key conventions unchanged.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/item-card.tsx` — surface effective lifecycle/user-status labels through existing compact chips/tooltips without adding raw evidence payloads.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/item-drawer.tsx` — show explicit authored status vs effective lifecycle, reason-code chips, and associated plan/build links from SQL projection detail rows.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/lifecycle-panel.tsx` — render associated links and new reason codes alongside existing lifecycle rows; rename trace-specific labels to queue/build/session/PR/landing evidence labels.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board-model.ts` — include `userStatus`, `effectiveLifecycle`, reason codes, associated links, and snippets in local loaded-page search text; keep FTS search in `PlanningSearchPanel`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx` — render `disposition`, expanded reason codes, failed/partial/merged/shipped de-actioned cases, and associated links without deriving actionability locally.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/lifecycle-evidence-panel.tsx` — display SQL link/evidence rows and retained summaries after compaction; keep session-plan Markdown body rendering unchanged.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plan-context-rail.tsx` — consume item-plan/source refs and active build/PR links from SQL projections when present.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — add mock cases for `get-store-status`, `search-planning-records`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store`, all returning bounded fixture objects.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — bounded edits only: add representative `userStatus`, `effectiveLifecycle`, new reason codes, associated links, and disposition examples to existing item/recommendation fixtures; move larger new fixtures into `mock-storage.ts`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — assert startup includes `get-store-status`, status failures do not clear other data, and `refreshStoreStatus` refreshes only the store status source.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/App.test.tsx` — assert the header/store badge renders initialized, dirty, and missing-store states from mock status data.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/board-model.test.ts` — add query matching for `effectiveLifecycle`, reason codes, associated links, and snippets on already-loaded board rows.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/item-drawer.test.tsx` — assert authored status/effective lifecycle/reason-code/associated-link rendering and no raw payload strings.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.test.tsx` — assert suppressed, de-actioned, relocated, failed, partial, merged, and shipped recommendation rows render server reason text and links, and no local enablement inference overrides server actionability.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — update source/bundle contract assertions for search panel, store status card, maintenance action IDs, no `fetch`/`XMLHttpRequest`, no `node:sqlite`, no `fs` imports, no local storage scanning, and no `list-board` hot-path usage.
- `eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts` — add docs contract assertions for SQLite action projections, FTS search, dry-run import guidance, explicit retention/maintenance behavior, and generic host parity notes.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — update storage/action table assertions from Markdown/trace canonical paths to SQLite canonical store plus importer-only legacy inputs; assert new import/search/maintenance action examples and lifecycle semantics.
- `eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts` — add coverage for SQLite store docs, search dirty-index docs, dry-run import docs, and generic contribution parity in README/workstation docs.
- `eforge/extensions/eforge-plan/README.md` — replace file-scattered canonical storage wording with SQLite-authoritative wording; document `import-planning-store`, `get-store-status`, `search-planning-records`, FTS-backed `search-items`, dirty-index status, lifecycle/actionability reason codes, retention/maintenance actions, workstation status/search panels, and Claude/Pi generic contribution parity `[region: workstation-docs-integration, storage/import/search/lifecycle/retention and integration parity docs under stable README headings]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — document that the iframe consumes SQLite/search/maintenance projections only through actions, does not scan storage or recompute FTS/actionability, and uses mock fixtures for store/search reports.
- `web/content/docs/eforge-plan.md` — update docs-site summary with SQLite private store path, import workflow, FTS search behavior, lifecycle/actionability semantics, workstation store/search surfaces, retention overview, and generic CLI/MCP/Pi contribution invocation notes `[region: workstation-docs-integration, storage/import/search user guide text outside the retention-maintenance compaction subsection]`.

If an implementation chooses to add host-specific Claude/Pi skill text rather than keeping parity notes in the extension docs, also modify both `eforge-plugin/skills/...` and `packages/pi-eforge/skills/...` with identical guidance, run `pnpm docs:check-parity`, and bump `eforge-plugin/.claude-plugin/plugin.json`. Do not bump `packages/pi-eforge/package.json`.

## Testing Strategy

### Unit Tests

- Lifecycle label helpers:
  - Map each new reason code to a deterministic label and tone.
  - Map legacy trace reason aliases to the new display vocabulary.
  - Render `userStatus` and `effectiveLifecycle` as separate labels when they differ.
  - Format bytes/counts for store status without raw payload fields.
- Store status card:
  - Missing store renders `initialized: false` guidance with `import-planning-store` dry-run/apply input examples.
  - Initialized store renders schema version, SQLite/WAL/SHM size summaries, dirty search status, retention eligibility counts, and recent maintenance run summaries.
  - Dry-run compaction invokes `compact-planning-store` with `dryRun: true`, capped sample limit, and no archive/apply flags.
  - Rebuild/optimize buttons invoke the FTS maintenance actions once per click.
  - Vacuum requires two clicks before invoking `vacuum-planning-store`.
  - Component output omits `payload_json`, `raw_request_json`, `raw_result_json`, `raw_model_json`, `verbose_report_json`, and `details_json`.
- Planning search panel:
  - Blank queries do not invoke `search-planning-records`.
  - Non-empty query invokes `search-planning-records` with default limit, offset, selected fields, and type filters.
  - Results render snippets with `<mark>` content safely, counts by type, pagination, and dirty-index warnings.
  - Backlog item results call `openItem(id)`, session-plan results call `openPlan(plan:<session>)`, and epic/recommendation results render as non-navigating rows.
- Adapter/view-model helpers:
  - `boardFromCompact` carries `userStatus`, `effectiveLifecycle`, reason codes, lifecycle links, and associated links into `BoardItem`.
  - Local loaded-page search text includes SQL lifecycle/link fields and remains independent from FTS action searches.
- Recommendation rail:
  - Server `disposition` and `state` drive button enablement.
  - Failed, partial, merged, shipped, and PR-open cases render server reason text plus associated links.
  - Mixed safe-parallel groups render only `actionableItemIds` for plan/select controls.

### Integration Tests

- Workstation data hook:
  - Startup calls `list-board-compact`, `list-planning-artifacts`, `get-recommendations`, `get-roadmap-state`, `list-draft-units`, and `get-store-status`.
  - A rejected `get-store-status` promise sets `storeStatusError` while board, artifacts, recommendations, roadmap, and drafts remain populated.
  - `refreshStoreStatus` invokes only `get-store-status`.
- App/workstation rendering:
  - Header badge displays initialized, missing, dirty-index, and error states.
  - Backlog focus renders the planning search panel and uses the bridge for searches.
  - Roadmap focus renders the store status card and maintenance controls.
  - The production bundle contains the new action IDs and contains no `fetch`, `XMLHttpRequest`, `node:sqlite`, `readFile`, `readdir`, or direct `.eforge/storage/extensions/eforge-plan` scanning code.
- Docs/contracts:
  - README action table includes `import-planning-store`, `get-store-status`, `search-planning-records`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store` with local-read/local-write side effects matching registered actions.
  - README storage model states SQLite is canonical for backlog/epic/dependency/recommendation/task/session-plan metadata/lifecycle/search state and legacy Markdown/JSON is importer-only after initialization/import.
  - Workstation README states browser code renders server/action-projected store/search/lifecycle data and does not recompute actionability, FTS freshness, git/PR evidence, or retention eligibility locally.
  - Web docs mention the SQLite database path, dry-run import default, FTS ranked/snippet search, dirty-index metadata, lifecycle/actionability evidence, retention overview, and generic contribution invocation for CLI/MCP/Pi.

## Verification

- [ ] Workstation startup invokes `get-store-status` once with `{}` during initial refresh.
- [ ] A `get-store-status` failure leaves `board.items.length > 0`, `artifacts.length > 0`, and `recommendations` unchanged in the hook test.
- [ ] The header renders `SQLite store`, `not initialized`, `dirty index`, and `status unavailable` states from fixture inputs.
- [ ] The Roadmap focus renders a store card containing `import-planning-store`, `{ "dryRun": false }`, and `{ "dryRun": false, "replaceExisting": true }` when the fixture reports `initialized: false`.
- [ ] Clicking dry-run compaction invokes `compact-planning-store` with `dryRun: true` and `sampleLimit <= 5`.
- [ ] Clicking rebuild search invokes `rebuild-search-index` and then refreshes store status.
- [ ] Clicking vacuum once changes the button label to a confirmation state and invokes no action; clicking the confirmation invokes `vacuum-planning-store` once.
- [ ] The planning search panel invokes `search-planning-records` with `limit <= 20` for a non-empty query and invokes no action for an empty query.
- [ ] Search results render at least one `backlog_item`, `epic`, `session_plan`, and `recommendation` fixture row with counts by type and snippet text.
- [ ] A dirty search fixture renders `index dirty` text and the dirty document count.
- [ ] Backlog item search result navigation sets the board item route, and session-plan result navigation sets `focus=plans` plus `plan=plan:<session>`.
- [ ] Board item drawers render both authored `userStatus` and computed `effectiveLifecycle` when those values differ.
- [ ] Recommendation rows with `disposition: "de-actioned"`, `reasonCode: "failed-result"`, and `reasonCode: "partial-plan"` render as non-actionable rows with associated links.
- [ ] Workstation source and built asset tests find no `fetch`, `XMLHttpRequest`, `node:sqlite`, `readFile`, `readdir`, or direct legacy Markdown/JSON reader imports in browser code.
- [ ] `types.ts` remains at or below 600 lines, or newly extracted type modules keep the maintainability check at zero file-size violations.
- [ ] `eforge/extensions/eforge-plan/README.md` names the SQLite DB path `.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite` and states session-plan Markdown remains the build artifact body.
- [ ] The README documents `import-planning-store` dry-run default, apply input `{ "dryRun": false }`, and replacement input `{ "dryRun": false, "replaceExisting": true }`.
- [ ] The README documents `search-planning-records`, FTS snippets, counts by type, pagination, and dirty-index metadata.
- [ ] The README documents `get-store-status`, `compact-planning-store`, `rebuild-search-index`, `optimize-search-index`, and `vacuum-planning-store`.
- [ ] The docs-site eforge-plan page includes SQLite storage, import workflow, FTS search, lifecycle/actionability, retention overview, and generic extension contribution invocation notes.
- [ ] Claude/Pi parity text states the same eforge-plan action IDs are discoverable through generic extension contribution tooling and no dedicated host command is introduced by this module.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation build` exits 0.
- [ ] `pnpm vitest run --config vitest.main.config.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts eforge/extensions/eforge-plan/__tests__/workstation-docs.test.ts eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts` exits 0.
- [ ] `pnpm docs:check` exits 0 after docs generation.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "docs"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
