---
id: plan-01-resume-queue-reactivation
name: Resume Queue Reactivation and Finalization
branch: reactivate-queue-dependents-after-successful-compiled-build-resume/plan-01-resume-queue-reactivation
agents:
  builder:
    effort: high
    rationale: Recovery-sensitive filesystem, lock, artifact, and completion state
      changes must preserve queue invariants and avoid duplicate launches.
  tester:
    effort: high
    rationale: The plan requires focused filesystem-state and resume-orchestration
      tests for success, failure, ineligible, and guarded no-artifact paths.
---

# Resume Queue Reactivation and Finalization

## Architecture Context

Compiled-build resume currently runs as a separate engine worker path from normal queued PRD execution. Normal queued completion writes artifact/completion state and unblocks or skips dependents from queue completion handling; compiled-build resume emits `build:resume:*` events but does not mutate the queue graph. This plan adds an engine-owned resume queue transition path so a failed upstream PRD can be marked active during resume and, after a successful resume, can retire failed state and reactivate descendants using existing dependency semantics.

Key constraints:

- Engine emits events; Console, Pi, and Claude Code must not be required to observe events for queue mutation.
- Manual queue-cascade recovery remains a separate retry/reactivation tool.
- The resume worker must claim the PRD lock before exposing a root queue file.
- Stale failed/skipped completion entries must be replaced only after a usable artifact exists.
- Large files (`packages/engine/src/eforge.ts`, `packages/engine/src/prd-queue.ts`) require bounded exact edits.

## Implementation

### Overview

Create a focused queue resume helper module, wire it into `EforgeEngine.resumeBuild()`, pass `prdId` into the resumed `Orchestrator`, make unblocking no-clobber for target collisions, and update recovery docs/skills to mention automatic post-resume queue repair.

### Key Decisions

1. Add a new nearby helper module instead of overloading `applyQueueRecovery(...)`. Manual queue recovery moves the failed parent back for retry; resume finalization retires the parent after a completed artifact exists.
2. Begin queue reactivation before resume eligibility checks after `setName` resolution. This makes the failed PRD visible as active/running during the entire resume attempt, with rollback on ineligible or failed outcomes.
3. Treat missing usable artifact during success finalization as a blocked no-op in the helper. The resume path must then mark the run failed and use rollback so dependents are not unblocked from stale state.
4. Preserve recovery sidecars until success finalization. The failed `.md` file moves out of `failed/` on start, but sidecar evidence remains available if resume fails or is ineligible.
5. Do not overwrite queue files on collisions. Start/finalization logic must leave existing targets untouched and report or skip the colliding move.

## Scope

### In Scope

- Queue reactivation helper for compiled-build resume start.
- Successful-resume queue finalization helper.
- Failed/ineligible resume rollback helper.
- Passing `prdId` into resumed orchestration so `recordArtifact(ctx)` records the original queued PRD artifact.
- Completion upsert from stale failed/skipped to completed with `artifactAvailable: true` after artifact durability is verified.
- Lock creation/release around the resume worker.
- Focused tests for queue filesystem, locks, artifacts, completions, and resume orchestration artifact recording.
- Existing docs/skills copy that describes compiled-build resume recovery behavior, with Claude Code and Pi skill parity.

### Out of Scope

- Daemon route shape changes.
- Console UI state or route changes.
- New event types.
- Replacing manual queue-cascade recovery routes.
- Agent harness or end-to-end real-agent tests.
- Database migrations.

## Files

### Create

- `packages/engine/src/queue/resume-cascade.ts` — New helper module for compiled-build resume queue start, success finalization, and failure/ineligible rollback. Keep under 600 lines; if it exceeds 300 lines, add balanced durable `// --- eforge:region <slug> ---` markers.

### Modify

- `packages/engine/src/eforge.ts` — Import and call the resume queue helpers inside `resumeBuild()`. Sequence: resolve `setName`; start the phase; begin queue reactivation; run eligibility/build; pass `prdId` to `new Orchestrator(...)`; on completed status run success finalization before `build:resume:complete`; on failed/ineligible status rollback in `finally`.
- `packages/engine/src/prd-queue.ts` — Add no-overwrite handling for `unblockWaiting(...)` root moves so successful finalization cannot clobber an existing queue-root file. Leave colliding waiting entries in `waiting/` and omit them from the returned unblocked IDs.
- `test/queue-recovery-cascade.test.ts` — Add focused filesystem helper tests for resume start, success finalization, stale completion replacement, guarded no-artifact behavior, rollback, sidecar preservation/removal, descendant routing to root vs waiting, and target collision behavior.
- `test/resume-compiled-build-engine.test.ts` — Extend compiled-build resume coverage to assert the resumed `Orchestrator` receives `prdId` by checking that a successful resume writes a usable artifact record for the original PRD id.
- `docs/architecture.md` — Update the queue recovery/resume architecture paragraph to state that compiled-build resume claims the failed PRD, moves skipped descendants to waiting, finalizes completed artifact/completion state, and rolls back failed/ineligible resumes.
- `eforge-plugin/skills/recover/recover.md` — Add a concise note that a successful compiled-build resume automatically retires the failed queue item and reactivates skipped descendants; manual queue-cascade remains for explicit retry/repair.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump the plugin patch version because plugin skill copy changes.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — Mirror the Claude Code recover-skill note without bumping the Pi package version.

## Helper Behavior Requirements

Implement these concrete helper semantics in `packages/engine/src/queue/resume-cascade.ts`:

- `beginQueuedResume(...)` or equivalent:
  - Validate `prdId` as a safe queue filename segment.
  - Load a snapshot of `queue`, `waiting`, `failed`, and `skipped` locations.
  - If `failed/<prdId>.md` is absent, return a no-op result so non-queue resume paths are not forced through queue mutation.
  - Find transitive skipped descendants whose `depends_on` chain reaches `prdId`.
  - Preflight all source paths and targets (`failed/<prdId>.md` to queue root, descendants from `skipped/` to `waiting/`) before moving anything.
  - Refuse target collisions without overwriting existing files.
  - Create `.eforge/queue-locks/<prdId>.lock` via `claimPrd(prdId, cwd)` before moving the parent to queue root.
  - Move the failed parent `.md` to the queue root and move skipped descendants to `waiting/`.
  - Preserve `.recovery.md` and `.recovery.json` sidecars.
- Success finalization helper:
  - Validate `prdId`.
  - Load `.eforge/artifacts/builds.json` and require a `status: 'built'` record for `prdId`.
  - If no usable artifact exists, return a blocked/no-op result without removing files, sidecars, locks, or stale completions.
  - Upsert `.eforge/artifacts/completions.json` for `prdId` with `status: 'completed'`, `artifactAvailable: true`, and the artifact branch when present.
  - Remove `.eforge/queue/<prdId>.md` if present.
  - Remove `.eforge/queue/failed/<prdId>.md` if present.
  - Remove `.eforge/queue/failed/<prdId>.recovery.md` and `.eforge/queue/failed/<prdId>.recovery.json` if present.
  - Release `.eforge/queue-locks/<prdId>.lock` if present.
  - Call normal waiting-unblock semantics only after the artifact and completion record are durable.
- Rollback helper for failed or ineligible resume:
  - Release the PRD lock.
  - Move `.eforge/queue/<prdId>.md` back to `failed/<prdId>.md` when the active root file exists and the target is absent.
  - Preserve existing recovery sidecars.
  - Propagate skip for waiting descendants that depend on `prdId`.
  - Refuse to overwrite target queue files.

## Engine Wiring Notes

- In `resumeBuild()`, run queue start reactivation after `phase:start` and after `setName` is known. If the start helper returns a blocker, emit existing `build:resume:ineligible` with that reason, set status failed, and return.
- Track whether queue reactivation started and whether success finalization completed. In `finally`, rollback when reactivation started and the final status is failed or ineligible.
- Pass `prdId` in the resume `new Orchestrator({ ... })` options.
- Do not emit `build:resume:complete` unless success finalization either completed or queue reactivation was not active for this resume.

## Test Plan

Add or update tests to cover these observable states:

- Start helper moves `failed/parent.md` to `queue/parent.md`, creates `queue-locks/parent.lock`, moves skipped descendants to `waiting/`, leaves non-descendant skipped PRDs in `skipped/`, and preserves both sidecars.
- Start helper returns a blocked result and leaves sources unchanged when a target path already exists.
- Existing lock-aware scheduler tests continue to demonstrate that a root queue PRD with a live lock is not launched as a duplicate normal worker.
- Success finalization with a usable artifact removes root/failed files, removes sidecars, releases the lock, and moves a fully satisfied waiting descendant to the queue root.
- Success finalization replaces stale failed and stale skipped completion entries with `status: 'completed'` and `artifactAvailable: true`.
- Success finalization leaves descendants in `waiting/` when another dependency is active or lacks a usable artifact.
- Success finalization with no usable artifact returns a blocked/no-op result, leaves descendants in `waiting/`, and does not upsert a completed completion record.
- Rollback for failed and ineligible outcomes moves the active parent back to `failed/`, releases the lock, preserves sidecars, and moves waiting descendants back to `skipped/`.
- Resume engine test confirms `loadArtifactRegistry(cwd)` contains a built artifact for the original `prdId` after a successful `engine.resumeBuild(prdId, ...)` run.

## Documentation and Skill Parity

- Update `docs/architecture.md` with the automatic resume-start/success/failure queue transitions.
- Update both recover skills (`eforge-plugin/...` and `packages/pi-eforge/...`) with equivalent behavior text.
- Bump only `eforge-plugin/.claude-plugin/plugin.json`; do not bump `packages/pi-eforge/package.json`.

## Database Migration

No database migration is required.

## Verification

- [ ] `pnpm docs:check-parity` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run test/queue-recovery-cascade.test.ts test/resume-compiled-build-engine.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] After the helper start test, `queue/parent.md` and `queue-locks/parent.lock` exist, skipped descendants are in `waiting/`, non-descendant skipped PRDs remain in `skipped/`, and sidecars remain in `failed/`.
- [ ] After the success finalization test, `queue/parent.md`, `failed/parent.md`, both sidecars, and `queue-locks/parent.lock` are absent; the completion registry entry for `parent` has `status: 'completed'` and `artifactAvailable: true`.
- [ ] After the no-artifact finalization test, no descendant moves from `waiting/` to queue root and the stale completion entry for `parent` is not replaced with completed.
- [ ] After failed/ineligible rollback tests, `failed/parent.md` exists, `queue/parent.md` and `queue-locks/parent.lock` are absent, and dependent descendants are in `skipped/`.
- [ ] The resume engine test finds a `status: 'built'` artifact record for the original resumed PRD id.