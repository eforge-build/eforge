---
id: plan-01-engine-queued-resume
name: Engine Queued Compiled-Build Resume
branch: model-compiled-build-resume-as-a-queued-prd-mode/plan-01-engine-queued-resume
agents:
  builder:
    effort: xhigh
    rationale: Cross-cutting engine queue execution change touching frontmatter
      parsing, queue transitions, child finalization, and PRD validation wiring.
  reviewer:
    effort: high
    rationale: Queue state transitions and path/branch-derived resume metadata need
      careful review for race and regression risks.
---

# Engine Queued Compiled-Build Resume

## Architecture Context

Compiled-build resume currently runs through `EforgeEngine.resumeBuild()` as a direct worker path. That path owns queue activation/finalization internally and does not receive the queued PRD body for PRD validation wiring. The target architecture keeps compile/planning skipped, but lets the queue scheduler own dispatch by requeueing the failed PRD with explicit resume frontmatter and letting `queue exec` invoke the resume execution path.

Keep the existing constraints from `AGENTS.md` in force: queue state stays under `.eforge/`, engine commits continue through helpers, and large files such as `packages/engine/src/eforge.ts` need bounded exact edits with helper extraction.

## Implementation

### Overview

Add durable compiled-resume PRD frontmatter, add queue mutation helpers that mark and requeue a failed PRD without spawning a worker, make queue execution detect that marker, and share normal PRD validation wiring with the resume build path. Refactor resume queue transitions so direct resume and scheduler-owned resume do not both perform the same filesystem moves.

### Key Decisions

1. Use flat frontmatter keys: `resume_mode: compiled`, `resume_from`, `resume_set_name`, `resume_feature_branch`, and `resume_base_branch`.
2. Preserve the failed PRD file content and all existing frontmatter fields by updating the frontmatter block in place before moving the file back to the queue root.
3. Keep the requeue mutation lock-free after the move completes. The queue child owns the normal `claimPrd()` lock in `buildSinglePrd()`.
4. Add a scheduler-owned resume mode to `resumeBuild()` that skips `beginQueuedResume()`, `finalizeQueuedResumeSuccess()`, and `rollbackQueuedResume()` internally; parent queue child finalization handles terminal queue transitions.
5. Extract PRD validation/acceptance/gap-closer wiring from `build()` into a reusable helper so queued resume can pass PRD content to the same validation path.

## Scope

### In Scope

- Extend PRD frontmatter schema and helpers for compiled-resume metadata.
- Add or refactor queue transition helpers for failed-to-root resume requeue, success finalization, and rollback in scheduler-owned mode.
- Detect compiled-resume frontmatter during queue execution and run compiled-build resume without compile/planner stages.
- Preserve and honor `profile`, `landing`, `landing_auto_merge`, `depends_on`, `stack_id`, `stack_parent`, and `stack_provider` on requeue.
- Add explicit profile override support at the requeue helper level by replacing or inserting `profile:` only when the caller supplies an override.
- Reuse normal PRD validation, acceptance validation, unknown-resolution, and gap-closer wiring during queued resume.
- Resolve PRD validation source content from the requeued PRD, failed queue PRD, `eforge/prds/<setName>.md` at feature branch tip, then branch history.
- Preserve existing direct `resumeBuild()` behavior until the daemon route moves to queued mode in plan 2.

### Out of Scope

- Daemon HTTP response shape changes.
- Pi/Claude tool copy and public documentation updates.
- Re-running compile/planning during compiled-build resume.
- Changing recovery verdict semantics.

## Files

### Create

- `packages/engine/src/resume/queued-resume.ts` — high-level engine helper for validating eligibility metadata, resolving base/feature branch metadata, and preparing a failed PRD for queued compiled resume.
- `packages/engine/src/resume/prd-content.ts` — PRD content resolver for queued/failed files and `eforge/prds/<setName>.md` branch-tip/history fallback.
- `packages/engine/src/validation/prd-validation-wiring.ts` — shared factory for `prdValidator`, `acceptanceUnknownResolver`, `gapCloser`, `expectedAcceptanceCriteria`, and PRD provenance materialization inputs.
- `test/queued-compiled-resume-engine.test.ts` — focused queue-exec/scheduler-owned resume tests.

### Modify

- `packages/engine/src/prd-queue.ts` — add resume frontmatter schema fields, `CompiledResumeFrontmatter` types, `getCompiledResumeFrontmatter()`, and a multi-field frontmatter update helper used by resume requeue.
- `packages/engine/src/queue/resume-cascade.ts` — add a requeue/mark helper that writes resume metadata, moves failed parent to queue root, moves skipped descendants to `waiting/`, preserves sidecars, and does not leave a PRD lock. Keep `beginQueuedResume()` for legacy direct resume until route migration completes.
- `packages/engine/src/eforge.ts` — use the shared validation wiring helper in `build()`, add scheduler-owned options to `resumeBuild()`, detect resume frontmatter in `buildSinglePrd()`, and make `spawnPrdChild()` finalization call resume finalization/rollback for resume-marked PRDs.
- `packages/engine/src/resume/compiled-build.ts` — re-export new resume content or queued-resume helpers that external packages need.
- `packages/engine/src/resume/resume-projection.ts` — use the new PRD content resolver for `build:resume:artifacts.source`.
- `test/queue-recovery-cascade.test.ts` — extend existing cascade tests for metadata writes, profile preservation, override precedence, and no live lock after requeue.
- `test/resume-compiled-build-engine.test.ts` — keep compile-free direct resume coverage and adjust event expectations after helper extraction.
- `test/prd-queue-enqueue.test.ts` or a new adjacent frontmatter test file — cover parsing and validation of complete vs. partial compiled-resume metadata.

## Implementation Notes

- Implement partial metadata detection like `getRecoveryContinuationFrontmatter()`: no resume fields returns `undefined`; any partial set throws with missing field names; complete metadata returns a typed object.
- The queue requeue helper should return a discriminated result such as `queued`, `already-queued`, or `blocked`, including `prdId`, `setName`, `featureBranch`, `baseBranch`, and `movedDescendantIds` when queued.
- If a root queue file already contains matching compiled-resume metadata, return `already-queued` rather than moving any files.
- In `spawnPrdChild()` finalization, branch on compiled-resume frontmatter before normal completed/failed/skipped file movement. Completed resume calls `finalizeQueuedResumeSuccess()`. Failed, skipped, ineligible, or signal-terminated resume calls `rollbackQueuedResume()`.
- In scheduler-owned resume mode, `resumeBuild()` must not emit child-side `session:profile` when the parent scheduler already emitted `session:start` and `session:profile` for the queued PRD.
- The resume validation helper should accept either `prdFilePath` or resolved PRD content. For content recovered from branch history, write a temporary recovered source only if a path is required by existing internals.

## Verification

- [ ] `validatePrdFrontmatter()` accepts complete compiled-resume metadata with flat keys.
- [ ] `getCompiledResumeFrontmatter()` returns `undefined` when no resume fields exist and throws an error listing missing keys for partial metadata.
- [ ] Requeueing a failed PRD writes `resume_mode: compiled`, `resume_from`, `resume_set_name`, `resume_feature_branch`, and `resume_base_branch`.
- [ ] Requeueing preserves `profile`, `landing`, `landing_auto_merge`, `depends_on`, `stack_id`, `stack_parent`, and `stack_provider` fields from the failed PRD.
- [ ] Requeueing with an explicit profile override writes that override to `profile:` and keeps all other preserved fields.
- [ ] Requeueing moves skipped descendants that depend on the resumed parent into `waiting/` and leaves unrelated skipped PRDs in `skipped/`.
- [ ] Requeueing leaves no live `.eforge/queue-locks/<prdId>.lock` after the mutation completes.
- [ ] Queue execution for a resume-marked PRD emits a `phase:start` event with `command: 'resume'`.
- [ ] Queue execution for a resume-marked PRD emits zero `planning:start` and zero `planning:complete` events.
- [ ] Queue execution for a resume-marked PRD emits `prd_validation:start`, `prd_validation:complete`, and `acceptance_validation:complete` after post-merge validation passes.
- [ ] PRD validation uses the requeued PRD body when `.eforge/queue/<prdId>.md` exists.
- [ ] PRD validation reads `eforge/prds/<setName>.md` from branch history when the file is absent at the feature branch tip.
- [ ] Successful queued resume removes the root PRD file and failed recovery sidecars, records a completed artifact entry with `artifactAvailable: true`, and unblocks only descendants whose dependencies all have usable artifacts.
- [ ] Failed queued resume moves the parent PRD back to `failed/`, releases the PRD lock, and moves reactivated descendants back to `skipped/`.
