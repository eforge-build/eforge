---
id: plan-03-extension-package-surfaces-docs
name: Extension Package CLI, MCP, Pi, and Documentation
branch: add-extension-packaging-and-install-support/plan-03-extension-package-surfaces-docs
agents:
  reviewer:
    effort: high
    rationale: Surface parity and documentation changes cross CLI, MCP, Pi, plugin
      skills, and generated docs.
---

# Extension Package CLI, MCP, Pi, and Documentation

## Architecture Context

Plans 1 and 2 add package provenance contracts and daemon operations. This plan exposes those operations consistently through the CLI, Claude MCP proxy, and Pi native tool, then updates user-facing docs and extension-authoring guidance. Repository policy requires Claude Code plugin and Pi integration parity for consumer-facing behavior, and the plugin version must be bumped when plugin files change.

Key constraints:
- Consumer surfaces must call shared `@eforge-build/client` helpers, not inline daemon paths.
- MCP and Pi `eforge_extension` action schemas must stay in parity.
- `packages/pi-eforge/package.json` version must not be bumped.
- If `eforge-plugin/` files change, bump `eforge-plugin/.claude-plugin/plugin.json`.

## Implementation

### Overview

Add extension package-management commands/actions to CLI, MCP proxy, and Pi tool. Update non-JSON CLI output with trust/reload/validate next steps. Update docs, generated web content, SDK README, examples README, and `/eforge:extend` skill guidance for package manifests, install/update/remove/promote/demote, trust, and deferred git support.

### Key Decisions

1. CLI syntax follows the source: `install <source>`, `update <name>`, `remove <name>`, `promote <name>`, and `demote <name>` under `eforge extension`, with `--scope`, `--name`, `--force`, `--trust`, and `--trusted-by` flags for commands whose daemon requests accept those fields.
2. CLI request scopes use existing scaffold labels `local`, `project`, and `user`; responses can display canonical daemon scopes `project-local`, `project-team`, and `user`.
3. MCP/Pi tool actions add `install`, `update`, `remove`, `promote`, and `demote` plus action-specific validation for `source`, `scope`, `force`, `trust`, and `trustedBy`.
4. Non-JSON output prints concrete next commands: validate, reload, and trust when project/team output is untrusted or changed.
5. Docs explicitly state that installed extensions are unsandboxed arbitrary code and that npm/tarball acquisition is supply-chain risk.

## Scope

### In Scope

- Add CLI commands for install/update/remove/promote/demote with `--json` output and trust/collision flags accepted by the daemon request types.
- Extend MCP proxy `eforge_extension` actions and validation.
- Extend Pi `eforge_extension` actions and validation.
- Update tests that assert command/action lists, helper usage, parity, and validation strings.
- Update docs for package manifest conventions, package provenance, install/update/remove/promote/demote workflows, trust implications, npm/tarball safety, install sidecar hash exclusion, and deferred git support.
- Update extension SDK README and examples README where package authoring/install guidance belongs.
- Update `/eforge:extend` skill docs in both `eforge-plugin/` and `packages/pi-eforge/` so agents can install/promote packaged extensions with inspection and trust warnings.
- Bump `eforge-plugin/.claude-plugin/plugin.json` version because plugin skill docs change.
- Regenerate docs artifacts if `pnpm docs:check` reports generated-content drift.

### Out of Scope

- Adding a package registry search/browse feature.
- Git URL installs.
- Runtime hook API changes.
- Bumping `packages/pi-eforge/package.json`.

## Files

### Modify

- `packages/eforge/src/cli/index.ts` — import new client helpers/types, add `install`, `update`, `remove`, `promote`, and `demote` subcommands and accepted `--scope`, `--name`, `--force`, `--trust`, and `--trusted-by` flags, update extension table/detail rendering for package/install provenance, and print trust/reload/validate next steps.
- `packages/eforge/src/cli/mcp-proxy.ts` — add new `eforge_extension` actions, schema fields, action-specific validation, and handler calls to shared client helpers.
- `packages/pi-eforge/extensions/eforge/index.ts` — mirror MCP action set, parameters, validation, helper calls, and output for the Pi native tool.
- `test/extension-cli-commands.test.ts` — cover CLI command behavior/output for package operations and JSON responses.
- `test/extension-tooling-wiring.test.ts` — update expected CLI command list, route/helper assertions, MCP/Pi action parity, and validation-string checks.
- `test/pi-no-start-policy.test.ts` — update helper allowlist expectations if new `IfRunning` helpers are imported by Pi.
- `docs/extensions.md` — document package manifest fields, install/update/remove/promote/demote commands, provenance fields, trust behavior, install sidecar hash exclusion, unsupported git source rejection, and supply-chain warnings.
- `docs/config.md` — reference package-managed extensions in the native extension configuration section if command examples or provenance are listed there.
- `docs/extensions-api.md` — update only if generated/reference docs include `ExtensionEntry` package/install fields.
- `packages/extension-sdk/README.md` — add package manifest example and package install notes.
- `examples/extensions/README.md` — add package authoring/install guidance for examples.
- `web/content/docs/extensions.md` and `web/content/docs/configuration.md` — update via docs generation if these are generated mirrors of docs changes.
- `eforge-plugin/skills/extend/extend.md` — teach the Claude Code skill to use package install/promote/update/remove actions safely.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — mirror the Claude skill update for Pi.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin version by one patch because plugin docs changed.

## Verification

- [ ] `eforge extension install <source> --scope local --json` prints the daemon response JSON and includes install provenance.
- [ ] Non-JSON `eforge extension install <source> --scope project` prints a trust next step when the returned entry has `trustState: "untrusted"` or `"changed"`.
- [ ] `eforge extension install` and `eforge extension update` parse `--trust` and `--trusted-by` and pass them to the shared client helpers.
- [ ] `eforge extension install`, `remove`, `promote`, and `demote` parse `--force` and pass it to the shared client helpers.
- [ ] `eforge extension update <name>`, `remove <name>`, `promote <name>`, and `demote <name>` call the shared client helpers and support `--json`.
- [ ] Commander registration contains exactly the existing extension commands plus `install`, `update`, `remove`, `promote`, and `demote`.
- [ ] MCP and Pi `eforge_extension` action enums contain the same action names.
- [ ] MCP and Pi validation rejects irrelevant fields for each new action.
- [ ] MCP and Pi handlers route install/update/remove/promote/demote through exported client helpers, not raw daemon paths.
- [ ] Docs contain `eforge.extension.name`, `eforge.extension.entrypoint`, `eforge extension install`, `eforge extension update`, `eforge extension remove`, `eforge extension promote`, `eforge extension demote`, install sidecar hash-exclusion text, git support deferred text, and unsandboxed/supply-chain warnings.
- [ ] Plugin skill and Pi skill both mention package install/update/remove/promote/demote workflows and require inspection/trust confirmation for project/team extensions.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version changes from the previous patch version.
- [ ] `packages/pi-eforge/package.json` version remains unchanged.