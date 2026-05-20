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

Run `pnpm docs:generate` any time you edit hand-authored guide pages under `web/content/docs/` or change source files that feed into generated reference pages (`packages/engine/src/config.ts`, CLI source, event schema, MCP tools). The generator updates `web/content/reference/*.md`, `web/public/reference/*.md`, `web/public/docs/*.md`, `web/public/schemas/*.json`, `web/public/llms.txt`, and `web/public/llms-full.txt`. Never edit those files by hand; the drift check will catch it.

If the check reports broken internal links, update the link target in the relevant `web/content/docs/*.md` file to point at a slug that exists under `/docs/`, `/reference/`, or `/schemas/`.

## Auto-build is disabled or paused

If a PRD is queued but does not start, check whether daemon auto-build is disabled or paused. Auto-build starts from `prdQueue.autoBuild` in config, can be toggled at runtime through the host `eforge_auto_build` tool or the monitor UI, and pauses after a queued build fails so dependents do not cascade.

**Diagnose:**

- Run `/eforge:status` in Claude Code or Pi and inspect the queue/auto-build summary.
- In host tooling, call `eforge_auto_build` with `{ "action": "get" }` to read the daemon's current state.
- Check the monitor event stream for `daemon:auto-build:disabled`, `daemon:auto-build:paused`, or `daemon:auto-build:transition`.

**Resume safely:**

1. If auto-build paused because a build failed, run `/eforge:recover` first and apply the recovery verdict.
2. Re-enable auto-build with `eforge_auto_build` `{ "action": "set", "enabled": true }` or the monitor UI.
3. If you intentionally disabled auto-build to stage queue items, either re-enable it or run `eforge build --queue` / `eforge queue run --all` from the CLI.

For persistent defaults, set `prdQueue.autoBuild: true` in `eforge/config.yaml`. If the watcher is slow to notice new PRDs, tune `prdQueue.watchPollIntervalMs` rather than manually editing queue files.

## Recover from a failed build

When a queued build fails, auto-build pauses and the PRD is marked `failed` in the queue. Do not re-enqueue manually; use the recovery workflow instead.

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
2. Read the recovery sidecar (`eforge_read_recovery_sidecar`) to get the recovery verdict.
3. The verdict is one of:
   - `requeue` - re-queue the original PRD for another attempt
   - `enqueue-successor` - create a successor PRD for the remaining work
   - `archive` - the PRD cannot be retried; archive it
   - `manual` - manual intervention required; no automated action is available
4. Confirm the action with the user.
5. Apply via `eforge_apply_recovery`.

When you are present and the monitor UI is open, you can also click the retry button directly in the UI.

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

**Diagnose:** check the monitor UI event stream or run `eforge extension show <router-extension-name>` to see recent diagnostics.

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

Policy gates can return `{ decision: 'require-approval', reason }`. This decision currently blocks the gated operation because no approval workflow exists yet. If a build is stuck on a policy gate, check the monitor UI for `extension:policy:decision` events with `decision: require-approval`.

**Short-term fix:** change the extension to return `{ decision: 'allow' }` or `{ decision: 'block', reason }` until an approval workflow is implemented. The `require-approval` decision type is reserved for a future release.

See [Extensions API - Policy gates](/docs/extensions-api) and [Configuration - Native Extensions](/docs/configuration#native-extensions) for `policyGateFailurePolicy` and timeout configuration.

## Where to look next

- [Configuration](/docs/configuration) - validation commands, retry limits, hooks
- [Extensions](/docs/extensions) - trust model, diagnostics, and status codes
- [Extensions API](/docs/extensions-api) - policy gate decisions and profile router contracts
- [Integrations](/docs/integrations) - daemon startup, monitor UI, and restart
