---
name: eforge-stack
description: Synchronize the git-spice stack, preview with dry-run, interpret the sync report, and recover from conflicts
disable-model-invocation: true
---

# /eforge:stack:sync

Manually synchronize the git-spice stack for this project. Use `--dry-run` to preview what commands would run without executing them.

Stack sync is a daemon-owned operation that runs from the project root. The daemon calls `git-spice repo sync` followed by `git-spice stack restack`. Triggers include: this command (`/eforge:stack:sync`), the CLI (`eforge stack sync`), the `eforge_stack_sync` tool, and — when `stacking.sync.afterBuild: true` is configured — automatically after each build completes.

## Requirements

Stack sync requires `stacking.enabled: true` in `eforge/config.yaml` and git-spice initialized in the repository (`git-spice repo init`). If stacking is not enabled the daemon returns `outcome: "skipped"` with a reason.

## Step 1: Detect dry-run flag

Check `$ARGUMENTS` for `--dry-run`. If present, set `dryRun: true` in the tool call.

## Step 2: Run the sync

Call the `eforge_stack_sync` tool with `{ dryRun: <true|false> }`.

## Step 3: Interpret the response

The tool returns a structured sync report. Interpret each field:

| Field | Meaning |
|-------|---------|
| `outcome` | One of `"skipped"`, `"complete"`, `"deferred"`, `"failed"`, `"conflict"` |
| `reason` | Human-readable reason (always present for skipped/deferred/failed/conflict) |
| `stackingActive` | Whether stacking is enabled and active for this project |
| `dryRun` | Whether this was a preview-only run |
| `localTrunkSha` | SHA of the local trunk branch |
| `originTrunkSha` | SHA of `origin/<trunk>` |
| `fastForward` | True when local trunk is at or behind origin (fast-forward eligible) |
| `restackCandidates` | Artifact branches eligible for restack |
| `activeBuildSkips` | Branches/worktrees skipped because active builds are using their worktrees and overlap the stack candidate set |
| `providerCommands` | git-spice commands that ran (or would run in dry-run) |
| `error` | Error message when outcome is `"failed"` or `"conflict"` |

### Outcome summaries

**`skipped`** - Stacking is not enabled or no stacking configuration found. Nothing was changed. Show the `reason` to the user. Suggest enabling stacking with `/eforge:config` or `/eforge:workflow`.

**`complete`** - All eligible artifact branches were restacked onto the latest trunk. Show the list of `providerCommands` that ran and the `restackCandidates` that were processed.

**`deferred`** - Active builds are running and their worktrees overlap the stack candidate set. The restack step was skipped to avoid conflicting with in-flight builds. Show `activeBuildSkips` and `reason`. The `activeBuildPolicy` field will be `"defer"` when a deferred outcome was explicitly requested. If `stacking.sync.afterBuild: true` is configured, the daemon will retry deferred syncs after each build completes — no manual action is needed. Otherwise, suggest waiting for active builds to complete and then running `/eforge:stack:sync` again.

**`failed`** - The sync command exited with a non-zero code. Show `error` and the failed `providerCommands`. Suggest running `git-spice` manually to investigate, then re-running sync after resolving the issue.

**`conflict`** - A restack step hit a merge conflict. Show `error` and the `providerCommands` list. Proceed with the conflict recovery flow below.

### Active-build skips

When `activeBuildSkips` is non-empty, report which branches were excluded and why. These branches were left unchanged because active eforge builds are using their worktrees. When `outcome` is `"deferred"`, the entire restack step was skipped; when `outcome` is `"complete"`, only the listed branches were skipped and the rest were restacked. Re-run sync after the active builds complete to restack the skipped branches.

### Fast-forward check

When `fastForward` is `false`, the local trunk is ahead of `origin/<trunk>`. Sync uses a fast-forward-only trunk policy: it will not force-push or rebase trunk. Tell the user to push or align their local trunk before syncing.

## Step 4: Conflict recovery

When `outcome` is `"conflict"`:

1. Show the error and the exact commands that ran up to the point of conflict.
2. Instruct the user:
   > A merge conflict occurred during stack restack. To recover:
   > 1. Run `git status` to see the conflicting files.
   > 2. Resolve the conflicts in the affected files.
   > 3. Run `git add <resolved-files>` to stage the resolved files.
   > 4. Run `git rebase --continue` (or the git-spice equivalent) to resume the restack.
   > 5. Once the restack finishes, run `/eforge:stack:sync` again to sync remaining branches.
3. Offer to re-run the sync after the user confirms they have resolved the conflict.

## Dry-run output

When `dryRun` is `true`:

- Make clear that no commands were executed.
- List each entry in `providerCommands` with its `command` and `args`.
- Show `restackCandidates` — the branches that would be restacked.
- Show `activeBuildSkips` — branches that would be skipped due to active builds.

## Related skills

| Skill | Command | When to suggest |
|-------|---------|----------------|
| Workflow | `/eforge:workflow` | User wants to configure workflow preset (stacking, landing action, auto-sync) |
| Config | `/eforge:config` | User wants to enable/disable stacking or change sync config |
| Status | `/eforge:status` | User wants to check build progress before sync |
