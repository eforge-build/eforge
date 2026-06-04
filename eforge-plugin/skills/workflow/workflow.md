---
description: Set up or reconfigure the eforge workflow preset — landing action, stacking, PR settings, and automatic stack sync
argument-hint: "[--reconfigure]"
---

# /eforge:workflow

Configure the eforge workflow preset for this project. Answers four questions to select one of five presets and writes the matching config keys to `eforge/config.yaml`.

> **Note (Claude Code vs Pi):** In Pi, this skill is backed by a native select-overlay wizard that presents visual option panels for each question. Claude Code does not have native select overlays, so this skill uses a conversational Q&A flow that produces the same preset and config output as the Pi wizard.

## Mode detection

- If `$ARGUMENTS` contains `--reconfigure`, use **reconfigure mode** (show current config before the interview).
- Otherwise use **init mode** (skip the current-config summary).

## Reconfigure mode: show current config

If `--reconfigure` is passed, call `mcp__eforge__eforge_config` with `{ action: "show" }` and summarize the current workflow-relevant settings:

- `landing.action`
- `landing.pr.autoMerge`
- `build.allowLocalMergeToTrunk`
- `stacking.enabled`
- `stacking.sync.afterBuild`

Then proceed to the interview.

## Interview: four questions

Walk through the four wizard dimensions in order. Explain each question briefly before asking.

### Question 1: Development context

> **Solo or team?**
>
> - **Solo** — you are the only developer merging to trunk.
> - **Team** — multiple developers merge PRs; code review gates are active.

Store the answer as `context: "solo" | "team"`.

### Question 2: Landing action

> **How should builds land after completing?**
>
> - **Direct merge** (`merge`) — the artifact branch is merged directly into the base branch. Only available to solo developers with `build.allowLocalMergeToTrunk: true`.
> - **Pull request** (`pr`) — a GitHub PR is opened from the artifact branch. Best for code review workflows (required for team use).

If the user chose Team in Question 1, the only valid option is `pr`. Say so and skip the choice.

Store the answer as `landing: "merge" | "pr"`.

### Question 3: Stacked PRs

> **Does this project use stacked PRs with git-spice?**
>
> - **No** — standard single-branch builds.
> - **Yes** — each build PR normally targets the parent artifact branch. During landing, eforge can repair a missing integrated parent by retargeting only the child artifact branch to trunk, then runs provider repo sync, branch restack, and a remote-base freshness proof before submitting the PR. Requires git-spice installed and `git-spice repo init` run in the repo.

If yes, confirm the `git-spice` binary location: "Is `git-spice` on your `$PATH`, or is there a custom path?" Default: `git-spice` on `$PATH`.

Store as `stacking: "none" | "git-spice"` and optionally `gitSpiceCommand: "<path>"`.

### Question 4: Automatic stack sync (only when stacking = "git-spice")

> **Automatically sync the stack after every build?**
>
> - **Yes** — enables daemon-owned after-build sync (`stacking.sync.afterBuild: true`). After each build completes, the daemon runs `eforge stack sync` automatically from the project root. When active builds are running, sync is deferred until those builds complete.
> - **No** — run `/eforge:stack` manually when you want to sync the stack.

Store as `autoSync: "yes" | "no"`.

## Preset selection

Map the four answers to one of five presets:

| Preset | When selected |
|--------|--------------|
| `solo-merge` | `landing: merge` (always solo by implication) |
| `solo-pr` | `context: solo`, `landing: pr`, `stacking: none` |
| `team-pr` | `context: team`, `landing: pr`, `stacking: none` |
| `stacked-pr` | `stacking: git-spice`, `autoSync: no` |
| `stacked-pr-autosync` | `stacking: git-spice`, `autoSync: yes` |

## Config keys each preset writes

Present the config changes to the user before writing:

| Preset | Config keys set |
|--------|----------------|
| `solo-merge` | `landing.action: merge`, `build.allowLocalMergeToTrunk: true`, `stacking.enabled: false` |
| `solo-pr` | `landing.action: pr`, `landing.pr.autoMerge: always`, `stacking.enabled: false` |
| `team-pr` | `landing.action: pr`, `landing.pr.autoMerge: ask`, `stacking.enabled: false` |
| `stacked-pr` | `landing.action: pr`, `stacking.enabled: true` |
| `stacked-pr-autosync` | `landing.action: pr`, `stacking.enabled: true`, `stacking.sync.afterBuild: true` |

For stacking presets, if the user provided a custom git-spice path, also write `stacking.gitSpice.command: "<path>"`.

## Apply the preset

Call `mcp__eforge__eforge_init` to persist the selected config keys. Pass the appropriate fields based on the selected preset:

**`solo-merge`:**
```json
{
  "landingAction": "merge",
  "allowLocalMergeToTrunk": true,
  "stackingEnabled": false,
  "force": true
}
```

**`solo-pr`:**
```json
{
  "landingAction": "pr",
  "stackingEnabled": false,
  "force": true
}
```
After `eforge_init` returns, directly edit `eforge/config.yaml` to set `landing.pr.autoMerge: always` (since `eforge_init` does not expose that field). Read the current `eforge/config.yaml`, add or update the `landing.pr.autoMerge` key under `landing.pr`, write it back, then call `mcp__eforge__eforge_config` with `{ "action": "validate" }` to confirm the change.

**`team-pr`:**
```json
{
  "landingAction": "pr",
  "stackingEnabled": false,
  "force": true
}
```
Auto-merge defaults to `ask` (the eforge default), so no additional config write is needed.

**`stacked-pr`:**
```json
{
  "landingAction": "pr",
  "stackingEnabled": true,
  "force": true
}
```
Optionally include `"gitSpiceCommand": "<path>"` if the user provided one.

**`stacked-pr-autosync`:**
```json
{
  "landingAction": "pr",
  "stackingEnabled": true,
  "force": true
}
```
Optionally include `"gitSpiceCommand": "<path>"`. After `eforge_init` returns, inform the user that daemon-owned after-build sync will be enabled via `stacking.sync.afterBuild: true` — this requires a direct edit to `eforge/config.yaml` since `eforge_init` does not expose that field. Read the current `eforge/config.yaml`, set `stacking.sync.afterBuild: true` under the `stacking.sync` block if not already present, and write it back. Then call `mcp__eforge__eforge_config` with `{ action: "validate" }`.

## Validate

After writing, call `mcp__eforge__eforge_config` with `{ action: "validate" }`. Show any validation errors and offer to fix them.

## Report

Show a summary of what was configured:

> Workflow preset `<preset-label>` applied.
>
> Config changes:
> - `landing.action`: `<value>`
> - `stacking.enabled`: `<value>`
> - (other keys as applicable)
>
> Run `/eforge:stack` to manually synchronize the stack at any time. Run `/eforge:workflow --reconfigure` to change the preset.

## Related skills

| Skill | Command | When to suggest |
|-------|---------|----------------|
| Stack sync | `/eforge:stack` | User wants to sync the git-spice stack immediately |
| Config | `/eforge:config` | User wants fine-grained config edits beyond the preset |
| Init | `/eforge:init` | Project is not yet initialized with eforge |
| Status | `/eforge:status` | User wants to check current build state |
