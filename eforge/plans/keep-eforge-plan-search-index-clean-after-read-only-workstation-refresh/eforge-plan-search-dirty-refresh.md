---
id: eforge-plan-search-dirty-refresh
name: Keep eforge-plan search dirty tracking stable across no-op refreshes
branch: keep-eforge-plan-search-index-clean-after-read-only-workstation-refresh/eforge-plan-search-dirty-refresh
---

# Keep eforge-plan search dirty tracking stable across no-op refreshes

Implement the eforge-plan synchronization/search-index change as one cohesive unit. Keep the implementation boundary localized to canonical session-plan synchronization, primarily `eforge/extensions/eforge-plan/canonical/session-plan-records.ts`, plus focused eforge-plan Vitest coverage under `eforge/extensions/eforge-plan/__tests__/`.

## Scope and invariants

- Update `syncSessionPlanArtifactRecord` so it no longer calls `markCanonicalSearchDirty` unconditionally for the session plan and linked backlog items/epics.
- Decide search dirtiness by comparing search-relevant canonical session-plan fields and the normalized linked backlog-item/epic relationship set before and after synchronization.
- Treat unchanged artifact synchronization, including read-only workstation refreshes that load `list-planning-artifacts`, as a no-op for search dirty flags.
- Preserve canonical SQLite session-plan status, lifecycle, and synchronization metadata behavior; do not short-circuit the sync/load path merely to avoid dirty marking.
- Preserve explicit dirty marking for genuine canonical writes: session-plan content changes, backlog-item changes, epic changes, and relationship changes must still dirty exactly the affected search documents.
- Keep unrelated evidence paths out of scope unless a direct test dependency proves otherwise; this plan should not change plugin, CI, release-doc, guardrails, or generic backlog-curation behavior.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:interface:test, ac-005:subsystem:test

## Validation

Add or update focused Vitest regression coverage under `eforge/extensions/eforge-plan/__tests__/` (for example, a dedicated `session-plan-search-index-dirty.test.ts` file if no focused session-plan/search-index test file already exists) covering:

- unchanged session-plan synchronization leaves existing dirty state untouched;
- meaningful session-plan canonical content changes dirty the session-plan document and any linked documents whose search text depends on the changed content;
- relationship changes dirty the session plan plus the added/removed linked backlog-item or epic documents as appropriate;
- genuine backlog-item or epic canonical changes continue to dirty those affected documents through their existing write paths;
- a rebuilt ready search index remains `ready` after a read-only workstation refresh sequence that loads `list-planning-artifacts` and finds no canonical planning-data changes.

Run the targeted Vitest command for the touched/added test file, for example:

```bash
pnpm test -- eforge/extensions/eforge-plan/__tests__/session-plan-search-index-dirty.test.ts
```

Also run `pnpm test` when practical to keep the workspace checks green.

## Fragment: No-op session-plan refresh should not dirty search index

Implement one cohesive eforge-plan change: make session-plan synchronization decide search dirty status from canonical search-relevant content and relationships, not from artifact refresh/write activity alone. A read-only workstation refresh that observes identical session-plan artifacts should be a no-op for search dirty flags and should leave a rebuilt index in `ready`. Preserve dirty marking for actual changes to a session plan, linked backlog item/epic, or their relationships. Add regression tests in the eforge-plan test suite for unchanged synchronization, meaningful synchronization changes, and the workstation refresh sequence.

## Execution Intent

Test ownership: builder
Review depth: standard
Review rationale: no risk factors; declared docs work none, test work author-new, test owner builder; model review intent standard (The change is localized but correctness-sensitive because dirty tracking controls search freshness and rebuild behavior; standard review should inspect canonical comparison boundaries and regression assertions.); derived build implement -> test-cycle -> review-cycle and auto review with perspectives code, test, 1 round(s), standard evaluation