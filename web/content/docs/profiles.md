---
title: Agent Runtime Profiles
description: Create, switch, and manage named agent runtime profiles that control harness, model, and effort per build tier.
---

# Agent Runtime Profiles

An agent runtime profile is a named YAML file that bundles harness, model, and effort settings for each build tier into a reusable unit. Switching profiles changes how eforge executes builds without touching `eforge/config.yaml`.

## Profile anatomy

Each profile lives at one of three scope tiers and contains an `agents.tiers` block:

```yaml
# eforge/profiles/pi-anthropic.yaml
description: Anthropic models via Pi on OpenRouter.
whenToUse:
  - General-purpose feature work
  - Full-stack changes requiring review depth
tags:
  - pi
  - anthropic

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

**Required fields per tier:** `harness`, `model`, `effort`.

**Optional per tier:** `pi.provider` (required when `harness: pi`), `thinking` (boolean, enables extended thinking), `toolbelt` (named MCP bundle or `none`).

**Metadata fields** (`description`, `whenToUse`, `tags`) are descriptive only - they surface in list and show commands but do not affect runtime behavior.

## Scope tiers

Profiles live at three scope directories, resolved highest-precedence-first:

| Scope | Directory | Committed? | Precedence |
|-------|-----------|-----------|-----------|
| Project-local | `.eforge/profiles/` | No (gitignored) | Highest |
| Project | `eforge/profiles/` | Yes | Middle |
| User | `~/.config/eforge/profiles/` | No | Lowest |

When two profiles share the same name, the project-local version wins over project, which wins over user.

The active profile is tracked by a marker file at the matching scope:

- `.eforge/.active-profile` - project-local marker
- `eforge/.active-profile` - project marker
- `~/.config/eforge/.active-profile` - user marker

The daemon resolves the active profile in the same precedence order: project-local marker first, then project marker, then user marker, then no profile (engine defaults apply).

## Create a profile

Use `/eforge:profile-new` in Claude Code or `/eforge:profile:new` in Pi to create a profile through a guided wizard. The wizard walks through:

1. **Scope** - project-local, project, or user
2. **Name** - e.g. `pi-anthropic`, `local-qwen`, `mixed`
3. **Tier configuration** - harness, model, effort per tier (planning, implementation, review, evaluation)
4. **Toolbelt preset** (optional) - focused MCP server access for UI, docs, or database work
5. **Activation** - optionally make the new profile active immediately

There is no standalone CLI profile wizard today. The host skills call the daemon's `eforge_profile` MCP tool with `action: "create"` after collecting the tier recipes.

Profile names must match `[A-Za-z0-9._-]+`.

## Switch the active profile

```
/eforge:profile <name>
```

On success, the daemon writes the active-profile marker at project scope (`eforge/.active-profile`) by default. Ask the skill to use local or user scope when you need the marker at `.eforge/.active-profile` or `~/.config/eforge/.active-profile` instead.

The standalone CLI does not have profile-management subcommands yet, but build enqueue supports a one-off override:

```bash
eforge build --profile pi-anthropic "Add rate limiting"
```

The next build picks up the new active profile immediately - no daemon restart needed.

## Inspect the active profile

```
/eforge:profile
```

Reports the active profile name, source (local, project, or user), resolved harness, metadata (description, tags), and per-tier toolbelt assignments if configured.

The same command also lists all available profiles. Output includes name, scope, harness, description, and a marker for the active profile.

## Profile precedence over other selection mechanisms

The active profile sets the baseline. Other mechanisms can override it in specific contexts:

1. **Explicit `--profile` flag** - `eforge build --profile <name>` or the enqueue `profile` field overrides the active-profile marker for that single build.
2. **PRD frontmatter `profile:`** - a profile set directly in a PRD file takes absolute precedence; no profile router is consulted.
3. **Playbook `profile:` frontmatter** - overrides the active-profile marker and any profile router when the playbook runs. See [Playbooks](/docs/playbooks).
4. **Registered profile router** - an extension can register a `selectBuildProfile` function that selects a profile per-PRD from queue context. Routers run only when no explicit profile is set in the PRD frontmatter. See [Extensions API - registerProfileRouter](/docs/extensions-api).
5. **Active-profile marker** - the fallback when no higher-precedence mechanism applies.
6. **Engine defaults** - used when no profile is configured at all.

When a profile router selects a profile, a `queue:profile:selected` event is emitted. If the router selects a profile name that does not exist, `queue:profile:invalid-selection` is emitted and the build proceeds under the active profile or defaults.

## Harnesses

Two harnesses ship with eforge:

- **`pi`** - recommended for new profiles; provider-flexible execution across Anthropic, OpenAI, Google, Mistral, Groq, xAI, Bedrock, OpenRouter, and local models. Requires `pi.provider` per tier.
- **`claude-sdk`** - supported secondary path for Anthropic Claude Agent SDK users. Does not use a `pi` block.

You can mix harnesses across tiers within a single profile:

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
      harness: claude-sdk
      model: claude-opus-4-7
      effort: high
    evaluation:
      harness: pi
      model: gemini-flash
      effort: high
      pi:
        provider: google
```

## Toolbelts inside profiles

A toolbelt filters which project MCP servers from `.mcp.json` reach agents in a given tier. Set `toolbelt: <name>` on a tier to use a named bundle, or `toolbelt: none` to pass no project MCP servers to that tier.

```yaml
agents:
  tiers:
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
      toolbelt: browser-ui      # only the playwright MCP server reaches this tier
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
      toolbelt: none             # no project MCP servers for planning
```

Omitting `toolbelt` keeps the default: all servers from `.mcp.json` pass through.

The Claude Code `/eforge:profile-new` wizard and Pi `/eforge:profile:new` wizard include an optional toolbelt step with a preset gallery covering `browser-ui`, `docs-research`, `issue-triage`, `repo-review`, `observability`, `database-readonly`, `api-testing`, and `design-ui`. See [Configuration - Guided Toolbelt Presets](/docs/configuration#guided-toolbelt-presets) for the full setup instructions and [Configuration Reference - Toolbelts](/reference/config#toolbelts) for the schema.

## Move profiles between scopes

Profiles can live at any of the three scope directories, but there are no standalone `promote` or `demote` profile commands today. To share a personal profile with the team, create a project-scope profile with `/eforge:profile-new` in Claude Code or `/eforge:profile:new` in Pi, or move the YAML file from `.eforge/profiles/` to `eforge/profiles/` and then switch to it with `/eforge:profile <name>`.

User-scope profiles (`~/.config/eforge/profiles/`) apply across all projects on the machine and are never committed.

## Where to look next

- [Configuration](/docs/configuration) - `eforge/config.yaml` team defaults that profiles override
- [Playbooks](/docs/playbooks) - run recurring workflows with a profile baked in
- [Extensions API - registerProfileRouter](/docs/extensions-api) - automate profile selection per build
- [Configuration Reference - Toolbelts](/reference/config#toolbelts) - full toolbelt schema
