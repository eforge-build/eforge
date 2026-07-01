---
name: eforge-profile-new
description: Create a new agent runtime profile in eforge/profiles/
disable-model-invocation: true
---

> **Note:** In Pi, the native `/eforge:profile:new` command provides a richer interactive experience with a guided TUI wizard and panel previews. This skill serves as a fallback for non-interactive contexts and as model-readable documentation.

# /eforge:profile-new

Interactively create a new named agent runtime profile (e.g. `pi-anthropic`, `pi-openrouter`, `local-qwen`, `mixed`). The profile can live at project scope (`eforge/profiles/<name>.yaml`) or user scope (`~/.config/eforge/profiles/<name>.yaml`). It configures a harness, model, and effort level per build tier (planning → implementation → review → evaluation), then optionally activates itself.

Pi is the recommended eforge execution harness for new profiles because it is provider-flexible. Claude Code or Pi can still be the host surface; the active profile chooses the execution harness. The `claude-sdk` harness remains supported as an optional Anthropic-specific path. Starting June 15, 2026, Anthropic says Claude Agent SDK and `claude -p` usage no longer count toward Claude plan limits; eligible plans may receive a separate monthly Agent SDK credit, usage beyond that credit is billed at standard API rates when extra usage is enabled, otherwise requests stop, and API-key users remain pay-as-you-go.

## Workflow

### Step 0: Ask scope

Ask: "Where should this profile live? **Project-local scope** (`.eforge/profiles/`), **project scope** (`eforge/profiles/`), or **user scope** (`~/.config/eforge/profiles/`)?"

- **Project-local scope** - profile lives in `.eforge/profiles/`, gitignored and dev-personal. Takes highest precedence but is never committed.
- **Project scope** (default) - profile is committed with the project, shared with the team.
- **User scope** - profile lives in `~/.config/eforge/profiles/`, reusable across all projects on this machine.

If the user does not specify, default to project scope. Remember the chosen scope for Step 4 (pass it as `scope` to the `create` action) and Step 5 (pass it to `use` if activating).

### Step 1: Determine the profile name

- If `$ARGUMENTS` is non-empty, treat the first token as the profile name.
- Otherwise ask the user: "What should this profile be called? (e.g. `pi-anthropic`, `pi-openrouter`, `local-qwen`, `mixed`)"

The name will be used as the filename (local: `.eforge/profiles/<name>.yaml`, project: `eforge/profiles/<name>.yaml`, user: `~/.config/eforge/profiles/<name>.yaml`).

### Step 2: Configure each tier

Walk the four built-in tiers in fixed order: **planning** → **implementation** → **review** → **evaluation**.

For each tier, present the following options:

**Copy from a previously configured tier** (available from `implementation` onward): From the second tier onward, present one `Copy from <tierName> (<modelId>)` entry per tier already configured in this session (e.g. on `review`: `Copy from planning` and `Copy from implementation`, in `TIER_ORDER` order). The default selection is copy-from-immediately-previous when the user just presses enter.

**Custom**: walk the sub-flow:
1. **Harness**: ask `pi` (recommended/provider-flexible) or `claude-sdk` (optional Anthropic-specific Agent SDK with credit/API-priced usage).
2. **Provider** (pi only): call `eforge_models` with `{ action: "providers", harness: "pi" }`, show the list, confirm.
3. **Model**: call `eforge_models` with `{ action: "list", harness: "<harness>", provider: "<provider>" }` (omit `provider` for claude-sdk). Show top 10 (id + `releasedAt` when available); add a "see all" affordance if the list is longer. Default to the newest model. Confirm.
4. **Effort**: ask from `low | medium | high | xhigh | max`. Default: `high` for planning/review/evaluation, `medium` for implementation.

For the **planning** tier present only **Custom**, since no prior tier exists yet. Start that first custom tier with `pi` selected first unless the user explicitly asks for `claude-sdk`.

Record each tier's `harness`, optional `pi.provider`, `model`, and `effort`.

### Step 2b: Configure project MCP toolbelts (optional)

After tier configuration, ask: "Would you like to configure project MCP toolbelts for this profile?"

Present three options:

- **Skip / default** — leave `toolbelt` fields omitted; all project MCP servers from `.mcp.json` pass through to each tier.
- **No project MCP access** — set all four tiers to `toolbelt: none`; no project MCP servers reach agents in any tier.
- **Choose a preset** — configure a named toolbelt bundle with least-privilege tier assignments.

**If skipped:** Leave all tier `toolbelt` fields omitted. Proceed to Step 3.

**If no project MCP access:** Add `toolbelt: none` to all four tiers. Proceed to Step 3.

**If a preset is selected:** Present the preset gallery:

| Preset | Typical MCP servers | Tiers receiving access |
|--------|--------------------|-----------------------|
| `browser-ui` | `playwright` | implementation, review |
| `docs-research` | `fetch`, `context7` | planning, implementation |
| `issue-triage` | `github` | planning |
| `repo-review` | `github` | planning, review |
| `observability` | `datadog`, `sentry` | planning, evaluation |
| `database-readonly` | `postgres`, `sqlite` | planning |
| `api-testing` | `fetch` | implementation, review |
| `design-ui` | `figma` | planning, implementation, review |

For each required MCP server in the chosen preset:
1. Check whether the server name is present in `.mcp.json` under `mcpServers`.
2. Check whether `tools.toolbelts.<preset>` is declared in `eforge/config.yaml`.

Before assigning tier fields, ensure both checks pass. If the required server names are present but `tools.toolbelts.<preset>` is missing, add the `tools.toolbelts.<preset>` entry with the preset description and `mcpServers` list before assigning any tier `toolbelt` fields.

**For `browser-ui` with missing Playwright:** Show the following snippet and ask before adding:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

If the user confirms, add the entry to `.mcp.json` (merge if the file exists) and declare the toolbelt in `eforge/config.yaml`:

```yaml
tools:
  toolbelts:
    browser-ui:
      description: Browser automation for UI implementation and review.
      mcpServers:
        - playwright
```

Then assign `toolbelt: browser-ui` to `implementation` and `review`, and `toolbelt: none` to `planning` and `evaluation`.

**For other presets with missing servers:** Show the preset's setup hint and do not create tier `toolbelt` references. Ask the user to add the required MCP server to `.mcp.json` first, then re-run `/eforge:profile-new`.

When toolbelt fields are set, include them in `agents.tiers` in the Step 3 preview and in the Step 4 create payload.

### Step 2c: Configure implementation runtime choices (optional)

Ask: "Would you like this profile to add per-invocation runtime choices for implementation work?"

- **Skip / default** — every implementation invocation uses the `implementation` tier default.
- **Add UI/backend choices** — create `implementation.ui` and `implementation.backend` choices with ordered declarative routing rules.

Use runtime choices when the same built-in tier needs tier-local overlays. The four built-in tiers remain the role-routing axis; choices are selected only after a role resolves to its tier. The existing tier recipe is the implicit `default` choice (`implementation.default`), and named choices inherit from that tier default.

For the UI/backend preset, first ensure `browser-ui` is a declared project toolbelt using the same checks from Step 2b (required MCP server present or auto-added, then `tools.toolbelts.browser-ui` written to config). If it cannot be declared, omit `toolbelt: browser-ui` from the `ui` choice or reuse an already-declared implementation toolbelt instead of creating an invalid reference.

Then add:

```yaml
agents:
  tiers:
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
      choices:
        backend:
          model: qwen3-coder
          pi:
            provider: local
          toolbelt: none
        ui:
          effort: high
          toolbelt: browser-ui
      routing:
        rules:
          - name: ui-paths
            choice: ui
            when:
              pathGlobs: ["packages/console-ui/**", "web/**", "**/*.{tsx,jsx,css}"]
              keywords: ["ui", "frontend", "browser", "component"]
          - name: backend-paths
            choice: backend
            when:
              pathGlobs: ["packages/engine/**", "packages/client/**", "packages/monitor/**"]
```

Declarative rules run before extension runtime-choice routers. Extension router failures fall back to `default` and do not fail the build. `registerProfileRouter` still selects the active profile before build dispatch; it is separate from per-invocation runtime-choice routing. `onAgentRun` can observe selected choice metadata, but cannot change the selected harness, model, provider, effort, or toolbelt. Events expose non-secret runtime-choice metadata.

### Step 3: Preview the profile

Show the user a rendered preview of the YAML that will land in the chosen scope directory. Example Pi-first profile:

```yaml
agents:
  tiers:
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
    review:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
    evaluation:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
```

Example with mixed Pi providers:

```yaml
agents:
  tiers:
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
    implementation:
      harness: pi
      model: qwen3-coder
      effort: medium
      pi:
        provider: local
    review:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
    evaluation:
      harness: pi
      model: gemini-flash
      effort: high
      pi:
        provider: google
```

Optional `claude-sdk` tiers omit the `pi` block and use Anthropic model IDs:

```yaml
agents:
  tiers:
    review:
      harness: claude-sdk
      model: claude-opus-4-7
      effort: high
```

Ask for confirmation or corrections before writing.


### Step 4: Create the profile

Call `eforge_profile` with:

```
{
  action: "create",
  name: "<name>",
  scope: "<local|project|user>",
  agents: {
    tiers: {
      planning:       { harness, model, effort, pi?: { provider }, toolbelt?: "none" | "<preset>" },
      implementation: {
        harness, model, effort, pi?: { provider }, toolbelt?: "none" | "<preset>",
        choices?: {
          backend?: { harness?, model?, effort?, pi?: { provider }, toolbelt?: "none" | "<preset>" },
          ui?: { harness?, model?, effort?, pi?: { provider }, toolbelt?: "none" | "<preset>" },
        },
        routing?: { rules: [{ name, choice, when: { pathGlobs?, keywords?, roles?, phase?, stage?, shardIds?, shardRoots? } }] },
      },
      review:         { harness, model, effort, pi?: { provider }, toolbelt?: "none" | "<preset>" },
      evaluation:     { harness, model, effort, pi?: { provider }, toolbelt?: "none" | "<preset>" },
    }
  },
  metadata: {          // optional — descriptive only, does not affect runtime behavior
    description: "<human-readable description of what this profile is for>",
    whenToUse: ["<scenario 1>", "<scenario 2>"],
    tags: ["<tag1>", "<tag2>"],
  },
  overwrite: false,
}
```

Omit `pi` for the `claude-sdk` harness. Include `pi: { provider: "..." }` for the `pi` harness.

The `metadata` field is **optional and descriptive only** — it surfaces in profile list/show UX but does not affect active profile selection or runtime behavior. You may omit it entirely or include only the fields that are useful. Users can also edit the YAML file directly to add or update metadata later.

If the tool reports the profile already exists, ask the user whether to retry with `overwrite: true`.

### Step 5: Offer to activate

Ask: "Make `{name}` the active profile for this project?"

If yes, call `eforge_profile` with `{ action: "use", name: "<name>", scope: "<local|project|user>" }` (using the scope from Step 0). This writes the active-profile marker at the chosen scope. Confirm success and let the user know the next eforge build will use the new profile.

If no, remind the user they can switch later with `/eforge:profile <name>`.

## When to use toolbelt presets

When a profile is aimed at UI-heavy, browser-validation, docs-research, observability, or data-querying work, configure it with a project MCP toolbelt preset instead of plain tier reassignment. The `/eforge:profile-new` wizard guides you through preset selection in Step 2b, after tier configuration.

### Preset gallery

| Preset | Typical MCP servers | Tiers receiving access |
|--------|--------------------|-----------------------|
| `browser-ui` | `playwright` | implementation, review |
| `docs-research` | `fetch`, `context7` | planning, implementation |
| `issue-triage` | `github` | planning |
| `repo-review` | `github` | planning, review |
| `observability` | `datadog`, `sentry` | planning, evaluation |
| `database-readonly` | `postgres`, `sqlite` | planning |
| `api-testing` | `fetch` | implementation, review |
| `design-ui` | `figma` | planning, implementation, review |

Presets assign `toolbelt: none` to tiers that do not need project MCP access — the least-privilege default. Tiers with omitted `toolbelt` receive all project MCP servers from `.mcp.json`.

The `browser-ui` preset auto-adds the Playwright MCP server to `.mcp.json` after explicit confirmation. For all other presets, add the required servers to `.mcp.json` manually before running the wizard.

MCP server commands live in `.mcp.json`; profiles reference only server names via toolbelts — never use backend MCP tool names (such as `mcp__playwright__browser_navigate`) in profile YAML.

See [Guided Toolbelt Presets](https://eforge.build/docs/configuration#guided-toolbelt-presets) in the public docs and the [Toolbelts](https://eforge.build/reference/config#toolbelts) section in the Configuration Reference for full configuration details.

**Constraints (MVP):** One toolbelt per tier. Pi extensions, Claude Code plugins, and native extension-contributed tools are out of scope — toolbelts are MCP-only and declarative.

## Error Handling

| Condition | Action |
|-----------|--------|
| Invalid profile name | Surface the daemon error (names must match `[A-Za-z0-9._-]+`) |
| Profile already exists | Offer to retry with `overwrite: true` |
| Provider or model not found | Suggest rerunning the affected tier step with a different choice |

<!-- parity-skip-start -->
| Tool connection failure | The daemon is not running. Tell the user to start it with `eforge_daemon { action: "start" }`, `/eforge:restart`, or `eforge daemon start`. |
<!-- parity-skip-end -->

## Related Skills

| Skill | When to suggest |
|-------|----------------|
| `/eforge:profile` | Inspect or switch between existing profiles |
| `/eforge:config` | Edit the team default `eforge/config.yaml` |
| `/eforge:init` | Initialize eforge in a project that has no config yet |
