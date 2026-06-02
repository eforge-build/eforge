---
id: plan-01-resume-projections
name: Accurate Resumed Build Plan Projections
branch: show-accurate-plan-status-and-metadata-for-resumed-builds/plan-01-resume-projections
agents:
  builder:
    effort: high
    rationale: The fix spans monitor and Console projections, requires
      event-order-sensitive status overlay behavior, and must preserve existing
      planning metadata precedence.
---

# Accurate Resumed Build Plan Projections

## Architecture Context

Resume builds already emit the data required for accurate observability:

- `build:resume:state` carries `seededMerged` and `seededPending` plan IDs.
- `build:resume:artifacts` carries recovered orchestration and plan artifacts.
- The monitor route imports `buildRunSummary()` from `packages/monitor/src/projections/run-summary.ts`; `packages/monitor/src/server.ts` only re-exports that function.
- Console run-state stores plan progress in `planStatuses`, orchestration metadata in `earlyOrchestration`, and recovered artifact metadata in `resumeArtifacts`/`resumeSource`.

This plan is projection-only. It must not change engine resume eligibility, event schemas, daemon route shapes, or `DAEMON_API_VERSION`.

## Implementation

### Overview

Update the monitor run-summary projection to use recovered resume artifacts as the metadata fallback when planning metadata is absent, then apply resume seed-state events as plan-status seeds before later build lifecycle events. Update Console run-state handling so `build:resume:state.seededMerged` maps to `complete` without downgrading later/fresher stages, while `build:resume:artifacts` continues to preserve recovered orchestration and source metadata.

### Key Decisions

1. `planning:complete` remains the authoritative metadata source when the latest planning event contains a `plans` array. Resume artifacts are used only when no planning plan list is available.
2. `build:resume:artifacts.orchestration.plans` supplies run-summary branch and dependency metadata because the orchestration plan entries carry the recovered branch and dependency graph.
3. Monitor status overlays are applied in event-id order for `build:resume:state`, `plan:build:start`, `plan:build:complete`, and `plan:build:failed` so later build events can override earlier resume seeds.
4. Console `build:resume:state` handling sets seeded merged plans to `complete` only when the current stage is missing or `plan`; it does not overwrite `implement`, `doc-sync`, `test`, `review`, `evaluate`, `complete`, or `failed`.
5. Malformed persisted `build:resume:artifacts` rows are parsed with the existing `parseEventRow()` defensive path and skipped; the newest valid artifact row is used.

## Scope

### In Scope

- Monitor run-summary metadata seeding from recovered resume artifacts.
- Monitor run-summary status seeding from `build:resume:state.seededMerged` and `seededPending`.
- Monitor preservation of sparse `plan:build:start` fallback behavior.
- Console `build:resume:state` reducer support.
- Console artifact seeding protection against status downgrades.
- Regression tests for monitor projections and Console reducers/selectors.

### Out of Scope

- Engine resume event emission changes.
- Client event schema or route type changes.
- `DAEMON_API_VERSION` changes.
- `packages/monitor/src/server.ts` implementation changes, except existing compatibility tests may continue to assert its re-export.
- `packages/monitor-ui/` changes.
- `GET /api/plans/:runId` changes unless a shared helper edit forces a small test update.

## Files

### Create

None.

### Modify

- `packages/monitor/src/projections/run-summary.ts` — add resume artifact metadata fallback, defensive resume artifact parsing, and resume seed-state status overlay.
- `packages/monitor/src/__tests__/projections-run-summary.test.ts` — add run-summary regression coverage for resume artifact metadata, seeded merged/pending status, planning precedence, malformed artifact skipping, and later build-event overrides.
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts` — export a `build:resume:state` handler and retain artifact seeding without status downgrade.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — register the new resume-state handler and remove `build:resume:state` from `IGNORED_EVENT_TYPES`.
- `packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts` — add reducer coverage for `build:resume:state` plus artifacts in both event orders and lifecycle overrides.
- `packages/console-ui/src/lib/run-state/__tests__/selectors.test.ts` — add selector coverage showing seeded merged plans contribute to completed/complete counts after reducer processing.

## Implementation Notes

### Monitor projection

In `run-summary.ts`:

- Import `parseEventRow` from `./event-hydration.js`.
- Split plan seeding into helpers with these semantics:
  - `planning:complete` helper returns a populated `Map` when the latest planning row parses and has `plans` as an array.
  - Resume fallback scans `build:resume:artifacts` rows from newest to oldest, calls `parseEventRow(row.data, row.timestamp, row.type, row.id)`, accepts only `parsed.type === 'build:resume:artifacts'`, and maps `parsed.orchestration.plans` to `{ id, status: 'pending', branch, dependsOn }`.
  - If no planning plan list and no valid resume artifact row exist, return the empty map so sparse build-start fallback still creates rows.
- Replace the per-event-type overlay loops with a chronological overlay over `db.getEventsBySession(sessionId)` filtered to these types:
  - `build:resume:state`
  - `plan:build:start`
  - `plan:build:complete`
  - `plan:build:failed`
- For `build:resume:state`:
  - Ensure every `seededMerged` ID has a row, using `branch: null` and `dependsOn: []` when no metadata row exists, then set status to `completed`.
  - Ensure every `seededPending` ID has a row with status `pending` only when no row exists.
- For `plan:build:start`, preserve existing sparse fallback behavior: create a row when absent and set status to `running`; keep branch/dependsOn from existing metadata unless the event supplies usable values.
- For `plan:build:complete` and `plan:build:failed`, preserve existing behavior of updating only existing rows. Resume seed rows count as existing rows, so later complete/failed events can update them.

### Console reducer

In `handle-resume.ts`:

- Add `handleBuildResumeState: EventHandler<'build:resume:state'>`.
- For each `seededMerged` plan ID, set `planStatuses[id] = 'complete'` only when the current value is `undefined` or `'plan'`.
- Do not map `seededPending` IDs to `complete`. Leave pending visibility to recovered artifacts; setting missing pending IDs to `'plan'` is acceptable only if it does not overwrite any existing stage.
- Keep `handleBuildResumeArtifacts()` seeding missing recovered plans as `'plan'` and preserving `earlyOrchestration`, `resumeArtifacts`, and `resumeSource`.
- Add the handler to `handlerRegistry` and remove `build:resume:state` from `IGNORED_EVENT_TYPES`.

## Verification

- [ ] `buildRunSummary()` returns recovered artifact branches and dependencies for a resume run with no `planning:complete` event.
- [ ] `buildRunSummary()` returns `completed` for every seeded merged plan and `pending` for every seeded pending plan before later build events.
- [ ] `buildRunSummary()` returns planning-event branch/dependency metadata when both planning and resume artifact events exist.
- [ ] `buildRunSummary()` uses the newest valid resume artifact row when a newer malformed artifact row exists.
- [ ] `buildRunSummary()` returns `failed` for a seeded merged plan after a later `plan:build:failed` event for that plan.
- [ ] Console reduction of `[build:resume:state, build:resume:artifacts]` yields the same merged-plan completion state as `[build:resume:artifacts, build:resume:state]`.
- [ ] Console reduction leaves seeded pending plans out of the `complete` bucket.
- [ ] Console reduction preserves existing `complete`, `implement`, and `failed` stages after a later `build:resume:artifacts` event.
- [ ] Console selectors report seeded merged plans in `plansCompleted` and `complete` counts after reducer processing.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run test/run-summary-plans.test.ts packages/monitor/src/__tests__/projections-run-summary.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts packages/console-ui/src/lib/run-state/__tests__/selectors.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm test` exits 0.
