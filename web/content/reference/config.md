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
| `agents` | Agent runtime configuration, including tiers, roles, prompt overrides, permissions, and model-turn limits. |
| `build` | Build execution settings such as worktree location, validation commands, cleanup, trunk policy, and validation waivers. |
| `compile` | Compile planning-unit limits and direct PR base-sync budgets |
| `daemon` | Daemon lifecycle settings for the long-running project watcher and API process. |
| `extensions` | Native eforge extension configuration |
| `hooks` | Fire-and-forget shell commands triggered by matching eforge events. |
| `landing` | Publication action taken after all plans complete and validation passes. |
| `langfuse` | Optional Langfuse tracing configuration for agent runs. |
| `maxConcurrentBuilds` | Maximum number of queued PRD builds that may run concurrently. |
| `monitor` | Monitor and Console retention settings for recorded runs and events. |
| `plan` | Plan artifact output settings used during compile. |
| `plugins` | Host plugin integration settings. |
| `prdQueue` | Queue directory, auto-build, and watcher polling settings for queued PRDs. |
| `recovery` | Recovery automation settings. Manual recovery tools remain available regardless of this policy. |
| `stacking` | Stacking configuration for git-spice backed stacked PRs. Set stacking.enabled: true to activate; each artifact branch PR then targets the parent artifact branch rather than trunk. PRD frontmatter fields stack_id (logical stack name) and stack_parent (parent PRD id) control the topology. |
| `tools` | Toolbelt configuration for named project MCP server bundles. |

## Compile

`compile` tunes context-managed planning units for overflow-risk compile inputs and the direct PR base-sync conflict-attempt budget. All `compile.planningUnit*` values are positive integers capped by documented operational maxima; `compile.directPrBaseSyncConflictAttempts` is clamped after config/override precedence resolution.

| Field | Default | Max | Description |
|-------|---------|-----|-------------|
| `compile.planningUnitParallelism` | `2` | `16` | Maximum planning units processed concurrently. |
| `compile.planningUnitMaxDepth` | `3` | `8` | Maximum recursive split depth for planning units. |
| `compile.planningUnitMaxPromptSourceBytes` | `40000` | `250000` | Maximum source bytes packed into a single planning-unit prompt. |
| `compile.planningUnitMaxPromptBytes` | `80000` | `500000` | Maximum total prompt bytes for a single planning unit. |
| `compile.planningUnitMaxObservedInputTokens` | `120000` | `1000000` | Maximum observed input-token budget per planning unit. |
| `compile.planningUnitMaxObservedTurns` | unset | `200` | Optional observed turn limit per planning unit. |
| `compile.planningUnitMaxCompactHandoffBytes` | `12000` | `100000` | Maximum compact handoff size carried between planning-unit steps. |
| `compile.planningUnitMaxLocalExplorationToolUses` | `24` | `256` | Maximum local exploration tool uses per planning unit. |
| `compile.planningUnitMaxCriteriaPerUnit` | `20` | `64` | Maximum acceptance criteria assigned to one planning unit. |
| `compile.planningUnitMaxSubsystemsPerUnit` | `2` | `32` | Maximum subsystems assigned to one planning unit. |
| `compile.planningUnitMaxSplitAttemptsPerUnit` | `2` | `8` | Maximum split retries attempted for one planning unit. |
| `compile.directPrBaseSyncConflictAttempts` | `12` | `100` | Conflict-resolution attempt budget for direct non-stacked PR base sync. Explicit per-call overrides take precedence over config; the selected value is clamped to `1`-`100`. |

## Recovery auto-resume

`recovery.autoResume` is disabled by default. With the default config, queued builds keep the existing failure handling and manual recovery routes/tools remain available; no auto-resume audit events or attempt state are written.

| Field | Default | Description |
|-------|---------|-------------|
| `recovery.autoResume.enabled` | `false` | Opt in to daemon-owned bounded auto-resume for high-confidence compiled-artifact `continue-repair` recommendations. |
| `recovery.autoResume.maxAttempts` | `1` | Maximum automatic continue-repair attempts per failed PRD. `0` is audit-only/non-mutating mode. |

Policy audit events surface attempt counts and stop reasons such as `disabled`, `attempt-budget-exhausted`, `not-continue-repair`, `not-high-confidence`, `not-eligible`, `manual-confirmation-required`, and `error`.

```yaml
recovery:
  autoResume:
    enabled: false
    maxAttempts: 1
```

## Runtime Choices and Routing

`agents.tiers.<tier>` defines the default runtime recipe for roles assigned to that tier. A tier can also declare tier-local `choices` overlays and ordered `routing.rules` to select a choice per agent invocation. The implicit `default` choice is the tier recipe itself.

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
        ui:
          model: anthropic/claude-opus-4-6
          effort: high
          toolbelt: browser-ui
        backend:
          model: openai/gpt-5.4
          pi:
            provider: openrouter
      routing:
        rules:
          - name: ui-paths
            choice: ui
            when:
              pathGlobs: ["web/**", "packages/console-ui/**"]
          - name: backend-keywords
            choice: implementation.backend
            when:
              keywords: ["api", "database"]
```

| Field | Description |
|-------|-------------|
| `agents.tiers.<tier>.choices.<choice>` | Optional named runtime-choice overlay. Choice names are lowercase slugs starting with a letter; `default` is reserved for the implicit tier default. |
| `agents.tiers.<tier>.choices.<choice>.harness` | Optional harness override. If omitted, inherited from the tier default. |
| `agents.tiers.<tier>.choices.<choice>.model` | Optional model override. If omitted, inherited from the tier default. |
| `agents.tiers.<tier>.choices.<choice>.effort` | Optional effort override. If omitted, inherited from the tier default. |
| `agents.tiers.<tier>.choices.<choice>.pi` / `.claudeSdk` | Optional harness-specific overrides. The effective recipe must match the selected harness. |
| `agents.tiers.<tier>.choices.<choice>.toolbelt` | Optional toolbelt override for this choice; uses the same `tools.toolbelts` names or `none` as tier-level `toolbelt`. |
| `agents.tiers.<tier>.routing.rules` | Ordered runtime-choice routing rules. The first matching rule selects its `choice`; if no rule matches, eforge uses `default` or an extension-router/fallback decision when configured. |
| `agents.tiers.<tier>.routing.rules[].name` | Required human-readable rule identifier, surfaced in runtime-choice metadata. |
| `agents.tiers.<tier>.routing.rules[].choice` | Required choice reference: `default`, a tier-local choice name such as `ui`, or a qualified same-tier reference such as `implementation.ui`. Cross-tier references are rejected. |
| `agents.tiers.<tier>.routing.rules[].when.roles` | Match agent roles assigned to this tier. |
| `agents.tiers.<tier>.routing.rules[].when.phase` | Match invocation phases such as `compile` or `build`. |
| `agents.tiers.<tier>.routing.rules[].when.stage` | Match invocation stage names. |
| `agents.tiers.<tier>.routing.rules[].when.pathGlobs` | Match plan or shard paths using path globs. |
| `agents.tiers.<tier>.routing.rules[].when.keywords` | Match invocation keywords. |
| `agents.tiers.<tier>.routing.rules[].when.shardIds` | Match compile shard identifiers. |
| `agents.tiers.<tier>.routing.rules[].when.shardRoots` | Match compile shard root paths. |

Choice overlays inherit from the containing tier default before validation, so a choice may specify only the fields it changes. After inheritance, every effective recipe must have a valid `harness`, `model`, `effort`, and harness-specific provider/config. Routing rules are tier-local: they cannot select a choice declared under another tier. The `when` block must include at least one predicate group; groups are combined as a match for that rule, and rules are evaluated in list order.

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

**Per-run override:** Individual builds and extension-originated enqueue requests can override the policy via the `landingAutoMerge` field in the enqueue body (CLI: `--landing-auto-merge` / `--no-landing-auto-merge`). Omitting the field defers to the `landing.pr.autoMerge` policy.

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
| `stacking.sync.afterBuild` | Trigger daemon-owned stack sync after every build. Default `false`. When enabled, the daemon automatically runs `git-spice stack restack` after each build completes. When active builds are running, sync is deferred until those builds finish (`outcome: deferred`). |

**Stack sync outcomes:**

| Outcome | Description |
|---------|-------------|
| `complete` | All eligible artifact branches were restacked onto the latest trunk. |
| `skipped` | Stacking is not enabled or no eligible branches found. |
| `deferred` | Active builds are running whose worktrees overlap the stack candidate set. Sync was deferred; the daemon retries automatically after those builds complete. |
| `failed` | The sync command exited with a non-zero code. |
| `conflict` | A restack step hit a merge conflict requiring manual resolution. |

**PRD frontmatter stacking fields:**

| Field | Description |
|-------|-------------|
| `stack_id` | Logical stack name shared by all PRDs in the stack. Optional; inferred from root PRD id. |
| `stack_parent` | Parent PRD id. Optional for single-dependency PRDs (inferred from `depends_on`); required for multi-dependency PRDs. |

## Workflow Presets

Workflow presets bundle landing action, stacking, and PR settings into a named preset. Use `/eforge:workflow` (Claude Code) or `/eforge:workflow` (Pi) to configure interactively without editing `eforge/config.yaml` manually.

| Preset | When selected | Config keys written |
|--------|--------------|---------------------|
| `solo-merge` | Solo developer, direct merge to trunk | `landing.action: merge`, `build.allowLocalMergeToTrunk: true`, `stacking.enabled: false` |
| `solo-pr` | Solo developer, PR workflow, no stacking | `landing.action: pr`, `landing.pr.autoMerge: always`, `stacking.enabled: false` |
| `team-pr` | Team project, PR workflow, no stacking | `landing.action: pr`, `landing.pr.autoMerge: ask`, `stacking.enabled: false` |
| `stacked-pr` | git-spice stacking, manual sync | `landing.action: pr`, `stacking.enabled: true` |
| `stacked-pr-autosync` | git-spice stacking, daemon-owned after-build sync | `landing.action: pr`, `stacking.enabled: true`, `stacking.sync.afterBuild: true` |

For stacking presets where the user provides a non-default git-spice path, `stacking.gitSpice.command` is also written.

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
