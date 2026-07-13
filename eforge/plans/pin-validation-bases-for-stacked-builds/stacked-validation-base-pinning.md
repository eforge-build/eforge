---
id: stacked-validation-base-pinning
name: Pin stacked validation bases and preserve child diffs after parent deletion
branch: pin-validation-bases-for-stacked-builds/stacked-validation-base-pinning
---

# Pin stacked validation bases and preserve child diffs after parent deletion

Implement one cohesive engine change across dispatch persistence, worktree/divergence, and validation diff consumers. Capture an existing parent's artifact SHA as immutable `diff_base_ref` while retaining `base_branch`; preserve the pin through orchestration parsing and compiled resume. Use the pin to construct child diffs throughout initial, acceptance-unknown, post-gap, and final validation after parent integration/deletion. Permit the missing-parent case only after the pin resolves and is proven ancestral to configured trunk, without changing landing topology. Represent Git/base failures as typed unavailable evidence, suppress validation/gap agents on unavailable diffs, and retain available-empty policy. Add focused and real-Git lifecycle regressions alongside existing repair tests in the same module because the tests directly validate the Git-state contract.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009
Aspects: ac-001:general:general, ac-002:subsystem:divergence, ac-002:subsystem:worktree, ac-003:subsystem:final, ac-003:subsystem:post-gap, ac-004:general:general, ac-005:general:general, ac-006:general:general, ac-007:subsystem:deletion, ac-007:subsystem:final, ac-007:subsystem:integration, ac-007:subsystem:post-gap, ac-008:general:general, ac-009:interface:test, ac-009:subsystem:test

## Validation

Tests prove dispatch-time immutability with trunk sync both disabled and enabled, pre-compile failure for an unresolved parent artifact commit, resume preservation, pin-anchored worktree/divergence, successful child-only diffs across parent integration/deletion and all validation phases (including after unrelated trunk advancement), continued landing repair, fail-closed unavailable evidence for every unprovable/error case, no agent invocation on unavailable evidence, and distinct available-empty behavior. Focused tests plus `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` pass.

## Fragment: Pin and consume stacked validation bases across the build lifecycle

### Implementation

1. Trace the stacked-child dispatch and supported compiled-resume serialization paths through `packages/engine/src/queue/build-single-prd.ts`, `packages/engine/src/eforge.ts`, and their plan/state contracts. When dispatch finds an existing logical parent, resolve the parent artifact commit once and persist it as immutable `diff_base_ref`; continue storing the logical branch in `base_branch`. Pass the parent commit as the child worktree/diff override independently of trunk-sync enablement, and fail before compile if that commit cannot resolve. Ensure parsing/resume retains the pin without recomputing it, while preserving existing non-stacked trunk-sync pinning.
2. Thread the pinned base into child worktree creation/reconciliation and divergence checks in `packages/engine/src/worktree-manager.ts` and `packages/engine/src/worktree-ops.ts`. The immutable SHA, rather than a later-moving or deleted parent branch, must anchor implementation ancestry and divergence. Keep dispatch and landing repair behavior intact.
3. Add a focused validation-base resolver under `packages/engine/src/validation/`, reusing the ancestry and configured-trunk repair primitives from `packages/engine/src/stacking/base-repair.ts`, and route diff callers through it and `packages/engine/src/prd-validator-diff.ts`. Initial PRD validation, acceptance-unknown resolution, post-gap validation, and final validation must all start from the immutable pin and consume the same child-only three-dot diff semantics. If the logical parent is gone, select the current configured trunk integration ref as the effective repaired base only when the pin resolves and Git proves it is an ancestor of that ref. This validation fallback must not rewrite branch ancestry, repair evidence, or landing topology.
4. Preserve an explicit result distinction between an available diff with zero changes and typed diff-unavailable evidence. Convert failures from base resolution, ancestor proof, file enumeration, and per-file diff construction into actionable unavailable outcomes. Missing, unresolved, unintegrated, or otherwise unprovable pins must fail closed, and validation wiring plus `packages/engine/src/agents/gap-closer.ts` must not invoke validation agents or gap closure using a fabricated empty diff. Leave existing empty-diff policy responsible only for successful available-empty results.

### Tests and verification

- Extend focused state/orchestration tests to assert `base_branch` remains the logical parent and the dispatch-time SHA remains unchanged through parsing and supported compiled resume paths with trunk sync disabled and enabled; assert dispatch fails before compile when the parent artifact commit cannot resolve.
- Add a cohesive real-Git regression in the worktree/integration test area: create parent and child commits, dispatch while the parent branch exists, verify the pinned SHA and initial child-only diff, integrate the parent, advance configured trunk with an unrelated commit, and delete the parent branch while child work continues; then verify acceptance-unknown, post-gap, and final validation still see only the child implementation and stacked landing repair still succeeds while preserving repair metadata.
- Add negative real-Git/focused cases for absent pins, unresolvable SHAs, pins not integrated into configured trunk, failed ancestor proof, enumeration failure, and per-file diff failure. Assert typed actionable unavailable evidence and no validation-agent/gap-closer invocation. Separately assert a successful zero-change diff remains available-empty.
- Keep existing non-stacked trunk-sync, empty-diff policy, dispatch repair, landing repair, worktree manager, and reconciliation tests green. Run the focused Vitest files covering queue dispatch, PRD validator diff/wiring, gap closing, worktree management/integration/reconciliation, then run `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check`.

## Execution Intent

Test ownership: builder
Review depth: heavy
Review rationale: risk score 1 (low-confidence-localization); declared docs work none, test work author-new, test owner builder; model review intent heavy (The change crosses persisted orchestration state and destructive Git topology transitions. Incorrect fallback can silently validate an empty or wrong diff, while over-eager repair can alter landing topology; review must trace every lifecycle consumer and failure branch.); derived build implement -> test-cycle -> review-cycle and parallel review with perspectives code, security, test, verify, 2 round(s), strict evaluation