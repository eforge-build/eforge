---
id: plan-01-daemon-cli-aliases
name: Add daemon lifecycle CLI aliases
branch: add-playful-daemon-cli-aliases/plan-01-daemon-cli-aliases
---

# Add daemon lifecycle CLI aliases

## Architecture Context

The eforge CLI is built from `packages/eforge/src/cli/index.ts` with Commander and the generated CLI reference walks that command tree through `buildEforgeCommand()`. The daemon lifecycle surface currently has canonical nested commands for `daemon start`, `daemon stop`, `daemon status`, and `daemon kill`; there is no canonical `daemon restart`, and there are no top-level playful aliases. The change stays in the CLI registration/handler layer: no daemon HTTP routes, engine events, monitor state, queue semantics, or client wire contracts change.

## Implementation

### Overview

Add shared daemon lifecycle command handlers and register both canonical daemon commands and top-level aliases against those same handler functions:

- `eforge ignite` -> same action handler and options as `eforge daemon start`
- `eforge douse` -> same action handler and options as `eforge daemon stop`
- `eforge reignite` -> same action handler and options as new canonical `eforge daemon restart`

Create command-tree tests that inspect `createProgram(undefined, 'test')` without starting a real daemon.

### Key Decisions

1. Add canonical `eforge daemon restart` before registering `reignite`, because the source calls out missing canonical restart behavior and requires aliases to preserve the canonical command surface.
2. Extract start/stop/restart handler logic into a shared CLI lifecycle module or shared functions so aliases and canonical commands reference the same handler function objects; do not copy daemon start, stop, or restart logic per command.
3. Keep `--port` scoped to start/ignite. Register `--force` on stop/douse and restart/reignite. Do not add a `--port` option to restart unless both canonical restart and `reignite` receive it in the same shared option helper.
4. Preserve all existing start/stop output strings and exit-code behavior by moving logic without semantic edits. Restart may compose the existing stop/start helpers and must stop before starting unless the stop flow aborts.
5. Do not add a top-level alias for `daemon kill`.

## Scope

### In Scope

- Register top-level `ignite`, `reignite`, and `douse` commands in the CLI command tree.
- Add canonical `daemon restart` and share its handler with `reignite`.
- Share start, stop, restart handlers and option-registration helpers between canonical commands and aliases.
- Preserve active-build safety and `--force` behavior for stop/douse and restart/reignite.
- Preserve start `--port` behavior for start/ignite.
- Add command-tree tests for registration, help text, option parity, handler identity, and absence of a kill alias.
- Regenerate CLI reference artifacts if `pnpm docs:check` reports drift.

### Out of Scope

- Adding any top-level alias for `daemon kill`.
- Changing daemon HTTP routes, client route constants, daemon API version, event schemas, monitor state projection, queue behavior, or engine behavior.
- Spinning up a real daemon in the new alias tests.
- Promoting playful aliases as the canonical documentation target outside generated CLI reference output.
- Changing Claude Code plugin or Pi extension daemon tools; those surfaces already expose explicit daemon lifecycle controls and the source scope is CLI-only.

## Files

### Create

- `packages/eforge/src/cli/daemon-lifecycle.ts` — Shared daemon start/stop/restart handlers and option helpers. Keep the file under 600 lines, and preferably under 300 lines so durable region markers are not needed.
- `test/daemon-cli-aliases.test.ts` — Command-tree tests using `createProgram(undefined, 'test')`; no daemon process startup.

### Modify

- `packages/eforge/src/cli/index.ts` — Remove inline start/stop action bodies, import shared lifecycle handlers/helpers, register canonical `daemon restart`, and register top-level `ignite`, `reignite`, and `douse` commands with clear alias descriptions.
- `packages/docs-gen/src/generators/cli.ts` — If daemon lifecycle logic moves to a new file, include `packages/eforge/src/cli/daemon-lifecycle.ts` in the CLI reference provenance `sourceFiles` list.
- `web/content/reference/cli.md` — Regenerated CLI reference output if the command tree changes.
- `web/public/reference/cli.md` — Regenerated public CLI reference output if the command tree changes.

## Test Plan

- In `test/daemon-cli-aliases.test.ts`, find commands from `createProgram(undefined, 'test')` and assert top-level command names include `ignite`, `reignite`, and `douse`.
- Assert no top-level command named `kill` exists.
- Assert `program.helpInformation()` contains the three alias names and descriptions that mention their canonical `eforge daemon ...` commands.
- Assert `daemon.helpInformation()` still lists explicit `start`, `stop`, `restart`, `status`, and `kill` daemon subcommands.
- Compare option signatures for `daemon start` and `ignite` (`--port <port>`), `daemon stop` and `douse` (`--force`), and `daemon restart` and `reignite` (`--force`).
- Compare Commander action handler identity for each canonical command and alias. An isolated test helper may read Commander’s private `_actionHandler` field via a narrow cast.

## Verification

- [ ] `createProgram(undefined, 'test')` top-level command names include `ignite`, `reignite`, and `douse`.
- [ ] `createProgram(undefined, 'test')` top-level command names exclude `kill`.
- [ ] `eforge --help` output from Commander includes `ignite`, `reignite`, and `douse` with descriptions that name their canonical `eforge daemon ...` commands.
- [ ] `eforge daemon --help` output from Commander includes `start`, `stop`, `restart`, `status`, and `kill`.
- [ ] `ignite` and `daemon start` expose matching option signatures, including `--port <port>`.
- [ ] `douse` and `daemon stop` expose matching option signatures, including `--force`.
- [ ] `reignite` and `daemon restart` expose matching option signatures, including `--force`.
- [ ] The `ignite` action handler object equals the `daemon start` action handler object.
- [ ] The `douse` action handler object equals the `daemon stop` action handler object.
- [ ] The `reignite` action handler object equals the `daemon restart` action handler object.
- [ ] `pnpm test -- test/daemon-cli-aliases.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm docs:check` exits 0 after generated CLI reference artifacts are updated.
- [ ] `pnpm maintainability:check` exits 0.