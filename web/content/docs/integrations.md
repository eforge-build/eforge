---
title: Integrations
description: How to use eforge from Claude Code, Pi, the standalone CLI, extension contributions, and external issue trackers.
---

# Integrations

eforge can be driven from three host surfaces: the Claude Code plugin, the Pi extension, and the standalone CLI. All three talk to the same daemon and share the same core queue and profiles. Optional workflow surfaces such as `eforge-playbooks`, session-plan compatibility tools, and first-party extensions prepare or route build source around the kernel. This page covers how each surface works and how to connect eforge to external systems.

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

The MCP tool surface includes build enqueueing, status, config/profile/session-plan management, recovery, extension management, extension contribution discovery/detail/invocation through `eforge_extension_contribution` (`mcp__eforge__eforge_extension_contribution` in Claude tool-call form), existing queue controls, and auto-build state. Playbook behavior is available only when the first-party extension contributes actions to that generic surface. Extension-management and contribution tools use compact default projections and share a 12,000-character host-output budget for returned tool text; oversized payloads are summarized or truncated with guidance instead of dumping raw daemon objects into the coding-agent context. `eforge_queue_priority` updates pending/waiting queue-item priority, and `eforge_queue_remove` removes non-running pending, waiting, failed, or skipped queue items. The richer hold/unhold, scheduler pause/resume, failed-enqueue re-enqueue, and cascade preview/apply controls are Console and daemon/client API surfaces unless a host implementation intentionally exposes them. The `eforge_auto_build` tool reads or updates the daemon's auto-build desired state; Console uses the same daemon API state.

### Skills (slash commands)

All eforge workflows are available as slash commands:

| Command | Purpose |
|---------|---------|
| `/eforge:build` | Enqueue a build from a prompt, PRD, file path, or optional session-plan artifact |
| `/eforge:profile` | Inspect and switch agent runtime profiles |
| `/eforge:profile-new` | Create a new profile through a guided wizard |
| `/eforge:workflow` | Choose or reconfigure landing action, PR auto-merge policy, stacking, and automatic stack sync |
| `/eforge:stack` | Synchronize a git-spice stack; accepts `--dry-run` |
| `/eforge:recover` | Inspect a failed build's recovery verdict and apply it |
| `/eforge:restart` | Safely restart the daemon |
| `/eforge:status` | Show current build queue and daemon status |
| `/eforge:init` | Initialize eforge in the current project |
| `/eforge:config` | View or edit `eforge/config.yaml` |
| `/eforge:extend` | Manage native extensions |
| `/eforge:update` | Check for and install eforge updates |

Use `/eforge:workflow` to choose one of the workflow presets. The stacked preset with automatic sync is `stacked-pr-autosync`; it writes `landing.action: pr`, `stacking.enabled: true`, and `stacking.sync.afterBuild: true` so the daemon owns stack sync instead of relying on a post-merge shell command. When after-build sync is enabled, overlapping active builds produce a `deferred` stack sync outcome and the daemon retries after later terminal queue events.

## Pi extension

The Pi extension provides the same capabilities as the Claude Code plugin through Pi's native command system and interactive TUI surfaces.

### Install

```bash
pi install npm:@eforge-build/pi-eforge
/eforge:init
```

Add `-l` to install to project settings instead of global:

```bash
pi install -l npm:@eforge-build/pi-eforge
```

The Pi extension communicates directly with the daemon HTTP API rather than through a proxy, and supports richer UI patterns such as searchable selectors plus scrollable panels for variable-length read-only content. Native Pi tools mirror the Claude Code MCP surface, including core build/status/queue/config tools plus optional workflow tools such as `eforge_session_plan`, `eforge_extension`, and `eforge_extension_contribution`. Playbook behavior is reached through generic contribution invocation when the first-party extension is loaded. Pi extension-management and contribution tool text uses the same 12,000-character host-output budget as MCP. Pi also exposes `/eforge:extensions` for browsing, showing, and invoking extension-provided actions, commands, and deep links without dumping raw manifests by default, including optional [eforge-plan](/docs/eforge-plan) planning entries, SQLite store/search/maintenance actions, and `eforge-playbooks` contributions when those extensions are loaded.

### Pi commands

| Command | Purpose |
|---------|---------|
| `/eforge:workflow` | Open the workflow setup/reconfigure chooser |
| `/eforge:workflow:init` | Run the full workflow preset wizard from scratch |
| `/eforge:workflow:reconfigure` | Show current workflow config, then run the preset wizard |
| `/eforge:stack:sync` | Synchronize a git-spice stack; accepts `--dry-run` |

## Standalone CLI

For shell-based workflows or CI environments where a host is not available:

```bash
# Install globally
npm install -g @eforge-build/eforge

# Or run without installing
npx @eforge-build/eforge build "Add rate limiting to the API"
```

Daemon management, extension commands, and one-off build profile overrides are available from the CLI. Playbook actions are discovered and invoked through the generic extension contribution dispatcher:

```bash
eforge build "Add dark mode toggle"
eforge build --profile pi-anthropic plans/my-feature-prd.md
eforge build --landing-action pr plans/my-feature-prd.md
eforge queue run --all
eforge queue priority <prdId> <priority>
eforge queue remove <prdId>
eforge extension contributions list --kind command --search playbook
eforge extension contributions invoke eforge-playbooks:run-playbook --kind command --input-json '{"name":"docs-sync"}'
eforge daemon status
eforge daemon start
eforge daemon stop
eforge daemon restart
eforge extension list
eforge extension contributions list --kind command --search planning --limit 20
eforge extension contributions show <id> --kind command --include-schema
eforge extension contributions invoke <id> --kind command
eforge stack sync
eforge stack sync --dry-run
```

For standalone use, run `/eforge:init` in Claude Code or Pi first to create `eforge/config.yaml` and an agent runtime profile. The CLI then reads the same config. Profile creation and switching are currently exposed through the Claude Code and Pi skills rather than standalone `eforge profile` subcommands. Documented CLI queue controls match host tools: priority applies to pending/waiting items, removal applies to non-running pending, waiting, failed, and skipped items, running queue-item cancellation requires daemon ownership evidence, and failed removal cleans up recovery sidecars.

## Extension host contributions

Native extensions can publish shared manifest metadata for actions, declarative Console panels, integration commands, and deep links. The same daemon-owned manifest feeds CLI `eforge extension contributions list|show|invoke`, MCP/Claude `eforge_extension_contribution`, Pi `eforge_extension_contribution`, and Pi `/eforge:extensions`, so hosts discover the same action, command, and deep-link IDs. Optional first-party eforge-plan planning, SQLite status, FTS search, and maintenance actions are discovered through this generic routing rather than through kernel-owned or host-specific planning commands. Manifest entries also carry dependency/capability availability metadata; unavailable actions are rejected with error code `unavailable`.

Actions, action-backed commands, and action-backed deep links can be invoked generically through those host surfaces. Contribution list output is compact by default; use list filters and `show <id>` / `action: "show"` for focused detail, and opt into schemas, diagnostics, or full projections only when needed. MCP and Pi host output is capped to 12,000 characters for coding-agent tool text. Non-JSON host output is formatted for bounded display: exact `{ markdown: string }` outputs render as Markdown/plain text, oversized JSON is summarized with warnings and preserved identity/count/continuation fields, and rich/debug output profiles warn in coding-agent hosts. Use CLI `--json` or direct client/HTTP invocation only when you intentionally need the full raw action result. URL-only deep links are listable navigation entries for hosts that know how to open the URL, but they are not generic invocations unless the extension also supplies an action binding. Console contribution rendering stays inside `/console/system` and uses closed renderer IDs; richer extension UI uses registered sandboxed workstations (`srcDoc` or daemon-owned `frameBundle` assets), not arbitrary parent-Console frontend bundles.

## Daemon HTTP API

The daemon exposes a local HTTP API and SSE event streams used by the Claude Code MCP proxy, the Pi extension, Console, and wrapper apps. Use the generated [HTTP API Reference](/reference/api) for route shapes and the [Events Reference](/reference/events) for streamed event variants. For TypeScript integrations, import typed route helpers from `@eforge-build/client` instead of hard-coding `/api/...` paths; queue and recovery helpers include hold/unhold, queue cascade preview/apply, failed-enqueue list/re-enqueue, recovery-guidance preparation, and scheduler pause/resume. Direct playbook-specific daemon routes are absent: integrations must discover `eforge-playbooks:*` through the generic extension contribution manifest and invoke actions through generic extension action routes. Browser/Console integrations should use `holdQueueItem`, `unholdQueueItem`, `previewQueueCascade`, `applyQueueCascade`, `fetchFailedEnqueues`, `reenqueueFailedEnqueue`, `prepareRecoveryGuidance`, `pauseScheduler`, `resumeScheduler`, `fetchExtensionContributionManifest`, `invokeExtensionAction`, and client-owned `API_ROUTES` helpers rather than raw route construction. For normal day-to-day usage, prefer the host commands and tools above; direct API calls are intended for integrations and automation.

## Shell hooks

Shell hooks let you trigger external commands on eforge events without writing a TypeScript extension. Configure them in `eforge/config.yaml`:

```yaml
hooks:
  - event: plan:build:complete
    command: "notify-send 'Build complete'"
    timeout: 5000
  - event: plan:build:failed
    command: "curl -X POST $SLACK_WEBHOOK -d '{\"text\": \"Build failed\"}'"
  - event: session:end
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

Example adapters are available at `examples/extensions/issue-tracker.ts` in the eforge repository. The example GitHub adapter reads `GITHUB_TOKEN` (and optional `GITHUB_API_BASE` for Enterprise Server), the Linear adapter reads `LINEAR_API_KEY`, and the Jira adapter reads `JIRA_BASE_URL` plus `JIRA_TOKEN` in `<email>:<api-token>` format. See [Extensions - Input sources and PRD enrichers](/docs/extensions#input-sources-and-prd-enrichers) for the full adapter API.

## Observability with Langfuse

eforge sends agent trace data to Langfuse when both a public key and secret key are configured. Set them in `eforge/config.yaml` under `langfuse.publicKey`, `langfuse.secretKey`, and optional `langfuse.host`, or use the environment variables `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and optional `LANGFUSE_BASE_URL`. The default host is `https://cloud.langfuse.com`. The `langfuse` field is listed in the [Configuration Reference](/reference/config#top-level-fields) top-level fields table.

## Console dashboard

A web-based Console dashboard runs locally alongside the daemon. Access it at the canonical Console URL:

```
http://localhost:<port>/console/
```

Root UI requests on the same port redirect to Console.

The port is deterministically assigned per project in the 4567-4667 range. The same port persists across daemon restarts for a given project.

Console shows:
- Active and queued builds with live progress
- Pending/waiting queue row actions to set priority, hold/unhold rows, show daemon capability disabled reasons, and confirm preview-first remove/cascade flows
- Header controls that distinguish disabling auto-build from pausing/resuming scheduler launches
- Per-plan stage breakdown (plan, implement, review, merge, validate)
- Token usage and cost per build
- Runtime agent decisions (effort, thinking mode) on stage hover
- Console Needs attention strip for failed builds, compile scope/context failure banners, projected dispatch blockers, durable failed-enqueue rows with confirmed re-enqueue when source data exists, root-hosted recovery dialog actions with read-only compile guidance and explicit queue-cascade repair controls, and queue refresh, plus untrusted/changed project-team extension alerts with inline Trust/Re-trust actions
- Extension inventory, status, and diagnostics, plus a System extension management surface (under `/console/system`) for reloading extensions, validating a selected extension, and trusting/re-trusting, untrusting, promoting, and demoting discovered extensions through confirmation-gated actions

The daemon keeps Console available after a build completes so you can inspect results and costs.

## Where to look next

- [Getting Started](/docs/getting-started) - install and first build
- [Configuration](/docs/configuration) - configure hooks, extensions, and daemon settings
- [Extensions](/docs/extensions) - write TypeScript extensions for richer integrations
- [Troubleshooting](/docs/troubleshooting) - daemon startup issues and common errors
