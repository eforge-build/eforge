---
title: Troubleshooting
description: Common eforge failure modes and how to resolve them.
---

# Troubleshooting

## Daemon won't start or port is in use

eforge assigns each project a deterministic port in the 4567-4667 range. If the daemon fails to start, check whether another process is holding that port or if a previous daemon instance did not exit normally.

**Diagnose:**

```bash
eforge daemon status
```

**Stop the daemon and retry:**

```bash
eforge daemon stop
eforge daemon start
```

`daemon stop` includes an active-build safety check: it refuses to stop while builds are running unless you pass `--force`. The `--force` flag bypasses the safety check:

```bash
eforge daemon stop --force
eforge daemon start
```

**Last resort - SIGKILL:**

```bash
eforge daemon kill
```

`daemon kill` sends SIGKILL to the daemon process and is the last resort when the daemon is unresponsive. Any in-progress builds will be interrupted. The `/eforge:restart` skill wraps this flow with an active-build check; use it from Claude Code or Pi for the safest restart path.

After a force stop or kill, check `eforge daemon status` before starting a new build to confirm the daemon is healthy.

## `pnpm docs:check` reports drift or broken links

The drift check compares on-disk generated reference outputs against freshly regenerated outputs. If any generated file is out of date, the check fails.

**Fix:**

```bash
pnpm docs:generate
pnpm docs:check
```

Run `pnpm docs:generate` any time you edit hand-authored guide pages under `web/content/docs/` or change source files that feed into generated reference pages (`packages/engine/src/config.ts`, CLI source, client event schema modules, MCP tools). The generator updates `web/content/reference/*.md`, `web/public/reference/*.md`, `web/public/docs/*.md`, `web/public/schemas/*.json`, `web/public/llms.txt`, and `web/public/llms-full.txt`. Never edit those files by hand; the drift check will catch it.

If the check reports broken internal links, update the link target in the relevant `web/content/docs/*.md` file to point at a slug that exists under `/docs/`, `/reference/`, or `/schemas/`.

## Auto-build is disabled or paused

If a PRD is queued but does not start, check whether daemon auto-build is disabled or the scheduler is paused. Auto-build starts from `prdQueue.autoBuild` in config and can be toggled at runtime through the host `eforge_auto_build` tool or Console. Scheduler pause is separate: it keeps desired auto-build enabled but prevents new launches until resume; already-running builds continue unless you explicitly cancel them. The daemon pauses launches after a queued build fails so dependents do not cascade.

**Diagnose:**

- Run `/eforge:status` in Claude Code or Pi and inspect the queue/auto-build summary.
- In host tooling, call `eforge_auto_build` with `{ "action": "get" }` to read the daemon's current state.
- Check the monitor event stream for `daemon:auto-build:disabled`, `daemon:auto-build:paused`, or `daemon:auto-build:transition`.

**Resume safely:**

1. If the scheduler paused because a build failed, run `/eforge:recover` first and apply the recovery verdict, then resume the scheduler from Console.
2. If auto-build is disabled, re-enable desired auto-build with `eforge_auto_build` `{ "action": "set", "enabled": true }` or Console.
3. If you intentionally disabled auto-build to stage queue items, either re-enable it or run `eforge build --queue` / `eforge queue run --all` from the CLI.

For persistent defaults, set `prdQueue.autoBuild: true` in `eforge/config.yaml`. If the watcher is slow to notice new PRDs, tune `prdQueue.watchPollIntervalMs` rather than manually editing queue files.

## Queue priority, removal, or dependency override returns conflict

Queue controls are safe runtime filesystem mutations under `.eforge/queue/` and produce no git commits. Use `eforge queue priority <prdId> <priority>` to update pending or waiting PRD frontmatter; lower numeric priority values run earlier within each dependency wave. Failed and skipped priority changes return conflict until recovery or requeue makes the item runnable.

Use `eforge queue remove <prdId>` to delete a non-running pending, waiting, failed, or skipped queue item. Removing a failed item also deletes matching `.recovery.md` and `.recovery.json` sidecars. The daemon API's dependency override removes one dependency id from a pending or waiting queue item; it returns conflict for running, failed, or skipped items, or when the target does not list the requested dependency. Queue hold state is stored as runtime-only PRD frontmatter (`held`, `hold_reason`, `held_at`) on pending or waiting items; held items keep their file location and ordering metadata, but scheduler ticks skip them until they are unheld. Console renders hold/unhold, priority, remove, cascade, cancel, and disabled reasons from daemon-authored queue capabilities. Running items reject priority, hold, unhold, removal, and dependency override controls because active work is owned by its build session; daemon-owned cancellation requires live queue-lock and run/session ownership evidence.

If removal reports live dependents, eforge failed closed because pending or waiting queue items still depend on the target. The conflict lists dependent ids for target-only removal. Cascade remove and cancel use a preview/apply flow that rechecks an expected affected token and requires explicit dependent confirmation before mutating dependents. If a queue file was moved or deleted between listing and mutation, refresh the queue view and retry against the current item id. After successful priority, removal, dependency override, hold, unhold, or cascade mutations, the daemon notifies the scheduler; when the scheduler is not explicitly paused, it re-reads queue files before dispatch.

Console exposes set-priority, hold/unhold, disabled capability reasons, and preview-first cascade remove/cancel actions on eligible queue rows. MCP and Pi expose the existing host tool names, `eforge_queue_priority` and `eforge_queue_remove`; priority applies to pending/waiting items and removal applies to non-running pending, waiting, failed, and skipped items.

## Stack sync skipped, failed, or conflicted

Run stack sync from your host (`/eforge:stack` in Claude Code, `/eforge:stack:sync` in Pi) or from the CLI:

```bash
eforge stack sync --dry-run
eforge stack sync
```

Use the report's `outcome`, `reason`, `activeBuildSkips`, `fastForward`, and `providerCommands` fields to choose the fix:

- **Skipped sync because stacking is disabled**: enable a stacked workflow with `/eforge:workflow`, or set `stacking.enabled: true` and `landing.action: pr` in `eforge/config.yaml`, then rerun sync.
- **git-spice missing or uninitialized**: install git-spice, verify `git-spice --version`, run `git-spice repo init` once in the repository, and set `stacking.gitSpice.command` if the binary is not on `$PATH`.
- **Local trunk not fast-forwardable**: when `fastForward` is `false`, push or otherwise align your local trunk with `origin/<trunk>`; eforge will not force-push, reset, or rebase trunk for you.
- **Active-build skips**: wait for the listed active eforge builds to finish, then run `eforge stack sync` again. The manual sync command uses skip semantics by default to avoid mutating worktrees that active builds are using.
- **After-build sync keeps deferring**: confirm `stacking.sync.afterBuild: true` is set (or choose the `stacked-pr-autosync` preset in `/eforge:workflow`). Daemon-owned after-build sync uses `activeBuildPolicy: "defer"`; overlapping active builds produce a `deferred` outcome and the daemon retries after later terminal queue events.
- **Conflict recovery for manual stack sync**: when `outcome` is `conflict`, run `git status`, resolve the conflicted files, `git add <resolved-files>`, continue the rebase/restack with `git rebase --continue` or the git-spice equivalent, then rerun `/eforge:stack` or `/eforge:stack:sync` to finish remaining branches.

Stacked PR landing has a separate recovery path: during `landing.action: pr`, eforge attempts automatic provider-encapsulated recovery for provider-classified recoverable restack conflicts before failing the landing step. It also preflights the remote base before git-spice submission: if a missing parent branch's artifact commit is an ancestor of trunk, eforge automatically performs branch-scoped stale-parent landing repair by tracking initially untracked children against trunk or retargeting already tracked children; if that ancestry cannot be proven, landing fails closed with manual stack-base repair guidance. Before submitting, it runs provider repo sync, branch restack, and a remote-base freshness proof, retrying that sync/restack/proof cycle once if the fetched effective base is not contained in `HEAD`. Manual recovery is still required for `eforge stack sync` conflicts, non-recoverable provider failures, failed automatic landing recovery, and stale parent branches whose changes are not proven integrated.

If `outcome` is `failed` without a conflict, inspect the failed `providerCommands`, run the same git-spice command manually for more context, fix the repository state, and rerun with `--dry-run` before applying changes.

## Recover a failed enqueue

If enqueue formatting, source loading, or pre-queue validation fails before a runnable queue file exists, Console shows a durable **Enqueue failed** row in Needs attention. The row is keyed by run id and includes the source label, reason, timestamp, fallback next command, and any disabled reason. When the daemon still has enough source data, use the confirmed **Re-enqueue…** action; otherwise copy the fallback command and fix the source or validation issue first. A successful re-enqueue resolves the failed-enqueue row.

## Recover from a failed build

When a queued build fails, the scheduler pauses and the PRD is marked `failed` in the queue while desired auto-build remains enabled. Do not re-enqueue manually; use the recovery workflow instead.

**Check for failed builds:**

```bash
eforge queue list
```

Or from Claude Code or Pi:

```
/eforge:status
/eforge:recover
```

The recovery flow:

1. Call `eforge_queue_list` to find failed PRDs.
2. Read the recovery sidecar (`eforge_read_recovery_sidecar`) to get the recovery verdict and bounded evidence.
3. The verdict is one of:
   - `retry` - move the failed PRD back to the queue root and remove recovery sidecars so auto-build can try it again from scratch
   - `continue-repair` - prepare root-plan `## Recovery Guidance`, then queue the failed PRD through the compiled-artifact repair path, preserving existing queue controls and reactivating skipped descendants whose dependency chain reaches the parent
   - `abandon` - remove the failed PRD and recovery sidecars from the queue because the work should not continue
   - `manual` - make no queue changes; a human must inspect the recovery report and decide whether bounded manual replanning or a deliberately authored follow-up PRD is appropriate
4. Check the sidecar's continue-and-repair fields. If `continueRepairEligibility.eligible` is true or `recoveryOptions` recommends `continue-repair`, present one primary **Continue and repair build** action. If the sidecar says continue-and-repair is ineligible, show the bounded reason and do not infer eligibility manually from branch or artifact presence.
5. Confirm the action with the user.
6. Apply via `eforge_apply_recovery` / `eforge apply-recovery <prdId>` for `retry` and `abandon`. For `continue-repair`, call `eforge_continue_repair` (Pi), `mcp__eforge__eforge_continue_repair` (Claude Code), or `eforge continue-repair <prdId> [--set-name <name>] [--profile <name>]` (CLI). These commands require current root-plan `## Recovery Guidance` before queueing the continued build and return queued metadata rather than a local worker session.

When you are present in the Console Now dashboard, failed builds appear in the Needs attention strip with a **Recover…** action. Rows with daemon-projected pre-session dispatch blockers show the blocker stage and reason, and the root-hosted recovery dialog repeats that callout above the recovery report. The dialog leads with the recovery sidecar verdict and exactly one confirmed primary action: retry from scratch, continue and repair build from preserved compiled artifacts, abandon, or manual review / manual replanning guidance with no apply button. Continue-and-repair waits for scheduler dispatch under the same queue controls described above after the engine patches the failed root compiled plans with one canonical `## Recovery Guidance` section; if guidance cannot be applied, the action reports the blocker and leaves queue files unmoved. After dispatch and a successful continued build it retires the failed queue item and reactivates skipped descendants automatically, while an activated failed continue-and-repair run returns the PRD to `failed/` with refreshed or degraded recovery evidence when possible. Lower-level queue-cascade retry/reactivation - which moves the failed upstream back to the queue for explicit retry/repair and may reactivate skipped descendants - lives in a collapsed advanced section that loads its analysis only when opened. That section renders dependency classifications, dispatch preflight blockers/warnings, explicit dependency-removal and `stack_parent` repair controls, selected-repair summaries, and repair results; dependency removal and `stack_parent` persistence are never silently selected. When no sidecar exists yet the dialog shows `recovery pending` with a confirmed **Run recovery analysis** action. Every mutating, queueing, or worker-spawning action requires an explicit confirmation, and a successful apply refreshes the queue.

## Untrusted project extension blocks loading

Project/team extensions (`eforge/extensions/`) require an explicit per-extension trust record before loading. The `extension:untrusted` diagnostic appears in `eforge extension list` output when the trust record is missing.

**Trust the extension:**

```bash
eforge extension trust <name>
```

This hashes the current extension source and writes a record to `.eforge/extension-trust.json`. The trust record applies only on your machine; each team member must trust shared extensions independently.

If the extension source changes after trust, `extension:trust-changed` appears. Re-run `eforge extension trust <name>` after reviewing the diff to accept the new version.

## Profile router selected an invalid profile

When a registered profile router returns a profile name that does not exist in any scope, eforge emits `queue:profile:invalid-selection` and the build proceeds under the active profile or engine defaults.

**Diagnose:** check the Console event stream or run `eforge extension show <router-extension-name>` to see recent diagnostics.

**Fix:** update the profile router extension to return a profile name that exists, or create the missing profile with `/eforge:profile-new` in Claude Code or `/eforge:profile:new` in Pi. The `availableProfiles` field in `ProfileRouterContext` lists all currently loadable profile names - use it to guard against stale names.

## Queue lock files

Queue lock files signal in-progress builds. Do not delete them by hand. If you suspect a lock file is stale (after an unexpected daemon restart or system crash), the scheduler reconciles stale locks automatically at startup - wait for the daemon to restart and check `eforge daemon status`.

If a lock file persists after a confirmed full daemon restart, check whether another daemon instance is running on a different port (`eforge daemon status` reports the active port and PID). Force-stopping that instance will release the lock.

## Validation-fixer retries exhausted

After all plans merge, eforge runs `build.postMergeCommands` and calls a validation-fixer agent on failure. The fixer retries up to `build.maxValidationRetries` times (default: 2). When retries are exhausted, the build is marked `failed`.

**Adjust the retry budget:**

```yaml
build:
  maxValidationRetries: 3
```

Each retry runs the full fixer-evaluator cycle; higher values increase cost. If your validation commands are non-deterministic (e.g. flaky tests), fix the flakiness first rather than raising the retry limit.

After an exhausted-retries failure, use `/eforge:recover` to apply the recovery verdict. The recovery sidecar captures what the fixer attempted and where it stopped, which helps identify the root cause.

## Extension policy gate `require-approval` blocks a build

Policy gates can return `{ decision: 'require-approval', reason }`, but eforge does not provide an approval workflow, approval state, or Console approval UI. The decision blocks the gated operation. If a build is stuck on a policy gate, check Console for `extension:policy:decision` events with `decision: require-approval`.

**Supported fix:** change the extension to return `{ decision: 'allow' }` or `{ decision: 'block', reason }`. Treat `require-approval` as unsupported for runtime approvals in the current release.

See [Extensions API - Policy gates](/docs/extensions-api) and [Configuration - Native Extensions](/docs/configuration#native-extensions) for `policyGateFailurePolicy` and timeout configuration.

## Where to look next

- [Configuration](/docs/configuration) - validation commands, retry limits, hooks
- [Extensions](/docs/extensions) - trust model, diagnostics, and status codes
- [Extensions API](/docs/extensions-api) - policy gate decisions and profile router contracts
- [Integrations](/docs/integrations) - daemon startup, Console dashboard, and restart
