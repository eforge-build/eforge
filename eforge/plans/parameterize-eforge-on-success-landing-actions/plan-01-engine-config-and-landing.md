---
id: plan-01-engine-config-and-landing
name: Engine config, landing events, and finalize refactor
branch: parameterize-eforge-on-success-landing-actions/plan-01-engine-config-and-landing
agents:
  builder:
    effort: high
    rationale: Touches the engine finalize phase, introduces a new event family in
      the closed wire schema, refactors the success-status derivation away from
      featureBranchMerged, and adds a gh-CLI subprocess wrapper with
      PR-already-exists handling. Easy to get subtly wrong.
  reviewer:
    effort: high
    rationale: Wire-protocol additions and engine lifecycle semantics need a careful
      read; downstream consumers depend on the event shapes being correct on
      first land.
---

# Engine config, landing events, and finalize refactor

## Architecture Context

eforge builds today finalize by squash-merging the engine-managed feature branch (`eforge/<set>`) into the captured base branch inside `repoRoot`. The whole success/failure derivation in `packages/engine/src/orchestrator/phases.ts::finalize` hinges on a single boolean `ctx.featureBranchMerged`. This plan generalises that into a parameterised landing action with three modes: `merge-to-base-branch` (preserves existing behaviour), `issue-pr` (push + `gh pr create`), and `leave-branch` (no merge, no PR).

The new config field lives under `build.onSuccess` to sit next to existing build lifecycle fields (`postMergeCommands`, `postMergeCommandTimeoutMs`, `maxValidationRetries`, `cleanupPlanFiles`). Missing values resolve to `merge-to-base-branch` so existing configs preserve current behaviour. New events `landing:start`, `landing:complete`, and `landing:skipped` are added to the closed wire schema in `@eforge-build/client`. For backward compatibility, `merge:finalize:*` continues to be emitted **in addition to** `landing:*` when the action is `merge-to-base-branch`.

Key constraints from AGENTS.md:
- The engine emits, consumers render — landing actions execute in the engine, not in Pi/Claude.
- `EforgeEvent` is derived from `EforgeEventSchema` in `packages/client/src/events.schemas.ts`; every new event variant lives there with its TypeBox schema and is validated through `safeParseEforgeEvent`.
- The engine commits via `forgeCommit()` from `packages/engine/src/git.ts` with `composeCommitMessage(body, modelTracker)` from `packages/engine/src/model-tracker.ts`. Landing commits stay model-tracker-aware where applicable.

This plan is the foundation: it does not yet expose the per-build override over the daemon HTTP API or in PRD frontmatter (that's plan-02), and it does not change Pi/Claude tool schemas or skill copy (that's plan-03).

## Implementation

### Overview

1. Extend the config schema in `packages/engine/src/config.ts` with `build.onSuccess`.
2. Add `landing:start`, `landing:complete`, `landing:skipped` event variants in `packages/client/src/events.schemas.ts` and register them in `packages/client/src/event-registry.ts`.
3. Add helpers in `packages/engine/src/worktree-ops.ts` for `pushFeatureBranch`, `createPullRequestViaGh`, and `getExistingPrUrl`.
4. Add `executeLandingAction` on `WorktreeManager` (or a new module called from `finalize`) that dispatches on the resolved action.
5. Refactor `finalize()` in `packages/engine/src/orchestrator/phases.ts` to:
   - Accept `onSuccess: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'` from `PhaseContext`.
   - Run the chosen action; emit `landing:*` events for all three and additionally emit `merge:finalize:*` only for `merge-to-base-branch`.
   - Replace `ctx.featureBranchMerged ? 'completed' : 'failed'` with `ctx.landingSucceeded ? 'completed' : 'failed'`.
6. Gate branch cleanup in `packages/engine/src/orchestrator.ts` — only delete `featureBranch` after `merge-to-base-branch` succeeds; never delete it after `issue-pr` or `leave-branch`.
7. Resolve effective `onSuccess` in `packages/engine/src/eforge.ts` (`build` and `buildSinglePrd` paths) from `BuildOptions.onSuccess ?? config.build.onSuccess` and pass into `Orchestrator`.
8. Add `onSuccess?: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'` to `BuildOptions` and `EnqueueOptions` in `packages/engine/src/events.ts`.
9. Add tests covering: config defaulting/merging, schema rejection of invalid values, all three landing actions in the orchestrator finalize phase, PR-already-exists handling, branch-cleanup safety per action, and wire parity for the new events.

### Key Decisions

1. **`build.onSuccess` placement next to `postMergeCommands`.** Mirrors the source — existing build lifecycle fields are co-located, and config docs/skills already explain `build.*` settings as a unit. Implemented as `z.enum(['merge-to-base-branch', 'issue-pr', 'leave-branch']).optional()`; default in `DEFAULT_CONFIG.build` is `'merge-to-base-branch'`; `resolveConfig()` falls back to default when the file value is undefined. Both the schema and the resolved `EforgeConfig['build']` type carry the field. This preserves backward compatibility for existing configs (Source: Acceptance Criteria 1).
2. **`landing:*` events ride alongside `merge:finalize:*` for the direct-merge action.** The source explicitly requires `merge:finalize:*` to keep working for the `merge-to-base-branch` action so existing monitor/client consumers don't regress. We *additionally* emit `landing:start`/`landing:complete` in that path so future consumers can subscribe to a single uniform event family. `issue-pr` and `leave-branch` emit only `landing:*` events. This is the cleanest long-term wire protocol with the minimum migration cost (Source: Design Decision 4).
3. **Generalise `featureBranchMerged` to `landingSucceeded`.** Final status determination in `finalize` and the branch-cleanup gate in `orchestrator.ts` both switch from `featureBranchMerged` to `landingSucceeded`. The new flag is set true when any of the three actions completes successfully. Branch deletion stays gated on `merge-to-base-branch` specifically — for `issue-pr` and `leave-branch` the feature branch must remain so the PR/manual workflow can reference it (Source: Design Decision 5, Risks: Branch cleanup).
4. **`issue-pr` uses `gh pr create --base <base> --head <feature> --fill`.** Source explicitly says use `gh` rather than the GitHub REST API. The implementation:
   - Pushes the feature branch with `git push -u origin <featureBranch>` from the merge worktree.
   - Runs `gh pr create --base <baseBranch> --head <featureBranch> --fill`.
   - On non-zero exit, parses stderr for the existing-PR signal (gh prints a recognisable message containing `a pull request for branch` and a URL); if detected, runs `gh pr view <featureBranch> --json url -q .url` and reports that URL on `landing:complete`.
   - On any other failure, emits `landing:skipped` with a clear reason and sets `state.status = 'failed'` (Source: Design Decision 3).
5. **Policy gates continue to run only before `merge-to-base-branch`.** This plan keeps the existing `final-merge` policy gate scope unchanged — it runs only on the merge-to-base path. Extending policy gates to PR/branch-leave actions is explicitly out of scope per the source ("Changing per-plan internal parallelism/merge semantics except as needed to keep final landing safe"). The current region-gated block in `phases.ts::finalize` stays inside the `merge-to-base-branch` arm of the new switch.
6. **No change to extension types' surface.** The policy-gate context types and `getFinalMergeDiff` are not generalised in this plan — they keep their `merge:`/`final-merge` naming so the extension-runtime regions stay intact.

## Scope

### In Scope
- `build.onSuccess` config field with schema, default, type, and resolution.
- `landing:start`, `landing:complete`, `landing:skipped` event variants with TypeBox schemas, event-registry entries, and wire-parity tests.
- Engine helpers for push, `gh pr create`, `gh pr view`.
- `finalize()` refactor that dispatches on the configured action.
- Replacement of `featureBranchMerged` with a more general `landingSucceeded` flag in `PhaseContext` and in the orchestrator branch-cleanup gate.
- Engine option plumbing: `BuildOptions.onSuccess`, `EnqueueOptions.onSuccess`, `OrchestratorOptions.onSuccess`.
- `eforge.ts::build` and `eforge.ts::buildSinglePrd` resolve the effective `onSuccess` and pass it into `Orchestrator`.
- Tests for the new behaviour (config, events, all three actions, branch-cleanup safety).

### Out of Scope
- Daemon HTTP API surface changes (EnqueueRequest, monitor server validation) — plan-02.
- PRD frontmatter `onSuccess` persistence and queue-exec child arg propagation — plan-02.
- CLI `--on-success` flag on `enqueue`, `queue exec`, `build` — plan-02.
- Monitor UI rendering for landing events — plan-02.
- Pi extension and Claude plugin tool-schema updates — plan-03.
- Skill markdown updates (`/eforge:init`, `/eforge:build`, `/eforge:config` in both surfaces) — plan-03.
- Public docs site updates — plan-03.
- Extending policy gates to non-merge landing actions.
- Hosted GitHub API integration that bypasses `gh`.

## Files

### Create
- `packages/engine/src/landing.ts` — `executeLandingAction({ action, ctx })` async generator that emits `landing:*` events (and `merge:finalize:*` for the merge action), wraps `worktreeManager.mergeToBase`, the new push + gh helpers, and a no-op leave-branch path. Returns `{ landingSucceeded: boolean, prUrl?: string, commitSha?: string }`.
- `test/landing-actions.test.ts` — integration-style tests exercising all three actions through a real `WorktreeManager` against a temp git repo (use existing fixtures pattern from `test/worktree-integration.test.ts`). Covers: merge action emits both `landing:*` and `merge:finalize:*`; `issue-pr` emits only `landing:*`; `leave-branch` emits only `landing:*`; `issue-pr` detects existing PR via stubbed `gh` shim; branch is preserved on `issue-pr` and `leave-branch`, deleted on `merge-to-base-branch`.
- `test/onsuccess-config.test.ts` — config defaulting, merging, and validation. Asserts missing field resolves to `merge-to-base-branch`, all three enum values parse, invalid strings are rejected, and `eforge_config validate` surfaces the same error via the existing validation path.

### Modify
- `packages/engine/src/config.ts` — add `onSuccess: z.enum([...]).optional()` to the `build` object in `eforgeConfigBaseSchema`; add `onSuccess: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'` to the `EforgeConfig['build']` type; add `onSuccess: 'merge-to-base-branch'` to `DEFAULT_CONFIG.build`; extend `resolveConfig()` to fall back to default when `fileConfig.build?.onSuccess` is undefined.
- `packages/client/src/events.schemas.ts` — add three `Type.Object` literals to the union: `landing:start { action, featureBranch, baseBranch }`, `landing:complete { action, featureBranch, baseBranch, commitSha?, prUrl? }`, `landing:skipped { action, featureBranch, baseBranch, reason }`. Use `Type.Union([Type.Literal('merge-to-base-branch'), Type.Literal('issue-pr'), Type.Literal('leave-branch')])` for `action`.
- `packages/client/src/event-registry.ts` — register the three new events with `scope: 'session'`, `persist: false`, and human-readable `summary` functions.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add one valid-payload fixture per new event variant, plus one invalid-action rejection case.
- `packages/engine/src/worktree-ops.ts` — add `pushFeatureBranch(cwd, branch, remote = 'origin')`, `createPullRequest(cwd, { baseBranch, featureBranch })` (runs `gh pr create --base ... --head ... --fill`, returns `{ url }`), and `getExistingPullRequestUrl(cwd, featureBranch)` (runs `gh pr view <branch> --json url -q .url`, returns `string | null` — null means no PR found rather than throwing). Add a guard helper `ensureGhAvailable(cwd)` that runs `gh --version` and throws a descriptive error if unavailable.
- `packages/engine/src/worktree-manager.ts` — add `pushFeatureBranch()` and `issuePr({ baseBranch })` and `leaveBranch()` thin wrappers that delegate to the new `worktree-ops` helpers, keyed off `this.mergeWorktreePath`. Keep `mergeToBase()` unchanged.
- `packages/engine/src/orchestrator/phases.ts` — `PhaseContext` gains `onSuccess: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'` and renames `featureBranchMerged` to `landingSucceeded` (a single rename, all internal references updated). The `finalize()` generator now delegates to `executeLandingAction` from `landing.ts`, which performs the dirty-tree pre-check, cleanup-on-feature-branch, and the chosen action. The final status branch becomes `state.status = ctx.landingSucceeded ? 'completed' : 'failed'`. The merge-to-base arm keeps the existing policy-gate region block. The pre-existing `'merge:finalize:skipped'` emissions for `Validation failed`, `Not all plans merged successfully`, and `Aborted before finalize` are replaced with `'landing:skipped'` events carrying the resolved `action`; for the merge-to-base path the engine *also* still emits the legacy `merge:finalize:skipped` for those reasons to preserve compatibility.
- `packages/engine/src/orchestrator.ts` — `OrchestratorOptions` gains `onSuccess`; `execute()` passes it into the `PhaseContext`; the finally-block branch-deletion gate changes from `if (ctx.featureBranchMerged)` to `if (ctx.landingSucceeded && ctx.onSuccess === 'merge-to-base-branch')` so PR/leave paths preserve the feature branch.
- `packages/engine/src/eforge.ts` — extend the orchestrator construction in `build()` (around line 891) to compute `const effectiveOnSuccess = options.onSuccess ?? this.config.build.onSuccess;` and pass `onSuccess: effectiveOnSuccess` into `new Orchestrator({ ... })`. Same wiring in any sibling code path that constructs `Orchestrator`.
- `packages/engine/src/events.ts` — add `onSuccess?: 'merge-to-base-branch' | 'issue-pr' | 'leave-branch'` to `BuildOptions` and `EnqueueOptions`.
- `packages/engine/test/config.test.ts` (or co-located test for build defaults) — add a case for `build.onSuccess` defaulting to `merge-to-base-branch` and a case rejecting an invalid value.

## Verification

- [ ] `packages/engine/src/config.ts` exports a `build` schema that accepts only the three literal `onSuccess` values; any other string fails `eforgeConfigSchema.safeParse`.
- [ ] `resolveConfig({})` returns `build.onSuccess === 'merge-to-base-branch'`.
- [ ] `resolveConfig({ build: { onSuccess: 'issue-pr' } })` returns `build.onSuccess === 'issue-pr'`.
- [ ] `EforgeEventSchema` rejects a payload with `type: 'landing:start'` and `action: 'foo'` (asserts via `safeParseEforgeEvent`).
- [ ] `test/landing-actions.test.ts` shows: when `onSuccess: 'merge-to-base-branch'`, the engine emits `merge:finalize:start`, `merge:finalize:complete`, `landing:start { action: 'merge-to-base-branch' }`, `landing:complete { action: 'merge-to-base-branch' }`; when `onSuccess: 'issue-pr'`, only `landing:*` events fire and no `merge:finalize:*`; when `onSuccess: 'leave-branch'`, only `landing:*` events fire.
- [ ] `test/landing-actions.test.ts` confirms the feature branch still exists after `issue-pr` and after `leave-branch`, and does NOT exist after `merge-to-base-branch`.
- [ ] `test/landing-actions.test.ts` covers a stubbed `gh` that fails because the PR already exists and asserts `landing:complete` carries the existing PR URL.
- [ ] When validation fails before finalize, `state.status === 'failed'` and a `landing:skipped` event is emitted with `reason: 'Validation failed'`; for `merge-to-base-branch`, the legacy `merge:finalize:skipped` is also emitted.
- [ ] `state.status === 'completed'` is reached only when `landingSucceeded === true`; running with `onSuccess: 'issue-pr'` against a successful build leaves status `completed` without the feature branch being merged into base.
- [ ] `pnpm type-check` and `pnpm test` pass.
