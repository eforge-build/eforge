---
title: Model Compiled-Build Resume as a Queued PRD Mode
created: 2026-06-03
landing: pr
landing_auto_merge: true
---

# Model Compiled-Build Resume as a Queued PRD Mode

## Problem / Motivation

Compiled-build resume currently bypasses queue scheduling by spawning an immediate daemon worker. This prevents resume dispatch from being inspectable, scheduler-owned, queue-native, and subject to existing queue controls such as parallelism, pause/resume behavior, profile routing, policy gates, session profile events, and child lifecycle management.

This work item comes from backlog item `backlog-2026-06-02-model-compiled-build-resume-as-a-queued-prd-mode`.

Evidence gathered:

- `docs/roadmap.md` lists “Typed recovery paths” under Kernel Resilience and “Actionable build control” under Console Observability.
- This change fits those goals by making resume dispatch inspectable, scheduler-owned, and queue-native.
- `AGENTS.md` requires daemon/client route constants from `@eforge-build/client`.
- `AGENTS.md` requires engine commits via helpers.
- `AGENTS.md` requires maintaining Pi/Claude plugin parity for consumer-facing behavior.
- `AGENTS.md` treats `.eforge/` as runtime state.
- `packages/monitor/src/routes/resume.ts` handles `POST API_ROUTES.resumeBuild` by spawning a direct `resume` worker through `workerTracker.spawnWorker('resume', ...)`.
- `packages/monitor/src/routes/resume-service.ts` accepts `prdId`, optional `setName`, and optional `profile`, validating the profile only when explicitly supplied.
- `packages/eforge/src/cli/index.ts` has `eforge resume <prdId> --profile <name>`, creates `EforgeEngine` with `profileOverride` only when the CLI option is present, then calls `engine.resumeBuild(...)`.
- `packages/engine/src/eforge.ts` `resumeBuild()` reconstructs compiled artifacts and seeds the shared `Orchestrator`, but it bypasses compile/planning and does not construct/pass `prdValidator`, `gapCloser`, `expectedAcceptanceCriteria`, or `cleanupPrdFilePath`.
- `packages/engine/src/queue/resume-cascade.ts` already moves a failed PRD into the root queue during direct resume and moves skipped descendants to waiting, then finalizes or rolls back on resume completion/failure.
- Existing queue cascade support is useful but currently lives inside direct resume rather than scheduler dispatch.
- `packages/engine/src/prd-queue.ts` `enqueuePrd()` writes frontmatter fields including `profile`, `landing`, `landing_auto_merge`, stacking fields, and recovery continuation fields.
- `packages/engine/src/queue/scheduler.ts` routes profile when no explicit `profile` is present, persists routed profile via `setQueuedPrdProfile()`, emits `session:profile`, and spawns queue exec with `--profile` when `frontmatter.profile` exists.
- `packages/monitor/src/routes/enqueue-service.ts` uses `normalizeBuildSource()` to discover `agent_profile` and passes it as `--profile` when no explicit profile was provided.
- `.eforge/queue/failed/add-plan-set-mutation-workflows-and-safe-build-handoff.md` contains `profile: gpt-claude-combo`, showing failed PRDs can carry the original selected profile.
- Other failed PRDs have no explicit `profile`, meaning they intentionally fall back to active/profile-router semantics.

Conclusion: the main gap is not missing metadata support generally; it is that compiled-build resume uses a direct worker route that does not let the queue scheduler own dispatch and does not automatically reuse failed PRD frontmatter metadata such as `profile`, `landing`, or PRD body/provenance for validation.

## Goal

Implement compiled-build resume as a scheduler-owned queued PRD mode instead of an immediate daemon worker. Resume requests should requeue eligible failed PRDs with explicit resume metadata, preserve original PRD metadata, and run resume through the same scheduler and validation paths used by normal queued builds where applicable.

## Approach

### Architecture impact

Current architecture:

- Resume API route: `POST API_ROUTES.resumeBuild` in `packages/monitor/src/routes/resume.ts` spawns a `resume` worker immediately.
- CLI resume worker: `packages/eforge/src/cli/index.ts` `resume <prdId>` creates an engine with optional `profileOverride` and calls `engine.resumeBuild()`.
- Engine resume: `packages/engine/src/eforge.ts` `resumeBuild()` performs eligibility, begins queue cascade, reconstructs artifacts, then calls the shared `Orchestrator` with `resumeSeed`.
- Queue scheduler: `packages/engine/src/queue/scheduler.ts` owns parallelism, profile routing, policy gates, session profile events, child spawning, and normal terminal queue transitions.

Target architecture:

- Resume request becomes a queue mutation: the failed PRD is requeued with explicit resume frontmatter instead of immediately spawning a resume worker.
- Scheduler dispatch remains the single owner of parallelism, pause/resume behavior, queue dispatch policy gates, profile routing, session profile emission, and child lifecycle.
- Queue exec detects resume frontmatter and invokes the compiled-build resume execution path for that PRD.
- The resume execution path receives queued PRD file path/content so it can construct `prdValidator`, `gapCloser`, and `expectedAcceptanceCriteria` like normal PRD builds.
- Existing `beginQueuedResume`, `finalizeQueuedResumeSuccess`, and `rollbackQueuedResume` logic should be refactored or reused so queue transitions do not happen twice.
- The queue-owned design likely moves the begin transition to the daemon route and terminal transition handling to scheduler/child finalization.
- Daemon route response may become enqueue-like (`id`, maybe current queue status) or retain `ResumeBuildResponse` shape only if worker spawning remains possible.
- Any route-contract change must live in `@eforge-build/client`.

Boundary notes:

- This remains engine/daemon work because scheduling, queue mutation, and build execution are already engine/daemon responsibilities.
- Consumer integrations should stay thin: Pi/Claude tools call the daemon route and render returned status.
- Consumer integrations should not implement resume queue mutation locally.
- Route constants and request/response types must remain in `packages/client`.

### Design decisions

1. Use explicit resume frontmatter rather than inferring resume mode from queue location.

Rationale: a failed PRD can be requeued for normal retry or for compiled-build resume; queue location alone is ambiguous. Explicit metadata makes the scheduler’s decision inspectable and testable.

Suggested flat frontmatter shape:

```yaml
resume_mode: compiled
resume_from: <original-prd-id>
resume_set_name: <set-name>
resume_feature_branch: eforge/<set-name>
resume_base_branch: <base-branch>
```

Use flat keys because `parseFrontmatter()` in `packages/engine/src/prd-queue.ts` is a simple key-value parser and existing queue fields are flat.

2. Preserve original PRD metadata during requeue.

Rationale: current normal queue dispatch already knows how to honor `profile`, `landing`, `landing_auto_merge`, `depends_on`, and stack metadata. The resume mutation should not throw that information away. Failed PRDs with `profile:` already exist locally, for example `.eforge/queue/failed/add-plan-set-mutation-workflows-and-safe-build-handoff.md` has `profile: gpt-claude-combo`.

3. Make scheduler dispatch the resume, not the resume route.

Rationale: scheduler dispatch owns parallelism, pause/resume, profile routing, policy gates, session profile events, and child lifecycle. Direct `workerTracker.spawnWorker('resume', ...)` bypasses those controls.

4. Split queue-transition responsibilities to avoid double transitions.

Rationale: `resumeBuild()` currently calls `beginQueuedResume()` and finalizes/rolls back itself. In queue-owned resume, route-level code should perform the initial failed-to-queued marker/move, while scheduler/child terminal handling should finalize or roll back. The implementation should avoid calling the same transition twice.

5. Treat PRD content as required validation input for queued resume.

Rationale: compiled artifacts (`orchestration.yaml` and plan markdown) are enough to build pending plans, but they are not enough to run PRD validation. The queued resume path should pass PRD content to the same validator/gap-closer setup used by normal `build()`.

Preferred source order for PRD content:

- Requeued PRD file content, because it preserves original frontmatter and body.
- Failed queue PRD source if the route has not moved it yet.
- Committed PRD provenance artifact `eforge/prds/<setName>.md` from the feature branch tip.
- Branch-history recovery of that provenance artifact if cleanup removed it from the tip.

6. Keep compile/planning skipped for compiled-build resume.

Rationale: the resume feature is specifically for failed builds after compile. Re-running compile would discard useful prior planning artifacts and change the meaning of resume.

7. Update route contracts deliberately.

Rationale: if `POST /api/recover/resume-build` no longer starts a worker immediately, `{ sessionId, pid }` is misleading. Prefer an explicit queued response such as `{ kind: 'queued', prdId, setName }`, with `DAEMON_API_VERSION` bumped if this is a breaking wire change. If compatibility is required, return a union with `kind: 'spawned' | 'queued'`.

8. Prefer extracting shared PRD validation wiring over duplicating code in `eforge.ts`.

Rationale: `packages/engine/src/eforge.ts` is large. Shared helpers for PRD content resolution, expected acceptance criteria extraction, validator closure construction, and gap closer construction reduce risk and comply with maintainability policy.

### Code impact

Likely implementation targets:

- `packages/engine/src/prd-queue.ts`
  - Extend `prdFrontmatterSchema`, `PrdFrontmatter`, and helper types or add a focused helper for resume metadata.
  - Add helper(s) to mark a failed PRD as compiled-resume mode while preserving existing metadata.
  - Use flat frontmatter fields compatible with the existing simple parser, e.g. `resume_mode: compiled`, `resume_from`, `resume_set_name`, `resume_feature_branch`, `resume_base_branch`.

- `packages/engine/src/queue/resume-cascade.ts`
  - Refactor queue transition helpers so begin/finalize/rollback can be used by scheduler-owned resume without conflicting with direct `resumeBuild()` internals.
  - Ensure descendant reactivation uses existing waiting/skipped dependency semantics.

- `packages/engine/src/queue/scheduler.ts`
  - Detect resume frontmatter after policy/profile routing and before spawning child workers.
  - Spawn queue exec in a mode that carries the existing session id and effective profile, or pass metadata to the child via PRD frontmatter.
  - Ensure queue policy gates see the resumed PRD and its profile/dependencies.

- `packages/engine/src/eforge.ts`
  - Add or adapt queue-exec path so a queued PRD with resume metadata runs compiled-build resume instead of `compile()` + `build()`.
  - Modify `resumeBuild()` or create a narrower internal helper that accepts PRD file path/content and constructs `prdValidator`, `gapCloser`, and `expectedAcceptanceCriteria` like normal `build()`.
  - Avoid double queue transitions when the scheduler already owns the requeued PRD.

- `packages/engine/src/resume/compiled-build.ts` and `packages/engine/src/resume/resume-projection.ts`
  - Add PRD provenance/content resolution if not placed elsewhere.
  - Prefer queued/failed PRD content, then `eforge/prds/<setName>.md` at branch tip, then branch history recovery.

- `packages/monitor/src/routes/resume.ts` and `packages/monitor/src/routes/resume-service.ts`
  - Change `resumeBuild` route from direct worker spawn to queue mutation/notification, or introduce a staged migration path with compatible response behavior.
  - Validate explicit profile only when overriding; otherwise preserve original frontmatter profile.

- `packages/client/src/api/resume-build.ts`, `packages/client/src/routes.ts`, and response types
  - Update route contract if `ResumeBuildResponse` changes from `{ sessionId, pid }` to enqueue-like metadata.

- `packages/pi-eforge/extensions/eforge/index.ts` and Claude plugin/MCP surfaces
  - Keep resume tool descriptions and behavior in sync if the route no longer starts an immediate worker.

- Tests
  - Existing route/recovery tests under `packages/monitor/src/__tests__` and engine queue tests should be extended.
  - Add focused tests for failed PRD frontmatter profile preservation and PRD validation on resume.

Evidence:

- Current direct resume worker path is in `packages/monitor/src/routes/resume.ts`.
- Current resume CLI path is in `packages/eforge/src/cli/index.ts`.
- Current queue dispatch profile behavior is in `packages/engine/src/queue/scheduler.ts`.
- Current frontmatter support is in `packages/engine/src/prd-queue.ts`.

### Documentation impact

Documentation and user-facing text likely affected:

- Pi eforge resume tool description in `packages/pi-eforge/extensions/eforge/index.ts` should stop saying the tool always spawns a background build agent if the route becomes queued.
- Claude Code plugin/MCP resume tool docs should stay in parity with Pi.
- Public/README docs that mention compiled-build resume should describe scheduler-owned behavior, profile preservation, and that resume waits behind queue parallelism.
- Console UI resume dialog copy may need to say the resume was queued rather than started immediately.
- API/reference docs generated from `@eforge-build/client` may need regeneration if `ResumeBuildResponse` changes.
- The backlog item `backlog-2026-06-02-model-compiled-build-resume-as-a-queued-prd-mode` can be marked shipped after implementation evidence exists.

### Risks

- Queue transition regression: moving begin/finalize/rollback responsibilities can strand PRDs in `queue/`, `failed/`, `waiting/`, or `skipped/` if terminal handling is not exact.
- Double-transition risk: leaving `beginQueuedResume()` inside `resumeBuild()` while also marking the PRD in the route/scheduler could produce missing-file or duplicate-target failures.
- API compatibility risk: callers currently expect `eforge_resume_build` to return `{ sessionId, pid }`. A queued response requires Pi, Claude plugin, console UI, and tests to be updated together.
- Profile regression: failed PRDs without `profile:` should continue to use active profile/profile-router semantics; failed PRDs with `profile:` must use that profile automatically unless the resume caller explicitly overrides it.
- PRD validation regression: if the queued resume path only reads compiled artifacts, it will continue to skip `prd_validation:*` and `acceptance_validation:*` events.
- Cleanup/provenance edge case: the PRD provenance artifact may be removed at branch tip by cleanup; branch-history lookup must handle this like orchestration artifact recovery does.
- Stacked PR edge cases: resume metadata must preserve or correctly derive stack fields so stack landing/recovery behavior is not broken.
- Concurrency/race risk: route-level requeue must handle locks and existing files atomically enough that two resume requests cannot both requeue the same failed PRD.
- Large-file edit risk: `eforge.ts` and queue scheduler are large; implementation should use bounded exact edits and extract helpers to new files where possible.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Failed PRDs are available as files in `.eforge/queue/failed/` when resume is requested. | Local `.eforge/queue/failed/*.md` files exist; `beginQueuedResume()` explicitly looks up `snapshot.failed.find((prd) => prd.id === options.prdId)`. | high | low | Unit-test missing failed PRD returns ineligible/noop and existing failed PRD is requeued. | Resume route may need a fallback for PRDs no longer present in failed queue. |
| Failed PRD frontmatter can preserve the originally selected profile. | Local failed PRD `add-plan-set-mutation-workflows-and-safe-build-handoff.md` contains `profile: gpt-claude-combo`; `enqueuePrd()` writes `profile`; scheduler honors `frontmatter.profile`. | high | low | Add fixture/unit test for requeue preserving `profile` and queue exec using it. | Resume may continue to run with the wrong/default profile. |
| The PRD provenance artifact usually exists on the feature branch after build starts. | `materializePrdArtifact()` writes `eforge/prds/{prdId}.md` and commits it early in normal build; cleanup may later remove it. | high | low | Add branch-history fixture test resolving PRD content after cleanup deletion. | PRD validation may be impossible for resumed builds after cleanup. |
| Queue-owned resume can reuse existing compiled artifact recovery. | `checkResumeEligibility()` already recovers `orchestration.yaml` from merge worktree or branch history. | high | low | Unit-test queued resume calls the same eligibility path. | New queued mode could duplicate artifact recovery incorrectly. |
| Route response can change safely if client types and integrations are updated together. | API shapes are centralized in `@eforge-build/client`, but Pi tool currently returns `{ sessionId, pid }`. | medium | medium | Inspect/update client route types, Pi extension, Claude plugin, console UI, and tests in same PR. | Existing callers may break or display misleading status. |
| Scheduler terminal handling can replace direct `resumeBuild()` queue finalization without losing dependent reactivation. | Existing `finalizeQueuedResumeSuccess()` and `rollbackQueuedResume()` already encode desired descendant transitions. | medium | medium | Add integration tests for success and failure with skipped descendants. | Dependents could remain skipped/waiting incorrectly. |
| Stacked PR resume metadata can be preserved by copying existing frontmatter fields. | `enqueuePrd()` and `PrdFrontmatter` include stack fields; scheduler has stacking validation after profile routing. | medium | medium | Add test with `stack_parent`/`stack_provider` on failed resumed PRD. | Stacked resume could land against wrong base or lose stack topology. |

No low-confidence/high-impact assumption is being accepted without a validation path. The highest-risk assumptions are queue terminal handling and route response migration; both have concrete integration-test paths.

### Profile signal

Recommended eforge planning profile: `excursion`.

Rationale:

- This is cross-cutting engine/daemon/client/integration work, but it is a cohesive architecture change with clear implementation targets.
- A single planner can enumerate the needed queue, resume, route, client, and integration changes without delegating independent module planning.
- Expedition is not necessary because the work does not require independently planned submodules or architecture subplanning; it requires careful sequencing and tests within known boundaries.
- Errand is too small because the change affects queue semantics, daemon API behavior, PRD validation wiring, and user-facing tool descriptions.

## Scope

In scope:

- Add durable PRD frontmatter metadata for compiled-build resume, with enough fields to identify the original failed PRD, set name, feature branch, and base branch/artifact context.
- Change the daemon/tool resume request from immediate worker spawn to requeue/mark the failed PRD as a queued resume item and notify the scheduler where feasible.
- Make queue execution detect the resume marker and run compiled-build resume instead of normal compile + build.
- Preserve and reuse original queued PRD metadata during resume, especially `profile`, `landing`, `landing_auto_merge`, `depends_on`, and stack metadata where applicable.
- Ensure resumed builds run the same PRD validation and acceptance validation path as normal PRD builds by rehydrating original PRD content from the requeued PRD file, committed PRD provenance artifact (`eforge/prds/<setName>.md`), branch history, or failed queue source.
- Preserve existing resume eligibility checks for feature branch presence, compiled artifacts, and failure evidence.
- Preserve existing queue-dependent reactivation semantics: skipped descendants should reactivate only through normal dependency rules after the resumed parent succeeds.
- Update Pi and Claude Code consumer-facing surfaces if command/tool behavior changes.
- Add tests covering frontmatter parsing, queue dispatch, metadata preservation, profile reuse, PRD validation wiring, and direct API behavior.

Out of scope:

- Re-running compile/planning for compiled-build resume.
- Replacing recovery split/abandon/retry verdicts.
- Changing normal PRD enqueue semantics unrelated to resume.
- Adding new stack providers or changing git-spice semantics beyond preserving resume metadata.
- Full console UI redesign; existing resume controls can call the updated daemon route/API.

## Acceptance Criteria

- `POST ${API_ROUTES.resumeBuild}` requeues or marks an eligible failed PRD as compiled-resume mode instead of spawning an immediate `resume` worker.
- A queued PRD with compiled-resume frontmatter is dispatched by the queue scheduler subject to configured `maxConcurrentBuilds` parallelism.
- A queued PRD with compiled-resume frontmatter runs compiled-build resume without invoking compile or planner stages.
- A resumed PRD that originally contains `profile: <name>` emits `session:profile` with that profile when no explicit resume profile override is supplied.
- A resumed PRD without `profile:` continues to use existing active-profile or profile-router fallback behavior.
- An explicit resume profile override takes precedence over the failed PRD frontmatter profile and is validated before dispatch.
- Resume requeue preserves `landing`, `landing_auto_merge`, `depends_on`, and stack frontmatter fields from the failed PRD file.
- Resume requeue writes explicit compiled-resume frontmatter fields that identify the source PRD id, set name, feature branch, and base branch.
- Queue dispatch policy gates receive the resumed PRD id, title, profile, and dependencies before the resumed build starts.
- A resumed build runs post-merge validation commands after all pending plans are merged.
- A resumed build emits `prd_validation:start` after post-merge validation passes.
- A resumed build emits `prd_validation:complete` after post-merge validation passes.
- A resumed build emits `acceptance_validation:complete` after PRD validation runs.
- PRD validation for a resumed build uses the requeued PRD body when the failed PRD file is available.
- PRD validation for a resumed build can recover `eforge/prds/<setName>.md` from branch history when the provenance artifact is absent from the feature branch tip.
- A successful queued resume records a usable artifact completion for the resumed PRD.
- A successful queued resume unblocks waiting descendants only through existing dependency semantics.
- A failed queued resume rolls the parent PRD back to `failed/`.
- A failed queued resume keeps dependent PRDs blocked or skipped according to existing queue recovery semantics.
- `eforge_resume_build` describes queued resume behavior accurately.
- The matching Claude Code plugin tool describes queued resume behavior accurately.
- Client route types compile after any `ResumeBuildResponse` shape change.
- Tests compile after any `ResumeBuildResponse` shape change.
- Tests cover frontmatter parsing for compiled-build resume metadata.
- Tests cover queue dispatch for queued compiled-build resume.
- Tests cover metadata preservation during resume requeue.
- Tests cover profile reuse for failed PRD frontmatter.
- Tests cover PRD validation wiring for queued compiled-build resume.
- Tests cover direct API behavior for resume requeue.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0 for the affected package tests.
- `pnpm maintainability:check` exits 0.