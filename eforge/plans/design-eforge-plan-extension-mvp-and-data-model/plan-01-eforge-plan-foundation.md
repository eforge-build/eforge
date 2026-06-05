---
id: plan-01-eforge-plan-foundation
name: "Eforge Plan Foundation: Storage, Domain, Kanban, and Trace"
branch: design-eforge-plan-extension-mvp-and-data-model/plan-01-eforge-plan-foundation
agents:
  builder:
    effort: high
    rationale: This plan creates the extension's data-model helpers,
      Markdown/frontmatter storage, path-safety checks, and kanban projection;
      the work is localized but has several invariants around file safety and
      human-authored content preservation.
  reviewer:
    effort: high
    rationale: Review must inspect path containment, source-of-truth boundaries, and
      frontmatter/body preservation for local filesystem writes.
---

# Eforge Plan Foundation: Storage, Domain, Kanban, and Trace

## Architecture Context

This plan lays the data-model foundation for the committed project-team native extension at `eforge/extensions/eforge-plan/`. The engine remains unaware of `.backlog` files, backlog statuses, kanban lanes, and trace sidecars. Durable planning content lives in `.backlog/items/*.md` and `.backlog/epics/*.md`; runtime linkage/cache data lives under `.eforge/extension-data/eforge-plan/` via `resolveProjectLocalStoragePath`.

Existing project-team extension code in `eforge/extensions/eforge-guardrails/` imports SDK types from `../../../packages/extension-sdk/src/index`. Follow that pattern where the extension needs SDK imports so runtime loading works without relying on a package alias from the repository root.

## Implementation

### Overview

Create the extension directory with a side-effect-free factory stub and focused foundation modules for schemas, domain normalization, Markdown storage, trace sidecars, and kanban projection. Add colocated tests for storage and kanban behavior, then update the main Vitest include list so extension tests travel with the extension.

### Key Decisions

1. `.backlog` Markdown remains the source of truth for item and epic content; `.eforge/extension-data/eforge-plan/` contains trace/cache evidence only.
2. `blocked` is derived from unresolved `depends_on` references. It is not persisted as a backlog status.
3. `index.ts` is created as a no-op `defineEforgeExtension` factory in this plan to keep the directory layout discoverable. Plan 02 replaces the stub with action, contribution, input-source, and event-hook registrations.
4. Storage helpers reject unsafe item/epic ids before writing paths and perform containment checks for all generated paths.
5. Frontmatter updates preserve Markdown body/title content and serialize known fields in a stable order.

## Scope

### In Scope

- Create `eforge/extensions/eforge-plan/` foundation files.
- Define status, lane, item, epic, action-schema, board-output, and trace types/schemas.
- Read and write existing `.backlog/items/*.md` and `.backlog/epics/*.md` records.
- Preserve body sections while updating frontmatter.
- Reject unsafe ids for write paths.
- Read/write trace sidecars under `.eforge/extension-data/eforge-plan/traces/<itemId>.json`.
- Derive kanban lanes and explanatory reasons from items, dependencies, and trace summaries.
- Add colocated `storage.test.ts` and `kanban.test.ts`.
- Update `vitest.main.config.ts` to include `eforge/extensions/**/__tests__/**/*.test.ts`.

### Out of Scope

- Action handlers and contribution registration beyond the no-op factory stub.
- Promotion-to-session-plan generation.
- Lifecycle event hooks.
- README documentation.
- Engine, daemon HTTP API, client route contract, Console UI, Pi package, or Claude plugin changes.

## Files

### Create

- `eforge/extensions/eforge-plan/index.ts` — side-effect-free `defineEforgeExtension` factory stub for a supported directory extension layout.
- `eforge/extensions/eforge-plan/schema.ts` — domain literal sets and TypeBox object-root schemas for actions and board outputs.
- `eforge/extensions/eforge-plan/backlog-domain.ts` — item/epic normalization, status validation, dependency helpers, title/section extraction, and trace-summary type helpers.
- `eforge/extensions/eforge-plan/markdown-store.ts` — safe Markdown/frontmatter read/write helpers for `.backlog/items` and `.backlog/epics`.
- `eforge/extensions/eforge-plan/kanban.ts` — lane projection with lane membership, blocked reasons, active-trace reasons, and archive/done handling.
- `eforge/extensions/eforge-plan/trace-store.ts` — schema-versioned trace sidecar path resolution, read/write helpers, trace summaries, and idempotent entry upsert primitives.
- `eforge/extensions/eforge-plan/__tests__/storage.test.ts` — storage tests for frontmatter parsing/writing, safe ids, item/epic loading, body preservation, and trace path location.
- `eforge/extensions/eforge-plan/__tests__/kanban.test.ts` — kanban tests for lane projection, dependency blocking, active trace handling, done/archive lanes, and lane reasons.

### Modify

- `vitest.main.config.ts` — include `eforge/extensions/**/__tests__/**/*.test.ts` in the main Vitest project.

## Implementation Notes

- Use `yaml` for frontmatter parsing/stringifying; it is already available in the repository.
- Treat missing `.backlog/items`, `.backlog/epics`, and trace directories as empty collections for read/list operations.
- Create directories only inside write operations.
- Keep all modules import-safe: no top-level filesystem writes, daemon mutations, network calls, or environment-dependent behavior.
- Use `resolveProjectLocalStoragePath({ cwd, segments: ['extension-data', 'eforge-plan', ...] })` for trace storage; never use `.eforge/extensions/eforge-plan/` for runtime data.
- Known item frontmatter order: `id`, `status`, `priority`, `source`, `created`, `updated`, `last_checked`, `stale_after`, `tags`, `depends_on`, `epic`, `eforge_plan`.
- Known epic frontmatter order: `id`, `status`, `priority`, `source`, `created`, `updated`, `last_checked`, `stale_after`, `tags`, `eforge_plan`.
- Status validation accepts exactly `candidate`, `planned`, `active`, `shipped`, `stale`, and `superseded`.
- Read helpers may preserve unknown frontmatter fields, but new extension metadata must be namespaced under `eforge_plan` if introduced.

## Verification

- [ ] `eforge/extensions/eforge-plan/index.ts` imports without filesystem mutation and exports a native extension factory.
- [ ] `storage.test.ts` verifies item frontmatter fields `id`, `status`, `priority`, `source`, `created`, `updated`, `last_checked`, `stale_after`, `tags`, optional `depends_on`, and optional `epic`.
- [ ] `storage.test.ts` verifies epic frontmatter fields `id`, `status`, `priority`, `source`, `created`, `updated`, `last_checked`, `stale_after`, and `tags`.
- [ ] `storage.test.ts` verifies frontmatter updates preserve Markdown title/body content.
- [ ] `storage.test.ts` verifies unsafe ids containing path separators, null bytes, `.` or `..` are rejected before write paths are produced.
- [ ] `storage.test.ts` verifies trace paths are under `.eforge/extension-data/eforge-plan/traces/` and not under `.eforge/extensions/eforge-plan/`.
- [ ] `storage.test.ts` verifies new trace sidecars include `schemaVersion`, item id, epic id, promoted session plans, queue PRDs, build run ids, build session ids, landing results, and last event metadata fields.
- [ ] `storage.test.ts` verifies trace upsert helpers are idempotent by `session`, `prdId`, `sessionId`, and `featureBranch` or `commitSha`.
- [ ] `kanban.test.ts` verifies `blocked` appears only as a derived lane/reason and never as an accepted persisted status.
- [ ] `kanban.test.ts` verifies Inbox, Ready, Blocked, In progress, Done, and Archive lane membership for candidate/planned/active/shipped/stale/superseded records.
- [ ] `kanban.test.ts` verifies unresolved dependencies move open items to Blocked and closed dependencies unblock them.
- [ ] `kanban.test.ts` verifies active session-plan, queue, or run trace entries move an item to In progress.
- [ ] `vitest.main.config.ts` includes `eforge/extensions/**/__tests__/**/*.test.ts`.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/storage.test.ts eforge/extensions/eforge-plan/__tests__/kanban.test.ts` exits 0.
- [ ] `pnpm maintainability:check` reports no new file-size or region-marker violations for the new extension files.
