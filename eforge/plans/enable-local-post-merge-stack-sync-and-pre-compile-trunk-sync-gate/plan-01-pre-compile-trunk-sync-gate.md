---
id: plan-01-pre-compile-trunk-sync-gate
name: Pre-Compile Trunk Sync Gate
branch: enable-local-post-merge-stack-sync-and-pre-compile-trunk-sync-gate/plan-01-pre-compile-trunk-sync-gate
agents:
  builder:
    effort: high
    rationale: The implementation coordinates config parsing, git fetch/merge-base
      behavior, queue compile-base selection, tests with real repositories, and
      user-facing docs.
  reviewer:
    effort: high
    rationale: Review needs extra attention to non-mutating git guarantees and
      configured remote/ref subprocess handling.
---

# Pre-Compile Trunk Sync Gate

## Architecture Context

Queued root builds can currently compile from the local trunk ref selected by `resolveStackBaseContext()` or by `compile()`'s current-branch fallback. That leaves a stale-base gap when `origin/main` has advanced but local refs have not. The new gate belongs in the engine's queued-build path before `compile()` creates the merge worktree. It must select a build base without checking out, pulling, resetting, rebasing, or otherwise mutating local trunk.

Use the existing event surface for observability: emit `planning:progress` and/or `config:warning` diagnostics from `buildSinglePrd()` around trunk sync decisions. Do not add new event discriminants unless implementation discovers that existing event types cannot satisfy the diagnostics requirement; if new event types are added, update `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, and the client wire/schema tests in the same change.

## Implementation

### Overview

Add `build.trunkSync` config, implement a focused trunk sync helper, and invoke it from queued root builds before `compile(...)`. The helper fetches the configured remote trunk, resolves the fetched commit SHA, compares it to the local trunk ref, and returns the base ref/SHA that `compile()` must pass through `baseBranchOverride`. Child stacked PRDs continue using the parent artifact ref/commit from `resolveStackBaseContext()`.

### Key Decisions

1. Use an exact fetched SHA as the preferred build base for remote-ahead/equal cases. This makes the compile base reproducible if the remote branch moves later in the run.
2. Keep fetch/network behavior out of `resolveStackBaseContext()`. Base resolution remains a local topology lookup; `buildSinglePrd()` owns the pre-compile freshness gate and event emission.
3. Default config values: `enabled: true`, `remote: origin`, `strategy: fetchedRemoteRef`, `onDiverged: warn`. The documented default prevents stale local trunk bases while keeping an explicit disable knob for offline or local-only workflows.
4. Treat true divergence separately from remote-ahead staleness. Remote-ahead uses the fetched SHA. For true divergence, `onDiverged: warn` emits a diagnostic and falls back to the local trunk/base, `fail` fails before compile, and `use-remote` uses the fetched SHA with a diagnostic. Local-ahead-only uses the local trunk/base with a diagnostic because local trunk is not stale relative to the remote.
5. Use `execFile`/argument arrays for git commands and validate configured remote/trunk names before `git fetch`; reject empty names, names beginning with `-`, control characters, whitespace, and invalid branch refnames.

### Detailed Steps

1. **Config schema and defaults**
   - In `packages/engine/src/config.ts`, add a `trunkSync` object under `build` with schema fields:
     - `enabled?: boolean`
     - `remote?: string`
     - `strategy?: 'fetchedRemoteRef'`
     - `onDiverged?: 'warn' | 'fail' | 'use-remote'`
   - Add a resolved `TrunkSyncConfig` type or inline resolved type in `EforgeConfig['build']` with all four fields required after `resolveConfig()`.
   - Add `DEFAULT_CONFIG.build.trunkSync` using the defaults above.
   - Merge `fileConfig.build?.trunkSync` in `resolveConfig()` so omitted nested fields receive defaults.
   - Preserve existing `postMergeCommands`, `trunkBranch`, and `allowLocalMergeToTrunk` behavior.

2. **Trunk sync helper**
   - Create `packages/engine/src/trunk-sync.ts`.
   - Export types for result/status diagnostics, for example:
     - `TrunkSyncOutcome = 'disabled' | 'skipped' | 'remote-equal' | 'remote-ahead' | 'local-ahead' | 'diverged-use-local' | 'diverged-use-remote' | 'failed'`
     - result fields: `baseRef`, `trunkBranch`, `remote`, `localSha?`, `remoteSha?`, `outcome`, and diagnostic messages.
   - Implement a helper such as `prepareTrunkSyncBase({ cwd, config, candidateBase, parentPrdId })` that:
     - returns the candidate base unchanged when `build.trunkSync.enabled` is false;
     - returns unchanged when the queued PRD has a parent stack artifact (`parentPrdId` exists);
     - resolves the configured/detected trunk branch with `resolveTrunkBranch()`;
     - returns unchanged when the candidate base is not the trunk branch;
     - runs `git fetch --no-tags <remote> <trunkBranch>` without checkout/pull/reset/rebase;
     - resolves `FETCH_HEAD^{commit}` to a SHA;
     - resolves local `<trunkBranch>^{commit}` when present;
     - compares local and fetched remote via `git merge-base --is-ancestor`;
     - selects the fetched SHA for equal/remote-ahead cases;
     - applies `onDiverged` for true divergence;
     - emits a skip/fallback diagnostic and returns the original candidate base if the remote/trunk is unavailable and policy does not require failure.
   - Keep the helper deterministic and testable with real git repositories; do not depend on agent harnesses.

3. **Queued build integration**
   - In `packages/engine/src/eforge.ts`, import the helper.
   - In `buildSinglePrd()`, after stack context resolution and before `this.compile(...)`, compute a `compileBaseBranchOverride`:
     - For stacked root PRDs (`stackContext` exists and `stackContext.parentPrdId` is absent), start from `stackContext.baseBranch` and run the trunk sync helper.
     - For stacked child PRDs (`stackContext.parentPrdId` exists), keep `stackContext.baseBranch` unchanged.
     - For non-stacked queued builds, inspect the current branch; if it equals resolved trunk, run the helper and pass the selected base as `baseBranchOverride`; if it is any other branch, do not pass an override.
   - Yield `planning:progress` for start/complete/skip/fallback diagnostics and `config:warning` for warning-level fallback/divergence diagnostics. Include the PRD id and selected base SHA/ref in messages.
   - On `onDiverged: fail`, emit `plan:status:change` failed and `plan:error:set` before returning, mirroring the existing stack base failure path.
   - Leave `compile()`'s generic fallback unchanged for direct programmatic calls.

4. **Docs and generated references**
   - Update `docs/config.md` with the new `build.trunkSync` block and defaults.
   - Update `web/content/docs/configuration.md` with a user-facing section explaining pre-compile trunk freshness, default behavior, divergence policy, and the distinction from stack restacking/sync.
   - Update `packages/docs-gen/src/generators/config.ts` to add a generated reference section for `build.trunkSync`.
   - Regenerate and commit generated reference artifacts as required by `pnpm docs:check` (expected paths include `web/content/reference/config.md`, `web/public/reference/config.md`, and `web/public/schemas/config.schema.json`; include any additional docs-gen outputs that change).
   - If skill docs mention build config fields, update both `eforge-plugin/skills/config/config.md` and `packages/pi-eforge/skills/eforge-config/SKILL.md` with the same trunk sync summary; bump `eforge-plugin/.claude-plugin/plugin.json` if any file under `eforge-plugin/` changes.
   - Do not edit `eforge/config.yaml`.

5. **Tests**
   - Add or update `test/config.test.ts` cases for:
     - default `build.trunkSync` values;
     - parsing a full `build.trunkSync` block;
     - partial nested overrides retaining defaults;
     - `postMergeCommands` unchanged by config resolution.
   - Add `test/trunk-sync.test.ts` with real git repositories and a bare remote for:
     - remote trunk ahead of stale local trunk returns the fetched remote SHA;
     - current branch and local trunk SHA remain unchanged after the helper runs;
     - disabled config returns the original base and performs no fetch-observable ref change;
     - missing remote or missing remote branch returns the original base with a skip/fallback diagnostic;
     - true divergence obeys `warn`, `fail`, and `use-remote` policies;
     - feature-branch candidate bases are not retargeted to remote trunk;
     - child stack contexts are not retargeted.
   - Add a `createMergeWorktree()` regression in `test/worktree-integration.test.ts` proving a commit SHA base creates a merge worktree on the requested feature branch.
   - Add a targeted queued-build integration or focused helper test proving a root stacked PRD receives the fetched SHA while a child stacked PRD keeps the parent artifact base. Prefer testing the new selection helper directly unless an existing `EforgeEngine`/`StubHarness` test can exercise `buildSinglePrd()` without broad fixture setup.
   - Add a regression assertion that `eforge/config.yaml` still contains `pnpm install`, `pnpm build`, `pnpm type-check`, and `pnpm test`, and does not contain `eforge stack sync` in `build.postMergeCommands`.

## Scope

### In Scope

- Engine config, defaults, and config parsing for `build.trunkSync`.
- A non-mutating git fetch/compare/base-selection helper.
- Queued root build integration before compile worktree creation.
- Observability through existing run event diagnostics.
- Tests covering remote-ahead, divergence, skip/fallback, non-mutating local trunk behavior, child stack preservation, and feature-branch non-retargeting.
- Config documentation and generated reference artifacts.

### Out of Scope

- Adding `eforge stack sync` to `build.postMergeCommands`.
- Editing `eforge/config.yaml`.
- Daemon polling, scheduled trunk sync, or stack restacking.
- Checking out, pulling, resetting, rebasing, force-pushing, or switching the user's repo root branch.
- Changing git-spice provider behavior.
- Changing landing policy from PR to local merge.

## Files

### Create

- `packages/engine/src/trunk-sync.ts` — trunk fetch/compare/base-selection helper and diagnostics types.
- `test/trunk-sync.test.ts` — real-git tests for trunk sync outcomes and non-mutating guarantees.

### Modify

- `packages/engine/src/config.ts` — add `build.trunkSync` schema, resolved type, defaults, and merge handling.
- `packages/engine/src/eforge.ts` — invoke the trunk sync helper in `buildSinglePrd()` before `compile()` and emit diagnostics.
- `test/config.test.ts` — add trunk sync config/default/merge tests.
- `test/worktree-integration.test.ts` — add commit-SHA base regression for `createMergeWorktree()`.
- `docs/config.md` — document config block and defaults.
- `web/content/docs/configuration.md` — add guide section for pre-compile trunk freshness and stack sync separation.
- `packages/docs-gen/src/generators/config.ts` — add generated config reference content.
- Generated docs artifacts from `pnpm docs:generate` as required by `pnpm docs:check`.
- `eforge-plugin/skills/config/config.md` and `packages/pi-eforge/skills/eforge-config/SKILL.md` only if skill docs need config-field parity updates; bump `eforge-plugin/.claude-plugin/plugin.json` if the plugin docs change.

## Verification

- [ ] `resolveConfig({}).build.trunkSync` equals `{ enabled: true, remote: 'origin', strategy: 'fetchedRemoteRef', onDiverged: 'warn' }`.
- [ ] A partial config such as `{ build: { trunkSync: { enabled: false } } }` retains default `remote`, `strategy`, and `onDiverged` values.
- [ ] A root queued stacked PRD whose local `main` is behind fetched remote `main` passes the fetched remote SHA to compile worktree creation.
- [ ] A child stacked PRD with a recorded parent artifact uses that artifact branch or commit as the compile base.
- [ ] A queued build started from a non-trunk feature branch does not receive remote trunk as `baseBranchOverride`.
- [ ] Tests prove the helper does not run `git checkout`, `git pull`, `git reset`, or `git rebase`, and local trunk SHA/current branch remain unchanged after sync.
- [ ] Diverged local trunk tests cover `warn`, `fail`, and `use-remote` outcomes.
- [ ] Skip, failure, and fallback outcomes emit `planning:progress` or `config:warning` events in the run stream.
- [ ] `eforge/config.yaml` remains unchanged: existing `pnpm install`, `pnpm build`, `pnpm type-check`, and `pnpm test` commands are present, and `eforge stack sync` is absent.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm test` exits 0.
