---
id: plan-03-branch-aware-landing
name: "Branch-aware landing: trunk policy, non-trunk PR-after-local-merge,
  cleanup-before-PR"
branch: branch-aware-landing-and-queue-provenance-split-for-eforge-builds/plan-03-branch-aware-landing
agents:
  builder:
    effort: xhigh
    rationale: Engine landing semantics change for both PR and merge actions across
      trunk/non-trunk; requires precise sequencing of cleanup, push,
      merge-into-feature-branch, and PR creation.
  reviewer:
    effort: high
    rationale: Landing changes have user-visible consequences for trunk safety and
      PR shape; thorough review required.
---

## Architecture Context

The engine currently treats every `merge-to-base-branch` and `issue-pr` action uniformly regardless of whether the captured base branch is trunk or a feature branch. Cleanup only runs in the `merge-to-base-branch` path, so `issue-pr` PRs include the temporary PRD artifact and plan files in their diff. Non-trunk `issue-pr` opens `eforge/{planSetName} -> baseBranch`, which is surprising when the user started from a local feature branch and expected the PR to be from their branch to trunk.

This plan adds the branch-aware policy at the engine landing layer (so direct API/MCP/CLI callers cannot bypass it), implements the non-trunk PR-after-local-merge workflow, and ensures cleanup runs for both landing paths.

## Implementation

### Overview

1. Add a trunk-and-policy resolution step at the top of `executeLandingAction` that calls `resolveTrunkBranch(config, repoRoot)` (from Plan 01) and reads `config.build.allowLocalMergeToTrunk`.
2. Reject `merge-to-base-branch` when `isTrunkBranch(baseBranch, trunk) && !allowLocalMergeToTrunk`. Emit `landing:skipped` with reason `Local merge to trunk is not allowed. Set build.allowLocalMergeToTrunk: true to opt in (solo/unprotected only).`
3. For `merge-to-base-branch` when `isTrunkBranch && allowLocalMergeToTrunk`: merge into local trunk and do NOT push automatically. (Current behavior already does not push; just keep that and emit a `landing:complete` event whose `reason` notes that pushing is left to the developer.)
4. For `merge-to-base-branch` when `!isTrunkBranch`: existing behavior — merge `eforge/{planSetName}` into the local feature branch via `worktreeManager.mergeToBase`.
5. For `issue-pr` when `isTrunkBranch`: existing behavior — push `eforge/{planSetName}` and open PR with `--base trunk --head eforge/{planSetName}`.
6. For `issue-pr` when `!isTrunkBranch`: NEW behavior — merge `eforge/{planSetName}` into the local feature branch first (using `worktreeManager.mergeToBase(featureBranch=baseBranch, ...)`), then push the feature branch (the user's local branch), then `gh pr create --base <trunk> --head <baseBranch>`. The PR is from the user's feature branch to trunk.
7. Run cleanup before push/PR creation in BOTH landing paths. Currently cleanup is inside the `merge-to-base-branch` block; refactor so cleanup runs at the start of both branches once `allMerged` is true, after the policy check.
8. Update `WorktreeManager.issuePr` to accept `{ baseBranch, trunkBranch }` and a flag `mergeIntoBaseFirst: boolean`. When true, it merges the eforge work branch into `baseBranch` (the user's feature branch) in the merge worktree, pushes `baseBranch`, then creates the PR with `--base trunkBranch --head baseBranch`.
9. Update `worktree-ops.ts` `createPullRequest` so the head branch is parameterized (today it implicitly uses the merge worktree's checked-out branch which is `featureBranch`).
10. Cleanup must happen on the branch that will be pushed/merged: for non-trunk `issue-pr`, that is the user's feature branch (after the local merge); for trunk `issue-pr`, that is `eforge/{planSetName}`. Wire the `git checkout` before `cleanupPlanFiles` accordingly.

### Key Decisions

1. **Engine-level enforcement** — Trunk policy is rejected inside `executeLandingAction`, not only in skills/CLI. Direct callers (MCP tools, Pi extension, custom integrations) get the same safety.
2. **Trunk local merge does not push** — Preserves existing semantics. Solo developers explicitly push to `origin` when ready. Emit `landing:complete` with metadata `pushed: false`.
3. **Non-trunk PR semantics** — The user-facing mental model is "finish my branch, then PR it." The engine implements that by merging the eforge work branch into the feature branch and pushing the feature branch. The eforge work branch can be left behind locally; cleanup of stale eforge branches is a separate concern.
4. **Cleanup placement** — Cleanup runs once, before either the local merge to base or the push-and-PR, on whichever branch is going to be the final landing target. For trunk `issue-pr` that is the eforge work branch; for non-trunk `issue-pr` that is the user's feature branch (after the in-merge-worktree local merge); for `merge-to-base-branch` on trunk-with-opt-in that is the eforge work branch (the base is then fast-forwarded); for non-trunk `merge-to-base-branch` that is the eforge work branch.
5. **Cleanup non-fatal failure** — Keep existing non-fatal behavior. The source PRD calls out that stricter handling for PR paths can be deferred; this plan keeps the existing `planning:progress` warning and continues.
6. **Cleanup parameter** — `cleanupPrdFilePath` now points at the materialized artifact from Plan 02 (`eforge/prds/{prdId}.md`), not the source queue PRD. Names are kept stable to minimize touch.

## Scope

### In Scope

- Engine landing policy enforcement (`executeLandingAction`):
  - Resolve trunk via `resolveTrunkBranch(config, repoRoot)`; classify `baseBranch` with `isTrunkBranch`.
  - Reject `merge-to-base-branch` on trunk when opt-in is false; emit `landing:skipped` with a clear reason.
  - Allow `merge-to-base-branch` on trunk when opt-in is true; local-only, no push.
  - Run cleanup before final landing for both `merge-to-base-branch` and `issue-pr` paths.
- Non-trunk `issue-pr` workflow: merge eforge work branch into the local feature branch, push the feature branch, open PR `--base <trunk> --head <feature>`.
- Trunk `issue-pr` workflow unchanged in shape (push eforge branch, open PR `--base <trunk> --head <eforge>`), but cleanup now runs first.
- `WorktreeManager.issuePr` signature change: accept `{ baseBranch, trunkBranch, mergeIntoBaseFirst }`; refactor `createPullRequest` in `worktree-ops.ts` to accept `headBranch` parameter.
- `executeLandingAction` signature update: accept `config: EforgeConfig` (or just the resolved `trunkBranch` and `allowLocalMergeToTrunk` policy) so it can apply trunk policy. Update the orchestrator call site in `packages/engine/src/orchestrator/phases.ts` and `packages/engine/src/orchestrator.ts` to thread the policy through.
- Wire `landing:start` payload to include the resolved `trunkBranch` and effective workflow classification (e.g. `workflow: 'trunk-pr' | 'trunk-local-merge' | 'feature-pr-after-local-merge' | 'feature-local-merge' | 'leave-branch'`) so downstream consumers (monitor UI, tests) can assert behavior. Add the field as an optional addition; do not break existing `landing:start` consumers.
- Tests:
  - Extend `test/landing-actions.test.ts` with: (1) trunk + `merge-to-base-branch` + default policy → rejected; (2) trunk + `merge-to-base-branch` + opt-in → merged locally, no push; (3) trunk + `issue-pr` → push eforge branch + PR to trunk; (4) non-trunk + `merge-to-base-branch` → merge into feature branch; (5) non-trunk + `issue-pr` → local merge into feature, push feature, PR `--base trunk --head feature`.
  - Add cleanup-runs-for-issue-pr cases: assert that the PRD artifact and plan files are committed earlier in the eforge work branch history but absent from `HEAD` of the pushed branch.
  - Use stubbed `gh` (PATH override) and a local bare remote for `gh pr create` assertions where feasible.

### Out of Scope

- Skill/CLI confirmation UX, eforge_init schema changes for trunk policy, plugin version bump, and docs — Plan 04.
- Auto-pushing local trunk after `merge-to-base-branch` opt-in (explicitly out per source).
- Removing the eforge work branch after a non-trunk PR (cleanup of stale branches is a separate concern).
- Stricter cleanup-failure policy.

## Files

### Modify

- `packages/engine/src/landing.ts`:
  - Import `resolveTrunkBranch`, `isTrunkBranch` from `./branch-policy.js`.
  - Add `config: EforgeConfig` to `LandingActionOptions` (or split out the two policy fields).
  - At the top of `executeLandingAction`, resolve `trunkBranch` from config and capture `allowLocalMergeToTrunk`.
  - Classify the workflow and emit a `landing:start` payload that includes the resolved `trunkBranch` and a `workflow` discriminator.
  - Before any action body runs, in `merge-to-base-branch` reject when `isTrunkBranch(baseBranch, trunk) && !allowLocalMergeToTrunk`.
  - Move the existing cleanup block out of the `merge-to-base-branch` branch and into a shared pre-landing step that runs whenever `shouldCleanup && cleanupPlanSet && cleanupOutputDir`. For non-trunk `issue-pr`, run cleanup on the merge worktree but ensure the worktree is on the branch that will be merged/pushed.
  - For `issue-pr` non-trunk: call `worktreeManager.mergeToBase(baseBranch, commitMessage, mergeResolver)` first, then call `worktreeManager.issuePr({ baseBranch, trunkBranch, mergeIntoBaseFirst: true })`.
  - For `issue-pr` trunk: call `worktreeManager.issuePr({ baseBranch: trunkBranch, trunkBranch, mergeIntoBaseFirst: false })`.
  - For `merge-to-base-branch` trunk opt-in: existing `mergeToBase` flow; do NOT push.
- `packages/engine/src/worktree-manager.ts` — Update `issuePr` to accept `{ baseBranch, trunkBranch, mergeIntoBaseFirst }`. When `mergeIntoBaseFirst` is true, treat `baseBranch` as the head and `trunkBranch` as the PR base; push `baseBranch` rather than the eforge feature branch.
- `packages/engine/src/worktree-ops.ts` — Update `pushFeatureBranch` to accept `branch: string` (decoupled from the manager's `featureBranch`) and `createPullRequest` to accept `{ baseBranch, headBranch, ... }` explicitly.
- `packages/engine/src/orchestrator/phases.ts` — Thread `config: EforgeConfig` (or the resolved policy) into the `executeLandingAction` call. Drop the assumption that cleanup is `merge-to-base-branch`-specific.
- `packages/engine/src/orchestrator.ts` — Add the policy fields to the orchestrator options so it can forward them.
- `packages/engine/src/eforge.ts` — Pass `config` (or the resolved policy) into the orchestrator constructor for landing.
- `packages/client/src/events.schemas.ts` — Extend `landing:start` event with optional `trunkBranch: string` and `workflow: 'trunk-pr' | 'trunk-local-merge' | 'feature-pr-after-local-merge' | 'feature-local-merge' | 'leave-branch'` fields. Mark them optional to avoid breaking older event consumers.
- `test/landing-actions.test.ts` — Replace/extend existing scenarios with the five branch-aware cases listed above; use stub `gh` via `PATH` override and a local bare remote for push verification.
- `test/onsuccess-override-precedence.test.ts` — Update to seed the new config policy fields and confirm precedence is preserved.

## Verification

- [ ] When `baseBranch === 'main'`, `allowLocalMergeToTrunk === false`, action `merge-to-base-branch`: `executeLandingAction` emits `landing:skipped` with reason starting `Local merge to trunk is not allowed.` and does NOT call `worktreeManager.mergeToBase`.
- [ ] When `baseBranch === 'main'`, `allowLocalMergeToTrunk === true`, action `merge-to-base-branch`: `worktreeManager.mergeToBase('main', ...)` is called; no `git push` is invoked.
- [ ] When `baseBranch === 'main'`, action `issue-pr`: `worktreeManager.issuePr` is called with `{ baseBranch: 'main', trunkBranch: 'main', mergeIntoBaseFirst: false }`; `gh pr create` runs with `--base main --head eforge/{planSetName}`.
- [ ] When `baseBranch === 'feature/x'`, action `issue-pr`: `worktreeManager.mergeToBase('feature/x', ...)` is called first, then `gh pr create` runs with `--base main --head feature/x` (head is the user's feature branch).
- [ ] When `baseBranch === 'feature/x'`, action `merge-to-base-branch`: `worktreeManager.mergeToBase('feature/x', ...)` is called and no PR is created.
- [ ] In all four successful workflows, the temporary PRD artifact `eforge/prds/{planSetName}.md` exists in `git log` history but is absent from the final pushed/merged tree (verified by `git ls-tree -r HEAD` on the pushed branch).
- [ ] `landing:start` events include the new `trunkBranch` and `workflow` fields; existing event consumers continue to parse via `safeParseEforgeEvent`.
- [ ] `pnpm type-check` and `pnpm test` pass.