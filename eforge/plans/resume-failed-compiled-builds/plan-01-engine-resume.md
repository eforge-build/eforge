---
id: plan-01-engine-resume
name: Engine Resume Reconstruction
branch: resume-failed-compiled-builds/plan-01-engine-resume
agents:
  builder:
    effort: high
    rationale: Cross-cuts event schemas, orchestrator state seeding, worktree reuse,
      and build prompt context without a prior implementation pattern.
  reviewer:
    effort: high
    rationale: Resume state can skip or rerun work; review must scrutinize
      dependency-state safety and event-contract compatibility.
---

# Engine Resume Reconstruction

## Architecture Context

The engine currently builds from a fresh `initializeState()` call and has no public resume entry point. The first slice must reuse durable artifacts that already exist after a failed build: `eforge/<setName>`, the merge worktree when present, `orchestration.yaml`, plan markdown files, failed PRD sidecars, monitor DB events, and git history. This plan adds the engine-level resume primitive without adding general active-build crash persistence.

## Implementation

### Overview

Add a compiled-build resume path that validates eligibility, reconstructs a conservative initial plan state, emits machine-readable resume events, and reuses the existing build/orchestrator pipeline with a seeded state and per-plan resume context.

### Key Decisions

1. Use a new resume helper module to keep reconstruction and eligibility logic out of `eforge.ts` and `orchestrator.ts`.
2. Mark plans with merge-complete evidence as `merged`; reset failed, blocked, pending, and completed-without-merge-evidence plans to `pending`.
3. Inject compact resume context into builder prompts via build-stage context, preserving any configured prompt append text.
4. Reuse `createMergeWorktree()` when the merge worktree is missing but the `eforge/<setName>` branch exists.
5. Add additive resume events in `@eforge-build/client` schemas because event types are owned there.

## Scope

### In Scope

- A public engine generator for compiled-build resume, e.g. `EforgeEngine.resumeBuild(prdId, options)` or an equivalent explicit method.
- Eligibility checks for missing feature branch, missing `orchestration.yaml`, missing plan markdown files, and missing failed-run or sidecar evidence.
- Resume state seeding for `Orchestrator.execute()` through `initializeState()` or an equivalent initializer option.
- Resume summary events such as `build:resume:start`, `build:resume:state`, `build:resume:ineligible`, and `build:resume:complete`.
- A compact resume context that includes terminal failure message, feature branch, landed commits, diff stat or changed-file evidence, and the prior plan status.
- Worktree reuse hardening for an existing plan worktree path during resume.
- Engine tests for state reconstruction, scheduling with merged dependencies, ineligibility, and compile-free execution.

### Out of Scope

- Persisting active in-memory orchestration state during a running build.
- Automatically proving that a completed-but-unmerged plan satisfies dependencies.
- Deleting failed PRDs or recovery sidecars after resume.
- Changing PRD-level retry, split, abandon, or manual recovery verdict behavior.

## Files

### Create

- `packages/engine/src/resume/compiled-build.ts` — eligibility checks, summary loading from monitor DB and sidecar evidence, plan-state seed derivation, changed-file/diff-stat extraction, and resume prompt-context formatting.
- `test/resume-compiled-build-engine.test.ts` — engine-level tests for reconstruction, ineligibility, and compile-free resume behavior.

### Modify

- `packages/client/src/events.schemas.ts` — add resume event schemas, shared resume summary wire types, and allow `phase:start.command` to include `resume`.
- `packages/client/src/event-registry.ts` — add summaries and persistence metadata for resume lifecycle events.
- `packages/client/src/__tests__/events-schemas.test.ts` — cover valid and invalid resume event payloads.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add resume event wire examples.
- `packages/engine/src/events.ts` — re-export new resume wire types from `@eforge-build/client` if needed.
- `packages/engine/src/orchestrator.ts` — accept an optional resume state seed, initialize seeded plan statuses, set `merged: true` for seeded merged plans, and emit build execution with seeded state.
- `packages/engine/src/orchestrator/phases.ts` — verify seeded all-merged or partially-merged graphs terminate the schedule loop and proceed to validation or newly unblocked pending plans.
- `packages/engine/src/pipeline/types.ts` — carry optional resume context text on `BuildStageContext`.
- `packages/engine/src/pipeline/stages/build-stages.ts` — append resume context to builder prompt append text for resumed plans.
- `packages/engine/src/eforge.ts` — add the explicit resume entry point, load the original compiled artifacts, call the existing build path without compile stages, pass resume state/context into the orchestrator, and emit resume lifecycle events.
- `packages/engine/src/worktree-ops.ts` or `packages/engine/src/worktree-manager.ts` — handle an already-registered plan worktree path during resume without resetting preserved work.
- `test/orchestration-logic.test.ts` — add focused tests for seeded `merged` dependencies, failed-to-pending reset, blocked-to-pending reset, and completed-but-unmerged conservative behavior.

## Verification

- [ ] Missing `eforge/<setName>` branch produces a `build:resume:ineligible` event with a reason containing the branch name.
- [ ] Missing `orchestration.yaml` produces a `build:resume:ineligible` event with the checked artifact path.
- [ ] Missing monitor DB and missing sidecar evidence produce a `build:resume:ineligible` event mentioning failed-run evidence.
- [ ] A graph with one merged dependency, one failed plan, and one blocked dependent seeds statuses as `merged`, `pending`, and `pending`.
- [ ] A completed plan without merge-complete evidence seeds as `pending`.
- [ ] A pending dependent whose dependency is seeded `merged` emits `plan:schedule:ready` without rerunning the dependency.
- [ ] Resume invokes the original failed plan markdown file from compiled artifacts instead of a regenerated plan file.
- [ ] The resumed plan scheduling preserves the dependency order encoded in the existing `orchestration.yaml`.
- [ ] Resume context text passed to the builder contains the terminal failure message, feature branch, and diff-stat or changed-file evidence.
- [ ] A successful resume leaves failed PRD and recovery sidecar files in place unless an explicit cleanup policy is invoked.
- [ ] The engine resume path emits no compile-phase events and no planner/module-planner agent events.
- [ ] `pnpm vitest run test/resume-compiled-build-engine.test.ts test/orchestration-logic.test.ts packages/client/src/__tests__/events-schemas.test.ts packages/client/src/__tests__/events-wire-parity.test.ts` exits 0.
