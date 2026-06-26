---
id: plan-01-playbook-domain-extraction
name: Move canonical playbook model, parser, serializer, validation, storage,
  compiler, and planning seed behavior into eforge-playbooks and rewire its
  actions/tests.
branch: extract-playbook-domain-ownership-to-eforge-playbooks/playbook-domain-extraction
---

# Playbook Domain Extraction

## Architecture Reference

This module implements the `Module: playbook-domain-extraction` section and the `Shared data model > Extension-owned playbook domain` section from the architecture.

Key constraints from architecture:
- `eforge/extensions/eforge-playbooks/**` is the sole implementation owner for playbook model, parsing, serialization, validation, storage, compilation, and planning-seed extraction.
- `@eforge-build/input` may remain a dependency only for domain-neutral acceptance-criteria quality helpers; no import clause from `@eforge-build/input` may include playbook-specific symbols.
- Split the moved implementation into focused files instead of moving `packages/input/src/playbook.ts` as one oversized file.
- Keep the existing extension action surface for list/show/save/validate/copy/promote/demote/run so host modules can continue using generic contribution discovery and invocation.
- Use eforge-plan’s generic planning workstation capability, not the playbook-named `eforge.plan.planning-mode-playbook` capability.
- Do not add compatibility shims or host-facing playbook facades.

## Scope

### In Scope
- Create extension-local domain modules for playbook model, parser, serializer, validation, storage, build-source compilation, and planning-seed extraction.
- Rewire `eforge-playbooks` actions and helpers away from `@eforge-build/input` playbook imports.
- Keep `@eforge-build/input` imports limited to `analyzeAcceptanceCriteria`, `analyzeAcceptanceCriteriaInBody`, and `formatAcDiagnostics`.
- Switch eforge-playbooks optional eforge-plan dependency metadata and runtime availability checks to `eforge.plan.planning-workstation >=1.0.0`.
- Update eforge-playbooks package metadata, bundling config, README, and extension-local tests.
- Add direct extension tests for parse, serialize, validate, storage, move/copy, autonomous compile, and planning seed extraction.

### Out of Scope
- Deleting `packages/input/src/playbook.ts`, `packages/input/src/playbook-plan-seed.ts`, input exports, or session-plan playbook seed helpers; that work belongs to `input-neutrality`.
- Removing CLI, MCP, Pi, Claude plugin, Console, or docs-generator playbook facades; that work belongs to `host-surface-neutrality`.
- Removing `playbookDraft` or eforge-plan task contract fields; that work belongs to `planning-contract-neutralization`.
- Source-wide boundary tests and public/generated documentation regeneration; that work belongs to `boundary-docs-validation`.
- Changing the existing playbook file format, scope names, action IDs, or action payload shapes.

## Implementation Approach

### Overview

Copy the current playbook behavior out of `@eforge-build/input` into three new extension-local modules, then update the existing action handlers to import those modules. Keep action IDs and schemas stable. This makes the extension self-sufficient before `input-neutrality` deletes the old input exports.

The resulting dependency direction is:

```text
eforge-playbooks actions
  -> ./model.js          parse / serialize / validation / model types
  -> ./storage-core.js   scope-aware file storage via @eforge-build/scopes
  -> ./compile.js        autonomous build-source and planning seed extraction
  -> @eforge-build/input acceptance-criteria quality helpers only
```

### Key Decisions

1. **Do not export domain helpers from `index.ts`.** Keep `parsePlaybook`, `listPlaybooks`, and related helpers as extension-local module exports for runtime and tests. This avoids creating a new public host import target while still moving canonical ownership into the extension package.
2. **Preserve existing action contracts.** The module changes implementation ownership, not the generic contribution surface. Existing effective action IDs such as `eforge-playbooks:list-playbooks` remain available through the extension contribution manifest.
3. **Keep storage in named-set directories.** Use `@eforge-build/scopes` `listNamedSet`, `resolveNamedSet`, and `getScopeDirectory` so existing files stay in `.eforge/playbooks/`, `eforge/playbooks/`, and the user eforge config directory.
4. **Keep acceptance-criteria analysis generic.** `save-playbook` and autonomous `run-playbook` continue using input’s acceptance-criteria quality helpers, but no playbook symbol is imported from input.
5. **Switch to generic planning capability now.** Change eforge-playbooks to require `eforge.plan.planning-workstation >=1.0.0`; `planning-contract-neutralization` can then remove the old playbook-named provider capability without breaking this extension.
6. **Mirror current behavior before deleting old exports.** Preserve current validation messages, serialization format, list precedence, shadow metadata, warning behavior, overwrite semantics, and mode mismatch errors so this module is a mechanical ownership move.

### Domain Module Contracts

`model.ts` exports:

- `playbookScopeSchema`, `playbookFrontmatterSchema`
- `PlaybookScope`, `PlaybookFrontmatter`, `PlaybookMode`, `PlaybookBody`, `Playbook`
- `PlaybookModeMismatchError`
- `parsePlaybook(raw)`, `serializePlaybook(playbook)`, `validatePlaybook(raw)`

`storage-core.ts` exports:

- `PlaybookNotFoundError`
- `PlaybookShadowEntry`, `PlaybookEntry`
- `ListPlaybooksOpts`, `LoadPlaybookOpts`, `WritePlaybookOpts`, `MovePlaybookOpts`, `CopyPlaybookToScopeOpts`, `CopyPlaybookToScopeResult`
- `listPlaybooks(opts)`, `loadPlaybook(opts)`, `writePlaybook(opts)`, `movePlaybook(opts)`, `copyPlaybookToScope(opts)`
- `resolvePlaybookPath(scope, opts, name)` or an equivalent helper used by `storage.ts`

`compile.ts` exports:

- `CompiledPlaybookBuildSource`
- `PlaybookPlanSeed`
- `playbookToBuildSource(playbook)`
- `playbookToPlanSeed(playbook)`

## Files

### Create

- `eforge/extensions/eforge-playbooks/model.ts` — playbook frontmatter/body types, Zod schemas, frontmatter splitting, body parsing, `parsePlaybook`, `serializePlaybook`, `validatePlaybook`, and `PlaybookModeMismatchError`.
- `eforge/extensions/eforge-playbooks/storage-core.ts` — scope-aware playbook list/load/write/move/copy helpers using `@eforge-build/scopes` named-set APIs and extension-local parser/serializer.
- `eforge/extensions/eforge-playbooks/compile.ts` — extension-local `playbookToBuildSource`, `playbookToPlanSeed`, build-source output type, and plan-seed type.
- `eforge/extensions/eforge-playbooks/__tests__/model.test.ts` — direct parser, serializer, schema, and validation tests for the extension-owned model module.
- `eforge/extensions/eforge-playbooks/__tests__/storage-core.test.ts` — direct storage, precedence, shadow, move, copy, overwrite, and warning tests for the extension-owned storage module.
- `eforge/extensions/eforge-playbooks/__tests__/compile.test.ts` — direct autonomous compile and planning-seed extraction tests for the extension-owned compiler module.

### Modify

- `eforge/extensions/eforge-playbooks/playbook-actions.ts` — replace `@eforge-build/input` playbook imports with `./model.js` and `./storage-core.js`; keep action handler behavior and output shapes unchanged.
- `eforge/extensions/eforge-playbooks/storage.ts` — import parser/schema/types and storage helpers from local modules; retain only domain-neutral acceptance-criteria imports from `@eforge-build/input`; route exact-scope path resolution through the new storage helper.
- `eforge/extensions/eforge-playbooks/run-playbook-action.ts` — import `playbookToBuildSource` and `playbookToPlanSeed` from `./compile.js`; keep input imports limited to acceptance-criteria helpers.
- `eforge/extensions/eforge-playbooks/planning.ts` — import `PlaybookPlanSeed` from `./compile.js`; switch required capability diagnostics and messages to the generic eforge-plan planning workstation capability.
- `eforge/extensions/eforge-playbooks/json-safe.ts` — import `PlaybookPlanSeed` from `./compile.js`; keep JSON projection semantics unchanged.
- `eforge/extensions/eforge-playbooks/constants.ts` — replace `eforge.plan.planning-mode-playbook` with `eforge.plan.planning-workstation`; rename internal constants to `PLANNING_WORKSTATION_CAPABILITY*` if that reduces ambiguity; keep exported action IDs unchanged.
- `eforge/extensions/eforge-playbooks/schemas.ts` — update required capability literals to the new generic planning capability constants; keep run output result variants unchanged.
- `eforge/extensions/eforge-playbooks/index.ts` — update Console contribution copy if it references the old playbook-named capability; do not export the new domain helper modules from the package entrypoint.
- `eforge/extensions/eforge-playbooks/package.json` — add direct dependencies on `@eforge-build/scopes`, `yaml`, and `zod`; keep `@eforge-build/input` only for acceptance-criteria quality helpers; update optional dependency capability to `eforge.plan.planning-workstation >=1.0.0`.
- `eforge/extensions/eforge-playbooks/tsup.config.ts` — verify `noExternal` includes `@eforge-build/scopes`, `yaml`, `zod`, and `@eforge-build/input`; remove no-longer-needed entries only if the implementation no longer imports them.
- `eforge/extensions/eforge-playbooks/README.md` — describe extension-local parser/storage/compiler/seed ownership, the remaining generic input helper dependency, named-set storage, and the generic eforge-plan planning workstation capability.
- `eforge/extensions/eforge-playbooks/__tests__/registration.test.ts` — expect the package optional dependency capability to be `eforge.plan.planning-workstation`.
- `eforge/extensions/eforge-playbooks/__tests__/run-playbook-action.test.ts` — update the fake eforge-plan provider capability and expected required capability values to `eforge.plan.planning-workstation`.
- `eforge/extensions/eforge-playbooks/__tests__/action-contracts.test.ts` — update planning-unavailable expectations for the new generic capability and ensure JSON-safe seed output still contains plain-object sections.
- `eforge/extensions/eforge-playbooks/__tests__/planning-contract.test.ts` — keep the drift test pointed at eforge-plan’s generic planning workstation contribution and package capability.
- `eforge/extensions/eforge-playbooks/__tests__/package-foundation.test.ts` — assert direct dependencies include `@eforge-build/scopes`, `yaml`, and `zod`; assert `@eforge-build/input` import clauses mention only acceptance-criteria helper names.
- `pnpm-lock.yaml` — package-manager generated update for the eforge-playbooks importer after dependency changes. This file is not assigned in the architecture registry; see the coordination note below.

### Shared File and Region Notes

The architecture assigns `eforge/extensions/eforge-playbooks/**` exclusively to this module, so no source edit region markers are required for those files.

`pnpm-lock.yaml` may also change in `input-neutrality` when input dependencies are removed. The architecture does not declare lockfile regions. Treat the lockfile as generated package-manager metadata: do not hand-edit it, and resolve cross-module lockfile conflicts by running `pnpm install --lockfile-only` from the repository root after all package manifest changes are present.

## Testing Strategy

### Unit Tests

- `model.test.ts` covers:
  - valid raw playbook parses with name, description, scope, mode, and body fields.
  - missing `name`, `description`, `scope`, `mode`, and missing `## Goal` each return `ok: false` from `validatePlaybook`.
  - invalid kebab-case names, control characters/newlines in frontmatter scalar fields, empty `postMerge` entries, and control characters in `postMerge` fail validation.
  - optional sections default to empty strings.
  - `serializePlaybook` round-trips autonomous and planning modes, trims non-empty `profile`, omits blank `profile`, and preserves `postMerge` arrays.
- `compile.test.ts` covers:
  - `playbookToBuildSource` emits `# {description}`, `## Goal`, optional sections only when non-empty, `postMerge`, and trimmed `profile`.
  - `playbookToBuildSource` throws `PlaybookModeMismatchError` for planning playbooks.
  - `playbookToPlanSeed` emits a date-prefixed session ID containing the playbook name, topic, seededFrom, `Map` section keys, section values, and trimmed `profile`.
  - `playbookToPlanSeed` throws `PlaybookModeMismatchError` for autonomous playbooks.
- `storage-core.test.ts` covers:
  - `writePlaybook` creates tier directories and `loadPlaybook` returns the expected source for project-local, project-team, and user scopes.
  - project-local shadows project-team and user; shadow paths are absolute and ordered by precedence.
  - `listPlaybooks` returns deterministic name order, mode, description, profile, and scope mismatch warnings.
  - legacy files missing `mode` remain listable with `mode: "autonomous"`.
  - `movePlaybook` updates frontmatter scope, rejects an existing destination when `overwrite` is omitted, and replaces it when `overwrite: true` is supplied.
  - `copyPlaybookToScope` copies the highest-precedence file, updates frontmatter scope, preserves `profile`, and throws `PlaybookNotFoundError` for missing names.

### Integration Tests

- Existing action tests continue dispatching through `dispatchExtensionAction` and cover generic contribution invocation for CRUD and run flows.
- Update planning capability fixtures in action tests to use `eforge.plan.planning-workstation`.
- Package tests verify eforge-playbooks source contains no playbook-specific import clause from `@eforge-build/input`.
- Package publication test continues building and importing `dist/index.js`.

## Verification

- [ ] `rg "from '@eforge-build/input'" eforge/extensions/eforge-playbooks -g '*.ts'` returns only imports whose named bindings are `analyzeAcceptanceCriteria`, `analyzeAcceptanceCriteriaInBody`, or `formatAcDiagnostics`.
- [ ] `rg "planning-mode-playbook" eforge/extensions/eforge-playbooks -g '*.ts' -g 'package.json' -g 'README.md'` returns zero lines.
- [ ] `wc -l eforge/extensions/eforge-playbooks/model.ts eforge/extensions/eforge-playbooks/storage-core.ts eforge/extensions/eforge-playbooks/compile.ts` reports each new implementation file at or below 600 lines.
- [ ] `pnpm vitest run eforge/extensions/eforge-playbooks/__tests__/model.test.ts eforge/extensions/eforge-playbooks/__tests__/storage-core.test.ts eforge/extensions/eforge-playbooks/__tests__/compile.test.ts` exits 0.
- [ ] `pnpm vitest run eforge/extensions/eforge-playbooks/__tests__` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-playbooks type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-playbooks build` exits 0.
- [ ] `node -e "import('./eforge/extensions/eforge-playbooks/dist/index.js').then(() => console.log('ok'))"` prints `ok` after the package build.
- [ ] `pnpm maintainability:check` exits 0 after this module is implemented.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "verify"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
