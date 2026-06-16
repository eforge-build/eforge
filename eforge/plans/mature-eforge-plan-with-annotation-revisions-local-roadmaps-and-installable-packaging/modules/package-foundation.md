# Package Foundation

## Architecture Reference

This module implements the package-root decision, package flow, and `package-foundation` module guidance from the architecture document for **Mature eforge-plan: annotation revisions, local roadmaps, installable package**.

Key constraints from architecture:
- Keep `eforge/extensions/eforge-plan/` as the first-party extension package root and publish it as `@eforge-build/eforge-plan`.
- Runtime extension source must import public package entrypoints such as `@eforge-build/extension-sdk`, `@eforge-build/client`, and `@eforge-build/input`; it must not import monorepo-relative `packages/*/src` paths.
- The package manifest must declare `eforge.extension.name: "eforge-plan"` and a compiled entrypoint such as `./dist/index.js`.
- The deferred backlog curation source provider must resolve to a compiled in-package module path such as `./dist/backlog-curation-source-provider.js`.
- Workstation assets generated under `workstation-assets/plans/` must be produced before package packing and included in the package artifact.
- This module must avoid annotation and roadmap behavior changes; downstream feature modules own those contracts.
- Existing oversized/shared files must receive bounded import-only or metadata-only edits.

## Scope

### In Scope
- Convert `eforge/extensions/eforge-plan/` from a private source-only extension directory into a workspace package named `@eforge-build/eforge-plan`.
- Add runtime build configuration that emits `dist/index.js` and `dist/backlog-curation-source-provider.js`.
- Ensure the package build also creates the existing workstation bundle under `workstation-assets/plans/`.
- Replace runtime monorepo-relative imports from `../../../packages/*/src/*` with public package imports.
- Use existing public exports where available; add stable package exports only if the import audit finds a missing public API.
- Update root workspace/type-check/build metadata so the package participates in repository gates.
- Add baseline package-layout and runtime-import audit tests.
- Update package metadata assertions that still expect `eforge.extension.entrypoint: "index.ts"`.

### Out of Scope
- Annotation schemas, annotation actions, revision turn snapshots, source-text annotation context, and apply-time annotation resolution.
- Roadmap state/config helpers, roadmap actions, planner/curation/recommendation roadmap payload changes, and roadmap fingerprints.
- Workstation annotation UI or roadmap UI.
- Final README/user documentation for install/update/trust/reload/removal; `packaging-docs-validation` owns those docs.
- Full fresh-project install/update/trust/reload regression tests; `packaging-docs-validation` owns those end-to-end checks.
- Automatic changes to shared project roadmap files.

## Implementation Approach

### Overview

Keep the extension source in place and make that directory a real pnpm workspace package. Add a small `tsup` build that compiles the extension entrypoint and the curation source-provider entrypoint, then make the package build invoke the existing Vite workstation build so `workstation-assets/plans/index.js` and `style.css` exist before packing.

Perform a narrow import migration across runtime TypeScript files: replace every `../../../packages/extension-sdk/src/index.js` import with `@eforge-build/extension-sdk`, every `../../../packages/input/src/index.js` import with `@eforge-build/input`, and every client source import with `@eforge-build/client`. Existing `@eforge-build/client` imports stay as they are. Do not rewrite test-only imports unless a package metadata assertion or type-check failure requires it.

Because the existing extension installer acquires npm packages with `npm pack` and copies the package directory without installing dependency `node_modules`, the runtime `dist/` files must be self-contained for non-node dependencies. Source files still consume public APIs, but `tsup` must bundle `@eforge-build/*`, `yaml`, `zod`, TypeBox, and other non-node runtime dependencies into `dist/` rather than externalizing them. This keeps installed packages loadable in fresh projects through the current extension-management path.

### Key Decisions

1. Keep `eforge/extensions/eforge-plan/` as the package root instead of moving files into `packages/eforge-plan`. This preserves the dogfood extension location and avoids large path churn.
2. Set `eforge.extension.entrypoint` to `./dist/index.js` and update tests that assert the package manifest. Source tests can continue to import `../index.js` through Vitest's TypeScript loader.
3. Build two runtime entries: `index.ts` for extension registration and `backlog-curation-source-provider.ts` for daemon-owned source-provider execution. Change the analyze-all source provider module literal to `./dist/backlog-curation-source-provider.js`.
4. Bundle first-party package dependencies into the extension runtime artifact. This satisfies the current install manager, which copies packed files but does not install the package dependency tree.
5. Declare public package dependencies in `eforge/extensions/eforge-plan/package.json` even though the runtime artifact is bundled. This documents the public API contract used by source code and lets pnpm type-check/build resolve workspace packages.
6. Add `@eforge-build/eforge-plan` to lockstep version propagation when making it non-private. Without that entry, `pnpm publish-all` would publish a workspace package whose version is not advanced by `pnpm release`.
7. Keep feature behavior stable. Import rewrites and the compiled source-provider path change are the only runtime code changes planned in existing feature files.

### Concrete Build Shape

Use these package-level settings unless implementation testing exposes a TypeScript or bundling issue:

- `name`: `@eforge-build/eforge-plan`.
- `version`: the current lockstep version, currently `0.7.21` in this worktree.
- `type`: `module`.
- `exports`: `.` mapped to `./dist/index.js`/`./dist/index.d.ts`, plus `./package.json`.
- `types`: `./dist/index.d.ts`.
- `files`: `dist/`, `workstation-assets/`, `README.md`, and `LICENSE`.
- `scripts`: `build`, `build:runtime`, `build:workstation`, and `type-check`, where `build` runs `pnpm run build:workstation && pnpm run build:runtime`, `build:runtime` runs `tsup`, `build:workstation` runs `pnpm --dir workstation-src/plans build`, and `type-check` runs `tsc --noEmit`.
- `dependencies`: `@eforge-build/client`, `@eforge-build/extension-sdk`, `@eforge-build/input`, and `yaml`.
- `devDependencies`: `@eforge-build/eforge-plan-workstation`, `@types/node`, `tsup`, and `typescript`.
- `eforge.extension.name`: `eforge-plan`.
- `eforge.extension.entrypoint`: `./dist/index.js`.

The `tsup.config.ts` entries must be named so output filenames are stable:

```ts
// --- eforge:region plan-01-package-foundation ---
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'index.ts',
    'backlog-curation-source-provider': 'backlog-curation-source-provider.ts',
  },
  format: ['esm'],
  target: 'node22',
  clean: true,
  dts: true,
  splitting: false,
  skipNodeModulesBundle: false,
  external: [/^node:/],
});
// --- eforge:endregion plan-01-package-foundation ---
```

If `tsup` still leaves bare first-party imports in `dist/*.js`, add an explicit `noExternal` list for `@eforge-build/client`, `@eforge-build/extension-sdk`, `@eforge-build/input`, `yaml`, `zod`, and `@sinclair/typebox`.

Use this import replacement table across runtime files:

| Existing runtime import prefix | Replacement |
| --- | --- |
| `../../../packages/extension-sdk/src/index.js` | `@eforge-build/extension-sdk` |
| `../../../packages/input/src/index.js` | `@eforge-build/input` |
| `../../../packages/client/src/index.js` | `@eforge-build/client` |
| `../../../packages/client/src/extension-agent-tasks.js` | `@eforge-build/client` |

## Files

### Create
- `eforge/extensions/eforge-plan/tsup.config.ts` — compile `index.ts` and `backlog-curation-source-provider.ts` to ESM in `dist/`, clean previous output, emit declarations for the package root, and bundle non-node dependencies so installed extensions do not require local `node_modules`.
- `eforge/extensions/eforge-plan/LICENSE` — copy the repository Apache-2.0 license into the package root so npm artifacts include license text.
- `eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts` — focused tests for package metadata, runtime import audits, compiled entrypoint existence after build, and built artifact import safety.

### Modify
- `eforge/extensions/eforge-plan/package.json` — rename to `@eforge-build/eforge-plan`, remove `private`, align version with the current lockstep version, add description/license/repository/homepage/author/keywords/engines/publishConfig, add `exports`/`types`, add `files` for `dist/`, `workstation-assets/`, README, and LICENSE, add build/type-check scripts, declare public package dependencies, and change `eforge.extension.entrypoint` to `./dist/index.js` `[region: package-foundation, package metadata and build-script baseline]`.
- `eforge/extensions/eforge-plan/tsconfig.json` — keep `noEmit` type-checking but include `tsup.config.ts`; exclude generated `dist/`, `workstation-assets/`, `workstation-src/`, and tests `[region: package-foundation, package compiler inputs]`.
- `pnpm-workspace.yaml` — add `eforge/extensions/eforge-plan` as a workspace package while keeping the existing workstation package entry `[region: package-foundation, workspace package list]`.
- `package.json` — simplify root `type-check` so `pnpm -r type-check` owns the new package check, and keep `type-check:eforge-plan` as a filter-based compatibility alias if useful `[region: package-foundation, root build/type-check scripts]`.
- `tsconfig.base.json` — add a root `@eforge-build/client` path alias to `packages/client/src/index.ts` if public client root imports fail source type-checking before `dist/` exists `[region: package-foundation, public package source path aliases]`.
- `scripts/lib/lockstep-version.mjs` — add `eforge/extensions/eforge-plan/package.json` to `LOCKSTEP_PACKAGE_PATHS` so release propagation and publish verification include the new public package `[region: package-foundation, lockstep package path list]`.
- `pnpm-lock.yaml` — update workspace package/dependency metadata after changing package manifests.
- `eforge/extensions/eforge-plan/index.ts` — rewrite the extension-sdk import to `@eforge-build/extension-sdk`; no registration changes in this module `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/action-errors.ts` — rewrite extension-sdk/client source imports to public package imports.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — rewrite extension-sdk/client/input source imports to public package imports.
- `eforge/extensions/eforge-plan/backlog-curation-actions.ts` — rewrite extension-sdk/client imports and change `ANALYZE_ALL_SOURCE_PROVIDER.module` from `./backlog-curation-source-provider.ts` to `./dist/backlog-curation-source-provider.js` `[region: package-foundation, import block and source-provider module literal only]`.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — rewrite client/extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — rewrite extension-sdk/client source imports to public package imports.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — rewrite any package source imports to public package imports only; roadmap readers remain unchanged for `roadmap-backend` `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/board-actions.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/lifecycle.ts` — rewrite extension-sdk type import to public package import.
- `eforge/extensions/eforge-plan/lifecycle-projection.ts` — rewrite input type import to public package import.
- `eforge/extensions/eforge-plan/markdown-store.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` — rewrite extension-sdk/client imports to public package imports; annotation behavior remains unchanged `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/plan-revision-orchestration.ts` — rewrite input/client imports to public package imports; revision source text stays unchanged for `annotation-backend` `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/plan-revision-store.ts` — rewrite extension-sdk/client imports to public package imports; annotation storage remains unchanged for `annotation-backend` `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/planner-actions.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — rewrite client/input imports to public package imports; hardcoded roadmap behavior remains for `roadmap-backend` `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — rewrite extension-sdk/client imports to public package imports `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts` — rewrite extension-sdk/client imports to public package imports.
- `eforge/extensions/eforge-plan/promote.ts` — rewrite extension-sdk/input imports to public package imports.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/recommendation-refresh.ts` — rewrite extension-sdk/client imports to public package imports; refresh payload behavior remains for `roadmap-backend` `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/recommendation-status.ts` — rewrite extension-sdk imports to public package imports; roadmap fingerprint behavior remains for `roadmap-backend` `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/recommendation-status-schemas.ts` — rewrite extension-sdk/client imports to public package imports.
- `eforge/extensions/eforge-plan/recommendations-store.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/schema.ts` — rewrite extension-sdk/client imports to public package imports; single-roadmap schema remains for `roadmap-backend` `[region: package-foundation, import block only]`.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — rewrite extension-sdk/input imports to public package imports.
- `eforge/extensions/eforge-plan/session-plan-metadata.ts` — rewrite input imports to public package imports.
- `eforge/extensions/eforge-plan/session-plan-schemas.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/session-plan-view-model.ts` — rewrite input imports to public package imports.
- `eforge/extensions/eforge-plan/trace-store.ts` — rewrite extension-sdk source imports to public package imports.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update the package metadata test to expect package name `@eforge-build/eforge-plan`, non-private publish metadata, and `eforge.extension.entrypoint: "./dist/index.js"`; leave action behavior assertions for feature modules `[region: package-foundation, package metadata assertion only]`.

If temporary source coordination markers are needed in shared files, use the compiled plan slug `plan-01-package-foundation`, for example:

```ts
// --- eforge:region plan-01-package-foundation ---
// package-foundation-owned temporary code
// --- eforge:endregion plan-01-package-foundation ---
```

## Testing Strategy

### Unit Tests
- Add a package metadata test that reads `eforge/extensions/eforge-plan/package.json` and asserts:
  - `name` is `@eforge-build/eforge-plan`.
  - `private` is absent or `false`.
  - `eforge.extension.name` is `eforge-plan`.
  - `eforge.extension.entrypoint` is `./dist/index.js`.
  - `files` includes `dist/` and `workstation-assets/`.
  - scripts include `build` and `type-check`.
- Add a runtime import audit that scans extension runtime `*.ts` files while excluding `__tests__/`, `workstation-src/`, `workstation-assets/`, and `dist/`; assert no file contains `../../../packages`, `../../../../packages`, or `packages/.*?/src` imports.
- Add a source-provider literal test that reads `backlog-curation-actions.ts` and asserts it contains `./dist/backlog-curation-source-provider.js` and does not contain `./backlog-curation-source-provider.ts`.
- Update the existing registration metadata assertion to the compiled entrypoint.

### Integration Tests
- In `package-foundation.test.ts`, build the package once when `dist/index.js` or `workstation-assets/plans/index.js` is absent by running `pnpm --filter @eforge-build/eforge-plan build` with a 120 second timeout.
- Assert these generated files exist after the build:
  - `eforge/extensions/eforge-plan/dist/index.js`
  - `eforge/extensions/eforge-plan/dist/backlog-curation-source-provider.js`
  - `eforge/extensions/eforge-plan/workstation-assets/plans/index.js`
  - `eforge/extensions/eforge-plan/workstation-assets/plans/style.css`
- Dynamically import `dist/index.js` in the test process and assert its default export is a function.
- Register the dynamically imported built extension with `createExtensionRecorder` and assert it registers at least one action, one input source, one deep link, one integration command, and one frame-bundle workstation.
- Inspect built runtime JS and assert it contains neither monorepo-relative package source paths nor `packages/*/src` references. If `tsup` bundles dependencies, also assert the built entrypoint has no bare `from "@eforge-build/` or `from '@eforge-build/` import statements.

## Verification

- [ ] `pnpm --filter @eforge-build/eforge-plan build` exits 0 and creates `dist/index.js` plus `dist/backlog-curation-source-provider.js`.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation build` exits 0 and creates `workstation-assets/plans/index.js` plus `style.css`.
- [ ] `node -e "import('./eforge/extensions/eforge-plan/dist/index.js').then((m)=>{ if (typeof m.default !== 'function') process.exit(1) })"` exits 0 after the package build.
- [ ] `rg "\.\./\.\./\.\./packages|\.\./\.\./\.\./\.\./packages|packages/.*/src" eforge/extensions/eforge-plan -g "*.ts" -g "!__tests__/**" -g "!workstation-src/**" -g "!workstation-assets/**" -g "!dist/**"` returns no matches.
- [ ] `eforge/extensions/eforge-plan/package.json` contains `"name": "@eforge-build/eforge-plan"` and `"eforge": { "extension": { "name": "eforge-plan", "entrypoint": "./dist/index.js" } }`.
- [ ] `eforge/extensions/eforge-plan/backlog-curation-actions.ts` contains `./dist/backlog-curation-source-provider.js`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/package-foundation.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts test/eforge-plan-workstation.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "verify"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
