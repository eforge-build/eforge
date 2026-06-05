---
id: plan-01-engine-monitor-reconciliation
name: Engine and Monitor Accepted-Success Landing Reconciliation
branch: fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation/plan-01-engine-monitor-reconciliation
agents:
  builder:
    effort: high
    rationale: Safety-sensitive git/GitHub landing path plus monitor/client
      wire-contract updates across packages.
  reviewer:
    effort: high
    rationale: Review must verify command sequencing, route contract compatibility,
      and canonical projection behavior.
---

# Engine and Monitor Accepted-Success Landing Reconciliation

## Architecture Context

Accepted-success recovery is an engine helper invoked through monitor recovery routes. The engine remains headless: it mutates git state, artifact/completion registries, and recovery sidecars, while monitor routes expose typed HTTP responses from `@eforge-build/client`. Daemon REST and `stream:hello` snapshots must agree because Console consumes both.

Normal direct non-stacked PR builds already centralize base synchronization in `packages/engine/src/direct-pr-base-sync.ts`, PR creation in `WorktreeManager.issuePr(...)`, and auto-merge policy resolution in `executeLandingAction(...)`. Accepted-success PR landing must reuse those components rather than keeping a separate `git push origin` plus `gh pr create` sequence.

## Implementation

### Overview

Refactor accepted-success landing so PR recovery uses shared direct-PR base sync/freshness, shared PR creation, and shared auto-merge policy logic. Extend the accepted-success wire/audit shape with auto-merge results. Resolve failed PRD frontmatter for per-run landing intent and reconcile accepted-success-complete failures into monitor queue/run projections while retaining failed PRD files as audit records.

### Key Decisions

1. Move accepted-success landing out of `accept-success.ts` into a focused helper file so `accept-success.ts` stays at or below its 600-line cap and no longer contains raw PR publication commands.
2. For PR landing, call `syncDirectPrBase(...)` before publication, then call `executeLandingAction(...)` with a `WorktreeManager` and freshness guards backed by `checkDirectPrBaseFreshness(...)`. Treat any sync or final freshness failure as a failed landing and do not create a PR.
3. Add `landing.autoMerge` audit metadata only to accepted-success landing results. Map shared `landing:auto-merge:complete` to `{ status: "complete" }`, policy skips to `{ status: "skipped", reason }`, and `gh pr merge` failures to `{ status: "failed", reason }`.
4. Resolve per-run landing action and auto-merge intent from the retained failed PRD frontmatter (`landing`, `landing_auto_merge`) before falling back to project config. Pass `landing.pr.autoMerge` into the engine helper.
5. Reconcile status in monitor, not only Console: accepted-success with `landing.status === "complete"` projects failed queue files as completed and updates the latest failed build/resume/run row for the sidecar `summary.setName` to `completed`, emitting a `daemon:run:upsert` event for live stream parity.
6. Bump `DAEMON_API_VERSION` because first-party clients rely on the new preview/apply fields and resolved status semantics.

## Scope

### In Scope

- Add a reusable accepted-success landing helper that uses `syncDirectPrBase`, `checkDirectPrBaseFreshness`, `WorktreeManager.issuePr`, `executeLandingAction`, and shared auto-merge resolution.
- Remove raw PR publication command construction from `packages/engine/src/recovery/accept-success.ts`.
- Add optional `landingAutoMerge` to `AcceptSuccessPreviewResponse`.
- Add optional `autoMerge` result metadata to `AcceptSuccessLandingResult` and to the daemon snapshot schema for `QueueItem.recoveryApplied`.
- Parse legacy accepted-success markers without `landing.autoMerge` so existing sidecars remain valid.
- Read failed PRD frontmatter in `recovery-accept-success-service.ts` and pass `landingAction`, `landingAutoMerge`, and `prAutoMergePolicy` into the engine helper.
- Reconcile monitor run status and emit a run upsert when accepted-success landing completes.
- Project failed queue files with complete accepted-success landing as `status: "completed"` while keeping landing-failed accepted-success files as `status: "failed"`.
- Add regression tests for direct-PR base sync, freshness failure, auto-merge policy preservation, route preview fields, queue/run projection, and REST/stream parity.

### Out of Scope

- Host-only scheduling, notifications, or approval workflow behavior.
- Deleting failed PRD or recovery sidecar audit files.
- Stacked PR landing changes.
- New database tables or migrations.

## Files

### Create

- `packages/engine/src/recovery/accept-success-landing.ts` — accepted-success landing helper; includes merge/leave handling moved from `accept-success.ts` and PR handling backed by direct-PR sync/freshness plus `executeLandingAction`.
- `test/accept-success-static-discipline.test.ts` — static guard that fails when `accept-success.ts` contains direct raw PR publication commands.
- `test/accept-success-direct-pr-landing.test.ts` — real-git direct PR accepted-success tests with fake `gh` and command-order logging.
- `packages/monitor/src/__tests__/accept-success-projection-parity.test.ts` — REST/stream parity tests for resolved runs and queue projection after accepted-success.

### Modify

- `packages/engine/src/recovery/accept-success.ts` — import the landing helper, extend helper options with `landingAutoMerge` and `prAutoMergePolicy`, include `landingAutoMerge` in preview when present, and keep cleanup/apply orchestration intact.
- `packages/engine/src/recovery/applied-sidecar.ts` — parse and preserve optional `landing.autoMerge` on accepted-success markers while accepting older markers without it.
- `packages/client/src/routes/recovery.ts` — add `AcceptSuccessAutoMergeResult`, add optional `autoMerge` to `AcceptSuccessLandingResult`, and add optional `landingAutoMerge` to preview responses.
- `packages/client/src/events/snapshots.ts` — update the `QueueItem.recoveryApplied` accepted-success TypeBox shape to allow `landing.autoMerge`.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` to the next integer and prepend a concise v56 note for accepted-success auto-merge/resolved-status semantics.
- `test/daemon-api-version.test.ts` — update the hardcoded API version assertion and test name.
- `packages/client/src/__tests__/events-schemas-auto-build.test.ts` — add schema coverage for accepted-success queue applied metadata with `landing.autoMerge`.
- `packages/monitor/src/routes/recovery-accept-success-service.ts` — read failed PRD frontmatter, pass per-run landing/auto-merge intent plus project PR auto-merge policy, and reconcile completed accepted-success run status after apply or already-applied responses.
- `packages/monitor/src/recorder.ts` — export the existing run-upsert persistence helper so recovery routes can emit a `daemon:run:upsert` after status reconciliation without duplicating row-to-wire shaping.
- `packages/monitor/src/projections/queue-items.ts` — project accepted-success-complete failed files as completed, while keeping accepted-success failed/skipped landing items failed.
- `packages/monitor/src/__tests__/projections-queue-items.test.ts` — add accepted-success-complete and accepted-success-failed queue projection cases.
- `test/apply-recovery-route.test.ts` — add preview `landingAutoMerge` true/false/omitted cases and apply response `landing.autoMerge` complete/skipped/failed cases where route coverage is lighter than engine coverage.
- `test/apply-recovery-accept-success.test.ts` — update existing PR-landing failure expectations for the new direct-PR sync failure reason when no `origin` remote exists.

## Implementation Notes

### Accepted-success PR landing helper

- Use the existing branch validation in `loadFailedSidecar(...)`; do not remove it.
- For PR landing:
  1. Verify the feature branch exists.
  2. Call `syncDirectPrBase({ cwd, featureBranch, baseBranch, remote: DIRECT_PR_REMOTE })`.
  3. If sync returns `ok: false`, return `{ action: 'pr', status: 'failed', branch, reason }` and do not call `executeLandingAction`.
  4. Build a freshness guard from the returned sync point using `checkDirectPrBaseFreshness(...)`.
  5. Instantiate `WorktreeManager({ repoRoot: cwd, worktreeBase: join(cwd, '.eforge', 'worktrees'), featureBranch, mergeWorktreePath: cwd })`.
  6. Call `executeLandingAction(...)` with `action: 'pr'`, `forceWithLease: true`, the freshness guard for both `beforePushFreshnessGuard` and `beforeCreateFreshnessGuard`, `prAutoMergePolicy`, and `landingAutoMerge`.
  7. Drain events manually, derive `prUrl`, landing failure reason, and `autoMerge` audit result from emitted landing events.
  8. If `executeLandingAction` returns a `freshnessRetry`, return failed landing with that reason and no PR URL.
- Pass `shouldCleanup: false` to `executeLandingAction`; accepted-success cleanup has already run before landing.
- Build minimal `OrchestrationConfig`, `EforgeState`, and `ModelTracker` inputs from `BuildFailureSummary` only for PR metadata and event contract compatibility. Do not introduce new engine stdout behavior.

### Monitor run reconciliation

- After `applyAcceptSuccess(...)`, inspect `result.applied.landing.status`.
- If status is `complete`, read the retained sidecar summary for `setName`, find the newest failed run where `run.planSet === setName` and command is `build`, `resume`, or `run`, update it to `completed` with `acceptedAt`, and call the exported run-upsert helper.
- If no matching failed run exists, leave DB state unchanged and return the apply response.
- Run reconciliation for both `status: "applied"` and `status: "already-applied"` so idempotent route calls repair older DB state.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0, with `packages/engine/src/recovery/accept-success.ts` at 600 lines or fewer.
- [ ] `test/accept-success-static-discipline.test.ts` fails when `packages/engine/src/recovery/accept-success.ts` contains direct `git push origin` or direct `gh pr create` command construction.
- [ ] A direct PR accepted-success test advances `origin/main`, applies recovery, and verifies the accepted feature branch contains the advanced base commit before fake `gh pr create` records a command.
- [ ] A direct PR accepted-success test records command order and verifies the first remote base fetch occurs before fake `gh pr create`.
- [ ] A direct PR accepted-success test simulates base-sync failure and verifies fake `gh pr create` is not invoked.
- [ ] A direct PR accepted-success test simulates final freshness failure and verifies fake `gh pr create` is not invoked.
- [ ] Auto-merge tests cover true+ask, false+always, omitted+always, omitted+ask, and fake `gh pr merge` failure.
- [ ] Preview tests cover `landingAutoMerge: true`, `landingAutoMerge: false`, and omission when failed PRD frontmatter omits `landing_auto_merge`.
- [ ] Apply response tests cover `applied.landing.autoMerge.status` values `complete`, `skipped` with reason, and `failed` with reason.
- [ ] Queue projection tests verify accepted-success-complete projects as completed and accepted-success-failed stays failed.
- [ ] REST/stream parity tests verify `/api/runs` equals `stream:hello.runs` after resolved run reconciliation.
- [ ] REST/stream parity tests verify `/api/queue` equals `stream:hello.queue` for resolved accepted-success queue projection.
- [ ] `pnpm test -- test/accept-success-static-discipline.test.ts test/accept-success-direct-pr-landing.test.ts test/apply-recovery-accept-success.test.ts test/apply-recovery-route.test.ts packages/monitor/src/__tests__/projections-queue-items.test.ts packages/monitor/src/__tests__/accept-success-projection-parity.test.ts packages/client/src/__tests__/events-schemas-auto-build.test.ts` exits 0.
