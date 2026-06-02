---
id: plan-01-stack-base-and-provider-foundation
name: Stack Base Normalization and Provider Retarget Foundation
branch: handle-stale-stacked-pr-parent-branches-during-git-spice-landing/plan-01-stack-base-and-provider-foundation
agents:
  builder:
    effort: high
    rationale: Introduces shared git ancestry/remote helpers, changes stack base
      semantics, and extends the provider interface used by multiple tests.
  reviewer:
    effort: high
    rationale: Provider boundary and git-ref safety need close review because branch
      names flow into subprocess argv.
---

# Stack Base Normalization and Provider Retarget Foundation

## Architecture Context

Stacked PR dispatch currently resolves a child layer to the parent artifact branch, or to the recorded commit SHA when that branch no longer resolves locally. This leaves stale parent topology in place even when the parent artifact has already landed on trunk. The git-spice provider also lacks a branch-scoped retarget operation, so landing code cannot repair local git-spice topology without invoking whole-stack sync.

This plan adds the foundation for deterministic trunk collapse and branch-scoped retargeting. Landing-time preflight and event/state metadata are handled in the dependent plan.

## Implementation

### Overview

Add reusable stack base repair helpers, update `resolveStackBaseContext` to collapse already-integrated parents to trunk at dispatch time, and extend the stack provider interface with a branch-scoped retarget method backed by `git-spice branch onto <target> --branch=<branch>`.

### Key Decisions

1. Gate trunk collapse on `git merge-base --is-ancestor <parent-artifact-commit> <trunk-ref>` so missing or stale parent branches fail closed unless ancestry proves integration.
2. Prefer `origin/<trunk>` for the ancestry proof when that ref exists, with local `<trunk>` as the fallback for repositories without a fetched remote trunk.
3. Keep provider argv construction inside `packages/engine/src/stacking/git-spice.ts`; orchestration and base resolution code call typed helpers and provider methods.
4. Make the provider retarget method part of `StackProviderAdapter` so landing code can rely on it for the only supported provider and test stubs expose the same contract.

## Scope

### In Scope

- Shared stack git/ref helpers for ref SHA lookup, ancestry checks, trunk integration ref resolution, and remote branch existence checks needed by later landing preflight.
- Dispatch-time parent artifact normalization in `resolveStackBaseContext`.
- Optional `StackBaseContext` evidence fields for parent artifact ref/commit, original/effective base, trunk branch/remote, and repair reason.
- Branch-scoped provider retarget method and git-spice adapter argv tests.
- Test updates for base resolver behavior and provider stubs.

### Out of Scope

- Landing-time remote-base preflight and automatic repair execution.
- Event/state schema extensions for landing metadata.
- Recovery recommendation text and documentation updates.
- Automatic submission or resurrection of missing parent branches.

## Files

### Create

- `packages/engine/src/stacking/base-repair.ts` — Shared stack base repair primitives:
  - `StackBaseRepairReason` literal type with `parent-artifact-already-integrated`.
  - metadata/evidence interfaces reused by base resolver and landing.
  - `resolveTrunkIntegrationRef(cwd, trunkBranch, remote?)` that returns `origin/<trunk>` when it resolves, otherwise `<trunk>`.
  - `isAncestor(cwd, potentialAncestor, descendant)` using `git merge-base --is-ancestor`.
  - commit/ref helpers using `git rev-parse --verify --end-of-options <ref>^{commit}`.
  - `remoteBranchExists(cwd, branch, remote?)` based on `git ls-remote --exit-code --heads` with a result that distinguishes not-found from remote/query failure.

### Modify

- `packages/engine/src/stacking/base-resolver.ts` — Use artifact registry first and stack layer state second as before, then:
  - Resolve the trunk branch once for child layers.
  - Capture parent artifact ref and commit evidence from the local ref tip or recorded commit SHA.
  - Return trunk as `baseBranch` with repair metadata when the parent artifact commit is an ancestor of the trunk integration ref.
  - Preserve the parent artifact branch when it exists locally and is not an ancestor of trunk.
  - Throw an actionable error when the parent artifact branch is missing and the recorded commit does not resolve or is not an ancestor of trunk.
- `packages/engine/src/stacking/types.ts` — Add optional `StackBaseContext` evidence fields for parent artifact ref/commit, original/effective base, trunk branch/remote, and repair reason so landing can distinguish the originally resolved base from the effective base.
- `packages/engine/src/stacking/provider.ts` — Add required `retargetBranch(cwd, branch, target): Promise<ProviderCommandResult>` with comments that it is branch-scoped topology repair.
- `packages/engine/src/stacking/git-spice.ts` — Implement `retargetBranch` as `git-spice branch onto <target> --branch=<branch>` and return command metadata.
- `packages/engine/src/stacking/index.ts` — Re-export new repair types/helpers that tests or downstream stack modules need.
- `test/stack-base-resolver.test.ts` — Update existing fixtures whose parent branch currently points at trunk, then add integrated-parent and fail-closed cases.
- `test/git-spice-provider.test.ts` — Cover the new retarget method argv and command metadata.
- `test/stack-runtime-landing.test.ts`, `test/stack-runtime-landing-provenance.test.ts`, `test/stack-landing-cleanup.test.ts`, `test/artifact-finalization.test.ts`, `test/landing-conflict-recovery.test.ts` — Add `retargetBranch` to `StackProviderAdapter` stubs because the interface method is required.

## Detailed Requirements

### Base resolver behavior

- Root stack layers continue resolving to the configured trunk branch.
- For child layers, keep the existing source order: artifact registry, then stack state.
- When the parent artifact ref resolves locally:
  - Resolve its commit SHA from the ref.
  - If that commit is an ancestor of the trunk integration ref, return trunk as the effective `baseBranch` and include repair metadata.
  - If not, return the parent artifact branch/ref as before.
- When the parent artifact ref does not resolve locally:
  - Try the recorded commit SHA from the registry first, then the stack layer.
  - If the commit SHA resolves and is an ancestor of trunk, return trunk with repair metadata.
  - If the commit SHA is missing, unresolved, or not an ancestor of trunk, throw a message naming the child PRD, parent PRD, recorded artifact ref, and the remediation path.

### Provider behavior

- `GitSpiceAdapter.retargetBranch(cwd, branch, target)` must call `run(cwd, ['branch', 'onto', target, '--branch', branch])`.
- Do not add git-spice argv literals outside `git-spice.ts` except in tests.
- Preserve redaction and `ProviderCommandResult` behavior.

## Verification

- [ ] `resolveStackBaseContext` returns `main` for a child whose parent artifact branch tip is an ancestor of `origin/main`.
- [ ] `resolveStackBaseContext` returns `main` for a child whose parent artifact branch is missing locally and whose recorded commit SHA is an ancestor of trunk.
- [ ] `resolveStackBaseContext` returns the parent artifact branch for a child whose parent artifact branch exists and whose tip is not an ancestor of trunk.
- [ ] `resolveStackBaseContext` rejects a child whose parent artifact branch is missing and whose recorded commit SHA is not an ancestor of trunk; the error includes the child PRD id, parent PRD id, artifact ref, and trunk-integration remediation guidance.
- [ ] `GitSpiceAdapter.retargetBranch(dir, 'eforge/child', 'main')` records argv `branch onto main --branch=eforge/child`.
- [ ] All `StackProviderAdapter` test stubs include the required new `retargetBranch` method.
- [ ] Targeted tests pass: `pnpm vitest run test/stack-base-resolver.test.ts test/git-spice-provider.test.ts`.