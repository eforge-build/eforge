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

## Workflow Presets

Use `/eforge:workflow` after initialization when you want a guided choice for landing action, pull-request auto-merge, and stacking. Pi also exposes `/eforge:workflow:init` and `/eforge:workflow:reconfigure`; Claude Code uses `/eforge:workflow` and `/eforge:workflow --reconfigure`.

| Preset | Config keys written |
|--------|---------------------|
| `solo-merge` | `landing.action: merge`, `build.allowLocalMergeToTrunk: true`, `stacking.enabled: false` |
| `solo-pr` | `landing.action: pr`, `landing.pr.autoMerge: always`, `stacking.enabled: false` |
| `team-pr` | `landing.action: pr`, `landing.pr.autoMerge: ask`, `stacking.enabled: false` |
| `stacked-pr` | `landing.action: pr`, `stacking.enabled: true` |
| `stacked-pr-autosync` | `landing.action: pr`, `stacking.enabled: true`, `stacking.sync.afterBuild: true` |

For stacking presets, the wizard also writes `stacking.gitSpice.command` when you provide a custom git-spice path. Use `/eforge:config --edit` for fine-grained changes after applying a preset.

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

By default, eforge runs Pi harness sessions with `pi.resources: isolated` so ambient Pi resources (project/user/global extensions, skills, prompts, and themes) are not loaded into headless build agents. Set `pi.resources: ambient` on a tier only when you intentionally want those ambient Pi resources available during eforge agent runs. Pi-specific tier options also include `pi.thinkingLevel`, `pi.extensions`, `pi.compaction`, and `pi.retry`; keep provider selection in `pi.provider`.

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

Claude Agent SDK usage follows Anthropic's Agent SDK credit/API-pricing policy described in Getting Started; choose this path only when you intentionally want the Anthropic-specific SDK. Claude SDK tiers disable Claude Code subagents by default by denying the `Task` tool; set `claudeSdk.disableSubagents: false` only when you intentionally want subagents available.

## Agent Runtime Profiles

A profile bundles tier recipes into a reusable named file. This lets you switch between configurations - such as "use Claude for review, local model for implementation" - without editing `eforge/config.yaml`.

Profiles live at three scopes (highest-priority-first):

| Scope | Directory | Committed? |
|-------|-----------|-----------|
| Project-local | `.eforge/profiles/` | No (gitignored) |
| Project | `eforge/profiles/` | Yes |
| User | `~/.config/eforge/profiles/` | No |

Set the active profile from Claude Code or Pi with:

```
/eforge:profile <name>
```

The standalone CLI can override the active profile for one build with `eforge build --profile <name> ...`; profile creation and switching are handled by the host skills. For a complete walkthrough covering profile creation, scope resolution, toolbelts inside profiles, and profile-router precedence, see [Profiles](/docs/profiles).

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
  validationProviderTimeoutMs: 5000 # optional validation-provider timeout; defaults to eventHookTimeoutMs
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

Current runtime support includes discovery, trust gating, loading, diagnostics, provenance output, registration capture, native `onEvent` dispatch and replay testing, `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, pre-build `registerProfileRouter` dispatch, runtime policy gates for `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge`, `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, reviewer perspective execution, validation-provider execution, and management commands (`eforge extension list/show/validate/test/new/reload/trust/untrust/install/update/remove/promote/demote`). Package-managed extensions installed via `eforge extension install` carry nested `package.*` and `install.*` provenance fields such as `install.sourceKind`, `install.sourceSpec`, and `install.installedAt`; install sidecar files are excluded from the trust hash. `registerTool` records loader-time provenance; `onAgentRun({ tools: [...] })` is the per-run injection path. `beforeEnqueue`, `beforeValidation`, approval workflow/state, and `modify` decisions are deferred runtime phases. See [Extensions](/docs/extensions) and [Extensions API Reference](/docs/extensions-api).

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

## Queue and Auto-Build

The daemon watches `prdQueue.dir` for normalized PRDs. Leave `prdQueue.autoBuild` enabled for normal usage so queued PRDs start automatically; disable it when you want to stage multiple queue items before running them. `prdQueue.watchPollIntervalMs` tunes how often the auto-build watcher polls for queue changes.

```yaml
maxConcurrentBuilds: 2   # default: concurrent PRD builds across the queue
prdQueue:
  dir: .eforge/queue
  autoBuild: true
  watchPollIntervalMs: 5000
```

**PRD provenance**: when the daemon dispatches a PRD from `.eforge/queue/`, it writes a canonical copy to `eforge/prds/{prdId}.md`. Queue state is ephemeral and gitignored; `eforge/prds/` files are committed provenance artifacts that record what was built.

**Artifact cleanup and preserved history**: when `build.cleanupPlanFiles: true` (default), eforge removes committed build artifacts — the PRD copy in `eforge/prds/`, compiled plan files in `eforge/plans/{planSet}/`, and `orchestration.yaml` — from `HEAD` during the `pr` or `merge` landing flows after a successful build. Cleanup also strips temporary plan-ID eforge region marker comment lines from tracked JavaScript/TypeScript-family source files while preserving durable semantic markers and marked code. `landing.action: leave` does not run cleanup and leaves the artifact branch intact for inspection. These files are not permanently lost. When the artifact branch is landed with a merge commit (eforge's local `merge` action, or a GitHub PR merged via "Create a merge commit"), the commits that originally added the artifacts remain reachable in Git history. PR bodies include an **Eforge provenance** section with commit-pinned references (`git show <sha>:<path>`) that can be used to recover any artifact. The durable guarantee is Git history, not the final tree — squash or rebase merge strategies applied after a PR is opened can collapse intermediate commits and make artifact references unreachable. When `landing.action: pr` is used, provenance durability depends on the repository's chosen merge strategy.

Queue item frontmatter can also carry scheduling hints:

```yaml
---
title: Add billing export
priority: 10          # lower numbers run earlier within the same dependency wave
depends_on: [api-v2]  # wait for pending/running/waiting queue item ids
---
```

`depends_on` is validated at enqueue time. Dependencies may be active queue items (pending/running/waiting) or completed items with usable artifacts. Items blocked on active upstream dependencies live under the queue's `waiting/` subdirectory until all upstream items complete; items whose dependencies are already completed with usable artifacts are eligible immediately and remain in the queue root. If an upstream item fails or is cancelled, its waiting dependents move to `skipped/`.

**Explicit deterministic handoff**: instead of writing `depends_on` in frontmatter, pass `--after <queue-id>` to the CLI or `afterQueueId` to the `eforge_build` MCP/Pi tool to create an explicit dependency on an active or completed queue entry. Active upstream items (pending/running/waiting) are held in `waiting/` and unblocked when the upstream completes. Completed upstream items with a usable artifact are enqueued immediately as eligible dependents. Explicit `afterQueueId` takes precedence over automatic dependency detection, which remains best effort and is only used when no explicit dependency is supplied. Failed, skipped, and unknown IDs are rejected at enqueue time.

## Post-Merge Commands

Commands to run after all plans merge - compile, test, lint, or any validation step:

```yaml
build:
  postMergeCommands:
    - "pnpm type-check"
    - "pnpm test"
  postMergeCommandTimeoutMs: 300000
  maxValidationRetries: 2
```

`build.postMergeCommands` run in order after the merge. `build.postMergeCommandTimeoutMs` is the wall-clock timeout for each command in milliseconds (default 300000, five minutes). On failure, a validation-fixer agent attempts repairs up to `build.maxValidationRetries` times (default 2). When retries are exhausted, the build is marked failed. See [Troubleshooting - Validation-fixer retries exhausted](/docs/troubleshooting#validation-fixer-retries-exhausted) for recovery steps.

Within a single build, plans run in parallel automatically as their dependencies are satisfied - no configuration needed there.

## Landing Action

`landing.action` controls what happens when a build completes successfully.

| `landing.action` | Behavior |
|-------|----------|
| `merge` | Merges the artifact branch into the resolved base branch automatically. This is the engine default. |
| `pr` | Opens a GitHub pull request from the artifact branch targeting the resolved base branch. For direct non-stacked builds, eforge fetches `origin/<baseBranch>`, rebases the artifact branch before validation, and checks freshness again immediately before PR creation. For stacked builds the base is normally the parent artifact branch; landing can retarget a child to trunk when stale-parent repair proves the parent artifact is already integrated. Requires the `gh` CLI. |
| `leave` | Leaves the artifact branch in place without merging or creating a PR. Useful when you want to inspect the output or handle the branch manually. |

```yaml
landing:
  action: pr    # pr | merge (default) | leave
```

**`pr` prerequisite**: ensure `gh` is installed (`gh --version`) and authenticated (`gh auth status`). Builds configured with `landing.action: pr` will fail at the landing step if `gh` is unavailable.

**Migrating from `build.onSuccess`**: if you have the old `build.onSuccess` key in your config, replace it with `landing.action`. The values map as follows: `issue-pr` → `pr`, `merge-to-base-branch` → `merge`, `leave-branch` → `leave`. New builds reject both the old `build.onSuccess` key and the legacy full-string values (`issue-pr`, `merge-to-base-branch`, `leave-branch`) with migration guidance - only `pr`, `merge`, and `leave` are valid for `landing.action`.

### PR auto-merge policy

`landing.pr.autoMerge` controls whether GitHub PR auto-merge is enabled after a PR is opened. Only applies when `landing.action: pr`. Default: `ask`.

| Value | Behavior |
|-------|----------|
| `ask` (default) | Enable auto-merge only when the per-run `landingAutoMerge` flag is explicitly `true`. |
| `always` | Enable auto-merge on every PR unless the per-run `landingAutoMerge` flag is explicitly `false`. |
| `never` | Never enable auto-merge; skips auto-merge and emits a skipped event. |

Individual builds and playbook runs can override the policy with `--landing-auto-merge` or `--no-landing-auto-merge` (CLI), or by sending `landingAutoMerge: true/false` in the enqueue body. Omitting the flag defers to the configured policy.

Note: `landing.pr.autoMerge` is distinct from `landing.action: merge`. The `action: merge` setting merges the artifact branch directly into the base branch without opening a PR.

```yaml
landing:
  action: pr
  pr:
    autoMerge: ask    # ask (default) | always | never
```

## Stacked PRs

When `stacking.enabled: true`, each build's artifact branch normally targets the parent artifact branch instead of the trunk, creating a stack of pull requests. Requires git-spice to be installed. During landing, eforge can repair a missing integrated parent by retargeting only the child artifact branch to trunk.

```yaml
stacking:
  enabled: true                # Default false
  gitSpice:
    command: git-spice         # Default. Set to 'gs' if you use the short alias.
  sync:
    afterBuild: false          # Default false. Set to true for daemon-owned after-build sync.

landing:
  action: pr                   # Required for stacking
```

PRD frontmatter fields control the stack topology:

- `stack_id` - logical stack name shared by all PRDs in the stack (optional; inferred from root PRD id)
- `stack_parent` - parent PRD id (optional for single-dependency PRDs; required for multi-dependency PRDs)

For single-dependency builds (`depends_on` has one entry), `stack_parent` is inferred automatically. For multi-dependency builds, set `stack_parent` explicitly to indicate the direct parent layer.

Set `stacking.sync.afterBuild: true` to have the daemon automatically sync the stack after each queued build reaches a terminal state. When active builds overlap the stack candidates, sync is `deferred` and the daemon retries automatically. Prefer this over `build.postMergeCommands: ["eforge stack sync"]` for automatic sync.

See [Stacked PRs](/docs/stacking) for the full guide including git-spice setup, stack sync, deferred retry, manual sync conflict recovery, automatic stacked PR landing conflict recovery, and branch-scoped stale-parent landing repair.

## Trunk Branch Policy

`build.trunkBranch` and `build.allowLocalMergeToTrunk` govern how eforge lands builds when you are on the project's trunk branch.

eforge detects the trunk automatically from `origin/HEAD` during `/eforge:init` and writes the result to `eforge/config.yaml`. Override `build.trunkBranch` if the detected value is wrong or the repository uses a non-standard default branch name.

```yaml
landing:
  action: merge                   # or 'pr' to open a pull request; 'leave' to skip both
build:
  trunkBranch: main               # detected from origin/HEAD; fallback: main
  allowLocalMergeToTrunk: false   # default: false; set to true for solo/unprotected projects
```

**What each option does:**

| Scenario | `allowLocalMergeToTrunk: false` (default) | `allowLocalMergeToTrunk: true` |
|---|---|---|
| On trunk, `landing.action: merge` | Rejected; CLI prompts to redirect | Merges directly to trunk |
| On trunk, `landing.action: pr` | PR from artifact branch to trunk | PR from artifact branch to trunk |
| On feature branch (either action) | Normal behavior, unaffected | Normal behavior, unaffected |

When `allowLocalMergeToTrunk` is `false` and you run interactively on trunk with `landing.action: merge`, the CLI prompts before enqueue and offers four alternatives: switch to `pr`, cancel, create or switch to a feature branch, or enable the solo-dev opt-in in `eforge/config.yaml`. With `--auto`, the engine rejects the build at runtime with a clear error message.

## Pre-Compile Trunk Sync

By default, eforge fetches the configured remote trunk before creating the merge worktree for a queued root build. This prevents stale-base builds when `origin/main` has advanced but the local branch has not been pulled.

```yaml
build:
  trunkSync:
    enabled: true             # default; set false for offline/local-only workflows
    remote: origin            # remote to fetch trunk from
    strategy: fetchedRemoteRef # only supported strategy in v1
    onDiverged: warn          # warn | fail | use-remote
```

**What it does:** before compile, eforge runs `git fetch --no-tags origin main` (using your configured remote and trunk branch), resolves the fetched commit SHA, and compares it to the local trunk. When the remote is ahead or equal, the fetched SHA is used as the compile base. When local and remote have diverged, the `onDiverged` policy applies.

**`onDiverged` options:**

| Value | Behavior |
|-------|----------|
| `warn` (default) | Emit a `config:warning` diagnostic and fall back to the local trunk as the compile base. |
| `fail` | Fail the build before compile begins. |
| `use-remote` | Use the fetched remote SHA with a diagnostic. |

**Fetch-unavailable fallback:** if the configured remote does not exist, the remote trunk branch is missing, the fetch fails, or FETCH_HEAD cannot be resolved, trunk sync is skipped. The build continues with the original candidate base and emits a `planning:progress` diagnostic. The `onDiverged` policy applies only to true local/remote divergence - not to network failures or unavailable remotes.

**Validation and failure before compile:** the `remote` value is validated before the fetch runs. It must be a registered git remote name: non-empty, must not start with `-`, must contain no whitespace or control characters, and must not be a URL (containing `://`) or path (starting with `/`, `./`, or `../`). The resolved trunk branch must also be a valid git branch refname. Invalid values fail the build before compile - they do not fall back to the fetch-unavailable behavior. Use `enabled: false` to skip trunk sync for offline or local-only workflows.

**What it does not do:** `trunkSync` only fetches and selects a base ref. It does not checkout, pull, reset, rebase, or move local branch refs or your working tree. Only FETCH_HEAD is updated as part of the fetch. Direct PR base sync is separate: direct non-stacked PR publication later fetches `origin/<baseBranch>`, rebases the artifact branch before validation, and runs a final pre-PR freshness guard.

**Scope:** only applies to queued root builds whose candidate base is the trunk branch. Child stacked PRDs use the parent artifact ref unchanged. Builds queued from a non-trunk feature branch are not retargeted. Direct PR base sync applies later only to direct non-stacked `landing.action: pr` publication, including non-trunk feature bases.

### Disabling trunk sync

For offline workflows or repositories without a remote:

```yaml
build:
  trunkSync:
    enabled: false
```

### Distinction from stack sync

`build.trunkSync` selects a fresh compile base before a build starts. It runs once, before the merge worktree is created, and does not affect the stack topology.

Direct PR base sync is a later mutating publication gate for direct non-stacked `landing.action: pr` builds. After all plans merge and before validation, eforge fetches `origin/<baseBranch>` and rebases the artifact branch onto that fetched base. Immediately before PR creation, eforge fetches the base again; if it advanced after validation, eforge performs a bounded resync plus command validation and PRD/acceptance validation retry before attempting the PR again. If the retry budget is exhausted or sync cannot complete, landing fails closed with `landing:skipped` rather than opening a stale PR.

Stacked PR landing remains delegated to git-spice restacking (`eforge stack sync`) and does not use direct PR base sync. Stack restacking updates the in-flight stack topology after trunk has been updated - a separate concern from selecting a fresh compile base before a build begins.

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

Available per-role fields: `tier`, `effort`, `thinking`, `maxTurns`, `allowedTools`, `disallowedTools`, `promptAppend`, `shards` (builder-only). Per-role overrides do not change the harness or model directly; move the role to a different tier with `tier` when one role should use a different tier recipe.

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

Hooks do not block the pipeline. See the [Hooks](/reference/config#hooks) section in the Configuration Reference for field details and the [Integrations](/docs/integrations#shell-hooks) page for examples.

## Full Reference

For the complete `eforge/config.yaml` schema with all fields, types, and defaults, see the [Configuration Reference](/reference/config).
