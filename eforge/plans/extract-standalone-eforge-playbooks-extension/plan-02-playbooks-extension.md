---
id: plan-02-playbooks-extension
name: Create and register the @eforge-build/eforge-playbooks extension package
  with playbook actions, schemas, capabilities, optional eforge-plan dependency,
  Console contribution, README, and package tests.
branch: extract-standalone-eforge-playbooks-extension/playbooks-extension
---

# Playbooks Extension

## Architecture Reference

This module implements the `extension-package-and-actions` responsibility from the architecture, especially:

- **Shared data model and contracts > Extension package**
- **Shared data model and contracts > Action IDs**
- **Shared data model and contracts > Action inputs and outputs**
- **Shared data model and contracts > Autonomous queue handoff**
- **Shared data model and contracts > Planning-mode handoff**
- **Shared data model and contracts > Console contribution contract**
- **Integration contracts by subsystem > Host compatibility commands/tools** as the producer of extension-owned capabilities that later host modules invoke

This module depends on `foundation-queue-contract`: autonomous `run-playbook` uses the producer-agnostic `EnqueueRequest.postMerge?: string[]` field added there. Do not implement this module before that queue contract is present.

Key constraints from architecture:

- Create `eforge/extensions/eforge-playbooks/` as package `@eforge-build/eforge-playbooks`, extension name `eforge-playbooks`, entrypoint `./dist/index.js`.
- Register the standalone package in `pnpm-workspace.yaml` and lockstep publish/version propagation.
- Declare capabilities `eforge.playbooks.management` and `eforge.playbooks.run`, both version `1.0.0`.
- Declare an optional dependency on provider `eforge-plan` with capability `eforge.plan.planning-mode-playbook` satisfying `>=1.0.0`.
- Expose extension actions for `list-playbooks`, `show-playbook`, `save-playbook`, `validate-playbook`, `copy-playbook`, `promote-playbook`, `demote-playbook`, and `run-playbook`.
- Use only generic extension action/contribution and `ctx.buildQueue.enqueue(...)` paths; do not add or call direct `/api/playbook/*`, `apiPlaybook*`, monitor playbook-service, or queue internals.
- Keep `packages/input/src/playbook.ts` as the source of pure parser/storage/compiler behavior; do not import `createPlaybookWorkflowAdapter`, `builtin:playbooks`, or `packages/input/src/playbook-workflow.ts`.
- Planning-mode `run-playbook` must check `ctx.capabilities.get('eforge.plan.planning-mode-playbook', '>=1.0.0')`, return eforge-plan planning-entry metadata when available, return diagnostics when unavailable, and never create session plans or enqueue PRDs.
- Autonomous `run-playbook` must compile to normalized build source, run the existing acceptance-criteria quality gate, and enqueue through generic build-queue handoff while preserving profile, post-merge, landing, and `afterQueueId` behavior.
- Console playbook management must be available as extension-owned contribution metadata, not as a core Console section.

## Scope

### In Scope

- Create the publishable first-party package `@eforge-build/eforge-playbooks` under `eforge/extensions/eforge-playbooks/`.
- Add package manifest metadata, runtime entrypoint, TypeScript config, tsup config, README, LICENSE, and package-local tests.
- Register the new workspace package and add it to lockstep release propagation.
- Define TypeBox action input/output schemas owned by the extension.
- Implement all eight playbook actions with extension-owned validation and user-error mapping.
- Implement autonomous run handoff via `ctx.buildQueue.enqueue({ source, profile, postMerge, afterQueueId, landingAction, landingAutoMerge })`.
- Implement planning-mode run metadata/diagnostic responses using `ctx.capabilities`.
- Register integration commands mirroring the action IDs for host discoverability.
- Register a declarative Console contribution that references the canonical local action IDs.
- Add package-local tests for registration, schemas, package metadata/publication, CRUD action behavior, autonomous enqueue handoff, planning dependency diagnostics, and eforge-plan contribution-id drift.

### Out of Scope

- Removing direct daemon playbook routes or client helpers; `boundary-removal` owns that.
- Migrating CLI, MCP, Claude Code plugin, Pi commands/tools, or skills; `host-migration` owns that.
- Removing core Console `PlaybooksSection`; `console-surface` owns that.
- Removing `packages/input/src/playbook-workflow.ts` or its exports; `input-artifact-boundary` owns that.
- Updating public docs beyond the new package README; `docs-and-regression-guards` owns public docs and generated references.
- Changing the build engine, queue internals, scheduler, approvals, or wrapper workflow orchestration.
- Adding workstation browser assets for this module. The declarative Console contribution is the required Console surface for this package.

## Implementation Approach

### Overview

Build `eforge-playbooks` as a small native extension package that imports only public package APIs (`@eforge-build/extension-sdk` and `@eforge-build/input`). Split the runtime into focused modules so each new implementation file remains below the repository file-size cap:

1. Package metadata and build config mirror the first-party `eforge-plan` package, but without workstation build steps.
2. Runtime constants define action IDs, capability IDs, and eforge-plan planning-entry constants in one place.
3. TypeBox schemas define every action contract and output union.
4. Storage/action helpers wrap pure `@eforge-build/input` playbook helpers and add action-level validation, overwrite checks, exact-scope resolution, JSON-safe projections, and `ExtensionActionUserError` mapping.
5. `run-playbook` branches by resolved playbook mode:
   - `planning` returns metadata/diagnostics and does not touch the build queue.
   - `autonomous` compiles the playbook, applies the acceptance-criteria quality gate, then calls `ctx.buildQueue.enqueue(...)`.
6. `index.ts` registers the actions, integration commands, and Console contribution.
7. Package-local tests exercise the extension through `createExtensionRecorder`, `buildExtensionContributionManifest`, and `dispatchExtensionAction` with fake build queue/capability registries.

The extension must use `ctx.paths.configDir` and `ctx.cwd` for scoped playbook operations. The monitor already passes the daemon-resolved config directory into extension action dispatch; tests must pass `configDir` explicitly when dispatching actions against temp projects.

### Key Decisions

1. **Use public pure input helpers, not the current workflow adapter.**
   - Rationale: `@eforge-build/input` already exports `listPlaybooks`, `loadPlaybook`, `parsePlaybook`, `validatePlaybook`, `writePlaybook`, `movePlaybook`, `copyPlaybookToScope`, `playbookToBuildSource`, `playbookToPlanSeed`, `analyzeAcceptanceCriteriaInBody`, and `formatAcDiagnostics`. Importing these keeps the extension independent of `builtin:playbooks` and lets the later input-boundary module delete the workflow adapter.

2. **Keep action IDs local and mirror them as integration command IDs.**
   - Rationale: the runtime prefixes local action IDs into effective IDs such as `eforge-playbooks:run-playbook`. Mirrored integration commands make host migration deterministic; callers that disambiguate by kind can invoke either the action or command with the same effective id.

3. **Support existing nested save payloads inside the extension-owned action.**
   - Rationale: current callers send `{ scope, playbook: { frontmatter, body } }`. `save-playbook` will also accept raw Markdown and flattened fields, but all variants are handled by the extension action rather than a daemon compatibility route. The handler enforces a single payload variant, validates any top-level `name` against the parsed/structured playbook name, and defaults `overwrite` to `true` to preserve current save behavior.

4. **Serialize planning seeds as JSON-safe data.**
   - Rationale: `playbookToPlanSeed()` returns a `Map` for sections, but extension action outputs must be JSON-safe. The extension projects the seed as `{ sessionId, topic, sections: Record<string, string>, seededFrom, profile? }`. Package tests must assert no `Map`, `undefined`, or non-plain objects appear in action outputs.

5. **Use capability lookup only at runtime, and test eforge-plan contribution drift separately.**
   - Rationale: `ctx.capabilities.get(...)` is the runtime contract. The action returns fixed eforge-plan contribution/deep-link/workstation metadata when the capability is available. A package-local drift test records `eforge-plan` and asserts those fixed constants still match the provider's registered action, integration command, deep link, workstation, and package capability.

6. **Let generic enqueue validate queue-level fields, then convert enqueue failures to user-visible action failures.**
   - Rationale: profile existence, `afterQueueId`, and landing/auto-merge constraints belong to generic enqueue validation. `run-playbook` passes the fields through unchanged and wraps `ctx.buildQueue.enqueue(...)` exceptions in `ExtensionActionUserError` so the generic action invocation path returns an `invalid-input` failure with the queue validation message instead of a generic handler error.

7. **Use a declarative Console contribution rather than a workstation bundle.**
   - Rationale: action buttons/forms cover inventory and management needs for this migration and keep this module smaller. `console-surface` can later rely on generic extension contribution rendering after removing the core System section.

## Files

### Create

- `eforge/extensions/eforge-playbooks/package.json` — publishable package manifest for `@eforge-build/eforge-playbooks`, `eforge.extension` metadata, capabilities, optional dependency, scripts, dependencies, exports, files list.
- `eforge/extensions/eforge-playbooks/tsconfig.json` — package type-check config extending `../../../tsconfig.base.json`, excluding `dist` and `__tests__`.
- `eforge/extensions/eforge-playbooks/tsup.config.ts` — ESM runtime bundle config with `dts: true`, `splitting: false`, bundled workspace dependencies, and `node:` externals.
- `eforge/extensions/eforge-playbooks/LICENSE` — Apache-2.0 license file matching first-party extension packages.
- `eforge/extensions/eforge-playbooks/README.md` — package README documenting trust model, install/manage commands, capabilities, optional eforge-plan dependency, actions, planning-mode behavior, autonomous queue handoff, Console contribution, and storage model.
- `eforge/extensions/eforge-playbooks/constants.ts` — action IDs, capability IDs, eforge-plan planning-entry constants, scope/mode lists, and helper arrays for registration/tests.
- `eforge/extensions/eforge-playbooks/schemas.ts` — TypeBox schemas and exported static types for all action inputs/outputs, JSON-safe playbook projections, planning metadata, diagnostics, and run result union.
- `eforge/extensions/eforge-playbooks/json-safe.ts` — small projection helpers for removing `undefined` values and converting `PlaybookPlanSeed.sections` from `Map` to `Record<string, string>`.
- `eforge/extensions/eforge-playbooks/action-errors.ts` — helpers that create `ExtensionActionUserError` instances with stable `path`/`message` details.
- `eforge/extensions/eforge-playbooks/storage.ts` — scoped playbook path helpers, exact-scope resolution, highest-precedence resolution, shadow projection, overwrite checks, save payload normalization, and acceptance-criteria save gate.
- `eforge/extensions/eforge-playbooks/planning.ts` — planning capability lookup, diagnostics normalization, planning-entry metadata construction, and eforge-plan drift constants re-exported for tests.
- `eforge/extensions/eforge-playbooks/playbook-actions.ts` — action definitions for list/show/save/validate/copy/promote/demote plus shared registration helper.
- `eforge/extensions/eforge-playbooks/run-playbook-action.ts` — action definition for `run-playbook`, autonomous queue handoff, AC quality gate, mode mismatch handling, and planning-mode branch.
- `eforge/extensions/eforge-playbooks/index.ts` — default `defineEforgeExtension` entrypoint registering all actions, integration commands, Console contribution, and optional deep link.
- `eforge/extensions/eforge-playbooks/__tests__/package-foundation.test.ts` — package metadata, workspace registration, lockstep release wiring, tsconfig/tsup shape, and source-import boundary tests.
- `eforge/extensions/eforge-playbooks/__tests__/package-publication.test.ts` — build/import safety and `npm pack --dry-run --json` file-list tests.
- `eforge/extensions/eforge-playbooks/__tests__/registration.test.ts` — recorder/manifest tests for action IDs, schemas, side effects, integration commands, Console contribution blocks, capabilities, optional dependency metadata, and no invalid registrations.
- `eforge/extensions/eforge-playbooks/__tests__/actions-crud.test.ts` — dispatch tests for list/show/save/validate/copy/promote/demote behavior across scopes, shadows, profiles, validation errors, and overwrite flags.
- `eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts` — dispatch tests for autonomous enqueue handoff, AC gate failures, mode mismatch, scoped resolution, planning available/unavailable branches, JSON-safe planning seed, and no queue call for planning mode.
- `eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts` — drift guard comparing `eforge-playbooks` planning constants with recorded `eforge-plan` capability/action/integration-command/deep-link/workstation registrations.

### Modify

- `pnpm-workspace.yaml` — add `eforge/extensions/eforge-playbooks` to workspace packages `[region: playbooks-extension, packages list next to eforge-plan]`.
- `scripts/lib/lockstep-version.mjs` — add `eforge/extensions/eforge-playbooks/package.json` to `LOCKSTEP_PACKAGE_PATHS` next to `eforge/extensions/eforge-plan/package.json` `[region: playbooks-extension, LOCKSTEP_PACKAGE_PATHS first-party extensions block]`.
- `package.json` — add a convenience script `type-check:eforge-playbooks` using `pnpm --filter @eforge-build/eforge-playbooks type-check`; leave existing scripts intact.
- `pnpm-lock.yaml` — add the new workspace importer and lock direct dependencies by running `pnpm install --lockfile-only` or equivalent after the package manifest is created.

Do not modify `packages/client/**`, `packages/monitor/**`, `packages/input/**`, `packages/eforge/src/cli/**`, `packages/pi-eforge/**`, `eforge-plugin/**`, or `packages/console-ui/**` in this module.

## Implementation Details

### Package manifest

`eforge/extensions/eforge-playbooks/package.json` must use the current lockstep version from `packages/eforge/package.json` and include:

- `name: "@eforge-build/eforge-playbooks"`
- `private` absent or `false`
- `license: "Apache-2.0"`
- `type: "module"`
- `exports` for `.` and `./package.json`
- `types: "./dist/index.d.ts"`
- `files: ["dist/", "README.md", "LICENSE"]`
- `scripts.build: "tsup"`
- `scripts.type-check: "tsc --noEmit"`
- dependencies on `@eforge-build/extension-sdk` and `@eforge-build/input` with `workspace:*`
- dev dependencies on `@types/node`, `tsup`, and `typescript`
- `eforge.extension.name: "eforge-playbooks"`
- `eforge.extension.entrypoint: "./dist/index.js"`
- `eforge.extension.capabilities` containing `eforge.playbooks.management` and `eforge.playbooks.run`, both `1.0.0`
- `eforge.extension.dependencies.optional` containing provider `eforge-plan` with capability `eforge.plan.planning-mode-playbook` version `>=1.0.0`

### Action behavior

- `list-playbooks`
  - Input: optional `scope`, `mode`, `includeShadowed`.
  - Default `includeShadowed` to `true` to preserve existing list output.
  - Use `listPlaybooks({ cwd: ctx.cwd, configDir: ctx.paths.configDir })`.
  - Filter `scope` against the winning storage `source`, filter `mode` against declared mode, and strip `shadows` only when `includeShadowed === false`.
  - Output `{ playbooks, warnings }` with JSON-safe entries.

- `show-playbook`
  - Input: `name`, optional `scope`.
  - Without `scope`, resolve the highest-precedence copy.
  - With `scope`, load exactly `<scopeRoot>/playbooks/<name>.md` and return a not-found user error when that scope lacks the file.
  - Output `{ playbook, source, shadows }`; include the resolved absolute `path` in `source` metadata if the schema includes it.

- `save-playbook`
  - Input supports one of: raw Markdown, current nested `{ playbook: { frontmatter, body } }`, or flattened fields.
  - Normalize into an `@eforge-build/input` `Playbook` and validate the frontmatter/body using `parsePlaybook` or `playbookFrontmatterSchema` plus body checks.
  - Run `analyzeAcceptanceCriteria(playbook.acceptanceCriteria)` when the section is non-empty; throw `ExtensionActionUserError` with `formatAcDiagnostics(...)` when invalid.
  - If `overwrite === false`, fail before writing when the target file exists.
  - Write with `writePlaybook({ cwd, configDir, scope, playbook })` and return `{ path }`.

- `validate-playbook`
  - Input: `raw` string and optional `scope` for future diagnostics; no filesystem writes.
  - Return `{ ok: true }` or `{ ok: false, errors }` from `validatePlaybook(raw)`.
  - Do not run the save/run acceptance-criteria quality gate in this action; this preserves current raw validation semantics.

- `copy-playbook`
  - Input: `name`, `targetScope`, optional `sourceScope`, `overwrite`.
  - Without `sourceScope`, use `copyPlaybookToScope(...)` when `overwrite !== false`.
  - With `sourceScope`, load the exact source-scope copy, update frontmatter `scope` to `targetScope`, honor `overwrite === false`, then write to target.
  - Output `{ sourcePath, targetPath, targetScope }`.

- `promote-playbook`
  - Move from `project-local` to `project-team` with `movePlaybook(...)`.
  - Return `{ path }`.

- `demote-playbook`
  - Move from `project-team` to `project-local` with `movePlaybook(...)`.
  - Return `{ path }`.

- `run-playbook`
  - Input: `name`, optional `scope`, `mode`, `profile`, `afterQueueId`, `landingAction`, `landingAutoMerge`.
  - Resolve exact scope when supplied; otherwise use highest-precedence resolution.
  - If `input.mode` is supplied and differs from the playbook frontmatter mode, throw a user error with path `/mode`.
  - For `mode: "planning"`:
    - Call `playbookToPlanSeed(playbook)` and project the `sections` map into a plain object.
    - Call `ctx.capabilities.get('eforge.plan.planning-mode-playbook', '>=1.0.0')`.
    - When available, return `{ kind: 'requires-agent', mode: 'planning', name, requiredCapability, planningEntry, message }`.
    - When unavailable, return `{ kind: 'planning-unavailable', mode: 'planning', name, requiredCapability, diagnostics, planningEntry?, message }`.
    - Do not call `ctx.buildQueue.enqueue(...)`, session-plan helpers, or PRD enqueue helpers.
  - For `mode: "autonomous"`:
    - Call `playbookToBuildSource(playbook)`.
    - Run `analyzeAcceptanceCriteriaInBody(compiled.source)`; on diagnostics, throw `ExtensionActionUserError` containing `formatAcDiagnostics(...)`.
    - Compute `effectiveProfile = input.profile ?? compiled.profile`.
    - Call `ctx.buildQueue.enqueue({ source: compiled.source, profile: effectiveProfile, postMerge: compiled.postMerge, afterQueueId, landingAction, landingAutoMerge })`, omitting undefined fields.
    - Return `{ kind: 'enqueued', id: enqueued.sessionId, sessionId: enqueued.sessionId, autoBuild: enqueued.autoBuild }`. Include `pid` only if the output schema declares it.
    - Catch enqueue exceptions and rethrow as `ExtensionActionUserError` with a message starting `Playbook enqueue failed:`.

### Console and integration registrations

`index.ts` must:

- Register all actions first.
- Register integration commands for all eight action IDs, each binding to the same local action ID.
- Register a Console contribution with at least these blocks:
  - markdown summary explaining extension-owned playbook management
  - action button for `list-playbooks`
  - action form for `show-playbook`
  - action form for `save-playbook`
  - action form for `validate-playbook`
  - action form for `copy-playbook`
  - action form for `promote-playbook`
  - action form for `demote-playbook`
  - action form for `run-playbook`
- Optionally register a deep link `inventory` bound to `list-playbooks`; no workstation bundle is required.

## Testing Strategy

### Unit Tests

- `registration.test.ts`
  - Record the extension with `createExtensionRecorder('eforge-playbooks', ...)`.
  - Assert no `extension:invalid-registration` diagnostics.
  - Assert action local IDs and effective IDs equal the canonical eight IDs.
  - Assert every action input schema has root `type: "object"` and every action has an output schema.
  - Assert side effects by action category:
    - list/show: `local-read`
    - validate: `none`
    - save/promote/demote: `local-write`
    - copy: `local-read`, `local-write`
    - run: `local-read`, `daemon-state`, `build-queue`
  - Assert integration command IDs mirror the eight action IDs and each command action binding points to the matching effective action ID.
  - Assert the Console contribution references only the canonical action IDs.
  - Assert package metadata declares capabilities and optional eforge-plan dependency.

- `actions-crud.test.ts`
  - Create temp projects with `eforge/playbooks`, `.eforge/playbooks`, and user scope isolated via `XDG_CONFIG_HOME`.
  - Dispatch actions through `dispatchExtensionAction` and the recorded registry.
  - Verify list ordering, source scope, shadow chain, mode, and profile projection.
  - Verify show highest-precedence behavior and exact-scope behavior.
  - Verify save writes a file, bad AC returns `invalid-input`, and `overwrite: false` leaves the existing file unchanged.
  - Verify validate returns `ok: true` for valid raw Markdown and `ok: false` with errors for invalid raw Markdown.
  - Verify copy updates target frontmatter `scope` and returns absolute source/target paths.
  - Verify promote/demote move between the project-local and project-team playbook directories.

- `run-playbook-action.test.ts`
  - Dispatch autonomous run with fake `buildQueue.enqueue` that records the request and returns `{ sessionId, pid, autoBuild }`.
  - Assert the enqueue request contains compiled Markdown source, `profile`, `postMerge`, `afterQueueId`, `landingAction`, and `landingAutoMerge` when supplied or inherited.
  - Assert autonomous output aliases `id` to `sessionId`.
  - Assert bad autonomous acceptance criteria produce an `invalid-input` action result and zero enqueue calls.
  - Assert planning-mode output with no eforge-plan provider is `planning-unavailable`, contains capability diagnostics plus load/trust/reload guidance, contains a JSON-safe planning seed, and records zero enqueue calls.
  - Assert planning-mode output with a fake loaded eforge-plan capability is `requires-agent`, contains `eforge-plan:open-planning-entry`, `eforge-plan:planning-workstation`, `/console/workstations/eforge-plan%3Aplanning-workstation`, a JSON-safe seed, and records zero enqueue calls.
  - Assert an input `mode` mismatch returns `invalid-input` and records zero enqueue calls.
  - Assert a fake enqueue rejection becomes an `invalid-input` action result whose message starts `Playbook enqueue failed:`.

- `planning-contract.test.ts`
  - Record `eforge-plan` with `createExtensionRecorder` and `buildExtensionContributionManifest`.
  - Assert the provider package declares `eforge.plan.planning-mode-playbook` version `1.0.0`.
  - Assert the `eforge-playbooks` constants match the provider's registered action `eforge-plan:open-planning-entry`, integration command `eforge-plan:open-planning-entry`, deep link `eforge-plan:planning-workstation`, workstation `eforge-plan:planning-workstation`, and workstation URL `/console/workstations/eforge-plan%3Aplanning-workstation`.

- `package-foundation.test.ts` and `package-publication.test.ts`
  - Assert workspace registration, lockstep script inclusion, package metadata, dependency list, build scripts, tsconfig excludes, tsup `noExternal`, public runtime imports, build artifacts, import safety, and packed files.

### Integration Tests

- Build/import the package runtime with `pnpm --filter @eforge-build/eforge-playbooks build`, then import `dist/index.js` in a separate Node process.
- Dispatch `run-playbook` through `dispatchExtensionAction` with a fake `buildQueue` to exercise the same action context shape used by monitor generic extension action invocation.
- Build a combined test registry containing `eforge-playbooks` actions and a fake loaded `eforge-plan` capability to verify `ctx.capabilities.get(...)` behavior.

## Verification

- [ ] `pnpm-workspace.yaml` contains `eforge/extensions/eforge-playbooks`.
- [ ] `scripts/lib/lockstep-version.mjs` contains `eforge/extensions/eforge-playbooks/package.json` in `LOCKSTEP_PACKAGE_PATHS`.
- [ ] `pnpm-lock.yaml` contains an importer block for `eforge/extensions/eforge-playbooks`.
- [ ] `eforge/extensions/eforge-playbooks/package.json` declares package name `@eforge-build/eforge-playbooks`, extension name `eforge-playbooks`, entrypoint `./dist/index.js`, the two playbook capabilities, and the optional eforge-plan dependency.
- [ ] `pnpm --filter @eforge-build/eforge-playbooks type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-playbooks build` exits 0.
- [ ] `node --input-type=module -e "await import('./eforge/extensions/eforge-playbooks/dist/index.js')"` exits 0 after the package build.
- [ ] `npm pack --ignore-scripts --dry-run --json` from `eforge/extensions/eforge-playbooks` lists `dist/index.js`, `dist/index.d.ts`, `README.md`, `LICENSE`, and `package.json`, and lists no `__tests__/`, `node_modules/`, `tsconfig.json`, or `tsup.config.ts` entries.
- [ ] Recorder tests show exactly these local action IDs: `copy-playbook`, `demote-playbook`, `list-playbooks`, `promote-playbook`, `run-playbook`, `save-playbook`, `show-playbook`, `validate-playbook`.
- [ ] Manifest tests show the Console contribution action bindings resolve to `eforge-playbooks:*` effective action IDs.
- [ ] CRUD action tests prove list/show/save/validate/copy/promote/demote behavior across `project-local`, `project-team`, and `user` scopes.
- [ ] Autonomous run action tests prove the fake build-queue request includes `source`, inherited or overridden `profile`, `postMerge`, `afterQueueId`, `landingAction`, and `landingAutoMerge` fields.
- [ ] Planning run action tests prove `requires-agent` and `planning-unavailable` responses contain JSON-safe planning seeds and never call the fake build queue.
- [ ] Drift tests prove eforge-plan still provides `eforge.plan.planning-mode-playbook`, `eforge-plan:open-planning-entry`, `eforge-plan:planning-workstation`, and `/console/workstations/eforge-plan%3Aplanning-workstation`.
- [ ] `rg -n "createPlaybookWorkflowAdapter|PLAYBOOK_WORKFLOW_ADAPTER_DESCRIPTOR|builtin:playbooks|playbook-service|/api/playbook|apiPlaybook" eforge/extensions/eforge-playbooks --glob '!README.md'` returns no matches.
- [ ] `pnpm vitest run eforge/extensions/eforge-playbooks/__tests__/package-foundation.test.ts eforge/extensions/eforge-playbooks/__tests__/registration.test.ts eforge/extensions/eforge-playbooks/__tests__/actions-crud.test.ts eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0 with every new implementation file at or below 600 lines and every new test file at or below 1,200 lines.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["api", "security"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
