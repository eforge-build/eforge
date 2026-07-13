---
title: Pin Validation Bases for Stacked Builds
created: 2026-07-13
---

# Pin Validation Bases for Stacked Builds

## Problem / Motivation

A stacked child resolves its parent artifact branch at dispatch but can retain only that mutable branch name as its validation base. If the parent lands and its branch is deleted while the child builds, later PRD validation, acceptance unknown resolution, or post-gap validation cannot construct the child diff. The diff builder converts Git failures into an empty result, causing empty-implementation or broad unknown verdicts and unnecessary gap closure instead of unavailable evidence.

Correctness requires separate identities: the logical parent branch for topology and landing, and the immutable parent artifact commit for validation. When the logical branch disappears, validation may repair its effective base to trunk only after proving the pinned commit is integrated into the current configured trunk integration ref. This is fail-closed kernel reliability work.

### Reproduction

1. Create a real Git repository with trunk, a parent artifact branch, and a child queued PRD whose `stack_parent` points to the parent.
2. Record the parent branch and tip commit in artifact/stack state, leaving it unintegrated when child dispatch resolves stack context.
3. Dispatch and compile the child. Current orchestration retains the parent as `base_branch` but does not pin its SHA as `diff_base_ref` on this path.
4. While the child runs, integrate the parent commit into configured trunk and delete the parent branch locally/remotely.
5. Commit child changes and invoke PRD validation. `createPrdValidationWiring` selects `orchConfig.diffBaseRef ?? orchConfig.baseBranch`; without a pin it passes the deleted branch to `buildPrdValidatorDiff`.
6. Observe Git enumeration fail, be converted to an empty `BuildPrdDiffResult`, and flow into empty-diff/unknown acceptance handling.
7. Repeat after a simulated gap-close commit, then proceed to stacked landing to verify existing missing-parent-to-trunk repair.

### Root Cause

The defect is a time-of-check/time-of-use gap:

- `resolveStackBaseContext` records the parent artifact ref and commit and can repair a branch already missing at dispatch.
- `resolveCompileOverrides` passes logical `baseBranch`, but child handling supplies no worktree/diff override; compile therefore writes no `diff_base_ref` unless trunk sync supplied a distinct SHA.
- The PRD validator and acceptance unknown resolver repeatedly choose the mutable branch fallback without checking for a mid-build parent landing.
- `buildPrdValidatorDiff` catches initial Git failures and returns the same empty shape as a successful no-change diff; per-file failures also become empty bodies.
- Dispatch-time and landing-time repair cover either side of the build, but no validation-time repair covers the interval.

## Goal

Fix the stacked-build validation TOCTOU gap across queue dispatch, orchestration metadata, validation-base resolution, and PRD diff construction. Child builds must retain the logical parent branch for topology and landing while persisting the parent artifact SHA as immutable `diff_base_ref`; validation must use that pin or repair a vanished, proven-integrated parent base to trunk, and Git failures must become typed diff-unavailable outcomes rather than empty diffs.

Existing repair primitives plus real-Git regressions, type-checking, the full test suite, and maintainability checks should provide high confidence.

## Approach

1. In `packages/engine/src/queue/build-single-prd.ts`, pass a child stack context's resolved `parentArtifactCommit` as an immutable worktree/diff override independently of trunk-sync enablement, while retaining the logical `baseBranchOverride`. Fail before compile if the pin cannot resolve.
2. In `packages/engine/src/eforge.ts` and existing plan parser/writer paths as needed, persist the distinct SHA as `diff_base_ref` and preserve it through supported build/resume loading without adding a wire field if the existing contract suffices.
3. Add a focused validation-base resolver under `packages/engine/src/validation/`, reusing `stacking/base-repair.ts`. Before every PRD/acceptance diff, start from the pin; if the logical branch is missing, select current configured trunk only after proving the pin is its ancestor. Do not mutate landing topology.
4. In `packages/engine/src/prd-validator-diff.ts`, replace catch-and-empty behavior with a typed available versus diff-unavailable outcome, including enumeration and per-file failures. Update callers so unavailable evidence invokes neither validator agents nor gap closure as though the diff were empty.
5. Use bounded edits in large files and put substantial new logic in a focused file. Test with real Git and `StubHarness` where agent wiring is needed; do not mock Git/domain helpers.

### Assumptions and Guardrails

- Artifact registry/stack state remains the parent-commit source at dispatch, with current registry precedence.
- Existing `diff_base_ref` remains separate from `base_branch` and is sufficient for the pin.
- Validation repair is engine-internal and reuses stack base-repair primitives.
- Legacy/non-stacked orchestration without a pin remains supported while its logical base resolves; a vanished stacked parent without a pin cannot be repaired safely.
- Never replace logical `base_branch` with a SHA, authorize repair from stale/uncertain trunk evidence, silently substitute an unrelated base, or erase landing repair evidence.
- Test three-dot child-only semantics after trunk receives the parent and later unrelated commits; ensure typed error changes preserve genuine available-empty behavior.

### Validation Sequence

1. Prove diff construction returns available-empty only for successful no-change commands and typed unavailable for invalid-base enumeration and per-file failures.
2. Prove child `base_branch=<parent branch>` and `diff_base_ref=<parent SHA>` with trunk sync disabled and enabled.
3. In a real-Git fixture, dispatch the child, commit child work, land the parent, optionally advance trunk, delete parent refs, and verify child-only diff content before and after a simulated gap-close commit.
4. Continue through stacked landing and verify repair targets configured trunk only with ancestry evidence and preserves repair metadata.
5. Add negative cases for unresolved and unintegrated pins; assert no empty-diff waiver, validator-agent call, or gap-close invocation.
6. Run focused Vitest files, `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check`.

Documentation changes are unnecessary unless diagnostics or configuration become user-visible.

## Scope

### In Scope

- Queue dispatch handling for stacked child validation-base pins.
- Orchestration metadata persistence and supported build/resume loading of `diff_base_ref`.
- Validation-base resolution and safe repair to configured trunk.
- Typed available versus diff-unavailable PRD diff outcomes.
- Initial PRD validation, acceptance unknown resolution, post-gap/final validation, and compatibility with existing stacked landing repair.
- Real-Git regressions, focused tests, type-checking, the full test suite, and maintainability checks.

### Out of Scope

- Stack-provider expansion.
- Workflow UX and UI changes.
- Landing-policy redesign.
- Unrelated validation changes.

## Acceptance Criteria

- A stacked child dispatched against an existing parent records the parent artifact SHA as immutable `diff_base_ref` while retaining the logical parent branch as `base_branch`.
- The pin anchors child worktree/divergence and survives orchestration parsing plus supported compiled-resume paths.
- After parent landing and branch deletion, initial PRD validation, acceptance unknown resolution, and post-gap/final validation still construct the child implementation diff.
- A missing logical parent is treated as trunk-integrated only after resolving the pin and proving it is an ancestor of the current configured trunk integration ref; validation repair does not rewrite landing topology.
- Missing, unresolved, unintegrated, or unprovable pins fail closed with actionable unavailable evidence and do not invoke validation agents or gap closure on a fabricated empty diff.
- Git failures during enumeration or per-file diff construction produce typed diff-unavailable outcomes. Successful zero-change diffs remain distinct available-empty outcomes governed by existing policy.
- A real-Git regression covers branch existence at dispatch, immutable pinning, parent integration/deletion during child work, successful initial and post-gap/final child diffs, and continued stacked landing repair.
- Existing non-stacked trunk-sync pinning, empty-diff policy, dispatch repair, and landing repair remain green.
- `pnpm type-check`, focused tests, `pnpm test`, and `pnpm maintainability:check` pass.