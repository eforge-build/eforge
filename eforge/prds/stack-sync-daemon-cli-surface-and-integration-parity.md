---
title: Stack Sync Daemon/CLI Surface and Integration Parity
created: 2026-05-26
---

# Stack Sync Daemon/CLI Surface and Integration Parity

## Overview

This is a successor build to the "Automate Git-Spice Stack Sync and Restack Workflow" PRD. The engine foundation (plan-01) and workflow presets (plan-03) have already landed on the feature branch `eforge/automate-git-spice-stack-sync-and-restack-workflow`. This PRD covers only what remains: the daemon HTTP route handlers and CLI command for `eforge stack sync`, plus the Pi/plugin integration and documentation parity pass.

## Starting Point

The following is already implemented and merged to the feature branch:

- `packages/engine/src/stacking/sync.ts` — deterministic sync/restack helpers with typed event emission
- `packages/engine/src/stacking/sync-state.ts` — sync state persistence
- `packages/engine/src/stacking/landing.ts` — pre-landing reconciliation hook
- `packages/engine/src/orchestrator/phases.ts` — stackLanding invoking pre-landing reconciliation
- `packages/engine/src/config.ts` — stacking.sync config schema and validation
- `packages/client/src/events.schemas.ts` — stack:sync:* event family
- `packages/client/src/routes.ts` — POST /api/stack/sync and GET /api/stack/sync route declarations
- `packages/client/src/event-registry.ts` — stack sync projectable state
- `packages/client/src/api/workflow.ts` — typed workflow preset client helpers
- `packages/engine/src/workflow-presets.ts` — preset recipes and expansion logic
- `packages/monitor-ui/src/lib/reducer/index.ts` — stack sync state reducer
- `test/stack-sync.test.ts`, `test/stack-runtime-landing.test.ts`, `test/workflow-presets.test.ts` — comprehensive unit tests

**Before writing any new code, read the current state of:**
- `packages/monitor/src/server.ts` — determine what (if anything) plan-02 partially added
- `packages/eforge/src/cli/index.ts` — determine whether stack sync CLI was partially added
- `packages/client/src/api/` — check whether `stack.ts` already exists with stack sync helpers

Do not duplicate or overwrite any of the above landed work.

## Goal

Wire the deterministic sync engine to user-facing surfaces: daemon HTTP routes with active-build isolation, CLI command with dry-run support, Pi workflow wizard, Claude plugin docs, and the documentation/parity pass.

## Acceptance Criteria

### Daemon route — POST /api/stack/sync

- Invoking POST /api/stack/sync when stacking is disabled returns a skipped result with a human-readable reason and does not execute any git-spice command.
- POST /api/stack/sync supports a dry-run request body parameter.
- POST /api/stack/sync skips branches and worktrees belonging to currently running eforge builds.
- POST /api/stack/sync response includes: stacking active flag, current local trunk sha, current origin/trunk sha, whether local trunk would be (or was) fast-forwarded, list of eligible branches selected for restacking, list of active-build branches/worktrees skipped, list of provider commands that ran (or would run in dry-run), and a final outcome value of skipped/complete/failed/conflict.
- The route is implemented using the typed API_ROUTES constants — no inline /api/... literal.
- The route handler is reachable from the typed client helper in packages/client/src/api/.

### CLI — eforge stack sync

- `eforge stack sync` exists as a CLI command.
- `eforge stack sync --dry-run` runs in dry-run mode and prints the report without mutating branches.
- The CLI command calls the daemon route when the daemon is running.
- The CLI command output matches the structured report fields (trunk SHAs, skipped branches, provider commands, outcome).

### Pi extension — workflow wizard

- `packages/pi-eforge` exposes a native Pi workflow wizard command for initial configuration.
- `packages/pi-eforge` exposes a native Pi workflow wizard command for reconfiguration (changing from one workflow preset to another).
- The wizard uses showSelectOverlay or showSearchableSelectOverlay rather than asking users to type identifiers.
- The wizard asks user-oriented questions covering solo vs team, direct merge vs PR, stacked PRs yes/no, and automatic stack sync yes/no.
- The wizard displays a plain-language summary of the selected workflow before writing config.
- The wizard displays a config diff or structured config-change summary before writing config.
- The wizard requires explicit confirmation before writing config changes.
- Wizard config changes are produced by the shared preset recipe logic from packages/engine/src/workflow-presets.ts (or via typed daemon client APIs) — no duplicated ad hoc mutation logic.
- If the user selects a git-spice/stacking workflow and git-spice is unavailable, the wizard offers choices: continue with stacking disabled, cancel, or configure the git-spice command path.

### Pi extension — stack sync entry point

- `packages/pi-eforge` exposes a native Pi command or tool equivalent to `eforge stack sync`.
- The Pi stack sync entry point supports dry-run mode.

### Claude plugin parity

- `eforge-plugin/` exposes matching skill/tool docs for stack sync and workflow preset surfaces (or documents a technical infeasibility if one exists).
- `eforge-plugin/.claude-plugin/plugin.json` plugin version is bumped.

### Documentation

- `docs/stacking.md` documents the manual eforge stack sync command and --dry-run mode.
- `docs/stacking.md` documents that stack-sync opt-in is separate from stacking.enabled.
- `docs/stacking.md` documents active-build skip behavior during background sync.
- `docs/stacking.md` documents that stacked builds perform pre-landing reconciliation before publishing.
- `docs/stacking.md` documents conflict behavior and recovery expectations.
- `docs/stacking.md` documents the optional automatic sync config (stacking.sync.enabled, stacking.sync.mode, stacking.sync.intervalSeconds).
- `docs/stacking.md` documents protected-vs-solo trunk behavior (fast-forward-only policy).
- `docs/config.md` lists all five workflow presets (solo local/direct-merge, solo PR, solo stacked PR, team protected trunk, team protected trunk with stacking) and the explicit config keys each preset writes.
- `docs/config.md` describes the Pi workflow wizard.
- `docs/roadmap.md` removes the "Stacked PRs → Automated post-merge restack/sync" item.
- `pnpm docs:check` exits 0 after running `pnpm docs:generate` to refresh generated reference docs for any new CLI commands, daemon routes, or Pi surfaces.

### Tests

- test/client-no-start-api-helpers.test.ts covers the new stack sync typed client helper.
- Automated tests cover the daemon route response shape for skipped, dry-run, and active-build-skip scenarios.
- Automated tests cover Pi wizard decision and config-diff helper behavior (pure helpers, no Pi SDK calls).

## Out of Scope

The following is already complete — do not reimplement:

- Engine sync helpers (sync.ts, sync-state.ts)
- Pre-landing reconciliation in phases.ts and landing.ts
- stacking.sync config schema and validation
- stack:sync:* event schemas in events.schemas.ts
- Route declarations in routes.ts and event-registry projectable state
- Workflow preset recipe logic in workflow-presets.ts
- Typed workflow preset client helpers in api/workflow.ts
- All engine, config, stack-sync, and workflow-preset unit tests

Also out of scope:

- Non-git-spice stacking provider implementation
- Full autonomous conflict resolution
- Cloud or hosted orchestration
- Daemon periodic polling (stacking.sync.mode: poll) — document config shape only; implementation is a follow-up
