---
id: plan-01-sdk-runtime-paths
name: SDK Scoped Path Helpers and Runtime Context Wiring
branch: add-scoped-eforge-project-path-helpers-to-the-extension-sdk/plan-01-sdk-runtime-paths
agents:
  builder:
    effort: high
    rationale: Public SDK API plus required ctx.paths propagation across several
      runtime context builders and package export metadata.
  reviewer:
    effort: high
    rationale: Review must cover API compatibility, path containment semantics, and
      runtime context coverage across engine/input/monitor callers.
---

# SDK Scoped Path Helpers and Runtime Context Wiring

## Architecture Context

Native extension storage scope roots are owned by `@eforge-build/scopes`. The extension SDK currently exposes only `resolveProjectLocalStoragePath`, which is IO-free and validates lexical path segments under `<cwd>/.eforge/`. This plan adds the new public scoped path surface and threads a `paths` object into runtime-created extension contexts without changing extension trust or sandbox semantics.

The key dependency direction is: `@eforge-build/extension-sdk` may depend on `@eforge-build/scopes`; runtime packages construct SDK-shaped `paths` helpers for contexts. Keep the helper lexical and IO-free.

## Implementation

### Overview

Implement a public path-helper module in `@eforge-build/extension-sdk`, preserve the existing project-local helper, and add `ctx.paths` to event hooks, agent-run hooks, policy gates, profile routers, input-source adapters, PRD enrichers, extension actions, and validation provider function contexts.

### Key Decisions

1. Use `getScopeDirectory(scope, { cwd, configDir })` from `@eforge-build/scopes` for scope roots; do not duplicate user/project-team/project-local root mapping in SDK code.
2. Use `<scopeRoot>/storage/extensions/<extensionName>/...` for extension-owned mutable storage. `storagePath(scope, segments)` resolves under `<scopeRoot>/storage/...`; `scopeRoot(scope)` exposes the raw canonical scope root for built-in workflows such as `.eforge/session-plans/`.
3. Keep `resolveProjectLocalStoragePath({ cwd, segments })` source-compatible and backed by the new validation/containment utilities.
4. `configDir` defaults to `resolve(cwd, 'eforge')` only when a caller cannot provide the resolved project-team config directory.
5. `ctx.paths` is a convenience resolver for trusted extension code. It is not a sandbox, authorization layer, or filesystem API.

## Scope

### In Scope

- Add a new scoped project paths helper surface to `@eforge-build/extension-sdk`.
- Add `@eforge-build/scopes` as an SDK dependency and update lockfile metadata.
- Export the new helper/types from the package root and a subpath such as `@eforge-build/extension-sdk/project-paths`.
- Keep `@eforge-build/extension-sdk/project-storage` and `resolveProjectLocalStoragePath` working.
- Add typed `paths` fields to SDK context types.
- Construct `ctx.paths` in runtime contexts for event hooks, agent-run hooks, policy gates, profile routers, input-source adapters, PRD enrichers, extension actions, and validation providers.
- Thread exact `configDir` through call paths that already have it available; fall back to `<cwd>/eforge` otherwise.
- Add unit/runtime tests for helper behavior and representative context availability.

### Out of Scope

- Filesystem read/write abstractions, atomic persistence helpers, or directory creation.
- Changes to extension trust, sandboxing, route contracts, daemon wire shapes, or approval workflows.
- Moving session-plan artifacts out of `.eforge/session-plans/`.
- eforge-plan storage migration and docs; those are handled by `plan-02-dogfood-docs`.

## Files

### Create

- `packages/extension-sdk/src/project-paths.ts` — public scoped path helper implementation and exported types.

### Modify

- `packages/extension-sdk/src/project-storage.ts` — delegate legacy project-local resolution to the shared safe path utilities while preserving behavior.
- `packages/extension-sdk/src/index.ts` — export `EforgeStorageScope`, `EforgeProjectPaths`, helper option types, `createEforgeProjectPaths`, and convenience scoped/extension storage functions.
- `packages/extension-sdk/src/context.ts` — add `paths: EforgeProjectPaths` to `EforgeExtensionContext`.
- `packages/extension-sdk/src/contributions.ts` — add `paths: EforgeProjectPaths` to `ExtensionActionContext`.
- `packages/extension-sdk/src/hooks.ts` — add `paths: EforgeProjectPaths` to `ValidationProviderContext`.
- `packages/extension-sdk/package.json` — add `@eforge-build/scopes` dependency and a `./project-paths` export.
- `packages/extension-sdk/tsup.config.ts` — include `src/project-paths.ts` as a build entry.
- `pnpm-lock.yaml` — reflect the new workspace dependency for `packages/extension-sdk`.
- `packages/engine/src/extensions/event-runtime.ts` — add `paths` to event hook contexts; include `configDir` in runtime options.
- `packages/engine/src/extensions/agent-context-runtime.ts` — add `paths` to agent-run contexts and pass the active extension name as the default extension storage owner.
- `packages/engine/src/extensions/policy-gate-runtime.ts` — add `paths` to policy-gate contexts; rebuild or clone the context per registration so `extensionStoragePath(scope, segments)` uses the active policy extension name.
- `packages/engine/src/extensions/profile-router-runtime.ts` — add `paths` to profile router contexts using the router registration extension name and the resolved config dir.
- `packages/engine/src/extensions/action-runtime.ts` — add `paths` to action contexts and accept an optional `configDir` in dispatch options.
- `packages/engine/src/extensions/validation-provider-runtime.ts` — add `paths` to validation provider function contexts using the provider registration extension name; default `cwd` to `worktreePath` for build-stage validation providers.
- `packages/engine/src/extensions/types.ts` — mirror the new action context `paths` shape for loader/runtime structural types.
- `packages/engine/src/eforge.ts` — retain the resolved native extension config dir, expose it internally if needed, and pass it to agent context hooks.
- `packages/engine/src/queue/scheduler.ts` — pass scheduler `configDir` into queue-dispatch policy contexts and profile router contexts.
- `packages/input/src/extension-normalize.ts` — add optional `configDir` to preprocessing options and include `paths` in input-source and PRD-enricher contexts.
- `packages/eforge/src/cli/index.ts` — pass the engine-resolved config dir to preprocessing and native event hook wrapping when available.
- `packages/eforge/src/cli/run-or-delegate.ts` — pass the engine-resolved config dir to preprocessing and native event hook wrapping when available.
- `packages/monitor/src/server-main.ts` — include config dir in watcher event-hook wrapping when available from the engine.
- `packages/monitor/src/routes/extensions/contribution-service.ts` — return `configDir` from contribution runtime loading and pass it to `dispatchExtensionAction`.
- `test/extension-sdk-project-storage.test.ts` — cover scoped roots, storage roots, extension-owned storage convention, unsafe segment rejection, old helper compatibility, and no filesystem imports in path helper modules.
- `test/extension-sdk-example.test.ts` — extend the type-level barrel surface tuple with new exported path/context types.
- `test/extension-event-runtime.test.ts` — assert event hook `ctx.paths` is present and returns contained absolute paths.
- `test/extension-agent-context-runtime.test.ts` — assert agent-run `ctx.paths` is present and extension-owned paths use the active extension name.
- `test/extension-policy-gate-runtime.test.ts` — assert policy gate contexts include `paths` and per-registration extension storage defaults are applied during handler execution.
- `test/extension-profile-router-runtime.test.ts` — assert profile router contexts include `paths` with the resolved config dir.
- `test/input-extension-normalization.test.ts` — assert input-source and PRD-enricher contexts include `paths`; keep `exec.run` unavailable during preprocessing.
- `test/extension-contribution-registry-runtime.test.ts` — assert extension action handlers receive `ctx.paths`.
- `test/validation-provider-runtime.test.ts` — assert validation provider function contexts receive `ctx.paths`.

## API Shape

Implement these public names unless a build-time constraint forces a minor naming adjustment; if a name changes, update docs/tests in `plan-02-dogfood-docs` to match the final implementation.

```ts
export type EforgeStorageScope = 'user' | 'project-team' | 'project-local';

export interface EforgeProjectPathsOptions {
  cwd: string;
  configDir?: string;
  extensionName?: string;
}

export interface EforgeProjectPaths {
  cwd: string;
  configDir: string;
  scopeRoot(scope: EforgeStorageScope): string;
  storageRoot(scope: EforgeStorageScope): string;
  storagePath(scope: EforgeStorageScope, segments: readonly string[]): string;
  extensionStorageRoot(scope: EforgeStorageScope, extensionName?: string): string;
  extensionStoragePath(scope: EforgeStorageScope, segments: readonly string[], extensionName?: string): string;
}

export function createEforgeProjectPaths(opts: EforgeProjectPathsOptions): EforgeProjectPaths;
export function resolveScopedStoragePath(opts: {
  cwd: string;
  configDir?: string;
  scope: EforgeStorageScope;
  segments: readonly string[];
}): string;
export function resolveExtensionStoragePath(opts: {
  cwd: string;
  configDir?: string;
  scope: EforgeStorageScope;
  extensionName: string;
  segments: readonly string[];
}): string;
```

Validation rules for path segments and extension names:

- Reject an empty segment array for `storagePath`, `extensionStoragePath`, `resolveScopedStoragePath`, and `resolveExtensionStoragePath`.
- Reject `''`, `'.'`, `'..'`, path separators, POSIX or Windows absolute paths, and null bytes.
- Verify the final path is contained under the intended storage root using lexical `relative` checks.
- Do not import `node:fs` or `node:fs/promises` in SDK path helper modules.

## Verification

- [ ] `resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] })` returns `resolve(cwd, '.eforge', 'session-plans')`.
- [ ] `createEforgeProjectPaths({ cwd, configDir }).scopeRoot('project-team')` returns `configDir`.
- [ ] `createEforgeProjectPaths({ cwd, configDir }).scopeRoot('project-local')` returns `resolve(cwd, '.eforge')`.
- [ ] `createEforgeProjectPaths({ cwd, configDir }).scopeRoot('user')` returns the XDG-aware user eforge config dir from `@eforge-build/scopes`.
- [ ] `storagePath('project-local', ['cache.json'])` returns `<cwd>/.eforge/storage/cache.json`.
- [ ] `extensionStoragePath('project-local', ['trace.json'])` with `extensionName: 'my-extension'` returns `<cwd>/.eforge/storage/extensions/my-extension/trace.json`.
- [ ] The scoped storage helpers throw for an empty segment array, empty strings, `'.'`, `'..'`, segments containing `/` or `\\`, POSIX absolute paths, Windows absolute paths, and null bytes.
- [ ] SDK path helper source files contain no imports from `node:fs` or `node:fs/promises`.
- [ ] Type-level SDK export tests reference the new path helper types.
- [ ] Runtime tests capture `ctx.paths` in input-source and extension-action handlers.
- [ ] Runtime tests cover `ctx.paths` in event, agent-run, policy-gate, profile-router, and validation-provider contexts.
- [ ] `pnpm type-check` passes after this plan.
