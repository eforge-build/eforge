---
id: plan-07-system-configuration-view
name: Implement the System configuration view for implemented
  daemon/config/profile/extension/playbook/session-plan/model surfaces using
  client browser route contracts.
branch: add-eforge-console-side-by-side-with-legacy-monitor-ui/system-configuration-view
---

# System Configuration View

## Architecture Reference

This module implements the **System Configuration View** contract from the architecture and depends on the `console-shell` module for the Console package foundation, shell layout, shared state, route skeleton, UI primitives, browser-safe fetch helper, and source guards.

Key constraints from architecture:
- The view is project-local and read-only by default; it must not use Overseer or multi-daemon language.
- All HTTP fetches use `API_ROUTES`, `buildPath`, typed helpers, or browser-safe types from `@eforge-build/client/browser`.
- The view must not import `@eforge-build/engine`, monitor server internals, or legacy monitor UI application code.
- The view must not duplicate daemon response interfaces for config, profiles, extensions, playbooks, session plans, models, health, version, or project context.
- Every section distinguishes loading, success, empty, and fetch-failed states independently.
- Mutating controls are omitted in phase 1 unless each control is tied to an existing typed API with confirmation and error handling. This module plans no mutating controls.
- Stack-sync controls, queue editing, priority editing, and multi-project navigation stay out of this view.

## Scope

### In Scope
- Replace the `/console/system` placeholder with a first functional System configuration view.
- Fetch and display daemon health, daemon API version, eforge package version, and project context.
- Fetch and display verbose config show data and config validation results.
- Fetch and display profile list data and active profile detail.
- Fetch and display extension list data and extension validation results.
- Fetch and display playbook list data.
- Fetch and display session plan list data.
- Fetch and display model provider/model lists for the implemented harnesses `pi` and `claude-sdk`.
- Add section-level loading, empty, error, partial-data, and retry states.
- Add selectors/formatters for counts and chips used by the System view.
- Add tests for URL construction, section state behavior, selectors, rendering, and absence of mutating controls.
- Add browser-safe type exports for playbook list/show wire types if `@eforge-build/client/browser` does not already export them after dependency merge.

### Out of Scope
- Editing, creating, deleting, activating, trusting, installing, promoting, demoting, saving, validating from raw input, or running profiles/extensions/playbooks/session plans.
- Adding daemon routes or changing existing daemon route semantics.
- Rendering stack-sync operations, stack-sync dry-run, queue controls, priority editing, or Overseer navigation.
- Rendering full playbook/session-plan body previews; phase 1 lists implemented artifacts and status metadata only.
- Reusing legacy monitor UI reducers, timeline, graph, heatmap, daemon drawer, or application layout components.
- Adding documentation updates; this module is an in-app view and does not change public commands or routes.

## Implementation Approach

### Overview

Implement the System route as a wrapper component that calls a package-local hook, `useSystemSurfaces()`, and renders a set of independent read-only sections. Each section owns its own `Loadable<T>` state so one failed endpoint does not hide other available daemon data.

Data loading uses `API_ROUTES` from `@eforge-build/client/browser` and the shell-provided JSON fetcher. Query strings are built with `URLSearchParams` against route constants. Response types are imported from `@eforge-build/client/browser`; local types only represent UI state such as `Loadable<T>`, `SystemSurfaceKey`, and selector output.

The route renders sections in this order:
1. **Daemon** — health, version, project context, daemon stream status from the shell state.
2. **Config** — verbose config sources, validation status, error list, and collapsed JSON payloads.
3. **Profiles** — active profile, source, profile counts by scope/harness, metadata, and shadowing.
4. **Extensions** — registration totals, extension status/trust/scope, diagnostics, and validation result.
5. **Playbooks** — playbook count, warnings, mode, scope/source, profile, shadows, and path.
6. **Session Plans** — plan count, status/readiness summary, missing dimensions, and path.
7. **Models** — providers and models grouped by harness, deprecated chips, provider names, context window, and release date when present.

A `Refresh system data` button re-runs GET requests only. It is a read-only fetch action and is the only button planned in this view. The view must not render labels such as `Use profile`, `Run playbook`, `Promote`, `Demote`, `Trust`, `Untrust`, `Install`, `Delete`, or `Sync stack`.

### Key Decisions

1. **Use independent section load states.** The daemon can serve health while model listing fails or config validation fails. Separate states make partial availability visible and match the architecture requirement for unavailable states per section.
2. **Fetch models for explicit harnesses.** The monitor server requires `harness=pi` or `harness=claude-sdk` for model provider/model endpoints. The System view defines `SYSTEM_MODEL_HARNESSES = ['pi', 'claude-sdk'] as const` and fetches providers plus models for each harness with query strings built from `URLSearchParams`.
3. **Add type-only browser exports for playbook wire types when missing.** `packages/client/src/api/playbook.ts` defines `PlaybookListResponse`, `PlaybookListEntry`, and related types, but the current browser entrypoint does not export them. This module adds type-only exports from `@eforge-build/client/browser` rather than importing the Node-oriented API helper module in browser source.
4. **Display opaque config/profile payloads in collapsed `<details>` blocks.** Config and profile response bodies contain opaque engine-owned objects. The UI shows provenance and validation summaries first, then offers JSON inspection without inventing field semantics.
5. **No mutation controls in phase 1.** Existing APIs include mutating profile, extension, playbook, and session-plan routes. This view intentionally omits them to keep action boundaries explicit and to avoid phase-1 workflows that require confirmation/error design outside this module.
6. **Prefer components over one large route file.** Each section has a small component and receives typed data plus load state. This keeps view tests focused and reduces future merge conflicts with other routes.

## Files

### Create
- `packages/console-ui/src/views/system/index.ts` — exports the System route component and system view types.
- `packages/console-ui/src/views/system/system-configuration-view.tsx` — route wrapper that receives shell project state, calls `useSystemSurfaces()`, and renders the System page.
- `packages/console-ui/src/views/system/system-view-content.tsx` — presentational page component used by tests; renders the header, retry button, and all read-only sections from an injected `SystemSurfacesState`.
- `packages/console-ui/src/views/system/use-system-surfaces.ts` — hook that fetches all System surfaces on mount and on refresh, aborts stale requests on unmount/refresh, and stores independent `Loadable<T>` section state.
- `packages/console-ui/src/views/system/system-fetches.ts` — typed fetch functions for health, version, project context, config show/validate, profiles, extensions, playbooks, session plans, and model catalogs. All paths are built from `API_ROUTES` and `URLSearchParams`.
- `packages/console-ui/src/views/system/system-types.ts` — UI-only types such as `Loadable<T>`, `SystemSurfaceKey`, `SystemSurfacesState`, `SystemModelHarness`, and `SystemModelCatalog`. It imports wire types from `@eforge-build/client/browser` and defines no daemon response interfaces.
- `packages/console-ui/src/views/system/system-section.tsx` — reusable section shell that renders section title, description, loading, empty, error, and content slots.
- `packages/console-ui/src/views/system/daemon-section.tsx` — daemon health/version/project context section.
- `packages/console-ui/src/views/system/config-section.tsx` — config sources, validation result, validation errors, and collapsed JSON inspector.
- `packages/console-ui/src/views/system/profiles-section.tsx` — active profile summary, profile list, scope/harness counts, metadata tags, and shadowing chips.
- `packages/console-ui/src/views/system/extensions-section.tsx` — extension totals, extension rows, trust/status/scope chips, reviewer/validation provider counts, and diagnostic list.
- `packages/console-ui/src/views/system/playbooks-section.tsx` — playbook list, warnings, mode chips, scope/source/profile/shadow metadata, and empty state.
- `packages/console-ui/src/views/system/session-plans-section.tsx` — session-plan list, status/readiness counts, missing dimensions, and empty state.
- `packages/console-ui/src/views/system/models-section.tsx` — provider/model summaries for `pi` and `claude-sdk` harnesses with per-harness error states.
- `packages/console-ui/src/views/system/json-details.tsx` — small collapsed JSON renderer for opaque config/profile data with deterministic `JSON.stringify(value, null, 2)` output.
- `packages/console-ui/src/lib/selectors/system.ts` — pure selectors for section summaries: profile counts, extension diagnostics/totals, playbook mode counts, session-plan readiness counts, config source rows, and model totals.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` — tests that fetch functions call URLs derived from `API_ROUTES`, attach required query parameters, parse success JSON, and produce section errors on non-2xx responses.
- `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts` — tests for profile counts, extension diagnostic counts, playbook mode counts, session-plan readiness counts, and model totals.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` — component tests for loaded, empty, loading, and error states plus read-only action boundaries.

### Modify
- `packages/console-ui/src/app.tsx` — replace the System placeholder route with `SystemConfigurationView` and pass the shell project state/connection status into it `[region: system-configuration-view, System route component branch]`.

  ```tsx
  // --- eforge:region system-configuration-view ---
  if (activeRoute === 'system') {
    return <SystemConfigurationView projectState={daemon.state} />;
  }
  // --- eforge:endregion system-configuration-view ---
  ```

- `packages/console-ui/src/lib/selectors/index.ts` — export System selectors `[region: system-configuration-view, exports from ./system]`.

  ```ts
  // --- eforge:region system-configuration-view ---
  export * from './system';
  // --- eforge:endregion system-configuration-view ---
  ```

- `packages/console-ui/src/lib/fetch-json.ts` — if the shell implementation lacks abort support, add a backward-compatible optional `{ signal?: AbortSignal }` parameter used by `useSystemSurfaces()`. This file is not listed in the architecture shared-file registry; the change must keep all existing call sites valid.
- `packages/client/src/browser.ts` — add type-only exports for browser-safe playbook list/show wire types when they remain absent after dependency merge. Do not export runtime helpers from `./api/playbook.js`.

  ```ts
  // --- eforge:region system-configuration-view ---
  export type {
    PlaybookScope,
    PlaybookArtifactSource,
    PlaybookMode,
    PlaybookShadow,
    PlaybookListEntry,
    PlaybookData,
    PlaybookListResponse,
    PlaybookShowResponse,
  } from './api/playbook.js';
  // --- eforge:endregion system-configuration-view ---
  ```

## Data and Component Contracts

### `Loadable<T>`

Use a UI-only load wrapper:

```ts
export type Loadable<T> =
  | { status: 'idle' | 'loading'; data?: T; updatedAt?: number; error?: undefined }
  | { status: 'success'; data: T; updatedAt: number; error?: undefined }
  | { status: 'empty'; data?: T; updatedAt: number; error?: undefined }
  | { status: 'error'; data?: T; updatedAt?: number; error: string };
```

Section components treat `status: 'error'` with `data` as partial stale data and render both the error message and the retained data.

### `SystemSurfacesState`

Use this UI state shape, with all wire payloads imported from `@eforge-build/client/browser`:

- `daemon.health: Loadable<HealthResponse>`
- `daemon.version: Loadable<VersionResponse>`
- `daemon.projectContext: Loadable<ProjectContext>`
- `config.show: Loadable<ConfigShowVerboseResponse>`
- `config.validate: Loadable<ConfigValidateResponse>`
- `profiles.list: Loadable<ProfileListResponse>`
- `profiles.active: Loadable<ProfileShowResponse>`
- `extensions.list: Loadable<ExtensionListResponse>`
- `extensions.validate: Loadable<ExtensionValidateResponse>`
- `playbooks.list: Loadable<PlaybookListResponse>`
- `sessionPlans.list: Loadable<SessionPlanListResponse>`
- `models.catalogs: Record<SystemModelHarness, SystemModelCatalog>`

`SystemModelCatalog` stores separate `Loadable<ModelProvidersResponse>` and `Loadable<ModelListResponse>` values for one harness.

### Fetch URL requirements

- `configShow` uses `${API_ROUTES.configShow}?${new URLSearchParams({ verbose: 'true' })}`.
- `extensionValidate` uses `API_ROUTES.extensionValidate` without name/path query parameters.
- `playbookList` uses `API_ROUTES.playbookList`.
- `sessionPlanList` uses `API_ROUTES.sessionPlanList`.
- `modelProviders` uses `API_ROUTES.modelProviders` with `harness=pi` and `harness=claude-sdk`.
- `modelList` uses `API_ROUTES.modelList` with `harness=pi` and `harness=claude-sdk`.
- No source file in this module contains quoted `/api/` literals; tests use `API_ROUTES` for expected paths.

### Empty states

- Profiles: show `No profiles discovered` when `profiles.profiles.length === 0`.
- Extensions: show `No extensions discovered` when `extensions.extensions.length === 0` and diagnostics are empty.
- Playbooks: show `No playbooks discovered` when `playbooks.playbooks.length === 0`.
- Session plans: show `No session plans discovered` when `plans.length === 0`.
- Models: show `No providers reported` or `No models reported` per harness when the corresponding arrays are empty.
- Config: show `No config file found` when `configValidate.configFound === false`; show validation errors when `valid === false`.

### Action boundaries

The only planned interactive controls are:
- `Refresh system data` — repeats read-only GET requests.
- Local `<details>` toggles for JSON/debug details.

The render tests must fail if the loaded view exposes buttons or links with accessible names matching mutation labels: `Use profile`, `Create profile`, `Delete profile`, `Run playbook`, `Promote`, `Demote`, `Trust`, `Untrust`, `Install`, `Remove`, `Reload`, `Save`, `Validate raw`, or `Sync stack`.

## Testing Strategy

### Unit Tests
- `system-fetches.test.ts`:
  - Mock `globalThis.fetch` and assert each fetch URL starts from the matching `API_ROUTES` member.
  - Assert config show includes `verbose=true`.
  - Assert model provider and model list calls include exactly one `harness=pi` and one `harness=claude-sdk` per endpoint.
  - Assert a 500 response returns or stores the HTTP status text in the affected section error without changing other section success payloads.
- `system-selectors.test.ts`:
  - Profile selector counts profiles by `scope` and active profile name.
  - Extension selector sums diagnostics and registration totals from `ExtensionListResponse`.
  - Playbook selector counts `autonomous` and `planning` modes.
  - Session-plan selector counts `ready === true`, `ready === false`, and status values.
  - Model selector counts providers, models, deprecated models, and models grouped by provider.

### Component Tests
- `system-view-content.test.tsx`:
  - Loaded fixture renders section headings `Daemon`, `Config`, `Profiles`, `Extensions`, `Playbooks`, `Session Plans`, and `Models`.
  - Loaded fixture renders project `cwd`, daemon API version, active profile name, extension name, playbook name, session-plan topic, and model id from imported wire-shaped fixtures.
  - Empty fixture renders the five empty messages listed in the Data and Component Contracts section.
  - Loading fixture renders section-level loading text for sections with `status: 'loading'`.
  - Error fixture renders each section's error message while other success sections remain visible.
  - Loaded fixture includes one `Refresh system data` button and no mutation-control accessible names from the Action boundaries list.

### Integration Tests
- Existing Console guard tests from `console-shell` scan this module and fail on quoted `/api/` literals and `@eforge-build/engine` imports.
- `pnpm --filter @eforge-build/console-ui type-check` verifies all System view imports come from browser-safe exports.
- `pnpm --filter @eforge-build/console-ui test` runs the System view tests with the package-local Vitest config.

## Verification

- [ ] `/console/system` renders `System` route content instead of the shell placeholder.
- [ ] The System route imports no symbols from `@eforge-build/engine`.
- [ ] The System route imports daemon wire response types from `@eforge-build/client/browser`.
- [ ] `packages/client/src/browser.ts` exports playbook list/show wire types when the System view imports them.
- [ ] `system-fetches.ts` references daemon routes through `API_ROUTES` and builds query strings with `URLSearchParams`.
- [ ] No non-test System source file contains a quoted `/api/` route literal.
- [ ] The Daemon section renders health PID, daemon API version, optional eforge package version, project cwd, and git remote when those fields exist.
- [ ] The Config section renders config validation status, `configFound`, validation errors, and source paths from verbose config data.
- [ ] The Profiles section renders active profile name/source and every profile entry from `ProfileListResponse.profiles`.
- [ ] The Extensions section renders registration totals, extension names/statuses/scopes, trust state when present, and diagnostics from `ExtensionListResponse` plus validation result.
- [ ] The Playbooks section renders warnings and every playbook entry from `PlaybookListResponse.playbooks` with mode, scope, source, profile, and shadow count.
- [ ] The Session Plans section renders every entry from `SessionPlanListResponse.plans` with session, topic, status, readiness, and missing dimensions.
- [ ] The Models section renders provider and model results for both `pi` and `claude-sdk` harnesses.
- [ ] Empty fixtures render `No profiles discovered`, `No extensions discovered`, `No playbooks discovered`, `No session plans discovered`, and per-harness model empty text.
- [ ] Error fixtures render the failed section's HTTP error text while success sections remain visible.
- [ ] Loaded render tests find exactly one button with accessible name `Refresh system data`.
- [ ] Loaded render tests find zero mutation controls matching `Use profile`, `Create profile`, `Delete profile`, `Run playbook`, `Promote`, `Demote`, `Trust`, `Untrust`, `Install`, `Remove`, `Reload`, `Save`, `Validate raw`, or `Sync stack`.
- [ ] `system-selectors.test.ts` covers profile counts, extension diagnostics, playbook modes, session-plan readiness, and model totals.
- [ ] `system-fetches.test.ts` covers config verbose query construction and model harness query construction for both harnesses.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
