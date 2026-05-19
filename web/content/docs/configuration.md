---
title: Configuration
description: Key configuration options for eforge and how to tune them.
---

# Configuration

eforge is configured via `eforge/config.yaml` (searched upward from cwd). All fields are optional - defaults work for most projects. This page covers the most commonly tuned options. For the full schema see the [Configuration Reference](/reference/config).

## The Three Config Tiers

Config merges from three levels (lowest to highest priority):

| Tier | Path | Committed? | Purpose |
|------|------|-----------|---------|
| User | `~/.config/eforge/config.yaml` | No | Cross-project, personal |
| Project | `eforge/config.yaml` | Yes | Team-canonical |
| Project-local | `.eforge/config.yaml` | No (gitignored) | Personal override |

The project-local tier deep-merges over the others. Use it for personal tuning - different model choices, extra verbosity, or test commands you do not want to commit.

## Initialization

The fastest way to set up config is `/eforge:init` in Claude Code or Pi. It scaffolds `eforge/config.yaml` with sensible defaults and walks you through harness and model selection.

To edit config interactively after initialization: `/eforge:config --edit`.

## Agent Tiers

Tiers are the primary configuration axis. Each tier is a self-contained recipe: `harness + model + effort`.

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

Pi is the recommended harness for new profiles. The engine still has current compatibility fallback defaults for omitted tiers; those defaults are `claude-sdk`, so Pi profiles should list all four tiers explicitly.

**Effort levels**: `low`, `medium`, `high`, `xhigh`, `max`. Higher effort means more agent turns and more thorough output, at higher cost.

**Thinking**: Add `thinking: true` to a tier to enable extended thinking. It is coerced to adaptive mode for models that only support adaptive thinking.

## Using the Pi Harness

Pi is the recommended provider-flexible execution harness for new eforge setup. Set `harness: pi` and add a `pi.provider` block:

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
```

Pi supports OpenAI, Google, Mistral, Groq, xAI, Bedrock, Azure, OpenRouter, and local models. Authentication resolves from provider-specific environment variables or `~/.pi/agent/auth.json`. For OAuth providers (OpenAI Codex, GitHub Copilot), run `pi auth login <provider>` first.

## Optional Claude SDK Harness

`claude-sdk` remains supported for Anthropic Claude Agent SDK users:

```yaml
agents:
  tiers:
    implementation:
      harness: claude-sdk
      model: claude-sonnet-4-6
      effort: medium
      claudeSdk:
        disableSubagents: true
```

Claude Agent SDK usage follows Anthropic's Agent SDK credit/API-pricing policy described in Getting Started; choose this path only when you intentionally want the Anthropic-specific SDK.

## Agent Runtime Profiles

A profile bundles tier recipes into a reusable named file. This lets you switch between configurations - such as "use Claude for review, local model for implementation" - without editing `eforge/config.yaml`.

Profiles live at three scopes:

- `~/.config/eforge/profiles/` - User scope
- `eforge/profiles/` - Project scope (committed)
- `.eforge/profiles/` - Project-local scope (gitignored)

The active profile is resolved highest-priority-first. Set one with:

```
/eforge:profile use <name>
```

Or from the CLI: `eforge profile use <name>`.

## Native Extensions

Native eforge extensions are TypeScript/JavaScript modules discovered from three scopes:

| Scope | Directory | Trust default |
|-------|-----------|---------------|
| User | `~/.config/eforge/extensions/` | trusted |
| Project/team | `eforge/extensions/` | skipped unless a matching local trust record exists |
| Project-local | `.eforge/extensions/` | trusted |

Precedence is `project-local > project-team > user`. Use project-local extensions for experiments, then promote to `eforge/extensions/` when the team should share them. Project/team extensions require a per-extension local trust record in `.eforge/extension-trust.json` created by `eforge extension trust <name>`. `extensions.trustProjectExtensions` is retained only as a deprecated compatibility field: it does not trust project/team code, and committed project config/profile layers that set it are stripped with a warning. Any code change invalidates the stored hash and blocks the extension until re-trusted.

```yaml
extensions:
  enabled: true                  # default
  eventHookTimeoutMs: 5000       # native onEvent timeout in ms
  agentContextHookTimeoutMs: 5000 # optional onAgentRun timeout; defaults to eventHookTimeoutMs
  profileRouterTimeoutMs: 5000   # optional registerProfileRouter timeout; defaults to eventHookTimeoutMs
  policyGateTimeoutMs: 5000      # optional policy gate timeout; defaults to eventHookTimeoutMs
  policyGateFailurePolicy: fail-closed # fail-closed blocks on failures; fail-open allows after diagnostics
  include:
    - build-notifier             # optional allowlist by name
  exclude:
    - experimental-policy        # optional denylist by name
  paths:
    - ./tools/eforge-audit.ts    # explicit file/directory paths
  trustProjectExtensions: false  # deprecated compatibility field; local trust records control project/team loading
```

Supported extension entrypoints are `.ts`, `.mts`, `.js`, and `.mjs` files or directories with `index.*` / supported `package.json` entrypoints. TypeScript loads through `jiti`; JavaScript uses dynamic import. The loader executes the default-export factory in the eforge daemon/worker Node process without a sandbox, records registrations, and surfaces status, diagnostics, shadows, trust, source, strategy, registration counts, and event replay results through `eforge extension list/show/validate/test` and extension API routes.

Current runtime support includes discovery, trust gating, loading, diagnostics, provenance output, registration capture, native `onEvent` dispatch and replay testing, `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, pre-build `registerProfileRouter` dispatch, runtime policy gates for `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge`, `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, and management commands (`eforge extension list/show/validate/test/new/reload/trust/untrust/install/update/remove/promote/demote`). Package-managed extensions installed via `eforge extension install` carry nested `package.*` and `install.*` provenance fields such as `install.sourceKind`, `install.sourceSpec`, and `install.installedAt`; install sidecar files are excluded from the trust hash. `registerTool` records loader-time provenance; `onAgentRun({ tools: [...] })` is the per-run injection path. Reviewer perspective execution, validation-provider execution, `beforeEnqueue`, `beforeValidation`, approval workflow/state, and `modify` decisions are deferred runtime phases. See [Extensions](/docs/extensions) and [Extensions API Reference](/docs/extensions-api).

## Guided Toolbelt Presets

Toolbelts let a tier opt into a named bundle of project MCP servers from `.mcp.json`. When creating a profile, Pi's native `/eforge:profile:new` wizard (and Claude Code's `/eforge:profile-new` fallback) includes an optional toolbelt step after tier configuration.

**What the wizard asks:**

- **Skip / default** — omit `toolbelt` from all tiers; all project MCP servers from `.mcp.json` pass through (original behavior).
- **No project MCP access** — set all four tiers to `toolbelt: none`; no project MCP servers reach agents in any tier.
- **Choose a preset** — configure a named toolbelt bundle with least-privilege tier assignments.

**Least-privilege rule:** Presets explicitly assign `toolbelt: none` to tiers that do not need project MCP servers. An omitted `toolbelt` keeps the all-project-MCP default.

### Preset gallery

| Preset | Typical MCP servers | Tiers receiving access | Missing-server behavior |
|--------|--------------------|-----------------------|------------------------|
| `browser-ui` | `playwright` | implementation, review | Show `.mcp.json` snippet; ask before adding |
| `docs-research` | `fetch`, `context7` | planning, implementation | Show setup guidance; do not create tier references |
| `issue-triage` | `github` | planning | Show setup guidance; do not create tier references |
| `repo-review` | `github` | planning, review | Show setup guidance; do not create tier references |
| `observability` | `datadog`, `sentry` | planning, evaluation | Show setup guidance; do not create tier references |
| `database-readonly` | `postgres`, `sqlite` | planning | Show setup guidance; do not create tier references |
| `api-testing` | `fetch` | implementation, review | Show setup guidance; do not create tier references |
| `design-ui` | `figma` | planning, implementation, review | Show setup guidance; do not create tier references |

Toolbelts filter only project MCP servers from `.mcp.json`. They do not affect Pi extensions, Claude Code plugins, engine-internal tools, or harness built-ins.

### browser-ui — Playwright setup

The `browser-ui` preset is the only one that the profile wizard can auto-configure after explicit confirmation. For UI-heavy or browser-validation work, pair your profile with `browser-ui` backed by the Playwright MCP server.

**Step 1 - Register the toolbelt in `eforge/config.yaml`:**

```yaml
tools:
  toolbelts:
    browser-ui:
      description: Browser automation for UI implementation and review.
      mcpServers:
        - playwright
```

**Step 2 - Create `eforge/profiles/ui.yaml`:**

```yaml
# eforge/profiles/ui.yaml
description: UI-heavy feature work with browser validation.
whenToUse:
  - Frontend features
  - Layout bugs
  - Screenshot-driven UI fixes
tags:
  - ui
  - frontend
  - browser

agents:
  tiers:
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
      toolbelt: none

    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
      toolbelt: browser-ui

    review:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
      toolbelt: browser-ui

    evaluation:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
      toolbelt: none
```

**Step 3 - Add the Playwright MCP server to `.mcp.json`:**

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

**For other presets:** Add the required MCP servers to `.mcp.json` manually, declare `tools.toolbelts.<preset>` in `eforge/config.yaml`, then use `/eforge:profile-new` to create a profile referencing the toolbelt.

**MVP constraints:**

1. Toolbelts filter only project MCP servers from `.mcp.json` - they do not affect Pi extensions, Claude Code plugins, engine-internal tools, or harness built-ins.
2. Each tier picks at most one toolbelt via the singular `toolbelt` field.
3. `toolbelt: none` passes no project MCP servers to agents in that tier.
4. An omitted `toolbelt` keeps the default: all servers from `.mcp.json` are passed through.
5. Pi extensions and Claude Code plugins are out of scope for this MVP - toolbelts are MCP-only and declarative.
6. Toolbelts are declarative MCP bundles; extensions are imperative lifecycle behavior. Extensions may inspect toolbelt and profile metadata when making routing decisions, but extensions should not redefine toolbelts or act as a hidden config layer.

For the complete field schema and validation behavior, see the [Toolbelts](/reference/config#toolbelts) section in the Configuration Reference. For the extension/toolbelt boundary, see the [Extensions API Reference](/docs/extensions-api#toolbelt-vs-extension-boundary).

## Playbook Profiles

Playbooks support an optional `profile` frontmatter field that names an agent runtime profile to use when the playbook runs:

```yaml
---
name: docs-sync
description: Sync project documentation
scope: project-team
mode: autonomous
profile: docs-heavy    # Optional — omit to allow router/active-profile/default resolution
---

## Goal
Keep all documentation in sync with the latest code changes.
```

**Precedence**: the playbook `profile` field overrides the project's active-profile marker and any registered profile router. `eforge playbook run` does not accept a runtime profile override; edit the playbook frontmatter to change its profile. For session-plan builds, an explicit `--profile` flag or enqueue request field overrides the session plan's inherited `agent_profile`.

**Validation timing**: the named profile is validated at execution time, not when the playbook is saved. Inherited `agent_profile` values on session plans are validated when the session plan is enqueued.

**Planning playbooks**: when a planning-mode playbook has a `profile` field and the agent creates a session plan from it, the profile is inherited into the session plan's `agent_profile` frontmatter field. When the session plan is enqueued, `agent_profile` is used as the effective profile unless an explicit override is supplied.

**Blank profile fallback**: omitting `profile` allows a registered profile router to select a profile first; if no router selects one, eforge uses the project's active-profile marker or engine defaults.

## Post-Merge Commands

Commands to run after all plans merge - compile, test, lint, or any validation step:

```yaml
build:
  postMergeCommands:
    - "pnpm type-check"
    - "pnpm test"
  maxValidationRetries: 2
```

Each command runs under a 5-minute wall-clock timeout. On failure, a validation-fixer agent attempts repairs up to `maxValidationRetries` times.

## Queue Concurrency

How many PRDs to build concurrently when processing the queue:

```yaml
maxConcurrentBuilds: 2   # default
```

Within a single build, plans run in parallel automatically as their dependencies are satisfied - no configuration needed there.

## Per-Role Tuning

Fine-tune individual agent roles without reassigning them to a different tier:

```yaml
agents:
  roles:
    builder:
      effort: high
      maxTurns: 80
    reviewer:
      promptAppend: |
        ## Project Rules
        - Flag raw SQL queries
        - Require error handling for all async operations
    formatter:
      effort: low
```

Available per-role fields: `tier`, `effort`, `thinking`, `maxTurns`, `allowedTools`, `disallowedTools`, `promptAppend`, `shards` (builder-only).

## Custom Prompts

Override any bundled agent prompt by placing a `.md` file in `eforge/prompts/` with the same name as the role:

```yaml
agents:
  promptDir: eforge/prompts
```

If `eforge/prompts/reviewer.md` exists, it replaces the bundled reviewer prompt entirely. Use `promptAppend` on a role for additive rules instead of full replacement.

## Hooks

Hooks are fire-and-forget shell commands triggered by eforge events - useful for notifications, logging, and external integrations:

```yaml
hooks:
  - event: plan:build:complete
    command: "notify-send 'Build complete'"
    timeout: 5000
  - event: plan:build:failed
    command: "curl -X POST $SLACK_WEBHOOK -d '{\"text\": \"Build failed\"}'"
```

Hooks do not block the pipeline. See the [Hooks](/reference/config#hooks) section in the Configuration Reference for field details.

## Full Reference

For the complete `eforge/config.yaml` schema with all fields, types, and defaults, see the [Configuration Reference](/reference/config).
