---
id: plan-01-config-and-trunk-resolution
name: "Config foundation: trunk branch policy and .eforge/queue default"
branch: branch-aware-landing-and-queue-provenance-split-for-eforge-builds/plan-01-config-and-trunk-resolution
agents:
  builder:
    effort: high
    rationale: Touches the central config schema and the default queue-path literal
      scattered across the monitor server; needs careful regression-free edits.
---

## Architecture Context

Eforge currently defaults `prdQueue.dir` to `eforge/queue`, a normal tracked path, and has no explicit notion of the project's trunk branch. Build-time landing logic detects the base branch from the user's checked-out HEAD with no policy hooks. This plan establishes the engine config surface and the single trunk-resolution helper that subsequent plans (queue/provenance split, branch-aware landing, init UX) depend on.

## Implementation

### Overview

1. Extend `eforgeConfigSchema` and the `EforgeConfig` runtime type with two new fields under `build`: `trunkBranch?: string` and `allowLocalMergeToTrunk: boolean` (default `false`).
2. Change the default `prdQueue.dir` from `eforge/queue` to `.eforge/queue`.
3. Update every hardcoded `'eforge/queue'` literal in the monitor server's fallback path to use `.eforge/queue` so daemon snapshots, queue listings, recovery file path, and auto-build wake paths agree with the new default when no config is loaded.
4. Add a new `packages/engine/src/branch-policy.ts` module exporting `resolveTrunkBranch(config, cwd): Promise<string>` and `isTrunkBranch(branch, trunk): boolean`. `resolveTrunkBranch` returns `config.build.trunkBranch` when set, otherwise falls back to `git symbolic-ref refs/remotes/origin/HEAD --short` stripped of the `origin/` prefix, otherwise `main`. The existing `deriveBaseBranch` helper in `packages/engine/src/recovery/failure-summary.ts` should be replaced by a call to this shared helper.
5. Re-export the helpers from `packages/engine/src/index.ts` so the daemon, CLI, and pi-eforge extension can import them.
6. Update config tests (`test/config.test.ts`, `packages/engine/test/config.legacy-rejection.test.ts`) and add a new `test/branch-policy.test.ts` covering trunk resolution precedence.

### Key Decisions

1. **Config field names** — Use `build.trunkBranch` and `build.allowLocalMergeToTrunk` exactly as the source PRD proposed. No abbreviations; explicit policy names so future contributors don't conflate trunk identity with trunk merge policy.
2. **Default queue path** — `.eforge/queue` matches the existing gitignored `.eforge/` runtime area; no migration of legacy `eforge/queue` paths is performed in this plan. Existing project configs that already set `prdQueue.dir: eforge/queue` continue to work unchanged because the user-provided value still wins over the new default.
3. **Trunk-resolution helper lives in engine, not landing.ts** — Recovery, monitor projections, and skill-facing tools all need trunk identity. Keeping it in a small `branch-policy.ts` module avoids a circular dep with `landing.ts`.
4. **`allowLocalMergeToTrunk` defaults to `false`** — Team-safe by default; solo developers opt in via `/eforge:init` or by editing config directly.

## Scope

### In Scope

- Add `build.trunkBranch` and `build.allowLocalMergeToTrunk` to the config schema, defaults, `EforgeConfig` type, and `resolveConfig` merge.
- Change `DEFAULT_CONFIG.prdQueue.dir` from `'eforge/queue'` to `'.eforge/queue'`.
- Update every `?? 'eforge/queue'` fallback literal in `packages/monitor/src/server.ts` (6 occurrences identified at lines 701, 859, 1340, 2110, 3422, 4227) to `'.eforge/queue'`.
- Add `packages/engine/src/branch-policy.ts` with `resolveTrunkBranch` and `isTrunkBranch` helpers, exported from `packages/engine/src/index.ts`.
- Replace `deriveBaseBranch` in `packages/engine/src/recovery/failure-summary.ts` with a call to `resolveTrunkBranch(config, cwd)`. The recovery summary call site does not have a full `config` available today, so accept an optional `trunkBranch` override and fall back to a config-less `resolveTrunkBranch(undefined, cwd)` path which still does the `origin/HEAD`-then-`main` detection.
- Test updates: `test/config.test.ts` for new defaults + merge behavior; `packages/engine/test/config.legacy-rejection.test.ts` to ensure no regression for the existing legacy `prdQueue.dir: 'eforge/queue'` config.
- New `test/branch-policy.test.ts` covering: (a) configured `trunkBranch` wins; (b) `origin/HEAD` detection; (c) `main` fallback; (d) `isTrunkBranch` equality semantics.

### Out of Scope

- Stopping enqueue commits, materializing PRD provenance artifacts, and any landing-policy logic — all deferred to plans 02 and 03.
- Migration tooling for existing tracked `eforge/queue` files.
- Updating user docs and skills (Plan 04).
- Updating `eforge_init` MCP tool schema (Plan 04).

## Files

### Create

- `packages/engine/src/branch-policy.ts` — `resolveTrunkBranch(config | undefined, cwd)` and `isTrunkBranch(branch, trunk)`; uses `execFile('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], { cwd })` with `origin/` stripped, falling back to `main` on error.
- `test/branch-policy.test.ts` — covers configured branch, `origin/HEAD` detection (using a temp git repo with a fake remote ref), and `main` fallback; covers `isTrunkBranch` equality.

### Modify

- `packages/engine/src/config.ts` — Extend `eforgeConfigBaseSchema.build` shape with `trunkBranch: z.string().optional()` and `allowLocalMergeToTrunk: z.boolean().optional()`. Update the `EforgeConfig.build` runtime type to include `trunkBranch?: string` and `allowLocalMergeToTrunk: boolean`. Update `DEFAULT_CONFIG.build` (`allowLocalMergeToTrunk: false`, `trunkBranch: undefined`). Update `DEFAULT_CONFIG.prdQueue.dir` to `'.eforge/queue'`. Update `resolveConfig` merge in the `build` block to propagate the two new fields. Place the new fields inside the existing `eforge:region plan-01-engine-config-and-landing` region.
- `packages/engine/src/index.ts` — Re-export `resolveTrunkBranch`, `isTrunkBranch`, and the `BranchPolicy` types from `./branch-policy.js`.
- `packages/monitor/src/server.ts` — Replace each `?? 'eforge/queue'` fallback (6 occurrences) with `?? '.eforge/queue'`. Keep the `options.queueDir` parameter precedence unchanged.
- `packages/engine/src/recovery/failure-summary.ts` — Replace the local `deriveBaseBranch` function with a call to `resolveTrunkBranch(undefined, cwd)`. Leave the existing call site (`buildFailureSummary`) untouched in signature.
- `test/config.test.ts` — Add cases: `DEFAULT_CONFIG.prdQueue.dir === '.eforge/queue'`; `DEFAULT_CONFIG.build.allowLocalMergeToTrunk === false`; `DEFAULT_CONFIG.build.trunkBranch === undefined`; a user-provided `prdQueue.dir: 'eforge/queue'` round-trips through `resolveConfig`; a user-provided `build.trunkBranch: 'develop'` and `build.allowLocalMergeToTrunk: true` round-trip.
- `packages/engine/test/config.legacy-rejection.test.ts` — Ensure the test that passes `prdQueue: { dir: 'eforge/queue' }` still parses successfully (it tests that the schema accepts a custom dir, not that it equals the default).

## Verification

- [ ] `DEFAULT_CONFIG.prdQueue.dir === '.eforge/queue'` in a fresh `resolveConfig({})` call.
- [ ] `DEFAULT_CONFIG.build.allowLocalMergeToTrunk === false` and `DEFAULT_CONFIG.build.trunkBranch === undefined` in a fresh `resolveConfig({})` call.
- [ ] `resolveConfig({ build: { trunkBranch: 'develop', allowLocalMergeToTrunk: true } })` returns `build.trunkBranch === 'develop'` and `build.allowLocalMergeToTrunk === true`.
- [ ] A user setting `prdQueue.dir: 'eforge/queue'` in `eforge/config.yaml` still resolves to `prdQueue.dir === 'eforge/queue'` (back-compat).
- [ ] `resolveTrunkBranch({ build: { trunkBranch: 'develop' } } as any, cwd)` returns `'develop'` without spawning git.
- [ ] `resolveTrunkBranch(undefined, cwd)` in a temp repo whose `origin/HEAD` points at `origin/dev` returns `'dev'`.
- [ ] `resolveTrunkBranch(undefined, cwd)` in a temp repo with no `origin/HEAD` returns `'main'`.
- [ ] `isTrunkBranch('main', 'main') === true`; `isTrunkBranch('feature/x', 'main') === false`.
- [ ] `pnpm type-check` and `pnpm test` pass.
- [ ] All 6 hardcoded `'eforge/queue'` fallbacks in `packages/monitor/src/server.ts` are now `'.eforge/queue'` (verified by grep: `grep -n "'eforge/queue'" packages/monitor/src/server.ts` returns no results).