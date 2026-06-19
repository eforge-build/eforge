# Trust Cleanup

## Architecture Reference

This module implements the `trust-cleanup` section of the architecture and technical decision 6, **Remove, do not deprecate further**.

Key constraints from architecture:
- Project/team extension trust is controlled only by local hash trust records under `.eforge/extension-trust.json`.
- The deprecated no-op extension trust compatibility field is removed from schema, types, defaults, compatibility handling, loader options, consumers, tests, and active docs.
- Config files containing the removed field must fail through config validation unless implementation discovers a hard compatibility requirement.
- Generated public mirrors, JSON schemas, LLM bundles, and reference docs are refreshed by `generated-reference-artifacts`, not this module.
- Shared docs files must use the regions assigned to `trust-cleanup` in the architecture Shared File Registry.

## Scope

### In Scope

- Remove the removed extension trust flag from engine config schema, resolved config type, defaults, and merge/resolve paths.
- Delete project-team compatibility stripping and warning code for that field.
- Make stale configs containing the removed nested key fail validation in config files and profile files.
- Remove the option from native extension discovery/loader option types and all direct callers.
- Update monitor extension discovery/replay services so explicit-path loads no longer pass the removed option.
- Update the Pi `/eforge:config` renderer so it no longer displays the removed field.
- Remove source documentation references to the removed field while preserving local hash trust record documentation.
- Update tests and static wiring assertions to treat local trust records as the only project/team extension trust authority.

### Out of Scope

- Changing `.eforge/extension-trust.json` format, trust hashing, trust/untrust commands, or changed-hash blocking behavior.
- Reworking extension discovery precedence, include/exclude filters, or explicit path behavior.
- Public docs boundary rewrites unrelated to the removed trust flag.
- Generated artifacts under `web/public/**`, including generated config schema, docs mirrors, and LLM bundles.
- Changelog or expedition-plan historical references.

## Implementation Approach

### Overview

Remove the flag from the engine config source of truth first, then let TypeScript identify stale consumers. Discovery already relies on per-extension hash trust records and does not use the flag, so runtime behavior stays centered on the existing trust store. After code updates, remove active docs references and update tests to verify three things: stale configs fail validation, local hash trust records still authorize project/team extensions, and consumers no longer render or pass the removed option.

### Key Decisions

1. **Make the extensions config object strict after removing the field.** This turns stale nested keys into validation errors for `extensionConfigSchema`, `configYamlSchema`, `parseRawConfig`, `loadConfig`, and profile parsing. Limit this strictness change to the `extensions` object.
2. **Delete compatibility stripping instead of keeping a warning path.** The field is a no-op compatibility artifact; keeping the strip function would preserve trust-model ambiguity.
3. **Keep trust-store behavior unchanged.** Project/team candidates remain untrusted until their current content hash matches a local trust record; changed hashes continue to block loading.
4. **Avoid literal stale-field references in active source where possible.** Validation tests can construct the removed key dynamically so a final literal grep has zero active hits outside plan/changelog/generated allowlists.
5. **Do not regenerate artifacts here.** Source schema/docs changes will make generated artifacts drift until the downstream generated-artifacts module runs.

### Detailed Steps

1. Update `packages/engine/src/config.ts`:
   - Remove the field from `extensionConfigSchema`.
   - Mark `extensionConfigSchema` strict so unknown extension keys fail validation.
   - Remove the field from `ExtensionConfig`.
   - Remove the default value from `DEFAULT_CONFIG.extensions`.
   - Remove the resolved value from `resolveConfig`.
   - Delete `dropUntrustedProjectExtensionTrust`.
   - Replace calls to `dropUntrustedProjectExtensionTrust` in `loadConfig` with direct assignment of parsed project-team config/profile data.
   - Update comments that list extension merge semantics or warning behavior.
2. Update native extension option types:
   - Remove the field from `NativeExtensionLoaderOptions.config` in `packages/engine/src/extensions/types.ts`.
   - Remove the field from the inline `discoverNativeExtensions` config type in `packages/engine/src/extensions/discovery.ts`.
3. Update consumers:
   - In monitor extension discovery and replay routes, build explicit-path configs with only `enabled`, `include`, and `paths`.
   - In the Pi config command, remove the rendered “Trust project extensions” line.
4. Update tests:
   - Remove the field from all literal loader/discovery config objects.
   - Rewrite stale-field config tests from “stripped with warning” to “validation rejects”.
   - Remove tests that demonstrate the no-op flag does not grant trust; replace with trust-store authority assertions where coverage would otherwise be lost.
   - Update docs/static wiring tests so they assert local trust records are documented and active docs do not mention the removed field.
5. Update source docs:
   - Remove the field from YAML examples and field tables.
   - Replace compatibility-flag prose with explicit local trust record wording.
   - Preserve statements that project/team extensions are unsandboxed and require inspection plus `eforge extension trust <name>`.
6. Run targeted greps and tests before handoff.

## Files

### Create

- None.

### Modify

- `packages/engine/src/config.ts` — remove the schema/type/default/resolution field, make extension config reject unknown nested keys, and delete compatibility stripping/warnings. This file is over 1,000 lines; use bounded exact edits.
- `packages/engine/src/extensions/types.ts` — remove the field from `NativeExtensionLoaderOptions.config`.
- `packages/engine/src/extensions/discovery.ts` — remove the field from `discoverNativeExtensions` option typing. Discovery trust logic remains hash-store based.
- `packages/monitor/src/routes/extensions/discovery-service.ts` — remove the field from explicit-path extension configs passed to discovery/loading.
- `packages/monitor/src/routes/extensions/replay-service.ts` — remove the field from replay loader configs.
- `packages/pi-eforge/extensions/eforge/config-command.ts` — remove the Pi config output row for the deleted option.
- `web/content/docs/configuration.md` — remove stale field prose, YAML example line, and table entries while preserving local hash trust record wording `[region: trust-cleanup, Native Extensions trust paragraph, YAML example, and field-table rows only]`.
- `web/content/docs/extensions.md` — remove stale field prose, YAML example line, and field table row while preserving trust-store command and hash-blocking sections `[region: trust-cleanup, Configuration section trust field prose/YAML/table only]`.
- `docs/config.md` — remove stale field prose, YAML example line, and field table row; preserve local hash trust records as the authority.
- `docs/extensions.md` — remove stale field prose, YAML example line, and field table row; preserve trust/untrust command docs.
- `test/config-schema.test.ts` — change stale-field tests to expect schema/config/profile validation failures and remove compatibility-strip warning assertions.
- `test/config-resolve.test.ts` — remove the field from default resolved config expectations and merge tests.
- `test/extension-discovery.test.ts` — remove the field from discovery config literals and replace no-op-flag coverage with local-trust-record coverage if needed.
- `test/extension-loader.test.ts` — remove the field from loader config literals, engine override fixtures, and config files written by tests.
- `test/extension-dependency-contracts.test.ts` — remove the field from loader/discovery config literals.
- `test/extension-contribution-registry-runtime.test.ts` — remove the field from loader config literals.
- `test/extension-replay.test.ts` — remove the field from replay loader options.
- `test/extension-workstation-bundles.test.ts` — remove the field from loader config literals.
- `test/extension-cli-commands.test.ts` — remove the field from config files written by extension trust/list/show tests.
- `test/extension-tooling-routes-helpers.ts` — remove the field from the shared route-test project config fixture.
- `test/extension-tooling-routes-list-show.test.ts` — remove the field from route-test config overrides.
- `test/extension-tooling-routes-errors.test.ts` — remove the field from route-test config overrides.
- `packages/monitor/src/__tests__/routes-extension-workstation-assets.test.ts` — remove the field from workstation asset route config fixtures.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — replace compatibility-flag doc assertions with local-trust-record and no-active-reference assertions.
- `test/extension-tooling-wiring-consumer-parity.test.ts` — update the Pi config panel assertion to require the Extensions section and exclude the removed field.

### Audit / No Source Change Expected

- `web/content/docs/extensions-api.md` — currently has no removed-field reference. If implementation discovers one, edit only generic trust-model prose `[region: trust-cleanup, Configuration fields or trust-model prose only]`.
- `README.md`, `packages/extension-sdk/README.md`, `eforge-plugin/skills/extend/extend.md`, and `packages/pi-eforge/skills/eforge-extend/SKILL.md` — keep local hash trust wording; no removed-field reference is present in the current tree.
- `web/public/**` — generated by the downstream generated-artifacts module.

## Testing Strategy

### Unit Tests

- `extensionConfigSchema.safeParse({ [removedKey]: true })` returns `success: false`.
- `configYamlSchema.safeParse({ extensions: { [removedKey]: true } })` returns `success: false` and reports the nested extensions path.
- `loadConfig` rejects user, project-team, project-local, and profile files containing the removed nested key with `ConfigValidationError`.
- `resolveConfig({}, {})` returns an `extensions` object with no removed key.
- `mergePartialConfigs` preserves allowed extension fields (`enabled`, `include`, `exclude`, `paths`, timeout fields, and policy gate failure policy) without a removed-key assertion.

### Integration Tests

- Native extension discovery still marks project/team extensions `untrusted` without a matching local record and `trusted` after `upsertTrustRecord` records the current hash.
- Native extension loading still skips untrusted or changed project/team extensions and loads trusted project/team extensions.
- Monitor extension list/show/trust/untrust/test routes pass without passing the removed option.
- Pi `/eforge:config` rendering still includes the Extensions section and omits the removed field.
- Static docs tests confirm local hash trust records are documented in source docs and the removed field is absent from active source docs.

### Targeted Commands

- `pnpm exec vitest run test/config-schema.test.ts test/config-resolve.test.ts`
- `pnpm exec vitest run test/extension-discovery.test.ts test/extension-loader.test.ts test/extension-dependency-contracts.test.ts test/extension-contribution-registry-runtime.test.ts test/extension-replay.test.ts test/extension-workstation-bundles.test.ts`
- `pnpm exec vitest run test/extension-cli-commands.test.ts test/extension-tooling-routes-list-show.test.ts test/extension-tooling-routes-errors.test.ts packages/monitor/src/__tests__/routes-extension-workstation-assets.test.ts`
- `pnpm exec vitest run test/extension-tooling-wiring-runtime-docs.test.ts test/extension-tooling-wiring-consumer-parity.test.ts`
- `pnpm type-check`
- `pnpm maintainability:check`

## Verification

- [ ] Engine config schemas reject an `extensions` object containing the removed nested key.
- [ ] `loadConfig` throws `ConfigValidationError` for config and profile files containing the removed nested key.
- [ ] `DEFAULT_CONFIG.extensions` and `resolveConfig({}, {}).extensions` have no removed-key property.
- [ ] No native extension discovery or loader option type contains the removed-key property.
- [ ] Monitor extension routes compile without reading `config.extensions` for the removed key.
- [ ] Pi config output contains `## Extensions` and does not contain the removed key.
- [ ] Source docs under `docs/**` and `web/content/docs/**` contain zero literal removed-key matches.
- [ ] Local hash trust record docs still mention `.eforge/extension-trust.json` and `eforge extension trust <name>`.
- [ ] Targeted vitest commands listed above exit 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

Use a literal grep excluding generated and historical/plan content before handoff:

```bash
rg -n "trustProjectExtensions" . \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!web/public/**' \
  --glob '!eforge/plans/**' \
  --glob '!CHANGELOG.md'
```

The command above must return no matches for this module. Generated matches under `web/public/**` are removed by the downstream generated-artifacts module.

<build-config>
{
  "build": [["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
