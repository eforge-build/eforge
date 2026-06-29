# Configuration

`eforge` is configured via `eforge/config.yaml` (searched upward from cwd), environment variables, and auto-discovered files.

## `eforge/config.yaml`

> **Upgrading from pre-overhaul `eforge.yaml`:** Earlier versions of eforge stored configuration at `eforge.yaml` in the project root. This path is no longer supported. If you have a legacy `eforge.yaml`, move it with:
> ```
> mkdir -p eforge && mv eforge.yaml eforge/config.yaml
> ```
> Running eforge without migrating now aborts with a clear `ConfigMigrationError`.

All fields are optional. The current engine compatibility fallback defaults are listed in [Built-in Tier Defaults](#built-in-tier-defaults); for new projects, create an explicit Pi profile or Pi tier entries like the example below:

```yaml
plugins:
  enabled: true               # Auto-discover Claude Code plugins
  # include:                  # Allowlist - only load these (plugin identifiers)
  # exclude:                  # Denylist - skip these from auto-discovery
  # paths:                    # Additional local plugin directories

extensions:
  enabled: true               # Discover and load native eforge extensions
  eventHookTimeoutMs: 5000    # Native onEvent and extension action timeout in ms (positive integer)
  agentContextHookTimeoutMs: 5000 # Optional onAgentRun handler timeout; defaults to eventHookTimeoutMs
  profileRouterTimeoutMs: 5000 # Optional registerProfileRouter timeout; defaults to eventHookTimeoutMs
  policyGateTimeoutMs: 5000 # Optional policy gate timeout; defaults to eventHookTimeoutMs
  validationProviderTimeoutMs: 5000 # Optional registerValidationProvider timeout; defaults to eventHookTimeoutMs
  policyGateFailurePolicy: fail-closed # fail-closed blocks on failures; fail-open allows after diagnostics
  # include:                  # Allowlist by native extension name
  # exclude:                  # Denylist by native extension name
  # paths:                    # Additional explicit extension files/directories

agents:
  maxTurns: 50                # Global fallback max agent turns before stopping
  maxContinuations: 3         # Max continuation attempts after maxTurns hit
  permissionMode: bypass      # 'bypass' or 'default'
  settingSources:             # Which Claude Code settings to load
    - project                 # Loads CLAUDE.md and project settings
  bare: false                 # Pass --bare to Claude Code subprocess (auto-true when ANTHROPIC_API_KEY set)
  # promptDir: eforge/prompts  # Directory of .md files that shadow bundled prompts by name match.
  #                            # If eforge/prompts/reviewer.md exists, it replaces the bundled reviewer prompt.
  # tiers:                    # Per-tier recipes — each tier is a self-contained harness + model + effort unit
  #   planning:               # Four built-in tiers: planning, implementation, review, evaluation
  #     harness: pi           #   harness: 'pi' (recommended) or 'claude-sdk' (supported secondary)
  #     model: anthropic/claude-opus-4-6 # model: plain string model identifier
  #     effort: high          #   effort: 'low', 'medium', 'high', 'xhigh', 'max'
  #     # thinking: true      #   Optional: enable thinking; coerced to adaptive for adaptive-only models
  #     pi:                   #   Pi-specific sub-block (required for harness: pi)
  #       provider: openrouter
  #     # claudeSdk:          #   Claude SDK-specific sub-block (ignored unless harness: claude-sdk)
  #     #   disableSubagents: true  # Default; set false to allow Claude Code subagents
  #   implementation:
  #     harness: pi
  #     model: anthropic/claude-sonnet-4-6
  #     effort: medium
  #     pi:
  #       provider: openrouter
  #   review:
  #     harness: pi
  #     model: anthropic/claude-opus-4-6
  #     effort: high
  #     pi:
  #       provider: openrouter
  #   evaluation:
  #     harness: pi
  #     model: anthropic/claude-opus-4-6
  #     effort: high
  #     pi:
  #       provider: openrouter
  # roles:                    # Per-agent role overrides
  #   formatter:              # Per-role options: tier, effort, thinking, maxTurns, promptAppend,
  #     effort: low           #   allowedTools, disallowedTools, shards (builder-only)
  #   builder:                # Available roles: planner, module-planner, builder, reviewer,
  #     effort: high          #  evaluator, plan-reviewer, plan-evaluator,
  #     maxTurns: 50          #   architecture-reviewer, architecture-evaluator,
  #   staleness-assessor:     #   cohesion-reviewer, cohesion-evaluator, validation-fixer,
  #     tier: planning        #   review-fixer, merge-conflict-resolver, staleness-assessor,
  #   reviewer:               #   formatter, doc-author, doc-syncer, test-writer, tester,
  #     promptAppend: |       #   prd-validator, dependency-detector, gap-closer,
  #       ## Project Rules    #   recovery-analyst, pipeline-composer
  #       - Flag raw SQL queries

maxConcurrentBuilds: 2        # Max concurrent PRD builds from the queue (default: 2)

build:
  maxValidationRetries: 2     # Fix attempts on validation failure (0 = no retries)
  cleanupPlanFiles: true      # Remove plan files and temporary plan-ID markers after successful build
  # trunkBranch: main         # Trunk branch name (default: detected from origin/HEAD, fallback: main)
  # allowLocalMergeToTrunk: false # Allow landing.action: merge to land directly on trunk without a PR
  #                           #   Default false; set to true only for solo/unprotected projects
  # trunkSync:                  # Pre-compile trunk freshness gate (queued root builds only)
  #   enabled: true             # Default true; set false for offline or local-only workflows
  #   remote: origin            # Remote to fetch trunk from (default: origin)
  #   strategy: fetchedRemoteRef # 'fetchedRemoteRef' is the only supported strategy in v1
  #   onDiverged: warn          # warn: diagnostic + fallback to local trunk (default)
  #                             # fail: fail the build before compile
  #                             # use-remote: use fetched SHA with a diagnostic
  # worktreeDir: /custom/path # Override worktree base directory
  # postMergeCommandTimeoutMs: 300000  # Per-command timeout (ms) for postMerge/validate commands (default: 300000, floor: 10000)
  # postMergeCommands:        # Extra validation commands
  #   - "pnpm type-check"
  #   - "pnpm test"
  # validation:               # Explicit validation waivers (each boolean requires a non-empty reason)
  #   allowNoCommands: false  # Allow builds with zero combined validation commands to pass instead of failing
  #   noCommandsReason: ""    # Required when allowNoCommands is true
  #   allowEmptyPrdDiff: false # Allow PRD validation to pass when the implementation diff is empty
  #   emptyPrdDiffReason: ""  # Required when allowEmptyPrdDiff is true
  #   allowNoAcceptanceCriteria: false # Allow builds with an empty canonical acceptance-criteria inventory to pass instead of failing
  #   noAcceptanceCriteriaReason: ""   # Required when allowNoAcceptanceCriteria is true
  #   allowNoCommittedChanges: false   # Allow builds that produce no committed changes to pass instead of failing
  #   noCommittedChangesReason: ""     # Required when allowNoCommittedChanges is true

compile:
  planningUnitParallelism: 2            # Context-managed compile planning unit concurrency
  planningUnitMaxDepth: 3               # Max recursive planning-unit split depth
  planningUnitMaxPromptSourceBytes: 40000
  planningUnitMaxPromptBytes: 80000
  planningUnitMaxObservedInputTokens: 120000
  # planningUnitMaxObservedTurns: 20    # Optional; unset by default
  planningUnitMaxCompactHandoffBytes: 12000
  planningUnitMaxLocalExplorationToolUses: 24
  planningUnitMaxCriteriaPerUnit: 20
  planningUnitMaxSubsystemsPerUnit: 2
  planningUnitMaxSplitAttemptsPerUnit: 2

# Landing action
# landing:
#   action: pr                # pr | merge | leave (default: merge)
#                             #   pr: open a PR from the artifact branch targeting the resolved base branch
#                             #       (current base branch for non-stacked builds; parent artifact branch for stacked builds unless stale-parent repair lands against trunk)
#                             #       Direct non-stacked PRs fetch and rebase onto origin/<baseBranch> before validation,
#                             #       then run a final pre-PR freshness guard immediately before PR creation.
#                             #       Stacked PR landing uses provider repo sync, branch restack,
#                             #       and a remote-base freshness proof before PR submission.
#                             #       requires gh CLI
#                             #   merge: auto-merge the artifact branch into the base branch
#                             #   leave: commit to artifact branch and exit without merging or opening a PR
#   pr:
#     autoMerge: ask          # ask (default) | always | never
#                             #   Only applies when landing.action: pr
#                             #   ask: enable GitHub PR auto-merge only when landingAutoMerge is explicitly true per-run
#                             #   always: enable auto-merge on every PR unless landingAutoMerge is explicitly false per-run
#                             #   never: never enable auto-merge (emits skipped event)
#                             #   Note: distinct from landing.action: merge (which merges without opening a PR)
#
# Migration from build.onSuccess:
#   The old 'build.onSuccess' key and the legacy full-string values
#   ('issue-pr', 'merge-to-base-branch', 'leave-branch') are both rejected
#   at config validation with migration guidance. Use 'landing.action' with
#   the short values: 'pr', 'merge', or 'leave'.

# Stacking (git-spice backed stacked PRs)
# stacking:
#   enabled: false            # Default false. Set to true to enable git-spice stacking.
#                             # When enabled, artifact branch PRs target the parent artifact branch
#                             # instead of the trunk, forming a linear stack. During landing,
#                             # eforge can repair a missing integrated parent by using trunk
#                             # as the effective base for initially untracked children or by
#                             # retargeting a child that is already tracked, then gates PR submission
#                             # on provider sync/restack and a remote-base freshness proof.
#                             # git-spice must be installed; see docs/stacking.md for setup.
#   provider: git-spice       # Only "git-spice" is supported in v1.
#   gitSpice:
#     command: git-spice      # Optional path to git-spice binary (default: "git-spice" on PATH).
#                             # Set to "gs" if you use the short alias.
#   sync:
#     afterBuild: false       # Default false. Set to true to enable daemon-owned after-build sync.
#                             # When true, the daemon triggers stack sync after each build lands,
#                             # with automatic deferred retry when active builds overlap the stack.
#                             # Prefer this over build.postMergeCommands: ["eforge stack sync"].
#
# Stack frontmatter in PRD files (set automatically or via /eforge:build):
#   stack_id: <logical-stack-name>   # Shared name for all PRDs in the same stack. Optional;
#                                    # defaults to the root PRD id if omitted.
#   stack_parent: <parent-prd-id>    # Parent PRD whose artifact branch this PRD targets. Optional
#                                    # for single-dependency PRDs (inferred from depends_on); required
#                                    # when a PRD has multiple depends_on entries, and must be listed
#                                    # in depends_on when stacking is enabled.
#
# See docs/stacking.md for the full stacking guide.

plan:
  outputDir: eforge/plans     # Where plan artifacts are written

prdQueue:
  dir: .eforge/queue          # Where queued PRDs are stored (gitignored — runtime state)
  autoBuild: true             # Desired auto-build state; scheduler pause can still gate launches
  watchPollIntervalMs: 5000   # Poll interval for watch mode (ms)
  # Explicit build dependency (per-enqueue, not a config key):
  #   Pass --after <queue-id> to the CLI or afterQueueId to the eforge_build tool
  #   to create a deterministic dependency on an active or completed queue entry.
  #   Active upstream items (pending/running/waiting) are held in .eforge/queue/waiting/
  #   and unblocked when the upstream completes. Completed upstream items with a usable
  #   artifact are enqueued immediately as eligible dependents. Explicit afterQueueId
  #   takes precedence over automatic dependency detection (which remains best effort).

daemon:
  idleShutdownMs: 7200000     # Idle timeout before auto-shutdown (2 hours). Set to 0 to disable.

monitor:
  retentionCount: 20          # Number of recent builds to retain in the monitor DB (oldest pruned)
```

Each command in `postMergeCommands`, queued PRD `postMerge` metadata, and the planner-generated validate commands runs under a wall-clock timeout. On expiry the full subprocess tree is killed and the validation-fixer loop is invoked as if the command had exited non-zero. Default 300000 ms (5 minutes). Values below 10000 ms are clamped and emit a `config:warning` event.

## Compile planning limits

The top-level `compile` block controls budgets for context-managed planning when overflow-risk compile inputs receive a bounded-decomposition recommendation. These limits do not change normal direct planning; they only bound decomposition into planning units for that context-managed path.

All numeric values must be positive integers. `planningUnitMaxObservedTurns` is optional and omitted by default.

| Field | Default | Description |
|-------|---------|-------------|
| `compile.planningUnitParallelism` | `2` | Maximum number of planning units that may run at the same time. |
| `compile.planningUnitMaxDepth` | `3` | Maximum recursive split depth for planning units. |
| `compile.planningUnitMaxPromptSourceBytes` | `40000` | Maximum source bytes assigned to one planning-unit prompt. |
| `compile.planningUnitMaxPromptBytes` | `80000` | Maximum total prompt bytes for one planning unit. |
| `compile.planningUnitMaxObservedInputTokens` | `120000` | Maximum observed input tokens before the unit is considered over budget. |
| `compile.planningUnitMaxObservedTurns` | unset | Optional maximum observed agent turns for one planning unit. |
| `compile.planningUnitMaxCompactHandoffBytes` | `12000` | Maximum compact handoff size emitted between planning units. |
| `compile.planningUnitMaxLocalExplorationToolUses` | `24` | Maximum local exploration tool uses per planning unit. |
| `compile.planningUnitMaxCriteriaPerUnit` | `20` | Maximum acceptance criteria assigned to one planning unit. |
| `compile.planningUnitMaxSubsystemsPerUnit` | `2` | Maximum subsystem hints assigned to one planning unit. |
| `compile.planningUnitMaxSplitAttemptsPerUnit` | `2` | Maximum split attempts for one planning unit before exhaustion. |

## Workflow Presets

Workflow presets are shortcut configurations that bundle common landing action, stacking, and PR settings into a named preset. Use `/eforge:workflow` (Claude Code) or `/eforge:workflow` (Pi) to configure a preset through a guided wizard instead of editing `eforge/config.yaml` manually.

In Pi, the workflow wizard uses native select-overlay panels. In Claude Code, the same preset logic and config keys are applied through a conversational Q&A flow.

The wizard asks four questions - solo vs team, direct merge vs PR, stacked PRs, and automatic stack sync - and maps the answers to one of five presets:

| Preset | When selected | Config keys written |
|--------|--------------|---------------------|
| `solo-merge` | Solo developer, direct merge to trunk | `landing.action: merge`, `build.allowLocalMergeToTrunk: true`, `stacking.enabled: false` |
| `solo-pr` | Solo developer, PR workflow, no stacking | `landing.action: pr`, `landing.pr.autoMerge: always`, `stacking.enabled: false` |
| `team-pr` | Team project, PR workflow, no stacking | `landing.action: pr`, `landing.pr.autoMerge: ask`, `stacking.enabled: false` |
| `stacked-pr` | git-spice stacking, manual sync | `landing.action: pr`, `stacking.enabled: true` |
| `stacked-pr-autosync` | git-spice stacking, daemon-owned after-build sync | `landing.action: pr`, `stacking.enabled: true`, `stacking.sync.afterBuild: true` |

For stacking presets where the user provides a non-default git-spice path, `stacking.gitSpice.command` is also written.

Run `/eforge:workflow --reconfigure` (Claude Code) or `/eforge:workflow:reconfigure` (Pi) at any time to re-run the wizard and change the preset.

## Trunk branch policy

`build.trunkBranch` names the project's trunk. eforge detects it automatically from `origin/HEAD` during `eforge init` and writes the result to `eforge/config.yaml`. Override it here if detection is wrong or the repository uses a non-standard default branch name.

`build.allowLocalMergeToTrunk` controls whether `landing.action: merge` is permitted to land directly on trunk without opening a pull request. The default is `false`, which is appropriate for team projects with branch protection rules. Set to `true` only for solo projects or repositories where direct trunk commits are acceptable.

When `allowLocalMergeToTrunk` is `false` and the current branch is trunk, the interactive CLI prompts before enqueue and offers four alternatives: switch to `pr`, cancel, create a feature branch, or enable the solo-dev opt-in. With `--auto`, the engine rejects the build at runtime with a clear error message rather than prompting.

## Pre-compile trunk sync

Before creating the merge worktree for a queued root build, eforge fetches the configured remote trunk and uses the fetched commit SHA as the compile base instead of the local trunk ref. This prevents stale-base builds when `origin/main` has advanced but the local branch has not been pulled.

Child stacked PRDs continue using the parent artifact ref from the stack context and are not affected by this gate. Direct non-stacked `landing.action: pr` builds have an additional later gate: direct PR base sync fetches `origin/<baseBranch>`, rebases the artifact branch onto that fetched base before validation, and checks freshness again immediately before opening the PR.

### `build.trunkSync`

```yaml
build:
  trunkSync:
    enabled: true             # Default. Set to false for offline or local-only workflows.
    remote: origin            # Remote to fetch trunk from (default: origin).
    strategy: fetchedRemoteRef # Only 'fetchedRemoteRef' is supported in v1.
    onDiverged: warn          # Divergence policy when local and remote have diverged.
```

| Field | Default | Description |
|-------|---------|-------------|
| `build.trunkSync.enabled` | `true` | Enables the pre-compile fetch. Set to `false` for offline or local-only workflows. |
| `build.trunkSync.remote` | `'origin'` | Remote name to fetch the trunk branch from. Must be a configured git remote name - not a URL or path. Must be non-empty, must not start with `-`, and must contain no whitespace or control characters. Invalid values fail the build before compile rather than falling back to the fetch-unavailable behavior. |
| `build.trunkSync.strategy` | `'fetchedRemoteRef'` | Base selection strategy. Only `'fetchedRemoteRef'` is supported in v1. |
| `build.trunkSync.onDiverged` | `'warn'` | Policy when local trunk and remote trunk have diverged (neither is an ancestor of the other). |

**`onDiverged` values:**

| Value | Behavior |
|-------|----------|
| `warn` (default) | Emit a `config:warning` diagnostic and fall back to the local trunk ref as the compile base. |
| `fail` | Fail the build before compile with a `plan:error:set` event. |
| `use-remote` | Use the fetched remote SHA as the compile base and emit a diagnostic. |

**Remote-ahead and equal cases** always use the fetched remote SHA, regardless of `onDiverged`.

**Local-ahead-only** cases (local trunk has commits the remote does not yet have) emit a diagnostic and use the local trunk ref, since the local trunk is not stale relative to the remote.

**Feature-branch builds** (queued from a non-trunk branch) and **child stacked PRDs** are never retargeted to remote trunk by `trunkSync`. `trunkSync` only applies to queued root builds whose candidate base is the trunk branch. Direct PR base sync is separate: direct non-stacked PR publication targets the resolved base branch, including non-trunk feature bases, and syncs against `origin/<baseBranch>` later in the build.

**Fetch-unavailable fallback:** when the configured remote is missing, the remote trunk branch does not exist on the remote, the fetch fails for any reason, or FETCH_HEAD cannot be resolved after the fetch, trunk sync is skipped. The build continues with the original candidate base and emits a `planning:progress` diagnostic. The `onDiverged` policy applies only to true local/remote divergence - not to network failures or unavailable remotes.

**Validation and failure before compile:** `build.trunkSync.remote` is validated before the fetch. The value must be a registered git remote name: non-empty, must not start with `-`, must contain no whitespace or control characters, and must not be a URL (containing `://`) or path (starting with `/`, `./`, or `../`). The resolved trunk branch must also be a valid git branch refname. Invalid values cause the build to fail before compile with an error - they do not fall back to the fetch-unavailable behavior. Use `build.trunkSync.enabled: false` to skip trunk sync entirely for offline or local-only workflows.

### Relationship to stack sync and post-merge commands

`build.trunkSync` is a pre-compile freshness gate. It fetches the remote trunk and selects a fresh base before the merge worktree is created. It does not checkout, pull, reset, rebase, or move local branch refs or the working tree — only FETCH_HEAD is updated as part of the fetch.

Direct PR base sync is a later mutating publication gate for direct non-stacked `landing.action: pr` builds. After all plans merge and before validation, eforge fetches `origin/<baseBranch>` and rebases the artifact branch onto that fetched base. Immediately before PR creation, eforge fetches the base again; if it advanced after validation, eforge performs a bounded resync plus command validation and PRD/acceptance validation retry before attempting the PR again. If the retry budget is exhausted or sync cannot complete, landing fails closed with `landing:skipped` rather than opening a stale PR.

`build.postMergeCommands` runs after all plans merge and handles validation (type-check, tests, etc.). Queued PRD `postMerge` metadata is appended after the configured commands for that build. These settings are independent.

Stacked PR landing does not use the direct non-stacked PR base sync path. Instead, it stays behind the stack provider boundary: eforge runs provider repo sync, branch restack, and a remote-base freshness proof for the branch being submitted. Manual `eforge stack sync` remains the separate whole-stack maintenance path after trunk or parent branches move.

## Validation waivers

By default, build success requires both command validation (type-check, tests, etc.) and acceptance validation evidence from the PRD validator. Either requirement can be explicitly waived via `build.validation` with a mandatory reason string.

**Waivers are policy overrides, not evidence.** A waiver declares that the build is intentionally exempt from a specific validation requirement in a known context — for example, a config-only change with no source diff, or a monorepo where tests run in CI rather than per-PRD. The reason string is surfaced in Console so reviewers can confirm intent. Waivers do not replace the missing evidence; they record that the evidence is not applicable for this build.

### `build.validation.allowNoCommands`

When all plans merge and the combined set of planner-generated `validateCommands`, configured `postMergeCommands`, and queued PRD `postMerge` commands is empty, the build fails with `validation:complete passed:false`. Set `allowNoCommands: true` with a non-empty `noCommandsReason` to allow such builds to pass:

```yaml
build:
  validation:
    allowNoCommands: true
    noCommandsReason: "Shared monorepo — type checking and tests run in CI, not per-PRD"
```

The waiver reason is surfaced as a `planning:progress` event and in Console before `validation:complete passed:true` is emitted.

### `build.validation.allowEmptyPrdDiff`

When the implementation diff computed for PRD validation is empty (no changes detected relative to the base branch), the build fails with `prd_validation:complete passed:false`. This covers the scenario where the build produced zero diff visible to the PRD validator — the validator cannot confirm that any acceptance criterion was addressed when there is nothing to inspect.

Set `allowEmptyPrdDiff: true` with a non-empty `emptyPrdDiffReason` to allow such builds to pass:

```yaml
build:
  validation:
    allowEmptyPrdDiff: true
    emptyPrdDiffReason: "Config-only change — no source file diff is expected"
```

### `build.validation.allowNoAcceptanceCriteria`

Queued PRD builds use the canonical acceptance-criteria inventory extracted and persisted at enqueue. If the hidden inventory block is missing, duplicated, or malformed, the build fails before orchestration and the PRD must be re-enqueued. When the persisted inventory is valid but empty, the build fails with `acceptance_validation:complete passed:false` because the PRD validator cannot produce meaningful per-criterion verdicts against an empty inventory.

Set `allowNoAcceptanceCriteria: true` with a non-empty `noAcceptanceCriteriaReason` to allow such builds to pass:

```yaml
build:
  validation:
    allowNoAcceptanceCriteria: true
    noAcceptanceCriteriaReason: "Exploratory build — acceptance criteria defined post-hoc"
```

### `build.validation.allowNoCommittedChanges`

When a `builtOnMerge` plan produces no committed file changes relative to `baseSha`, the build fails during merge. The implementation was expected to produce at least one commit.

Set `allowNoCommittedChanges: true` with a non-empty `noCommittedChangesReason` to allow such builds to pass:

```yaml
build:
  validation:
    allowNoCommittedChanges: true
    noCommittedChangesReason: "Config-only change recorded in parent PR"
```

### Reason string requirement

All waiver booleans require a non-empty reason string. A config that sets any waiver boolean to `true` without the corresponding reason field (or sets it to an empty or whitespace-only string) is rejected by config validation at startup. This applies to all four waivers: `allowNoCommands`/`noCommandsReason`, `allowEmptyPrdDiff`/`emptyPrdDiffReason`, `allowNoAcceptanceCriteria`/`noAcceptanceCriteriaReason`, and `allowNoCommittedChanges`/`noCommittedChangesReason`.

## PRD provenance

When the daemon dispatches a PRD from `.eforge/queue/`, it writes a canonical copy to `eforge/prds/{prdId}.md` as a provenance record. Unlike queue state (`.eforge/queue/` — gitignored), `eforge/prds/` files are committed artifacts that link each build session to its originating requirements and survive queue cleanup. Queue PRDs include a hidden canonical acceptance-criteria inventory used for validation IDs; that hidden block is stripped from the committed provenance prose. These files are written by the engine at dispatch time and committed to the artifact branch.

When `build.cleanupPlanFiles: true` (the default), the engine removes plan artifacts — including the PRD copy in `eforge/prds/`, the compiled plan files in `eforge/plans/{planSet}/`, and `orchestration.yaml` — from `HEAD` during the `pr` or `merge` landing flows after a successful build. Cleanup also strips temporary plan-ID eforge region marker comment lines from tracked JavaScript/TypeScript-family source files, preserving durable semantic markers and all code between marker lines. These artifacts are **not** permanently lost: cleanup only removes them from the final tree. When the artifact branch is landed with a merge commit (eforge's local `merge` action, or a GitHub PR merged via "Create a merge commit"), the full intermediate history — including the commits that added these artifacts — remains reachable from the base branch. `landing.action: leave` does not run this cleanup path and leaves the artifact branch in place for manual inspection. When `landing.action: pr` is used, provenance durability depends on the repository's chosen merge strategy: squash or rebase merges can collapse intermediate commits and make artifact references unreachable.

> **Note:** Build provenance depends on Git history, not the final tree. Squash or rebase landing strategies (applied after the PR is opened, e.g. via GitHub's "Squash and merge") can collapse or discard intermediate commits, potentially making artifact recovery references unreachable. Use merge commits when preserving eforge provenance history is important to your team.

## Native extensions

Configuration is split between core build/daemon/profile settings and optional producer surfaces. The build-engine kernel consumes normalized build source; native extensions, the first-party `eforge-playbooks` extension, and session-plan compatibility tools can prepare, route, or govern that source before enqueue without becoming kernel capabilities.

The top-level `extensions` block controls native eforge TypeScript/JavaScript extension discovery, loader-time registration capture, native hook timeout behavior, and runtime agent-run augmentation. See [extensions.md](extensions.md) for discovery, trust, diagnostics, and runtime support.

```yaml
extensions:
  enabled: true
  eventHookTimeoutMs: 5000
  agentContextHookTimeoutMs: 5000
  profileRouterTimeoutMs: 5000
  policyGateTimeoutMs: 5000
  validationProviderTimeoutMs: 5000
  policyGateFailurePolicy: fail-closed
  include:
    - build-notifier
  exclude:
    - experimental-policy
  paths:
    - ./tools/eforge-audit.ts
```

| Field | Default | Description |
|-------|---------|-------------|
| `extensions.enabled` | `true` | Enables native extension loading at runtime. When `false`, extension directories and explicit paths are not loaded; management commands may still report discovered candidates with `enabled: false` for visibility. |
| `extensions.include` | unset | Optional allowlist for auto-discovered extension names. Only listed names are considered. |
| `extensions.eventHookTimeoutMs` | `5000` | Timeout in milliseconds for each native `onEvent` handler invocation and extension-authored action invocation. Must be a positive integer. |
| `extensions.agentContextHookTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each `onAgentRun` handler invocation. Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.profileRouterTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each `registerProfileRouter` handler invocation. Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.policyGateTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each policy-gate handler invocation. Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.validationProviderTimeoutMs` | inherits `eventHookTimeoutMs` | Timeout in milliseconds for each `registerValidationProvider` handler invocation (function form) or command (commands form). Must be a positive integer when set. Defaults to `extensions.eventHookTimeoutMs` when omitted. |
| `extensions.policyGateFailurePolicy` | `fail-closed` | Failure policy for thrown, timed-out, or invalid policy gates. Valid values: `fail-closed` blocks the gated operation; `fail-open` records diagnostics and allows it to continue. |
| `extensions.exclude` | unset | Optional denylist for auto-discovered extension names. Applied after `include`. |
| `extensions.paths` | unset | Explicit extension files or directories to validate/load in addition to auto-discovery. Relative paths resolve from the project root. |

Extension action handlers use `extensions.eventHookTimeoutMs`; `agentContextHookTimeoutMs`, `profileRouterTimeoutMs`, `policyGateTimeoutMs`, and `validationProviderTimeoutMs` remain scoped to their existing registration families.

Auto-discovery scans `~/.config/eforge/extensions/`, `eforge/extensions/`, and `.eforge/extensions/` with precedence `project-local > project-team > user`. Supported entrypoints are `.ts`, `.mts`, `.js`, and `.mjs` files or directories with `index.*` / supported `package.json` entrypoints. TypeScript entrypoints load through `jiti`; JavaScript entrypoints use dynamic import.

Project/team extensions are committed code and require a per-extension local trust record in `.eforge/extension-trust.json` — created by `eforge extension trust <name>` after inspecting the code — before loading. Any code change to the extension invalidates the stored hash and blocks the extension until re-trusted. The content hash covers the entrypoint for file-layout extensions and, for directory-layout extensions, `package.json` plus `.ts`, `.mts`, `.js`, and `.mjs` files under the extension directory (excluding top-level `node_modules/`, `dist/`, and `.git/`). It also covers every regular file under `workstation-assets/`, including nested `dist/`, `node_modules/`, or `.git/` directories there, so trusted workstation bundle assets are covered. Files imported from outside the extension directory — and non-source/data files outside `workstation-assets/` — are not covered. Extensions execute in the eforge daemon/worker Node process without a sandbox.

Current runtime support includes discovery, trust gating, loading, diagnostics, provenance output, registration capture for runtime-wired families, native `onEvent` dispatch and replay testing, `onAgentRun` prompt-context augmentation, per-run extension tool injection, per-run tool availability tuning, pre-build `registerProfileRouter` dispatch, runtime policy gates for `beforeQueueDispatch`, `beforePlanMerge`, and `beforeFinalMerge`, `registerInputSource` enqueue preprocessing, `registerPrdEnricher` content enrichment, `registerReviewerPerspective` parallel review-cycle dispatch, `registerValidationProvider` per-plan `validate`-stage execution, engine-side extension action/contribution/workstation registry support, safe manifest projection for `registerAgentTask` prompt-backed task contributions, Console System rendering for declarative contributions, sandboxed Console workstation rendering from `srcDoc` or daemon-owned `frameBundle` frame/asset URLs, host discovery/detail/invocation for actions, integration commands, and action-backed deep links, daemon-owned `ctx.agentTasks` dispatch for supported single-shot read-only planner tasks, daemon-owned `ctx.buildQueue.enqueue` dispatch for trusted queue handoffs, and management commands (`eforge extension list/show/validate/test/new/reload/trust/untrust/install/update/remove/promote/demote`). Package-managed extensions installed via `eforge extension install` carry nested `package.*` and `install.*` provenance fields such as `install.sourceKind`, `install.sourceSpec`, and `install.installedAt`; install sidecar files are excluded from the trust hash. `registerTool` records loader-time provenance; `onAgentRun({ tools: [...] })` is the per-run injection path. The first-party `eforge-playbooks` extension exposes playbook actions through the native extension contribution model and owns parser/storage/compiler/seed behavior locally; domain-neutral acceptance-criteria helpers and session-planning helpers remain separate from that playbook extension boundary. These are not user-authored native workflow registration points. Agent task contribution starts execute for registered planner-compatible task contributions; unsupported or non-compatible contribution starts fail without prompt-path fallback. `beforeEnqueue`, `beforeValidation`, approval workflow/state/UI, `modify` decisions, raw extension-owned HTTP routes, arbitrary frontend plugin bundles outside registered workstation iframes, direct React loading into the parent Console, private Console imports, extension-owned AI planning/chat APIs outside `ctx.agentTasks`, caller-supplied arbitrary raw prompt templates, multi-turn chat, and user-authored workflow registration for custom session-plan or playbook extraction are separate, deferred, or unsupported runtime phases.

## Tiers

eforge uses four tiers as the single configuration axis for agent routing. Each tier is a self-contained recipe: `harness + model + effort`, with optional harness-specific sub-blocks.

### Built-in Tier Defaults

| Tier | Default harness | Default model | Default effort | Default max turns |
|------|-----------------|---------------|----------------|-------------------|
| `planning` | `claude-sdk` | `claude-opus-4-7` | `high` | `80` |
| `implementation` | `claude-sdk` | `claude-sonnet-4-6` | `medium` | `80` |
| `review` | `claude-sdk` | `claude-opus-4-7` | `high` | `60` |
| `evaluation` | `claude-sdk` | `claude-opus-4-7` | `high` | `50` |

Override any tier by specifying it under `agents.tiers` in `eforge/config.yaml`. The table above is the current engine compatibility fallback, not the recommended new-user setup. Pi is the recommended execution harness for new projects; if you want a Pi profile, list all four tiers explicitly because unspecified tiers keep the `claude-sdk` compatibility defaults.

### Complete Tier Recipe

Each tier supports the following fields:

```yaml
agents:
  tiers:
    planning:
      harness: pi               # Required: 'pi' (recommended) or 'claude-sdk'
      model: anthropic/claude-opus-4-6 # Required: plain string model identifier
      effort: high             # Required: 'low', 'medium', 'high', 'xhigh', 'max'
      thinking: true           # Optional: enable thinking; coerced to adaptive for adaptive-only models
      maxTurns: 80             # Optional: max turns override for all roles in this tier
      toolbelt: browser-ui     # Optional: named toolbelt from tools.toolbelts, or 'none' to pass no MCP servers
                               #   Omitting toolbelt (default) passes all discovered .mcp.json servers.
                               #   'none' passes no project MCP servers (engine-internal tools are unaffected).
                               #   Named toolbelt passes only the servers declared in tools.toolbelts.<name>.
      pi:                      # Optional: Pi-specific config (ignored unless harness: pi)
        provider: openrouter   # Provider name (openrouter, google, openai, etc.)
        # thinkingLevel: xhigh # Pi only: 'off', 'low', 'medium', 'high', 'xhigh'
        # resources: isolated  # 'isolated' (default) or 'ambient' — see Headless resource isolation below
      claudeSdk:               # Optional: Claude SDK-specific config (ignored unless harness: claude-sdk)
        disableSubagents: true  # Default: prevent agents in this tier from spawning subagents
```

### Pi Backend Tiers

Pi is the recommended provider-flexible backend for new eforge setup. To use it for a tier, set `harness: pi` and provide a `pi.provider`:

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

The Pi backend uses file-backed auth storage (`~/.pi/agent/auth.json`) which supports API keys, environment variables, and OAuth tokens automatically.

**Pi Authentication** resolves credentials in this order:

1. **Environment variables** - Provider-specific env vars (e.g. `OPENROUTER_API_KEY`, `OPENAI_API_KEY`)
2. **Auth file** - `~/.pi/agent/auth.json` - supports both API keys and OAuth tokens

**OAuth Providers** (like `openai-codex` and `github-copilot`) use OAuth for authentication:

1. Run `pi auth login <provider>` to authenticate (writes tokens to `~/.pi/agent/auth.json`)
2. Set the provider on the tier - e.g. `pi.provider: openai-codex` - and use a plain model id (e.g. `codex-mini`)
3. No API key or environment variable is needed - tokens are read from the auth file automatically

### Headless resource isolation

By default, eforge Pi agent sessions run in **isolated mode**: ambient Pi resources - project-local, user-global, and globally-installed Pi extensions, skills, prompts, and themes - are suppressed. This is a deterministic default that prevents interactive or TUI-oriented Pi extensions from interfering with headless agent execution.

**What is suppressed (isolated mode):**

- Pi extensions discovered from `.pi/extensions/`, `~/.pi/extensions/`, and installed pi-packages
- Pi skills, prompts, and themes from all ambient sources

**What is always preserved (both modes):**

- eforge custom tools (including `submit_plan_set` and other engine-internal tools)
- Bridged MCP tools from `tools.toolbelts` or `.mcp.json` discovery
- The `@eforge-build/pi-eforge` recursion filter - eforge's own Pi integration is always excluded to prevent recursive builds

#### Opting in to ambient resources

Set `pi.resources: 'ambient'` on a tier to restore full ambient Pi resource loading:

```yaml
agents:
  tiers:
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
        resources: ambient   # Load ambient Pi extensions, skills, prompts, themes
```

> **Risk note:** Ambient mode allows project-local Pi extensions to load inside eforge agent sessions. Extensions that touch `ctx.ui.theme` or other TUI/interactive-only state will crash in headless SDK execution with `Theme not initialized. Call initTheme() first.` - the engine surfaces this as an `error_pi_tool_infrastructure` build failure (see below). Any extension loaded under ambient mode must guard TUI state access to function correctly in a non-interactive context.

#### `agents.bare` invariant

When `agents.bare: true` is set, the resolved resource mode is always `'isolated'`, regardless of the per-tier `pi.resources` setting. `bare` represents maximum isolation; it is never weaker than the default.

```yaml
agents:
  bare: true   # Forces resources: isolated on all Pi tiers, even if pi.resources: ambient is declared
```

#### `error_pi_tool_infrastructure` failures

When an ambient Pi extension throws a tool-call infrastructure error (such as `Theme not initialized. Call initTheme() first.`) during an agent run, eforge classifies the failure as a typed `AgentTerminalError` with subtype `error_pi_tool_infrastructure`. The build stops with a clear infrastructure failure message rather than silently producing a compile failure from the model having received error text in its tool results.

**Remediation:** check which project-local Pi extensions are active in the failing session. Either:

- Switch to the default `pi.resources: 'isolated'` (no ambient Pi extensions load)
- Or update the offending extension to guard TUI state access before touching `ctx.ui.theme` and similar APIs that require interactive initialization

### Claude SDK Tiers

The `claude-sdk` harness remains supported as an Anthropic-specific secondary path. Starting June 15, 2026, Anthropic says Claude Agent SDK and `claude -p` usage no longer count toward Claude plan limits; eligible plans may receive a separate monthly Agent SDK credit, usage beyond that credit is billed at standard API rates when extra usage is enabled, otherwise requests stop, and API-key users remain pay-as-you-go.

The `claudeSdk:` sub-block on a tier holds options specific to the Claude SDK harness:

- **`disableSubagents`** defaults to `true`. When enabled, eforge appends `'Task'` to every agent run's `disallowedTools` for all roles in that tier, preventing agents from spawning Claude Code subagents. Set `disableSubagents: false` only when you intentionally want Claude Code subagents available.

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

Per-role `agents.roles.<role>.disallowedTools` values are preserved; when subagents are disabled, `'Task'` is appended (de-duplicated).

## Model References

Model references are **plain strings**, not objects. Examples:

- `anthropic/claude-opus-4-6` - Pi / OpenRouter model identifier (provider prefix + model name)
- `gemini-flash` - Pi / Google provider model identifier
- `claude-opus-4-7` - Claude SDK model identifier
- `claude-sonnet-4-6`

Specify the model directly on the tier recipe:

```yaml
agents:
  tiers:
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
```

> **Migration note:** The old object form (`model: { id: claude-sonnet-4-6 }`) is no longer valid. Use plain strings. The `provider:` field that used to live on model refs now lives on the tier's `pi.provider`. See [config-migration.md](config-migration.md) for worked examples.

## Role-to-Tier Assignment

Every agent role has a built-in default tier. Most projects never need to change these defaults.

### Built-in Tier Assignments

| Role | Default Tier | Description |
|------|-------------|-------------|
| `planner` | `planning` | Orchestration and composition |
| `module-planner` | `planning` | Module-level planning |
| `formatter` | `planning` | PRD formatting |
| `pipeline-composer` | `planning` | Pipeline composition |
| `merge-conflict-resolver` | `planning` | Merge conflict resolution |
| `doc-author` | `implementation` | Plan-driven doc authoring |
| `doc-syncer` | `implementation` | Diff-driven doc sync |
| `gap-closer` | `planning` | Gap analysis and filling |
| `builder` | `implementation` | Code writing |
| `review-fixer` | `implementation` | Applies reviewer feedback |
| `validation-fixer` | `implementation` | Applies validation feedback |
| `test-writer` | `implementation` | Test authoring |
| `tester` | `implementation` | Test execution and analysis |
| `recovery-analyst` | `implementation` | Build failure diagnosis |
| `dependency-detector` | `implementation` | Dependency analysis |
| `prd-validator` | `implementation` | PRD validation and per-criterion acceptance verdicts |
| `staleness-assessor` | `implementation` | Staleness detection |
| `reviewer` | `review` | Code and design review |
| `architecture-reviewer` | `review` | Architecture review |
| `cohesion-reviewer` | `review` | Cross-module cohesion review |
| `plan-reviewer` | `review` | Plan review |
| `evaluator` | `evaluation` | Build acceptance verdict |
| `architecture-evaluator` | `evaluation` | Architecture acceptance verdict |
| `cohesion-evaluator` | `evaluation` | Cohesion acceptance verdict |
| `plan-evaluator` | `evaluation` | Plan acceptance verdict |

### Overriding Role-to-Tier Assignment

Use `agents.roles[role].tier:` to reassign a role to a different tier. The role then inherits all settings from the target tier (harness, model, effort, provider, etc.):

```yaml
agents:
  roles:
    # Move staleness-assessor from 'implementation' to a lighter tier config
    staleness-assessor:
      tier: implementation    # keep in implementation (default), or reassign
    # Move reviewer to implementation tier (lighter model, less effort)
    reviewer:
      tier: implementation
```

## Per-Role Field Overrides

Per-role overrides let you tune individual fields without reassigning the role to a different tier. The role stays in its natural tier but the specified fields take precedence over the tier recipe:

```yaml
agents:
  roles:
    builder:
      effort: high          # Override effort for this role only
      maxTurns: 80          # Override maxTurns for this role only
    formatter:
      effort: low           # Formatter only needs low effort
    reviewer:
      promptAppend: |           # Append project-specific rules to this role's prompt
        ## Project Rules
        - Flag raw SQL queries
    staleness-assessor:
      tier: planning            # Move staleness-assessor to a heavier-weight tier
```

Available per-role override fields: `tier`, `effort`, `thinking`, `maxTurns`, `allowedTools`, `disallowedTools`, `promptAppend`, `shards` (builder-only).

## Workflow Profiles

Workflow profile selection (`errand`, `excursion`, or `expedition`) is determined per-build by the `pipeline-composer` agent, which classifies the incoming PRD by complexity and selects the appropriate compile pipeline. Custom YAML profiles with `extends:` / `compile:` keys are not configurable in `eforge/config.yaml` - the schema rejects a top-level `profiles:` key.

## Backend Profiles

Agent runtime profiles are named YAML files that bundle tier recipes (harness, model, effort, provider) into a reusable unit. Profiles can be defined at project scope or user scope.

### User-Scoped Profiles

User-scoped profiles live at `~/.config/eforge/profiles/<name>.yaml` (respects `$XDG_CONFIG_HOME`). They are not committed to the project repository and are reusable across all projects on the machine.

The user-scope active-profile marker lives at `~/.config/eforge/.active-profile`.

### Active Profile Precedence

Profile resolution uses `@eforge-build/scopes` named-set resolution. The precedence chain below is the user-visible expression of that resolution.

The active agent runtime profile is resolved using a precedence chain (highest to lowest):

1. **Project-local marker** - `.eforge/.active-profile` file in the repo root (gitignored)
2. **Project marker** - `eforge/.active-profile` file in the project
3. **User marker** - `~/.config/eforge/.active-profile` file
4. **None** - no profile configured; engine defaults apply

When a profile name is resolved, the profile file is looked up local-first, then project, then user-fallback. A local profile shadows project and user profiles with the same name.

### Scope Parameter

The `scope` parameter is available on `create`, `use`, and `delete` operations:

- `scope: "local"` - operates on `.eforge/profiles/` and `.eforge/.active-profile` (gitignored, dev-personal)
- `scope: "project"` (default) - operates on `eforge/profiles/` and `eforge/.active-profile`
- `scope: "user"` - operates on `~/.config/eforge/profiles/` and `~/.config/eforge/.active-profile`

When listing profiles, all three scopes are shown. Entries shadowed by a higher-priority profile of the same name are annotated with `shadowedBy: local` or `shadowedBy: project`.

### Profile metadata

Profile metadata is descriptive only. It surfaces in profile list/show UX and `eforge_profile` create payloads but does not affect active profile selection or runtime behavior.

Metadata fields are stored at the **top level** of the profile YAML file (flat, not nested under a `metadata:` wrapper):

```yaml
# eforge/profiles/my-profile.yaml — metadata fields are top-level
description: "High-capability profile for complex planning and implementation tasks"
whenToUse:
  - "Complex multi-file refactors"
  - "Architecture planning sessions"
tags:
  - "production"
  - "high-quality"
agents:
  tiers:
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
```

When creating a profile via `POST /api/profile/create` or the `eforge_profile` tool, the metadata fields are passed as a **nested `metadata` object** in the request payload (different from the flat file shape):

Example `eforge_profile` tool call with metadata:

```json
{
  "action": "create",
  "name": "pi-openrouter",
  "scope": "project",
  "agents": { "tiers": { "..." : "..." } },
  "metadata": {
    "description": "Pi/OpenRouter profile for complex tasks",
    "whenToUse": ["Architecture planning", "Complex refactors"],
    "tags": ["production", "high-quality"]
  }
}
```

All three fields (`description`, `whenToUse`, `tags`) are optional. Metadata can also be edited directly in the profile YAML file.

## MCP Servers

MCP servers are auto-loaded from `.mcp.json` in the project root (same format Claude Code uses). By default - when no `toolbelt` is assigned on a tier - all eforge agents receive the same set of discovered MCP servers. Use named toolbelts or `toolbelt: none` on individual tiers to control which project MCP servers each tier's agents receive; see [Toolbelts](#toolbelts) below.

### Toolbelts

Toolbelts are named registries that declare which MCP servers a tier should receive. Define them under `tools.toolbelts` in `eforge/config.yaml` (or a profile), then reference them by name on individual tiers.

```yaml
tools:
  toolbelts:
    browser-ui:
      description: Browser automation for UI work.   # Optional
      mcpServers:                                     # Required, non-empty
        - playwright
    code-search:
      mcpServers:
        - sourcegraph
        - ripgrep-mcp

agents:
  tiers:
    implementation:
      harness: pi
      model: anthropic/claude-sonnet-4-6
      effort: medium
      pi:
        provider: openrouter
      toolbelt: browser-ui   # Use the 'browser-ui' toolbelt for this tier
    review:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
      toolbelt: none         # Pass no MCP servers to reviewers
    planning:
      harness: pi
      model: anthropic/claude-opus-4-6
      effort: high
      pi:
        provider: openrouter
                             # toolbelt omitted - planning agents receive all .mcp.json servers
```

**Toolbelt name rules:**
- Names must match `^[A-Za-z0-9._-]+$`.
- `none` is reserved and cannot be used as a toolbelt name (it is a tier-assignment sentinel meaning "no MCP servers").

**Tier `toolbelt` field:**
- Omitted (default) - all discovered `.mcp.json` servers are passed to agents in this tier.
- `toolbelt: <name>` - references a named entry in `tools.toolbelts`; `eforge config validate` checks that the name exists and that every listed `mcpServers` entry appears in `.mcp.json`.
- `toolbelt: none` - explicitly passes no MCP servers to agents in this tier.

**Runtime semantics:**

The registry resolves each tier's effective project MCP server set when the daemon starts and constructs one harness instance per unique `(harness, provider, effectiveServers, disableSubagents)` combination. Two tiers that resolve to the same effective set share a harness instance; tiers that differ get distinct instances.

| `toolbelt` value | Agents receive |
|-----------------|----------------|
| Omitted (default) | All servers discovered from `.mcp.json` |
| `toolbelt: none` | No project MCP servers |
| `toolbelt: <name>` | Only the servers listed in `tools.toolbelts.<name>.mcpServers` |

Filtering applies **only to project MCP servers from `.mcp.json`**. Engine-internal custom tools (such as `eforge_engine` tools), Claude built-ins, Pi built-ins, and extension-contributed tools are never filtered regardless of the toolbelt setting. Extensions use TypeScript (`defineExtensionTool`, `registerTool`, and per-run `onAgentRun({ tools: [...] })`) to contribute tools; toolbelts do not select or configure those tools.

If a named toolbelt cannot be resolved against the loaded `tools.toolbelts` map at registry construction time, the daemon throws a path-specific error (`agents.tiers.<tierName>.toolbelt references "<name>"`) rather than silently falling back to all servers.

**Observability - `agent:start` toolbelt fields:**

Each `agent:start` event carries the following optional fields that reflect the resolved toolbelt selection for that run:

| Field | Type | Description |
|-------|------|-------------|
| `toolbelt` | `string \| null` | Toolbelt name when `projectMcpSelection === 'toolbelt'`; `null` when `toolbelt: none` |
| `toolbeltSource` | `'tier' \| 'role' \| 'plan' \| 'default'` | Where the toolbelt setting was resolved from (`default` = omitted) |
| `projectMcpSelection` | `'all' \| 'none' \| 'toolbelt'` | Which selection rule applied |
| `projectMcpServerNames` | `string[]` | Sorted list of project MCP server names the agent actually received |

These fields use MCP server names (e.g. `playwright`, `sourcegraph`) as they appear in `.mcp.json` - not backend tool names (e.g. `mcp__playwright__browser_navigate`).

The harness debug payload also separates server categories: `projectMcpServerNames` (filtered project servers) and `internalMcpServerNames` (engine-internal servers such as `eforge_engine`). The old single `mcpServerNames` field that conflated the two is removed.

Toolbelts apply only to project MCP servers from `.mcp.json`. They do not filter Pi extensions, Claude Code plugins, engine-internal custom tools (such as `eforge_engine`), harness built-ins, or extension-contributed tools. Per-run `allowedTools` and `disallowedTools` values tune harness availability for that run; they are not toolbelt configuration.

Pi extensions and Claude Code plugins are out of scope for the profile-toolbelts MVP - toolbelts are MCP-only and declarative.

Toolbelts and TypeScript extensions are complementary. Toolbelts answer "Which project MCP servers from `.mcp.json` should this tier expose?" Extensions answer "What should eforge do when something happens?" and may contribute TypeScript-defined tools per agent run. Extensions may inspect toolbelt and profile metadata when making routing decisions, but extensions should not redefine toolbelts or act as a hidden profile/config layer.

## Plugins

Plugins are auto-discovered from `~/.claude/plugins/installed_plugins.json`. Both user-scoped and project-scoped plugins matching the working directory are loaded. Use `plugins.include`/`plugins.exclude` in `eforge/config.yaml` to filter, or `--no-plugins` to disable entirely.

## Hooks

Hooks are fire-and-forget shell commands triggered by `eforge` events - useful for logging, notifications, and external system integration. They do not block or influence the pipeline. See [hooks.md](hooks.md) for configuration and details.

## Config Layers

Config merges from three levels (lowest to highest priority):

1. **Global** - `~/.config/eforge/config.yaml` (respects `$XDG_CONFIG_HOME`)
2. **Project** - `eforge/config.yaml` found by walking up from cwd
3. **Project-local** - `.eforge/config.yaml` in the repo root (gitignored; highest priority)

Scope discovery and precedence are implemented in `@eforge-build/scopes`. Engine code calls `getScopeDirectory(scope)` for tier directory lookup, `resolveLayeredSingletons('config.yaml')` for the layered-singleton merge order, and `resolveNamedSet('profiles')` for active-profile resolution. Engine retains parsing, schema validation, `mergePartialConfigs()`, and active-profile semantics.

Object sections (`langfuse`, `agents`, `build`, `plan`, `plugins`, `extensions`, `prdQueue`, `daemon`, `monitor`) shallow-merge per-field. Scalar top-level fields like `maxConcurrentBuilds` override. `hooks` arrays concatenate (global fires first). Arrays inside objects (like `postMergeCommands`) replace rather than merge. CLI flags and environment variables override everything.

### Lookup modes

- **Layered singleton** - all existing scope files are returned in canonical merge order `user -> project-team -> project-local`. Used for `config.yaml`. The caller owns parsing and merge semantics.
- **Named set** - directory entries are unique by name across tiers; same-name entries shadow lower-precedence tiers. Used for `profiles/` and `templates/`. The highest-precedence copy wins.
- Project-local-only state (e.g. `.eforge/session-plans/*.md`) is not resolved through scope tiers; it is a project-local artifact read directly by `@eforge-build/input`.

Agent runtime profiles follow the same three-level pattern. Profile files can exist at project-local scope (`.eforge/profiles/` - gitignored), project scope (`eforge/profiles/`), or user scope (`~/.config/eforge/profiles/`). The active-profile marker can be set at any level: `.eforge/.active-profile` (project-local, highest precedence), `eforge/.active-profile` (project), or `~/.config/eforge/.active-profile` (user). When a profile name is resolved, the profile file is looked up local-first, then project, then user-fallback - so a local profile shadows project and user profiles with the same name.

Playbooks are optional workflow artifacts around the build-engine kernel. They are reusable input artifacts parsed, stored, validated, compiled, and surfaced through the first-party `@eforge-build/eforge-playbooks` native extension, with named-set storage resolved through `@eforge-build/scopes`. The extension registers `eforge-playbooks:list-playbooks`, `eforge-playbooks:show-playbook`, `eforge-playbooks:save-playbook`, `eforge-playbooks:validate-playbook`, `eforge-playbooks:copy-playbook`, `eforge-playbooks:promote-playbook`, `eforge-playbooks:demote-playbook`, and `eforge-playbooks:run-playbook` actions and integration commands; autonomous runs compile to ordinary build source and enqueue through `ctx.buildQueue.enqueue`, while planning runs use the eforge-plan planning flow by checking the optional `eforge.plan.planning-workstation` capability and returning generic planning entry metadata or `planning-unavailable` diagnostics. Hosts do not expose playbook-specific commands, tools, or skills; they discover and invoke these extension-owned contributions through generic contribution surfaces. Playbooks follow the same three-tier pattern: `.eforge/playbooks/` (project-local, highest precedence), `eforge/playbooks/` (project scope), and `~/.config/eforge/playbooks/` (user scope). When the same playbook name exists at multiple tiers, the highest-precedence tier wins and lower-tier copies are reported as shadows. Each playbook carries a `scope` frontmatter field that must match the tier it was loaded from; a mismatch is surfaced as a warning in the listing. Invoke playbook integration commands through the generic extension contribution CLI, for example `eforge extension contributions invoke eforge-playbooks:run-playbook --kind command --input-json '{"name":"docs-sync","afterQueueId":"q1"}'`, or use the matching MCP/Pi `eforge_extension_contribution` host tool.

### Playbook `profile` field

Playbooks support an optional `profile` frontmatter field that names an agent runtime profile to use when the playbook is executed:

```yaml
---
name: docs-sync
description: Sync project documentation
scope: project-team
mode: autonomous
profile: docs-heavy    # Optional — omit to allow router/active-profile/default resolution
---
```

**Precedence**: an optional `profile` field on the `eforge-playbooks:run-playbook` action input overrides the playbook frontmatter for that run. When no action input override is supplied, the playbook `profile` field overrides the project's active-profile marker and any registered profile router. For session-plan builds, an explicit `eforge build --profile <name>` flag or enqueue request `profile` field takes precedence over the session plan's `agent_profile`.

**Validation timing**: the named profile is validated at execution time, not when the playbook is saved or validated. A typo in `profile` is surfaced as an error when the playbook runs, not when it is created or edited. `agent_profile` values on session plans are validated when the session plan is enqueued.

**Session-plan `agent_profile` metadata**: session-plan producers may set generic `agent_profile` frontmatter to carry a recommended agent runtime profile with the artifact. When the session plan is later enqueued via `/eforge:build`, `agent_profile` is used as the effective profile unless an explicit enqueue/build `profile` override is supplied.

**Blank profile fallback**: if `profile` is omitted or left empty, eforge resolves the profile at run time using:
1. Any registered `registerProfileRouter` extension that selects a profile for the queued PRD
2. Project-local active-profile marker (`.eforge/.active-profile`) if no router selects a profile
3. Project active-profile marker (`eforge/.active-profile`)
4. User active-profile marker (`~/.config/eforge/.active-profile`)
5. Engine built-in defaults

## Parallelism

eforge has two dimensions of parallelism:

### Queue concurrency (`maxConcurrentBuilds`)

Controls the maximum number of PRDs built concurrently when processing the queue (`eforge build --queue` or `eforge queue run`). Default: `2`.

PRDs with `depends_on` frontmatter whose upstream builds are still active (pending, running, or waiting) are held in a `waiting/` subdirectory until each upstream reaches a terminal state. PRDs whose upstream dependencies have already completed with usable artifacts are eligible immediately and remain in the queue root rather than `waiting/`. Within each dependency wave, lower numeric priority values run earlier.

Queue controls mutate runtime filesystem state under `.eforge/queue/` (or the configured `prdQueue.dir`), which is gitignored and produces no git commits. `eforge queue priority <prdId> <priority>` mutates pending or waiting PRD frontmatter; failed and skipped items reject priority mutation with a conflict until recovery/requeue makes them runnable, and running items reject priority changes because active cancellation requires live queue-lock and daemon run/session ownership evidence. Queue hold state is runtime-only PRD frontmatter (`held`, `hold_reason`, `held_at`) on pending or waiting items; held items keep their location and ordering metadata but scheduler ticks skip them until they are unheld. `eforge queue remove <prdId>` deletes non-running pending, waiting, failed, or skipped queue files; failed removal deletes matching `.recovery.md` and `.recovery.json` sidecars. Legacy removal fails closed when live pending/waiting dependents exist and lists dependent ids. Cascade remove and cancel use preview/apply controls that recheck an expected affected token and require explicit dependent confirmation before mutating dependents. Scheduler pause is separate from `prdQueue.autoBuild`: it leaves desired auto-build enabled but prevents new launches until resume, while already-running builds continue unless cancelled. After successful mutations, the daemon records the queue mutation; when the scheduler is not explicitly paused, it re-reads queue files before dispatch.

When an active upstream build completes, its waiting dependents transition from `waiting` to `pending` and are dispatched normally. If an upstream build fails or is cancelled, all transitive dependents transition to `skipped` with a reason recording the upstream id and terminal state. Skip propagation is recursive - if a `skipped` entry itself has dependents, those also become `skipped`. Failed upstream cascades can be inspected through the queue recovery analysis/preflight contract; analysis includes dependency classifications, dispatch preflight, and bounded metadata repair actions. The daemon apply route passes selected repair actions and dependency-removal confirmation through to the engine, then returns repair results from the client-owned queue recovery contract.

#### Queue recovery contract fields

Analysis responses may include `dependencyClassifications`, `dispatchPreflight`, and `availableRepairActions`. Apply requests may include `repairActions` plus `confirmDependencyRemoval: true` when removing satisfied dependencies; apply responses may include `dispatchPreflight` and `repairResults`.

Dependency classifications:

| `status` | Meaning |
| --- | --- |
| `blocking` | Dependency is still active in `queue` or `waiting`; the target cannot dispatch yet. |
| `satisfied` | Dependency has a usable artifact and can be removed from `depends_on` if the caller confirms. |
| `terminal` | Dependency is failed/skipped in queue state or historical completion state. |
| `stale-historical` | Dependency is not active and has no usable artifact; surfaced as a dispatch preflight warning. |

Dispatch preflight:

| Field | Meaning |
| --- | --- |
| `canApply` | `true` only when no dispatch blockers remain after simulated repairs. |
| `blockers` / `warnings` | Aggregate notices for consumers that do not inspect each item. |
| `items[].canDispatch` | Whether this target could dispatch with the simulated metadata. |
| `items[].blockers` / `items[].warnings` | Per-target dispatch validation messages. |
| `items[].meaningfulDependencyIds` | Dependencies that can be selected as stack parents. |
| `items[].requiresStackParentChoice` | `true` when stacked dispatch needs an operator-selected parent. |
| `items[].currentStackParent` | Existing simulated stack parent, when present. |

Repair actions:

| Action | Meaning |
| --- | --- |
| `{ kind: 'remove-depends-on', targetPrdId, dependencyIds }` | Remove satisfied dependencies from `depends_on`; apply requires `confirmDependencyRemoval: true`. |
| `{ kind: 'set-stack-parent', targetPrdId, selectedParentId }` | Set `stack_parent` to a dependency selected by the caller. Construct this from the target PRD's `meaningfulDependencyIds` when `requiresStackParentChoice` is `true`. |

`availableRepairActions` currently includes satisfied dependency removals. When `requiresStackParentChoice` is `true`, callers construct `set-stack-parent` actions from dispatch preflight fields such as `items[].meaningfulDependencyIds`. Operators must explicitly select any dependency removal or stack parent choice before those repair actions are sent on apply.

Repair result statuses:

| `status` | Meaning |
| --- | --- |
| `applied` | Repair was accepted in simulation and written during apply. |
| `blocked` | Repair was rejected before metadata mutation; see `message`. |
| `skipped` | Repair was skipped after an earlier metadata write failure prevented durable application. |
| `failed` | Repair was accepted in simulation but its metadata write failed during apply; see `message`. |

CLI override: `--max-concurrent-builds <n>`

```yaml
maxConcurrentBuilds: 3    # Build up to 3 PRDs concurrently
```

### Plan execution

Within a single build, plans run as soon as their dependencies are met. Since plan execution is IO-bound (LLM calls), no throttle is needed - all ready plans launch immediately. This is automatic and requires no configuration.

### Enqueuing

Enqueuing is always single-threaded. The formatter processes one PRD at a time before adding it to the queue. No configuration is needed or available.
