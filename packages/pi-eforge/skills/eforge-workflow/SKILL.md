---
name: eforge-workflow
description: Set up or reconfigure the eforge workflow preset — landing action, stacking, PR settings, and automatic stack sync
disable-model-invocation: true
---

# /eforge:workflow

Configure the eforge workflow preset for this project using the native Pi workflow wizard. Answers four questions to select one of five presets and writes the matching config keys to `eforge/config.yaml`.

In Pi, this skill is backed by native select-overlay panels (`showSelectOverlay` / `showSearchableSelectOverlay`) for each question, providing a visual picker experience. The underlying preset logic and config keys are identical to the Claude Code `/eforge:workflow` skill.

## Commands

- `/eforge:workflow` — auto-detects mode (init if not configured, reconfigure if already configured)
- `/eforge:workflow:init` — always runs the full wizard from scratch
- `/eforge:workflow:reconfigure` — shows current config summary before the wizard

## Four wizard dimensions

The wizard asks four questions in sequence:

### 1. Development context (solo vs team)

- **Solo** — you are the only developer merging to trunk
- **Team** — multiple developers merge PRs; code review gates are active

### 2. Landing action (merge vs PR)

- **Direct merge** (`merge`) — the artifact branch is merged directly into the base branch. Solo only (requires `build.allowLocalMergeToTrunk: true`).
- **Pull request** (`pr`) — a GitHub PR is opened from the artifact branch. Required for team use.

### 3. Stacked PRs (git-spice or none)

- **No stacking** — standard single-branch builds
- **git-spice stacking** — each build PR targets the parent artifact branch. Requires git-spice and `git-spice repo init`.

When stacking is selected, the wizard checks whether `git-spice` is available. If not found on `$PATH`, it offers three remediation choices: disable stacking, configure a custom path, or cancel.

### 4. Automatic stack sync (only when stacking enabled)

- **Yes** — adds `eforge stack sync` as a post-merge command for automatic restack after every merge
- **No** — sync the stack manually with `/eforge:stack:sync`

## Five workflow presets

The four dimensions map to one of five presets:

| Preset | Label | When selected |
|--------|-------|--------------|
| `solo-merge` | Solo - direct merge | `landing: merge` |
| `solo-pr` | Solo - pull requests | `context: solo`, `landing: pr`, `stacking: none` |
| `team-pr` | Team - pull requests | `context: team`, `landing: pr`, `stacking: none` |
| `stacked-pr` | Stacked PRs (git-spice) | `stacking: git-spice`, `autoSync: no` |
| `stacked-pr-autosync` | Stacked PRs with auto sync | `stacking: git-spice`, `autoSync: yes` |

## Config keys each preset writes

| Preset | Config keys set |
|--------|----------------|
| `solo-merge` | `landing.action: merge`, `build.allowLocalMergeToTrunk: true`, `stacking.enabled: false` |
| `solo-pr` | `landing.action: pr`, `landing.pr.autoMerge: always`, `stacking.enabled: false` |
| `team-pr` | `landing.action: pr`, `landing.pr.autoMerge: ask`, `stacking.enabled: false` |
| `stacked-pr` | `landing.action: pr`, `stacking.enabled: true` |
| `stacked-pr-autosync` | `landing.action: pr`, `stacking.enabled: true`, `build.postMergeCommands: [eforge stack sync]` |

For stacking presets where the user provides a custom git-spice path, `stacking.gitSpice.command` is also written.

## Related skills

| Skill | Command | When to suggest |
|-------|---------|----------------|
| Stack sync | `/eforge:stack:sync` | User wants to sync the git-spice stack immediately |
| Config | `/eforge:config` | User wants fine-grained config edits beyond the preset |
| Init | `/eforge:init` | Project is not yet initialized with eforge |
| Status | `/eforge:status` | User wants to check current build state |
