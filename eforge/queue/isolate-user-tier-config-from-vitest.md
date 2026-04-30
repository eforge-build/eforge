---
title: Isolate user-tier config from vitest
created: 2026-04-30
---

# Isolate user-tier config from vitest

## Problem / Motivation

Tests in `test/watch-queue.test.ts` spawn real `eforge queue exec` subprocesses (via `EforgeEngine.spawnPrdChild` at `packages/engine/src/eforge.ts:1090`). Each subprocess calls `loadConfig(cwd)` from a vitest tmpdir, which walks up and pulls in `~/.config/eforge/config.yaml` (the user-tier global config). For users who configure `hooks` in that file, this fires their real hook scripts during test runs.

Concrete symptom observed today: 4 real Pushover notifications ("eforge: session FAILED — eforge-watch-test-Ag8186") fired during the validation phase of an unrelated build, because:

- Two test cases in `watch-queue.test.ts` (lines 86, 135) write PRD files into tmpdirs prefixed `eforge-watch-test-`.
- The watcher spawns child PRD processes against them.
- The children load user-tier hooks.
- The PRDs fail (no real infra in tmpdir).
- `session:end{status:'failed'}` fires the user's `notify-build.sh`.
- Pushover sends.

This affects more than hooks: user-tier profiles (`~/.config/eforge/profiles/`), `monitors.json`, and `.active-profile` are also pulled into tests today.

## Goal

Tests must not read or apply any user-tier config (hooks, profiles, monitors, or active-profile markers), regardless of what the developer has in `~/.config/eforge/`. This must hold both for in-test `loadConfig` calls and for any subprocess (`eforge queue exec`, `eforge run`, etc.) that the tests spawn.

## Approach

Isolate `XDG_CONFIG_HOME` at the vitest level. `loadUserConfig` (`packages/engine/src/config.ts:814-829`) and the user-scope helpers in `set-resolver.ts:71-73` and `config.ts:1015-1021` already honor `XDG_CONFIG_HOME` as the override for `~/.config`. Pointing it at an empty tmpdir cleanly disables every user-tier source in one move.

**Critical files:**
- `test/setup-test-env.ts` (new) — creates a fresh tmpdir via `mkdtempSync(join(tmpdir(), 'eforge-test-xdg-'))` and sets `process.env.XDG_CONFIG_HOME` to it. No cleanup needed (OS reaps tmp).
- `vitest.config.ts` — add `setupFiles: ['./test/setup-test-env.ts']` to the existing `test` block.

**Why this shape (not alternatives):**
- Subprocesses inherit env by default in `spawnPrdChild` (no `env` override at `eforge.ts:1090`), so the isolation reaches `eforge queue exec` children for free. No need to thread anything through the spawn call.
- No production-code changes — `XDG_CONFIG_HOME` is already the documented user-config root, used identically by both the engine and `set-resolver`.
- Per-test override stays trivial via `vi.stubEnv('XDG_CONFIG_HOME', somePath)` for any test that genuinely wants to assert user-config behavior.

**Reuse, don't reinvent:**
- `getUserConfigPath` (`packages/engine/src/config.ts:694-699`) already reads `XDG_CONFIG_HOME` and is the single source of truth for the user config path. The fix piggybacks on it; no new helpers.

## Scope

**In scope:**
- `test/setup-test-env.ts` (new file, ~5 lines)
- `vitest.config.ts` (one-line `setupFiles` addition)
- One new test (e.g. `test/config-isolation.test.ts`) that asserts `loadUserConfig()` returns `{}` under the test env, even when `~/.config/eforge/config.yaml` exists on the developer's machine. Use `vi.stubEnv` to verify both directions.

**Out of scope:**
- Refactoring `watch-queue.test.ts` to not spawn real PRD subprocesses (separate concern; the API-call cost of those spawns is a different issue).
- Any production-code changes to `loadUserConfig`, `EforgeEngine.create`, or `spawnPrdChild`.
- Documentation of `XDG_CONFIG_HOME` as a test escape hatch (consider adding to `AGENTS.md` if it surfaces in future PRs).

## Acceptance Criteria

1. Running `pnpm test` with hooks present in `~/.config/eforge/config.yaml` does not fire any of those hooks. Verified by adding a temporary hook that touches a sentinel file and confirming the file is not created after a full test run.
2. The new `test/config-isolation.test.ts` passes and asserts:
   - **(a)** `loadUserConfig()` returns `{}` under the test-isolated `XDG_CONFIG_HOME`, and
   - **(b)** setting `XDG_CONFIG_HOME` to a directory containing a real `eforge/config.yaml` (constructed in a tmpdir within the test) returns the parsed config — proving the env-var path is exercised, not bypassed.
3. `pnpm test`, `pnpm type-check`, and `pnpm build` all pass.
4. No regression in existing tests — `watch-queue.test.ts` and friends still pass with their current assertions.
