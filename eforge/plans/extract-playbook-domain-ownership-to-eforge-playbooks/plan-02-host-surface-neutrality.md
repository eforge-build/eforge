---
id: plan-02-host-surface-neutrality
name: Remove CLI, MCP, Pi, and Claude plugin host-owned playbook
  commands/tools/skills and rely on generic extension contribution invocation.
branch: extract-playbook-domain-ownership-to-eforge-playbooks/host-surface-neutrality
---

# Host Surface Neutrality

## Architecture Reference

This module implements the `Module: host-surface-neutrality` section and the `Generic host contribution contract` section from the architecture.

Key constraints from architecture:
- CLI, MCP, Pi, Claude plugin, and Console hosts discover and invoke playbook functionality only through generic extension contribution APIs.
- Host packages must not register playbook-specific commands, tools, skills, action-ID maps, route helpers, validators, schemas, model helpers, or storage semantics.
- Removed host-owned playbook entry points are deleted, not delegated through compatibility shims.
- `eforge/extensions/eforge-playbooks` owns playbook action IDs and behavior; host code treats IDs such as `eforge-playbooks:*` as opaque user-supplied contribution IDs.
- `eforge-plugin/` and `packages/pi-eforge/` stay in sync for consumer-facing surfaces; bump `eforge-plugin/.claude-plugin/plugin.json` for plugin changes and do not bump `packages/pi-eforge/package.json`.
- Generated reference artifacts under `web/**` are owned by `boundary-docs-validation`; this module updates host source/docs generator inputs only.

This module depends on `playbook-domain-extraction`, which keeps the `eforge-playbooks` extension contribution surface available for generic host invocation. `boundary-docs-validation` depends on this module for the final source-wide audit, generated docs refresh, and extension-enabled/disabled integration sweep.

## Scope

### In Scope

- Delete CLI `eforge playbook` and `eforge play` host commands and their host-local playbook contribution adapter.
- Delete Claude MCP `eforge_playbook` compatibility tool and its host-local playbook adapter import.
- Delete Pi `eforge_playbook` tool, `/eforge:playbook` native command, Pi playbook contribution helper, and Pi playbook-specific landing helper exports.
- Remove Claude plugin and Pi playbook skills from registered/discoverable skill surfaces.
- Remove hard-coded `eforge-playbooks:*` action ID maps from host packages.
- Keep generic contribution surfaces available:
  - CLI: `eforge extension contributions list|show|invoke`
  - MCP/Claude: `eforge_extension_contribution`
  - Pi: `eforge_extension_contribution` and `/eforge:extensions`
  - Console: generic extension contribution rendering and invocation
- Update package-local README/skill guidance that currently points users to host-owned playbook commands/tools.
- Update docs generator source and skill parity checks so removed playbook host facades disappear from generated references when `boundary-docs-validation` regenerates docs.
- Update host-surface tests to assert absence of host-owned playbook commands/tools/skills and continued presence of generic contribution APIs.

### Out of Scope

- Moving, deleting, or changing playbook parser/storage/compiler behavior in `eforge/extensions/eforge-playbooks`; that belongs to `playbook-domain-extraction`.
- Deleting `@eforge-build/input` playbook exports or session-plan playbook seed helpers; that belongs to `input-neutrality`.
- Removing `playbookDraft` task contracts or eforge-plan playbook-named capabilities; that belongs to `planning-contract-neutralization`.
- Adding final source-wide boundary tests, generated reference artifact updates, or public architecture docs under `docs/**`, `web/content/**`, or `web/public/**`; that belongs to `boundary-docs-validation`.
- Changing `eforge-playbooks` action IDs, action input schemas, action output schemas, or storage semantics.

## Implementation Approach

### Overview

Remove host-owned playbook UX at the registration points, then remove now-dead adapters and formatting helpers. After this module, a user or agent can still run playbook list/create/run/plan flows, but only by discovering and invoking `eforge-playbooks` contributions through the generic host APIs. Host source no longer contains a playbook command parser, `eforge_playbook` schema, `/eforge:playbook` command, playbook action map, or playbook-specific landing gate.

The post-change host path is:

```text
host CLI/MCP/Pi/Console
  -> generic contribution list/show/invoke APIs
  -> daemon/client contribution dispatcher
  -> eforge-playbooks extension action handler
```

There is no host-local path from an action like `run` to a hard-coded `eforge-playbooks:run-playbook` ID.

### Key Decisions

1. **Delete host facades instead of delegating.** Keeping `eforge playbook`, `eforge play`, `eforge_playbook`, or `/eforge:playbook` as wrappers would preserve host-owned playbook semantics and violate the no-compatibility extraction.
2. **Delete playbook skills from discoverable skill directories.** Pi publishes the whole `skills/` directory and the Claude plugin registers command files in `plugin.json`; leaving playbook skill files in place would keep a user-facing host playbook surface.
3. **Keep generic contribution UX unchanged.** Existing generic contribution commands/tools already support list/show/invoke, schema display, compact output formatting, failed invocation envelopes, and host provenance. This module only removes playbook-specific branches.
4. **Remove playbook-specific landing prompts from Pi.** The extension action owns playbook run semantics. Pi hosts no longer pre-prompt for autonomous playbook landing actions through a playbook-specific command path.
5. **Neutralize incidental host wording.** Session-plan tool descriptions and related skill tables must describe generic producers, templates, or extension contributions rather than planning-mode playbooks or `/eforge:playbook`.
6. **Do not regenerate public reference outputs here.** `packages/docs-gen/src/generators/tools.ts` is host-owned source, but `web/**` generated outputs are assigned to `boundary-docs-validation`.

## Files

### Create

- None expected.

### Delete

- `packages/eforge/src/cli/playbook.ts` — remove the CLI playbook command group, `play` alias, editor flow, and direct `@eforge-build/input` playbook imports.
- `packages/eforge/src/cli/playbook-contributions.ts` — remove the CLI/MCP hard-coded `eforge-playbooks:*` action map and playbook unavailable wrapper.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — remove `/eforge:playbook`, its argument parser, playbook landing pre-prompt, and playbook-specific contribution routing.
- `packages/pi-eforge/extensions/eforge/playbook-contributions.ts` — remove the Pi hard-coded `eforge-playbooks:*` action map and playbook unavailable wrapper.
- `eforge-plugin/skills/playbook/playbook.md` — remove the Claude plugin playbook slash-command skill.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — remove the Pi playbook skill from the auto-discovered skills directory.

### Modify

- `packages/eforge/src/cli/index.ts` — remove the `registerPlaybookCommands` import and call. Use bounded exact edits because this file is over 1,000 lines.
- `packages/eforge/src/cli/mcp-proxy.ts` — remove the `playbook-contributions` import, remove unused `ExtensionJsonObject` type import if it becomes unused, delete the `eforge_playbook` tool registration block, and replace session-plan tool descriptions that mention work-type or planning-mode playbooks with domain-neutral producer/template wording. Use bounded exact edits because this file is over 1,000 lines.
- `packages/eforge/src/cli/display.ts` — remove the dead `PlaybookListEntry` type, `PLAYBOOK_SOURCE_COLORS`, and `renderPlaybookList` export.
- `packages/pi-eforge/extensions/eforge/index.ts` — remove playbook imports, `compactPlaybookToolInput`, `playbookToolFailure`, the `eforge_playbook` tool block, the `/eforge:playbook` registration call/comment, and unused `ExtensionJsonObject` type import if it becomes unused. Replace session-plan tool descriptions that mention work-type or planning-mode playbooks with domain-neutral producer/template wording. Use bounded exact edits because this file is over 1,000 lines.
- `packages/pi-eforge/extensions/eforge/landing-gate.ts` — update comments to build/generic landing selection, delete the `promptForPlaybookLandingGate` export, and remove wording that describes a playbook-specific wrapper.
- `packages/pi-eforge/extensions/eforge/landing-policy.ts` — update module comments so the menu helper applies to build landing choices, not `/eforge:playbook`.
- `packages/pi-eforge/extensions/eforge/trunk-landing.ts` — delete `playbookChoiceNeedsTrunkRemediation` and its playbook-specific documentation.
- `eforge-plugin/.claude-plugin/plugin.json` — remove `./skills/playbook/playbook.md` from `commands` and increment the plugin patch version from the current `0.25.76` to `0.25.77` unless another patch bump has already landed; in that case increment by one from the file's current value. Do not change npm package versions.
- `packages/pi-eforge/README.md` — remove `/eforge:playbook` and `eforge_playbook` feature bullets; point users to `/eforge:extensions` and `eforge_extension_contribution` for extension-provided workflows.
- `eforge-plugin/skills/config/config.md` — replace the Related Skills row for `/eforge:playbook` with generic extension contribution guidance, keeping plugin/Pi parity markers balanced.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — mirror the config skill related-skill change with Pi command/tool names.
- `eforge-plugin/skills/profile/profile.md` — replace the `/eforge:playbook` related-skill row with generic extension contribution guidance.
- `packages/pi-eforge/skills/eforge-profile/SKILL.md` — mirror the profile skill related-skill change with Pi command/tool names.
- `eforge-plugin/skills/extend/extend.md` — keep only boundary-safe extension ownership wording if a playbook mention remains; remove any instruction that presents playbook extraction or playbook actions as a host command/tool path.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — mirror the extension-authoring wording changes from the Claude plugin skill.
- `packages/docs-gen/src/generators/tools.ts` — remove the `playbook`/`eforge-playbook` skill pair from `SKILL_PAIRS_CONFIG` and replace the generated prose that names `eforge_playbook` as a compatibility facade with generic extension contribution guidance.
- `scripts/check-skill-parity.mjs` — remove the playbook skill pair from `SKILL_PAIRS` and update the adjacent pair-count comment.
- `test/cli-playbook.test.ts` — replace compatibility-command assertions with CLI absence assertions for top-level `playbook` and `play`, deleted host adapter files, and continued `extension contributions` registration. `[region: host-surface-neutrality, entire host-surface test file]`
- `test/pi-playbook-commands.test.ts` — replace imports of deleted Pi playbook modules with static and registration-surface assertions that `eforge_playbook`, `/eforge:playbook`, and playbook helper imports are absent while `eforge_extension_contribution` and `/eforge:extensions` remain. `[region: host-surface-neutrality, entire host-surface test file]`
- `test/playbook-host-contribution-migration.test.ts` — invert the old migration assertions so this test now proves host compatibility files/skills are deleted and host source contains no hard-coded playbook contribution ID map. Boundary module may later fold this into the final source-wide audit. `[region: host-surface-neutrality, entire host-surface boundary test]`
- `test/extension-contribution-host-surfaces.test.ts` — add host contribution surface assertions that CLI/MCP/Pi generic contribution APIs remain registered, no `eforge_playbook` tool is extracted, no `/eforge:playbook` command is registered, docs generator skill pairs omit playbook, and the plugin version is greater than the pre-module baseline. `[region: host-surface-neutrality, host contribution CLI/MCP/Pi and plugin versioning describe blocks]`
- `test/skills-docs-wiring.test.ts` — replace the playbook skill contract block with assertions that the Claude and Pi playbook skill files are absent, plugin commands omit the playbook skill path, and skill parity no longer checks the playbook pair. Leave docs/config checks for `boundary-docs-validation` unless the implementation edits those docs in this module. `[region: host-surface-neutrality, former playbook skills contract block]`
- `test/pi-trunk-landing-policy.test.ts` — remove the `playbookChoiceNeedsTrunkRemediation` import and describe block; keep generic `shouldPromptForTrunkLanding` coverage. `[region: host-surface-neutrality, playbookChoiceNeedsTrunkRemediation import and describe block]`
- `test/pi-build-command.test.ts` — remove `promptForPlaybookLandingGate` from the mocked `landing-gate` module export list. `[region: host-surface-neutrality, landing-gate mock object]`

### No Source Changes Expected

- `packages/console-ui/src/**` — current implementation already renders extension contributions generically and has no non-test playbook hits. Keep it unchanged unless implementation inspection finds a hard-coded playbook contribution ID, route, or UI affordance.
- `web/**` and `docs/**` generated/reference files — leave regeneration and public docs edits for `boundary-docs-validation`.
- `packages/pi-eforge/package.json` — do not bump the Pi package version.

### Shared File and Region Notes

The architecture assigns host implementation paths to this module. No temporary source region markers are required for `packages/eforge/src/cli/**`, `packages/pi-eforge/extensions/eforge/**`, `eforge-plugin/**`, `packages/docs-gen/src/generators/tools.ts`, or `scripts/check-skill-parity.mjs`.

Several root `test/**` files are cross-cutting and later strengthened by `boundary-docs-validation`. The entries above include `[region: host-surface-neutrality, ...]` annotations for the exact blocks this module updates. Do not add durable source region markers to tests. If a temporary marker is needed during implementation coordination, use a cleanup-targeted slug matching `plan-\d{2}-...` and remove it before finalizing the module.

## Testing Strategy

### Unit Tests

- CLI Commander registration:
  - `createProgram(undefined, 'test')` has no top-level `playbook` or `play` commands.
  - The `extension contributions` subgroup still exposes `list`, `show`, and `invoke`.
- MCP source/tool surface:
  - `mcp-proxy.ts` contains no `eforge_playbook`, no playbook contribution adapter import, and no hard-coded `eforge-playbooks:*` map.
  - `mcp-extension-contributions.ts` still registers `eforge_extension_contribution` and uses shared client contribution helpers.
- Pi source/tool surface:
  - `packages/pi-eforge/extensions/eforge/index.ts` contains no `eforge_playbook`, no `eforge:playbook`, no playbook contribution helper import, and no playbook tool failure helper.
  - `extension-contributions.ts` still registers `eforge_extension_contribution` and `/eforge:extensions`.
  - `landing-gate.ts` exports `promptForBuildLandingGate` and `promptForLandingSelection`, not `promptForPlaybookLandingGate`.
  - `trunk-landing.ts` exports generic trunk landing helpers, not `playbookChoiceNeedsTrunkRemediation`.
- Skills and docs-generator source:
  - Claude plugin command list omits `./skills/playbook/playbook.md`.
  - Pi and Claude playbook skill files are absent.
  - `scripts/check-skill-parity.mjs` and `packages/docs-gen/src/generators/tools.ts` no longer enumerate the playbook skill pair.
  - Package-local README and related-skill tables reference generic extension contribution discovery/invocation instead of host-owned playbook commands/tools.

### Integration Tests

- Existing generic contribution host tests continue to cover:
  - CLI `eforge extension contributions list|show|invoke` registration.
  - MCP `eforge_extension_contribution` list/show/invoke tool behavior and output capping.
  - Pi `eforge_extension_contribution` tool and `/eforge:extensions` command registration.
  - Console generic contribution rendering remains covered by existing Console tests owned by `boundary-docs-validation`.
- Host removal tests cover the disabled/absent-extension UX surface at registration time: without loading `eforge-playbooks`, host packages expose no playbook command/tool/skill names.

## Verification

- [ ] `test/cli-playbook.test.ts` exits 0 and asserts no top-level CLI commands named `playbook` or `play` exist.
- [ ] `test/pi-playbook-commands.test.ts` exits 0 and asserts Pi source contains no `eforge_playbook` tool or `eforge:playbook` command registration.
- [ ] `test/playbook-host-contribution-migration.test.ts` exits 0 and asserts host playbook adapter files and playbook skill files are absent.
- [ ] `rg "registerPlaybookCommands|invokePlaybookContributionForHost|eforge_playbook|eforge:playbook|PLAYBOOK_CONTRIBUTION_IDS" packages/eforge/src packages/pi-eforge eforge-plugin packages/docs-gen/src/generators/tools.ts scripts/check-skill-parity.mjs --glob '!dist/**'` reports zero implementation hits.
- [ ] `rg "eforge-playbooks:[a-z-]+" packages/eforge/src packages/pi-eforge eforge-plugin packages/docs-gen/src/generators/tools.ts --glob '!dist/**'` reports zero host implementation hits.
- [ ] `rg "./skills/playbook/playbook.md|eforge-playbook" eforge-plugin/.claude-plugin/plugin.json scripts/check-skill-parity.mjs packages/docs-gen/src/generators/tools.ts packages/pi-eforge/package.json` reports zero hits.
- [ ] `node scripts/check-skill-parity.mjs` exits 0.
- [ ] `pnpm vitest run test/cli-playbook.test.ts test/pi-playbook-commands.test.ts test/playbook-host-contribution-migration.test.ts test/extension-contribution-host-surfaces.test.ts test/skills-docs-wiring.test.ts test/pi-trunk-landing-policy.test.ts test/pi-build-command.test.ts` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/pi-eforge type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/docs-gen build` exits 0.
- [ ] `pnpm maintainability:check` exits 0 after this module is implemented.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "docs"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
