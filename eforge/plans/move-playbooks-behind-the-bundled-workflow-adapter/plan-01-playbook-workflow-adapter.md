---
id: plan-01-playbook-workflow-adapter
name: Add Bundled Playbook Workflow Adapter
branch: move-playbooks-behind-the-bundled-workflow-adapter/plan-01-playbook-workflow-adapter
agents:
  builder:
    effort: high
    rationale: This is a cross-package ownership-boundary refactor that must
      preserve existing daemon route behavior while introducing a new public
      input adapter surface.
  reviewer:
    effort: high
    rationale: Review needs to check boundary discipline, route contract
      preservation, and documentation consistency.
---

# Add Bundled Playbook Workflow Adapter

## Architecture Context

Playbook helpers currently sit in `packages/input/src/playbook.ts`, but `packages/monitor/src/routes/playbook-service.ts` still imports and calls those lower-level helpers directly. Session plans already follow a bundled adapter boundary via `packages/input/src/session-planning-workflow.ts` and monitor services call `createSessionPlanningWorkflowAdapter()` as a compatibility shim around client-owned route contracts.

This plan adds the matching bundled playbook adapter in `@eforge-build/input`. The engine remains input-agnostic and receives only normalized build source. The client route map and host integrations remain compatibility surfaces; do not remove or rename existing `/api/playbook/*`, `/api/session-plan/create-from-playbook`, `eforge_playbook`, `eforge playbook`, or `/eforge:playbook` surfaces.

## Implementation

### Overview

Create `packages/input/src/playbook-workflow.ts` with a descriptor-bearing adapter that wraps the existing playbook protocol and session-plan seed helpers. Refactor `packages/monitor/src/routes/playbook-service.ts` to use the adapter for playbook-domain behavior while retaining daemon orchestration concerns in the service. Add direct adapter tests, strengthen source-contract tests, and update documentation that still describes bundled playbook extraction as deferred.

### Key Decisions

1. Use a new adapter file instead of moving or rewriting `packages/input/src/playbook.ts`; that file remains the lower-level protocol implementation.
2. Keep route contracts stable by leaving `packages/client/src/routes/route-map.ts` and existing client API helpers unchanged.
3. Keep daemon orchestration in `playbook-service.ts`: landing-action validation, queue dependency handling, profile lookup, acceptance-criteria inventory derivation, `enqueuePrd()`, and scheduler notification stay outside `@eforge-build/input`.
4. Make planning-mode `sessionPlanCreateFromPlaybook` input-domain creation adapter-owned, but map HTTP-specific error text and status codes in the monitor service because `@eforge-build/input` must not import `@eforge-build/client`.
5. Expose the descriptor with a three-tier scope representation. Use `sourceScopes: ['project-local', 'project-team', 'user']` to distinguish the playbook tiers from the session-plan adapter's single `sourceScope: 'project-local'` descriptor.

## Scope

### In Scope

- Add `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR`, `createPlaybookWorkflowAdapter()`, adapter interfaces, adapter option/result types, and adapter-specific domain error/type guards in `@eforge-build/input`.
- Adapter surface named `scoped` with methods for `list`, `load`, `save`, `write`, `move`, `promote`, `demote`, `copy`, `validateRaw`, `compileAutonomous`, and `seedPlanningSessionPlan`.
- Refactor monitor playbook services to obtain the adapter lazily and call adapter methods for playbook list/load/save/write/move/promote/demote/copy/validate/compile/session-plan-seed behavior.
- Preserve existing playbook Markdown frontmatter/body format, scope precedence, shadow semantics, autonomous run behavior, and planning-mode `requires-agent` run behavior.
- Add direct adapter tests and source-contract tests that enforce the new boundary.
- Update docs to state that bundled playbook adapter support is shipped while user-authored native workflow registration remains future or unsupported.

### Out of Scope

- No route renames or removals in `packages/client/src/routes/route-map.ts`.
- No behavior changes in CLI, Pi, Claude Code plugin, MCP proxy, or host playbook command files unless type-check exposes a bounded compatibility issue.
- No native extension SDK registration API for custom playbook extraction.
- No engine dependency on playbooks or `@eforge-build/input`.
- No `@eforge-build/input` imports from `@eforge-build/client`, `@eforge-build/engine`, monitor route helpers, or daemon HTTP clients.
- No broad rewrite of `packages/input/src/playbook.ts`.

## Files

### Create

- `packages/input/src/playbook-workflow.ts` — bundled playbook workflow adapter, descriptor, public adapter types, and adapter-specific domain errors/type guards.
- `test/playbook-workflow.test.ts` — direct adapter coverage for descriptor, list/load/save/move/promote/demote/copy/raw validation/autonomous compilation/planning seed creation/import-boundary assertions.

### Modify

- `packages/input/src/index.ts` — bounded export additions for the playbook workflow adapter factory, descriptor, types, and adapter error/type guards.
- `packages/monitor/src/routes/playbook-service.ts` — replace direct calls to lower-level playbook/session-plan helpers with lazy `createPlaybookWorkflowAdapter()` usage; preserve daemon orchestration and HTTP error mapping.
- `packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` — add playbook service adapter-boundary assertions and forbidden direct-helper call checks.
- `packages/input/README.md` — add a bundled playbook workflow adapter section analogous to the session-planning adapter section.
- `README.md` — describe playbooks as owned by the bundled playbook workflow adapter before normalized build source reaches the engine.
- `docs/architecture.md` — update the package diagram/route-flow prose to show `client` → `monitor compatibility shim` → `input bundled playbook adapter` → lower-level input helpers.
- `docs/config.md` — describe scoped playbooks as managed through the bundled playbook workflow adapter and remove broad wording that marks bundled playbook extraction as deferred.
- `docs/extensions.md` — distinguish shipped internal bundled playbook adapter support from future user-authored native workflow registration.
- `docs/extensions-api.md` — remove broad deferred wording for bundled playbook extraction while preserving future/unsupported status for user-authored workflow registration.
- `packages/extension-sdk/README.md` — same shipped-vs-future wording update for extension authors.

## Implementation Details

### `packages/input/src/playbook-workflow.ts`

- Import only from Node built-ins and local input modules (`./playbook.js`, `./session-plan.js`, and `./acceptance-criteria-quality.js` if save validation remains adapter-owned). Do not import `@eforge-build/client`, `@eforge-build/engine`, monitor modules, or daemon clients.
- Export:
  - `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR` with `{ id: 'builtin:playbooks', kind: 'workflow-input-adapter', sourceScopes: ['project-local', 'project-team', 'user'] } as const`.
  - `PlaybookWorkflowAdapter` with `descriptor` and `scoped` surface.
  - Option/result types for save draft input, promote/demote input, planning seed input/result, and any adapter-specific errors.
  - Type guards for adapter-specific errors so monitor code can map them without inspecting private fields.
- `scoped.list(opts)` delegates to `listPlaybooks(opts)`.
- `scoped.load(opts)` delegates to `loadPlaybook(opts)`.
- `scoped.write(opts)` delegates to `writePlaybook(opts)` for callers that already have a typed `Playbook`.
- `scoped.save(opts)` accepts `{ configDir, cwd, scope, frontmatter, body }`, validates frontmatter/body with the existing playbook schema and field rules currently in `savePlaybook`, runs the existing acceptance-criteria quality gate before writing, then writes through `writePlaybook()`.
- `scoped.move(opts)` delegates to `movePlaybook(opts)`.
- `scoped.promote(opts)` calls `movePlaybook({ fromScope: 'project-local', toScope: 'project-team' })`.
- `scoped.demote(opts)` calls `movePlaybook({ fromScope: 'project-team', toScope: 'project-local' })`.
- `scoped.copy(opts)` delegates to `copyPlaybookToScope(opts)`.
- `scoped.validateRaw(raw)` delegates to `validatePlaybook(raw)`.
- `scoped.compileAutonomous(playbook)` delegates to `playbookToBuildSource(playbook)` so compiled source semantics match the existing helper.
- `scoped.seedPlanningSessionPlan(opts)` loads the named playbook, calls `createSessionPlanFromPlaybookSeed()`, resolves the target path with `resolveSessionPlanPath()`, checks for an existing file, writes with `writeSessionPlan()`, and returns `{ plan, session, path }`. Use a domain error for the existing-file case so monitor can return 409.

### `packages/monitor/src/routes/playbook-service.ts`

- Add a lazy helper that imports `createPlaybookWorkflowAdapter()` and adapter error guards from `@eforge-build/input`.
- `listPlaybooksWire()` calls `adapter.scoped.list({ configDir: configDir ?? cwd, cwd })` and keeps warning writes to stderr.
- `showPlaybook()` calls `adapter.scoped.load({ configDir, cwd, name })` after preserving the existing missing-config 404.
- `savePlaybook()` calls `adapter.scoped.save(...)` and maps adapter validation errors to the same response shapes currently returned by the route tests.
- `runPlaybook()` calls `adapter.scoped.load()` and returns the existing `requires-agent` body for planning-mode playbooks before queue/profile/dependency work. For autonomous playbooks, call `adapter.scoped.compileAutonomous(playbook)`, then keep the existing service-layer acceptance-criteria body quality gate, acceptance-criteria inventory derivation, profile validation, queue dependency classification, `enqueuePrd()`, and scheduler `notify()` behavior.
- `movePlaybookWire()` calls `adapter.scoped.promote()` or `adapter.scoped.demote()`.
- `validatePlaybookRaw()` calls `adapter.scoped.validateRaw(raw)` and preserves the route response shape `{ ok: true }` or `{ ok: false, errors }`.
- `copyPlaybookWire()` calls `adapter.scoped.copy()`.
- `createFromPlaybook()` calls `adapter.scoped.seedPlanningSessionPlan()` and maps autonomous-mode mismatch to the existing API-specific guidance using `API_ROUTES.playbookRun`; map seed collision to 409. Do not call `createSessionPlanFromPlaybookSeed`, `resolveSessionPlanPath`, or `writeSessionPlan` in the service.

### Tests

- Direct adapter test file `test/playbook-workflow.test.ts`:
  - Assert descriptor id/kind/sourceScopes.
  - Assert `Object.keys(createPlaybookWorkflowAdapter().scoped).sort()` includes the required method names.
  - Use temp projects with `.eforge/config.yaml` and isolated `XDG_CONFIG_HOME` where user scope is needed.
  - Verify list/load preserve precedence, source, shadows, mode, and profile fields through adapter calls.
  - Verify save writes Markdown with existing frontmatter/body format and rejects invalid frontmatter/body via adapter validation errors.
  - Verify move/promote/demote/copy update paths/scopes using existing lower-level semantics through adapter methods.
  - Verify raw validation returns `ok: true` for valid raw content and `ok: false` with errors for invalid raw content.
  - Verify autonomous compilation output equals `playbookToBuildSource(playbook)` for name/source/profile/postMerge semantics.
  - Verify `seedPlanningSessionPlan()` writes under `<cwd>/.eforge/session-plans/`, includes `seeded_from_playbook`, seeded body content, and `agent_profile` when the playbook declares `profile`.
  - Read `packages/input/src/playbook-workflow.ts` and assert it does not contain `@eforge-build/client`, `@eforge-build/engine`, monitor route imports, or daemon HTTP client imports.
- Source-contract test:
  - Assert `playbook-service.ts` contains a lazy `await import('@eforge-build/input')`, `createPlaybookWorkflowAdapter`, and `adapter.scoped.*` calls.
  - Assert `playbook-service.ts` has no direct import destructuring or direct call of `listPlaybooks`, `loadPlaybook`, `writePlaybook`, `movePlaybook`, `copyPlaybookToScope`, `validatePlaybook`, `playbookToBuildSource`, `createSessionPlanFromPlaybookSeed`, `resolveSessionPlanPath`, or `writeSessionPlan`.
- Existing route tests must continue to pass without public route-name changes.

## Documentation Notes

- In user-facing docs, state that bundled playbook and session-planning adapters are internal built-ins in `@eforge-build/input`, not native extension SDK registration APIs.
- Preserve the statement that user-authored native extension workflow registration for custom playbook/session-plan extraction remains future or unsupported.
- Preserve the statement that the engine receives normalized build source only.

## Verification

- [ ] `packages/input/src/playbook-workflow.ts` exports `PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR` with `id: 'builtin:playbooks'`, `kind: 'workflow-input-adapter'`, and `sourceScopes: ['project-local', 'project-team', 'user']`.
- [ ] `createPlaybookWorkflowAdapter().scoped` exposes `list`, `load`, `save`, `write`, `move`, `promote`, `demote`, `copy`, `validateRaw`, `compileAutonomous`, and `seedPlanningSessionPlan`.
- [ ] `packages/input/src/index.ts` re-exports the playbook adapter factory, descriptor, public adapter types, and adapter error/type guards.
- [ ] `packages/monitor/src/routes/playbook-service.ts` calls `createPlaybookWorkflowAdapter()` for playbook-domain operations.
- [ ] `packages/monitor/src/routes/playbook-service.ts` has zero direct calls to `listPlaybooks`, `loadPlaybook`, `writePlaybook`, `movePlaybook`, `copyPlaybookToScope`, `validatePlaybook`, `playbookToBuildSource`, `createSessionPlanFromPlaybookSeed`, `resolveSessionPlanPath`, or `writeSessionPlan`.
- [ ] `POST /api/playbook/run` returns `{ kind: 'requires-agent', mode: 'planning', name, message }` for planning-mode playbooks and creates no queue file or session plan file.
- [ ] Planning seed creation writes a session plan only under `<cwd>/.eforge/session-plans/` via the adapter path and returns 409 when the target session already exists.
- [ ] Autonomous playbook runs still perform landing-action validation, acceptance-criteria inventory derivation, profile validation, queue dependency classification, enqueue, and scheduler notification in the monitor service.
- [ ] `packages/input/src/playbook-workflow.ts` contains zero imports from `@eforge-build/client`, `@eforge-build/engine`, monitor route helpers, or daemon HTTP clients.
- [ ] Direct adapter tests cover descriptor, list, load, save, move/promote/demote, copy, raw validation, autonomous compilation, planning seed creation, and profile inheritance into `agent_profile`.
- [ ] Source-contract tests fail on direct lower-level playbook helper calls from `playbook-service.ts`.
- [ ] Existing playbook and session-plan-create-from-playbook route tests pass with unchanged route names.
- [ ] Documentation names the bundled playbook workflow adapter as shipped and keeps user-authored native workflow registration for custom playbook extraction marked future or unsupported.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/playbook-workflow.test.ts packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts packages/monitor/src/__tests__/routes-playbooks.test.ts test/daemon-session-plan-routes-playbook.test.ts` exits 0.
