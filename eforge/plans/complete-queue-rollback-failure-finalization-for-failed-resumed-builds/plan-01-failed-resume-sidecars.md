---
id: plan-01-failed-resume-sidecars
name: Finalize Failed Resume Recovery Sidecars
branch: complete-queue-rollback-failure-finalization-for-failed-resumed-builds/plan-01-failed-resume-sidecars
agents:
  builder:
    effort: high
    rationale: The change crosses direct and scheduler-owned resume rollback paths,
      recovery sidecar generation, and tests around a large legacy engine file
      that requires bounded edits.
  reviewer:
    effort: high
    rationale: Review must check ordering around rollback safety, stale-sidecar
      invalidation, and both resume paths.
---

# Finalize Failed Resume Recovery Sidecars

## Architecture Context

Compiled-build resume uses queue-file transitions in `packages/engine/src/queue/resume-cascade.ts`, while recovery evidence generation currently lives in `packages/engine/src/eforge.ts`. Normal queued PRD failures build a `BuildFailureSummary`, select a recovery verdict, and write `.recovery.md` / `.recovery.json` sidecars before the failed PRD is exposed in `.eforge/queue/failed/`. Compiled-resume failures currently take separate rollback branches and return before that sidecar finalization path runs.

Queue rollback safety remains the first invariant: `rollbackQueuedResume()` must restore the PRD and descendants, release locks, and preserve collision protections before any recovery sidecar refresh occurs. Recovery finalization must stay outside `packages/engine/src/queue/resume-cascade.ts` so that module remains a filesystem transition helper.

## Implementation

### Overview

Add a shared failed queued-resume sidecar finalization helper and call it from both compiled-resume rollback paths after rollback succeeds. The helper must use compiled-resume metadata (`setName`, `featureBranch`, `baseBranch`) and the existing recovery summary/verdict machinery. When current resumed-run evidence is available, it rewrites sidecars from the resumed failure. When activation occurred but the current summary is not trustworthy, it writes a degraded manual sidecar; if sidecar writing itself fails, it removes old sidecars as a last-resort stale-evidence invalidation.

### Key Decisions

1. Keep `rollbackQueuedResume()` pure. It continues to move queue files, re-skip descendants, release locks, and preserve sidecars; engine finalizers decide whether to refresh or invalidate evidence after rollback.
2. Create a focused recovery helper rather than adding more large blocks to `eforge.ts`. The helper owns resumed-run evidence classification, recovery analyst invocation, manual fallback verdict construction, and `writeRecoverySidecar()` calls.
3. Trust `buildFailureSummary()` only when the monitor DB shows a failed `resume` run for the resumed set with plan/merge/status evidence that `synthesizeFromEvents()` can summarize. If the latest failed resume has activation evidence but no summarizable plan evidence, write a degraded manual sidecar using the compiled-resume metadata instead of reusing stale pre-resume evidence.
4. Preserve direct pre-activation ineligible resume sidecars. The direct `resumeBuild()` path can track whether `build:resume:start` was reached; if it was not reached, rollback keeps prior sidecars.
5. Await failed-resume sidecar finalization before scheduler-owned parent finalization returns. The scheduler must not emit `queue:prd:complete` for the failed compiled resume until the sidecar write or invalidation path has finished.

## Scope

### In Scope

- Failed compiled-resume rollback after resume activation.
- Direct `resumeBuild(prdId)` rollback for non-scheduler-owned queued resumes.
- Scheduler-owned compiled-resume child finalization in `spawnPrdChild().finalize()`.
- Current sidecar rewrite or degraded manual sidecar/invalidation for failed resumed runs.
- Preservation of pre-activation ineligible direct-resume sidecars.
- Existing successful compiled-resume cleanup semantics.
- Existing descendant re-skip behavior and rollback collision protections.
- Architecture documentation update.

### Out of Scope

- Moving recovery-agent side effects into `packages/engine/src/queue/resume-cascade.ts`.
- Adding a second failure-summary mechanism.
- Changing daemon route contracts or recovery wire schemas.
- Changing `packages/engine/src/recovery/failure-summary.ts` or `packages/engine/src/recovery/event-history.ts` behavior unless implementation shows a narrow evidence-inspection export is required.
- Scheduling, approval, notification, or wrapper-app workflow features.

## Files

### Create

- `packages/engine/src/recovery/failed-resume-sidecar-finalization.ts` — Shared helper for failed queued-resume recovery sidecar refresh/invalidation after rollback. It should:
  - accept `cwd`, `queueDir`, sidecar `prdId`, compiled-resume `setName`, `featureBranch`, `baseBranch`, configured trunk branch, agent runtimes, engine config, and optional abort/verbose inputs;
  - inspect `.eforge/monitor.db` for current failed `resume` evidence for the resumed set;
  - call `buildFailureSummary({ setName, prdId, cwd, dbPath, trunkBranch, featureBranch, baseBranch })` only when current resume evidence is summarizable;
  - run `runRecoveryAnalyst()` with the same deterministic fallback pattern used by normal queued failure recovery;
  - call `writeRecoverySidecar()` in `.eforge/queue/failed/`;
  - write a partial/manual degraded sidecar when activation evidence exists but the summary is not trustworthy;
  - remove both recovery sidecars if writing a current or degraded sidecar fails, so stale evidence is not left as authoritative.

### Modify

- `packages/engine/src/eforge.ts` — Import and await the helper in both rollback paths:
  - In direct `resumeBuild()`, track whether resume activation reached `build:resume:start` / artifact processing. After `rollbackQueuedResume()` returns `rolled-back`, call the helper only when activation was reached and the resume did not finalize successfully. Keep pre-activation ineligible rollback preserving old sidecars.
  - In `spawnPrdChild().finalize()`, derive valid compiled-resume metadata with `getCompiledResumeFrontmatter()` once. For non-completed compiled-resume child exits, await rollback and then await failed-resume sidecar finalization before returning. For completed child exits where `finalizeQueuedResumeSuccess()` is blocked and rollback succeeds, write a degraded manual sidecar that records the finalization failure instead of preserving old evidence.
  - Do not call the helper when rollback is blocked, when the PRD is already claimed, or when success cleanup completes.
  - Keep the normal queued failure `moveFailedWithSidecar()` path intact except for any small reuse refactor needed by the helper.
- `test/resume-compiled-build-engine.test.ts` — Add/adjust tests for:
  - direct queued resume failure after activation replacing old sidecars with a JSON summary for the resumed set and the resumed failing plan;
  - scheduler-owned parent finalization using a controlled child exit path, asserting sidecars are refreshed before the parent emits `queue:prd:complete`;
  - pre-activation ineligible direct resume preserving the prior sidecar contents byte-for-byte;
  - successful compiled-resume cleanup behavior still removing root/failed PRD files, recovery sidecars, locks, and unblocking descendants.
- `docs/architecture.md` — Replace the unconditional sidecar-preservation wording for failed/ineligible compiled resumes. Document that pre-activation ineligible rollback may preserve prior sidecars, while failed resumed runs after activation refresh sidecars from resumed-run evidence or write/remove degraded evidence so stale sidecars are not authoritative.

## Database Migration

No database migration is required.

## Verification

- [ ] A direct queued resume test seeds old sidecars, reaches `build:resume:start`, fails the resumed run, and then reads `.eforge/queue/failed/<prdId>.recovery.json` with `summary.setName` equal to the resumed set.
- [ ] The same direct test reads `summary.failingPlan.planId` from the JSON sidecar and gets the resumed failed plan ID, not the old sidecar's plan ID.
- [ ] The same direct test reads `.eforge/queue/failed/<prdId>.recovery.md` and finds the resumed set and resumed failed plan ID.
- [ ] A scheduler-owned queue-path test observes `queue:prd:complete` for a failed compiled resume only after `.eforge/queue/failed/<prdId>.md`, `<prdId>.recovery.md`, and `<prdId>.recovery.json` exist; the JSON sidecar has `summary.setName` equal to the resumed set and `summary.failingPlan.planId` equal to the resumed failed plan ID, and the Markdown contains both values.
- [ ] The scheduler-owned test verifies waiting descendants reactivated during resume are back under `.eforge/queue/skipped/` after rollback.
- [ ] A pre-activation ineligible direct-resume test verifies the original recovery JSON content is unchanged after rollback.
- [ ] Existing success tests verify root PRD, failed PRD, recovery sidecars, and lock files are removed after a usable artifact is recorded.
- [ ] Existing rollback collision tests still prevent overwriting queue-root, failed-target, and skipped-descendant collisions.
- [ ] `docs/architecture.md` no longer states that failed resumed runs unconditionally preserve recovery sidecars.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test -- resume-compiled-build-engine queue-recovery-cascade` exits 0.
