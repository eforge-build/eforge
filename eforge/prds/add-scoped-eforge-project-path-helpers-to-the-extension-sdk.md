---
title: Add Scoped Eforge Project Path Helpers to the Extension SDK
created: 2026-06-05
landing: pr
landing_auto_merge: true
---

# Add Scoped Eforge Project Path Helpers to the Extension SDK

## Problem / Motivation

Native extension authors currently have only a minimal project-local `.eforge/` path helper. They do not have first-class project-context access for all eforge storage scopes or a consistent `ctx.paths` API in runtime contexts.

Why this matters now:

- The backlog item `.backlog/items/backlog-2026-06-04-add-extension-sdk-project-context-helpers-for-scoped-eforge-.md` is still valid and high priority. It records that PR #141 shipped only the minimal `resolveProjectLocalStoragePath` helper, while broader scoped path/context helpers remain unshipped.
- Future eforge-plan/workflow extensions need safe extension-owned storage for backlog items, epics, promotion artifacts, plan links, and build metadata across project-local, project-team, and user scopes.
- Without SDK-level helpers, extension authors must either duplicate scope-root logic from `@eforge-build/scopes` or hard-code paths such as `.eforge/...`, `eforge/...`, and `~/.config/eforge/...`.
- Hard-coded path conventions are more likely to drift from the existing scope model and less likely to include confinement validation.
- `docs/roadmap.md` places this work under **Extension Platform** and **Console Observability and Control**: input authoring/workflow UX belongs in extension surfaces, while scope/path lookup is reusable infrastructure outside the kernel.

Evidence:

- `packages/extension-sdk/src/project-storage.ts` currently exposes one IO-free helper for safe segments under `<cwd>/.eforge/`.
- `packages/extension-sdk/src/index.ts` exports the helper from the package root.
- `packages/extension-sdk/package.json` exposes `./project-storage`.
- `packages/scopes/src/dirs.ts` already owns canonical scope roots via `getScopeDirectory(scope, { cwd, configDir })`: user `~/.config/eforge`, project-team `configDir`, and project-local `<cwd>/.eforge`.
- The SDK currently does not depend on or expose `@eforge-build/scopes`.
- `packages/extension-sdk/src/context.ts` exposes only `logger` and `exec` on `EforgeExtensionContext`.
- `InputTransformContext` adds `cwd`.
- `packages/extension-sdk/src/contributions.ts` gives `ExtensionActionContext` `cwd` but no `paths`.
- `ValidationProviderContext` in `packages/extension-sdk/src/hooks.ts` has logger/exec/worktree metadata but no scoped paths.
- Runtime context builders mirror those missing fields in `packages/engine/src/extensions/event-runtime.ts`, `packages/engine/src/extensions/agent-context-runtime.ts`, `packages/engine/src/extensions/policy-gate-runtime.ts`, `packages/engine/src/extensions/profile-router-runtime.ts`, `packages/engine/src/extensions/action-runtime.ts`, and `packages/engine/src/extensions/validation-provider-runtime.ts`.
- Input-source and PRD-enricher contexts are constructed inline in `packages/input/src/extension-normalize.ts`.
- Documentation that will go stale includes `packages/extension-sdk/README.md`, `docs/extensions-api.md`, and `web/content/docs/extensions-api.md` / generated public docs.
- Existing project-team extensions were checked for applicability.
- `eforge/extensions/eforge-plan/trace-store.ts` and `eforge/extensions/eforge-plan/promote.ts` currently use `resolveProjectLocalStoragePath` for extension trace sidecars and session-plan paths, so `eforge-plan` should be migrated/dogfooded where the new helper applies.
- `eforge/extensions/eforge-guardrails/index.ts` currently uses `ValidationProviderContext` only for logger/exec/plan metadata and does not maintain extension-owned storage; it should be audited and updated only where the new `ctx.paths` helper materially applies.

Classification: this is a **feature / focused** change with medium-high confidence. It adds a public SDK capability and wires it into runtime contexts, but it can stay cohesive as one API/helper surface rather than delegated subsystem planning.

## Goal

Implement a public SDK project-context/path helper surface and expose it through extension runtime contexts.

The outcome is a consistent, IO-free `ctx.paths` API and helper module that resolves canonical user, project-team, and project-local eforge storage paths, including safe extension-owned storage conventions.

## Approach

Use `@eforge-build/scopes` as the source of truth for scope roots. Project instructions say scope/path lookup lives in `@eforge-build/scopes`, and `packages/scopes/src/dirs.ts` already implements the canonical user/project-team/project-local mapping.

Add a higher-level paths object rather than replacing the existing single helper. Existing callers and docs already use `resolveProjectLocalStoragePath`, so keeping it avoids a breaking SDK change.

Preferred extension-owned storage convention:

```text
<scopeRoot>/storage/extensions/<extensionName>/...
```

Rationale: `extensions/` is already the extension source/install directory, so using `storage/extensions/` avoids mixing mutable state with extension code and trust-hash inputs.

Keep promoted session plans under:

```text
.eforge/session-plans/
```

Rationale: session plans are user-facing workflow artifacts with an existing built-in convention, not private extension-owned mutable state. `eforge-plan` promotion should use the new helper/project context only to avoid duplicated path logic, not to move session plans into extension-private storage.

Keep helpers lexical and IO-free. The current helper intentionally performs no filesystem I/O, and tests already check that `project-storage.ts` does not import filesystem modules.

Reject unsafe storage path segments consistently across scopes. Extension authors should be able to safely compose user-provided identifiers into storage paths without accepting traversal, absolute paths, separators, empty segments, or null bytes.

Expose `ctx.paths` in runtime contexts as a convenience object created by the runtime. Extensions should not need to reconstruct project context from `cwd` and `configDir`, and some contexts currently do not expose `cwd` at all in their SDK type.

Treat `ctx.paths` as a path-resolution helper, not a sandbox or authorization boundary. Native extensions remain trusted, unsandboxed code; the helper improves conventions and containment for cooperative code but cannot prevent arbitrary Node filesystem access by trusted extension code.

Default `configDir` to `<cwd>/eforge` only where an exact config dir is not already available. Most code paths already use conventional `eforge/`, but loaders/monitor routes can provide the resolved config dir when known.

Proposed API shape, adjustable during implementation if names need refinement:

```ts
type EforgeStorageScope = 'user' | 'project-team' | 'project-local';

interface EforgeProjectPaths {
  cwd: string;
  configDir: string;
  scopeRoot(scope: EforgeStorageScope): string;
  storageRoot(scope: EforgeStorageScope): string;
  storagePath(scope: EforgeStorageScope, segments: readonly string[]): string;
  extensionStorageRoot(scope: EforgeStorageScope, extensionName?: string): string;
  extensionStoragePath(scope: EforgeStorageScope, segments: readonly string[], extensionName?: string): string;
}

function createEforgeProjectPaths(opts: { cwd: string; configDir?: string; extensionName?: string }): EforgeProjectPaths;
```

The exact names may change, but acceptance requires equivalent capabilities: scoped roots, scoped safe storage paths, extension-owned storage paths, existing-extension dogfooding, and `ctx.paths` access.

Likely implementation targets verified by search/read:

- `packages/extension-sdk/src/project-storage.ts`: expand this module or delegate to a new focused module that keeps the old project-local helper and adds scoped path helpers.
- `packages/extension-sdk/src/index.ts`: export new helper functions/types and include the new context type(s) in the barrel surface.
- `packages/extension-sdk/package.json`: add an export subpath such as `./project-context` or `./project-paths`, and add `@eforge-build/scopes` as a dependency if the SDK imports canonical scope helpers.
- `packages/extension-sdk/src/context.ts`: add `paths` to `EforgeExtensionContext` so event hooks, agent-run hooks, policy gates, profile routers, input-source adapters, and PRD enrichers inherit it.
- `packages/extension-sdk/src/contributions.ts`: add `paths` to `ExtensionActionContext` because action context is not currently based on `EforgeExtensionContext`.
- `packages/extension-sdk/src/hooks.ts`: add `paths` to `ValidationProviderContext` if validation-provider function contexts are included in this slice.
- `packages/engine/src/extensions/event-runtime.ts`: construct the same `paths` shape the SDK documents.
- `packages/engine/src/extensions/agent-context-runtime.ts`: construct the same `paths` shape the SDK documents.
- `packages/engine/src/extensions/policy-gate-runtime.ts`: construct the same `paths` shape the SDK documents.
- `packages/engine/src/extensions/profile-router-runtime.ts`: construct the same `paths` shape the SDK documents.
- `packages/engine/src/extensions/action-runtime.ts`: construct the same `paths` shape the SDK documents.
- `packages/engine/src/extensions/validation-provider-runtime.ts`: construct the same `paths` shape the SDK documents.
- `packages/input/src/extension-normalize.ts`: update both input-source and PRD-enricher contexts to receive `paths` alongside `cwd` and provenance.
- `packages/monitor/src/routes/extensions/contribution-service.ts`: if action runtime needs the exact project-team config dir, update it so `loadContributionRuntime` returns `configDir` and passes it to `dispatchExtensionAction`.
- `eforge/extensions/eforge-plan/trace-store.ts`: migrate trace sidecar root/path resolution from `resolveProjectLocalStoragePath({ segments: ['extension-data', 'eforge-plan', 'traces', ...] })` to the new extension-owned storage helper/convention.
- `eforge/extensions/eforge-plan/promote.ts`: audit session-plan path resolution. Promotion should still write user-facing session plans under `.eforge/session-plans/`, but should use the new `ctx.paths`/project-context helper where it avoids duplicating path logic. Input-source `ctx.paths` can be passed through when available; pure helpers can use `createEforgeProjectPaths({ cwd })` or equivalent.
- `eforge/extensions/eforge-plan/README.md`: update the storage model section if trace sidecars move from `.eforge/extension-data/eforge-plan/traces` to the new extension-owned storage convention.
- `eforge/extensions/eforge-plan/__tests__/storage.test.ts`: update to assert the new trace storage path and that mutable state is not stored under `.eforge/extensions/eforge-plan`.
- Related lifecycle/promotion tests: update expectations if the new convention changes the path.
- `eforge/extensions/eforge-guardrails/index.ts`: audit the validation provider context after `ValidationProviderContext.paths` is added. It currently uses `ctx.logger`, `ctx.planId`, and `ctx.exec.run('pnpm', ['maintainability:check'], { cwd: planOutputDir })`; no extension-owned storage use was found, so a code change is only required if the new helper becomes useful for this provider.
- `test/eforge-guardrails-maintainability.test.ts` or a nearby extension test: add coverage or a static assertion only if guardrails behavior changes; otherwise no test update is required beyond SDK type/context coverage.
- `test/extension-sdk-project-storage.test.ts` or a new `test/extension-sdk-project-context.test.ts`: cover scope roots, containment, unsafe segment rejection, extension-owned storage conventions, old helper compatibility, and no filesystem I/O.
- `test/extension-sdk-example.test.ts`: update the type-export tuple.
- Runtime tests: add or update representative context tests, especially input transforms and extension actions where contexts are constructed outside the main engine hook builders.
- `packages/extension-sdk/README.md`: document the new helper, the storage convention, and the fact that helpers are path resolvers rather than sandboxing or filesystem-I/O primitives.
- `docs/extensions-api.md`: document the new helper, the storage convention, and the fact that helpers are path resolvers rather than sandboxing or filesystem-I/O primitives.
- `web/content/docs/extensions-api.md`: document the new helper, the storage convention, and the fact that helpers are path resolvers rather than sandboxing or filesystem-I/O primitives.
- `web/public/docs/extensions-api.md`: keep generated public docs in sync after documentation generation/check.

Patterns to follow:

- Keep path helpers IO-free like the existing `resolveProjectLocalStoragePath` test enforces.
- Reuse `getScopeDirectory` from `@eforge-build/scopes` rather than duplicating the scope root mapping.
- Preserve source-compatible behavior for `resolveProjectLocalStoragePath({ cwd, segments })`.
- Avoid route literal or daemon wire-shape changes; this is SDK/runtime context plumbing, not a daemon API contract change.
- Treat existing-extension dogfooding as part of implementation validation: `eforge-plan` should prove the new helper works for extension-owned storage; `eforge-guardrails` should prove the helper does not force meaningless storage coupling.
- Do not force `eforge-guardrails` to use `ctx.paths` if it has no storage concern. The current guardrails extension runs a validation provider command and parses maintainability output; adding an unused path reference would be noise.

## Scope

In scope:

- Add a new SDK helper module for scoped eforge paths, using `@eforge-build/scopes` for canonical scope roots.
- Keep the existing `resolveProjectLocalStoragePath` API working and exported for backward compatibility.
- Add an SDK `paths` object suitable for `ctx.paths` access.
- Expose scope roots for `project-local`, `project-team`, and `user` scopes.
- Expose safe extension-owned storage path resolution for `project-local`, `project-team`, and `user` scopes.
- Define an extension-owned storage convention that does not collide with extension source directories.
- Use `<scopeRoot>/storage/extensions/<extensionName>/...` as the preferred extension-specific storage convention.
- Wire `ctx.paths` into current extension execution contexts where the project root/config scope is available or can be safely defaulted.
- Wire `ctx.paths` into event hooks.
- Wire `ctx.paths` into agent-run hooks.
- Wire `ctx.paths` into policy gates.
- Wire `ctx.paths` into profile routers.
- Wire `ctx.paths` into input-source adapters.
- Wire `ctx.paths` into PRD enrichers.
- Wire `ctx.paths` into extension actions.
- Wire `ctx.paths` into validation provider function contexts.
- Update existing project-team extensions to dogfood the new helper where applicable.
- Migrate `eforge/extensions/eforge-plan/trace-store.ts` away from hard-coded `.eforge/extension-data/eforge-plan/traces` path construction to the new extension-owned storage helper/convention.
- Audit `eforge/extensions/eforge-plan/promote.ts` session-plan path use and update it to use `ctx.paths` or the new helper where that improves context propagation without changing the built-in `.eforge/session-plans/` session-plan convention.
- Audit `eforge/extensions/eforge-guardrails/index.ts`.
- Use `ctx.paths` in `eforge-guardrails` only if the new `ValidationProviderContext.paths` materially applies.
- Leave `eforge-guardrails` behavior unchanged if the audit finds no extension-owned storage to migrate.
- Update tests and type-level export checks for the new SDK surface.
- Update tests for runtime context availability.
- Update tests for existing-extension dogfooding.
- Update local docs describing the new helper, the storage convention, and the fact that helpers are path resolvers rather than sandboxing or filesystem-I/O primitives.
- Update public docs describing the new helper, the storage convention, and the fact that helpers are path resolvers rather than sandboxing or filesystem-I/O primitives.

Out of scope:

- Do not add user-authored custom session-plan/playbook extraction APIs.
- Do not add raw extension-owned HTTP routes.
- Do not add Console plugin bundles.
- Do not implement a full atomic read/write storage abstraction in this slice.
- Do not change extension trust semantics.
- Do not change sandboxing behavior.
- Do not force no-op changes in `eforge-guardrails` solely to mention `ctx.paths`.
- Do not move promoted session plans out of `.eforge/session-plans/`.
- Do not add route literal or daemon wire-shape changes.

## Acceptance Criteria

- `@eforge-build/extension-sdk` exports a public helper that resolves canonical `user`, `project-team`, and `project-local` eforge scope roots using `@eforge-build/scopes`.
- `@eforge-build/extension-sdk` exports a public helper that resolves safe scoped storage paths under each scope root.
- The safe scoped storage path helper rejects empty segments.
- The safe scoped storage path helper rejects `.` segments.
- The safe scoped storage path helper rejects `..` segments.
- The safe scoped storage path helper rejects path separators.
- The safe scoped storage path helper rejects absolute paths.
- The safe scoped storage path helper rejects null bytes.
- `@eforge-build/extension-sdk` exports a public helper that resolves extension-owned storage paths under `<scopeRoot>/storage/extensions/<extensionName>/...`.
- The extension-owned storage helper does not use the extension source directory as mutable storage.
- The existing `resolveProjectLocalStoragePath({ cwd, segments })` export continues to resolve paths under `<cwd>/.eforge/`.
- The existing `resolveProjectLocalStoragePath({ cwd, segments })` export continues to reject unsafe segments.
- `EforgeExtensionContext` exposes a typed `paths` property for event hooks.
- `EforgeExtensionContext` exposes a typed `paths` property for agent-run hooks.
- `EforgeExtensionContext` exposes a typed `paths` property for policy gates.
- `EforgeExtensionContext` exposes a typed `paths` property for profile routers.
- `EforgeExtensionContext` exposes a typed `paths` property for input-source adapters.
- `EforgeExtensionContext` exposes a typed `paths` property for PRD enrichers.
- `ExtensionActionContext` exposes a typed `paths` property.
- `ValidationProviderContext` exposes a typed `paths` property when validation provider function handlers receive a context object.
- Runtime-created event-hook contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- Runtime-created agent-run contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- Runtime-created policy-gate contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- Runtime-created profile-router contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- Runtime-created input-source contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- Runtime-created PRD-enricher contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- Runtime-created extension-action contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- Runtime-created validation-provider contexts include a `paths` object whose methods return contained absolute paths for the active project context.
- `eforge/extensions/eforge-plan/trace-store.ts` uses the new extension-owned storage helper or `ctx.paths`-compatible helper for trace sidecar path resolution instead of manually composing `.eforge/extension-data/eforge-plan/traces` with `resolveProjectLocalStoragePath`.
- `eforge/extensions/eforge-plan/__tests__/storage.test.ts` verifies trace sidecars resolve under the documented extension-owned storage convention.
- `eforge/extensions/eforge-plan/__tests__/storage.test.ts` verifies trace sidecars do not resolve under `.eforge/extensions/eforge-plan`.
- `eforge/extensions/eforge-plan/promote.ts` either uses the new project-context helper for `.eforge/session-plans/` path resolution or has an implementation comment/test showing why the existing session-plan helper remains the correct built-in workflow path resolver.
- `eforge/extensions/eforge-plan/README.md` documents the updated trace sidecar storage path when trace sidecars move to the new convention.
- `eforge/extensions/eforge-guardrails/index.ts` uses `ValidationProviderContext.paths` only if the new helper materially applies to its validation-provider behavior.
- `eforge/extensions/eforge-guardrails/index.ts` keeps behavior unchanged when no storage/path-helper use case exists beyond its existing `planOutputDir` validation command.
- Type-level SDK barrel-surface tests compile with the new exported path/context types.
- Unit tests cover scoped root resolution.
- Unit tests cover extension-owned storage convention.
- Unit tests cover unsafe-segment rejection.
- Unit tests cover old project-local helper compatibility.
- Unit tests verify the helper performs no filesystem I/O.
- A runtime or integration test verifies `ctx.paths` availability in an input transform context.
- A runtime or integration test verifies `ctx.paths` availability in an extension action context.
- `packages/extension-sdk/README.md` documents the scoped path helper.
- `packages/extension-sdk/README.md` documents `ctx.paths`.
- `packages/extension-sdk/README.md` documents the extension-owned storage convention.
- `docs/extensions-api.md` documents the scoped path helper.
- `docs/extensions-api.md` documents `ctx.paths`.
- `docs/extensions-api.md` documents the extension-owned storage convention.
- `web/content/docs/extensions-api.md` stays consistent with the local extension API documentation.
- Generated public docs stay consistent after documentation generation.
- `pnpm docs:check` exits 0 after the documentation updates.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.

## Manual Verification Notes

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The broader helper work remains unshipped. | Read backlog item; inspected `packages/extension-sdk/src/project-storage.ts`, `packages/extension-sdk/src/context.ts`, `packages/extension-sdk/src/contributions.ts`, and `packages/extension-sdk/src/index.ts`; searched for `ctx.paths` and found no SDK/runtime context helper. | high | low | Re-run `rg "ctx\.paths|createEforgeProjectPaths|resolveProjectLocalStoragePath" packages docs test`. | Planning unnecessary or duplicated if already shipped. |
| The SDK should reuse `@eforge-build/scopes` instead of duplicating root mapping. | Read `packages/scopes/src/dirs.ts`; project instructions state scope/path lookup lives in `@eforge-build/scopes`. | high | low | Confirm type-check after adding `@eforge-build/scopes` to `packages/extension-sdk/package.json`. | Duplicate mappings could drift from canonical scope behavior. |
| Adding `@eforge-build/scopes` as an SDK dependency is acceptable. | `@eforge-build/scopes` is a small workspace package with no runtime dependencies; `@eforge-build/input` already depends on both extension-sdk and scopes. | high | low | Run `pnpm type-check` and package build. | If dependency direction is rejected, helper must accept injected roots or duplicate minimal logic, increasing design churn. |
| `storage/extensions/<extensionName>/` is the right extension-owned storage convention. | Existing `extensions/` directories are extension source/install directories per README and docs; using a separate `storage/` tree avoids source/trust-hash collision. | medium | low | Implementation can name the convention explicitly in docs and tests; reviewer can adjust if a better convention is preferred before merge. | If convention is wrong, extensions may put mutable state in awkward or unstable locations. |
| Runtime contexts can construct `ctx.paths` from `cwd` and a resolved or conventional `configDir`. | Runtime builders already receive `cwd` or context has enough project/worktree path metadata; monitor contribution route already resolves `configDir` while loading extension contributions. | medium | medium | During implementation, thread `configDir` where already available; otherwise default to `<cwd>/eforge` and add tests for conventional behavior. | Non-conventional config directories could resolve project-team storage incorrectly until configDir threading is improved. |
| Validation provider function contexts should receive `paths` as part of this slice. | `ValidationProviderContext` has logger/exec but is separate from `EforgeExtensionContext`; including it avoids a surprising gap in current runtime-supported extension APIs. | medium | low | Add the typed field and construct it in `validation-provider-runtime.ts`; if persistence from plan worktrees is undesirable, document/work around by using the original pipeline `cwd` where available. | If omitted, one runtime-supported extension family lacks the promised project-context helper. |
| `eforge-plan` should be updated to use the new helper where it applies. | Search/read found `eforge/extensions/eforge-plan/trace-store.ts` uses `resolveProjectLocalStoragePath` for `.eforge/extension-data/eforge-plan/traces`, and `eforge/extensions/eforge-plan/promote.ts` uses it for `.eforge/session-plans`. | high | low | Update trace storage first; audit promotion paths after `ctx.paths` exists and decide whether to use the generic project-context helper or keep the built-in session-plan convention. | Missing dogfooding would leave the motivating extension-owned storage case unvalidated. |
| `eforge-guardrails` may not need a code change beyond receiving the new typed context. | Read `eforge/extensions/eforge-guardrails/index.ts`; it uses `ctx.logger`, `ctx.planId`, and `ctx.exec.run('pnpm', ['maintainability:check'], { cwd: planOutputDir })`, and no extension-owned storage was found. | high | low | Re-audit after `ValidationProviderContext.paths` is added; update only if a real path-helper use appears. | Forcing an unused path reference would add noise and reduce clarity. |
| No atomic write abstraction is required in this slice. | The backlog asks for broader helpers and conventions; it mentions atomic helpers as absent, but the immediate acceptance can satisfy safe path/scoped storage without adding persistence semantics. | medium | low | Keep docs explicit that helpers perform no I/O; capture atomic storage as follow-up if reviewers require it. | If atomic writes are expected now, this plan under-scopes persistence safety. |

No low-confidence/high-impact assumption remains unresolved. The main medium-confidence decisions are API naming/convention details that can be adjusted during implementation without changing the acceptance intent.

Recommended profile: **Excursion**.

Rationale: this is a public SDK feature with multi-file runtime and docs impact, but it is cohesive. A single planner can enumerate the helper API, context wiring, tests, and docs without delegated module planning. It is not an Errand because it changes public API and several runtime context builders. It is not an Expedition because it does not require independently planned subsystems or architecture-document decomposition.