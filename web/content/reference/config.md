<!-- Generated file. Do not edit. -->
<!-- Source: packages/engine/src/config.ts -->

# eforge Configuration Reference

eforge merges configuration from three tiers (highest precedence first):

1. `.eforge/config.yaml` — project-local, gitignored, developer-personal
2. `eforge/config.yaml` — project-level, committed
3. `~/.config/eforge/config.yaml` — user-global

## Top-level fields

| Field | Description |
|-------|-------------|
| `agents` |  |
| `build` |  |
| `daemon` |  |
| `extensions` | Native eforge extension configuration |
| `hooks` |  |
| `landing` | Publication action taken after all plans complete and validation passes. |
| `langfuse` |  |
| `maxConcurrentBuilds` |  |
| `monitor` |  |
| `plan` |  |
| `plugins` |  |
| `prdQueue` |  |
| `stacking` | Stacking configuration for git-spice backed stacked PRs. Set stacking.enabled: true to activate; each artifact branch PR then targets the parent artifact branch rather than trunk. PRD frontmatter fields stack_id (logical stack name) and stack_parent (parent PRD id) control the topology. |
| `tools` |  |

## Toolbelts

`tools.toolbelts` declares named bundles of project MCP servers that tiers can opt into with `agents.tiers.<tier>.toolbelt`. Toolbelts are intended for profiles that need a focused capability set, such as browser automation for UI implementation and review.

Use Pi's native `/eforge:profile:new` wizard or Claude Code's `/eforge:profile-new` fallback to configure toolbelt presets interactively. The wizard prompts for a preset after tier configuration, with a gallery including `browser-ui`, `docs-research`, `issue-triage`, `repo-review`, `observability`, `database-readonly`, `api-testing`, and `design-ui`. Each preset assigns `toolbelt: none` to tiers that do not need project MCP access (least-privilege default).

```yaml
tools:
  toolbelts:
    browser-ui:
      description: Browser automation for UI implementation and review.
      mcpServers:
        - playwright

agents:
  tiers:
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
      toolbelt: browser-ui
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
      toolbelt: none
```

- `tools.toolbelts.<name>.description` is optional human-readable prose for list/show surfaces.
- `tools.toolbelts.<name>.mcpServers` is a non-empty list of server names from `.mcp.json`.
- `agents.tiers.<tier>.toolbelt` names one declared toolbelt, or uses `toolbelt: none` to pass no project MCP servers to that tier.
- An omitted `toolbelt` keeps the default behavior: all project MCP servers from `.mcp.json` are passed through.
- Toolbelts filter only project MCP servers from `.mcp.json`; they do not affect Pi extensions, Claude Code plugins, engine-internal tools, extension-contributed custom tools, or harness built-ins.
- Validation rejects reserved toolbelt names such as `none`, invalid toolbelt names, tier references to undeclared toolbelts, missing `.mcp.json` files when a toolbelt declares MCP servers, and toolbelt server names that are not present under `.mcp.json` `mcpServers`.

## Hooks

`hooks` is an optional list of fire-and-forget shell commands triggered by eforge events. Hooks are for notifications, logging, and external integrations; they do not block the build pipeline.

```yaml
hooks:
  - event: plan:build:complete
    command: "notify-send 'Build complete'"
    timeout: 5000
  - event: plan:build:failed
    command: "curl -X POST $SLACK_WEBHOOK -d '{\"text\": \"Build failed\"}'"
```

| Field | Description |
|-------|-------------|
| `event` | Event name or pattern that triggers the hook command. |
| `command` | Shell command executed when the event matches. |
| `timeout` | Optional positive timeout in milliseconds; defaults to `5000`. |

Hook commands run asynchronously from the pipeline path. Use them for best-effort side effects, not required validation or build steps.

## Landing Action

`landing.action` controls what happens after a successful build. Values: `pr` (open a GitHub pull request), `merge` (merge the artifact branch into the base branch), `leave` (leave the artifact branch in place). Default: `merge`.

**Migration:** The old `build.onSuccess` field and its values (`issue-pr`, `merge-to-base-branch`, `leave-branch`) have been removed. Configs using `build.onSuccess` are rejected with a migration error. Replace it with `landing.action` using the mapping below:

| `landing.action` | Old `build.onSuccess` (rejected) |
|-----------------|----------------------------------|
| `pr` | `issue-pr` |
| `merge` | `merge-to-base-branch` |
| `leave` | `leave-branch` |

```yaml
landing:
  action: pr    # pr | merge (default) | leave
```

## PR Auto-Merge

`landing.pr.autoMerge` controls whether GitHub PR auto-merge is enabled after a PR is opened. This setting only applies when `landing.action: pr`. Default: `ask`.

Note: `landing.pr.autoMerge` is distinct from `landing.action: merge`. The `action: merge` setting merges the artifact branch directly into the base branch without opening a PR. `landing.pr.autoMerge` opens a PR and then optionally enables GitHub's native auto-merge feature on it.

| Value | Behavior |
|-------|----------|
| `ask` (default) | Enable auto-merge only when the per-run `landingAutoMerge` flag is explicitly `true`. Omitting the per-run flag means no auto-merge. |
| `always` | Enable auto-merge on every PR unless the per-run `landingAutoMerge` flag is explicitly `false`. |
| `never` | Never enable auto-merge; skips auto-merge silently and emits a skipped event. |

**Per-run override:** Individual builds and playbook runs can override the policy via the `landingAutoMerge` field in the enqueue body (CLI: `--landing-auto-merge` / `--no-landing-auto-merge`). Omitting the field defers to the `landing.pr.autoMerge` policy.

```yaml
landing:
  action: pr
  pr:
    autoMerge: ask    # ask (default) | always | never
```

## Stacking

`stacking` configures git-spice backed stacked pull requests. When `stacking.enabled: true`, each build's artifact branch targets the parent artifact branch instead of the trunk, forming a linear stack of PRs. git-spice must be installed; see the [Stacked PRs guide](/docs/stacking).

```yaml
stacking:
  enabled: true              # Default false
  gitSpice:
    command: git-spice       # Default. Set to 'gs' if you use the short alias.

landing:
  action: pr                 # Required for stacking
```

| Field | Description |
|-------|-------------|
| `stacking.enabled` | Enable stacking. Default `false`. |
| `stacking.provider` | Stack provider. Only `"git-spice"` is supported in v1. |
| `stacking.gitSpice.command` | Path or name of the git-spice executable. Default: `"git-spice"`. |

**PRD frontmatter stacking fields:**

| Field | Description |
|-------|-------------|
| `stack_id` | Logical stack name shared by all PRDs in the stack. Optional; inferred from root PRD id. |
| `stack_parent` | Parent PRD id. Optional for single-dependency PRDs (inferred from `depends_on`); required for multi-dependency PRDs. |

## Pre-Compile Trunk Sync

`build.trunkSync` controls the pre-compile trunk freshness gate that runs before the merge worktree is created for queued root builds. It fetches the configured remote trunk, resolves the fetched commit SHA, and compares it to the local trunk ref to select the best compile base.

```yaml
build:
  trunkSync:
    enabled: true             # Default. Set to false for offline/local-only workflows.
    remote: origin            # Remote to fetch trunk from (default: origin).
    strategy: fetchedRemoteRef # Only 'fetchedRemoteRef' is supported in v1.
    onDiverged: warn          # warn | fail | use-remote
```

| Field | Default | Description |
|-------|---------|-------------|
| `build.trunkSync.enabled` | `true` | Enables the pre-compile fetch. Set to `false` for offline or local-only workflows. |
| `build.trunkSync.remote` | `"origin"` | Remote name to fetch the trunk branch from. Must be a configured git remote name - not a URL or path. Must be non-empty, must not start with `-`, and must contain no whitespace or control characters. Invalid values fail the build before compile rather than falling back to the fetch-unavailable behavior. |
| `build.trunkSync.strategy` | `"fetchedRemoteRef"` | Base selection strategy. Only `"fetchedRemoteRef"` is supported in v1. |
| `build.trunkSync.onDiverged` | `"warn"` | Policy applied when local trunk and remote trunk have diverged. Values: `warn` emits a diagnostic and falls back to local trunk; `fail` fails the build before compile; `use-remote` uses the fetched SHA with a diagnostic. |

Remote-ahead and equal cases always use the fetched remote SHA. Local-ahead-only cases use the local trunk ref with a diagnostic. Child stacked PRDs and feature-branch builds are not retargeted.

When the configured remote is missing, the remote trunk branch does not exist, the fetch fails, or FETCH_HEAD cannot be resolved after the fetch, trunk sync is skipped. The build continues with the original candidate base and emits a planning diagnostic. The `onDiverged` policy applies only to true local/remote divergence, not to fetch failures or unavailable remotes.

The `remote` value is validated before the fetch. Invalid values (URL, path, starts with `-`, whitespace/control characters) and invalid trunk branch refnames fail the build before compile - they do not fall back to the fetch-unavailable behavior. Use `enabled: false` to skip trunk sync for offline or local-only workflows.

## JSON Schema

The complete machine-readable schema is at [`/schemas/config.schema.json`](/schemas/config.schema.json).
