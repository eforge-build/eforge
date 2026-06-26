---
id: plan-03-input-neutrality
name: Remove playbook-specific files, exports, session-plan seed helpers, and
  docs from @eforge-build/input while preserving generic session-plan behavior.
branch: extract-playbook-domain-ownership-to-eforge-playbooks/input-neutrality
---

# Input Neutrality

## Architecture Reference

This module implements the `Module: input-neutrality`, `Shared data model > Domain-neutral session plans`, and `Integration contracts between modules > playbook-domain-extraction → input-neutrality` sections from the architecture.

Key constraints from architecture:
- `@eforge-build/input` exports only domain-neutral input artifact behavior after this module lands.
- `packages/input/src/playbook.ts` and `packages/input/src/playbook-plan-seed.ts` are deleted after `playbook-domain-extraction` has moved equivalent behavior into `eforge/extensions/eforge-playbooks`.
- `createSessionPlanFromPlaybookSeed`, `CreateSessionPlanFromPlaybookSeedOpts`, and `seeded_from_playbook` are removed from the session-plan contract.
- `agent_profile` remains as generic producer metadata, with no prose tying it to any specific domain artifact.
- `@eforge-build/scopes` is removed from `packages/input/package.json` if no remaining input source imports it.
- Root playbook domain tests that import playbook helpers from `@eforge-build/input` are deleted or replaced by extension-owned tests from `playbook-domain-extraction`.
- Host-surface call sites that still import input playbook symbols are not updated here; `host-surface-neutrality` removes those host facades.

## Scope

### In Scope

- Delete the input package playbook implementation files.
- Remove all playbook-specific runtime and type exports from `packages/input/src/index.ts`.
- Remove the session-plan seed helper that accepts a playbook object.
- Remove the explicit `seeded_from_playbook` schema field and prevent legacy `seeded_from_*` producer fields from being emitted by `serializeSessionPlan`.
- Keep `agent_profile` parse, serialize, and `normalizeBuildSource` behavior as a generic session-plan field.
- Update `packages/input/package.json` and `packages/input/README.md` to describe session plans, session-plan sets, build-source normalization, extension-aware preprocessing, and acceptance-criteria quality helpers only.
- Remove the stale `@eforge-build/scopes` dependency from the input package manifest and refresh the lockfile as generated package-manager metadata.
- Replace input-package tests that formerly asserted public playbook exports with tests that assert no playbook exports or input package playbook files remain.
- Move remaining generic `agent_profile` coverage out of the old playbook-seeded session-plan test into a neutral session-plan test.
- Update input normalization tests so non-session-plan pass-through examples use neutral artifact paths.

### Out of Scope

- Creating or modifying playbook parser, storage, compiler, or planning-seed behavior under `eforge/extensions/eforge-playbooks`; that is owned by `playbook-domain-extraction`.
- Removing CLI, MCP, Pi, Claude plugin, Console, or docs-generator playbook facades; that is owned by `host-surface-neutrality`.
- Removing `playbookDraft` or eforge-plan planning-task fields; that is owned by `planning-contract-neutralization`.
- Updating root `docs/**`, `web/content/**`, `web/public/**`, or source-wide boundary scans; that is owned by `boundary-docs-validation`.
- Preserving compatibility shims for any removed input playbook export.

## Implementation Approach

### Overview

Land this module after `playbook-domain-extraction`. The input package then becomes a session-plan and generic preprocessing package: delete the old playbook files, remove the barrel exports, and use TypeScript errors to expose any remaining host-owned imports for the host-surface module to remove. Keep session-plan behavior unchanged except for the playbook seed helper and playbook-named provenance field.

Implementation order:

1. Confirm the dependency module has extension-local playbook modules and that `eforge/extensions/eforge-playbooks` no longer imports playbook symbols from `@eforge-build/input`.
2. Delete the input playbook source files and remove their runtime/type exports.
3. Apply bounded edits to `packages/input/src/session-plan.ts` to remove the playbook import, explicit seed field, seed helper type/function, and playbook-specific comments.
4. Add a small serialization filter for generic `seeded_from_*` legacy producer fields so parsed legacy frontmatter does not re-emit the former playbook field while preserving current passthrough metadata such as extension-owned frontmatter records.
5. Update package metadata and the input README.
6. Delete stale root playbook domain tests that imported input playbook helpers; rely on the extension-local tests added by `playbook-domain-extraction` for domain behavior.
7. Add/adjust input-specific tests for export absence, deleted files, neutral `agent_profile`, and neutral normalization pass-through.
8. Run `pnpm install --lockfile-only` from the repository root to refresh `pnpm-lock.yaml` after the dependency removal.

### Key Decisions

1. **Delete input playbook exports instead of re-exporting extension modules.** The architecture requires a clean break. Re-exporting extension-owned helpers from `@eforge-build/input` would create a new host import target.
2. **Keep `agent_profile` as producer-neutral session-plan metadata.** It is still used by enqueue normalization and daemon/session-plan flows; comments and tests describe it as an inherited agent runtime profile from any producer.
3. **Keep session-plan `.passthrough()` behavior, but filter `seeded_from_*` on serialization.** Existing extension metadata relies on passthrough parsing. Filtering a generic prefix removes the former seed provenance field without adding a hard-coded playbook wire field to implementation source.
4. **Do not edit host-owned stale imports.** `packages/eforge/src/cli/playbook.ts` and related host files still fail after input exports are removed until `host-surface-neutrality` deletes those facades. This module records package-scoped verification commands and leaves root final validation to the full plan merge.
5. **Treat `pnpm-lock.yaml` as generated.** The lockfile may also change in dependency or downstream modules; resolve conflicts by regenerating it after package manifest edits are combined.

## Files

### Create

- `test/session-plan-agent-profile.test.ts` — neutral tests for `agent_profile` schema parsing, `createSessionPlan({ agentProfile })`, serialize/parse round-trip, trimmed `normalizeBuildSource` output, and omission when the field is blank or absent.

### Modify

- `packages/input/src/index.ts` — remove the top-level playbook documentation block, delete the playbook export section, remove `createSessionPlanFromPlaybookSeed` from the session-plan runtime exports, and remove `CreateSessionPlanFromPlaybookSeedOpts` from the type exports.
- `packages/input/src/session-plan.ts` — bounded exact edits only; remove the `./playbook.js` import, remove `seeded_from_playbook` from `sessionPlanFrontmatterSchema`, reword `agent_profile` comments to generic producer metadata, rename the `// Dimension playbook` section comment to a neutral name, delete `CreateSessionPlanFromPlaybookSeedOpts` and `createSessionPlanFromPlaybookSeed`, and filter `seeded_from_*` keys from the frontmatter object in `serializeSessionPlan`.
- `packages/input/package.json` — change the description to omit playbook claims and remove `@eforge-build/scopes` from `dependencies`.
- `packages/input/README.md` — rewrite package docs around session plans, session-plan sets, build-source normalization, extension-aware preprocessing, and acceptance-criteria quality helpers; remove the playbook helper list and the claim that eforge-playbooks uses input playbook helpers. A short boundary note may state that playbook domain helpers live in `eforge/extensions/eforge-playbooks`, not this package.
- `test/playbook-input-boundary.test.ts` — replace stale “pure playbook helpers remain public” assertions with input package boundary assertions for absent playbook exports, deleted source files, no `@eforge-build/scopes` dependency, no playbook helper names in `packages/input/src/index.ts`, and no serialized legacy seed frontmatter. `[region: input-neutrality, whole file]`
- `test/normalize-build-source.test.ts` — replace the non-session-plan pass-through example under `eforge/playbooks/` with a neutral non-session-plan artifact path and content.
- `pnpm-lock.yaml` — generated update after removing `@eforge-build/scopes` from the input importer; do not hand-edit.

### Delete

- `packages/input/src/playbook.ts` — former input-owned playbook domain implementation now owned by `eforge/extensions/eforge-playbooks`.
- `packages/input/src/playbook-plan-seed.ts` — former input-owned planning seed helper now owned by `eforge/extensions/eforge-playbooks`.
- `test/playbook.test.ts` — stale input-package playbook domain test; extension-local tests cover domain behavior after the dependency module lands.
- `test/playbook-validation.test.ts` — stale input-package playbook validation test; extension-local tests cover validation behavior.
- `test/playbook-conversion.test.ts` — stale input-package playbook compile/seed test; extension-local tests cover compile and planning-seed behavior.
- `test/playbook-storage.test.ts` — stale input-package playbook storage test; extension-local tests cover storage behavior.
- `test/playbook-profile.test.ts` — stale input-package playbook profile test; extension-local tests cover playbook profile behavior.
- `test/playbook-workflow.test.ts` — stale input export-surface test superseded by `test/playbook-input-boundary.test.ts`.
- `test/session-plan-from-playbook.test.ts` — stale session-plan seed-helper test; generic `agent_profile` assertions move to `test/session-plan-agent-profile.test.ts`.
- `test/playbook-helpers.ts` — unused helper after the stale input-package playbook tests are deleted.

### Shared File and Region Notes

- `packages/input/**` is assigned exclusively to `input-neutrality` in the Shared File Registry; no source edit region markers are required for input package files.
- `packages/input/src/session-plan.ts` is over 1,000 lines. Implementers must use small exact edits around imports, schema fields, comments, the seed helper block, and `serializeSessionPlan`; do not rewrite the full file.
- `test/playbook-input-boundary.test.ts` lives under `test/**`, while the registry assigns source-wide boundary tests to `boundary-docs-validation`. This plan treats this file as an input-package boundary test explicitly named by the `input-neutrality` module details. Source-wide audits and allowlists remain owned by `boundary-docs-validation`.
- `pnpm-lock.yaml` has no declared region owner. Regenerate it with the package manager after manifest edits and resolve lockfile conflicts by regeneration.

## Testing Strategy

### Unit Tests

- `test/playbook-input-boundary.test.ts` covers:
  - `Object.keys(input)` contains no runtime export whose name matches `/playbook/i`.
  - `packages/input/src/playbook.ts` and `packages/input/src/playbook-plan-seed.ts` do not exist.
  - `packages/input/src/index.ts` contains no playbook helper export names such as `parsePlaybook`, `serializePlaybook`, `validatePlaybook`, `playbookToBuildSource`, or `playbookToPlanSeed`.
  - `packages/input/package.json` has no `@eforge-build/scopes` dependency and its description omits playbook claims.
  - `serializeSessionPlan(parseSessionPlan(rawWithLegacySeedField))` emits YAML without `seeded_from_playbook`.
- `test/session-plan-agent-profile.test.ts` covers:
  - `sessionPlanFrontmatterSchema.safeParse` accepts a string `agent_profile` and rejects a non-string value.
  - `createSessionPlan({ agentProfile: 'docs-heavy' })` sets `agent_profile` and `createSessionPlan({ agentProfile: '   ' })` omits it.
  - `serializeSessionPlan` and `parseSessionPlan` round-trip `agent_profile` on an ordinary session plan.
  - `normalizeBuildSource` returns `agentProfile` for a `.eforge/session-plans/*.md` source with `agent_profile` and omits it when the field is absent.
- Existing session-plan tests continue covering parse/serialize, readiness, dimension selection, legacy boolean dimension migration, path guards, storage I/O, and build-source normalization.

### Integration Tests

- Run the input package type-check and build after deleting the playbook files to verify the remaining package compiles.
- Run targeted vitest files for input package behavior: the new boundary test, the new agent-profile test, `normalize-build-source.test.ts`, `session-plan.test.ts`, `session-plan-helpers.test.ts`, `session-planning-workflow.test.ts`, and `input-extension-normalization.test.ts`.
- Do not use root `pnpm type-check` as the module gate until `host-surface-neutrality` removes host-owned playbook imports from CLI/MCP/Pi/plugin code.

## Verification

- [ ] `rg -n "playbook|Playbook" packages/input/src packages/input/package.json` exits with code 1.
- [ ] `test ! -e packages/input/src/playbook.ts && test ! -e packages/input/src/playbook-plan-seed.ts` exits 0.
- [ ] After `pnpm --filter @eforge-build/input build`, `node -e "import('./packages/input/dist/index.js').then((m)=>{const hits=Object.keys(m).filter((k)=>/playbook/i.test(k)); if(hits.length){throw new Error(hits.join(','));}})"` exits 0.
- [ ] `rg -n "@eforge-build/scopes" packages/input/src packages/input/package.json -g '!dist'` exits with code 1.
- [ ] `pnpm vitest run test/playbook-input-boundary.test.ts test/session-plan-agent-profile.test.ts test/normalize-build-source.test.ts test/session-plan.test.ts test/session-plan-helpers.test.ts test/session-planning-workflow.test.ts test/input-extension-normalization.test.ts` exits 0.
- [ ] `pnpm --filter @eforge-build/input type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/input build` exits 0.
- [ ] `pnpm maintainability:check` exits 0 after the module edits.

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
