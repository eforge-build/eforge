---
id: plan-01-queue-control-race-safety
name: Queue-Control Race-Safety Remediation
branch: complete-host-queue-controls-race-safety-fixes-and-docs/plan-01-queue-control-race-safety
agents:
  builder:
    effort: high
    rationale: Filesystem race fixes require careful lock ownership, re-read, and
      error-mapping changes across queue helpers.
  tester:
    effort: high
    rationale: Regression tests need deterministic race interleavings and must prove
      files are not recreated after moves/deletions.
  reviewer:
    effort: high
    rationale: Review must verify stale located PRD data is never used for root or
      movable mutations.
---

# Queue-Control Race-Safety Remediation

## Architecture Context

Core queue-control routes and client helpers already exist. The remaining blocker is in the engine filesystem helper layer: `packages/engine/src/queue/control.ts` currently locates a PRD, then later writes or removes the originally located path. That stale located data can recreate queue files after a worker has claimed, moved, completed, or deleted them. This plan fixes the engine helper behavior before more host surfaces call it.

The public `@eforge-build/client` queue priority helper shape is not in scope for this plan. Do not change host callers to construct raw daemon request bodies.

## Implementation

### Overview

Make queue priority and removal mutations fail closed when the target file changes between initial location and mutation. Root queue items must use the existing PRD lock/claim mechanism for exclusive ownership. All priority writes must use fresh content from the current file and an existing-file-only write path. All removals of the main PRD file must fail when the target disappeared instead of reporting success.

### Key Decisions

1. Root pending mutations acquire ownership with `claimPrd(prdId, cwd)` before writing or deleting, and release with `releasePrd` in `finally`.
2. After a root claim, re-read the queue root and require the PRD to still exist at the original root location before mutating.
3. Priority updates use freshly reloaded PRD content, never `located.prd.content` captured before the claim or race window.
4. Priority writes use an existing-file-only write path so a disappeared file is not recreated.
5. Main PRD removal uses non-force deletion and maps `ENOENT` to a queue-control error instead of success.
6. Waiting, failed, and skipped file operations re-read the same expected subdirectory immediately before mutation and fail when the target moved or disappeared.

## Scope

### In Scope

- Race-safe root pending priority mutation.
- Race-safe waiting priority mutation.
- Race-safe root removal.
- Race-safe waiting/failed/skipped removal.
- Preserve existing running, failed, skipped, pending, waiting, and dependency-safety semantics.
- Deterministic regression tests for file deletion, movement, completion, and claim races.

### Out of Scope

- CLI, MCP, Pi, Console, or documentation changes.
- Public client helper signature changes.
- Queue cascade deletion, hold, pause, or running cancellation by PRD id.
- Scheduler algorithm changes beyond preserving queue-control reconciliation behavior.

## Files

### Create

- `test/queue-control-race-safety.test.ts` — focused regression tests for stale-location race windows and no-recreation guarantees.

### Modify

- `packages/engine/src/queue/control.ts` — add claim/reload/existing-only write and non-force removal flows with queue-control error mapping.
- `packages/engine/src/prd-queue.ts` — add an existing-file-only mode or helper for `setQueuedPrdFrontmatterFields` so queue-control priority updates cannot recreate a missing file; keep default behavior unchanged for existing callers.
- `test/prd-queue.test.ts` — update only if existing queue-control assertions need narrow status-message changes after the new conflict/not-found mapping.
- `test/queue-scheduler-policy.test.ts` — update only if scheduler reconciliation assertions need a narrow adjustment due to root-control lock ownership.

## Implementation Details

### Existing-only frontmatter writes

- Extend `setQueuedPrdFrontmatterFields` or add a sibling helper that writes updated frontmatter only when the target file already exists.
- Use `open(filePath, 'r+')`, truncate, write, and close, or an equivalent no-create file descriptor flow.
- Preserve the current default `setQueuedPrdFrontmatterFields(prd, fields)` behavior for non-queue-control callers unless every caller can tolerate missing-file failure.
- Map missing-file errors in queue-control helpers to `QueueControlError('not-found' | 'conflict', ...)` with a message naming the PRD id and changed location/disappearance.

### Root priority flow

- Validate PRD id and finite integer priority as today.
- Locate the PRD with `findQueuedPrdForControl` and reject running/failed/skipped statuses as today.
- For root pending items:
  - Attempt `claimPrd`; if it returns `false`, throw a conflict stating the item was claimed or became running.
  - After claim, re-read the queue root with `strictLoadQueue` and require the same PRD id at the original root file path.
  - Use the freshly reloaded PRD for the priority write.
  - Release the claim in `finally`.
- For waiting items:
  - Re-read `.eforge/queue/waiting/` and require the same PRD id at the original waiting path before writing.
  - Use existing-only frontmatter write mode.

### Removal flow

- Keep running refusal and dependency-safety refusal.
- For root pending items:
  - Claim first, re-read the root item, then re-run the live-dependent check against fresh root and waiting queues before deletion.
  - Delete the main PRD file with no `force` option.
  - Release the claim in `finally`.
- For waiting/failed/skipped items:
  - Re-read the expected subdirectory before deletion.
  - Delete the main PRD file with no `force` option.
  - For failed items, keep best-effort sidecar cleanup after the main PRD deletion succeeds, reporting only sidecars that existed and were removed.

### Deterministic race tests

Use a narrow internal test hook on the engine queue-control options, or another deterministic non-mocking seam, to mutate files after initial location and after root claim. The hook must not be exported from `@eforge-build/client`, must not alter daemon wire shapes, and must not be used by CLI/MCP/Pi code.

Cover at least these interleavings:

- Root priority: root file deleted after initial location.
- Root priority: root file moved to `failed/`, `skipped/`, or `waiting/` after initial location.
- Root priority: root file completed/consumed after initial location.
- Root priority: root file claimed by a live lock after initial location.
- Root priority: root file deleted after the queue-control claim.
- Waiting priority: waiting file deleted after initial location.
- Waiting priority: waiting file moved out of `waiting/` after initial location.
- Root removal: root file deleted after initial location or after claim.
- Root removal: root file moved after initial location.
- Movable removal: waiting/failed/skipped file deleted after initial location.

## Verification

- [ ] Root priority mutation after post-location deletion returns a queue-control error and leaves `.eforge/queue/<id>.md` absent.
- [ ] Root priority mutation after post-location movement returns conflict or not-found and does not create `.eforge/queue/<id>.md`.
- [ ] Root priority mutation after post-location completion returns conflict or not-found and does not create `.eforge/queue/<id>.md`.
- [ ] Root priority mutation after post-location claim returns conflict and leaves the original PRD content unchanged.
- [ ] Root priority mutation after post-claim deletion returns a queue-control error and leaves `.eforge/queue/<id>.md` absent.
- [ ] Waiting priority mutation after post-location deletion returns a queue-control error and leaves `.eforge/queue/waiting/<id>.md` absent.
- [ ] Waiting priority mutation after post-location movement returns conflict or not-found and does not create `.eforge/queue/waiting/<id>.md`.
- [ ] Root removal after post-location deletion or movement returns a queue-control error instead of `QueueRemoveResponse`.
- [ ] Root removal after post-claim deletion returns a queue-control error instead of `QueueRemoveResponse`.
- [ ] Waiting, failed, and skipped removal after post-location deletion returns a queue-control error instead of `QueueRemoveResponse`.
- [ ] Pending and waiting priority mutation still succeeds when the target file remains in place.
- [ ] Running, failed, and skipped priority mutation still returns conflict.
- [ ] Non-running pending, waiting, failed, and skipped removal still succeeds when no live dependents exist.
- [ ] Live running removal still returns conflict with cancel-by-session guidance.
- [ ] Removal with a live root or waiting dependent still returns conflict listing dependent ids.
- [ ] `pnpm test -- test/queue-control-race-safety.test.ts test/prd-queue.test.ts test/queue-scheduler-policy.test.ts packages/monitor/src/__tests__/routes-queue-control.test.ts` exits 0.