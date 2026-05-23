---
id: plan-02-stack-provider-runtime
name: Wire git-spice Runtime Landing and Durable Stack State
branch: complete-first-class-stacked-pr-and-git-spice-support/plan-02-stack-provider-runtime
agents:
  builder:
    effort: xhigh
    rationale: This plan coordinates provider subprocess execution, stack state
      mutation, orchestrator lifecycle ordering, and event emission.
  reviewer:
    effort: high
    rationale: Review must check subprocess argv safety, failure ordering, and
      state/event consistency.
---

# Wire git-spice Runtime Landing and Durable Stack State

## Architecture Context

The stack foundation already resolves stack bases and records build artifacts, but provider methods are only tested in isolation and stack state stops at `status: built`. Stacked runtime must fail early when git-spice is unavailable, track the artifact branch against the resolved base, submit/update the PR through git-spice, emit provider command events, and update the same `.eforge/stacks/layers.json` layer with landing status and PR URL.

## Implementation

### Overview

Introduce a stack landing helper that wraps git-spice provider calls and state updates. Wire it into the queued stacked build path after artifact recording and before generic landing completion. In stacked mode with `landing.action: pr`, git-spice is the PR/topology authority; the legacy `gh` direct PR path remains for non-stacked builds and can be used only as a PR URL lookup fallback after git-spice submits.

### Key Decisions

1. Provider operations return command metadata (`command`, `args`, `stdout`, `stderr`, `exitCode`) so runtime emits `stack:provider:command` from actual invocations.
2. `requireAvailable()` runs immediately after `resolveStackBaseContext()` for queued stacked PRDs and before compile/build mutation.
3. Stack landing updates mutate the existing layer identified by `prdId` + `stackId`; they never create a disconnected landing record.
4. Use `git-spice branch track --base <base>` and `git-spice branch submit` for the current layer worktree. Do not call `gh pr create` in stacked mode.
5. After submit, recover PR URL with the most stable available strategy: provider output parsing when available, then `gh pr view <artifactBranch> --json url -q .url` as best-effort URL discovery without PR creation.

## Scope

### In Scope

- Provider availability gating for stacked queued PRDs.
- Runtime git-spice `trackBranch` and `submitBranch` calls for stacked `landing.action: pr` / legacy `issue-pr`.
- `stack:provider:command` events emitted by real provider calls.
- `stack:landing:update` events emitted for started, complete, skipped, and failed outcomes.
- Durable layer landing state including action, status, PR URL, timestamps, and failure reason.
- Tests for missing provider, argv construction in runtime flow, non-stacked no-provider behavior, and persisted landing state.

### Out of Scope

- New stack providers.
- Native restack engine.
- Daemon/API/UI stack projection.
- Public docs.

## Files

### Create

- `packages/engine/src/stacking/landing.ts` — stack landing generator/helper that emits stack provider and landing events, invokes provider operations, discovers PR URL, and updates layer landing state.
- `test/stack-runtime-landing.test.ts` — runtime coverage for stacked provider calls, missing provider early failure, stack landing events, and non-stacked no-provider behavior.

### Modify

- `packages/engine/src/stacking/types.ts` — add a durable landing object to `StackLayer` with `action`, `status`, optional `prUrl`, optional `reason`, and lifecycle timestamps; keep existing artifact fields.
- `packages/engine/src/stacking/state.ts` — extend Zod schemas and add helpers such as `updateStackLayerLanding()` and `markStackLayerFailed()` that preserve `recordedAt` and existing artifact refs.
- `packages/engine/src/stacking/artifacts.ts` — preserve artifact recording while leaving any existing landing object intact on retry.
- `packages/engine/src/stacking/provider.ts` — update `StackProviderAdapter` method return types to expose command metadata.
- `packages/engine/src/stacking/git-spice.ts` — return command metadata from `run()`, retain execFile argv usage, include command guidance in availability errors, and add PR URL parsing helper only if git-spice output has a stable URL pattern.
- `packages/engine/src/stacking/index.ts` — export new stack landing/state helpers.
- `packages/engine/src/orchestrator.ts` — pass stacking config/provider context into phases.
- `packages/engine/src/orchestrator/phases.ts` — after `recordArtifact(ctx)`, run stack landing for stacked PR actions and skip the legacy `executeLandingAction()` PR publication for stacked PR mode; persist failed/skipped stack landing outcomes when validation, PRD validation, policy gate, abort, or merge-plan failure prevents landing.
- `packages/engine/src/eforge.ts` — instantiate provider and call `requireAvailable()` after stack context resolution and before compile; emit failure events and mark PRD failed when unavailable.
- `packages/client/src/events.schemas.ts` — extend `stack:provider:command` and `stack:landing:update` schemas if command metadata or failure reason fields are added; extend `StackLayerWireSchema` with optional landing object.
- `packages/client/src/event-registry.ts` — mark stack lifecycle events as persisted/session-visible and update summaries to include PR URL/reason when present.
- `packages/client/src/__tests__/events-schemas.test.ts` — cover extended stack event and layer wire shapes.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — cover stack provider and landing event payloads with optional reason/URL fields.
- `test/git-spice-provider.test.ts` — update adapter tests for command metadata and availability guidance.
- `test/stack-state.test.ts` — add landing state update and retry-preservation cases.
- `test/stack-artifact-recording.test.ts` — verify artifact recording preserves previous landing fields when retrying.
- `test/orchestration-logic.test.ts` / `test/prd-validate-phase.test.ts` where needed — update expected skipped stack landing state when validation or PRD validation blocks final landing.

## Verification

- [ ] A stacked queued PRD with missing configured git-spice emits failure before `planning:start` and the error mentions `git-spice` and `stacking.gitSpice.command`.
- [ ] A stacked PRD with `landing.action: pr` invokes git-spice `branch track --base <resolved-base>` and `branch submit` in the merge worktree and does not invoke `gh pr create`.
- [ ] A non-stacked `issue-pr` build does not instantiate or call the stack provider.
- [ ] `.eforge/stacks/layers.json` contains the same layer after landing with artifact branch/SHA plus landing action/status/timestamps and PR URL when URL discovery succeeds.
- [ ] `stack:provider:command` and `stack:landing:update` are emitted by runtime tests, not by fixture-only tests.
- [ ] `pnpm vitest run test/git-spice-provider.test.ts test/stack-state.test.ts test/stack-artifact-recording.test.ts test/stack-runtime-landing.test.ts test/artifact-aware-scheduler.test.ts` passes.
- [ ] `pnpm type-check` passes.