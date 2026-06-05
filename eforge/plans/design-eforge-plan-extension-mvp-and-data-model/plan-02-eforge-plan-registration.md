---
id: plan-02-eforge-plan-registration
name: Eforge Plan Promotion, Lifecycle, Registration, and Docs
branch: design-eforge-plan-extension-mvp-and-data-model/plan-02-eforge-plan-registration
agents:
  builder:
    effort: high
    rationale: This plan connects the foundation helpers to extension action
      handlers, direct input-source handoff, lifecycle trace updates, and
      contribution metadata while preserving conservative status mutation rules.
  reviewer:
    effort: high
    rationale: Review must inspect registration shapes, side-effect metadata,
      lifecycle correlation, and user-facing documentation for trust and
      boundary claims.
  doc-author:
    effort: medium
    rationale: The README is a required deliverable with explicit capability, trust,
      storage, and deferred-platform sections.
---

# Eforge Plan Promotion, Lifecycle, Registration, and Docs

## Architecture Context

Plan 01 creates the reusable storage, domain, kanban, and trace helpers. This plan turns those helpers into the dogfoodable `eforge-plan` extension MVP. The extension owns backlog curation, session-plan promotion, direct build-source synthesis, trace sidecars, and current host/Console contribution metadata. The engine continues to consume normalized build source and emit typed lifecycle events.

Current Console extension contributions are declarative and render under `/console/system` using the closed renderer set: `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`. The MVP must not add custom Console routes, browser bundles, raw extension-owned HTTP routes, or AI planning/chat runtime APIs.

## Implementation

### Overview

Implement promotion/build-source synthesis, lifecycle correlation, action handlers, input-source adapter registration, Console/host contribution metadata, and README documentation. Add colocated tests for promotion, lifecycle behavior, and registration shape. If runtime input-source preprocessing does not pass the SDK-promised `InputTransformContext` into adapter `fetch(id, ctx)`, apply the narrow `@eforge-build/input` fix described below so `eforge-plan` can resolve `.backlog` from `ctx.cwd` without using `process.cwd()`.

### Key Decisions

1. `promote-item` is the primary handoff and writes a normal `.eforge/session-plans/<session>.md` artifact using the same synthesis helper as direct input-source output.
2. Direct input-source handoff registers adapter name `eforge-plan`, so `eforge://input/eforge-plan/<itemId>` compiles the backlog item into ordinary build-source Markdown.
3. Promotion never marks an item `shipped`; it marks the item `active` or leaves it `planned` based on action input/default.
4. Lifecycle handlers update trace sidecars only when correlation is unambiguous and mutate backlog status only for confirmed local merge or confirmed auto-merge evidence.
5. PR-open `landing:complete` events with `prUrl` and no merge confirmation record PR evidence but leave the item active.
6. All write actions declare `local-write`; read actions declare `local-read` or `none`; no MVP action declares `build-queue`.
7. Console contribution blocks are static declarative metadata plus action-backed controls. Dynamic board output is surfaced through `render-board-markdown` action invocation rather than top-level filesystem reads.

## Scope

### In Scope

- Implement backlog-item to session-plan promotion.
- Implement direct input-source build-source synthesis with missing-assumption and missing-acceptance guidance.
- Implement pure lifecycle update/correlation helpers and side-effect wrappers for event hooks.
- Register `list-board`, `capture-item`, `upsert-epic`, `update-item`, `promote-item`, and `render-board-markdown` actions.
- Register input-source adapter `eforge-plan`.
- Register declarative Console System contribution using only closed renderer IDs.
- Register host integration commands and action-backed deep links for board and promotion workflows.
- Register event hooks for enqueue, queue PRD, session, landing, and auto-merge lifecycle events.
- Add README documentation for capabilities, storage, trust, sidecars, lifecycle linkage, and deferred APIs.
- Add colocated tests for promotion, lifecycle behavior, and registration.
- Add a narrow input-source context runtime fix and existing package test only if `preprocessBuildSource` still calls adapter `fetch` without the promised context.

### Out of Scope

- Engine kernel changes.
- Daemon HTTP route changes.
- `@eforge-build/client` route-contract changes.
- First-class Console workstation route or arbitrary frontend bundle loading.
- Extension-owned browser JavaScript, custom React renderers, or raw HTTP routes.
- Extension-owned AI planning/chat runtime API.
- Replacing session plans, playbooks, or normalized build-source preprocessing.
- Bundling the extension into npm/core distribution.
- Npm/package version changes.
- Pi or Claude plugin changes.

## Files

### Create

- `eforge/extensions/eforge-plan/promote.ts` — session-plan and direct build-source synthesis, session id generation, promotion write helper, and shared readiness/missing-guidance helpers.
- `eforge/extensions/eforge-plan/lifecycle.ts` — pure lifecycle event correlation, trace update decisions, and conservative item status mutation decisions.
- `eforge/extensions/eforge-plan/README.md` — reference extension documentation, trust warning, storage model, kanban semantics, actions, input source, Console/host surfaces, trace sidecars, promotion flow, lifecycle rules, and deferred platform gaps.
- `eforge/extensions/eforge-plan/__tests__/promotion.test.ts` — promotion and input-source synthesis tests.
- `eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts` — lifecycle trace and status-decision tests.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — extension load/registration manifest-shape tests.

### Modify

- `eforge/extensions/eforge-plan/index.ts` — replace the Plan 01 no-op factory with action, input-source, Console contribution, integration command, deep-link, and event-hook registrations.
- `packages/input/src/extension-normalize.ts` — only if needed: pass the existing SDK-promised `InputTransformContext` as the second argument to input-source adapter `fetch(id, ctx)` calls. Keep this fix limited to input-source fetch context unless implementation work reveals a separate source-scoped need.
- `test/input-extension-normalization.test.ts` — only if `packages/input/src/extension-normalize.ts` changes: add a targeted regression test proving context-aware input sources receive `ctx.cwd`, `ctx.originalSource`, `ctx.sourceKind: 'extension-reference'`, and adapter/source metadata while existing one-argument adapters still work.

## Implementation Notes

### Promotion and input source

- Use `resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] })` for session-plan storage.
- Generate session plan frontmatter compatible with existing session-plan workflow: `session`, `topic`, `status`, `planning_type`, `planning_depth`, `required_dimensions`, `optional_dimensions`, `skipped_dimensions`, `open_questions`, and `profile`.
- Include generated sections for Context, Scope, Assumptions, Design Decisions, Acceptance Criteria, Source Backlog Evidence, Source Epic Evidence, and Dependency Context.
- Include source backlog item id in both session-plan body and trace sidecar.
- Use the same synthesis helper for `promote-item` and input-source fetch output.
- Input-source fetch must use `ctx.cwd` when provided. If a caller invokes the adapter without a context, return instructional Markdown that states `eforge-plan` requires an input-source context instead of reading from `process.cwd()`.
- Direct input-source output must include item claim, evidence, assumptions or missing-assumption guidance, and acceptance criteria or missing-criteria guidance.

### Actions and contributions

- Use `defineExtensionAction`, `defineConsoleContribution`, `defineIntegrationCommand`, and `defineExtensionDeepLink` from the extension SDK.
- Keep all action input schemas object-root TypeBox schemas.
- Add output schemas for JSON-safe action responses.
- `list-board` returns epics, items, lanes, blocked reasons, and trace summaries.
- `render-board-markdown` returns `{ markdown: string }` for host/Console display.
- `capture-item` creates `.backlog/items/<id>.md` from title, claim, evidence, tags, priority, epic, and dependencies.
- `upsert-epic` creates or updates `.backlog/epics/<id>.md` without duplicating item membership lists.
- `update-item` updates status, priority, tags, evidence/recheck notes, dependencies, and epic link while preserving body content.
- `promote-item` writes a session plan, updates trace evidence, and sets status to action-selected `active` or `planned`; it never sets `shipped`.
- Console contribution blocks must use only `text`, `markdown`, `status-badge`, `link`, `action-button`, and `action-form`.
- Register at least one integration command for board rendering and one for promotion.
- Register at least one action-backed deep link for board rendering and one for promotion.

### Lifecycle linkage

- Register hooks for `enqueue:start`, `enqueue:complete`, `queue:prd:start`, `queue:prd:complete`, `session:start`, `session:end`, `landing:complete`, and `landing:auto-merge:complete`.
- Route hook work through pure helpers in `lifecycle.ts`; the hook wrapper owns reading/writing traces and backlog status updates.
- Correlate events from promoted session-plan paths, input-source source ids, `enqueue:complete.id`, `queue:prd:complete.prdId`, and event envelope `sessionId`/`runId` when present.
- Update trace sidecars idempotently by stable keys: `session`, `prdId`, `sessionId`, and `featureBranch` or `commitSha`.
- Failed and skipped queue results update trace evidence without marking items `stale`, `superseded`, or `shipped`.
- `landing:complete` with `prUrl` and no merge confirmation records the PR link and leaves the item active.
- `landing:complete` with confirmed local merge evidence may mark the item `shipped`.
- `landing:auto-merge:complete` may mark the item `shipped`.
- Ambiguous correlation writes no backlog status mutation. Record diagnostic trace evidence only when a single trace can be identified.

### Documentation

- README must document the reference-extension purpose, project-team trust requirement, unsandboxed-code warning, `.backlog` storage, derived kanban semantics, actions, Console surfaces, host command/deep-link surfaces, input-source URI, trace sidecar location, trace-owned data, promotion flow, conservative lifecycle rules, deferred Console workstation API, deferred AI planning/chat API, and bundled-extension promotion as TBD.
- Use Mermaid for any diagrams.
- Do not document private daemon routes or inline `/api/...` paths as extension author contracts.

## Verification

- [ ] `registration.test.ts` imports the extension factory without creating `.backlog`, `.eforge/extension-data`, or `.eforge/extensions/eforge-plan` runtime data.
- [ ] `registration.test.ts` records six actions with ids `list-board`, `capture-item`, `upsert-epic`, `update-item`, `promote-item`, and `render-board-markdown`.
- [ ] `registration.test.ts` verifies each action input schema has `type: 'object'` and each write action declares `local-write` side effects.
- [ ] `registration.test.ts` verifies read actions declare `local-read` or `none` and no MVP action declares `build-queue`.
- [ ] `registration.test.ts` verifies action output schemas are JSON-safe and `list-board` output includes epics, items, lanes, blocked reasons, and trace summaries.
- [ ] `registration.test.ts` records input-source adapter `eforge-plan`.
- [ ] `registration.test.ts` records a Console contribution whose block renderer ids are all in the closed renderer set.
- [ ] `registration.test.ts` verifies the Console contribution includes a board-summary text or markdown block and a status-badge block.
- [ ] `registration.test.ts` verifies the Console contribution exposes action-button or action-form controls for list/render-board, promote, capture, and update workflows.
- [ ] `registration.test.ts` records action-backed integration commands and deep links for both board rendering and promotion workflows.
- [ ] `registration.test.ts` records hooks for enqueue, queue PRD, session, landing, and auto-merge lifecycle events.
- [ ] `promotion.test.ts` verifies `promote-item` writes `.eforge/session-plans/<session>.md` and does not mark an item `shipped`.
- [ ] `promotion.test.ts` verifies generated session-plan Markdown contains Context, Scope, Assumptions, Design Decisions, Acceptance Criteria, source backlog evidence, source epic evidence, and dependency context.
- [ ] `promotion.test.ts` verifies direct input-source output uses the same synthesis helper and includes claim, evidence, assumptions or missing-assumption guidance, and acceptance criteria or missing-criteria guidance.
- [ ] `lifecycle.test.ts` verifies correlation can use promoted session-plan paths, input-source ids, `enqueue:complete` ids, `queue:prd:complete` PRD ids, `sessionId`, and `runId` when a single trace matches.
- [ ] `lifecycle.test.ts` verifies failed and skipped queue results update trace evidence without status changes to `stale`, `superseded`, or `shipped`.
- [ ] `lifecycle.test.ts` verifies PR-open landing evidence records `prUrl` and leaves item status active.
- [ ] `lifecycle.test.ts` verifies confirmed local merge evidence and auto-merge completion can set item status to `shipped`.
- [ ] `lifecycle.test.ts` verifies ambiguous correlation writes no backlog status mutation.
- [ ] If `packages/input/src/extension-normalize.ts` changes, `test/input-extension-normalization.test.ts` verifies context-aware input-source adapters receive `ctx.cwd` and existing one-argument adapters still work.
- [ ] `eforge/extensions/eforge-plan/README.md` contains all required capability, trust, storage, sidecar, lifecycle, and deferred-platform sections.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/*.test.ts test/input-extension-normalization.test.ts` exits 0 when the input normalization test file is modified; otherwise `pnpm test -- eforge/extensions/eforge-plan/__tests__/*.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
