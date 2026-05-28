---
title: Resume Failed Compiled Builds
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Resume Failed Compiled Builds

## Problem / Motivation

Eforge can recover failed PRDs only by retrying the whole PRD or enqueuing a successor PRD. For Expedition builds, compile/module planning is often the majority of the work. When a build fails after compile succeeds and some plan work is preserved on the feature branch, the current recovery paths do not resume the existing compiled `orchestration.yaml` plan graph. A normal continuation PRD creates a new plan set and can duplicate expensive planning work.

Concrete motivating example: `support-umbrella-session-plan-sets` compiled five Expedition plans, preserved branch work at `eforge/support-umbrella-session-plan-sets`, then failed during `plan-01-artifact-protocol` because of a Claude SDK socket error. The desired behavior is to resume the compiled graph at the failed/blocked/pending plans using existing plan artifacts and git state, not recompile from scratch.

Facts and evidence gathered:

- This feature is motivated by the failed `support-umbrella-session-plan-sets` build, where expensive Expedition compile artifacts already existed but the build failed during `plan-01-artifact-protocol` because of a Claude Code SDK transport error. The useful artifacts were preserved on `eforge/support-umbrella-session-plan-sets`, but a normal continuation PRD would compile a new plan set instead of resuming the original compiled module graph.
- `docs/roadmap.md` already includes **Console Workbench / Actionable build control** as planned direction: queue management, retry/recovery, validation waivers, stack sync, and build lifecycle actions from the console. A compiled-build resume primitive aligns with that roadmap item.
- `packages/engine/src/orchestrator.ts` explicitly says `initializeState()` “Always creates a new, clean state — there is no resume path.” Active build orchestration state is currently in memory only, and no `state.json` is written.
- `packages/engine/src/eforge.ts` `build(planSet)` loads `orchestration.yaml` from the merge worktree, parses plan files, constructs a fresh `Orchestrator`, and calls `orchestrator.execute(orchConfig)` without a resume snapshot or plan-status seed.
- `packages/engine/src/orchestrator/phases.ts` already has some internal lifecycle shape that can support resume semantics: `transitionPlan()` allows `failed -> pending` and `blocked -> pending`; `executePlans()` has a guard comment for the case where no plans launch “on resume.” However, there is no public resume entry point and no durable state reconstruction path feeding these transitions.
- Recovery summary code already reconstructs useful failed-build facts from monitor DB and git history. `packages/engine/src/recovery/failure-summary.ts` synthesizes `BuildFailureSummary` from monitor DB events plus the surviving `eforge/<setName>` branch. `packages/engine/src/recovery/terminal-failure-history.ts` reconstructs plan statuses, merge completions, tool-use counts, terminal failures, landing evidence, and validation evidence from `monitor.db`.
- Existing recovery actions are PRD-level, not compiled-build-level. `applyRecoveryRetry()` only moves the failed PRD from `.eforge/queue/failed/` back to the queue root; `applyRecoverySplit()` enqueues a successor PRD; `manual` is no-op. None of these reuse compiled `orchestration.yaml`/module plans as execution state.
- The queue scheduler can reset requeued PRDs from failed/blocked to pending when a PRD file reappears in the queue root, but that operates at PRD queue granularity, not at compiled plan graph granularity.
- Route and daemon API conventions require new HTTP paths and wire shapes to live in `@eforge-build/client` (`packages/client/src/routes.ts`, `packages/client/src/api/*`); daemon handlers should call typed helpers rather than inline route strings.
- Existing CLI recovery commands are `eforge recover <setName> <prdId>` and `eforge apply-recovery <prdId>` in `packages/eforge/src/cli/index.ts`. A resume command should be designed alongside these rather than duplicating recovery logic.

Evidence-backed conclusion:

- The smallest useful feature is not a general crash-persistence rewrite. It is a compiled-build resume action that reconstructs enough state from existing durable artifacts — failed PRD, monitor DB event history, git branch, merge completions, and `orchestration.yaml` — to restart failed/blocked/pending plans without rerunning compile/Expedition planning.

Material assumptions and unknowns:

- Assumption: existing merged plan commits on `eforge/<setName>` are sufficient to mark completed/merged plans as already satisfied during resume. Confidence medium; validate by inspecting worktree manager/merge events and writing tests that seed event history.
- Assumption: the first slice can support resume only for failed builds with a surviving feature branch and compiled plan artifacts. Confidence high; this narrow scope avoids requiring durable state for active/running builds.
- Unknown: whether the best user-facing operation belongs as a new `resume` command/tool or as a new recovery verdict/action. The likely answer is a new explicit resume action that can be invoked from recovery UI, CLI, and MCP/Pi surfaces.
- Unknown: how much resume context should be injected into the rerun failed plan. It likely needs prior failure message, changed files, landed commits, and validation findings, but should avoid huge diffs by using summaries.

## Goal

Add an explicit compiled-build resume operation for failed builds that reuses the original compiled `orchestration.yaml`, plan markdown files, preserved feature branch, monitor DB history, and git state to continue failed/blocked/pending plans without rerunning compile, Expedition planning, or module planning.

## Approach

Model resume as a distinct compiled-build action, not as a new PRD compile. The primary value is preserving expensive compiled plan/module artifacts and the original dependency graph.

Require durable compiled artifacts for the first slice. A resume is eligible only when `eforge/<setName>` or the merge worktree contains `eforge/plans/<setName>/orchestration.yaml` and the referenced plan markdown files. This avoids speculative reconstruction of missing plans.

Reconstruct state from monitor DB plus git rather than persisting a new state file in the first slice. Recovery code already synthesizes failure summaries from monitor DB and git, which is cheaper than a broad orchestration persistence rewrite. Future work can add durable state snapshots if needed.

Seed the orchestrator with resumed plan states. Plans with merge-complete evidence become `merged`; failed and blocked plans become `pending`; untouched plans remain `pending`; completed-but-not-merged plans are handled conservatively rather than treated as dependency-satisfied. The scheduler already starts pending plans whose dependencies are merged.

Inject resume context into rerun failed plans. Context should include prior failure message, previous branch/commit, files changed by prior attempt, known validation findings, and instruction to continue/repair rather than restart. Rerunning without context can duplicate exploration or overwrite preserved work.

Keep PRD-level recovery actions intact. Resume should be invokable from recovery UI/CLI but should not replace `retry`, `split`, `abandon`, or `manual`, because some failures are better handled by split/successor PRDs.

Prefer a narrow eligibility gate. If branch/artifacts/event history are missing or ambiguous, fail with a clear diagnostic and leave the failed PRD/sidecars untouched. Unsafe resume can be worse than manual recovery.

Emit explicit resume events only when useful to consumers. Candidate events include `build:resume:start`, `build:resume:state`, `build:resume:ineligible`, and `build:resume:complete`, defined in `@eforge-build/client` schemas. Engine emits, consumers render.

Likely implementation areas:

- `packages/engine/src/orchestrator.ts`: `initializeState()` currently always creates clean pending state and documents that there is no resume path. Add a resume-state input or separate initializer that can seed plan states from reconstructed history.
- `packages/engine/src/orchestrator/phases.ts`: scheduling already depends on `pending` plans whose dependencies are `merged`. Resume likely needs to start with selected plans as `merged` and failed/blocked plans reset to `pending`; ensure events and final validation/landing still work.
- `packages/engine/src/orchestrator/plan-lifecycle.ts`: transitions already mention `failed -> pending` and `blocked -> pending`, which should be reused rather than bypassed.
- `packages/engine/src/eforge.ts`: `build(planSet)` constructs the `Orchestrator` with fresh state. Add a `resumeBuild` entry point or `build(..., { resume })` mode that loads the existing compiled artifacts and passes resume metadata.
- `packages/engine/src/recovery/failure-summary.ts` and `packages/engine/src/recovery/terminal-failure-history.ts`: reuse existing monitor DB reconstruction helpers where possible. Avoid creating a parallel SQL/event parser for plan status and terminal failure data.
- `packages/engine/src/worktree-manager.ts` and `packages/engine/src/worktree-ops.ts`: validate how existing feature/plan worktrees are reused or cleaned. Existing comments already mention branch/worktree resume scenarios.
- `packages/client/src/events.schemas.ts`: add any new resume lifecycle events in the client schema source of truth if the operation emits wire events.
- `packages/client/src/routes.ts`, `packages/client/src/types.ts`, and `packages/client/src/api/*`: add route constants, request/response types, and typed API helpers for resume. Do not inline route strings outside `@eforge-build/client`.
- `packages/monitor/src/server.ts`: add daemon handler that validates request shape, calls the resume operation/spawns a worker, and returns a typed response.
- `packages/eforge/src/cli/index.ts`: add a CLI command near `recover` and `apply-recovery`, for example `eforge resume <prdId>` or `eforge resume-build <setName>`.
- `packages/eforge/src/cli/mcp-proxy.ts`, `eforge-plugin/`, and `packages/pi-eforge/`: expose the same user-facing capability where technically feasible and keep Pi/Claude consumer surfaces aligned.
- Tests should cover state reconstruction, route/client shape, CLI/daemon behavior, and the motivating case shape: completed/merged plan(s), one failed plan, blocked dependents, and no compile rerun.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| A useful first slice can resume only terminal failed builds, not arbitrary crashed/running builds. | Current failure case is terminal and has monitor DB, failed PRD, branch, and compiled artifacts. `orchestrator.ts` states active build state is in memory only. | high | low | Limit eligibility to failed PRDs/runs and write tests for missing/active states. | Scope could grow into durable runtime persistence and delay recovery value. |
| Monitor DB plus git history contains enough information to seed plan states for failed builds. | `failure-summary.ts` and `terminal-failure-history.ts` already reconstruct plan statuses, merge completions, terminal failures, tool use, landed commits, and diff stats. | medium | medium | Build fixtures around monitor DB events for completed/merged/failed/blocked plans and compare reconstructed state to expected seed. | Resume may rerun completed work or skip required work. |
| Marking merge-complete plans as `merged` is safe for dependency satisfaction. | `executePlans()` starts pending plans only when dependencies have status `merged`; merge-complete events indicate integration into feature branch. | high | low | Unit-test orchestrator seeded state with a merged dependency and pending dependent. | Dependents may remain blocked or rerun dependencies unnecessarily. |
| Completed-but-not-merged plans need conservative handling. | Current scheduler distinguishes `completed` and `merged`; only `merged` satisfies dependencies. | high | low | Inspect event histories and define first-slice behavior as rerun unless merge evidence exists. | Resuming could skip unmerged work if treated as satisfied incorrectly. |
| Existing feature branch can be reused for resumed builds. | `worktree-ops.ts` and `worktree-manager.ts` already contain comments and behavior for branch/worktree resume scenarios. | medium | medium | Integration test with a preexisting `eforge/<setName>` branch and compiled artifacts. | Resume may fail to create/check out worktrees or may reset preserved work. |
| Resume context can be compact enough for agent prompts. | Recovery summaries already include landed commits, diff stat, failure message, and tool-use counts. | medium | low | Create a context builder with size limits and snapshot tests. | Prompts may become too large or too vague to guide continuation. |
| A new explicit resume action is better than overloading `apply-recovery retry`. | Existing `applyRecoveryRetry()` only requeues the original PRD and would recompile; that is the behavior we want to avoid. | high | low | Confirm command/API naming during design review. | Users may confuse PRD retry with compiled-build resume. |

Profile signal:

- Recommended profile: **Excursion**.
- Rationale: this is cross-cutting but cohesive. A single planner can define the needed engine resume state reconstruction, client/daemon route, CLI/tool surface, and tests without delegated module planning. The plan should explicitly avoid an Expedition because the feature exists to prevent expensive recompilation/replanning of failed Expeditions. If implementation discovers that durable active-build crash recovery must be included, that should become a follow-on Expedition rather than expanding this first slice.

## Scope

In scope for the first slice:

- Add an explicit compiled-build resume operation for failed builds that have a surviving `eforge/<planSet>` branch and compiled plan artifacts.
- Reconstruct resume state from durable sources that already exist: failed PRD file/sidecar, monitor DB run events, `orchestration.yaml`, plan markdown files, merge/plan status events, and git history on the feature branch.
- Resume without invoking compile/planner/module-planner again.
- Mark already-merged plans as satisfied, reset failed and blocked plans to pending as appropriate, and continue the original dependency graph.
- Provide resume context to rerun failed plans so agents continue/repair preserved work rather than cold-starting.
- Expose the operation through engine API, daemon/client API, CLI, and Pi/Claude-facing tooling where feasible.
- Leave the existing recovery verdict flow intact; resume can be a new action surfaced alongside retry/split/manual.

Out of scope for the first slice:

- General crash persistence for currently running builds with no failed terminal state.
- Replacing existing PRD-level recovery verdicts.
- Recompiling or re-slicing failed Expeditions.
- Automatic semantic proof that a partially failed plan is complete; the rerun agent must validate/repair.
- Fixing the Claude SDK socket resiliency classifier; that is planned separately.
- Complex UI workflow beyond basic daemon/API/CLI/tool support and enough metadata for Console follow-up.

## Acceptance Criteria

- A failed compiled build can be resumed without invoking the compile pipeline.
- Resume eligibility fails with a clear diagnostic when `orchestration.yaml` is missing.
- Resume eligibility fails with a clear diagnostic when the feature branch `eforge/<setName>` is missing.
- Resume eligibility fails with a clear diagnostic when no failed build run can be reconstructed from monitor DB or sidecar evidence.
- Resume reconstructs merged plans from prior merge-complete evidence.
- Resume treats merged dependency plans as dependency-satisfied before scheduling pending dependents.
- Resume resets failed plans to pending before scheduling.
- Resume resets blocked plans to pending when their dependencies are satisfied or will be satisfied by the resumed graph.
- Resume does not mark completed-but-unmerged plans as dependency-satisfied unless merge evidence exists.
- Resume reruns the original failed plan using the original plan markdown file.
- Resume preserves the original `orchestration.yaml` plan graph and dependency order.
- Resume emits a machine-readable event or response containing the reconstructed state summary.
- Resume context passed to rerun agents includes the prior terminal failure message.
- Resume context passed to rerun agents includes the preserved feature branch name.
- Resume context passed to rerun agents includes prior changed-file or diff-stat evidence when available.
- The failed PRD and recovery sidecars remain available until resume succeeds or an explicit cleanup policy runs.
- `@eforge-build/client` owns any new resume route constants.
- `@eforge-build/client` owns any new resume request and response types.
- `@eforge-build/client` exports a typed resume API helper.
- The daemon exposes a resume endpoint that uses the client route constant.
- The CLI exposes a resume command for failed compiled builds.
- The Pi consumer-facing tool surface exposes the resume capability where technically feasible.
- The Claude Code consumer-facing tool surface exposes the resume capability where technically feasible.
- Tests prove resume does not call compile when compiled artifacts already exist.
- Tests cover a graph with one merged plan, one failed plan, and blocked dependents.
- Tests cover missing branch ineligibility.
- Tests cover missing orchestration artifact ineligibility.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- Targeted tests for changed packages exit 0.
