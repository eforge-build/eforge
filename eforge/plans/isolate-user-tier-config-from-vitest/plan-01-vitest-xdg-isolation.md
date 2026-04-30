---
id: plan-01-vitest-xdg-isolation
name: Isolate user-tier config in vitest via XDG_CONFIG_HOME
branch: isolate-user-tier-config-from-vitest/vitest-xdg-isolation
---

# Isolate user-tier config in vitest via XDG_CONFIG_HOME

## Architecture Context

The engine's user-tier config loader (`packages/engine/src/config.ts:694-699`, `loadUserConfig` at `packages/engine/src/config.ts:814-829`) and the user-scope helpers in `packages/engine/src/set-resolver.ts:71-75` and `packages/engine/src/config.ts:1015-1019` all derive their root from `process.env.XDG_CONFIG_HOME`, falling back to `homedir() + /.config` when unset. This is the documented, single-source path for the user config tier.

Vitest tests today inherit the developer's real `process.env.XDG_CONFIG_HOME` (or unset, which falls back to `~/.config`). Tests like `test/watch-queue.test.ts` (`describe('watchQueue')` starting at line 48) call `EforgeEngine.create({ cwd })` with a tmpdir prefixed `eforge-watch-test-` and then spawn real `eforge queue exec` subprocesses (`packages/engine/src/eforge.ts:1090`, `spawnPrdChild`, which forwards `process.env` unchanged). Both the in-test loader and the spawned children therefore pick up the developer's `~/.config/eforge/config.yaml`, including its `hooks` array. When the watcher's spawned PRDs fail in the tmpdir (no real infra), `session:end{status:'failed'}` fires the user's `notify-build.sh`, sending real Pushover notifications.

The fix isolates the user tier at the vitest level: a setup file creates a fresh empty tmpdir and overwrites `process.env.XDG_CONFIG_HOME` to point at it. Subprocesses inherit `process.env` by default in `spawnPrdChild`, so isolation reaches `eforge queue exec` children for free without threading anything through the spawn call. No production-code changes are needed — the env-var hook already exists and is documented.

## Implementation

### Overview

1. Add `test/setup-test-env.ts` — a vitest setup file that runs once per worker before any test code. It calls `mkdtempSync(join(tmpdir(), 'eforge-test-xdg-'))` and assigns the result to `process.env.XDG_CONFIG_HOME`. Cleanup is not required because the OS reaps `os.tmpdir()` and the dir stays empty. The setup file does *not* use `vi.stubEnv` because that would auto-restore between tests and unstubbing globally would re-expose the developer's real env; a direct `process.env` assignment is the correct shape for a global, persistent override.
2. Wire the setup file into `vitest.config.ts` by adding `setupFiles: ['./test/setup-test-env.ts']` to the existing `test` block.
3. Add `test/config-isolation.test.ts` — proves the env-var path is exercised in both directions: (a) under the global setup, `loadUserConfig()` returns `{}`; (b) when the test points `XDG_CONFIG_HOME` at a tmpdir containing a real `eforge/config.yaml`, `loadUserConfig()` returns the parsed config. Direction (b) uses `vi.stubEnv('XDG_CONFIG_HOME', tmpDirPath)` with `vi.unstubAllEnvs()` in `afterEach` so the setup-file value is restored for subsequent tests.

### Key Decisions

1. **Use `setupFiles`, not `globalSetup`.** `setupFiles` runs in each test worker's process so its `process.env` mutation is visible to the test code in the same process. `globalSetup` runs in a separate process and would not affect worker env.
2. **Direct `process.env.XDG_CONFIG_HOME = ...` in the setup file, not `vi.stubEnv`.** `vi.stubEnv` registers an auto-restore that would either be a no-op (no prior value to restore to) or, worse, restore to the developer's real value if anything ever calls `vi.unstubAllEnvs()` globally. A direct assignment in the setup file establishes the new value as the worker's baseline, and `vi.unstubAllEnvs()` in individual tests will restore back to that baseline (vitest tracks the value at stub time). This keeps per-test overrides via `vi.stubEnv` working correctly.
3. **Empty tmpdir, no cleanup.** The dir is created once per worker, contains nothing, and is never written to by the engine (the engine reads files; missing files return `{}` from `loadUserConfig`). OS tmp reaping handles eventual cleanup.
4. **No production-code changes.** The PRD explicitly forbids them and they are unnecessary — `getUserConfigPath` already honors `XDG_CONFIG_HOME` and is the single source of truth.
5. **Test the round-trip, not just the empty case.** Acceptance criterion 2(b) requires asserting that pointing `XDG_CONFIG_HOME` at a real config returns the parsed config. This proves the env-var path is wired, not bypassed by some other code path.

## Scope

### In Scope
- Create `test/setup-test-env.ts`.
- Add `setupFiles: ['./test/setup-test-env.ts']` to the `test` block in `vitest.config.ts`.
- Create `test/config-isolation.test.ts` with two assertions: (a) `loadUserConfig()` returns `{}` under the test-isolated env; (b) `loadUserConfig()` returns parsed config when `XDG_CONFIG_HOME` is stubbed to a tmpdir containing a real `eforge/config.yaml`.

### Out of Scope
- Refactoring `watch-queue.test.ts` to avoid spawning real PRD subprocesses (separate concern).
- Any change to `loadUserConfig`, `EforgeEngine.create`, or `spawnPrdChild` in `packages/engine/src/`.
- Documenting `XDG_CONFIG_HOME` as a test escape hatch in `AGENTS.md`.
- Changes to user-scope set-resolver helpers in `packages/engine/src/set-resolver.ts`.

## Files

### Create
- `test/setup-test-env.ts` — vitest setup file. Imports `mkdtempSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`. Creates a fresh tmpdir prefixed `eforge-test-xdg-` and assigns it to `process.env.XDG_CONFIG_HOME`. ~5-10 lines.
- `test/config-isolation.test.ts` — vitest test file. Imports `loadUserConfig` from `@eforge-build/engine/config` (matching the import style used by `test/config.test.ts`). Two `it` cases under one `describe`: (1) asserts `loadUserConfig()` returns `{}` under the global setup; (2) creates a tmpdir containing `eforge/config.yaml` with one parseable field (e.g. `maxConcurrentBuilds: 7`), calls `vi.stubEnv('XDG_CONFIG_HOME', thatTmpDir)`, asserts `loadUserConfig()` returns an object with `maxConcurrentBuilds === 7`. Use `vi.unstubAllEnvs()` in `afterEach` so the second test does not leak into other suites. Use the project's `useTempDir` helper from `test/test-tmpdir.ts` for cleanup of the seeded config dir.

### Modify
- `vitest.config.ts` — inside the existing `test: { ... }` block, add `setupFiles: ['./test/setup-test-env.ts']`. Place it adjacent to `include` to keep test-config concerns grouped. Do not modify the `server.deps`, `resolve.alias`, or eforge:region blocks.

## Verification

- [ ] `test/setup-test-env.ts` exists and assigns a fresh `mkdtempSync` path to `process.env.XDG_CONFIG_HOME`; the file performs the assignment at module top-level (no exported function), so import-for-side-effects is sufficient.
- [ ] `vitest.config.ts` contains `setupFiles: ['./test/setup-test-env.ts']` inside the `test` block.
- [ ] `test/config-isolation.test.ts` contains a test case that calls `loadUserConfig()` with no arguments and asserts the result deep-equals `{}`.
- [ ] `test/config-isolation.test.ts` contains a test case that: creates a tmpdir, writes `eforge/config.yaml` containing `maxConcurrentBuilds: 7`, calls `vi.stubEnv('XDG_CONFIG_HOME', tmpdir)`, calls `loadUserConfig()`, and asserts the returned object has `maxConcurrentBuilds === 7`. The test calls `vi.unstubAllEnvs()` in `afterEach`.
- [ ] `pnpm test` passes (full suite), including the existing `watch-queue.test.ts` cases at lines 86 and 135.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.
- [ ] Manual hook-fire check: with a hook entry in the developer's `~/.config/eforge/config.yaml` whose command writes a sentinel file (e.g. `touch /tmp/eforge-test-sentinel-$(date +%s)`), running `pnpm test` does not create any sentinel file matching that pattern. (Reviewer verifies by inspecting the test design — the hook cannot fire because spawned child processes inherit the isolated `XDG_CONFIG_HOME` and find no `config.yaml` there.)
- [ ] No file under `packages/engine/src/` is modified by this plan.
