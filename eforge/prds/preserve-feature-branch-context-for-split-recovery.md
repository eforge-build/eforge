---
title: Preserve Feature-Branch Context for Split Recovery
created: 2026-06-01
---

# Preserve Feature-Branch Context for Split Recovery

## Problem / Motivation

Split recovery is unsafe for partially completed builds. A recovery analyst can recommend a successor PRD that says to continue from the failed build's feature branch, but `applyRecoverySplit()` currently enqueues that successor as an ordinary PRD. The scheduler then compiles it from the current base branch/HEAD instead of from the partially completed feature branch.

This bug aligns with the roadmap's **Kernel Resilience and Typed Recovery** theme: split/retry/resume recovery paths should be inspectable, repeatable, and honest about branch/worktree state.

Backlog source: `.eforge/backlog/items/backlog-2026-06-01-preserve-feature-branch-context-when-applying-split-recovery.md`.

Affected users are anyone applying a `split` verdict after an expedition/excursion has already landed useful plan commits onto its feature branch. The successor can silently omit completed work, duplicate planning, or produce a branch/PR that no longer includes the preserved foundation.

This matters now because the monitor-server migration recovery demonstrated the issue: `complete-monitor-server-architecture-migration` was enqueued from a split verdict, but the branch started from current main and did not include the already completed `migrate-monitor-server-to-a-maintainable-architecture` plans 01-04.

Confirmed evidence:

- `packages/engine/src/recovery/apply.ts` currently implements `applyRecoverySplit()` by stripping any suggested-successor frontmatter and calling `enqueuePrd({ body, title, queueDir, cwd, depends_on: [] })`. No branch/base/continuation metadata is persisted.
- `enqueuePrd()` and PRD frontmatter currently persist dependency/profile/landing/stack metadata, but not recovery continuation metadata such as source feature branch or worktree base ref.
- Queued PRDs are compiled through `EforgeEngine.buildSinglePrd()`, which calls `compile(prd.filePath, { name: planSetName, ... })`. Non-stacked queued builds only get `worktreeBaseRefOverride` from trunk sync, not from PRD frontmatter.
- `compile()` already has the primitive needed for safe continuation: `baseBranchOverride` controls logical landing base while `worktreeBaseRefOverride` controls the ref used by `createMergeWorktree()` only.
- `resumeBuild()` already has a separate compiled-artifact path that uses `checkResumeEligibility()`, reconstructs plan artifacts from the preserved feature branch/history, seeds merged plans, and runs the remaining original plans without recompiling.
- The observed failure reproduced the gap: successor branch `eforge/complete-monitor-server-architecture-migration` did not contain prior branch head `7bab632f`; its merge-base with `eforge/migrate-monitor-server-to-a-maintainable-architecture` was old base `636639d5`; prior completed monitor work was absent from the successor branch (`70 files changed, 4049 insertions` in `packages/monitor/src` when diffing successor to prior branch).

Reproduction steps:

1. Have a failed build with partial landed work and a split recovery sidecar. The observed case was `migrate-monitor-server-to-a-maintainable-architecture`, whose sidecar summary recorded completed/merged plans 01-04 and pending/failed plans 05-07.
2. Apply the split verdict so eforge writes a successor PRD. The observed successor was `complete-monitor-server-architecture-migration`.
3. Let auto-build start the successor.
4. Inspect the successor branch and prior failed feature branch.

Actual behavior confirmed by git:

- `git merge-base eforge/complete-monitor-server-architecture-migration eforge/migrate-monitor-server-to-a-maintainable-architecture` returned old base `636639d5d8783422422c77eef0d25d56b82dfa1a`.
- `git merge-base --is-ancestor eforge/migrate-monitor-server-to-a-maintainable-architecture eforge/complete-monitor-server-architecture-migration` exited non-zero.
- Prior feature branch head was `7bab632f...`; successor head was `b267ceae...`.
- `git diff --stat eforge/complete-monitor-server-architecture-migration..eforge/migrate-monitor-server-to-a-maintainable-architecture -- packages/monitor/src` showed 70 monitor files / 4049 insertions absent from the successor baseline.

Confirmed root cause:

- `packages/engine/src/recovery/apply.ts` treats `suggestedSuccessorPrd` as body-only content. It strips any agent frontmatter and calls `enqueuePrd({ body, title, queueDir, cwd, depends_on: [] })`.
- `packages/engine/src/prd-queue.ts` frontmatter currently supports `title`, `created`, `priority`, `depends_on`, `profile`, stack metadata, and landing metadata, but no recovery continuation fields.
- `packages/engine/src/eforge.ts` `buildSinglePrd()` compiles queued PRDs with `compile(prd.filePath, { name: planSetName, ... })`. The only existing non-stacked override to `worktreeBaseRefOverride` comes from trunk sync. There is no PRD frontmatter path that says "create the successor worktree from this previous feature branch while keeping this logical base branch".
- `compile()` already supports the needed lower-level split between logical base and worktree base: `baseBranchOverride` and `worktreeBaseRefOverride`. The bug is that recovery/queue metadata cannot drive those options.
- `resumeBuild()` can already recover compiled artifacts from the failed build's feature branch/history and seed merged plans. That path is separate from split recovery and is not used by `applyRecoverySplit()`.
- Console/Pi/Claude recovery surfaces currently describe split as applying sidecar recovery/enqueueing a successor PRD, while resume is a separate manual action. This means users can choose split even when the split successor is only safe if it keeps branch context.

This looks like a **bugfix / deep** change. It is a recovery correctness bug with branch/worktree semantics and user-facing Console/Pi/Claude recovery guidance, but it should be planable as one cohesive Excursion rather than an Expedition.

## Goal

If a split successor is intended to continue partial completed work, the queued successor must compile from the preserved feature branch or otherwise run through the compiled-artifact resume path.

The successor build must not silently start from unrelated current main when recovery evidence identifies a preserved feature branch with landed partial work.

## Approach

Preserve split semantics by enqueueing a successor PRD, but make it a continuation PRD when recovery evidence shows partial landed work.

Store continuation intent as typed PRD frontmatter owned by the queue layer. Queue workers are process-isolated, so any branch/base decision must survive filesystem queueing and daemon restart. Prose in the successor PRD body is not machine-readable and must not control git behavior.

Use `summary.featureBranch` as the successor worktree base ref and `summary.baseBranch` as the logical/landing base branch. `compile()` already separates `worktreeBaseRefOverride` from `baseBranchOverride`. Creating the successor branch from the preserved feature branch keeps completed partial work in the codebase, while keeping the logical base branch as the original base preserves final landing target semantics.

Require fail-closed validation for continuation metadata. Branch refs are used in git commands. The implementation should reuse or mirror existing path/ref validation patterns and should not enqueue a continuation successor for partial landed work when the referenced branch is missing or unsafe.

Treat continuation metadata as recovery-owned, not agent-owned. `applyRecoverySplit()` already strips agent frontmatter. Continue stripping agent frontmatter and synthesize trusted continuation fields from the recovery sidecar summary, not from arbitrary LLM-emitted YAML.

Keep compiled-artifact resume separate, but make recovery UX aware that resume may be the safer action. Resume runs original compiled plans; split creates a new focused PRD. Both are useful. The bug is that split successors currently lose branch context, not that split should always become resume.

Likely implementation targets:

- `packages/engine/src/recovery/apply.ts`
  - Pass recovery summary context into `applyRecoverySplit()` or add a helper that derives continuation metadata from sidecar summary.
  - For split verdicts with partial landed/merged work and a valid preserved feature branch, write successor PRD frontmatter with continuation metadata instead of body/title/dependencies only.
  - Fail closed with an actionable error if partial-work continuation metadata is required but the source feature branch/base cannot be resolved safely.
- `packages/engine/src/prd-queue.ts`
  - Extend PRD frontmatter schema, parser, serializer, and `EnqueuePrdOptions` with recovery continuation fields.
  - Candidate fields: `recovery_from`, `recovery_set_name`, `recovery_feature_branch`, `recovery_base_branch`, and `recovery_worktree_base_ref` or an equivalent small set.
  - Exact names can be finalized during implementation, but they must be typed and validated.
- `packages/engine/src/events.ts`
  - Extend `EnqueueOptions`/queue-related engine-only types only if the selected metadata path requires it.
- `packages/engine/src/eforge.ts`
  - In `applyRecovery()`, parse sidecar summary with enough type safety to pass `featureBranch`, `baseBranch`, landed plan evidence, and setName into split application.
  - In `buildSinglePrd()`, honor continuation PRD frontmatter by passing `baseBranchOverride` and `worktreeBaseRefOverride` into `compile()` for non-stacked queued successor builds.
  - Keep stacked PRD behavior separate unless tests show a safe interaction; recovery continuation should not accidentally override `stackContext` semantics.
- `packages/monitor/src/server.ts`
  - The HTTP `applyRecovery` route currently dispatches directly to `applyRecoverySplit()` after reading the sidecar; it needs the same sidecar-summary-aware behavior as `EforgeEngine.applyRecovery()`.
  - If response shape changes, route types and daemon API version must be updated.
  - Prefer preserving the existing response shape unless extra metadata is necessary for clients.
- First-party recovery guidance and UI copy:
  - `packages/pi-eforge/skills/eforge-recover/SKILL.md`
  - `eforge-plugin/skills/recover/recover.md`
  - `packages/console-ui/src/components/now/queue-recovery-dialog.tsx`
  - Update only if wording would otherwise imply that split always starts fresh or does not need preserved branch context.
- Tests:
  - `test/apply-recovery.test.ts` for split frontmatter/sidecar behavior.
  - Queue/build tests such as `test/watch-queue.test.ts` or a focused engine unit/integration test proving continuation metadata reaches `compile()` as `worktreeBaseRefOverride` while logical base remains the original base branch.
  - Route tests around `applyRecovery` if daemon route behavior changes.
  - Browser/Pi/Claude guidance tests only if user-facing copy changes.

Risks and constraints:

- Branch/base confusion: using the prior feature branch as both worktree base and logical base would create a PR targeting the old feature branch instead of the original base. The implementation must keep worktree base and logical base separate.
- Stale prior feature branch: the preserved feature branch may be behind current trunk. That is acceptable for preserving partial work, but validation/landing may later surface conflicts. This bugfix should not silently merge trunk into the preserved feature branch unless a separate policy says to.
- Stacked PR interaction: queued PRDs already have stack metadata and `stackContext` may set `baseBranchOverride`. Recovery continuation metadata should not override stacked-child semantics without explicit tests.
- Unsafe ref input: feature branch/base values come from a sidecar generated from prior events, but they still reach git commands. Validate with strict ref/path-segment rules and reject suspicious values.
- Compatibility of old sidecars: existing split sidecars without continuation evidence should still apply when there is no partial landed work. Existing sidecars with partial work but missing feature/base evidence should fail with a clear message rather than enqueueing a misleading successor.
- User-facing ambiguity: Console/Pi/Claude currently present split and resume as separate actions. If split becomes continuation-aware, wording should clarify that split may enqueue a successor that starts from the preserved feature branch.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `worktreeBaseRefOverride` plus `baseBranchOverride` is the right existing primitive for successor continuation. | Confirmed in `packages/engine/src/events.ts` and `packages/engine/src/eforge.ts`: `compile()` uses `worktreeBaseRefOverride` only for `createMergeWorktree()` and `baseBranchOverride` for logical/landing base. | high | low | Add a focused test that a queued continuation PRD passes both options and writes orchestration with the logical base. | If wrong, implementation could create a PR targeting the wrong branch or still omit prior work. |
| Split successors should remain PRDs rather than always converting to resume builds. | Confirmed `resumeBuild()` already exists for original compiled plans, while split verdicts intentionally carry a `suggestedSuccessorPrd` that may re-scope remaining work. This is a design choice, not purely a fact. | medium | low | During implementation, verify Console/Pi/Claude recovery flows can still offer resume separately and apply split as a continuation successor. | If wrong, the change may preserve branch context but still not match user expectations for split vs resume. |
| Partial landed work can be detected from sidecar summary via `landedCommits`, `plans[].mergedAt`, or equivalent merge evidence. | Confirmed recovery sidecar for the observed failure includes landed commits and completed plan entries with `mergedAt`. `deriveResumeSeedState()` uses `mergedAt` as canonical merge-complete evidence. | high | low | Add tests for split sidecars with landed commits, mergedAt, and no partial evidence. | If wrong, eforge may either over-apply continuation metadata or fail to protect a partial successor. |
| The preserved feature branch should be validated at apply time for partial-work split successors. | `checkResumeEligibility()` already requires the feature branch for resume. Cheap git check showed the observed preserved branch existed. Ref safety is already treated carefully in resume helpers. | high | low | Implement git/ref validation and tests for missing/unsafe refs before writing the successor file. | If wrong, eforge may enqueue a PRD that later fails less clearly or may pass unsafe ref strings to git. |
| Existing fresh split behavior remains valid for failures with no partial landed work. | Existing `test/apply-recovery.test.ts` asserts split writes a successor PRD and leaves failed files/sidecars. There is no evidence every split must be a branch continuation. | medium | low | Preserve existing tests and add a no-partial-evidence split test. | If wrong, the fix could unintentionally change early-failure split behavior. |
| Updating recovery guidance copy is sufficient for first-party UX if response shape remains unchanged. | Searches show Console/Pi/Claude copy describes split as enqueueing a successor and resume as separate. No route response shape change is inherently required for branch-continuation metadata. | medium | low | Inspect final implementation; if response adds continuation fields, update client types and daemon API version. | If wrong, stale clients may present misleading recovery state or fail to display important continuation behavior. |
| Stacked PRD interaction can be guarded rather than fully redesigned in this bugfix. | `buildSinglePrd()` already has distinct `stackContext` path for base resolution. The observed bug was a non-stacked recovery path. | medium | medium | Add a regression that continuation metadata is rejected or ignored with explicit behavior for stacked PRDs; defer richer stacked continuation if needed. | If wrong, recovery continuation could break stacked landing semantics or silently target an incorrect stack parent. |

Recommended profile: **Excursion**.

Rationale: this is a high-impact recovery correctness bug with multiple coordinated files, but a single cohesive plan can cover the changes. The implementation needs typed queue metadata, split-apply behavior, queued compile handoff, and focused first-party recovery wording/tests. It does not require delegated module planning or independent subsystem designs, so Expedition would add overhead without improving the handoff.

## Scope

In scope:

- Preserve split semantics by enqueueing a successor PRD.
- Make split successors continuation PRDs when recovery evidence shows partial landed or merged work.
- Persist typed continuation metadata through PRD queue frontmatter.
- Synthesize continuation metadata from the recovery sidecar summary.
- Strip agent-emitted frontmatter from `suggestedSuccessorPrd`.
- Validate preserved feature branch/base metadata before writing a continuation successor.
- Use the preserved feature branch as `worktreeBaseRefOverride`.
- Use the original base branch as `baseBranchOverride`.
- Keep the failed PRD and recovery sidecars in `.eforge/queue/failed/` after successful split apply.
- Apply the same continuation behavior through `EforgeEngine.applyRecovery()` and daemon `POST /api/recover/apply`.
- Update first-party Console, Pi, and Claude Code recovery wording if current wording would imply split always starts fresh or does not need preserved branch context.
- Add focused regression tests for split application and queued continuation compile behavior.
- Preserve existing fresh split behavior when there is no partial landed or merged work.
- Preserve existing non-continuation queued PRD base-ref behavior.
- Guard stacked PRD behavior so recovery continuation does not accidentally override `stackContext` semantics unless explicit tests show a safe interaction.

Out of scope:

- Converting all split recovery into compiled-artifact resume.
- Silently merging trunk into the preserved feature branch.
- Letting arbitrary LLM-emitted YAML control git branch/base behavior.
- Redesigning stacked PRD semantics without explicit tests proving a safe interaction.
- Changing daemon response shape unless extra metadata is necessary for clients.
- Using an Expedition profile or delegated subsystem planning for this bugfix.

## Acceptance Criteria

- `applyRecoverySplit()` writes typed continuation frontmatter on split successors when the recovery sidecar summary contains partial landed or merged plan evidence and a preserved `featureBranch`.
- Split successor continuation frontmatter is synthesized from the recovery sidecar summary, not from agent-emitted YAML in `suggestedSuccessorPrd`.
- Agent-emitted frontmatter in `suggestedSuccessorPrd` is still stripped before the successor body is written.
- A split successor with partial-work continuation metadata persists the source failed PRD id.
- A split successor with partial-work continuation metadata persists the original set name.
- A split successor with partial-work continuation metadata persists the preserved feature branch ref.
- A split successor with partial-work continuation metadata persists the original logical base branch.
- Applying a split verdict with partial landed work and a missing preserved feature branch fails before writing a successor PRD.
- Applying a split verdict with an unsafe preserved feature branch ref fails before writing a successor PRD.
- Applying a split verdict with no partial landed or merged work preserves the existing fresh-successor behavior.
- The failed PRD remains in `.eforge/queue/failed/` after a successful split apply.
- The recovery sidecar markdown remains in `.eforge/queue/failed/` after a successful split apply.
- The recovery sidecar JSON remains in `.eforge/queue/failed/` after a successful split apply.
- A queued continuation successor passes the preserved feature branch to `compile()` as `worktreeBaseRefOverride`.
- A queued continuation successor passes the original logical base branch to `compile()` as `baseBranchOverride`.
- A queued continuation successor creates its merge worktree from the preserved feature branch rather than current `HEAD`.
- A queued continuation successor's orchestration config records the original logical base branch, not the preserved feature branch, as `base_branch`.
- A queued continuation successor branch contains commits from the preserved feature branch before successor planning work is added.
- Non-continuation queued PRDs compile with the same base-ref behavior as before.
- Stacked queued PRDs keep existing stack base resolution behavior unless explicit continuation tests prove a safe interaction.
- The daemon `POST /api/recover/apply` split path applies the same continuation metadata rules as `EforgeEngine.applyRecovery()`.
- First-party Console recovery copy no longer implies that a split successor always starts fresh from current main.
- First-party Pi recovery guidance no longer implies that a split successor always starts fresh from current main.
- First-party Claude Code recovery guidance no longer implies that a split successor always starts fresh from current main.
- Regression tests cover split apply with partial completed work and a valid preserved feature branch.
- Regression tests cover split apply with partial completed work and a missing preserved feature branch.
- Regression tests cover queued continuation successor compile base selection.
- `pnpm vitest run test/apply-recovery.test.ts` exits 0.
- The targeted queue/build continuation regression test exits 0.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
