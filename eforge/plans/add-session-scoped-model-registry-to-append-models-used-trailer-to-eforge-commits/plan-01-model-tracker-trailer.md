---
id: plan-01-model-tracker-trailer
name: ModelTracker and Models-Used commit trailer
depends_on: []
branch: add-session-scoped-model-registry-to-append-models-used-trailer-to-eforge-commits/model-tracker-trailer
agents:
  builder:
    effort: high
    rationale: Threads a new accumulator through several tightly coupled context
      types (PhaseContext, PipelineContext, mergePlan signature) and multiple
      commit sites; requires careful coordination across ~14 files in a single
      atomic change.
  reviewer:
    effort: high
    rationale: Must verify trailer ordering (before ATTRIBUTION), per-plan vs shared
      tracker isolation, event subscription correctness, and that reuseMessage
      conflict-resolution path preserves existing trailer without duplication.
---

# ModelTracker and Models-Used commit trailer

## Architecture Context

The eforge engine emits `agent:start` events for every agent invocation, each carrying `model: string` and `backend: string`. All engine-level commits go through `forgeCommit()` in `packages/engine/src/git.ts`, which appends the `Co-Authored-By: forged-by-eforge` (`ATTRIBUTION`) trailer. Today, commits do not record which LLMs produced the work, losing provenance.

This plan introduces a passive `ModelTracker` accumulator that threads through existing context objects. It subscribes to `agent:start` events at the points where they are already iterated (orchestrator phase loops, pipeline runners) and records unique `model` IDs. When a commit message is built, the tracker emits a `Models-Used: <id>, <id>` trailer, sorted lexicographically, placed **before** the existing `ATTRIBUTION` trailer. If no models were captured, the trailer is omitted entirely.

Key boundaries:
- `ModelTracker` has no I/O, no persistence, no side effects — it is a pure in-memory `Set<string>` wrapper.
- The engine vs. plugin boundary is preserved (no event shape changes, no new event types).
- `forgeCommit()` in `git.ts` still receives pre-built messages; callers are responsible for composing the trailer. This keeps `git.ts` agnostic of trackers and preserves its role as a thin attribution-appending helper.
- Per-plan trackers isolate each plan's squash-merge commit; the shared `PhaseContext.modelTracker` accumulates everything (including validation, PRD validation, gap closing, merge-conflict resolver) for the final base-branch merge.

## Implementation

### Overview

1. Create `ModelTracker` class with `record(modelId)`, `toTrailer()`, `merge(other)`, and `size` surface.
2. Thread a compile-scope tracker through `PipelineContext` so planning-artifact and chore commits during compile carry a `Models-Used:` trailer.
3. Thread a shared `PhaseContext.modelTracker` through the orchestrator; use it for merge-conflict-resolver runs, `validate`, `prdValidate`, and gap-closer, and include its contents in the final base-branch merge commit.
4. For each plan, instantiate a per-plan `ModelTracker` inside `executePlans`, record `agent:start` models from that plan's `planRunner` stream into both the per-plan tracker and the shared tracker, and pass it to `WorktreeManager.mergePlan()` so the squash-merge commit lists only that plan's models.
5. For admin/cleanup/enqueue/retry/prd-queue commit sites that have no tracker available, compose an empty trailer (so `Models-Used:` is omitted). No behavior change for those sites beyond keeping commit message construction consistent.
6. Update `AGENTS.md` Conventions and the `git.ts` header comment to document the new trailer.

### Key Decisions

1. **Caller-composed trailer, not tracker-aware `forgeCommit`.** `forgeCommit()` keeps its current signature. Callers build `"${message}\n\n${trailer}"` where `trailer = modelTracker.toTrailer()` (may be empty). Rationale: preserves the thin attribution layer in `git.ts`, avoids leaking tracker into 13 call sites, keeps trailer assembly next to where trackers live.
2. **Helper `composeCommitMessage(body, tracker?)`** in a new module `packages/engine/src/model-tracker.ts` (co-located with the tracker) to centralize the "append Models-Used before ATTRIBUTION is appended by forgeCommit" pattern. `forgeCommit` will continue to append `ATTRIBUTION` after the caller-supplied body; `composeCommitMessage` only prepends the `Models-Used:` trailer when non-empty. This guarantees trailer ordering: `body` → `Models-Used: ...` → `Co-Authored-By: ...`.
3. **Per-plan tracker isolation.** `executePlans` creates a `perPlanTracker = new ModelTracker()` for each plan before running `planRunner`. The plan's event stream is observed; each `agent:start` records into both `perPlanTracker` and `ctx.modelTracker`. `perPlanTracker` is passed to `worktreeManager.mergePlan(..., { modelTracker: perPlanTracker })`.
4. **Shared tracker for non-plan-scoped work.** Models from merge-conflict resolver (invoked via `MergeResolver` during `mergePlan`), `validate` phase fixer, `prdValidate` validator/fixer, and gap closer accumulate into `ctx.modelTracker` only. The final merge commit in `finalize` uses `ctx.modelTracker`.
5. **Compile-scope tracker.** `PipelineContext.modelTracker: ModelTracker` is instantiated in `eforge.ts` when building `PipelineContext` for the compile pipeline. `runCompilePipeline` records `agent:start` models into it; `commitPlanArtifacts` and the compile-phase `forgeCommit` for enqueue/initial planning artifacts consult it.
6. **Chore commit tracker.** `runBuildPipeline` already holds a `BuildStageContext` (which extends `PipelineContext`). The post-parallel-group chore commit in `pipeline/runners.ts:~210` uses `ctx.modelTracker`. Note: the build-pipeline `BuildStageContext` tracker is the **per-plan** tracker created in `executePlans` and passed through, not the compile tracker.
7. **Accumulate on `agent:start`, not `agent:result`.** Per PRD. `agent:start` carries `model: string` unconditionally; `agent:result.modelUsage` is optional on failure and encodes per-model cost data rather than the primary model.
8. **`reuseMessage: true` path unchanged.** The merge-conflict-resolution commit (via `mergeFeatureBranchToBase` with `reuseMessage: true`) re-uses `.git/MERGE_MSG`, which already contains the pre-built message (including the `Models-Used:` trailer from the caller). No special handling added; `forgeCommit` continues to append `ATTRIBUTION` only if not already present.
9. **No backend prefix.** Trailer uses bare `model` string (e.g., `claude-opus-4-5`).
10. **Deterministic, lexicographic sort.** `Array.from(this.models).sort()` inside `toTrailer()`.
11. **Empty tracker → no trailer line.** `toTrailer()` returns `""` when the set is empty; `composeCommitMessage` emits only the body unchanged when trailer is empty.
12. **No persistence.** On resume mid-build, the tracker is a fresh instance. Models from previously-run plans may not appear in the final merge commit; this is the accepted behavior per PRD AC #17.

## Scope

### In Scope
- Create `ModelTracker` class and `composeCommitMessage` helper in `packages/engine/src/model-tracker.ts`.
- Add `modelTracker: ModelTracker` to `PhaseContext` (`packages/engine/src/orchestrator/phases.ts`) and instantiate it in `orchestrator.ts` when building the context.
- Add `modelTracker: ModelTracker` to `PipelineContext` (`packages/engine/src/pipeline/types.ts`); instantiate in `eforge.ts` compile flow; inherit into `BuildStageContext` per plan (set to the per-plan tracker when the build stage runs).
- In `executePlans`, create a per-plan `ModelTracker`, subscribe to the plan's event stream, record `agent:start.model` into both the per-plan tracker and `ctx.modelTracker`.
- Pass the per-plan tracker into `worktreeManager.mergePlan()` via a new optional `modelTracker` field on its `opts` object.
- In `WorktreeManager.mergePlan()`, build the commit message using `composeCommitMessage(body, opts?.modelTracker)` so the squash-merge commit carries the plan's `Models-Used:` trailer.
- In `finalize` (orchestrator.ts), build the final-merge commit message using `composeCommitMessage(body, ctx.modelTracker)` before calling `worktreeManager.mergeToBase` / `mergeFeatureBranchToBase`.
- Subscribe to `agent:start` events emitted by `validate`, `prdValidate`, and gap-closer phase functions (or the fixer/validator agents they invoke) and record into `ctx.modelTracker`.
- For merge-conflict resolver invocations, record `agent:start` models into `ctx.modelTracker` so they land in the shared tracker used by the final merge.
- In `pipeline/runners.ts`, record `agent:start` models from compile-phase stages into `ctx.modelTracker` (compile-scope tracker); in `runBuildPipeline`, use the per-plan tracker that `executePlans` placed on `BuildStageContext` to tag the post-parallel-group chore commit.
- In `pipeline/git-helpers.ts`, update `commitPlanArtifacts` to accept an optional `modelTracker` and build the commit message via `composeCommitMessage`.
- In `eforge.ts`, build the compile-phase enqueue commit and initial planning-artifacts commit via `composeCommitMessage(body, ctx.modelTracker)` where `ctx` is the compile `PipelineContext`.
- For admin commit sites (`prd-queue.ts:287`, `prd-queue.ts:307`, `cleanup.ts:56`, `retry.ts:154`, `retry.ts:337`, `eforge.ts:913` PRD staleness revision) that run without a tracker in scope, call `composeCommitMessage(body)` (no tracker) — this is a no-op formatting pass that keeps the code path consistent and yields a body with no `Models-Used:` line.
- Update `AGENTS.md` "Conventions" section to document the `Models-Used:` trailer convention alongside the existing `forgeCommit()` / `Co-Authored-By` note.
- Update `packages/engine/src/git.ts` header JSDoc to mention the `Models-Used:` trailer pattern and reference `composeCommitMessage` in `model-tracker.ts`.
- New tests: `test/model-tracker.test.ts`.
- Update tests: `test/worktree-manager.test.ts`, `test/orchestration-logic.test.ts`, `test/validate-phase-timeout.test.ts`, `test/prd-validate-phase.test.ts`.

### Out of Scope
- Persisting model registry to disk (state file, event log, etc.).
- Adding model info to the existing `Co-Authored-By` trailer or emitting per-model `Co-Authored-By` lines.
- Tracking per-model token counts or costs in commits.
- Changing the `agent:start` event shape or adding new event types.
- Frontend/monitor UI changes.
- CLI display changes.
- Changing `worktree-ops.ts` (`mergeWorktree`, `mergeFeatureBranchToBase`) — they already accept pre-built messages and require no modification.

## Files

### Create
- `packages/engine/src/model-tracker.ts` — exports `ModelTracker` class with `record(modelId: string): void`, `has(modelId: string): boolean`, `size: number` getter, `merge(other: ModelTracker): void`, and `toTrailer(): string` (returns `""` when empty, else `"Models-Used: <id1>, <id2>"` with `Array.from(this.models).sort()`). Also exports `composeCommitMessage(body: string, tracker?: ModelTracker): string` that returns `body` unchanged when tracker is absent or empty, otherwise `${body}\n\n${tracker.toTrailer()}`. This places the `Models-Used:` trailer immediately after the commit body and before the `ATTRIBUTION` that `forgeCommit()` appends.
- `test/model-tracker.test.ts` — unit tests (see Verification).

### Modify
- `packages/engine/src/orchestrator/phases.ts` — Add `modelTracker: ModelTracker` to the `PhaseContext` interface (around lines 28–65). In `executePlans`: for each plan, create a per-plan `ModelTracker`, wrap or tee the `planRunner` event stream so each `agent:start` event calls `perPlanTracker.record(ev.model)` and `ctx.modelTracker.record(ev.model)` before yielding, and pass `{ modelTracker: perPlanTracker }` to `ctx.worktreeManager.mergePlan(...)`. In `validate` and `prdValidate`: wrap the agent event stream(s) they drive so `agent:start.model` values flow into `ctx.modelTracker`. Same for gap-closer and merge-conflict resolver invocations. No change to commit-message composition in these phases (they don't commit directly).
- `packages/engine/src/orchestrator.ts` — When constructing `PhaseContext` (around lines 164–175), instantiate `modelTracker: new ModelTracker()`. In `finalize` commit-message build (around lines 665–673), replace the raw `\n\n${ATTRIBUTION}` concatenation (if present) with `composeCommitMessage(body, ctx.modelTracker)` before passing to `worktreeManager.mergeToBase`; note that `forgeCommit` will still append `ATTRIBUTION` so remove the now-duplicate inline `${ATTRIBUTION}` from the finalize message body if it exists.
- `packages/engine/src/worktree-manager.ts` — Extend `mergePlan` `opts` parameter with `modelTracker?: ModelTracker`. Build `commitMessage` (around line 153) via `composeCommitMessage(${prefix}(${plan.id}): ${plan.name}, opts?.modelTracker)` — remove the inline `${ATTRIBUTION}` from the message body since `forgeCommit` appends it. Verify via tests that the squash-merge commit shows `Models-Used:` before `Co-Authored-By:` when a tracker is provided.
- `packages/engine/src/pipeline/types.ts` — Add `modelTracker: ModelTracker` to `PipelineContext` (required field, not optional). `BuildStageContext` inherits it via extension.
- `packages/engine/src/eforge.ts` — When constructing the compile-phase `PipelineContext` (around line 288), instantiate `modelTracker: new ModelTracker()`. For the enqueue commit (line 444) and the initial planning-artifacts `forgeCommit` (line 310), compose the message via `composeCommitMessage(body, ctx.modelTracker)`. For the orchestrator invocation, ensure the orchestrator's `PhaseContext.modelTracker` is a fresh instance (the orchestrator owns it; no sharing between compile and build orchestration). For the PRD staleness revision commit (line 913), call `composeCommitMessage(body)` (no tracker in scope).
- `packages/engine/src/pipeline/git-helpers.ts` — Update `commitPlanArtifacts` signature (lines 164–176) to accept a required or optional `modelTracker?: ModelTracker` parameter; compose message via `composeCommitMessage` before calling `forgeCommit` at line 175. Update all callers (`pipeline/runners.ts:157`) to pass `ctx.modelTracker`.
- `packages/engine/src/pipeline/runners.ts` — In `runCompilePipeline` and `runBuildPipeline`, wrap each stage's agent event stream so `agent:start.model` values are recorded into `ctx.modelTracker` (compile tracker for compile pipeline; per-plan tracker for build pipeline). For the post-parallel-group chore commit (line 210), build the message via `composeCommitMessage("chore(${ctx.planId}): post-parallel-group auto-commit", ctx.modelTracker)`.
- `packages/engine/src/prd-queue.ts` — For the two `forgeCommit` call sites (around lines 287 and 307), compose the message via `composeCommitMessage(body)` (no tracker) for consistency.
- `packages/engine/src/cleanup.ts` — For the `forgeCommit` call at line 56, compose via `composeCommitMessage(body)` (no tracker).
- `packages/engine/src/retry.ts` — For the two `forgeCommit` call sites (lines 154, 337), compose via `composeCommitMessage(body, tracker?)` where a tracker is in scope (retry runs inside a pipeline session, so the nearest `PipelineContext.modelTracker` should be threaded in if accessible; otherwise pass no tracker).
- `packages/engine/src/git.ts` — Update the file header JSDoc (lines 1–5) to note that callers typically compose their commit body via `composeCommitMessage(body, modelTracker?)` from `model-tracker.ts` to place the `Models-Used:` trailer immediately before the `ATTRIBUTION` trailer that `forgeCommit` appends. Also update the JSDoc on `forgeCommit` to mention that `message` may already contain a `Models-Used:` trailer, which is preserved as-is. No behavior change in `git.ts`.
- `AGENTS.md` — Under "Conventions", add a bullet after the existing `forgeCommit()` bullet stating that all engine commits produced during a build session also carry a `Models-Used: <model-id>, <model-id>` trailer (sorted lexicographically, no backend prefix, placed before the `Co-Authored-By: forged-by-eforge` trailer) when one or more agents were invoked. Emitted via `composeCommitMessage(body, modelTracker)` from `packages/engine/src/model-tracker.ts`.
- `test/worktree-manager.test.ts` — Update `mergePlan` call signatures where applicable to accept the new optional `modelTracker` in `opts`. Add a test case that passes a pre-populated `ModelTracker` and asserts the squash-merge commit message (inspected via `git log -1 --format=%B`) contains `Models-Used: ...` before `Co-Authored-By: forged-by-eforge`.
- `test/orchestration-logic.test.ts` — Update any helper that constructs a mock `PhaseContext` to include `modelTracker: new ModelTracker()`.
- `test/validate-phase-timeout.test.ts` — Same `PhaseContext` construction update.
- `test/prd-validate-phase.test.ts` — Same `PhaseContext` construction update.

## Verification

- [ ] `packages/engine/src/model-tracker.ts` exports a `ModelTracker` class with `record`, `has`, `merge`, `size`, and `toTrailer` members, and exports `composeCommitMessage(body, tracker?)`.
- [ ] `ModelTracker.toTrailer()` returns the empty string `""` when `size === 0`.
- [ ] When non-empty, `ModelTracker.toTrailer()` returns exactly `Models-Used: <id>, <id>` with IDs produced by `Array.from(this.models).sort()` (verified by unit test with inputs `["claude-sonnet-4-5", "claude-opus-4-5", "claude-sonnet-4-5"]` yielding `Models-Used: claude-opus-4-5, claude-sonnet-4-5`).
- [ ] `composeCommitMessage(body)` returns `body` unchanged when no tracker is provided or tracker is empty (unit test).
- [ ] `composeCommitMessage(body, tracker)` with a non-empty tracker returns `${body}\n\n${tracker.toTrailer()}` (unit test).
- [ ] `PhaseContext` (TypeScript interface) declares `modelTracker: ModelTracker` (verified by `pnpm type-check` succeeding and by reading the file).
- [ ] `PipelineContext` (TypeScript interface) declares `modelTracker: ModelTracker` (same verification).
- [ ] `WorktreeManager.mergePlan` accepts `modelTracker?: ModelTracker` in its `opts` parameter (verified by TypeScript compilation).
- [ ] Per-plan squash-merge commit message contains `Models-Used: <id>, <id>` on a line immediately followed by `Co-Authored-By: forged-by-eforge <noreply@eforge.build>` when the per-plan tracker is non-empty (integration test in `test/worktree-manager.test.ts` that inspects `git log -1 --format=%B` on the merge worktree after `mergePlan` and asserts the exact ordering).
- [ ] When the per-plan tracker is empty, the squash-merge commit message contains no `Models-Used:` line (integration test asserts absence).
- [ ] Final-merge commit built by `finalize` and executed via `mergeFeatureBranchToBase` contains `Models-Used:` before `Co-Authored-By:` when `ctx.modelTracker` is non-empty (unit test constructs a PhaseContext with a pre-populated tracker and inspects the message passed to `mergeFeatureBranchToBase`).
- [ ] `commitPlanArtifacts` (called from `pipeline/runners.ts`) produces a commit whose message contains `Models-Used:` before `Co-Authored-By:` when `ctx.modelTracker` is non-empty (unit test around `commitPlanArtifacts` signature or integration test in the compile pipeline).
- [ ] Post-parallel-group chore commit in `runBuildPipeline` includes `Models-Used:` before `Co-Authored-By:` when the per-plan tracker is non-empty (integration test or signature test).
- [ ] `reuseMessage: true` path in `forgeCommit` (invoked by `mergeFeatureBranchToBase` post-conflict) still produces a commit where the pre-existing `Models-Used:` trailer in the message body is preserved and `Co-Authored-By: forged-by-eforge` appears after it, with no duplicate trailers (test in `test/git-forge-commit.test.ts` or `test/merge-conflict-resolver.test.ts` exercising this path).
- [ ] `ModelTracker.record(modelId)` is called on every `agent:start` event observed by the orchestrator phase loops (`executePlans`, `validate`, `prdValidate`, gap closer, merge-conflict resolver) — verified by an integration-style test that pipes a synthetic stream containing three distinct `agent:start` events with `model` values `A`, `B`, `A` through the orchestrator's observation seam and asserts `ctx.modelTracker.size === 2` and `ctx.modelTracker.toTrailer() === "Models-Used: A, B"`.
- [ ] Per-plan tracker contains only models observed during that plan's build (unit test creates two sequential plan streams with distinct models and asserts each per-plan tracker contains only its own plan's models while `ctx.modelTracker` contains the union).
- [ ] `pnpm type-check` passes.
- [ ] `pnpm test` passes, including the new `test/model-tracker.test.ts` and updated `test/worktree-manager.test.ts`, `test/orchestration-logic.test.ts`, `test/validate-phase-timeout.test.ts`, `test/prd-validate-phase.test.ts`.
- [ ] `pnpm build` completes without errors.
- [ ] `AGENTS.md` "Conventions" section contains a bullet documenting the `Models-Used:` trailer (content includes: sorted lexicographically, no backend prefix, placed before `Co-Authored-By: forged-by-eforge`).
- [ ] `packages/engine/src/git.ts` file-header JSDoc mentions the `Models-Used:` trailer convention and references `composeCommitMessage` in `model-tracker.ts`.
- [ ] No changes are made to `packages/engine/src/worktree-ops.ts` (`mergeWorktree`, `mergeFeatureBranchToBase` signatures unchanged) — verified by `git diff --stat` showing no modifications to this file.
- [ ] No changes are made to the `agent:start` event shape in `packages/engine/src/events.ts` — verified by `git diff` showing no modifications to the `agent:start` interface.
- [ ] No new event types are added — verified by `git diff` on `packages/engine/src/events.ts`.
- [ ] No per-model `Co-Authored-By` lines are emitted — verified by grep for `Co-Authored-By:` usage showing only the single `ATTRIBUTION` constant.
