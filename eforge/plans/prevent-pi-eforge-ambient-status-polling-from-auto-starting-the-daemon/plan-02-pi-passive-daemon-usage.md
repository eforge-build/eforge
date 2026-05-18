---
id: plan-02-pi-passive-daemon-usage
name: Refactor Pi Extension to Passive Daemon Usage
branch: prevent-pi-eforge-ambient-status-polling-from-auto-starting-the-daemon/plan-02-pi-passive-daemon-usage
agents:
  builder:
    effort: high
    rationale: The Pi extension has many daemon-backed tools, commands, and ambient
      status paths that need coordinated no-start conversion.
  reviewer:
    effort: high
    rationale: Review must audit all Pi daemon call sites and docs for the new policy.
  tester:
    effort: high
    rationale: Regression tests need dynamic no-spawn coverage plus static policy gates.
---

# Refactor Pi Extension to Passive Daemon Usage

## Architecture Context

The Pi extension starts ambient footer polling on `session_start`; that path currently uses auto-starting daemon client APIs. All Pi daemon-backed operations must become passive except explicit `eforge_daemon` start/restart. Once a daemon is already running, tool response shapes and command behavior must stay compatible with the current Pi integration.

This plan depends on plan 1's no-start client helper variants.

## Implementation

### Overview

Refactor `packages/pi-eforge/extensions/eforge/` so it imports only non-starting daemon request helpers and `*IfRunning` route helpers, except for `ensureDaemon(...)` inside explicit `eforge_daemon` start/restart. Add a small Pi-local wrapper for standard daemon-not-running failures, update ambient footer polling to clear footer keys when no daemon is live, update native commands and tools, and add regression/static tests.

### Key Decisions

1. Use direct `daemonRequestIfRunning(...)` only through an explicitly named Pi-local wrapper for raw route calls; use `api*IfRunning` route helpers for typed route calls.
2. Ambient footer refresh treats `null` from no-start calls as "daemon absent" and clears `eforge`, `eforge-build`, and `eforge-queue` without raising a visible error.
3. Non-lifecycle tools and commands that require the daemon convert `null` into a clear error message that tells the user to run `eforge_daemon { action: "start" }`, `/eforge:restart`, or `eforge daemon start`.
4. `eforge_daemon { action: "stop" }` checks the lockfile/live server and uses a no-start stop request. It returns a stopped/not-running result when no live daemon exists.
5. Keep `packages/pi-eforge/package.json` version unchanged. If parity-preserving edits are needed in `eforge-plugin/skills/**`, bump `eforge-plugin/.claude-plugin/plugin.json` per repository policy.

## Scope

### In Scope

- Replace every `daemonRequest(...)` import/use in `packages/pi-eforge/extensions/eforge/` with non-starting request helpers.
- Replace Pi imports of route helpers backed by `daemonRequest(...)` with `*IfRunning` variants, or route those calls through an explicitly named Pi-local no-start wrapper.
- Keep the only `ensureDaemon(ctx.cwd)` calls in `packages/pi-eforge/` inside `eforge_daemon` action `start` and restart's post-stop start.
- Update ambient footer polling:
  - First refresh on `session_start` does not auto-start a daemon.
  - Repeated 5-second refreshes do not auto-start a daemon.
  - Missing or stale lockfile clears/leaves unset `eforge`, `eforge-build`, and `eforge-queue`.
- Update daemon stop/restart helpers so stop never starts a daemon.
- Preserve data shapes returned by Pi tools when a daemon is already running.
- Update Pi skills docs/error text that claim daemon connection failures auto-start.
- Maintain skill parity with the Claude Code plugin using `parity-skip` blocks for platform-specific daemon-start behavior, and bump the Claude Code plugin manifest version if plugin skill files are edited.
- Add regression and static policy tests.

### Out of Scope

- Daemon-level singleton/startup lock hardening.
- Changing MCP/Claude Code plugin daemon auto-start behavior.
- Bumping `packages/pi-eforge/package.json`.
- Bumping `DAEMON_API_VERSION`.

## Files

### Create

- `packages/pi-eforge/extensions/eforge/daemon-requests.ts` — Pi-local no-start request wrappers and standard daemon-not-running guidance.
- `test/pi-ambient-status-no-start.test.ts` — dynamic regression test proving session-start footer refresh does not execute `eforge daemon start` for missing or stale lockfiles.
- `test/pi-no-start-policy.test.ts` — static guard for Pi extension imports/calls and docs text.

### Modify

- `packages/pi-eforge/extensions/eforge/index.ts` — convert ambient status, tools, stop/start/restart lifecycle handling, auto-build, recovery, playbook, session-plan, profile/model/config/extension calls to no-start helpers; keep `ensureDaemon` only in explicit start/restart.
- `packages/pi-eforge/extensions/eforge/config-command.ts` — use Pi-local no-start wrapper and show explicit-start guidance in overlays on daemon absence.
- `packages/pi-eforge/extensions/eforge/profile-commands.ts` — use Pi-local no-start wrapper/helper variants for profile/model flows and refresh status passively.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — use `api*IfRunning` helpers plus the Pi-local required-daemon wrapper.
- `packages/pi-eforge/README.md` — clarify ambient status display is passive and does not start the daemon.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — replace daemon auto-start error guidance with explicit-start guidance.
- `packages/pi-eforge/skills/eforge-status/SKILL.md` — replace daemon auto-start error guidance with explicit-start guidance.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — replace daemon auto-start error guidance with explicit-start guidance.
- `packages/pi-eforge/skills/eforge-profile/SKILL.md` — replace daemon auto-start error guidance with explicit-start guidance.
- `packages/pi-eforge/skills/eforge-profile-new/SKILL.md` — replace daemon auto-start error guidance with explicit-start guidance.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — replace daemon auto-start error guidance with explicit-start guidance.
- `eforge-plugin/skills/build/build.md` — add matching parity-skip block if needed so skill parity passes while plugin text remains plugin-specific.
- `eforge-plugin/skills/status/status.md` — add matching parity-skip block if needed so skill parity passes while plugin text remains plugin-specific.
- `eforge-plugin/skills/config/config.md` — add matching parity-skip block if needed so skill parity passes while plugin text remains plugin-specific.
- `eforge-plugin/skills/profile/profile.md` — add matching parity-skip block if needed so skill parity passes while plugin text remains plugin-specific.
- `eforge-plugin/skills/profile-new/profile-new.md` — add matching parity-skip block if needed so skill parity passes while plugin text remains plugin-specific.
- `eforge-plugin/skills/playbook/playbook.md` — add matching parity-skip block if needed so skill parity passes while plugin text remains plugin-specific.
- `eforge-plugin/.claude-plugin/plugin.json` — bump version only if plugin skill files are edited for parity.

## Verification

- [ ] Invoking the captured Pi `session_start` handler with no lockfile leaves `eforge`, `eforge-build`, and `eforge-queue` unset/cleared and does not execute a fake `eforge` executable placed first in `PATH`.
- [ ] Invoking the captured Pi `session_start` handler with a stale lockfile leaves `eforge`, `eforge-build`, and `eforge-queue` unset/cleared and does not execute a fake `eforge` executable placed first in `PATH`.
- [ ] Static test finds zero `daemonRequest` imports/usages in `packages/pi-eforge/extensions/eforge/` other than `daemonRequestIfRunning` or the Pi-local wrapper name.
- [ ] Static test finds no Pi imports of client `api*` helpers lacking an `IfRunning` suffix, except non-request utilities/types and an explicit allowlist documented in the test.
- [ ] Static test finds exactly two `ensureDaemon(ctx.cwd)` calls in `packages/pi-eforge/`, both inside `eforge_daemon` start/restart handling.
- [ ] `eforge_daemon` action `stop` with no lockfile returns a stopped/not-running result and does not execute a fake `eforge` executable placed first in `PATH`.
- [ ] A representative non-lifecycle tool, such as `eforge_status`, returns or throws text containing `eforge_daemon { action: "start" }` when no daemon is running.
- [ ] Pi skill docs and Pi daemon-not-running error text no longer contain passive auto-start claims such as `daemon auto-starts`, `auto-start the daemon`, `auto starts the daemon`, or `automatically starts the daemon` outside explicit start/restart guidance.
- [ ] `packages/pi-eforge/package.json` version is unchanged by this plan.
- [ ] `pnpm docs:check-parity` passes.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm test -- pi-ambient-status-no-start pi-no-start-policy` passes.
