---
title: Show Recovered Plan Context in Resumed Build Details
created: 2026-05-31
profile: pi-codex-5-5
landing: pr
landing_auto_merge: true
---

# Show Recovered Plan Context in Resumed Build Details

## Problem / Motivation

A resumed compiled-build run detail page does not show the planning/PRD context or the full compiled plan set that the resume is continuing from. It only shows plan rows that receive fresh lifecycle or agent activity in the resume session.

Affected users are developers using `/eforge:resume` and `/console/runs/<resume-run-id>` to understand a continued failed build. Resume is intended to continue preserved compiled artifacts, not start over, so the run detail must make the recovered plan context visible without replaying or duplicating historical planning events.

This is a cleaned successor to the failed queue item `.eforge/queue/failed/fix-resumed-build-plan-detail-visibility.md`. The original branch `eforge/fix-resumed-build-plan-detail-visibility` forked from `aa1e2141` and is now 32 commits behind `main`; its only implementation commit `94caa802` is not an ancestor of `main`. The branch diff now includes unrelated drift and touched `packages/monitor-ui/`, which conflicts with the intended scope. The old failed build should not be retried as-is.

Roadmap alignment: `docs/roadmap.md` names `console-ui` as the canonical local-first control surface for observing and controlling builds, while preserving a headless engine and thin integrations. Making resumed build detail pages show the recovered plan context fits that direction.

Classification: bugfix / focused. The behavior is incorrect for resume sessions, but the implementation is a cohesive cross-package path: engine emits recovered artifact projection, client owns the event contract, monitor projects plan previews from it, and console-ui renders from it.

Recommended profile: **Excursion**.

Rationale: this is a focused cross-package bugfix with a clear dependency chain: client event contract, engine resume emission, recovery run-selection fix, monitor plan projection, and console-ui state/rendering. A single cohesive implementation plan can enumerate the needed file changes and tests. Expedition is unnecessary because this does not require delegated module planning, and Errand is too small because the fix touches engine, daemon/client contract, and console-ui behavior.

Current-code evidence on `main`:

- `packages/client/src/events.schemas.ts` defines `build:resume:start`, `build:resume:state`, `build:resume:ineligible`, and `build:resume:complete`, but no persisted event carrying recovered plan artifacts or PRD/source metadata.
- `packages/client/src/event-registry.ts` classifies the existing resume lifecycle events as session-scoped and persisted; a new resume artifact projection should follow that registry pattern.
- `packages/engine/src/eforge.ts` reads recovered orchestration and plan markdown during `resumeBuild()`, but only emits resume start/state/complete lifecycle events before running the build pipeline.
- `packages/engine/src/resume/compiled-build.ts` reconstructs resume eligibility and seed state from failure summary plus artifact source, so it is the natural helper area for projection utilities.
- `packages/engine/src/recovery/event-history.ts` still selects the newest run for a plan set regardless of command/status, which can make an active resume run shadow the original failed build run when reconstructing a failure summary.
- `packages/monitor/src/server.ts` `servePlans()` reads plan previews from session-local `planning:complete`, expedition architecture events, and gap-close events. A resume session with no planning events still returns no compiled plans.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` explicitly ignores all `build:resume:*` events and says resume UI rendering is future work.
- `packages/console-ui/src/views/run-detail/pipeline-section.tsx` derives the PRD/source row only from `planning:start` and does not have resume-source fallback state.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` renders plan rows from `Object.entries(planStatuses)`, so recovered plans absent from fresh lifecycle events are invisible.
- `packages/client/src/types.ts` defines `PlanInfo` for `/api/plans/:id`; monitor and console-ui should continue using that shared wire shape rather than local route/interface copies.

Reproduction path from the failed queue item, still supported by current code inspection:

1. Have a failed compiled build with preserved plan artifacts on branch `eforge/<setName>`.
2. Start a compiled-build resume for that failed PRD.
3. Open `/console/runs/<resume-session-id>` while or after the resume run is recorded.
4. Observe that the pipeline shows only plan rows with fresh resume-run status or agent activity.
5. Compare with the original failed build session, where `planning:start`, `planning:complete`, and compiled plan artifacts are available.
6. Request `GET /api/plans/<resume-session-id>`.
7. Observe that the response is empty when the resume session has no `planning:complete`, expedition architecture, or gap-close plan events.

Expected behavior:

- The resume run detail shows a resume/PRD source row when recovered source metadata exists.
- The resume run detail shows every recovered compiled plan row before any fresh lifecycle event is emitted for those plans.
- Active resume work overlays the recovered rows without copying historical planning events or duplicating old tokens, cost, or agent thread activity.

Actual behavior in current `main` by code inspection:

- Resume lifecycle events are ignored by console-ui run-state projection.
- Plan previews for resume sessions are not available from `/api/plans/:runId` unless that same resume session contains planning events.
- The pipeline row list is seeded from fresh `planStatuses` only, not recovered artifacts.

Confirmed root causes in current `main`:

1. `packages/engine/src/eforge.ts` parses recovered orchestration and plan markdown during `resumeBuild()`, but it does not emit a dedicated event containing the recovered source, orchestration, and compiled plan artifacts. The only emitted resume events are lifecycle/state events.
2. `packages/client/src/events.schemas.ts` has no `build:resume:artifacts` or equivalent wire contract. Consumers have no typed persisted event to consume.
3. `packages/console-ui/src/lib/run-state/handlers/index.ts` still lists all `build:resume:*` events under `IGNORED_EVENT_TYPES`, so resume state is intentionally invisible in the run-state projection.
4. `packages/console-ui/src/views/run-detail/pipeline-section.tsx` finds PRD/source content only by scanning for `planning:start`. Resume sessions do not emit `planning:start`, by design.
5. `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` renders rows from `Object.entries(planStatuses)`, so recovered compiled plans that have not yet received fresh lifecycle events have no row.
6. `packages/monitor/src/server.ts` `servePlans()` is session-local and currently reads `planning:complete`, expedition, and gap-close events only. Resume sessions with only resume lifecycle events return no plan previews.
7. `packages/engine/src/recovery/event-history.ts` selects the most recent run for a plan set without preferring a failed `build` run. When a newer active `resume` run exists, failure-summary reconstruction can use the resume run instead of the original failed build run, losing seed evidence.

## Goal

Resume run detail pages in `console-ui` should show recovered PRD/source context and every recovered compiled plan for an eligible compiled-build resume before fresh lifecycle events arrive, while preserving active resume status overlays.

The implementation should replace the stale failed branch with a clean implementation from current `main`, without modifying `packages/monitor-ui/`, replaying historical planning events, or duplicating historical agent activity, token, cost, or usage data.

## Approach

Add a new additive, persisted, session-scoped resume artifact event, e.g. `build:resume:artifacts`, instead of replaying historical `planning:*` events.

Emit that event after resume eligibility succeeds and recovered orchestration/plan markdown have been parsed, before the resumed build pipeline runs.

Include recovered PRD/source metadata best-effort, orchestration plan metadata, and plan artifacts/config needed by monitor and console-ui.

Update `/api/plans/:runId` to return `PlanInfo[]` from the resume artifact event when normal planning sources are absent.

Update console-ui run-state and pipeline rendering to seed recovered plan rows and PRD/source display from the event without counting it as agent activity, token usage, or cost.

Fix recovery event-history run selection to prefer the latest failed `build` run for a plan set, with conservative fallback when no failed build run exists.

Implementation targets and actions:

- `packages/client/src/events.schemas.ts`: add the resume artifact event schema and derived event type exports. Reuse existing wire shapes where possible (`PlanInfo`-compatible fields, `BuildStageSpec`, `ReviewProfileConfig`, orchestration plan metadata) rather than duplicating route interfaces.
- `packages/client/src/event-registry.ts`: classify the new event as `scope: 'session'` and `persist: true`.
- `packages/client/src/events.ts`, `packages/client/src/index.ts`, and `packages/client/src/browser.ts`: export the new event type/schema if a named schema/type is introduced.
- `packages/client/src/__tests__/events-schemas.test.ts` and `packages/client/src/__tests__/events-wire-parity.test.ts`: add safe-parse and wire-parity coverage for the new event.
- `packages/engine/src/recovery/event-history.ts`: change run selection so failure summary synthesis prefers the latest failed `build` run for `plan_set = ?`; fall back to the previous newest-run behavior only when no failed build run exists.
- `test/recovery-terminal-failure.test.ts` or the closest existing recovery event-history test: add a fixture where a failed build run is followed by a running resume run for the same plan set.
- `packages/engine/src/resume/compiled-build.ts`: add focused helper(s) to build resume artifact projection data from parsed orchestration/plan files and best-effort PRD source lookup.
- `packages/engine/src/eforge.ts`: emit the resume artifact event after `validatePlanSet()`, `parseOrchestrationConfig()`, and `parsePlanFile()` succeed, before calling the resumed build pipeline.
- `packages/monitor/src/server.ts`: update `servePlans()` to read the latest resume artifact event for the requested session and project its plans to `PlanInfo[]`, preserving existing planning/expedition/gap-close behavior.
- `packages/monitor/src/__tests__/...`: add a daemon/server route test for a resume session with no `planning:complete` but with a resume artifact event.
- `packages/console-ui/src/lib/run-state/types.ts`: add resume artifact/source state as needed.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` and a new `handle-resume.ts` if useful: stop ignoring the new artifact event and project it into run state without creating agent threads or usage totals.
- `packages/console-ui/src/views/run-detail/pipeline-section.tsx`: derive PRD/source display from resume artifact state when `planning:start` is absent.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx`: render plan rows from the union of `planStatuses`, `orchestration.plans`, and `planArtifacts`; preserve fresher lifecycle status when a plan later gets status events.
- `packages/console-ui/src/lib/run-state/__tests__/...` and `packages/console-ui/src/views/run-detail/__tests__/...`: add reducer/render coverage for resume artifact sessions.
- `web/public/schemas/events.schema.json` and generated reference docs: regenerate if the client event schema changes.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The missing resume-detail context still exists on current `main`. | Read `packages/client/src/events.schemas.ts`, `packages/engine/src/eforge.ts`, `packages/monitor/src/server.ts`, `packages/console-ui/src/lib/run-state/handlers/index.ts`, `packages/console-ui/src/views/run-detail/pipeline-section.tsx`, and `packages/console-ui/src/components/pipeline/thread-pipeline.tsx`; all still show the absence of resume artifact projection/rendering. | high | low | Create a synthetic resume-session event fixture and assert current `/api/plans`/run-state behavior before implementing. | If wrong, the build may duplicate existing behavior or need only test cleanup. |
| A dedicated resume artifact event is safer than replaying historical `planning:*` events into the resume session. | Current run-state uses planning/agent events for timeline and activity semantics; replaying old planning events would risk duplicated timelines, token/cost accounting, and misleading chronology. | high | low | Add reducer tests proving the artifact event does not alter agent threads, token totals, or cost totals. | If wrong, consumers might need a different projection path, but the event remains additive and can be narrowed. |
| The engine has enough data at resume time to emit compiled plan artifacts. | `resumeBuild()` validates orchestration and parses every plan markdown before running the build pipeline; `compiled-build.ts` already resolves merge-worktree or branch-history artifact sources. | high | low | Unit-test helper projection with parsed orchestration and plan file fixtures. | If wrong, the event may need to be emitted later or with partial plan metadata. |
| PRD source content can be recovered often enough to improve the UI, but it may be absent for some historical resumes. | Original failed PRD evidence referenced preserved PRD source; current code does not guarantee every historical branch/source path exists. | medium | low | Implement best-effort lookup and tests for source-present and source-missing cases. | If wrong, the UI should still show plan rows using a source label without content. |
| Adding the resume artifact event is an additive wire change that does not require a daemon API version bump. | Existing instructions require `DAEMON_API_VERSION` bumps for breaking HTTP API changes; this plan adds a new event variant and keeps route shapes compatible. | medium | low | Check nearby event additions and run docs/schema parity tests; reviewer can require a bump if project policy differs. | If wrong, the fix needs a small API-version update and docs note. |
| `PlanInfo[]` remains the right response shape for `/api/plans/:runId`. | `packages/client/src/types.ts` owns `PlanInfo`, and console-ui imports it from `@eforge-build/client/browser`; project instructions say daemon wire shapes and route contracts are owned by `@eforge-build/client`. | high | low | Type-check monitor and console-ui after projecting resume artifacts to `PlanInfo[]`. | If wrong, route consumers may need an additional field or client type update. |
| The stale failed branch should not be retried directly. | `git rev-list --left-right --count main...eforge/fix-resumed-build-plan-detail-visibility` showed `32 3`; `94caa802` is not an ancestor of `main`; branch diff includes unrelated reversions and `packages/monitor-ui/` changes. | high | low | None needed unless the branch is manually cherry-picked for reference only. | Retrying the branch could revert newer work or violate scope. |
| Package-specific client and monitor packages do not expose standalone `test` scripts. | Read `packages/client/package.json` and `packages/monitor/package.json`; both have `build` and `type-check`, while console-ui has `test`. | high | low | Use root `pnpm test -- --run ...` for client/monitor/engine targeted tests and `pnpm --filter @eforge-build/console-ui test` for UI tests. | If wrong, validation command choice can be adjusted without changing implementation. |

## Scope

In scope:

- Add a persisted, session-scoped resume artifact event to the client event contract.
- Emit recovered compiled-build context from the engine during eligible compiled-build resume.
- Project recovered plan artifacts from resume events through `/api/plans/:runId`.
- Render recovered PRD/source context and recovered compiled plan rows in `packages/console-ui/`.
- Preserve active resume lifecycle/status overlays on top of recovered rows.
- Fix recovery event-history run selection so the original failed build run is preferred over a newer active resume run for the same plan set.
- Add client, engine/recovery, monitor/server, and console-ui tests covering the new behavior.
- Regenerate event schema/reference documentation after the client event schema changes.

Out of scope:

- Do not modify `packages/monitor-ui/`.
- Do not replay or copy historical `planning:*`, `agent:*`, token, cost, or usage events into the resume session.
- Do not change `PlanInfo` route shape incompatibly.
- Do not retry or merge the stale branch `eforge/fix-resumed-build-plan-detail-visibility`.

## Acceptance Criteria

- `buildFailureSummary()` selects the latest failed `build` run for a plan set when a newer active `resume` run exists.
- A recovery event-history test fails without the run-selection fix and passes with a monitor DB containing one failed `build` run followed by one running `resume` run for the same `plan_set`.
- The client event schema defines a persisted session-scoped resume artifact event for recovered compiled-build context.
- `safeParseEforgeEvent()` accepts the resume artifact event shape.
- The client event registry classifies the resume artifact event as `scope: 'session'`.
- The client event registry classifies the resume artifact event as `persist: true`.
- The resume artifact event includes every recovered compiled plan id.
- The resume artifact event includes every recovered compiled plan name.
- The resume artifact event includes every recovered compiled plan body.
- The resume artifact event includes every recovered compiled plan dependency list.
- The resume artifact event includes every recovered compiled plan branch when available.
- The resume artifact event includes every recovered compiled plan build-stage config when available.
- The resume artifact event includes every recovered compiled plan review config when available.
- The resume artifact event includes recovered orchestration pipeline metadata when available.
- The resume artifact event includes PRD source content when it can be read from recovered artifacts or a known source path.
- The resume artifact event includes a source label without content when PRD source content cannot be recovered.
- The engine emits the resume artifact event during eligible compiled-build resume after recovered orchestration and plan markdown files are parsed.
- The engine does not emit `planning:start` during compiled-build resume.
- The engine does not emit `planning:complete` during compiled-build resume.
- `/api/plans/:runId` returns compiled plan artifacts for a resume session that has no `planning:complete` event and has a resume artifact event.
- `/api/plans/:runId` preserves existing plan responses for non-resume sessions with `planning:complete` events.
- console-ui run-state projection handles the resume artifact event without creating agent threads.
- console-ui run-state projection handles the resume artifact event without incrementing token totals.
- console-ui run-state projection handles the resume artifact event without incrementing cost totals.
- console-ui run-state projection seeds visible plan rows for every recovered compiled plan before any fresh resume lifecycle event for those plans arrives.
- console-ui run-state projection preserves fresher lifecycle statuses when a recovered plan later receives `plan:status:change` events.
- The run-detail pipeline renders a PRD or resume-artifacts row for a resume session when `planning:start` is absent and resume artifact source metadata is present.
- The run-detail pipeline renders all recovered plan rows for a resume session when only resume lifecycle events and the resume artifact event are present.
- The run-detail pipeline continues to render normal compile/build sessions from `planning:start` and `planning:complete` events.
- `packages/monitor-ui/` has zero modified files after the change.
- `pnpm --filter @eforge-build/console-ui test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm test -- --run packages/client/src/__tests__/events-schemas.test.ts packages/client/src/__tests__/events-wire-parity.test.ts test/recovery-terminal-failure.test.ts test/resume-compiled-build-engine.test.ts` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm docs:generate` is run after the client event schema changes.
- `pnpm docs:check` exits 0 after generated docs are updated.
