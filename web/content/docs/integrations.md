---
title: Integrations
description: How to use eforge from Claude Code, Pi, the standalone CLI, and external issue trackers.
---

# Integrations

eforge can be driven from three host surfaces: the Claude Code plugin, the Pi extension, and the standalone CLI. All three talk to the same daemon and share the same queue, profiles, and playbooks. This page covers how each surface works and how to connect eforge to external systems.

## Claude Code plugin

The Claude Code plugin installs eforge's skills as slash commands, wires up an MCP proxy so Claude Code can call eforge daemon tools directly, and includes the marketplace install flow.

### Install

Run these three commands inside Claude Code:

```
/plugin marketplace add eforge-build/eforge
/plugin install eforge@eforge
/eforge:init
```

`/eforge:init` creates `eforge/config.yaml` with sensible defaults and walks you through harness and model selection. Choose Quick setup with Pi for the recommended provider-flexible path.

### MCP proxy

The Claude Code plugin communicates with the daemon through an MCP stdio proxy. When the plugin loads, it launches:

```bash
eforge mcp-proxy
```

The proxy translates MCP tool calls from Claude Code into HTTP requests to the local daemon HTTP API. The daemon auto-starts on first use; you do not need to start it manually.

### Skills (slash commands)

All eforge workflows are available as slash commands:

| Command | Purpose |
|---------|---------|
| `/eforge:build` | Enqueue a build from a prompt or session plan |
| `/eforge:plan` | Plan a change interactively before building |
| `/eforge:playbook` | Create, run, list, edit, promote, or demote playbooks |
| `/eforge:profile` | Inspect and switch agent runtime profiles |
| `/eforge:profile-new` | Create a new profile through a guided wizard |
| `/eforge:recover` | Inspect a failed build's recovery verdict and apply it |
| `/eforge:restart` | Safely restart the daemon |
| `/eforge:status` | Show current build queue and daemon status |
| `/eforge:init` | Initialize eforge in the current project |
| `/eforge:config` | View or edit `eforge/config.yaml` |
| `/eforge:extend` | Manage native extensions |
| `/eforge:update` | Check for and install eforge updates |

## Pi extension

The Pi extension provides the same capabilities as the Claude Code plugin through Pi's native command and overlay system.

### Install

```bash
pi install npm:@eforge-build/pi-eforge
/eforge:init
```

Add `-l` to install to project settings instead of global:

```bash
pi install -l npm:@eforge-build/pi-eforge
```

The Pi extension communicates directly with the daemon HTTP API rather than through a proxy, and supports richer UI patterns such as searchable overlays for profile and playbook selection.

## Standalone CLI

For shell-based workflows or CI environments where a host is not available:

```bash
# Install globally
npm install -g @eforge-build/eforge

# Or run without installing
npx @eforge-build/eforge build "Add rate limiting to the API"
```

All daemon management, profile operations, and playbook commands are available from the CLI:

```bash
eforge build "Add dark mode toggle"
eforge build plans/my-feature-prd.md
eforge play docs-sync
eforge profile use pi-anthropic
eforge daemon status
eforge daemon start
eforge daemon stop
eforge extension list
```

For standalone use, run `/eforge:init` in Claude Code or Pi first to create `eforge/config.yaml` and an agent runtime profile. The CLI then reads the same config.

## Shell hooks

Shell hooks let you trigger external commands on eforge events without writing a TypeScript extension. Configure them in `eforge/config.yaml`:

```yaml
hooks:
  - event: plan:build:complete
    command: "notify-send 'Build complete'"
    timeout: 5000
  - event: plan:build:failed
    command: "curl -X POST $SLACK_WEBHOOK -d '{\"text\": \"Build failed\"}'"
  - event: session:complete
    command: "./scripts/notify-team.sh"
```

Hooks are fire-and-forget - they do not block the pipeline. See [Configuration - Hooks](/docs/configuration#hooks) and [Configuration Reference - Hooks](/reference/config#hooks) for field details and available event patterns.

## Input source adapters (GitHub, Linear, Jira)

Native extensions can register input source adapters that resolve `eforge://input/<adapter>/<id>` URIs. When you supply such a URI as the build source, eforge fetches the issue or PR content and uses it as the PRD.

```bash
eforge build "eforge://input/github/acme/backend#42"
eforge build "eforge://input/linear/ENG-42"
eforge build "eforge://input/jira/ENG-42"
```

URI dispatch: the `<adapter>` segment selects a registered adapter by name. The `<id>` path is passed to the adapter's `fetch` function. The adapter returns Markdown content that eforge uses as build input.

Example adapters are available at `examples/extensions/issue-tracker.ts` in the eforge repository. See [Extensions - Input sources and PRD enrichers](/docs/extensions#input-sources-and-prd-enrichers) for the full adapter API.

## Observability with Langfuse

If you have a `langfuse` block in `eforge/config.yaml`, eforge sends agent trace data to your Langfuse project. The `langfuse` field is listed in the [Configuration Reference](/reference/config#top-level-fields) top-level fields table. See the Langfuse documentation for how to configure your project host, public key, and secret key.

## Monitor UI

A web-based monitor runs locally alongside the daemon. Access it at:

```
http://localhost:<port>
```

The port is deterministically assigned per project in the 4567-4667 range. The same port persists across daemon restarts for a given project.

The monitor shows:
- Active and queued builds with live progress
- Per-plan stage breakdown (plan, implement, review, merge, validate)
- Token usage and cost per build
- Runtime agent decisions (effort, thinking mode) on stage hover
- Queue management (cancel, retry after failure)
- Extension status and diagnostics

The monitor keeps running after a build completes so you can inspect results and costs.

## Where to look next

- [Getting Started](/docs/getting-started) - install and first build
- [Configuration](/docs/configuration) - configure hooks, extensions, and daemon settings
- [Extensions](/docs/extensions) - write TypeScript extensions for richer integrations
- [Troubleshooting](/docs/troubleshooting) - daemon startup issues and common errors
