---
id: plan-01-direct-epic-reference-validation
name: Direct Epic Reference Validation
branch: validate-backlog-epic-references/plan-01-direct-epic-reference-validation
---

# Direct Epic Reference Validation

## Architecture Context

`eforge-plan` direct backlog writes are registered in `eforge/extensions/eforge-plan/index.ts`. Those handlers write through `captureCanonicalBacklogItem` and `updateCanonicalBacklogItem`, which intentionally persist `epicRef` without a SQLite foreign key so curation/import/legacy paths can carry unresolved historical references. The fix belongs at the direct action boundary before canonical item writes, not in `canonical/backlog-records.ts` or `sqlite/schema.ts`.

The existing curation apply flow validates unknown epic metadata in `backlog-curation-apply.ts`; keep that separate and add a small helper for direct actions only.

## Implementation

### Overview

Add a shared direct-action epic reference helper, call it from `capture-item` and `update-item`, and add dispatch-level tests that cover rejected invalid ids, valid ids, omitted values, empty-string clearing, and a legacy migration path that remains permissive when the direct input omits `epic`.

### Key Decisions

1. Validate only `epic` values whose length is greater than zero. `update-item` with `epic: ""` continues to clear the link by translating the empty string to `null` after validation returns.
2. Use exact canonical private store lookup (`readCanonicalEpic(cwd, epicId)`) rather than search. The rejection can name the id and stays aligned with the direct canonical write path.
3. Throw a user-facing invalid-input error with `path: "epic"`. The message must include the invalid id plus guidance mentioning `get-epic`, `search-items` with `includeEpics`, and creating/upserting the epic first (include `upsert-epic` in the guidance text).
4. Do not add a SQLite foreign key or canonical storage validation. Canonical writes and legacy migration remain permissive unless a direct action supplies a non-empty `epic` input.
5. When updating an item, pass an `epic` property into `updateCanonicalBacklogItem` only when the action input included `epic`. This preserves existing epic links for omitted `epic` updates and keeps `epic: ""` as the explicit clear operation.

## Scope

### In Scope

- Direct `capture-item` validation for nonexistent non-empty epic ids.
- Direct `update-item` validation for nonexistent non-empty epic ids.
- A shared direct-action validation helper.
- Dispatch/action-level tests for invalid, valid, omitted, and empty-string clear cases.
- A legacy/import-style test showing an omitted `epic` update can preserve an unresolved migrated legacy reference.

### Out of Scope

- Rejecting unresolved curation/import/legacy references in canonical storage.
- SQLite schema or migration changes.
- Search-based epic matching or fuzzy resolution.
- UI/workstation behavior changes.

## Files

### Create

- `eforge/extensions/eforge-plan/backlog-epic-reference-validation.ts` — shared helper for strict direct-action epic existence checks. Suggested shape:
  - export `assertDirectActionEpicReferenceExists(cwd: string, epic: string | null | undefined, actionId: 'capture-item' | 'update-item'): void`.
  - return without error for `undefined`, `null`, or `""`.
  - call `readCanonicalEpic(cwd, epic)` for exact lookup.
  - throw `userActionError(...)` with `path: 'epic'` and details including the invalid id/action when lookup fails.
- `eforge/extensions/eforge-plan/__tests__/backlog-epic-reference-validation.test.ts` — dispatch-level coverage for the new guardrail and preserved bypass cases.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — import the helper, call it in `capture-item` after readiness/id checks and before `captureCanonicalBacklogItem`, call it in `update-item` before any legacy item migration or canonical update, and build the update payload so `epic` is omitted unless the action input contained `epic`.

## Test Plan

In `backlog-epic-reference-validation.test.ts`:

- Use `dispatchExtensionAction` plus `createExtensionRecorder` following existing eforge-plan action tests.
- Seed existing epics with `upsertCanonicalEpic` for valid-reference cases.
- Assert an invalid `capture-item` result has `kind === 'invalid-input'`, the message contains the invalid epic id, `get-epic`, `search-items`, `includeEpics`, and `upsert-epic`, and `listCanonicalBacklogItems(cwd)` returns an empty array afterward.
- Assert an invalid `update-item` result has `kind === 'invalid-input'`, the same guidance tokens, and a previously captured item still has the same `priority`, `tags`, `userStatus`, `epicRef`, and fixed `updatedAt` values it had before dispatch.
- Assert `capture-item` with an omitted `epic` succeeds and persists no `epicRef`.
- Assert `capture-item` with a valid existing epic succeeds and persists that `epicRef`.
- Assert `update-item` with an omitted `epic` succeeds and preserves any existing `epicRef` while applying another metadata change.
- Assert `update-item` with a valid existing epic succeeds and changes `epicRef` to that id.
- Assert `update-item` with `epic: ""` succeeds and leaves `readCanonicalBacklogItem(cwd, id)?.epicRef` undefined.
- Write a legacy `.backlog/items/<id>.md` record with `epic: legacy-missing-epic`, dispatch `update-item` without `epic`, and assert the migrated canonical item keeps `epicRef === 'legacy-missing-epic'`. This documents the intentional legacy/import bypass.

## Verification

- [ ] `capture-item` with `epic: "missing-epic"` returns `kind: "invalid-input"` and creates zero canonical backlog items.
- [ ] `update-item` with `epic: "missing-epic"` returns `kind: "invalid-input"` and leaves the seeded target row values unchanged.
- [ ] Invalid epic messages contain the invalid id plus `get-epic`, `search-items`, `includeEpics`, and `upsert-epic`.
- [ ] `capture-item` without `epic` succeeds and persists no `epicRef`.
- [ ] `capture-item` with an existing epic id succeeds and persists that `epicRef`.
- [ ] `update-item` without `epic` succeeds and preserves the previous `epicRef`.
- [ ] `update-item` with an existing epic id succeeds and persists that `epicRef`.
- [ ] `update-item` with `epic: ""` succeeds and clears `epicRef`.
- [ ] A legacy `.backlog` item with an unresolved epic can migrate through an omitted-epic `update-item` call and retain the unresolved `epicRef`.
- [ ] No SQLite migration file is added.
- [ ] Targeted eforge-plan tests exit 0.
- [ ] Repository type-check exits 0.
- [ ] Repository maintainability check exits 0.