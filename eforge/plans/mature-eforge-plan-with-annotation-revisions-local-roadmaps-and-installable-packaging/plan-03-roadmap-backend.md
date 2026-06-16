---
id: plan-03-roadmap-backend
name: Implement local-first roadmap state/actions and replace hardcoded roadmap
  evidence in planner, curation, refresh, and freshness flows.
branch: mature-eforge-plan-with-annotation-revisions-local-roadmaps-and-installable-packaging/roadmap-backend
---

# Roadmap Backend

## Architecture Reference

This module implements the **Roadmap design**, **Roadmap model**, **Roadmap action contract**, and **Roadmap context flow** sections from the architecture for **Mature eforge-plan: annotation revisions, local roadmaps, installable package**.

Key constraints from architecture:
- Replace the single canonical `docs/roadmap.md` evidence object with a `RoadmapContext` that separates local steering, configured shared context, and discovered conventional context.
- Store the developer-local focus roadmap in eforge-plan private project-local storage by default.
- Treat shared project roadmap files as read-only context unless a user configures them as context sources; recommendation refresh and analyze-all flows must not rewrite shared roadmap files.
- Expose bounded extension actions for reading roadmap state and updating roadmap state, and reuse the existing `refresh-recommendations` action as the bounded refresh API.
- Feed the same roadmap context projection into planner context, analyze-all curation, recommendation refresh source text, and recommendation freshness fingerprints.
- Runtime code depends on the `package-foundation` public-import work; new imports must use public package entrypoints such as `@eforge-build/extension-sdk` and `@eforge-build/client` rather than monorepo `packages/*/src` paths.
- Keep roadmap action outputs bounded and JSON-safe, with excerpt/count limits and no daemon route or wire-shape re-declarations.

## Scope

### In Scope
- Add backend schemas and types for `RoadmapContext`, `RoadmapSourceProjection`, `RoadmapConfig`, `ConfiguredRoadmapSource`, conflicts, `get-roadmap-state`, and `update-roadmap-state`.
- Add private storage helpers for:
  - `.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md`
  - `.eforge/storage/extensions/eforge-plan/roadmaps/config.json`
- Resolve roadmap context from local focus content, configured shared sources, and discovered conventional sources such as `docs/roadmap.md`.
- Validate and normalize configured shared-source paths as project-relative contained paths.
- Label conventional discoveries as `kind: 'discovered-conventional'`, `role: 'shared-context'`, and `configured: false`.
- Detect and surface missing configured sources, duplicate enabled source paths/ids, and source read errors as `RoadmapConflict` entries.
- Register `get-roadmap-state` and `update-roadmap-state` extension actions.
- Add `get-roadmap-state`, `update-roadmap-state`, and the existing `refresh-recommendations` action to the planning workstation allowlist for downstream roadmap UI work.
- Replace `roadmapEvidence` with `roadmapContext` in planner context output, backlog curation sources/fingerprints, recommendation refresh source text, and recommendation freshness projection.
- Update tests that asserted the legacy single-path roadmap shape and add focused roadmap backend tests.

### Out of Scope
- Workstation roadmap UI, editor components, refresh buttons, and UI tests owned by `roadmap-workstation`.
- README or public documentation updates owned by `packaging-docs-validation`.
- Annotation schemas, actions, turn snapshots, or annotation UI.
- Automatic writes to shared project roadmap files.
- New daemon routes, scheduling features, or daemon wire shapes.
- Package metadata/build/publish changes owned by `package-foundation` and `packaging-docs-validation`.

## Implementation Approach

### Overview

Create a focused roadmap backend layer and make every existing roadmap consumer call it. The layer owns storage path resolution, path normalization, source projection, conflict metadata, truncation counters, and action schemas. Existing planner, curation, refresh, and freshness code then consumes `RoadmapContext` rather than each file reading `docs/roadmap.md` independently.

The local focus roadmap is always represented as `localSteering`. It is editable and stored in extension-private project-local storage. Configured shared sources are projected as `sharedContextSources`; discovered conventional files are projected as `discoveredContextSources`. Discovered `docs/roadmap.md` is never labeled canonical and is omitted from discovery when the same normalized path is configured.

`includeRoadmap: false` remains supported for existing planner callers. Instead of returning the old missing `roadmapEvidence` object, the planner returns an empty `roadmapContext` with the local focus projection path, no shared/discovered sources, an assumption explaining omission, and zero truncation counts.

### Key Decisions

1. **Put TypeBox contracts in `roadmap-schemas.ts`.** `schema.ts` is already near the file-size limit and is shared by several modules. It will import `RoadmapContextSchema` and expose planner output through `roadmapContext` without carrying the full roadmap schema body.
2. **Put storage/projection code in `roadmap-context.ts`.** This keeps file reads, path containment, truncation, hashing, and config normalization in one backend module. Planner, curation, refresh, and freshness consumers must not keep local roadmap readers.
3. **Use action wrappers in `roadmap-actions.ts`.** Action registration stays separate from projection logic, so source builders can call the roadmap helper without importing extension action definitions.
4. **Use content hashes for freshness.** Every existing source projection includes `sha256` when content is readable. Freshness fingerprints change when local focus content, configured source content, discovered source content, or enabled-source config changes.
5. **Bound source text by projection, not by raw content.** Source projections expose headings and limited excerpts, plus `sha256` for complete-content drift. The context records `truncation.sourceExcerpts` and `truncation.sourceContent` counts.
6. **Reject unsafe user-supplied paths at update time.** `update-roadmap-state` normalizes shared source paths under `cwd`, rejects absolute/traversing/null paths, bounds source count and string lengths, and stores only normalized project-relative paths.
7. **Report conflicts during reads.** If a manually edited config contains duplicate enabled paths/ids, missing configured sources, or unreadable sources, `get-roadmap-state`, planner payloads, curation payloads, and refresh payloads all include the same conflict metadata.
8. **Do not add direct staleness writes from roadmap actions.** Recommendation status already derives stale/fresh from `computeRecommendationSourceFingerprint`. Avoid importing recommendation-status from roadmap actions to keep the module graph acyclic.

### Roadmap Context Shape

Use the architecture model as the contract:

```ts
// --- eforge:region plan-04-roadmap-backend ---
interface RoadmapContext {
  schemaVersion: 1;
  localSteering: RoadmapSourceProjection;
  sharedContextSources: RoadmapSourceProjection[];
  discoveredContextSources: RoadmapSourceProjection[];
  assumptions: string[];
  conflicts: RoadmapConflict[];
  truncation: { sourceExcerpts: number; sourceContent: number };
}
// --- eforge:endregion plan-04-roadmap-backend ---
```

Concrete limits to encode in `roadmap-schemas.ts`/`roadmap-context.ts`:
- `MAX_ROADMAP_SHARED_SOURCES = 20`
- `MAX_ROADMAP_SOURCE_PATH_LENGTH = 240`
- `MAX_ROADMAP_SOURCE_LABEL_LENGTH = 120`
- `MAX_ROADMAP_LOCAL_FOCUS_BYTES = 40_000`
- `MAX_ROADMAP_CONTEXT_CONTENT_BYTES = 16_000` per projected source before heading/excerpt extraction
- `MAX_ROADMAP_HEADINGS = 40`
- `MAX_ROADMAP_HEADING_LENGTH = 200`
- `MAX_ROADMAP_EXCERPTS = 5`
- `MAX_ROADMAP_EXCERPT_BYTES = 2_000`

The implementation can adjust these exact constants if type-checking or tests reveal a stronger existing convention, but each action response must remain bounded by explicit constants.

### Action Contract

Register two new actions:

- `get-roadmap-state`
  - input: `{ includeLocalFocusContent?: boolean }`
  - side effects: `['local-read']`
  - output: `RoadmapStateResponse`
- `update-roadmap-state`
  - input: `{ localFocusContent?: string; expectedLocalFocusSha256?: string; sharedSources?: ConfiguredRoadmapSource[] }`
  - require at least one of `localFocusContent` or `sharedSources`
  - side effects: `['local-read', 'local-write']`
  - output: `RoadmapStateResponse`

`update-roadmap-state` must not write configured shared source files. It writes only local focus content and config metadata under extension-private storage. When `expectedLocalFocusSha256` is present and does not match the current local focus content hash, throw an extension user action error with path `expectedLocalFocusSha256`.

## Files

### Create
- `eforge/extensions/eforge-plan/roadmap-schemas.ts` — TypeBox schemas, constants, and exported TypeScript types for roadmap config, source projections, conflicts, context, and roadmap actions. Use public imports from `@eforge-build/extension-sdk` after `package-foundation` lands.
- `eforge/extensions/eforge-plan/roadmap-context.ts` — private storage path helpers, config normalization, local focus reads/writes, source projection, conventional discovery, conflict detection, truncation counters, `buildRoadmapContext`, `readRoadmapState`, and `updateRoadmapState`.
- `eforge/extensions/eforge-plan/roadmap-actions.ts` — `getRoadmapStateAction`, `updateRoadmapStateAction`, and `roadmapActions` tuple using `defineExtensionAction` and `toJsonSafeObject`.
- `eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts` — helper-level tests for local focus storage, explicit config, no-config discovery, missing configured sources, duplicate/conflict metadata, path containment, bounded excerpts, and source hashes.
- `eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts` — action-runtime tests for `get-roadmap-state` and `update-roadmap-state`, including optimistic hash mismatch and no shared-file writes.
- `eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts` — focused integration tests for planner, curation, recommendation projection, recommendation refresh source text, and recommendation freshness drift using `roadmapContext`.

### Modify
- `eforge/extensions/eforge-plan/index.ts` — import/register `roadmapActions`; add `get-roadmap-state`, `update-roadmap-state`, and `refresh-recommendations` to planning workstation `allowedActions`; optionally add compact console contribution blocks for reading roadmap state, updating local focus/config, and refreshing recommendations `[region: roadmap-backend, action imports/registration, contribution blocks, workstation allowedActions]`.
- `eforge/extensions/eforge-plan/schema.ts` — replace `PlannerRoadmapEvidenceSchema` usage with imported `RoadmapContextSchema`, change `PreparePlannerContextOutputSchema` from `roadmapEvidence` to `roadmapContext`, and update exported planner roadmap type aliases `[region: roadmap-backend, planner context roadmap schema block]`.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — import `buildRoadmapContext`, set `roadmapContext` in `preparePlannerContext`, pass `includeRoadmap` through to the helper, and delete the local `ROADMAP_EVIDENCE_PATH`/`readRoadmapEvidence` implementation plus unused `fs/path` imports `[region: roadmap-backend, preparePlannerContext roadmap projection and legacy reader removal]`.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — import `buildRoadmapContext`, replace `roadmapEvidence` with `roadmapContext` in the source object and fingerprint projection, remove the local `readRoadmapEvidence` reader/constant/imports, and include `roadmapContext` in the minimal `buildSourceText` fallback `[region: roadmap-backend, curation source roadmap projection and legacy reader removal]`.
- `eforge/extensions/eforge-plan/recommendation-status.ts` — import `buildRoadmapContext`, replace `roadmapEvidence` in `buildRecommendationSourceProjection` with `roadmapContext`, remove `readRoadmapFingerprintEvidence`, and remove now-unused roadmap file imports `[region: roadmap-backend, recommendation source projection roadmap replacement]`.
- `eforge/extensions/eforge-plan/recommendation-refresh.ts` — verify `buildRecommendationRefreshSource` serializes `roadmapContext` from `preparePlannerContext`; adjust types or assertions only if the compiler exposes legacy `roadmapEvidence` assumptions `[region: roadmap-backend, refresh source context compatibility]`.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — replace legacy `roadmapEvidence` assertions with `roadmapContext.localSteering`, `sharedContextSources`, and `discoveredContextSources` assertions; keep existing selector and apply-result coverage intact.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — update the roadmap fingerprint test to assert `roadmapContext` changes the curation fingerprint; assert source text contains `roadmapContext` rather than `roadmapEvidence`.
- `eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts` — add or update freshness assertions so local focus content changes and configured shared source content changes produce source fingerprint drift.
- `eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts` — update source text assertions to match `roadmapContext`, local steering/shared context labels, and continued bounded refresh task behavior.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — replace existing `source.context.roadmapEvidence` expectations with `source.context.roadmapContext` expectations using same-line or smaller bounded edits because this test file is near the 1,200-line limit.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update expected action IDs, read/write side-effect sets, output schema assertions, and workstation allowed action assertions for roadmap actions and refresh allowlisting `[region: roadmap-backend, action registry assertions]`.
- `test/eforge-plan-workstation.test.ts` — update planning workstation allowlist assertions to include `get-roadmap-state`, `update-roadmap-state`, and `refresh-recommendations`; remove the assertion that refresh is absent `[region: roadmap-backend, workstation allowedActions assertions]`.

## Testing Strategy

### Unit Tests
- `roadmap-context.test.ts`
  - `readRoadmapState(cwd, { includeLocalFocusContent: true })` returns a local focus projection with path `.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md`, `editable: true`, `kind: 'local-focus'`, `role: 'local-steering'`, `configured: true`, and bounded `content` when the file exists.
  - `updateRoadmapState` writes only extension-private `local-focus.md` and `config.json` files.
  - Configured shared sources are normalized to project-relative paths and projected with `kind: 'configured-shared'`, `role: 'shared-context'`, `editable: false`, and `configured: true`.
  - `docs/roadmap.md` with no config appears only in `discoveredContextSources` with `kind: 'discovered-conventional'`, `role: 'shared-context'`, and `configured: false`.
  - Missing configured sources appear in `sharedContextSources` with `exists: false` and a `configured-source-missing` conflict.
  - Duplicate enabled paths or duplicate ids in a manually written config produce `duplicate-source` conflicts.
  - Unsafe paths such as `../roadmap.md`, absolute paths, Windows absolute paths, and null-byte paths are rejected by update helpers.
  - Long roadmap content produces bounded headings/excerpts and increments truncation counters.

### Integration Tests
- `roadmap-actions.test.ts`
  - Dispatch `eforge-plan:get-roadmap-state` and `eforge-plan:update-roadmap-state` through the extension action runtime and assert success outputs match the roadmap action schemas.
  - Dispatch `update-roadmap-state` with a mismatched `expectedLocalFocusSha256` and assert the action result is a user/input failure whose error path mentions `expectedLocalFocusSha256`.
  - Configure a shared source and assert the action does not create, modify, or rewrite that shared project file.
- `roadmap-integration.test.ts`
  - `preparePlannerContext` returns `roadmapContext` and does not include `roadmapEvidence`.
  - `preparePlannerContext(cwd, { includeRoadmap: false })` returns an empty source context with an omission assumption and no shared/discovered sources.
  - `buildBacklogCurationSource` includes `roadmapContext` in both `source` and JSON `sourceText`, and its `sourceFingerprint` changes after local focus content changes.
  - `buildRecommendationSourceProjection` includes `roadmapContext`; `computeRecommendationSourceFingerprint` changes after configured shared source content changes and after local focus content changes.
  - `buildRecommendationRefreshSource` source text includes `roadmapContext`, `localSteering`, configured shared source labels, conflicts when present, and `sourceFingerprint`.
- Existing test updates
  - Update planner, curation, refresh, registration, and workstation tests with bounded replacements, not broad rewrites.
  - Avoid adding new cases to `planner-agent-task-actions.test.ts`; keep edits replacement-only because that file is already at the test-size limit.

## Verification

- [ ] `rg "docs/roadmap\.md" eforge/extensions/eforge-plan -g "*.ts" -g "!__tests__/**" -g "!workstation-src/**" -g "!workstation-assets/**" -g "!dist/**"` returns only the conventional discovery constant and user-facing labels/comments in roadmap backend files.
- [ ] `rg "roadmapEvidence" eforge/extensions/eforge-plan -g "*.ts" -g "!__tests__/**" -g "!workstation-src/**" -g "!workstation-assets/**" -g "!dist/**"` returns no matches.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/roadmap-context.test.ts eforge/extensions/eforge-plan/__tests__/roadmap-actions.test.ts eforge/extensions/eforge-plan/__tests__/roadmap-integration.test.ts` exits 0.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts test/eforge-plan-workstation.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] No new implementation file exceeds 600 lines.
- [ ] No new test file exceeds 1,200 lines.
- [ ] `eforge/extensions/eforge-plan/__tests__/registration.test.ts` observes registered actions named `get-roadmap-state` and `update-roadmap-state` with object-root input schemas and JSON-safe output schemas.
- [ ] Planner, curation, refresh, and recommendation source projection tests assert `roadmapContext.localSteering`, `roadmapContext.sharedContextSources`, and `roadmapContext.discoveredContextSources` as separate payload fields.
- [ ] A freshness test records a fresh recommendation status, changes local focus roadmap content, then observes `state: 'stale'` with a changed source fingerprint.
- [ ] A freshness test records a fresh recommendation status, changes an enabled configured shared source, then observes `state: 'stale'` with a changed source fingerprint.
- [ ] A roadmap action test verifies that `update-roadmap-state` never writes configured shared project files.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "api"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
