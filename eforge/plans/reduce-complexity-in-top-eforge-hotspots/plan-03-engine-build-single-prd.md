---
id: plan-03-engine-build-single-prd
name: Extract Queued PRD Build Phases
branch: reduce-complexity-in-top-eforge-hotspots/plan-03-engine-build-single-prd
agents:
  builder:
    effort: xhigh
    rationale: This is a high-risk async-generator refactor with strict event
      ordering, session-id, queue, resume, recovery, stack, and trunk-sync
      semantics.
  reviewer:
    effort: high
    rationale: Review must trace success, failure, skip, stale, compiled-resume,
      recovery-continuation, stack, and trunk-sync event sequences.
  tester:
    effort: high
    rationale: The targeted tests cover queue/session/resume/recovery invariants
      that can regress during helper extraction.
---

# Extract Queued PRD Build Phases

## Architecture Context

`EforgeEngine.buildSinglePrd` is the queued PRD subprocess entry point. The parent scheduler owns process spawning, lock release, and file-location transitions; the child method claims a PRD, emits queue/session/build events, runs compiled resume or compile/build flows, and emits terminal events.

The current method mixes claim handling, pre-build validation, stale PRD revision, compiled resume, recovery continuation, stack context, trunk-sync base selection, compile execution, build execution, and terminal event emission. This plan mechanically extracts those phases while keeping `EforgeEngine.buildSinglePrd` public and preserving all event ordering.

## Implementation

### Overview

Move the queued PRD build orchestration into a focused helper module and leave `EforgeEngine.buildSinglePrd` as a thin delegating public method. The helper module receives a context object containing `cwd`, `config`, `agentRuntimes`, and bound `compile`, `build`, and `resumeBuild` generator callbacks.

### Key Decisions

1. Create a new helper file because `packages/engine/src/eforge.ts` is oversized and near its no-growth ceiling.
2. Keep `EforgeEngine.buildSinglePrd(prd, options, sessionId?)` as the public queued subprocess entry point.
3. Preserve the existing event sequence for every return path; helper extraction must not move session, queue, stale-assessor, compile, build, or resume events across phase boundaries.
4. Use `withRunId`, trunk-sync event collection, `forgeCommit`, `composeCommitMessage`, and existing state/event variants. Do not duplicate contracts or add raw `git commit` calls.
5. Keep provider SDK imports restricted to harness files; the new helper module must not import provider SDK packages.

### New Helper Module Shape

Create `packages/engine/src/queue/build-single-prd.ts` with exported generator:

```ts
export async function* runQueuedPrdBuild(
  ctx: QueuedPrdBuildContext,
  prd: QueuedPrd,
  options: QueueOptions,
  sessionId?: string,
): AsyncGenerator<EforgeEvent>;
```

The context can use callback types rather than importing `EforgeEngine` as a runtime value:

- `compile(source, options)` → `AsyncGenerator<EforgeEvent>`.
- `build(planSet, options)` → `AsyncGenerator<EforgeEvent>`.
- `resumeBuild(prdId, options)` → `AsyncGenerator<EforgeEvent>`.
- `cwd`, `config`, and `agentRuntimes`.

If the new file exceeds 300 lines, add balanced durable semantic region markers such as `queued-prd-types`, `pre-build-validation`, `staleness`, `compile-preparation`, and `phase-execution`. Keep the new file ≤600 lines.

### Phase Helpers

Extract focused helpers with discriminated return values so no helper has Cognitive Complexity above 30:

- `emitQueuePrdStart(prd)`.
- `emitAlreadyClaimedSkip(prd, injectedSessionId)` preserving the existing direct-vs-injected session behavior.
- `emitPreBuildFailureEvents(prdId, prdSessionId, injectedSessionId, message)` preserving:
  1. direct invocation only: `session:start`
  2. `plan:status:change`
  3. `plan:error:set`
  4. `session:end`
  5. `queue:prd:complete`
- `readCompiledResumeFrontmatter(frontmatter)` returning success or failure message.
- `validateAcceptanceInventory(prd, compiledResume, config)` returning success or failure message.
- `assessAndApplyStaleness(ctx, prd, options, compiledResume, sessionInfo)` yielding staleness-assessor events before any child-side `session:start` and returning either an updated PRD or a terminal skip/failure marker.
- `extractRevisionInventory(...)` for the stale-revision acceptance inventory extraction path.
- `commitStaleRevision(...)` using `retryOnLock`, `exec('git', ['add', ...])`, `forgeCommit`, and `composeCommitMessage`; commit failure still yields `queue:prd:commit-failed` and continues.
- `runCompiledResumePhase(ctx, compiledResume, prd, options, prdSessionId)` yielding `withRunId(resumeBuild(...))` events stamped with `sessionId` and returning `Resume failed` or `Resume complete`.
- `readRecoveryContinuation(frontmatter)` returning success or failure message.
- `resolveQueuedStackContext(ctx, prd, planSetName, recoveryContinuation)` preserving the recovery-continuation vs explicit stack metadata failure.
- `requireQueuedStackProvider(ctx, stackContext)` creating the provider and running `requireAvailable(cwd)` before compile.
- `resolveCompileOverrides(ctx, prd, recoveryContinuation, stackContext)` yielding recovery/trunk-sync progress and diagnostic events, returning `baseBranchOverride`, `worktreeBaseRefOverride`, or a failure summary.
- `runCompilePhase(ctx, prd, planSetName, options, prdSessionId, overrides)` yielding `withRunId(compile(...))` events stamped with `sessionId`, tracking `phase:end` failure and `planning:skip` reason.
- `runBuildPhase(ctx, prd, planSetName, options, prdSessionId, stackContext, stackProvider)` yielding `withRunId(build(...))` events stamped with `sessionId` and resolving landing precedence from explicit options before PRD frontmatter.
- `emitTerminalQueuedPrdEvents(prd, prdSessionId, result)` emitting `session:end` followed by `queue:prd:complete` for the main session block.

Move or reuse `collectTrunkSyncEvents` with the trunk-sync override helper instead of duplicating its event construction.

### Event Ordering Constraints

The implementation must preserve these current sequences:

- Claim failure: `queue:prd:start` → `queue:prd:skip` → injected-session `session:end` only when `sessionId` is supplied → `queue:prd:complete`.
- Invalid compiled-resume metadata or invalid acceptance inventory before the main session: `queue:prd:start` → optional direct `session:start` → `plan:status:change` → `plan:error:set` → `session:end` → `queue:prd:complete`.
- Stale obsolete or stale needs-revision skip before the main session: staleness assessor events remain before any child-side `session:start`; skip emits `queue:prd:skip` → injected-session `session:end` only when `sessionId` is supplied → `queue:prd:complete`.
- Stale revision extraction events remain before the main session; revision extraction failure uses the pre-build failure sequence.
- Main session direct invocation emits `session:start` before compiled-resume, compile, or build events; injected `sessionId` emits no child-side `session:start`.
- Resume, compile, and build subgenerator events remain wrapped with `withRunId(...)` and then stamped with the PRD session id.
- Main session terminal events remain `session:end` then `queue:prd:complete`.

## Scope

### In Scope

- Modify `packages/engine/src/eforge.ts` to delegate `buildSinglePrd` and prune imports moved to the helper module.
- Create `packages/engine/src/queue/build-single-prd.ts` for queued PRD build orchestration helpers.
- Preserve compiled-resume, stale PRD revision, recovery continuation, stack context, trunk-sync, compile, build, landing precedence, session-id, claim, lock/cleanup ownership, and terminal event behavior.
- Keep existing tests passing, especially queue/resume/recovery/session-id tests named in the source.

### Out of Scope

- Queue lifecycle redesign.
- Queue directory layout changes.
- Event schema changes.
- Daemon route or wire-shape changes.
- Public API changes beyond private helper extraction.
- New dependencies.
- Provider SDK import moves.
- Direct state mutation outside `mutateState` event handling.
- Raw `git commit` invocations.

## Files

### Create

- `packages/engine/src/queue/build-single-prd.ts` — helper module for queued PRD build phases, return discriminants, pre-build failure emission, stale assessment/revision, compiled resume, recovery/stack/trunk-sync preparation, compile execution, build execution, and terminal events.

### Modify

- `packages/engine/src/eforge.ts` — import `runQueuedPrdBuild`, replace `buildSinglePrd` body with delegation, bind `this.compile`, `this.build`, and `this.resumeBuild`, and remove imports that only served the old inline `buildSinglePrd` body.

## Verification

- [ ] `EforgeEngine.buildSinglePrd` remains present in `packages/engine/src/eforge.ts` with the same public signature.
- [ ] `EforgeEngine.buildSinglePrd` delegates to the queued PRD helper and has Cognitive Complexity ≤30.
- [ ] Every named helper extracted from `buildSinglePrd` has Cognitive Complexity ≤30.
- [ ] `packages/engine/src/queue/build-single-prd.ts` is ≤600 lines.
- [ ] Any new helper file above 300 lines contains balanced durable semantic `// --- eforge:region ... ---` markers.
- [ ] No new raw `git commit` invocation appears outside `packages/engine/src/git.ts`.
- [ ] No direct mutation of `plan.status`, `plan.error`, `state.completedPlans`, or `state.mergeWorktreePath` is introduced.
- [ ] Claim failure, pre-build failure, stale skip, compiled-resume, recovery-continuation, stack, trunk-sync, compile failure, planning skip, build failure, and build success paths retain their existing terminal `session:end` and `queue:prd:complete` ordering.
- [ ] `test/queued-compiled-resume-engine.test.ts` passes as part of `pnpm test`.
- [ ] `test/engine-enqueue-after-queue-id.test.ts` passes as part of `pnpm test`.
- [ ] `test/recovery-continuation-queue.test.ts` passes as part of `pnpm test`.
- [ ] `test/greedy-queue-scheduler.test.ts` passes as part of `pnpm test`.
- [ ] `test/onsuccess-override-precedence.test.ts` passes as part of `pnpm test`.
- [ ] `test/with-run-id.test.ts` passes as part of `pnpm test`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm complexity:scan` no longer reports the original high-CC `packages/engine/src/eforge.ts:990` `EforgeEngine.buildSinglePrd` entry.