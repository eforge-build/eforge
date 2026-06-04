---
id: plan-01-stale-parent-landing-repair
name: Stale Parent Stack Landing Repair
branch: fix-stale-parent-stacked-pr-landing-repair-for-untracked-git-spice-child-branches/plan-01-stale-parent-landing-repair
agents:
  builder:
    effort: high
    rationale: Changes provider command ordering in a high-impact PR publication
      path while preserving fail-closed repair semantics.
  test-writer:
    effort: high
    rationale: Regression tests must model git-spice's tracked-branch precondition
      and prove non-main trunk handling.
  reviewer:
    effort: high
    rationale: Review must verify landing preflight side effects only occur after
      the child branch is tracked.
---

# Stale Parent Stack Landing Repair

## Architecture Context

Stacked PR landing is engine-owned orchestration behind the `StackProviderAdapter` boundary. The engine decides the effective landing base and emits typed `stack:landing:update` / `stack:provider:command` events; the git-spice adapter remains the only place that constructs concrete git-spice argv. The current initial missing-parent preflight mutates git-spice topology by calling `retargetBranch()` before `trackBranch()`, which can fail for eforge-created child artifact branches that git-spice has not tracked yet.

This plan keeps the parent-integration proof in `landing-base.ts`, separates decision-only repair from retargeting side effects, and keeps retargeting for the later post-track preflight path where the child branch is already tracked.

## Implementation

### Overview

Add an explicit repair mode to landing-base preflight. The first preflight in `executeStackLanding()` runs in decision-only mode, so an initially missing integrated parent returns `effectiveBaseBranch` set to the resolved trunk branch without invoking `provider.retargetBranch()`. The existing landing sequence then runs provider repo sync, tracks the child against that effective trunk base, restacks, proves freshness, and submits. Later/final preflights run in retarget-capable mode, preserving repair for a parent branch that disappears after the child has already been tracked.

### Key Decisions

1. Use an explicit preflight mode such as `repairMode: 'decision-only' | 'retarget'` rather than inferring from branch state, because `landing.ts` already knows whether tracking has occurred.
2. Keep the default preflight behavior retarget-capable for any future direct callers, while passing `decision-only` for the initial pre-track call in `executeStackLanding()`.
3. Continue using `stackContext.trunkBranch ?? 'main'`, `stackContext.trunkRemote ?? 'origin'`, and `baseDecision.effectiveBaseBranch`; do not add a new hard-coded trunk branch value.
4. Preserve provider-boundary discipline: do not inline git-spice command arrays in `landing.ts` or `landing-base.ts`; only assert command metadata returned by the stub provider in tests.

## Scope

### In Scope

- Decision-only initial missing-parent repair in `packages/engine/src/stacking/landing-base.ts`.
- Initial versus final preflight mode selection in `packages/engine/src/stacking/landing.ts`.
- Regression tests for command ordering, tracked-branch precondition modeling, non-main trunk repair, post-track retarget preservation, and fail-closed behavior.
- Small helper support for non-main trunk stack repositories if needed.
- Documentation wording updates where existing docs describe initial missing-parent repair as retarget-first.

### Out of Scope

- Replacing the git-spice provider abstraction.
- Succeeding when the parent artifact commit cannot be proven to be an ancestor of the configured remote trunk.
- Changing git-spice adapter argv construction.
- Adding hard-coded `main` behavior outside existing fallback semantics.
- Broad stack sync or whole-stack restack changes.

## Files

### Create

- None.

### Modify

- `packages/engine/src/stacking/landing-base.ts` — add a preflight repair mode option; for missing integrated parent repair, return the repaired decision without `retargetBranch()` in decision-only mode and retain retargeting in retarget mode; keep proof and trunk/remote fallback behavior unchanged.
- `packages/engine/src/stacking/landing.ts` — pass decision-only mode to the initial pre-track `runBasePreflight()` call; pass retarget mode to final/post-track preflight checks; update nearby workflow comments to match the new ordering. Use bounded exact edits because this file is larger than 300 lines.
- `test/stack-runtime-landing-metadata-preflight.test.ts` — update the missing integrated parent test to expect `sync -> track:<trunk> -> restack -> submit` with no pre-track `retarget`; make the stub provider throw if `retargetBranch()` runs before `trackBranch()`; add a non-main trunk scenario such as `develop` or `master`; assert the non-main scenario's `trackBranch()` call and landing metadata/state use the configured trunk; keep the parent-disappears-during-landing test asserting retarget after track, the emitted `branch onto` command after track, plus a second restack; keep the fail-closed missing-parent test.
- `test/stack-runtime-landing-helpers.ts` — if needed, extend `setupStackRepo()` with a `trunkBranch` option that creates/pushes the configured remote trunk and integrates the parent into that branch. Keep edits test-scoped and preserve existing default `main` behavior.
- `docs/stacking.md` — update stale-parent repair wording to distinguish initial untracked child repair via tracking/restacking against trunk from post-track retarget repair.
- `docs/architecture.md` — update the stacked PR topology summary so it no longer implies initial missing-parent repair always retargets before tracking.

## Implementation Notes

- Suggested type in `landing-base.ts`:
  - `export type LandingBaseRepairMode = 'decision-only' | 'retarget';`
  - Add `repairMode?: LandingBaseRepairMode` to `preflightLandingBase()` options.
  - Resolve `const repairMode = options.repairMode ?? 'retarget';` near the top of the function.
- Missing integrated parent branch path:
  - Build `repairedDecision` exactly as today, with `originalBaseBranch`, `effectiveBaseBranch: trunkBranch`, and `baseRepairReason: 'parent-artifact-already-integrated'`.
  - If `repairMode === 'decision-only'`, return `{ ok: true, decision: repairedDecision }`.
  - If `repairMode === 'retarget'`, call `provider.retargetBranch(mergeWorktreePath, stackContext.branch, trunkBranch)` and return the existing `retargetResult` shape.
- `landing.ts` call shape:
  - Change `runBasePreflight` to accept a mode argument and pass it through to `preflightLandingBase()`.
  - Use `await runBasePreflight('decision-only')` for the initial call before `runProviderSync()` and `trackBranch()`.
  - Use `await runBasePreflight('retarget')` inside the freshness loop after at least one `trackBranch()` call.
- Verify the final preflight for an initially repaired branch checks the configured remote trunk proof but does not emit `branch onto`, because the effective base is already trunk and remote trunk exists.
- Preserve metadata propagation through `landingBaseMetadata(baseDecision)`, including `originalBaseBranch`, `effectiveBaseBranch`, and `baseRepairReason` on complete and failed landing updates.

## Verification

- [ ] In `test/stack-runtime-landing-metadata-preflight.test.ts`, the initial missing integrated parent scenario records calls `['sync', 'track:<resolved-trunk>', 'restack', 'submit']` and records no `retarget:*` call.
- [ ] In that same scenario, a stub `retargetBranch()` that throws before tracking does not throw because `retargetBranch()` is not invoked before `trackBranch()`.
- [ ] Initial missing integrated parent `stack:provider:command` events contain `['repo', 'sync']` before `['branch', 'track', '--base', '<resolved-trunk>']`, and contain the track event before `['branch', 'restack']`.
- [ ] Initial missing integrated parent `stack:provider:command` events contain no `['branch', 'onto', '<resolved-trunk>', '--branch', 'eforge/test-prd']` event before the first track event.
- [ ] Initial missing integrated parent complete events and persisted stack landing state include `originalBaseBranch: 'eforge/parent-prd'`, `effectiveBaseBranch: '<resolved-trunk>'`, and `baseRepairReason: 'parent-artifact-already-integrated'`.
- [ ] A non-main trunk test creates/pushes a remote trunk such as `develop` or `master`, sets the child context to that trunk, and observes `trackBranch()` called with that branch name plus complete landing metadata/state with `effectiveBaseBranch` set to that branch name and `baseRepairReason: 'parent-artifact-already-integrated'`.
- [ ] The parent-disappears-during-landing test observes `track:<parent>` before `retarget:<child>:<resolved-trunk>`, observes `stack:provider:command` events for `['branch', 'onto', '<resolved-trunk>', '--branch', '<child>']` after the first track event, and observes a second restack after retarget.
- [ ] Missing parent repair with an unintegrated parent commit ends with a failed `stack:landing:update`, skips submit, and includes the existing `not an ancestor` failure reason.
- [ ] `pnpm test -- stack-runtime-landing-metadata-preflight stack-runtime-landing-failures stack-base-resolver git-spice-provider` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm docs:check` exits 0 after documentation wording is updated or generated docs are refreshed.
