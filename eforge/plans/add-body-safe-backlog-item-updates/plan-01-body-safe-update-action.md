---
id: plan-01-body-safe-update-action
name: Body-safe update-item action and canonical storage
branch: add-body-safe-backlog-item-updates/plan-01-body-safe-update-action
agents:
  builder:
    effort: high
    rationale: Extends an agent-facing mutation API across schemas, canonical
      storage helpers, Markdown section rendering, optimistic locks,
      projections, and focused tests.
  reviewer:
    effort: high
    rationale: The mutation boundary needs careful review for locking, storage
      consistency, and backward compatibility.
---

# Body-safe update-item action and canonical storage

## Architecture Context

`eforge-plan` keeps canonical backlog state in private SQLite and writes Markdown mirrors for compatibility. The current `update-item` action updates metadata only, while title and structured body edits require direct Markdown mutations. This plan moves those edits into the existing action boundary, keeps metadata-only callers compatible, and exposes version tokens through `get-item`.

No database migration is planned: `backlog_items.body_sha256`, `backlog_items.record_sha256`, and `backlog_item_sections` already exist.

## Implementation

### Overview

Extend `eforge-plan:update-item` so callers can mutate title and named body sections using an optimistic lock token. The implementation renders the final Markdown body, recomputes item section rows from that final body, updates the canonical row and mirror through canonical helpers, marks search dirty through the existing canonical path, and marks recommendations stale through the existing invalidation function.

### Key Decisions

1. Use top-level `expectedBodySha256` as the documented optimistic lock token for title/body/section edits. Also accept `expectedRecordSha256` and `expectedUpdatedAt` as optional stricter checks.
2. Keep metadata-only updates compatible: status, priority, tags, dependencies, epic, evidence notes, and recheck notes do not require a lock and keep body bytes unchanged.
3. Do not add a raw full-body replacement field. Structured `sections` and ordered `sectionOperations` are the normal agent-facing path.
4. Treat priority as a free-form backlog label with a narrow convention: a non-empty single-line string. This preserves existing `high`, `medium`, `low`, `normal`, and `p1` values while rejecting empty or multiline values.
5. Canonicalize known item section headings to `Claim`, `Evidence`, `Acceptance Criteria`, `Recheck`, and `Notes`; reject duplicate canonical sections before mutating storage.

## Scope

### In Scope

- Extend `UpdateInput` for title, sections, section operations, timestamps, and lock tokens.
- Return an updated item summary with id, title, status, updated timestamp, path/storage identity, body hash, record hash, and changed fields/sections.
- Expose item lock/version fields from `get-item` detail output.
- Add helper code for parsing and rendering item body sections while preserving unrelated content.
- Add same-transaction optimistic lock checks to the canonical item update helper.
- Recompute item section rows from the final body for body/title/section updates.
- Validate safe item ids, status values, priority convention, dependency refs, epic refs, duplicate canonical sections, and section operation shape before writing.
- Keep legacy Markdown-backed item migration before update and preserve legacy file bytes.
- Add focused tests for action behavior, storage side effects, projection fields, search dirty markers, recommendation invalidation, and registration contracts.

### Out of Scope

- Raw full-body replacement as a normal action input.
- Epic body update parity beyond low-cost shared helpers that do not expand this plan.
- Workstation rich body-editor UI.
- Daemon, kernel, queue, or scheduling changes.

## Files

### Create

- `eforge/extensions/eforge-plan/canonical/item-body-sections.ts` — section heading normalization, duplicate detection, title rendering, structured section patching, and `SectionUpsert` derivation from final Markdown bodies.
- `eforge/extensions/eforge-plan/__tests__/item-body-sections.test.ts` — parser/renderer tests for known headings, unknown section preservation, duplicate canonical headings, malformed operation rejection, title changes, empty sections, and append/replace behavior.
- `eforge/extensions/eforge-plan/__tests__/update-item-body-safe.test.ts` — action-level tests for title and section updates, lock mismatch, validation failures, legacy migration, storage row/mirror consistency, dirty search markers, and recommendation stale metadata.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — expand `UpdateInput`, add an update-item output schema, validate inputs, migrate legacy-only items into canonical storage, require a lock for body-affecting updates, call the canonical update helper with final body and sections, and return version/path/change data while preserving `itemId` and `status` compatibility fields.
- `eforge/extensions/eforge-plan/canonical/backlog-records.ts` — add optional optimistic preconditions to `updateCanonicalBacklogItem`, compare current body/record/updated tokens inside the transaction, preserve existing source/timestamp/import row fields on update, accept `lastCheckedAt` and `staleAfter`, and write supplied section rows atomically with the item row.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — when curation applies item body changes, pass section rows derived from the final item body into the canonical write helper so curation remains storage-consistent.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — add `bodySha256`, `recordSha256`, and `storage` fields to `get-item` detail output schema and update the action description to advertise lock-token reads.
- `eforge/extensions/eforge-plan/projections/items.ts` — project version/storage fields for `get-item` detail without adding hashes to board/search compact lists.
- `eforge/extensions/eforge-plan/sqlite/repositories/projections/items.ts` — include `body_sha256`, `record_sha256`, and any needed epic ref data in projection rows.
- `eforge/extensions/eforge-plan/projections/types.ts` — add optional projection fields only if TypeScript consumers require them.
- `eforge/extensions/eforge-plan/__tests__/backlog-query-actions.test.ts` — assert `get-item` returns version tokens, storage identity, and path.
- `eforge/extensions/eforge-plan/__tests__/backlog-storage-migration.test.ts` — extend legacy action migration coverage for body-safe updates and updated response fields.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-backlog-writes.test.ts` — assert metadata-only updates preserve sections and body-affecting updates replace section rows from the final body.
- `eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts` — add or extend coverage for body-safe `update-item` mutations marking recommendations stale.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert the action schema advertises title, sections/sectionOperations, lock fields, and versioned output data.

## Database Migration

No schema migration is required. Existing columns and section tables cover this feature.

## Implementation Notes

- `sections` behaves as replace operations keyed by section name. Known aliases such as `claim`, `evidence`, `acceptanceCriteria`, `Acceptance Criteria`, `recheck`, and `notes` map to canonical headings.
- `sectionOperations` accepts ordered `{ heading, action: "replace" | "append", content }` entries. Unknown headings are allowed only when the heading is non-empty, single-line, and does not begin with `#`.
- Apply `sections` replacements before ordered `sectionOperations`; report all changed canonical/unknown section headings in the action output.
- A title change updates both the SQLite `title` column and the first Markdown H1. If the body has no H1, prepend `# <title>` before the existing content.
- A body-affecting request is any input containing `title`, `sections`, or `sectionOperations`; reject it unless at least one expected lock field is present.
- Lock mismatch errors are user-action errors that name the stale token and instruct the caller to re-read `get-item` before retrying.
- Dependency refs in `dependsOn` are safe backlog ids, unique, not equal to the target item id, and resolve to visible canonical or legacy items before writing.
- Epic refs keep the existing non-empty canonical-epic validation; an empty string still clears the link for compatibility.
- Section rows derive from the final rendered body using the same canonical heading rules that action reads use.
- Search dirty marking continues through `upsertCanonicalBacklogItem`/`markItemDirty`; do not rebuild FTS synchronously.

## Verification

- [ ] `get-item` returns `bodySha256`, `recordSha256`, `updatedAt`, `path`, and `{ kind: "canonical-sqlite", id }` storage data for a canonical item.
- [ ] Metadata-only `update-item` without lock updates status/priority/tags/dependencies/epic/evidence notes/recheck notes and leaves body bytes unchanged.
- [ ] `update-item` with `title` and `expectedBodySha256` updates the SQLite title and Markdown H1.
- [ ] `update-item` replaces `Claim`, `Evidence`, `Acceptance Criteria`, `Recheck`, and `Notes` sections through structured inputs.
- [ ] `update-item` applies an additional unknown section operation and preserves unrelated unknown sections byte-for-byte.
- [ ] A stale `expectedBodySha256` returns a user-action optimistic-lock error and leaves row, section, dependency, tag, and mirror data unchanged.
- [ ] Duplicate canonical sections are rejected before write.
- [ ] Invalid ids, status values, priority strings, dependency refs, epic refs, and malformed section operations are rejected before write.
- [ ] Legacy-only Markdown items migrate to canonical storage before update while legacy file bytes remain unchanged.
- [ ] Successful body-safe updates recompute item section rows, update the Markdown mirror, mark the item search document dirty, and mark recommendations stale when recommendation state exists.
- [ ] Registration tests show `update-item` remains `agent-compact` and advertises the new schema fields.
