---
id: plan-02-resume-artifacts-projection
name: Emit and Render Recovered Resume Artifacts
branch: show-recovered-plan-context-in-resumed-build-details/plan-02-resume-artifacts-projection
agents:
  builder:
    effort: high
    rationale: Cross-package event contract, engine emission, daemon projection,
      console rendering, and generated docs must land together so the new event
      type stays consumable.
  reviewer:
    effort: high
    rationale: The plan changes a persisted wire event contract and multiple
      consumers; review must check API shape and projection semantics.
---

# Emit and Render Recovered Resume Artifacts

## Architecture Context

Resume sessions continue preserved compiled artifacts. The engine must expose those recovered artifacts through an additive, persisted, session-scoped event instead of replaying `planning:*` history. The client package owns the event contract, the engine emits the projection, the monitor daemon maps it to the existing `PlanInfo[]` route shape, and console-ui renders recovered source and plan rows without adding historical agent activity, token usage, cost, or timeline entries.

`packages/monitor-ui/` is out of scope for this plan. Keep its git diff empty.

## Implementation

### Overview

Add `build:resume:artifacts`, emit it during eligible compiled-build resume after orchestration and plan markdown parsing, project it through `/api/plans/:runId`, and teach console-ui to seed recovered plan/source state from the event.

### Key Decisions

1. Use an additive `build:resume:artifacts` event rather than `planning:start` or `planning:complete` replay so resumed runs do not duplicate historical planning, agent, token, cost, or usage activity.
2. Store plan bodies and plan metadata in the event because resume artifacts may be recovered from branch history or temporary worktrees that are later cleaned up.
3. Keep `/api/plans/:runId` returning `PlanInfo[]`; map resume event plans into the existing route shape and do not add incompatible fields to the route response.
4. Seed console-ui plan rows from recovered artifacts while preserving fresher lifecycle overlays from later `plan:status:change` and build events.
5. Do not bump `DAEMON_API_VERSION` unless review finds this additive event violates the project API-version policy.

## Scope

### In Scope
- Add a persisted, session-scoped resume artifact event to `@eforge-build/client`.
- Emit recovered source metadata, orchestration metadata, and plan artifacts from the engine during eligible compiled-build resume.
- Return `PlanInfo[]` from resume artifacts when a resume session has no existing session-local planning, expedition, or gap-close plan source.
- Render a resume source row and recovered compiled plan rows in console-ui.
- Add client, engine, monitor route, and console-ui tests.
- Regenerate event schema/reference artifacts after the client event schema changes.

### Out of Scope
- Modifying `packages/monitor-ui/`.
- Replaying or copying historical `planning:*`, `agent:*`, token, cost, or usage events into the resume session.
- Changing `PlanInfo` incompatibly.
- Retrying or merging the stale branch `eforge/fix-resumed-build-plan-detail-visibility`.
- Database migrations.

## Files

### Create
- `packages/console-ui/src/lib/run-state/handlers/handle-resume.ts` — reducer handler for `build:resume:artifacts`.
- `packages/console-ui/src/lib/run-state/__tests__/handle-resume.test.ts` — reducer coverage for recovered plans, source state, and no usage/thread side effects.
- `packages/console-ui/src/components/pipeline/__tests__/thread-pipeline-resume.test.tsx` — rendering coverage for source-only and recovered-plan rows.
- `packages/monitor/src/__tests__/resume-plans-route.test.ts` — daemon route coverage for resume artifact projection to `PlanInfo[]`.

### Modify
- `packages/client/src/events.schemas.ts` — add `build:resume:artifacts` schema, supporting artifact/source schemas, and derived event type/schema exports.
- `packages/client/src/event-registry.ts` — classify `build:resume:artifacts` as `scope: 'session'` and `persist: true` with a summary.
- `packages/client/src/events.ts` — re-export the new event type and schema if named exports are introduced.
- `packages/client/src/index.ts` — re-export the new event type and schema from the Node entrypoint if named exports are introduced.
- `packages/client/src/browser.ts` — re-export the new event type and schema from the browser entrypoint if named exports are introduced.
- `packages/client/src/__tests__/events-schemas.test.ts` — add safe-parse coverage and registry metadata assertions for `build:resume:artifacts`.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add a valid wire payload fixture for `build:resume:artifacts`.
- `packages/engine/src/resume/compiled-build.ts` — add helpers to build the resume artifact projection from parsed orchestration, parsed plan markdown, artifact source metadata, and best-effort PRD source lookup.
- `packages/engine/src/eforge.ts` — emit `build:resume:artifacts` after `validatePlanSet()`, `parseOrchestrationConfig()`, and all `parsePlanFile()` calls succeed, before creating or running the resumed build pipeline.
- `test/resume-compiled-build-engine.test.ts` — assert the helper projection includes plan ids, names, bodies, dependencies, branches, build/review config, orchestration pipeline metadata, and source label/content behavior; assert `resumeBuild()` emits the artifact event and still omits `planning:start` and `planning:complete`.
- `packages/monitor/src/server.ts` — update `servePlans()` to use the latest `build:resume:artifacts` event as the compiled-plan source only when existing planning, expedition, and gap-close plan sources are absent.
- `packages/console-ui/src/lib/run-state/types.ts` — add resume artifact/source state fields and re-export the new client event type if useful.
- `packages/console-ui/src/lib/run-state/reducer.ts` — initialize, reset, and recreate the new resume state fields.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — register `build:resume:artifacts` and keep other resume lifecycle events ignored.
- `packages/console-ui/src/views/run-detail/pipeline-section.tsx` — fall back to resume source metadata when no `planning:start` event exists, and use resume event plan artifacts when REST plan artifacts have not arrived.
- `packages/console-ui/src/components/pipeline/thread-pipeline.tsx` — render rows from the union of `planStatuses`, `orchestration.plans`, and `planArtifacts`; render a source row when source metadata exists even with no global agent threads.
- `web/public/schemas/events.schema.json` — update via `pnpm docs:generate`.
- `web/content/reference/events.md` — update via `pnpm docs:generate`.
- `web/public/reference/events.md` — update via `pnpm docs:generate`.
- `web/public/llms-full.txt` and any other generated reference artifact touched by `pnpm docs:generate` — accept deterministic generator output.

## Implementation Details

### Client event contract

Define the event with fields equivalent to:

```ts
type BuildResumeArtifactsEvent = {
  type: 'build:resume:artifacts';
  prdId: string;
  setName: string;
  featureBranch: string;
  artifactSource: 'merge-worktree' | 'branch-history';
  artifactCommit?: string;
  source: { label: string; content?: string; path?: string };
  orchestration: OrchestrationConfig;
  plans: Array<{
    id: string;
    name: string;
    body: string;
    dependsOn: string[];
    branch?: string;
    build?: BuildStageSpec[];
    review?: ReviewProfileConfig;
  }>;
};
```

Use existing `BuildStageSpecSchema`, `ReviewProfileConfigSchema`, and `OrchestrationConfigSchema` where possible. The event must be additive and session-scoped.

### Engine projection

Build the projection from the already parsed `orchConfig` and `planFileMap` in `resumeBuild()`:

- plan id/name/dependencies/branch/build/review come from `orchConfig.plans`.
- plan body comes from parsed plan markdown.
- source lookup uses `summary.prdContent` when present, then `.eforge/queue/failed/<prdId>.md`, then `.eforge/queue/<prdId>.md`; when content is absent, emit a source object with a stable label and no `content` field.
- artifact metadata comes from `checkResumeEligibility()` (`artifactSource`, `artifactCommit`).

Emit exactly one artifact event for an eligible resume after all recovered artifacts parse and before `orchestrator.execute(orchConfig)` starts. Do not emit `planning:start` or `planning:complete` in the resume path.

### Monitor projection

In `servePlans()`:

- Preserve existing planning, expedition, and gap-close behavior.
- If none of the existing planning, expedition, or gap-close plan sources produce plans, read the latest `build:resume:artifacts` event for the requested session.
- Map each artifact plan to `PlanInfo` with `type: 'plan'`, `id`, `name`, `body`, `dependsOn`, `build`, and `review`.
- Keep the route response shape as `PlanInfo[]`.

### Console projection and rendering

- Store `resumeArtifacts` and `resumeSource` in run state.
- `handleBuildResumeArtifacts` seeds `planStatuses[id] = 'plan'` only for recovered plans that do not already have a stage.
- `handleBuildResumeArtifacts` populates `earlyOrchestration` from the event orchestration so dependency rows, build stages, and graph data are available before fresh lifecycle events.
- The handler must not mutate `agentThreads`, token totals, cache totals, cost totals, file changes, or live usage.
- `PipelineSection` uses `planning:start` source first, then `runState.resumeSource`.
- `ThreadPipeline` computes ordered plan ids from orchestration order first, then plan artifact order, then remaining `planStatuses` keys. Later lifecycle status values from `planStatuses` remain the current stage.

## Verification

- [ ] `safeParseEforgeEvent()` accepts a `build:resume:artifacts` payload with source metadata, orchestration metadata, and two plan artifacts.
- [ ] `eventRegistry['build:resume:artifacts']` has `scope: 'session'`.
- [ ] `eventRegistry['build:resume:artifacts']` has `persist: true`.
- [ ] The engine helper returns every recovered plan id, name, body, dependency list, branch, build config, and review config from parsed artifacts.
- [ ] The engine helper returns source content when `.eforge/queue/failed/<prdId>.md` exists.
- [ ] The engine helper returns a source label and omits `content` when the PRD source file is absent.
- [ ] `resumeBuild()` emits `build:resume:artifacts` after recovered plan markdown parsing and before the first resumed plan build event.
- [ ] `resumeBuild()` emits no `planning:start` event.
- [ ] `resumeBuild()` emits no `planning:complete` event.
- [ ] `GET /api/plans/:runId` returns resume artifact plans for a resume session with no existing planning, expedition, or gap-close plan source.
- [ ] `GET /api/plans/:runId` returns planning-complete plans for a non-resume session with a `planning:complete` event.
- [ ] `GET /api/plans/:runId` returns expedition and gap-close plans for sessions that have those existing plan sources and no `planning:complete` event.
- [ ] Console run-state reduction of `build:resume:artifacts` creates zero new agent threads.
- [ ] Console run-state reduction of `build:resume:artifacts` leaves token and cost totals unchanged.
- [ ] Console run-state reduction of `build:resume:artifacts` seeds every recovered plan row before any plan lifecycle event arrives.
- [ ] A later `plan:status:change` for a recovered plan replaces that plan's visible stage.
- [ ] The pipeline renders a source row from resume metadata when `planning:start` is absent.
- [ ] The pipeline renders all recovered plan rows when plan statuses are empty and only resume artifact data exists.
- [ ] The pipeline still renders normal compile/build sessions from `planning:start` and `planning:complete` data.
- [ ] `git diff --name-only -- packages/monitor-ui` prints no paths.
- [ ] `pnpm docs:generate` exits 0 and updates generated reference artifacts.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm test -- --run packages/client/src/__tests__/events-schemas.test.ts packages/client/src/__tests__/events-wire-parity.test.ts packages/monitor/src/__tests__/resume-plans-route.test.ts test/resume-compiled-build-engine.test.ts` exits 0.
