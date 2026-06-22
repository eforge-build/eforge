---
title: Add Playful Daemon CLI Aliases
created: 2026-06-22
---

# Add Playful Daemon CLI Aliases

## Problem / Motivation

Developers want shorter, memorable top-level commands for common daemon lifecycle actions. The CLI currently exposes daemon lifecycle through explicit nested commands, and the new aliases should improve day-to-day ergonomics without making the explicit `eforge daemon ...` commands less canonical or making destructive force-kill behavior feel casual.

## Goal

Add playful top-level aliases for common daemon lifecycle commands while preserving the canonical `eforge daemon ...` command surface and existing daemon behavior.

## Approach

- Register top-level CLI commands in `packages/eforge/src/cli/index.ts`.
- Share implementation paths with existing daemon lifecycle handlers rather than copying start, stop, or restart logic inline.
- Keep explicit daemon commands as the canonical help and documentation targets.
- Keep this as a CLI registration and handler-sharing change.
- Inspect the Commander command tree from `createProgram(undefined, 'test')` to verify top-level commands exist, descriptions are clear, and options match canonical commands.
- Prefer tests that prove alias commands reference or route through the same handler path as canonical lifecycle commands.
- Avoid spinning up a real daemon unless an existing integration-test pattern already supports that safely.
- Watch for missing canonical restart command behavior.
- Watch for handler duplication drift.
- Watch for side-effectful daemon tests.
- Keep force-kill unaliased so destructive behavior stays explicit.

## Scope

- Add top-level `eforge ignite` as an alias for daemon start behavior.
- Add top-level `eforge reignite` as an alias for canonical daemon restart behavior.
- Add top-level `eforge douse` as an alias for daemon stop behavior.
- Preserve option parity for `ignite`, including start options such as `--port`.
- Preserve active-build safety behavior and `--force` handling for `douse` and `reignite` where applicable.
- Preserve existing explicit daemon commands as canonical help and documentation targets.
- Add related CLI command coverage in `test/`.
- Update generated/reference docs only if the CLI help snapshot/reference changes.
- Do not add any playful alias for `daemon kill`.
- Do not alter daemon HTTP routes.
- Do not alter engine events.
- Do not alter monitor state.
- Do not alter queue semantics.
- Do not alter client wire contracts.

## Acceptance Criteria

- `eforge ignite` starts the persistent daemon with the same guardrails as `eforge daemon start`.
- `eforge ignite` produces the same output as `eforge daemon start`.
- `eforge ignite` exits with the same exit codes as `eforge daemon start`.
- `eforge reignite` restarts the daemon with the same active-build guardrails as canonical restart behavior.
- `eforge reignite` produces the same output as canonical restart behavior.
- `eforge reignite` handles `--force` the same way as canonical restart behavior.
- `eforge reignite` exits with the same exit codes as canonical restart behavior.
- `eforge douse` stops the daemon with the same active-build guardrails as `eforge daemon stop`.
- `eforge douse` produces the same output as `eforge daemon stop`.
- `eforge douse` handles `--force` the same way as `eforge daemon stop`.
- `eforge douse` exits with the same exit codes as `eforge daemon stop`.
- `eforge --help` lists the top-level aliases clearly.
- `eforge daemon --help` continues to present explicit daemon commands as canonical.
- Alias command definitions reuse shared daemon lifecycle handlers or dispatch helpers.
- Lifecycle logic is not duplicated per alias.
- Tests or command-tree coverage verify alias registration.
- Tests or command-tree coverage verify option parity for the start alias.
- Tests or command-tree coverage verify option parity for the restart alias.
- Tests or command-tree coverage verify option parity for the stop alias.
- Tests or command-tree coverage verify dispatch for the start alias.
- Tests or command-tree coverage verify dispatch for the restart alias.
- Tests or command-tree coverage verify dispatch for the stop alias.
- No top-level alias is added for `daemon kill`.

## Manual Verification Notes

- Manually check `eforge --help` after implementation.
- Manually check `eforge ignite --help` after implementation.
- Manually check `eforge reignite --help` after implementation.
- Manually check `eforge douse --help` after implementation.
- Manually check `eforge daemon --help` after implementation.
- Run targeted CLI tests after implementation.
- Run `pnpm type-check` after targeted CLI tests.
- Run `pnpm docs:check` after `pnpm type-check`.
- Regenerate docs if generated CLI reference artifacts drift.