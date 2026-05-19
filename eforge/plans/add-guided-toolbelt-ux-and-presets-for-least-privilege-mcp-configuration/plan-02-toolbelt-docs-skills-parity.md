---
id: plan-02-toolbelt-docs-skills-parity
name: Toolbelt Preset Documentation and Skill Parity
branch: add-guided-toolbelt-ux-and-presets-for-least-privilege-mcp-configuration/plan-02-toolbelt-docs-skills-parity
---

# Toolbelt Preset Documentation and Skill Parity

## Architecture Context

Plan 1 adds native Pi guided preset authoring. The fallback skills and public docs must describe the same least-privilege workflow for non-native contexts and for Claude Code users. The docs generator owns `web/content/reference/config.md` and `web/public/reference/config.md`; generated artifacts must be refreshed through the existing docs pipeline.

Repo policy requires bumping `eforge-plugin/.claude-plugin/plugin.json` whenever plugin files change. Do not bump `packages/pi-eforge/package.json`.

## Implementation

### Overview

Update public configuration docs, generated reference text, and Pi/Claude fallback skills to document guided toolbelt presets, the conservative mutation rules, and the preset gallery. Keep Pi and Claude plugin skill content in sync, allowing only existing command/tool prefix differences and parity-skip sections.

### Key Decisions

1. Document `/eforge:profile:new` as the first guided UX rather than adding a new command.
2. Keep the Playwright `browser-ui` path concrete, including `.mcp.json` and `tools.toolbelts` snippets.
3. Present other presets as guided patterns that require existing MCP server entries or manual setup snippets, not as auto-installed integrations.
4. Refresh generated docs artifacts instead of editing generated files by hand.

## Scope

### In Scope

- Expand public configuration docs from the single Playwright example to a guided least-privilege preset gallery.
- Update generated config reference source and regenerate generated reference artifacts.
- Update Pi and Claude Code `profile-new` fallback skills with the same preset workflow, tier assignment guidance, and missing-server behavior.
- Update Pi and Claude Code config fallback skills if the config viewer now surfaces toolbelts.
- Bump `eforge-plugin/.claude-plugin/plugin.json` patch version.
- Update content/wiring tests that assert toolbelt docs links or preset terms.

### Out of Scope

- Changing runtime semantics documented by the existing Toolbelts section.
- Adding a separate toolbelt command to either integration.
- Bumping `packages/pi-eforge/package.json`.

## Files

### Modify

- `web/content/docs/configuration.md` — replace or expand `Profile Toolbelts for UI Work` with a section covering the guided `/eforge:profile:new` toolbelt step, least-privilege defaults, preset gallery, Playwright auto-add path, and manual setup for other presets.
- `web/public/docs/configuration.md` — regenerated raw mirror of the hand-authored configuration guide.
- `packages/docs-gen/src/generators/config.ts` — update the generated Toolbelts reference prose to mention guided presets and the preset gallery while preserving validation semantics.
- `web/content/reference/config.md` — regenerated config reference output.
- `web/public/reference/config.md` — regenerated config reference output.
- `web/public/llms.txt` and `web/public/llms-full.txt` — regenerated docs index/full reference output if `pnpm docs:generate` changes them.
- `web/public/schemas/config.schema.json` — regenerated output if the docs generator rewrites schema formatting or provenance.
- `packages/pi-eforge/skills/eforge-profile-new/SKILL.md` — add guided toolbelt preset workflow using Pi tool names without `mcp__eforge__` prefixes.
- `eforge-plugin/skills/profile-new/profile-new.md` — add the same workflow using Claude Code MCP tool names with `mcp__eforge__` prefixes.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — mention `tools.toolbelts`, config validation, and the native Toolbelts viewer section.
- `eforge-plugin/skills/config/config.md` — mirror the config skill updates with Claude Code MCP tool names.
- `eforge-plugin/.claude-plugin/plugin.json` — bump patch version because plugin skill files change.
- `test/reference-content.test.ts` — assert docs/skills mention the guided preset gallery, `browser-ui`, and at least one non-browser preset.
- `test/skills-docs-wiring.test.ts` or `test/profile-wiring.test.ts` — adjust parity/source assertions if current tests check the older single-example wording.

## Documentation Requirements

### Configuration guide

Add a concise section with:

- What the native wizard asks: skip/default, no project MCP access, or a preset.
- Least-privilege rule: presets explicitly assign `toolbelt: none` to tiers that do not need project MCP servers.
- Concrete `browser-ui` path:
  - Uses `.mcp.json` server name `playwright`.
  - Defines `tools.toolbelts.browser-ui` in `eforge/config.yaml`.
  - Assigns implementation/review to `browser-ui` and planning/evaluation to `none`.
  - Can auto-add Playwright only after explicit confirmation.
- Preset gallery table with columns: preset, typical MCP servers, tiers receiving access, missing-server behavior.
- Reminder that omitted `toolbelt` preserves the all-project-MCP default.
- Reminder that toolbelts filter only project MCP servers from `.mcp.json`.

### Fallback skills

For `profile-new` skills, add a new workflow step after tier configuration and before preview:

- Ask whether to configure project MCP toolbelts.
- If skipped, leave tier `toolbelt` fields omitted.
- If no project MCP access, set all four tiers to `toolbelt: none`.
- If a preset is selected, ensure `.mcp.json` contains required server names and `eforge/config.yaml` declares `tools.toolbelts.<preset>` before calling profile create.
- For missing Playwright, show the exact `.mcp.json` snippet and ask before adding it.
- For other missing servers, show setup guidance and do not create tier references.
- Include `toolbelt` fields inside `agents.tiers` in the `eforge_profile`/`mcp__eforge__eforge_profile` create payload examples.

For `config` skills, add `tools.toolbelts` to the configuration reference block and explain that native `/eforge:config` lists registered toolbelts and tier assignments.

## Generated Docs

Run `pnpm docs:generate` after editing `packages/docs-gen/src/generators/config.ts` and `web/content/docs/configuration.md`. Commit every generated file changed by that command. Then `pnpm docs:check` must report no drift.

## Verification

- [ ] Public configuration docs contain `Guided toolbelt presets`, `browser-ui`, `docs-research`, `observability`, and `database-readonly`.
- [ ] Generated config reference contains `tools.toolbelts`, `toolbelt: none`, `browser-ui`, and text stating omitted `toolbelt` passes all project MCP servers.
- [ ] Pi and Claude Code `profile-new` skills describe the same preset workflow and differ only in tool naming conventions plus existing parity-skip blocks.
- [ ] Config skills contain a `tools.toolbelts` YAML example and a note that native `/eforge:config` lists toolbelts.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is greater than `0.25.12`.
- [ ] `packages/pi-eforge/package.json` version is unchanged.
- [ ] `node scripts/check-skill-parity.mjs` passes.
- [ ] `pnpm docs:check` passes after generated artifacts are committed.
