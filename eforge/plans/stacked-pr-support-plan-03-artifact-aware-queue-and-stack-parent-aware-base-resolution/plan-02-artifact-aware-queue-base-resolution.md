---
id: plan-02-artifact-aware-queue-base-resolution
name: Artifact-Aware Queue and Stack-Aware Base Resolution
branch: stacked-pr-support-plan-03-artifact-aware-queue-and-stack-parent-aware-base-resolution/plan-02-artifact-aware-queue-base-resolution
agents:
  builder:
    effort: high
    rationale: Multi-file engine change spanning queue scheduling, PRD frontmatter
      persistence, compile/build base selection, orchestrator artifact
      recording, and tests.
  reviewer:
    effort: high
    rationale: The change alters queue dependency semantics and build base refs, so
      review needs thorough code and test inspection.
  tester:
    effort: high
    rationale: Regression coverage must prove intentionally changed dependency
      semantics and stack base resolution.
---

# Artifact-Aware Queue and Stack-Aware Base Resolution

## Architecture Context

This plan implements Plan 03 on top of the stack baseline synchronized by `plan-01-stack-foundation-sync`. The engine already has queue scheduling, compile/build worktree creation, post-merge validation, PRD validation, and landing phases. Plan 03 changes the dependency contract for queued PRDs: a dependency is usable only when the upstream build completed and a durable artifact branch/ref is recorded. A skipped upstream no longer satisfies dependents.

A prior abandoned implementation at `ef083ddc6568e6da6274fdb3fd9e28703d3bf266` was inspected. Do not blindly cherry-pick it. Notable issues to avoid: checking only in-memory `completed` status without enforcing recorded artifact refs, using the current git branch as the root base, falling back to parent feature branches without recorded artifacts, accepting ambiguous multiple dependencies without explicit `stack_parent`, and treating artifact recording failures as non-fatal.

## Implementation

### Overview

Add strict artifact-aware readiness to queue dispatch, infer or require stack parent metadata before dispatch when stacking is enabled, resolve compile/build base refs from trunk or parent artifacts, update generated orchestration base refs through the existing compile pipeline, and record successful queued build artifacts in durable stack state before landing.

### Key Decisions

1. Use durable stack state for artifact readiness. Scheduler readiness must consult `.eforge/stacks/layers.json` through `packages/engine/src/stacking/state.ts` helpers instead of treating terminal in-memory status as sufficient.
2. Persist inferred `stack_parent` back into the queued PRD file before dispatch. This makes the inferred parent visible to the child process, compile/build, recovery, and any restarted scheduler.
3. Resolve stack base refs before compile in `buildSinglePrd`. Root stack layers use the resolved trunk branch; child layers use the parent layer's recorded `artifact.branch` and fail before compile if that ref is absent or unresolved.
4. Record the artifact before landing begins and fail the build if artifact recording fails. Downstream scheduling relies on this durable record.
5. Keep landing refactors and consumer/API/docs work out of scope; use existing landing behavior after artifact recording succeeds.

## Scope

### In Scope

- Artifact-aware dependency readiness for active and previously completed queued dependencies.
- Blocking skipped upstreams by default.
- Blocking failed upstreams and propagating blocked state to dependents.
- Stack-parent inference for a single `depends_on` when stacking is enabled.
- Dispatch blocking with a clear error for multiple `depends_on` entries without explicit `stack_parent` when stacking is enabled.
- Stack-aware base resolution for queued builds.
- Updating `orchestration.yaml` `base_branch` via the resolved base ref already passed through compile context.
- Durable artifact recording after validation succeeds and before landing.
- Tests for artifact readiness, stack-parent inference, base resolution, artifact recording, and updated skipped-dependency semantics.

### Out of Scope

- Re-implementing Plan 01/02 stack contracts, config, state helpers, events, provider interface, git-spice adapter, or git primitives.
- Artifact publication and landing action refactors planned for later PRDs.
- Daemon API, monitor UI, CLI/MCP/Pi/Claude plugin surface updates.
- Documentation files for stacking.

## Files

### Create

- `packages/engine/src/stacking/base-resolver.ts` — resolve root vs child stack context, trunk base refs, parent artifact refs, and actionable resolution errors.
- `packages/engine/src/stacking/artifacts.ts` — record successful build artifacts through stack state helpers and emit `stack:layer:recorded` events.
- `test/artifact-aware-scheduler.test.ts` — scheduler readiness and stack-parent inference tests.
- `test/stack-base-resolver.test.ts` — base-ref resolver tests for trunk roots, parent artifacts, and missing refs.
- `test/stack-artifact-recording.test.ts` — artifact recorder and/or orchestrator integration coverage for durable artifact records.

### Modify

- `packages/engine/src/queue/scheduler.ts` — load stack state during readiness checks, require recorded artifact refs, block skipped upstreams, infer/persist `stack_parent`, and block ambiguous stacked dispatches.
- `packages/engine/src/prd-queue.ts` — add a helper analogous to `setQueuedPrdProfile` for persisting `stack_parent`, and update waiting/unblock dependency checks so completed dependencies require recorded artifacts rather than mere absence from active queues.
- `packages/engine/src/eforge.ts` — resolve stack context in `buildSinglePrd`, pass resolved base refs to `compile`, pass stack context into `build`, and surface stack-resolution failures before compile with actionable messages.
- `packages/engine/src/events.ts` — add engine-only `CompileOptions` and `BuildOptions` fields for resolved base refs and stack context.
- `packages/engine/src/orchestrator.ts` — accept the resolved stack context and PRD id for artifact recording.
- `packages/engine/src/orchestrator/phases.ts` — record artifacts after validation/PRD validation succeeds and before landing; fail the build if recording fails.
- `packages/engine/src/stacking/index.ts` — export the new resolver and artifact recorder.
- `packages/engine/src/stacking/state.ts` — add a small strict lookup helper such as `getRecordedArtifactRef` if needed; do not duplicate load/save/upsert logic.
- `packages/engine/src/worktree-ops.ts` — use existing `refExists`/`getRefSha` or add a narrow preflight error path so unresolved artifact base refs produce actionable errors.
- `test/queue-scheduler.test.ts` — update the existing skipped-dependency test so skipped upstreams do not spawn dependents.
- `test/queue-piggyback.test.ts` — update waiting/unblock tests if old absence-based satisfaction assumptions fail after artifact-based semantics.
- Existing tests that construct `EforgeConfig` test doubles — add minimal `stacking` config fields only where type-checking requires them.

## Detailed Implementation Notes

### Scheduler artifact readiness

- Preserve all `frontmatter.depends_on` entries in scheduler state; do not filter out dependencies just because the upstream PRD is no longer in the active queue.
- Load stack state once per scheduling tick and use it for all dependency checks in that tick.
- Treat a dependency as satisfied only when:
  - the dependency has in-memory status `completed` and stack state contains a recorded artifact ref for that PRD, or
  - the dependency is not in memory but stack state contains a recorded artifact ref for that PRD from a prior completed build.
- Treat `failed` and `skipped` in-memory upstreams as blockers and propagate blocked state to transitive pending dependents.
- Treat stack state layers with `status: failed` as blockers for not-in-memory dependencies.
- Emit `daemon:scheduler:dependency-blocked` with the unsatisfied dependency ids for pending PRDs that cannot dispatch.

### Stack-parent inference and blocking

- Add `setQueuedPrdStackParent(prd, stackParent, cwd)` to `prd-queue.ts` using the same frontmatter rewrite pattern as `setQueuedPrdProfile`.
- In `QueueScheduler`, before session start and before `spawnPrdChild`, apply stacking dispatch validation when `config.stacking.enabled` is true:
  - `depends_on.length === 1` and no `stack_parent`: persist `stack_parent` with that dependency and update the in-memory `QueuedPrd` passed to the child.
  - `depends_on.length > 1` and no `stack_parent`: do not spawn; emit `plan:status:change` with `failed`, `plan:error:set` with a message containing `multiple depends_on` and `stack_parent`, and `queue:prd:complete` with `failed` so dependents are blocked through the existing completion path.
  - `stack_parent` present: keep it and use it for base resolution.

### Base resolution

- Implement `resolveStackBaseContext` or equivalent in `packages/engine/src/stacking/base-resolver.ts`.
- Use `resolveTrunkBranch({ build: config.build }, cwd)` for root stack layers. Do not call `git rev-parse --abbrev-ref HEAD` for root stack-layer base selection.
- For child layers, require a parent layer in stack state with a recorded `artifact.branch` or equivalent artifact ref. Do not fall back to `parent.branch` when no artifact is recorded.
- Verify the resolved parent artifact ref with `refExists(cwd, artifactRef)`. If it does not resolve, throw an error that names the child PRD, parent PRD, recorded artifact ref, and remediation: rebuild or repair the parent artifact before dispatching the child.
- Add `CompileOptions.baseBranchOverride` and use it in `compile()` before `createMergeWorktree`. The existing compile pipeline already injects `ctx.baseBranch` into `orchestration.yaml`, so the resolved base ref flows to `base_branch` when the override is set.
- Pass the resolver output from `buildSinglePrd` into both `compile()` and `build()`.

### Artifact recording

- Implement artifact recording with `upsertStackLayer` and related helpers from `stacking/state.ts`.
- Record branch `eforge/{planSetName}` and the current commit SHA from the merge worktree after validation/PRD validation succeeds.
- Record `stackId`, `parentPrdId`, `baseBranch`, provider, `artifact.branch`, `artifact.commitSha`, `status: built`, and timestamps.
- Emit `stack:layer:recorded` after state is written.
- If artifact recording throws, set build state to failed, emit an error event with the PRD id and cause, skip landing, and return a failed phase result. Do not let a queued build report completed without an artifact record when stacking is enabled.

## Verification

- [ ] A scheduler test records an artifact for a completed upstream and then observes exactly one dependent spawn after the upstream completion event.
- [ ] A scheduler test emits a completed upstream event without recording an artifact and observes zero dependent spawns after the event.
- [ ] A scheduler test emits a failed upstream event and observes zero dependent spawns plus one blocked dependent counted by `finalizeBlockedAsSkipped()`.
- [ ] The existing skipped-upstream scheduler test expects zero dependent spawns after the skipped event.
- [ ] With stacking enabled, a single dependency causes the spawned PRD and its on-disk PRD frontmatter to contain `stack_parent: <dependency-id>`.
- [ ] With stacking enabled, multiple dependencies and no `stack_parent` produce no spawn and an emitted error containing `multiple depends_on` and `stack_parent`.
- [ ] A base resolver test checks out a non-trunk branch, configures `build.trunkBranch: main`, resolves a root PRD, and receives `baseBranch === 'main'`.
- [ ] A base resolver test records a parent artifact branch, creates that git ref, resolves a child PRD, and receives the parent artifact branch as `baseBranch`.
- [ ] A base resolver test records a parent artifact branch without creating the git ref and receives a thrown error naming the parent PRD and artifact ref.
- [ ] An artifact recording test verifies `.eforge/stacks/layers.json` contains the queued PRD id, feature branch, base branch, artifact branch, and commit SHA after validation succeeds.
- [ ] `pnpm vitest run test/artifact-aware-scheduler.test.ts test/stack-base-resolver.test.ts test/stack-artifact-recording.test.ts test/queue-scheduler.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
