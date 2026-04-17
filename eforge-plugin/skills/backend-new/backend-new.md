---
description: Create a new backend profile in eforge/backends/
argument-hint: "[name]"
---

# /eforge:backend:new

Interactively create a new named backend profile (e.g. `pi-anthropic`, `pi-glm`, `claude-fast`) in `eforge/backends/<name>.yaml`. The profile selects a backend kind, provider, model, and optional tuning, then optionally activates itself by writing `eforge/.active-backend`.

## Workflow

### Step 1: Determine the profile name

- If `$ARGUMENTS` is non-empty, treat the first token as the profile name.
- Otherwise ask the user: "What should this profile be called? (e.g. `pi-anthropic`, `pi-glm`, `claude-fast`)"

The name will be used as the filename (`eforge/backends/<name>.yaml`).

### Step 2: Pick the backend kind

Ask: "Which backend? `claude-sdk` (Claude Code's built-in SDK) or `pi` (multi-provider via Pi SDK)?"

Use a smart default based on the name hint:
- Names starting with `pi-` default to `pi`.
- Names starting with `claude-` default to `claude-sdk`.
- Otherwise default to `pi` (the more flexible option) and let the user override.

### Step 3: Pick a provider (Pi only)

Only if `backend === "pi"`:

Call `mcp__eforge__eforge_models` with `{ action: "providers", backend: "pi" }`.

Parse the `{ providers: string[] }` response and show the list. Use a smart default based on the name hint (e.g. `pi-anthropic` -> `anthropic`, `pi-glm` -> `zai`, `pi-openrouter` -> `openrouter`). Ask the user to confirm or pick another.

Skip this step for `claude-sdk` (provider is always Anthropic / implicit).

### Step 4: Pick a model

Call `mcp__eforge__eforge_models` with:
- `{ action: "list", backend: "claude-sdk" }` for claude-sdk, or
- `{ action: "list", backend: "pi", provider: "<chosen>" }` for pi.

Parse the `{ models: ModelInfo[] }` response. The list is already sorted newest-first.

Present the user with the top 10 models (show `id` and `releasedAt` when available). Default to the first entry (newest). If the list has more than 10 entries, add a "see all" affordance and show the rest only if the user asks.

Confirm the chosen model id with the user.

### Step 5: Optional tuning

Ask the user whether they want to customize tuning. Most users skip this. Defaults:

- **Pi only** - `pi.thinkingLevel`: `off` | `medium` | `high`. Default: `medium`.
- **All backends** - `agents.effort`: `low` | `medium` | `high` | `max`. Default: `high`.

Collect only the values the user explicitly sets.

### Step 6: Synthesize and preview the profile

Build the profile object that will go to the tool:

```
{
  name: "<name>",
  backend: "<claude-sdk|pi>",
  // For pi:
  pi: { thinkingLevel: "<level>" }?,           // only if user set
  agents: {
    model: { id: "<model-id>", provider: "<provider>"? },  // provider only for pi
    effort: "<effort>"?,                       // only if user set
  },
}
```

Show the user a rendered preview of the YAML that will land in `eforge/backends/<name>.yaml`:

```yaml
backend: pi
pi:
  thinkingLevel: medium
agents:
  model:
    provider: anthropic
    id: claude-sonnet-4-6
  effort: high
```

Ask for confirmation or corrections before writing.

### Step 7: Create the profile

Call `mcp__eforge__eforge_backend` with:

```
{
  action: "create",
  name: "<name>",
  backend: "<claude-sdk|pi>",
  pi: { ... }?,       // omit if empty
  agents: { ... }?,   // omit if empty
  overwrite: false,
}
```

If the tool reports the profile already exists, ask the user whether to retry with `overwrite: true`.

### Step 8: Offer to activate

Ask: "Make `{name}` the active profile for this project?"

If yes, call `mcp__eforge__eforge_backend` with `{ action: "use", name: "<name>" }`. This writes `eforge/.active-backend`. Confirm success and let the user know the next eforge build will use the new profile.

If no, remind the user they can switch later with `/eforge:backend <name>`.

## Error Handling

| Condition | Action |
|-----------|--------|
| Invalid profile name | Surface the daemon error (names must match `[A-Za-z0-9._-]+`) |
| Profile already exists | Offer to retry with `overwrite: true` |
| Provider or model not found | Suggest rerunning Step 3 or Step 4 with a different choice |
| MCP tool connection failure | The MCP proxy auto-starts the daemon; if it still fails, suggest `eforge daemon start` manually |

## Related Skills

| Skill | When to suggest |
|-------|----------------|
| `/eforge:backend` | Inspect or switch between existing profiles |
| `/eforge:config` | Edit the team default `eforge/config.yaml` |
| `/eforge:init` | Initialize eforge in a project that has no config yet |
