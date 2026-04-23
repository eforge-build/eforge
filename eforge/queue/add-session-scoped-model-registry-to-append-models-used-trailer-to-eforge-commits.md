---
title: Add session-scoped model registry to append Models-Used trailer to eforge commits
created: 2026-04-23
---

# Add session-scoped model registry to append Models-Used trailer to eforge commits

## Problem / Motivation

The eforge engine emits `agent:start` events for every agent invocation, carrying `model: string` and `backend: string`, and `agent:result` events carry per-model usage via `modelUsage: Record<string, {...}>`. All engine-level commits go through `forgeCommit()` in `packages/engine/src/git.ts`, which appends `Co-Authored-By: forged-by-eforge`. However, commits currently do not record which models were used to produce the work, losing provenance information that is valuable for traceability.

Commit sites identified:
1. **Plan squash merges** (`worktree-manager.ts:mergePlan` → `mergeWorktree` → `forgeCommit`) — per-plan code merges to feature branch
2. **Final feature branch merge** (`orchestrator/phases.ts:finalize` → `mergeFeatureBranchToBase`) — lands on baseBranch
3. **Conflict-resolution commits** — reuseMessage path preserves existing message
4. **Compile-phase commits** (`eforge.ts:compile` → `forgeCommit` for planning artifacts)
5. **Chore commits** (`runBuildPipeline` post-parallel-group auto-commit)
6. **Administrative commits** (enqueue, cleanup, plan artifacts, queue moves)

The engine is stateless between phases. `EforgeState` persists plan/worktree lifecycle, not usage metadata. `PhaseContext` carries orchestration state. `PipelineContext`/`BuildStageContext` carry pipeline execution state.

## Goal

Add a session-scoped model registry that accumulates unique model IDs from `agent:start` events and appends a `Models-Used: <model-id>, <model-id>` trailer to all eforge commit messages (before the existing `ATTRIBUTION` trailer), so commits carry provenance of which models produced the work.

## Approach

Introduce a passive `ModelTracker` accumulator that threads through existing context objects:

- Create `ModelTracker` class for accumulating unique model IDs from `agent:start` events.
- Thread `ModelTracker` through `PhaseContext` (orchestrator-level, shared across all plans + validation + PRD validation + gap closing).
- Thread `ModelTracker` through `PipelineContext` (compile-phase tracking).
- Thread per-plan `ModelTracker` through to `WorktreeManager.mergePlan()` for squash-merge commit messages.
- Append `Models-Used: <model-id>, <model-id>` trailer to commit messages before `ATTRIBUTION`.
- Include models from: compile agents, build agents, validation fixer, merge conflict resolver, PRD validator, gap closer.
- Include in all commit types: plan merges, final merge, compile artifacts, chore commits, admin commits.

### Design Decisions

1. **No backend prefix in trailer** — Use `model-id` only (e.g., `claude-opus-4-5`, not `claude-sdk/claude-opus-4-5`). Rationale: model IDs are globally unique in practice; backend prefix adds noise.
2. **Lexicographic sort in trailer** — `Array.from(this.models).sort()`. Rationale: deterministic output, no strong preference from user.
3. **Single `Models-Used:` trailer, not per-model `Co-Authored-By`** — Rationale: models are tools, not authors. Clean separation between attribution (who orchestrated) and provenance (what was used).
4. **In-memory only, no persistence** — Rationale: model list is ephemeral session metadata. If a build resumes mid-session, the tracker re-accumulates from fresh agent runs. No need to persist partial state.
5. **Accumulate from `agent:start` events, not `agent:result`** — Rationale: `agent:start` is emitted at invocation time and always carries the resolved model. `agent:result` may be absent on failures, and its `modelUsage` is per-model cost data (more complex to extract the primary model from).
6. **Per-plan + shared trackers** — Each plan gets its own tracker for the squash-merge commit, while the shared `PhaseContext.modelTracker` accumulates everything for the final merge. Rationale: plan commits should only list models used for that plan's work, not unrelated plans.

### Architecture Impact

No architecture impact. This operates within existing boundaries:
- `ModelTracker` is a passive accumulator (no side effects, no I/O).
- It threads through existing context objects without changing their lifecycle.
- No new contracts between components.
- No changes to event stream shape or public API.

The only subtle point: `PhaseContext` becomes slightly more stateful, but this is orchestration-local state that doesn't persist.

### Code Impact

**New file**
- `packages/engine/src/model-tracker.ts` — `ModelTracker` class

**Modified files**
- `packages/engine/src/orchestrator/phases.ts` — `PhaseContext` interface; accumulate models in `executePlans`, `validate`, `prdValidate`; append trailer in `finalize`
- `packages/engine/src/orchestrator.ts` — instantiate `ModelTracker`, add to `PhaseContext`
- `packages/engine/src/worktree-manager.ts` — `mergePlan()` options accept `modelTracker`; build commit message with trailer
- `packages/engine/src/pipeline/types.ts` — `PipelineContext` gets `modelTracker: ModelTracker`
- `packages/engine/src/eforge.ts` — instantiate `ModelTracker` for compile pipeline; pass to `commitPlanArtifacts` and `forgeCommit` calls; thread into orchestrator options
- `packages/engine/src/pipeline/git-helpers.ts` — `commitPlanArtifacts` accepts `modelTracker`; append trailer
- `packages/engine/src/pipeline/runners.ts` — `runBuildPipeline` accepts/uses `modelTracker` for post-parallel-group commits
- `packages/engine/src/worktree-ops.ts` — `mergeWorktree` and `mergeFeatureBranchToBase` no changes needed (already accept pre-built messages)

**Test files**
- `test/model-tracker.test.ts` — new unit tests
- `test/worktree-manager.test.ts` — update `mergePlan` calls
- `test/orchestration-logic.test.ts` — update `PhaseContext` construction
- `test/validate-phase-timeout.test.ts` — update `PhaseContext` construction
- `test/prd-validate-phase.test.ts` — update `PhaseContext` construction

### Documentation Impact

- `AGENTS.md` — The "Conventions" section mentions `forgeCommit()` and attribution. Add a note about the `Models-Used:` trailer convention.
- `packages/engine/src/git.ts` header comment — Update to mention the `Models-Used:` trailer pattern.
- No other docs affected. No user-facing README changes needed (this is transparent to users).

### Profile Signal

**Excursion** — Multi-file feature touching engine core (orchestrator, worktree manager, pipeline contexts, git helpers). Not architectural, but touches enough subsystems to benefit from structured planning. No cross-cutting API changes or new subsystems.

## Scope

### In Scope
- Create `ModelTracker` class for accumulating unique model IDs from `agent:start` events
- Thread `ModelTracker` through `PhaseContext` (orchestrator-level, shared across all plans + validation + PRD validation + gap closing)
- Thread `ModelTracker` through `PipelineContext` (compile-phase tracking)
- Thread per-plan `ModelTracker` through to `WorktreeManager.mergePlan()` for squash-merge commit messages
- Append `Models-Used: <model-id>, <model-id>` trailer to commit messages before `ATTRIBUTION`
- Include models from: compile agents, build agents, validation fixer, merge conflict resolver, PRD validator, gap closer
- Include in all commit types: plan merges, final merge, compile artifacts, chore commits, admin commits

### Out of Scope
- Persisting model registry to disk (state file, event log, etc.)
- Adding model info to existing `Co-Authored-By` trailer
- Tracking per-model token counts or costs in commits (already in events/traces)
- Changing `agent:start` event shape or adding new event types
- Frontend/monitor UI changes
- CLI display changes

## Acceptance Criteria

1. A new `ModelTracker` class exists at `packages/engine/src/model-tracker.ts` that accumulates unique model IDs from `agent:start` events.
2. `ModelTracker.toTrailer()` returns `""` when empty, so commits with no captured `agent:start` events omit the `Models-Used:` trailer entirely (not an empty `Models-Used:` value).
3. When non-empty, the trailer is emitted as `Models-Used: <model-id>, <model-id>` with model IDs lexicographically sorted (`Array.from(this.models).sort()`).
4. The `Models-Used:` trailer appears in commit messages **before** the `ATTRIBUTION` (`Co-Authored-By: forged-by-eforge`) trailer.
5. Model IDs in the trailer contain no backend prefix (e.g., `claude-opus-4-5`, not `claude-sdk/claude-opus-4-5`).
6. `ModelTracker` is threaded through `PhaseContext` (orchestrator-level) and shared across all plans, validation, PRD validation, and gap closing.
7. `ModelTracker` is threaded through `PipelineContext` for compile-phase tracking.
8. A per-plan `ModelTracker` is threaded through to `WorktreeManager.mergePlan()` so each plan's squash-merge commit lists only models used for that plan's work, not unrelated plans.
9. Models from compile agents (planner, plan-reviewer, evaluator, architecture-reviewer, cohesion-reviewer, pipeline-composer) appear on the planning artifacts commit via the compile pipeline's tracker.
10. Models from build agents, validation fixer, merge conflict resolver, PRD validator, and gap closer are included in the appropriate commits.
11. The shared `PhaseContext.modelTracker` accumulates models used by `validationFixer`, `prdValidator`, and `gapCloser` (which run in the merge worktree after all plans are merged) and those models appear in the final merge commit.
12. The `Models-Used:` trailer is applied to all commit types: plan merges, final merge, compile artifacts, chore commits, and admin commits.
13. Conflict-resolution commits using the `reuseMessage: true` path continue to preserve the existing merge message (which already contains the trailer); no special handling is added.
14. Accumulation is driven by `agent:start` events, not `agent:result` events.
15. `ModelTracker` is a passive accumulator: no side effects, no I/O, no persistence to disk (state file, event log, etc.), no changes to the `agent:start` event shape, and no new event types.
16. Concurrent plans do not race: each plan has its own tracker, and the shared `PhaseContext` tracker is only written from the single-threaded event-driven loop in `executePlans`.
17. On resume mid-build, the tracker re-accumulates from fresh `agent:start` events (previously-run plans' models may not appear in the final merge — this is the accepted behavior).
18. `AGENTS.md` "Conventions" section is updated to note the `Models-Used:` trailer convention.
19. The `packages/engine/src/git.ts` header comment is updated to mention the `Models-Used:` trailer pattern.
20. No changes are made to the existing `Co-Authored-By` trailer (models are not added to it), no per-model token counts or costs are added to commits, no frontend/monitor UI changes, and no CLI display changes.
21. New unit tests exist at `test/model-tracker.test.ts`.
22. Existing tests are updated to match new signatures: `test/worktree-manager.test.ts` (update `mergePlan` calls), `test/orchestration-logic.test.ts`, `test/validate-phase-timeout.test.ts`, and `test/prd-validate-phase.test.ts` (update `PhaseContext` construction).
23. `worktree-ops.ts` (`mergeWorktree` and `mergeFeatureBranchToBase`) requires no changes, as it already accepts pre-built messages.
