---
id: plan-02-dogfood-docs
name: Dogfood Extension Storage Convention and Update Docs
branch: add-scoped-eforge-project-path-helpers-to-the-extension-sdk/plan-02-dogfood-docs
---

# Dogfood Extension Storage Convention and Update Docs

## Architecture Context

After `plan-01-sdk-runtime-paths`, the SDK exposes scoped paths and runtime contexts provide `ctx.paths`. This plan migrates the motivating `eforge-plan` trace sidecars to the extension-owned storage convention, leaves built-in session-plan artifacts under `.eforge/session-plans/`, audits `eforge-guardrails`, and updates local/public docs.

## Implementation

### Overview

Use the new helper in the project-team `eforge-plan` extension for trace sidecar storage, keep promotion outputs in the existing session-plan location, and document both the SDK helper and the storage model.

### Key Decisions

1. Trace sidecars are private extension-owned metadata, so they move to `.eforge/storage/extensions/eforge-plan/traces/<itemId>.json`.
2. Promoted session plans are user-facing eforge workflow artifacts, so they remain `.eforge/session-plans/<session>.md`.
3. `eforge-guardrails` has no extension-owned storage concern; do not add a no-op `ctx.paths` reference unless the audit finds a real path-resolution use.
4. Generated public docs must stay in sync with source docs after `pnpm docs:generate` or the equivalent generator path.

## Scope

### In Scope

- Migrate `eforge-plan` trace path resolution from legacy `.eforge/extension-data/eforge-plan/traces` composition to the new extension-owned storage helper/convention.
- Add or keep a code comment/test explaining why promotion continues to use `.eforge/session-plans/`.
- Update `eforge-plan` storage tests and any registration/lifecycle/promotion tests with path expectations affected by the trace move.
- Audit `eforge-guardrails` and leave behavior unchanged when no storage use exists.
- Document `createEforgeProjectPaths`, `ctx.paths`, storage scopes, extension-owned storage convention, IO-free behavior, and non-sandbox semantics.
- Update generated public docs.

### Out of Scope

- Moving promoted session plans to extension-owned storage.
- Adding an atomic storage abstraction.
- Adding custom session-plan/playbook extraction APIs, daemon routes, Console plugin bundles, or raw extension-owned HTTP routes.
- Adding meaningless `ctx.paths` usage to `eforge-guardrails`.

## Files

### Modify

- `eforge/extensions/eforge-plan/trace-store.ts` — resolve trace sidecar root/file paths with `createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }).extensionStoragePath('project-local', ['traces', ...])` or the equivalent exported helper.
- `eforge/extensions/eforge-plan/promote.ts` — keep `.eforge/session-plans/` for promoted session plans; add an implementation comment or helper boundary that states this is a built-in workflow path, not extension-owned private storage.
- `eforge/extensions/eforge-plan/README.md` — update storage model, Mermaid diagram, and trace sidecar section to `.eforge/storage/extensions/eforge-plan/traces/<itemId>.json`.
- `eforge/extensions/eforge-plan/__tests__/storage.test.ts` — assert trace paths use `.eforge/storage/extensions/eforge-plan/traces/<itemId>.json`, do not use `.eforge/extensions/eforge-plan`, and no longer use `.eforge/extension-data/eforge-plan/traces`.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update side-effect-free registration assertions if they mention the old trace directory.
- `eforge/extensions/eforge-plan/__tests__/promotion.test.ts` — assert promoted session plans still land under `.eforge/session-plans/` after the trace migration.
- `packages/extension-sdk/README.md` — replace the project-local-only helper section with scoped helper docs and add `ctx.paths` examples.
- `docs/extensions-api.md` — document helper signatures/types, context `paths` fields, storage convention, IO-free behavior, and non-sandbox semantics.
- `web/content/docs/extensions-api.md` — keep public content source aligned with `docs/extensions-api.md`.
- `web/public/docs/extensions-api.md` — update generated public artifact after docs generation.

### Audit Without Expected Edit

- `eforge/extensions/eforge-guardrails/index.ts` — confirm the validation provider continues to use `ctx.logger`, `ctx.planId`, and `ctx.exec.run(..., { cwd: planOutputDir })` only; do not add a storage path reference without a storage need.

## Verification

- [ ] `resolveTracePath(cwd, 'item-1')` returns a path containing `.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}traces${sep}item-1.json`.
- [ ] `resolveTracePath(cwd, 'item-1')` does not contain `.eforge${sep}extensions${sep}eforge-plan${sep}`.
- [ ] `resolveTracePath(cwd, 'item-1')` does not contain `.eforge${sep}extension-data${sep}eforge-plan${sep}`.
- [ ] `promoteBacklogItem` writes session plans under `.eforge/session-plans/`.
- [ ] `promote.ts` contains a comment or helper boundary documenting that session plans remain built-in workflow artifacts under `.eforge/session-plans/`.
- [ ] `eforge-guardrails` behavior is unchanged when the audit finds no extension-owned storage use.
- [ ] `packages/extension-sdk/README.md` documents scoped roots, `ctx.paths`, extension-owned storage, IO-free helpers, and trusted-unsandboxed semantics.
- [ ] `docs/extensions-api.md` documents scoped roots, `ctx.paths`, extension-owned storage, IO-free helpers, and trusted-unsandboxed semantics.
- [ ] `web/content/docs/extensions-api.md` matches the local extension API documentation for the new helper section.
- [ ] `web/public/docs/extensions-api.md` is regenerated from the updated docs source.
- [ ] `pnpm docs:check` passes after this plan.
