# Storage Foundation

## Architecture Reference

This module implements the **Backlog storage model** and the `storage-foundation` entry in the architecture's module dependency graph.

Key constraints from architecture:
- Canonical item and epic paths move to `.eforge/storage/extensions/eforge-plan/backlog/...` via extension-private project-local storage.
- Legacy `.backlog/items` and `.backlog/epics` files remain read-only compatibility input.
- Existing helper names such as `readBacklogItem`, `listBacklogItems`, `writeBacklogItem`, and `updateBacklogItemFrontmatter` remain the integration surface for board, promotion, lifecycle, planner, and recommendation code.
- Private records override legacy records with the same ID.
- All writes from capture, update, upsert, promote, lifecycle, and later curation paths write private records only.
- Safe backlog ID checks and path-containment checks remain enforced for private and legacy paths.
- List/parse flows validate frontmatter IDs, not only caller-supplied write IDs.
- This module creates storage/snapshot primitives for later curation modules, but does not implement analyze-all curation, planning task contracts, workstation UI, or README updates.

## Scope

### In Scope

- Move canonical backlog item paths to `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md`.
- Move canonical backlog epic paths to `.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md`.
- Add explicit legacy path helpers for `.backlog/items/<id>.md` and `.backlog/epics/<id>.md`.
- Make read/list helpers merge private and legacy records with private precedence.
- Keep `loadBacklogItems` and `loadBacklogEpics` aliases wired to the merged list helpers.
- Keep Markdown/frontmatter parsing and serialization compatible with the current schema and frontmatter ordering.
- Validate safe IDs from filenames and frontmatter while listing/reading files.
- Preserve path-containment checks for roots and per-record files.
- Make `writeBacklogItem`, `writeBacklogEpic`, `updateBacklogItemFrontmatter`, and `updateBacklogEpicFrontmatter` write only private files.
- When updating a legacy-only record, copy the visible legacy body/frontmatter into a new private record and apply the requested updates there.
- Add snapshot/hash helpers for later curation preconditions over the visible private+legacy projection.
- Add import/copy helpers that copy legacy records into private storage, skip IDs that already have private records, and leave legacy files in place.
- Register an explicit `import-legacy-backlog` action for compatibility import.
- Update existing action descriptions and returned item/epic paths to reference private eforge-plan storage.
- Add tests for path resolution, merged listings, duplicate precedence, import behavior, and write-only-private behavior.

### Out of Scope

- Deleting, rewriting, or moving legacy `.backlog` files automatically.
- Scheduling, stale-triggered execution, unattended mutation, or curation apply behavior.
- Planning task wire contract changes.
- Workstation analyze-all UI or preview/apply flows.
- README or README contract updates; `docs-assets-validation` owns those changes.
- Core Console Plans surface changes.

## Implementation Approach

### Overview

Keep storage migration centralized in `markdown-store.ts`. Consumers already call storage helpers, so changing helper behavior updates board projections, planner context, promotion reads, input-source reads, lifecycle updates, and recommendation fingerprints without broad call-site rewrites.

The resulting storage behavior is:

1. Private paths are canonical and returned by `resolveBacklogItemPath` / `resolveBacklogEpicPath`.
2. Legacy paths are accessible only through `resolveLegacyBacklogItemPath` / `resolveLegacyBacklogEpicPath` and import helpers.
3. Reads check private first, then legacy.
4. Lists load private records first, then add legacy records whose IDs are not already present in private storage, then sort by ID.
5. Writes always target private paths. A write/update for a legacy-only record uses that legacy record as the base content and creates the private file.
6. Explicit import validates legacy records, copies them into private storage when no private record exists for the ID, reports copied/skipped IDs, and does not remove legacy files.

### Key Decisions

1. **Use extension SDK project paths for private roots.** `resolveBacklogItemPath` and `resolveBacklogEpicPath` must call `createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }).extensionStoragePath('project-local', ['backlog', ...])`. This matches trace/recommendation/planning-task private storage and uses SDK segment containment checks.
2. **Keep public storage helper names stable.** Existing consumers continue importing the same helpers; implementation changes stay inside `markdown-store.ts`.
3. **Add legacy helpers instead of retaining legacy semantics in canonical helpers.** Any code that intentionally needs `.backlog` compatibility must use `resolveLegacyBacklogItemPath` or `resolveLegacyBacklogEpicPath`, making read-only legacy access explicit.
4. **Validate record ID from both filename and frontmatter.** When reading/listing `items/<id>.md` or `epics/<id>.md`, parse frontmatter, assert `id` is safe, and reject a file whose frontmatter ID differs from the filename stem. This prevents duplicate or hidden records from malformed files.
5. **Skip legacy duplicates after private validation.** Build a private ID set first; legacy records with the same ID are omitted from visible listings and imports report them as skipped.
6. **Snapshot hashes are based on canonicalized parsed content.** Use `bodySha256 = sha256(body)` and `recordSha256 = sha256(canonicalJson({ frontmatter, body }))` so preconditions are stable across YAML key ordering changes but drift when content changes.
7. **Import validates before copying.** The import helper must collect and validate candidate legacy records before writing private files, then copy raw Markdown bytes to preserve existing Markdown formatting.
8. **Do not add docs in this module.** User-facing README text and README contract changes are delayed to `docs-assets-validation` after storage and curation behavior settle.

## Files

### Create

- `eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts` — focused tests for private canonical paths, legacy read-through, duplicate precedence, import helpers/action, and private-only writes.

### Modify

- `eforge/extensions/eforge-plan/markdown-store.ts` — implement private canonical path helpers, legacy path helpers, merged read/list behavior, snapshot/hash helpers, import helpers, and private-only write/update behavior.
  - Add durable semantic region markers if the file exceeds 300 lines after implementation, for example `backlog-storage-paths`, `backlog-storage-read-list`, `backlog-storage-write-import`, and `markdown-parse-serialize`.
  - Keep the file under 600 lines.
  - Export these new types/helpers:
    - `BacklogStorageOrigin = 'private' | 'legacy'`
    - `BacklogRecordKind = 'item' | 'epic'`
    - `BacklogRecordSnapshot<T>` with `kind`, `origin`, `id`, `path`, `relativePath`, `record`, `frontmatter`, `body`, `updated`, `bodySha256`, and `recordSha256`.
    - `resolveLegacyBacklogItemPath(cwd, id)` and `resolveLegacyBacklogEpicPath(cwd, id)`.
    - `resolveBacklogItemRelativePath(cwd, id)` and `resolveBacklogEpicRelativePath(cwd, id)` for action outputs.
    - `readBacklogItemSnapshot(cwd, id)`, `readBacklogEpicSnapshot(cwd, id)`, `listBacklogItemSnapshots(cwd)`, and `listBacklogEpicSnapshots(cwd)`.
    - `importLegacyBacklogItems(cwd, ids?)`, `importLegacyBacklogEpics(cwd, ids?)`, and `importLegacyBacklog(cwd, input)`.
  - Preserve existing exports for `assertSafeBacklogId`, `parseMarkdownRecord`, `serializeMarkdownRecord`, `readBacklogItem`, `readBacklogEpic`, `listBacklogItems`, `listBacklogEpics`, `loadBacklogItems`, `loadBacklogEpics`, `writeBacklogItem`, `writeBacklogEpic`, `updateBacklogItemFrontmatter`, and `updateBacklogEpicFrontmatter`.

- `eforge/extensions/eforge-plan/index.ts` — update action descriptions/returned paths and register explicit legacy import action `[region: storage-foundation, existing backlog action descriptions/path outputs plus new import-legacy-backlog action block near capture/update actions]`.
  - Update `capture-item`, `upsert-epic`, `update-item`, `promote-item`, and `promote-selection` descriptions to refer to visible eforge-plan backlog records and private storage writes.
  - Return `path: resolveBacklogItemRelativePath(ctx.cwd, item.id)` from `capture-item`.
  - Return `path: resolveBacklogEpicRelativePath(ctx.cwd, epic.id)` from `upsert-epic`.
  - Update input-source and Console contribution copy away from `.backlog` as the canonical store.
  - Add `import-legacy-backlog` with `sideEffects: ['local-read', 'local-write']`, input `{ kind?: 'items' | 'epics' | 'all'; ids?: string[] }`, and JSON-safe output containing copied/skipped item and epic IDs plus private relative paths.
  - Register the import action near existing backlog actions. If temporary coordination markers are needed, wrap only the new action block with:

```ts
// --- eforge:region plan-01-storage-foundation ---
const importLegacyBacklog = defineExtensionAction({
  // action definition owned by storage-foundation
});
// --- eforge:endregion plan-01-storage-foundation ---
```

- `eforge/extensions/eforge-plan/__tests__/storage.test.ts` — update existing storage tests to assert canonical private paths and to keep existing frontmatter ordering/body-preservation coverage.
  - Import `resolveBacklogEpicPath`, `resolveLegacyBacklogItemPath`, and `resolveLegacyBacklogEpicPath` as needed.
  - Add assertions that item/epic writes create `.eforge/storage/extensions/eforge-plan/backlog/...` files and do not create `.backlog/items` or `.backlog/epics` files.

- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update action registration and side-effect expectations for the import action `[region: storage-foundation, action ID/side-effect expectations and optional import action dispatch assertion blocks]`.
  - Add `import-legacy-backlog` to the expected action ID list.
  - Add `import-legacy-backlog` to `WRITE_ACTIONS` and verify it does not carry `build-queue` or `daemon-state` side effects.
  - Add it to the Console contribution action assertion if an import action block is added to the contribution.
  - Keep curation-owned action ID assertions separate for the later `curation-workflow` module.

### Do Not Modify

- `eforge/extensions/eforge-plan/README.md` — owned by `docs-assets-validation`.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — owned by `docs-assets-validation`.
- Workstation source or bundled assets — owned by `workstation-curation-ui` and `docs-assets-validation`.
- Client/engine planning task schemas — owned by `planning-task-contract`.

## Helper Design Details

### Path helpers

- `resolveBacklogItemPath(cwd, id)` returns `<cwd>/.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md`.
- `resolveBacklogEpicPath(cwd, id)` returns `<cwd>/.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md`.
- `resolveLegacyBacklogItemPath(cwd, id)` returns `<cwd>/.backlog/items/<id>.md`.
- `resolveLegacyBacklogEpicPath(cwd, id)` returns `<cwd>/.backlog/epics/<id>.md`.
- Every resolver calls `assertSafeBacklogId(id)` before constructing `<id>.md`.
- Private resolvers use `extensionStoragePath`; legacy resolvers continue using the local containment helper under `.backlog` roots.
- Relative path helpers normalize separators to `/` for action outputs.

### Read/list helpers

- `readBacklogItem(cwd, id)` calls `readBacklogItemSnapshot(cwd, id)` and returns `snapshot.record` or `null`.
- `readBacklogEpic(cwd, id)` mirrors item behavior.
- `listBacklogItems(cwd)` calls `listBacklogItemSnapshots(cwd)` and returns records.
- `listBacklogEpics(cwd)` mirrors item behavior.
- `listBacklogItemSnapshots(cwd)`:
  1. Lists private item Markdown files, validates each file, and inserts by record ID.
  2. Lists legacy item Markdown files, validates each file, and inserts only when the private ID map lacks that ID.
  3. Returns snapshots sorted by `id`.
- Epic snapshots use the same algorithm.

### Write/update helpers

- `writeBacklogItem(cwd, item)`:
  1. Reads existing private parsed content if present.
  2. Else reads legacy parsed content if present.
  3. Else uses default body `# <id>\n`.
  4. Merges existing frontmatter with `frontmatterFromWrite(item)`.
  5. Validates with `normalizeBacklogItem` and safe ID checks.
  6. Writes serialized Markdown to the private path.
- `writeBacklogEpic(cwd, epic)` mirrors item behavior.
- `updateBacklogItemFrontmatter(cwd, id, updates)` reads the visible private-or-legacy record, merges updates plus `id`, validates, and writes the private path.
- `updateBacklogEpicFrontmatter(cwd, id, updates)` mirrors item behavior.
- No write helper calls a legacy resolver as its output path.

### Import helpers

- `importLegacyBacklog(cwd, { kind = 'all', ids })` delegates to item and/or epic import helpers.
- Import helpers list or read legacy records, validate all selected records, skip IDs that already have private files, create private parent directories, and copy the raw legacy Markdown bytes into the private path.
- Output shape:

```ts
interface BacklogImportResult {
  schemaVersion: 1;
  items: { copied: Array<{ id: string; path: string }>; skipped: Array<{ id: string; reason: 'private-exists' }> };
  epics: { copied: Array<{ id: string; path: string }>; skipped: Array<{ id: string; reason: 'private-exists' }> };
}
```

- Invalid selected IDs or malformed records throw before any copy occurs.

## Testing Strategy

### Unit Tests

- Canonical item and epic paths contain `.eforge/storage/extensions/eforge-plan/backlog/items` and `.eforge/storage/extensions/eforge-plan/backlog/epics`.
- Canonical item and epic paths do not contain `.backlog/items` or `.backlog/epics`.
- Legacy path helpers resolve under `.backlog/items` and `.backlog/epics`.
- Unsafe IDs throw from private and legacy path helpers.
- `writeBacklogItem` and `writeBacklogEpic` create private files only.
- `readBacklogItem` and `readBacklogEpic` return legacy records when no private record has the same ID.
- `listBacklogItems` and `listBacklogEpics` include legacy records when no private duplicate exists.
- Private item and epic records override legacy records with the same ID in read and list flows.
- Listing order is deterministic by record ID across mixed private and legacy records.
- Frontmatter IDs containing path separators, empty strings, `.` or `..` throw during list/read parsing.
- Frontmatter ID mismatch with the filename stem throws during list/read parsing.
- `updateBacklogItemFrontmatter` against a legacy-only item creates a private file, preserves the legacy body, applies metadata updates, and leaves the legacy file bytes unchanged.
- `updateBacklogEpicFrontmatter` mirrors item behavior.
- Import helpers copy selected legacy items and epics to private storage, skip IDs with private files, and leave legacy files in place.
- Snapshot helpers report `origin`, `relativePath`, `updated`, `bodySha256`, and `recordSha256` for private and legacy records.

### Integration / Action Tests

- `capture-item` writes a private item and returns a private relative path.
- `upsert-epic` writes a private epic and returns a private relative path.
- `update-item` on a legacy-only item writes the private item and leaves `.backlog/items/<id>.md` unchanged.
- `promote-item` or `promote-selection` on a legacy-only item updates private item frontmatter via storage helpers and leaves legacy item bytes unchanged.
- `import-legacy-backlog` action returns copied/skipped IDs, writes private files, does not delete legacy files, and has no `build-queue` side effect.
- `list-board` includes mixed private and legacy visible records and uses private records for duplicate IDs.
- `prepare-planner-context`, promotion selection, input-source reads, lifecycle hooks, and recommendation reference validation continue to pass through the migrated helpers without direct path rewrites.

### Targeted Commands

- `pnpm test -- eforge/extensions/eforge-plan/__tests__/storage.test.ts eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts`
- `pnpm type-check`
- Later module integration runs the full expedition validation commands.

## Verification

- [ ] `resolveBacklogItemPath(cwd, 'item-one')` returns a path ending in `.eforge/storage/extensions/eforge-plan/backlog/items/item-one.md`.
- [ ] `resolveBacklogEpicPath(cwd, 'epic-one')` returns a path ending in `.eforge/storage/extensions/eforge-plan/backlog/epics/epic-one.md`.
- [ ] `resolveBacklogItemPath` and `resolveBacklogEpicPath` returned strings do not contain `.backlog/items` or `.backlog/epics`.
- [ ] `resolveLegacyBacklogItemPath(cwd, 'item-one')` returns a path ending in `.backlog/items/item-one.md`.
- [ ] `resolveLegacyBacklogEpicPath(cwd, 'epic-one')` returns a path ending in `.backlog/epics/epic-one.md`.
- [ ] Unsafe IDs throw from all item and epic path helpers.
- [ ] `writeBacklogItem` creates the private item file and leaves `.backlog/items/<id>.md` absent when it was absent before the call.
- [ ] `writeBacklogEpic` creates the private epic file and leaves `.backlog/epics/<id>.md` absent when it was absent before the call.
- [ ] `readBacklogItem` returns a legacy-only item record.
- [ ] `readBacklogEpic` returns a legacy-only epic record.
- [ ] `listBacklogItems` returns a single record for duplicate private+legacy item IDs and the returned record has the private title/status.
- [ ] `listBacklogEpics` returns a single record for duplicate private+legacy epic IDs and the returned record has the private title/status.
- [ ] `updateBacklogItemFrontmatter` against a legacy-only item creates the private file, preserves the body, applies the requested metadata, and leaves the legacy file unchanged byte-for-byte.
- [ ] `updateBacklogEpicFrontmatter` against a legacy-only epic creates the private file, preserves the body, applies the requested metadata, and leaves the legacy file unchanged byte-for-byte.
- [ ] `importLegacyBacklog` copies legacy item and epic records into private storage when private IDs are absent.
- [ ] `importLegacyBacklog` reports `private-exists` for duplicate private IDs and does not overwrite those private files.
- [ ] `importLegacyBacklog` leaves legacy item and epic files present after completion.
- [ ] `capture-item` action output `path` starts with `.eforge/storage/extensions/eforge-plan/backlog/items/`.
- [ ] `upsert-epic` action output `path` starts with `.eforge/storage/extensions/eforge-plan/backlog/epics/`.
- [ ] Registered `import-legacy-backlog` action has `local-read` and `local-write` side effects and lacks `build-queue` and `daemon-state` side effects.
- [ ] `list-board` output includes a legacy-only item and uses a private duplicate when both origins contain the same item ID.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/storage.test.ts eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
