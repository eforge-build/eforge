---
title: Show Accurate Plan Status and Metadata for Resumed Builds
created: 2026-06-02
---

# Show Accurate Plan Status and Metadata for Resumed Builds

## Problem / Motivation

Resume run detail and plan-progress projections currently misrepresent recovered compiled-build resume sessions. When the engine resumes a failed build and emits `build:resume:state.seededMerged`, the monitor and console do not count those seeded merged plans as complete. Resume runs also lack `planning:complete`, so monitor run summaries do not seed branch/dependency metadata from recovered orchestration artifacts.

Affected users are anyone inspecting a resumed build in Console or monitor REST APIs. In the observed `migrate-monitor-server-to-a-maintainable-architecture` resume run, plans 01-04 were correctly seeded as merged by the engine but appeared as empty/pending in the console, causing a misleading 0/7 complete display.

This matters because resume is a recovery path, so observability must faithfully show which prior plans are already complete and which plans are pending/running. Misreporting completed work as pending makes recovery look broken, obscures dependencies, and can mislead users into thinking prior work was lost.

This bug aligns with the roadmap's **Console Observability and Control** and **Kernel Resilience and Typed Recovery** themes. Resume/recovery runs should be inspectable, and the console should show honest build state.

Backlog source: `.eforge/backlog/items/backlog-2026-06-01-show-accurate-plan-status-and-metadata-for-resumed-builds.md`.

## Goal

Resume run summaries and Console run-state projections should accurately show recovered plan metadata and completed historical plan status for resumed builds.

Plans listed in `build:resume:state.seededMerged` should appear complete, plans listed in `seededPending` should remain pending until advanced by lifecycle events, and recovered orchestration artifacts should supply branch/dependency metadata when `planning:complete` is absent.

## Approach

Validated findings:

- `packages/engine/src/eforge.ts` documents and implements resume event order as `build:resume:start` → `build:resume:state` → `build:resume:artifacts` → build pipeline events → `build:resume:complete` for eligible resume builds.
- `build:resume:state` carries `seededMerged` and `seededPending` arrays.
- `deriveResumeSeedState()` in `packages/engine/src/resume/resume-projection.ts` treats `mergedAt` evidence as canonical merge-complete evidence.
- `build:resume:artifacts` carries recovered `orchestration` and `plans` with branch/dependency metadata.
- `GET /api/plans/:runId` already falls back to these artifacts when no planning/gap-close plans exist, but `RunSummary.plans` does not.
- `packages/monitor/src/projections/run-summary.ts` owns `buildRunSummary()` on the current working tree.
- `packages/monitor/src/server.ts` only re-exports `buildRunSummary()` for compatibility.
- `packages/monitor/src/routes/run-details.ts` imports the projection directly.
- `buildRunSummary()` currently seeds plan metadata only from `planning:complete`.
- Resume runs normally do not emit `planning:complete`, so branch/dependency metadata is absent in run summaries.
- `buildRunSummary()` overlays `plan:build:start`, `plan:build:complete`, and `plan:build:failed`.
- `buildRunSummary()` does not account for `build:resume:state.seededMerged`, so prior merged plans are not counted complete unless later build/status events mention them.
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts` handles `build:resume:artifacts` by seeding every recovered plan as `plan`.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` explicitly ignores `build:resume:state`, so seeded merged plans stay pending/plan-stage in run-state projections.
- Console selectors count `plan` or missing statuses as pending through `selectPlanStatusCounts`.
- Console selectors count `plansCompleted` only from `planStatuses === 'complete'` through `getSummaryStats`.
- Existing tests already cover `/api/plans/:runId` resume artifact body projection and console artifact seeding.
- The console test expectation that asserts both recovered plans become `plan` is stale for seeded-merged resume state.

Reproduction path:

1. Start a compiled-build resume for a failed multi-plan build where the failure summary includes merge evidence for earlier plans.
2. Confirm the engine emits `build:resume:state` with `seededMerged` containing completed prior plan IDs and `seededPending` containing remaining plan IDs.
3. Confirm `build:resume:state` shape is validated in `packages/client/src/events.schemas.ts`.
4. Confirm `build:resume:state` emission is in `packages/engine/src/eforge.ts`.
5. Confirm the engine emits `build:resume:artifacts` with recovered `orchestration.plans` carrying branch/dependency metadata.
6. Confirm this projection is built by `buildResumeArtifactsProjection()`.
7. Open run detail or fetch the monitor run summary for the resume session.

Actual behavior:

- Console run-state ignores `build:resume:state`, so plans listed only in `seededMerged` are not marked `complete`.
- `handleBuildResumeArtifacts()` seeds every recovered plan as `plan`, and selectors count `plan` as pending.
- `buildRunSummary()` has no fallback from `build:resume:artifacts` for plan metadata.
- `buildRunSummary()` has no overlay from `build:resume:state.seededMerged`.
- Resume summaries can show missing branch/dependency metadata and 0/N completed.

Expected behavior:

- Plans listed in `build:resume:state.seededMerged` appear complete in Console run-state progress and summary stats.
- Recovered plan rows use recovered orchestration/artifact branch and dependency metadata when `planning:complete` is absent.
- Plans listed in `seededPending` remain pending until normal lifecycle events advance them.
- Later lifecycle events can still advance or fail pending/resumed plans without being overwritten by older resume seed data.

Confirmed root cause:

- `packages/monitor/src/projections/run-summary.ts` now owns `buildRunSummary()`.
- `packages/monitor/src/server.ts` only re-exports `buildRunSummary()`, so the previous plan target path was stale.
- `seedPlans()` in `packages/monitor/src/projections/run-summary.ts` only reads the latest `planning:complete` event.
- Resume sessions intentionally skip compile/planning and instead emit `build:resume:artifacts`, so the summary's plan map is empty until sparse build lifecycle events mention plan IDs.
- `overlayBuildEvents()` in `packages/monitor/src/projections/run-summary.ts` reads `plan:build:start`, `plan:build:complete`, and `plan:build:failed`, but it does not interpret `build:resume:state.seededMerged`.
- Seeded merged plans are orchestrator state, but the engine does not emit per-plan `plan:status:change` events for those historical merges during resume startup.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` explicitly ignores `build:resume:state`.
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts` only handles `build:resume:artifacts`.
- `handleBuildResumeArtifacts()` currently seeds recovered plans as `plan` only when the plan has no existing status.
- `handleBuildResumeArtifacts()` already avoids downgrading fresher statuses.
- Without a `build:resume:state` handler, seeded-merged plans stay pending/plan-stage.
- Console plan build events no longer infer plan-level status.
- `packages/console-ui/src/lib/run-state/handlers/handle-plan-lifecycle.ts` documents `plan:status:change` as the main status driver.
- Resume startup uses `build:resume:state` rather than synthetic per-plan status changes for historical seeded merges.
- Console needs an explicit resume-state reducer handler.
- The engine resume path still appears to expose the necessary evidence.
- The defect remains in monitor/console projections, not in resume eligibility or orchestrator seeding.

Implementation approach:

- Update `packages/monitor/src/projections/run-summary.ts` so `buildRunSummary()` and helpers can seed plan metadata from the latest valid `build:resume:artifacts` when no `planning:complete` event exists.
- Use `build:resume:artifacts.orchestration.plans` for branch and dependency metadata in run summaries.
- Overlay `build:resume:state.seededMerged` as `completed`.
- Overlay `build:resume:state.seededPending` as `pending` only when no later event has advanced or failed the plan.
- Preserve existing `planning:complete` precedence for normal compile/build runs.
- Preserve fallback from sparse `plan:build:start` lifecycle events for older runs that have neither `planning:complete` nor valid resume artifacts.
- Consider using the same defensive event parsing pattern as `packages/monitor/src/projections/plans.ts` (`parseEventRow`) for resume artifact rows so malformed persisted events are skipped rather than partially projected.
- Add a `build:resume:state` handler in `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts`.
- Map `seededMerged` plan IDs to `complete` in Console run-state.
- Keep `seededPending` not-complete.
- Let recovered artifact rows make seeded pending plans visible as `plan`/pending.
- Ensure `build:resume:artifacts` continues to seed `earlyOrchestration`, `resumeArtifacts`, and `resumeSource`.
- Ensure `build:resume:artifacts` does not downgrade existing `complete`, `implement`, `failed`, or other fresher statuses.
- Import/register the new `build:resume:state` handler in `packages/console-ui/src/lib/run-state/handlers/index.ts`.
- Remove `build:resume:state` from `IGNORED_EVENT_TYPES`.

Risks:

- Live SSE and replay should produce the same final run-state whether `build:resume:state` is processed before or after `build:resume:artifacts`.
- Handlers should be order-tolerant.
- Artifact seeding must not overwrite a later `plan:status:change`, build-stage, complete, or failed status with `plan`.
- Plans present in `seededMerged` but absent from recovered orchestration should not create misleading duplicate rows without metadata unless the UI has no better evidence.
- Prefer merging into known recovered/orchestration plan IDs and carefully testing fallback behavior.
- Older resume events or malformed rows may lack expected fields.
- Existing parse-and-skip behavior should remain defensive.
- Normal build runs with `planning:complete` should not be affected by resume artifact fallback.
- Planning events should remain authoritative when present.
- No client wire-shape change is expected.
- If implementation adds fields to `RunSummary` or resume events, update `@eforge-build/client` route types and consider `DAEMON_API_VERSION` per project policy.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `build:resume:state.seededMerged` is the correct source for historical completed plan status in resume projections. | Confirmed event schema includes `seededMerged`; `deriveResumeSeedState()` marks plans with `mergedAt` evidence as seeded merged; `resumeBuild()` emits this event before resumed build execution. | high | low | Add reducer and monitor projection tests using synthetic resume events. | Completed prior work would continue to render as pending or empty. |
| `build:resume:artifacts.orchestration.plans` is the correct source for branch/dependency metadata when `planning:complete` is absent. | Confirmed `buildResumeArtifactsProjection()` emits recovered orchestration; `/api/plans/:runId` already uses `build:resume:artifacts` as a fallback source; current `buildRunSummary()` still lacks equivalent fallback. | high | low | Add run-summary test that checks recovered branch and `dependsOn` values. | Resume summaries would still show `branch: null` and empty dependencies. |
| The monitor implementation target is `packages/monitor/src/projections/run-summary.ts`, not `packages/monitor/src/server.ts`. | Re-read current working tree: `server.ts` re-exports `buildRunSummary`; `routes/run-details.ts` imports `../projections/run-summary.js`; the projection implementation lives in `packages/monitor/src/projections/run-summary.ts`. | high | low | Confirm imports remain unchanged during implementation. | The build agent could edit the compatibility wrapper instead of the real projection and fail to fix the route. |
| The Console reducer should handle `build:resume:state` rather than requiring the engine to emit synthetic per-plan status events for seeded merges. | `packages/console-ui/src/lib/run-state/handlers/index.ts` currently ignores the event; `handle-plan-lifecycle.ts` confirms `plan:status:change` is the normal status driver; engine resume startup does not emit per-plan status changes for historical seeded merges. | high | low | Add reducer tests for event-order permutations. | UI would remain dependent on missing lifecycle events or require an unnecessary engine wire change. |
| Treating `seededPending` as not-complete is sufficient; recovered artifacts can provide visible plan rows. | Console has no explicit `pending` pipeline stage; `handleBuildResumeArtifacts()` already seeds missing plan rows as `plan`, and selectors treat `plan` as pending. | medium | low | Test state-before-artifacts and artifacts-before-state sequences. | Pending plans could be invisible until artifacts arrive or could be displayed with an inaccurate stage. |
| Planning metadata should remain authoritative over resume artifacts when both exist. | Existing `/api/plans/:runId` tests prefer `planning:complete`; normal build sessions use planning events as primary metadata. | high | low | Preserve/add tests for planning precedence in run-summary projection. | Normal runs could unexpectedly use stale resume artifact metadata. |
| No client wire-shape or daemon API version change is needed. | Required fields already exist in `BuildResumeStateEvent`, `BuildResumeArtifactsEvent`, and `RunSummary.plans`; the fix can be projection-only. | medium | low | Verify implementation does not add response/event fields. | If new fields are added without client/API updates, consumers can drift. |
| Monitor summary can use latest resume events by session without needing run-id-specific filtering. | `buildRunSummary(db, sessionId)` already reads event types by session ordered by event id, and the observed bug is session-run detail scoped to a resume session. This is consistent with existing summary behavior, but multi-run sessions can have mixed events. | medium | medium | During implementation, add a test with multiple resume-state/artifact events if ambiguity appears. | A session with multiple resume attempts could project stale metadata from an older resume event. |

Profile signal:

Recommended profile: **Excursion**.

Rationale: this is a focused but multi-package projection bug. A single cohesive plan can cover monitor run-summary projection, console resume-state reduction, and targeted tests. It does not need delegated module planning, and it is not trivial enough for Errand because correctness depends on event ordering and preserving existing projection precedence.

Classification: **bugfix / deep**. The implementation is a projection correctness fix spanning monitor REST summaries and console run-state reducers/selectors. It is cohesive enough for an Excursion profile; it does not require delegated architecture planning.

## Scope

In scope:

- `packages/monitor/src/projections/run-summary.ts`
- `buildRunSummary()` resume metadata seeding from `build:resume:artifacts`.
- `buildRunSummary()` status overlay from `build:resume:state.seededMerged`.
- `buildRunSummary()` pending handling from `build:resume:state.seededPending`.
- `buildRunSummary()` precedence preservation for `planning:complete`.
- `buildRunSummary()` sparse lifecycle fallback preservation.
- Defensive parsing for malformed persisted resume artifact events.
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts`
- A Console run-state handler for `build:resume:state`.
- Console preservation of `earlyOrchestration`, `resumeArtifacts`, and `resumeSource`.
- Console protection against status downgrade during artifact seeding.
- `packages/console-ui/src/lib/run-state/handlers/index.ts`
- Importing/registering the new `build:resume:state` handler.
- Removing `build:resume:state` from `IGNORED_EVENT_TYPES`.
- Monitor run-summary tests in `test/run-summary-plans.test.ts` and/or `packages/monitor/src/__tests__/projections-run-summary.test.ts`.
- Existing `/api/plans/:runId` fallback tests in `packages/monitor/src/__tests__/resume-plans-route.test.ts` only if shared parsing/helper changes affect the plans route.
- Console reducer tests in `packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts`.
- Console selector tests in `packages/console-ui/src/lib/run-state/__tests__/selectors.test.ts` if needed to prove `getSummaryStats()` and `selectPlanStatusCounts()` count seeded merged plans as complete after reduction.

Out of scope:

- Direct implementation changes in `packages/monitor/src/server.ts`, unless compatibility re-export behavior unexpectedly needs adjustment.
- Direct implementation changes in `packages/monitor/src/routes/run-details.ts`, unless route wiring needs adjustment.
- Changes to `GET /api/plans/:runId`, unless implementation needs shared parsing helpers.
- Engine resume event schema changes, because existing resume events already expose the necessary fields.
- Wire schema changes, unless implementation adds fields to `RunSummary` or resume events.
- Daemon API version changes, unless implementation adds or changes client-visible API shape.
- `packages/monitor-ui/`, because it is the legacy monitor UI.
- Engine resume eligibility changes.
- Orchestrator seeding changes.
- Delegated architecture planning.

## Acceptance Criteria

- `buildRunSummary()` seeds resume-run plan metadata from the latest valid `build:resume:artifacts.orchestration.plans` when the session has no `planning:complete` plan list.
- `buildRunSummary()` includes recovered branch values for resume-run plans seeded from `build:resume:artifacts.orchestration.plans`.
- `buildRunSummary()` includes recovered `dependsOn` values for resume-run plans seeded from `build:resume:artifacts.orchestration.plans`.
- `buildRunSummary()` marks every plan ID listed in `build:resume:state.seededMerged` as `completed` when no later failure/status event for that plan exists.
- `buildRunSummary()` leaves every plan ID listed only in `build:resume:state.seededPending` as `pending` until later lifecycle events advance it.
- `buildRunSummary()` preserves `planning:complete` as the authoritative plan metadata source for non-resume and freshly planned sessions.
- `buildRunSummary()` preserves existing sparse lifecycle fallback behavior for sessions that have no `planning:complete` and no valid `build:resume:artifacts` event.
- `buildRunSummary()` skips malformed `build:resume:artifacts` rows instead of projecting partial recovered plan metadata.
- `packages/monitor/src/server.ts` continues to re-export the same `buildRunSummary` function as `packages/monitor/src/projections/run-summary.ts`.
- The Console run-state reducer maps every `build:resume:state.seededMerged` plan ID to pipeline stage `complete`.
- The Console run-state reducer does not map `build:resume:state.seededPending` plan IDs to `complete`.
- The Console run-state reducer preserves recovered `earlyOrchestration` branch and dependency metadata from `build:resume:artifacts`.
- The Console run-state reducer produces the same seeded merged completion result when `build:resume:state` is processed before `build:resume:artifacts`.
- The Console run-state reducer produces the same seeded merged completion result when `build:resume:artifacts` is processed before `build:resume:state`.
- `handleBuildResumeArtifacts()` does not downgrade an existing `complete` status to `plan`.
- `handleBuildResumeArtifacts()` does not downgrade an existing `implement` status to `plan`.
- `handleBuildResumeArtifacts()` does not downgrade an existing `failed` status to `plan`.
- Console summary stats count plans listed in `seededMerged` as completed after the resume state event is reduced.
- Console plan status counts count plans listed in `seededMerged` as complete after the resume state event is reduced.
- Regression tests cover monitor run-summary projection for a resume run with `seededMerged`, `seededPending`, and recovered artifact branch/dependency metadata.
- Regression tests cover Console reducer behavior for `build:resume:state` and `build:resume:artifacts` in both event orders.
- Regression tests cover that later plan lifecycle events can still move a seeded pending plan to running or complete.
- Regression tests cover that later plan lifecycle events can still move a seeded merged plan to failed if the resumed run emits a subsequent failure/status event for that plan.
- `pnpm vitest run test/run-summary-plans.test.ts packages/monitor/src/__tests__/projections-run-summary.test.ts` exits 0 when either monitor run-summary test file is modified.
- `pnpm vitest run packages/monitor/src/__tests__/resume-plans-route.test.ts` exits 0 if that test file is modified.
- `pnpm vitest run packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts packages/console-ui/src/lib/run-state/__tests__/selectors.test.ts` exits 0 when either Console test file is modified.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
