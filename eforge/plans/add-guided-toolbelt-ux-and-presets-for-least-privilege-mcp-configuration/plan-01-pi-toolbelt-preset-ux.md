---
id: plan-01-pi-toolbelt-preset-ux
name: Pi Guided Toolbelt Preset UX
branch: add-guided-toolbelt-ux-and-presets-for-least-privilege-mcp-configuration/plan-01-pi-toolbelt-preset-ux
agents:
  builder:
    effort: high
    rationale: This plan adds interactive file mutation around .mcp.json and
      eforge/config.yaml; careful validation and rollback behavior are needed to
      avoid invalid toolbelt references.
  reviewer:
    effort: high
    rationale: Review must examine least-privilege defaults, file mutation safety,
      and validation flow before profile creation.
---

# Pi Guided Toolbelt Preset UX

## Architecture Context

Runtime toolbelt semantics already exist in `packages/engine/src/config.ts` and the agent runtime registry: omitted `toolbelt` means all project MCP servers, `toolbelt: none` means no project MCP servers, and named toolbelts filter only servers declared under `.mcp.json`. This plan keeps those engine semantics unchanged and adds guided authoring in the Pi native `/eforge:profile:new` flow.

The daemon profile-create API accepts `agents.tiers` as an opaque agents block and validates tier `toolbelt` fields against the merged config. Toolbelt registry entries belong in `eforge/config.yaml` (`tools.toolbelts`), not in the profile-create payload. The Pi extension can safely prepare project-local files before calling the existing daemon route, then call config validation and surface failures.

## Implementation

### Overview

Add a testable preset registry and conservative file-update helpers to the Pi extension. Wire those helpers into `/eforge:profile:new` after tier model setup and before YAML preview. The wizard offers skip/default behavior, all-tier no-MCP access, `browser-ui`, and a curated preset gallery. It writes tier `toolbelt` fields only when the referenced toolbelt exists in the merged/project config or is added first.

### Key Decisions

1. Keep preset logic in Pi integration modules, not engine config loading. Presets are authoring guidance; runtime remains declarative.
2. Preserve existing behavior when users skip the toolbelt step. Do not add `toolbelt` fields on skip.
3. Use least-privilege preset assignments. For `browser-ui`, set `implementation` and `review` to `browser-ui`, and set `planning` and `evaluation` to `none`.
4. Add a concrete auto-add path only for Playwright. Other presets with missing servers show setup guidance and leave the preset unapplied.
5. Write project config and `.mcp.json` with atomic temp-file replacement, then validate config before creating the profile. If validation fails after this wizard writes files, restore the captured original contents before showing errors.

## Scope

### In Scope

- Add a pure preset registry with `browser-ui`, `docs-research`, `issue-triage`, `repo-review`, `observability`, `database-readonly`, `api-testing`, and `design-ui` entries.
- Extend profile payload types so tier selections and emitted tier recipes can carry `toolbelt?: string`.
- Add conservative helpers for reading/updating `.mcp.json` and `eforge/config.yaml` for selected presets.
- Add an optional toolbelt step to native Pi `/eforge:profile:new` after the four tier selections and before YAML preview.
- Add a Toolbelts section to native Pi `/eforge:config` output when the resolved config contains `tools.toolbelts` or tier `toolbelt` fields.
- Add tests for pure preset application, payload emission, config-file mutation helpers, and source wiring.

### Out of Scope

- Engine runtime changes.
- Multiple toolbelts per tier.
- Auto-install or health checks for non-Playwright MCP servers.
- Filtering Pi extensions, Claude Code plugins, extension-contributed tools, harness built-ins, or eforge internal tools.
- A separate `/eforge:toolbelt` command.
- Changes to `packages/pi-eforge/package.json` version.

## Files

### Create

- `packages/pi-eforge/extensions/eforge/toolbelt-presets.ts` — preset definitions and pure helpers for missing-server detection, tier assignment application, and preview registry data.
- `packages/pi-eforge/extensions/eforge/toolbelt-config-files.ts` — file I/O helpers for `.mcp.json` and `eforge/config.yaml`, including Playwright auto-add and toolbelt upsert support.
- `test/toolbelt-presets.test.ts` — pure tests for preset definitions, tier assignments, missing-server detection, and `toolbelt: none` behavior.
- `test/toolbelt-config-files.test.ts` — temp-directory I/O tests for MCP server insertion, YAML toolbelt insertion/update, invalid parse handling, and no-overwrite behavior for existing Playwright server config.

### Modify

- `packages/pi-eforge/extensions/eforge/profile-payload.ts` — add `toolbelt?: string` to `TierSelection` and `TierRecipeEntry`; emit the field only when it is explicitly set.
- `packages/pi-eforge/extensions/eforge/profile-commands.ts` — import preset/config helpers; add the optional preset step; preview profile tier `toolbelt` fields and pending `tools.toolbelts` definitions; perform file writes plus `API_ROUTES.configValidate` before `API_ROUTES.profileCreate`; surface validation/profile-create errors in overlays.
- `packages/pi-eforge/extensions/eforge/config-command.ts` — render a Toolbelts section showing each registry entry and a tier assignment summary (`all (default)`, `none`, or named toolbelt with server list).
- `test/profile-payload.test.ts` — add coverage for preserving tier `toolbelt` fields and keeping `tools` out of the profile-create payload.
- `test/profile-wiring.test.ts` — add source-level assertions that the native profile-new command imports/uses the preset registry, calls config validation before profile creation when applying presets, and config view contains Toolbelts rendering.

## Implementation Notes

### Preset registry shape

Use a shape similar to:

```ts
export interface ToolbeltPreset {
  id: string;
  label: string;
  description: string;
  mcpServers: string[];
  tierAssignments: Record<'planning' | 'implementation' | 'review' | 'evaluation', string>;
  setupHint: string;
  autoAdd?: {
    servers: Record<string, { command: string; args?: string[] }>;
  };
}
```

Use `toolbelt: none` string values in `tierAssignments` for tiers that receive no project MCP access. For non-`none` values, use the preset `id`.

Recommended initial assignments:

- `browser-ui`: implementation/review use `browser-ui`; planning/evaluation use `none`; server `playwright`; Playwright auto-add supported.
- `docs-research`: planning/implementation use `docs-research`; review/evaluation use `none`; suggested servers can include docs/search/fetch/context names, but missing servers require manual setup.
- `issue-triage`: planning uses `issue-triage`; implementation/review/evaluation use `none`.
- `repo-review`: planning/review use `repo-review`; implementation/evaluation use `none`.
- `observability`: planning/evaluation use `observability`; implementation/review use `none`.
- `database-readonly`: planning uses `database-readonly`; implementation/review/evaluation use `none`.
- `api-testing`: implementation/review use `api-testing`; planning/evaluation use `none`.
- `design-ui`: planning/implementation/review use `design-ui`; evaluation uses `none`.

### Wizard flow

After `const tiers = tierSelections as Record<TierName, TierSelection>;` and before building the daemon payload:

1. Show a select overlay with:
   - `Skip toolbelt setup` — leaves every tier's `toolbelt` undefined.
   - `No project MCP access` — sets all tiers to `toolbelt: none`.
   - One entry per preset from the registry.
2. For a selected preset, read `.mcp.json` and current resolved/project config data.
3. If required servers are present, prepare an `eforge/config.yaml` toolbelt upsert and apply tier assignments.
4. If required servers are missing and the preset has an `autoAdd` definition covering all missing servers, show the exact JSON snippet and require explicit confirmation before editing `.mcp.json`.
5. If required servers are missing and no complete `autoAdd` exists, show setup instructions and present choices: continue without this preset or cancel profile creation.
6. After profile preview confirmation, write pending file updates first, call `GET /api/config/validate`, and only then call `POST /api/profile/create`.
7. If validation returns `{ valid: false }`, restore prior file contents for files changed in this flow and show all returned errors.

### File mutation helper behavior

- Treat a missing `.mcp.json` as `{ "mcpServers": {} }` only for explicit Playwright auto-add confirmation.
- Reject invalid `.mcp.json` JSON and invalid `mcpServers` shape with an error message that names the file.
- Do not overwrite an existing `.mcp.json` server definition. If `playwright` already exists, leave that object as-is.
- Treat a missing or empty `eforge/config.yaml` as `{}` for toolbelt insertion only when an eforge config directory exists or can be created under the current project root.
- Use `yaml` package parsing/stringifying for config YAML.
- Upsert `tools.toolbelts.<preset.id>` to the preset definition (`description`, `mcpServers`) after explicit preset selection.

## Verification

- [ ] `buildProfileCreatePayload` emits `toolbelt` fields on tiers that include `toolbelt` in the input and omits top-level `tools`.
- [ ] `applyToolbeltPresetToTiers(browser-ui, tiers)` sets implementation/review to `browser-ui` and planning/evaluation to `none`.
- [ ] A non-browser preset test verifies named tier assignment and `none` assignment for at least one tier.
- [ ] File-helper tests create `.mcp.json` with Playwright when missing and keep an existing `mcpServers.playwright` object unchanged.
- [ ] File-helper tests insert or replace `tools.toolbelts.browser-ui` in YAML with `mcpServers: [playwright]`.
- [ ] Native `/eforge:profile:new` source contains a toolbelt preset selection step before the profile-create request.
- [ ] Source wiring shows config validation runs before profile creation when preset file mutations are pending.
- [ ] Native `/eforge:config` output includes `## Toolbelts` when registry or tier toolbelt data exists.
- [ ] Existing runtime toolbelt tests remain limited to current engine semantics and pass without engine changes.
