---
id: plan-02-filter-synthetic-resume-lanes
name: Filter Synthetic Resume IDs From Engine and Console Lanes
branch: fix-workstation-session-plan-duplication-and-console-synthetic-resume-lanes/plan-02-filter-synthetic-resume-lanes
agents:
  builder:
    effort: high
    rationale: Cross-layer bugfix spanning engine resume event ordering, resume
      projection helpers, Console reducer state, selectors, and React lane
      rendering.
  reviewer:
    effort: high
    rationale: The review needs to verify event ordering, state projection, and UI
      lane gating stay aligned without hiding backed phase lanes.
---

# Filter Synthetic Resume IDs From Engine and Console Lanes

## Architecture Context

Recovery summaries may retain synthetic terminal failure evidence such as `planId: "acceptance-validation"`. That evidence belongs in recovery and terminal-failure summaries, but it is not an orchestration plan. Resume seeding currently copies every summary plan into `build:resume:state`; Console then treats every seeded id as a plan status and `thread-pipeline` renders each status key as a lane. The fix must filter resume seeds against real orchestration artifacts and add Console defensive gating for stale/old event streams.

Current exploration found the bug still open:

- `packages/engine/src/resume/resume-projection.ts::deriveResumeSeedState` accepts only summary plans and copies every plan id.
- `packages/engine/src/eforge.ts` calls `deriveResumeSeedState(summary.plans)` and emits `build:resume:state` before parsing `orchestration.yaml` and plan artifacts.
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts` adds every seeded pending id to `planStatuses`.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` renders every `planStatuses` key.
- `lane-registry.ts` has no `acceptance-validation` entry, and adding one would render a renamed bogus row.

## Implementation

### Overview

Filter engine resume seeds using the real orchestration plan ids once `orchestration.yaml` and plan markdown artifacts are known. Keep the recovery summary unchanged so synthetic acceptance-validation evidence remains available for recovery analysis. Add Console reducer and render-time guards so historical or malformed `build:resume:state` events cannot create empty raw lanes unless the id is a real plan or a registered phase lane with activity/validation content.

### Key Decisions

1. Extend `deriveResumeSeedState` with an optional allowed-plan-id set; when present, ids absent from the set are excluded from `seededMerged` and `seededPending`.
2. Move the engine resume seed derivation and `build:resume:state` emission until after orchestration validation, parsing, and plan-file loading. `build:resume:start` can remain before artifact parsing; `build:resume:state` must use filtered seed lists.
3. Build `resumeContextByPlan` from the filtered `seededPending` list only, so builder prompt context is never generated for synthetic ids.
4. Store Console resume seed state until real artifacts are known, then apply merged/pending overlays only to artifact/orchestration plan ids. Do not add `acceptance-validation` to the lane registry.
5. Keep registered phase lanes activity-gated: Validation, Gap Close, and Final Validation render when backed by agent threads or validation command spans, not from unbacked resume seed ids.

## Scope

### In Scope

- Filter `build:resume:state.seededMerged` and `seededPending` to real orchestration plan ids.
- Filter `resumeContextByPlan` to real orchestration plan ids.
- Preserve synthetic acceptance-validation evidence in recovery/failure summaries.
- Add Console reducer handling that does not convert unbacked resume seed ids into plan statuses.
- Add `thread-pipeline` and plan-lane selector gating for unbacked ids when orchestration/resume artifacts are present.
- Preserve backed Validation, Gap Close, and Final Validation lanes.
- Regression tests for engine seed projection, resume event emission, Console reducer state, and rendered pipeline lanes.

### Out of Scope

- Adding `acceptance-validation` to `LANE_REGISTRY`.
- Removing acceptance-validation evidence from recovery summaries or terminal failure summaries.
- Changing event wire schemas for `build:resume:state`.
- Reworking recovery summary synthesis beyond seed filtering.

## Files

### Create

- None expected. Add a small shared Console helper file only if it removes duplicated lane-visibility logic and stays under the repository file-size limits.

### Modify

- `packages/engine/src/resume/resume-projection.ts` — add optional allowed-plan-id filtering to `deriveResumeSeedState` and keep the default behavior unchanged for existing direct callers without an allow set.
- `packages/engine/src/eforge.ts` — parse/validate orchestration and load plan files before deriving and emitting resume seed state; pass `new Set(orchConfig.plans.map((plan) => plan.id))`; build `resumeContextByPlan` from filtered pending ids.
- `test/resume-seed-state.test.ts` — add pure projection coverage for a summary containing `acceptance-validation` plus real `plan-01..N`, with allowed ids excluding the synthetic id.
- `test/resume-compiled-build-engine.test.ts` — add an integration regression where resume summary evidence contains synthetic `acceptance-validation` but `build:resume:state` omits it and artifacts contain only real plans.
- `test/recovery-failure-summary.test.ts` — extend the existing acceptance-validation failure test to assert the synthetic evidence remains in the failure summary.
- `packages/console-ui/src/lib/run-state/types.ts` — add internal resume seed storage fields if needed so state events can arrive before artifact events without rendering synthetic lanes or losing merged-plan overlays.
- `packages/console-ui/src/lib/run-state/reducer.ts` — initialize/reset any new resume seed storage fields.
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts` — store seed events, apply seed overlays only to real artifact/orchestration plan ids, and prune unbacked plan-only resume statuses when artifacts arrive.
- `packages/console-ui/src/lib/run-state/lane-registry.ts` — export a helper such as `isRegisteredPhaseLane(id)` for defensive lane gating; do not add `acceptance-validation` to the registry.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` — when orchestration or resume artifacts are present, include plan-status lane ids only when they are artifact/orchestration plan ids or registered phase lanes with agent-thread or validation-command content.
- `packages/console-ui/src/lib/run-state/selectors/plan-progress.ts` — apply the same extra-lane gating for mini swimlane selectors so unbacked resume seed ids do not appear outside the run detail pipeline.
- `packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts` — add state-before-artifacts and artifacts-before-state regressions with `seededPending: ["acceptance-validation"]`.
- `packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-lanes.test.tsx` — add rendered regression for no raw `acceptance-validation` row, plus backed phase-lane assertions for Validation/Gap Close/Final Validation.
- `packages/console-ui/src/lib/run-state/__tests__/selectors.test.ts` — add selector coverage excluding unbacked synthetic ids while retaining backed phase lanes.
- `packages/console-ui/src/lib/run-state/__tests__/lane-registry.test.ts` — cover the new registered-phase-lane helper.

## Verification

- [ ] `deriveResumeSeedState(summary.plans, allowedIds)` returns `seededPending` and `seededMerged` containing only ids present in `allowedIds`.
- [ ] A resume run with summary evidence for `acceptance-validation` and artifacts for `plan-01..N` emits `build:resume:state` without `acceptance-validation`.
- [ ] Builder resume context is created only for filtered real plan ids.
- [ ] Recovery/failure summary tests still expose `failingPlan.planId === "acceptance-validation"` and `terminalFailure.scope === "acceptance-validation"` for acceptance-validation failures.
- [ ] Reducing `build:resume:state` with `seededPending: ["acceptance-validation"]` plus resume artifacts for real plans leaves `planStatuses.acceptance-validation` undefined, in both event orders.
- [ ] Rendering `ThreadPipeline` with real plan artifacts and `planStatuses.acceptance-validation = "plan"` produces no visible `acceptance-validation` row.
- [ ] Validation lanes render when backed by validation command spans.
- [ ] Gap Close lanes render when backed by `gap-close` agent threads.
- [ ] Final Validation lanes render when backed by validation command spans after `gap_close:complete`.
- [ ] Targeted resume/Console tests exit 0: `pnpm exec vitest run test/resume-seed-state.test.ts test/resume-compiled-build-engine.test.ts test/recovery-failure-summary.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-lanes.test.tsx packages/console-ui/src/lib/run-state/__tests__/selectors.test.ts packages/console-ui/src/lib/run-state/__tests__/lane-registry.test.ts`.