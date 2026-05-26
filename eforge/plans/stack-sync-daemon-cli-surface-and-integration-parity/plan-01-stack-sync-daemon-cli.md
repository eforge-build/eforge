---
id: plan-01-stack-sync-daemon-cli
name: Stack Sync Daemon Route, Client Helper, and CLI
branch: stack-sync-daemon-cli-surface-and-integration-parity/plan-01-stack-sync-daemon-cli
---

# Stack Sync Daemon Route, Client Helper, and CLI

## Architecture Context

The engine-owned stack sync implementation is expected to live in `packages/engine/src/stacking/sync.ts` with state in `sync-state.ts`; this plan wires that existing deterministic engine behavior to public daemon and CLI surfaces. The daemon must continue to use `API_ROUTES` constants rather than inline `/api/...` path literals, and clients must call typed helpers from `@eforge-build/client`.

Exploration found `packages/monitor/src/server.ts` currently only serves `GET ${API_ROUTES.stackLayers}`, `packages/client/src/api/stack.ts` currently only exposes stack layer helpers, and `packages/eforge/src/cli/index.ts` has no `eforge stack sync` command. Do not reimplement the engine sync algorithm if the predecessor files are absent; stop with a clear predecessor-missing note rather than duplicating out-of-scope work.

## Implementation

### Overview

Add the typed stack sync request/response contract, daemon `POST /api/stack/sync` handler, client helper, and CLI command. The route loads current config, short-circuits when stacking or stack sync opt-in is disabled, derives active eforge build branches/worktrees from daemon state, passes those exclusions to the engine sync helper, and returns the structured report. The CLI invokes the daemon route when a live daemon is present and prints all report fields, with `--dry-run` preserving branches.

### Key Decisions

1. Keep sync/restack behavior in the engine helper; the daemon validates input, gathers active-build exclusions, and formats HTTP responses only.
2. Use `daemonRequestIfRunning` in the CLI first so an already-running daemon is the authority; fall back to a local in-process engine sync call only when no daemon is live, if the existing helper supports local invocation.
3. Represent commands in responses as structured provider command records (`command`, `args`, dry-run/ran marker, stdout/stderr/exit metadata where available) so CLI, Pi, and plugin surfaces can render one canonical report.
4. Treat active-build isolation as input to the engine helper: skip `eforge/<planSet>`, deterministic merge/plan worktree roots from `computeWorktreeBase(cwd, planSet)`, and any explicit running-run `cwd` values.

## Scope

### In Scope

- Add/finish `API_ROUTES.stackSync` and stack sync request/response types in `packages/client/src/routes.ts`.
- Add `apiStackSync` and `apiStackSyncIfRunning` to `packages/client/src/api/stack.ts` and export them from `packages/client/src/index.ts`.
- Add a daemon `POST API_ROUTES.stackSync` handler in `packages/monitor/src/server.ts` with dry-run body validation, config loading, active-build exclusion collection, and structured success/failure responses.
- Add `eforge stack sync [--dry-run]` to `packages/eforge/src/cli/index.ts`.
- Add formatter helpers for CLI stack sync report output if keeping the formatter inline would duplicate Pi/plugin formatting.
- Add route/client/CLI tests for skipped, dry-run, active-build skip, and client helper behavior.

### Out of Scope

- Implementing `packages/engine/src/stacking/sync.ts`, `sync-state.ts`, pre-landing reconciliation, event schemas, or workflow preset recipes.
- Daemon periodic polling for `stacking.sync.mode: poll`.
- Non-git-spice stack providers.
- Autonomous conflict resolution.

## Files

### Create

- `test/stack-sync-route.test.ts` or `packages/monitor/src/__tests__/stack-sync-route.test.ts` — daemon route coverage for skipped, dry-run, failed/conflict shape, and active-build exclusions using real temp repos/fake provider commands.

### Modify

- `packages/client/src/routes.ts` — add/complete `StackSyncRequest`, `StackSyncResponse`, command/skipped item wire types, and `API_ROUTES.stackSync`; include GET declaration only if the landed route map already includes a GET sync-state route.
- `packages/client/src/api/stack.ts` — add `apiStackSync` and `apiStackSyncIfRunning` using `API_ROUTES.stackSync`.
- `packages/client/src/index.ts` — export stack sync helper functions and wire types.
- `packages/monitor/src/server.ts` — implement `POST API_ROUTES.stackSync`; validate `dryRun` as boolean when present; load config for each request; return skipped without provider execution when disabled; collect active-build branches/worktrees; call the engine sync helper; return `outcome` values `skipped | complete | failed | conflict`.
- `packages/eforge/src/cli/index.ts` — register `stack sync`; call `apiStackSyncIfRunning` when the daemon is live; pass `{ dryRun: true }` for `--dry-run`; render trunk SHAs, fast-forward status, restack candidates, active-build skips, provider commands, reason, and outcome.
- `test/client-no-start-api-helpers.test.ts` — include `apiStackSyncIfRunning` in the no-start helper matrix and verify the live request method/path/body.
- `packages/docs-gen/src/generators/cli.ts` / generated reference files — update only if the generator does not automatically discover nested `stack sync` commands.

## Verification

- [ ] `POST API_ROUTES.stackSync` with `stacking.enabled: false` returns HTTP 200 with `outcome: "skipped"`, `stackingActive: false`, a non-empty `reason`, and an empty `providerCommands` array.
- [ ] `POST API_ROUTES.stackSync` with `{ "dryRun": true }` returns `dryRun: true`, includes provider commands marked as not executed, and leaves branch SHAs unchanged in the temp git fixture.
- [ ] `POST API_ROUTES.stackSync` skips an active build branch derived from a running DB run and includes that branch/worktree in `activeBuildSkips`.
- [ ] `apiStackSyncIfRunning({ cwd, body: { dryRun: true } })` returns `null` with no lockfile and sends `POST` to `API_ROUTES.stackSync` with the JSON body when a test daemon is live.
- [ ] `eforge stack sync --dry-run` prints local trunk SHA, origin trunk SHA, fast-forward status, eligible restack branches, active-build skips, provider commands, and outcome.
- [ ] `rg "['\"]\/api\/stack\/sync" packages/monitor packages/eforge packages/client` finds zero inline route literals outside `packages/client/src/routes.ts` and tests that intentionally assert the constant value.
