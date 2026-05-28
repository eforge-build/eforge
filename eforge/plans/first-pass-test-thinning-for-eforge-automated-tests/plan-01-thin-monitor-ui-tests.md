---
id: plan-01-thin-monitor-ui-tests
name: Thin Legacy monitor-ui Duplicate Tests
branch: first-pass-test-thinning-for-eforge-automated-tests/plan-01-thin-monitor-ui-tests
agents:
  builder:
    effort: high
    rationale: The change is test-only, but it spans 14 legacy duplicate files and
      requires file-by-file inspection to preserve monitor-ui-only assertions
      while reducing duplicated behavioral matrices.
---

# Thin Legacy monitor-ui Duplicate Tests

## Architecture Context

`packages/console-ui/` is the active monitoring dashboard. `packages/monitor-ui/` is retained as a legacy dashboard during the port. The listed `monitor-ui` tests duplicate active `console-ui` behavioral coverage, so this plan reduces duplicated legacy matrices while retaining smoke/parity checks through the `monitor-ui` import paths.

No production code, client wire schemas, slow git-heavy integration tests, playbook API tests, or `console-ui` tests are in scope.

## Implementation

### Overview

Replace the copied behavioral matrices in the 14 listed `packages/monitor-ui` test files with compact smoke/parity tests. Each thinned file must invoke at least one `monitor-ui` module/component/helper through the import path already used by that file and assert a meaningful state, rendering, or return-value delta. Do not add thinning targets.

Before editing, inspect each listed `monitor-ui` file and its corresponding `console-ui` duplicate only to detect `monitor-ui`-only assertions. Keep any `monitor-ui`-only assertion or list the file as intentionally unchanged in the implementation summary with a reason.

Use the planner-observed baseline for the required summary unless re-measuring before the first edit is easier:

- Baseline across the 14 listed `monitor-ui` targets: 157 tests.
- Baseline line count observed by `wc -l`: 2,654 lines.

After editing, re-run the same count style and include the before/after test count and before/after line count in the implementation summary.

### Key Decisions

1. Leave the active `console-ui` duplicate tests unchanged so they remain the behavioral source of truth.
2. Keep only compact `monitor-ui` smoke/parity tests that exercise real behavior, not import-only checks.
3. Keep the change set under `packages/monitor-ui/**/__tests__/**` plus optional helper files under those test directories.
4. Remove both sides of any deleted `// --- eforge:region ... ---` marker pair, or keep both markers balanced if a retained file stays above the maintainability threshold.

## Scope

### In Scope

- Thin exactly these legacy reducer tests:
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-agent.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-daemon.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-enqueue.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-expedition.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-plan-build.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-planning.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-session.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/handle-validation.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/regression-orchestration-gap.test.ts`
  - `packages/monitor-ui/src/lib/reducer/__tests__/regression.test.ts`
- Thin exactly these legacy pipeline tests:
  - `packages/monitor-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx`
  - `packages/monitor-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts`
  - `packages/monitor-ui/src/components/pipeline/__tests__/compute-depth-map.test.ts`
- Add a small local helper under a `packages/monitor-ui/**/__tests__/` directory only if it reduces repeated smoke setup.

### Out of Scope

- Changes under `packages/console-ui/**/__tests__/**`.
- Changes to `packages/client` event wire/schema tests.
- Changes to slow real-git landing, worktree, trunk-sync, recovery, or playbook API integration tests.
- Production source changes.
- Discovery or thinning of targets beyond the 14 listed files.
- Public documentation changes.

## Files

### Create

Optional only:

- `packages/monitor-ui/src/lib/reducer/__tests__/smoke-helpers.ts` — shared typed `makeEvent` and fixture helpers for thinned reducer smoke tests if this avoids repeated setup.
- `packages/monitor-ui/src/components/pipeline/__tests__/pipeline-smoke-helpers.ts` — shared component/helper factories if this avoids repeated setup in pipeline smoke tests.

Do not create helper files if the local setup remains shorter than the helper indirection.

### Modify

- `packages/monitor-ui/src/lib/reducer/__tests__/handle-agent.test.ts` — reduce to smoke coverage for `handleAgentStart`, `handleAgentUsage`, `handleAgentResult`, `handleAgentActivity`, and `handleAgentStop`. Retain assertions that a started thread records representative runtime metadata/toolbelt fields, a usage/result path changes token/thread data, activity attaches to the matching agent, and stop clears live usage or records end data.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-daemon.test.ts` — reduce to a smoke/parity test that applies `daemon:auto-build:paused` through the `monitor-ui` reducer or handler and asserts `selectAutoBuild` reports `{ paused: true, reason }` plus the timestamp/reason delta.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts` — reduce to smoke tests for `handlePlanBuildDecision` and `handlePlanningDecision`; retain one formatting assertion through `decisionSummary`/`decisionDetail` if that is the smallest retained coverage for decision display behavior.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-enqueue.test.ts` — reduce to compact coverage for start/complete/failure/no-op behavior, with at least one assertion proving `enqueueStatus`, `enqueueSource`, or `enqueueTitle` changes through the `monitor-ui` handlers.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-expedition.test.ts` — reduce to coverage that `expedition:architecture:complete` seeds module statuses and synthesized expedition orchestration, plus a module status transition smoke for start or complete.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-plan-build.test.ts` — reduce to representative coverage for stage advancement, file changes, review/test issue extraction or perspective storage, and merge commit capture through the `monitor-ui` handlers.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-planning.test.ts` — reduce to coverage that `planning:complete` seeds plan statuses and synthesizes compile-mode `earlyOrchestration` with dependencies; retain a compact `planConfigs` propagation assertion if it is not otherwise covered in the retained smoke.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-session.test.ts` — reduce to lifecycle smoke coverage for start/end and one profile or phase fallback path.
- `packages/monitor-ui/src/lib/reducer/__tests__/handle-validation.test.ts` — reduce to representative command span coverage: start creates a running span, complete marks an open span passed/failed, timeout marks an open span timed out, or a short replay covers these deltas.
- `packages/monitor-ui/src/lib/reducer/__tests__/regression-orchestration-gap.test.ts` — reduce to the smallest fixture replay smoke proving `effectiveOrchestration = state.orchestration ?? state.earlyOrchestration` exposes `dependsOn` data for the sample build.
- `packages/monitor-ui/src/lib/reducer/__tests__/regression.test.ts` — reduce the large fixture assertion matrix to one compact replay smoke that asserts representative final state slices: lifecycle completion, plan status map, token totals, at least one agent thread, file changes or merge commits, and `earlyOrchestration` dependency data.
- `packages/monitor-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx` — reduce to compact jsdom coverage that renders `AgentDetailSheet` through the `monitor-ui` path and asserts visible behavior such as title text, activity totals or long-result expansion, and matching warning event display.
- `packages/monitor-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts` — reduce to smoke coverage for `buildStageName`, `resolveBuildStage`, and `getBuildStageStatuses` through the `monitor-ui` helper import path. Keep the client event registry assertions only if inspection shows they are monitor-ui-specific; otherwise leave them to active shared/client coverage.
- `packages/monitor-ui/src/components/pipeline/__tests__/compute-depth-map.test.ts` — reduce to compact DAG coverage that proves depth calculation for a representative chain/branch and termination on cyclic input or empty input.

### Reference Only — Do Not Modify

Use these files only as duplicate/reference coverage:

- `packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-expedition.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-planning.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-session.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/handle-validation.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/regression-orchestration-gap.test.ts`
- `packages/console-ui/src/lib/run-state/__tests__/regression.test.ts`
- `packages/console-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx`
- `packages/console-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts`
- `packages/console-ui/src/components/pipeline/__tests__/compute-depth-map.test.ts`

## Counting Commands

Use equivalent commands for the implementation summary before/after numbers:

```bash
TARGETS=(
  packages/monitor-ui/src/lib/reducer/__tests__/handle-agent.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-daemon.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-enqueue.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-expedition.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-plan-build.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-planning.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-session.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/handle-validation.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/regression-orchestration-gap.test.ts
  packages/monitor-ui/src/lib/reducer/__tests__/regression.test.ts
  packages/monitor-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx
  packages/monitor-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts
  packages/monitor-ui/src/components/pipeline/__tests__/compute-depth-map.test.ts
)
wc -l "${TARGETS[@]}"
rg -n '\b(it|test)\(' "${TARGETS[@]}" | wc -l
```

## Verification

- [ ] `git diff --name-only` contains only the 14 listed `packages/monitor-ui` target files and optional helper files under `packages/monitor-ui/**/__tests__/`.
- [ ] `git diff --name-only` contains zero paths under `packages/console-ui/**/__tests__/**`.
- [ ] `git diff --name-only` contains zero `packages/client` event wire/schema test paths.
- [ ] Every thinned target file contains at least one assertion that calls or renders a `monitor-ui` import from that file's existing import path.
- [ ] Any target left unchanged is named in the implementation summary with a reason tied to a retained `monitor-ui`-only assertion.
- [ ] The total `rg -n '\b(it|test)\('` count across the 14 targets is below 157 after editing.
- [ ] The total `wc -l` line count across the 14 targets is below 2,654 after editing.
- [ ] The implementation summary includes before/after test counts and before/after line counts across the 14 targets.
- [ ] `pnpm exec vitest run packages/monitor-ui/src/lib/reducer/__tests__/handle-agent.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-daemon.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-decisions.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-enqueue.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-expedition.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-plan-build.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-planning.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-session.test.ts packages/monitor-ui/src/lib/reducer/__tests__/handle-validation.test.ts packages/monitor-ui/src/lib/reducer/__tests__/regression-orchestration-gap.test.ts packages/monitor-ui/src/lib/reducer/__tests__/regression.test.ts packages/monitor-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx packages/monitor-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts packages/monitor-ui/src/components/pipeline/__tests__/compute-depth-map.test.ts` exits 0.
- [ ] `pnpm exec vitest run packages/console-ui/src/lib/run-state/__tests__/handle-agent.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-daemon.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-decisions.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-enqueue.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-expedition.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-plan-build.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-planning.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-session.test.ts packages/console-ui/src/lib/run-state/__tests__/handle-validation.test.ts packages/console-ui/src/lib/run-state/__tests__/regression-orchestration-gap.test.ts packages/console-ui/src/lib/run-state/__tests__/regression.test.ts packages/console-ui/src/components/pipeline/__tests__/agent-detail-sheet.test.tsx packages/console-ui/src/components/pipeline/__tests__/agent-stage-map.test.ts packages/console-ui/src/components/pipeline/__tests__/compute-depth-map.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
