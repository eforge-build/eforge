---
title: Validate Backlog Epic References
created: 2026-06-26
---

# Validate Backlog Epic References

## Problem / Motivation

Direct `eforge-plan` backlog item writes can currently persist an `epic` reference that does not correspond to any backlog epic. The observed failure mode was `capture-item` accepting `epic: "extension-platform"`, creating an item with a nonexistent epic reference and causing hidden backlog data drift.

Reproduction:

1. Start from an `eforge-plan` private planning store that does not contain an epic with id `extension-platform`.
2. Invoke the `capture-item` action with a normal item payload and `epic: "extension-platform"`.
3. Observe that the item is accepted and the canonical/sqlite backlog storage preserves the unresolved epic reference instead of rejecting it.
4. Invoke `update-item` on an existing item with a different nonexistent non-empty `epic` id.
5. Observe that the update path also accepts and persists the unresolved reference, while `get-epic` cannot resolve that id.
6. Preserve the separate behavior where `update-item` with `epic: ""` clears the epic reference.

Root cause:

- The direct action path validates the shape of the payload but not the referential integrity of `epic`.
- The `capture-item` and `update-item` schemas accept optional epic strings, and the handlers pass non-empty values into canonical storage.
- `backlog-capture-guardrails.ts` focuses on capture readiness rather than epic existence.
- `canonical/backlog-records.ts` persists `epicRef` from input.
- `sqlite/schema.ts` stores `epic_ref` without a foreign-key constraint to epic ids.
- The separate `backlog-curation-apply.ts` path already validates unknown epic metadata, but that check is not wired into direct action handlers.

## Goal

Add a direct-action data-integrity guardrail in `eforge-plan` so `capture-item` and `update-item` reject non-empty epic ids that are not present in the private planning store.

Preserve existing no-epic behavior, valid existing epic behavior, and empty-string update clearing.

## Approach

- Touch the `eforge-plan` action handlers and shared validation/test utilities around backlog writes.
- Add or reuse a shared helper for direct-action epic validation.
- Call the validation helper before canonical backlog item writes.
- Treat only non-empty epic values as candidates for existence validation.
- Preserve the existing empty-string clear semantics on update.
- Prefer an exact store lookup by epic id so the error can name the invalid id and avoid ambiguous search semantics.
- Keep curation/import/legacy behavior explicit.
- Reuse the helper only where strict validation is desired, or document why permissive paths bypass it.
- Leave curation/import or legacy unresolved-reference paths intentionally permissive where already designed.
- Avoid broad schema or storage rewrites unless source inspection shows a small, safe supporting change.
- Do not rely solely on a sqlite foreign-key migration.
- Build confidence through dispatch-level capture/update tests, legacy/import allowance coverage, and standard type/test checks.
- Confidence is high because the gap is localized and the curation-apply path already demonstrates the intended validation semantics.

## Scope

In scope:

- Direct `capture-item` epic reference validation.
- Direct `update-item` epic reference validation.
- Shared validation and test utilities around backlog writes.
- Dispatch/action-level tests for invalid `capture-item` epic ids.
- Dispatch/action-level tests for invalid `update-item` epic ids.
- Positive tests for valid epic references.
- Positive tests for omitted epic values.
- Positive tests for empty-string update clearing.
- Coverage for import or migration paths that intentionally permit unresolved legacy epic references.

Out of scope:

- Making curation/import/legacy unresolved-reference paths reject unknown epics where they are intentionally permissive.
- Broad schema or storage rewrites unless source inspection shows a small, safe supporting change.
- A solution that relies solely on a sqlite foreign-key migration.

## Acceptance Criteria

- `capture-item` rejects a non-empty `epic` value when no matching backlog epic exists.
- `update-item` rejects a non-empty `epic` value when no matching backlog epic exists.
- The `capture-item` rejection message names the invalid epic id.
- The `capture-item` rejection message guides the user toward `get-epic`, `search-items` with `includeEpics`, or creating/upserting the epic first.
- The `update-item` rejection message names the invalid epic id.
- The `update-item` rejection message guides the user toward `get-epic`, `search-items` with `includeEpics`, or creating/upserting the epic first.
- A failed `capture-item` with an invalid non-empty `epic` value creates zero new backlog items.
- A failed `update-item` with an invalid non-empty `epic` value leaves the target record unmutated.
- Direct writes without an epic continue to work.
- Direct writes with a valid existing epic continue to work.
- `update-item` with `epic: ""` clears the epic reference.
- Tests cover invalid `capture-item` epic ids at the dispatch/action level.
- Tests cover invalid `update-item` epic ids at the dispatch/action level.
- Tests cover valid epic references.
- Tests cover omitted epic values.
- Tests cover empty-string update clearing.
- Tests cover any import or migration path that intentionally permits unresolved legacy epic references.
- Direct action validation is present at the application boundary before canonical backlog item writes.
- The change does not rely solely on a sqlite foreign-key migration.
- Targeted `eforge-plan` tests exit 0.
- Repository type-check exits 0.
- Repository maintainability checks exit 0 if touched files warrant running them.