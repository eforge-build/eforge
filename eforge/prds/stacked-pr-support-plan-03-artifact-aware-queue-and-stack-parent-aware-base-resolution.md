---
title: Stacked PR Support — Plan 03: Artifact-Aware Queue and Stack-Parent-Aware Base Resolution
created: 2026-05-23
profile: pi-codex-5-5
---

# Stacked PR Support — Plan 03: Artifact-Aware Queue and Stack-Parent-Aware Base Resolution

## Overview and Objective

This PRD implements Plan 03 of the stacked PR feature: artifact-aware dependency readiness in the scheduler, stack-parent inference for single-dependency PRDs, and stack-aware base resolution during compile/build. Plans 04–06 (landing refactor, daemon API/monitor, consumer surfaces) are explicitly out of scope and will follow in a separate PRD after this one lands.

## What Is Already in Place

The following was implemented in a prior build session on branch `eforge/add-first-class-stacked-pr-support-with-optional-git-spice-integration`:

**Stack contracts, config, state, and events (plan-01):**
- `packages/engine/src/stacking/types.ts` — StackLayer, StackId, artifact/provider types
- `packages/engine/src/stacking/state.ts` — stack state helpers and reconciliation
- `packages/engine/src/config.ts` — stacking config schema (enablement, provider, git-spice command override, landing defaults)
- `packages/engine/src/prd-queue.ts` — PRD frontmatter extended with stack fields (stack_id, stack_parent, etc.)
- `packages/client/src/events.schemas.ts` — stack/artifact wire events added
- `packages/client/src/event-registry.ts` — stack event registry entries
- Tests: `test/stack-config.test.ts`, `test/stack-events.test.ts`, `test/stack-state.test.ts`

**Git-spice provider adapter and git primitives (plan-02):**
- `packages/engine/src/stacking/git-spice.ts` — full provider adapter
- `packages/engine/src/stacking/provider.ts` — StackProvider interface
- `packages/engine/src/stacking/index.ts` — stacking module index
- `packages/engine/src/worktree-ops.ts` — branch/ref existence helpers added
- Tests: `test/git-spice-provider.test.ts`, `test/stack-git-helpers.test.ts`

**Do not re-implement any of the above.** Read the existing code carefully before writing any new code in these files.

## Failure Context and Pre-Flight Inspection

A prior attempt at this plan failed. Commit `ef083ddc6568e6da6274fdb3fd9e28703d3bf266` on branch `worktree-agent-a0aa8a961ac1ac1ae` contains partial Plan 03 work produced by an abandoned nested Claude worktree. That worktree has been moved outside the repository to `/Users/markschaake/projects/eforge-build/claude-agent-worktrees/agent-a0aa8a961ac1ac1ae` so the main checkout remains clean. Before writing any new code:

1. Inspect the current state of `packages/engine/src/queue/scheduler.ts` and `packages/engine/src/eforge.ts` to understand what partial changes (if any) exist on the feature branch.
2. Inspect `ef083ddc6568e6da6274fdb3fd9e28703d3bf266` to understand what was attempted. Do not blindly cherry-pick — validate each change against current contracts, types, and tests before incorporating it.
3. Verify the working tree is clean before beginning.

## Implementation

### Scheduler: Artifact-Aware Dependency Readiness

Update `packages/engine/src/queue/scheduler.ts`:

- Dependency readiness must check artifact availability, not just in-memory terminal status. A dependency is satisfied when the upstream plan has `status: completed` AND an artifact branch/ref is recorded for it.
- A `failed` upstream blocks all dependents (unchanged in effect, but now also blocks because no artifact exists).
- A `skipped` upstream blocks dependents by default. Remove any existing behavior where `skipped` satisfies a dependency.
- When stacking is enabled and a queued PRD has exactly one `depends_on`, infer that dependency as `stack_parent` and record it on the plan before dispatch.
- When stacking is enabled and a queued PRD has multiple `depends_on` entries and no explicit `stack_parent`, block dispatch and emit a clear error requiring explicit `stack_parent`.

### Eforge.ts: Stack-Aware Base Resolution

Update the compile/build path in `packages/engine/src/eforge.ts`:

- Add a stack-aware base resolver. For root-layer builds (no stack_parent), use the configured trunk branch as the base (do not rely on `git rev-parse --abbrev-ref HEAD`).
- For stacked-child builds (stack_parent present), resolve the parent's artifact branch/ref and use it as the base for `createMergeWorktree`.
- If the parent artifact branch does not exist or cannot be resolved, fail early with a clear, actionable error message.
- Update `orchestration.yaml` baseBranch to reflect the resolved artifact base ref.

### Artifact Recording

After successful build validation, record the artifact branch/ref for the plan in durable state (runtime file or DB) so downstream dependents and landing can consume it. Use the helpers from `packages/engine/src/stacking/state.ts` — do not inline state mutation.

### Tests

Add or update tests in `test/`:

- **Artifact dependency readiness**: completed upstream with artifact branch recorded satisfies the dependency; completed upstream without artifact does not satisfy; failed upstream blocks; skipped upstream blocks.
- **Inferred stack parent**: single `depends_on` with stacking enabled → `stack_parent` inferred on the plan; multiple `depends_on` without explicit `stack_parent` → dispatch blocked with a clear error.
- **Base-ref resolution**: root layer uses trunk branch; stacked child uses parent artifact branch; missing parent artifact fails early with actionable guidance.
- **Update existing scheduler tests** that encoded the old `skipped`-satisfies behavior to reflect the new blocking semantics.

## Acceptance Criteria

The following criteria from the original PRD are in scope for this plan:

- Every successful queued build records an artifact branch/ref that downstream builds can use independent of landing state.
- Queue dependency semantics are artifact-based: completed upstream with artifact satisfies; failed upstream blocks; skipped upstream blocks by default.
- When stacking is enabled and a queued PRD has exactly one `depends_on`, eforge infers that dependency as `stack_parent`.
- When stacking is enabled and a queued PRD has multiple `depends_on` entries and no explicit `stack_parent`, eforge blocks dispatch with a clear error requiring explicit `stack_parent`.
- Compile/build base resolution uses parent artifact branch/ref for stacked children instead of the daemon's current repo branch.
- Existing tests updated to reflect intentionally breaking semantics: skipped dependencies no longer satisfy dependents by default.
- New tests cover: artifact dependency readiness, inferred vs explicit stack parent, base-ref resolution.
- `pnpm build`, `pnpm test`, and `pnpm type-check` all pass.

## Out of Scope

The following was completed in prior sessions and must not be re-implemented:

- Stack type contracts and StackLayer schema
- Stack config schema in `packages/engine/src/config.ts`
- Wire event definitions in `packages/client/src/events.schemas.ts`
- Git-spice provider adapter in `packages/engine/src/stacking/git-spice.ts`
- Stack provider interface in `packages/engine/src/stacking/provider.ts`
- Stack state helpers in `packages/engine/src/stacking/state.ts`
- Git branch/ref existence helpers in `packages/engine/src/worktree-ops.ts`
- Tests: stack-config, stack-events, stack-state, git-spice-provider, stack-git-helpers

The following is deferred to the next PRD (Plans 04–06):

- Artifact publication and landing refactor (`issue-pr` non-trunk aggregate removal, `pr`/`merge`/`leave` action model)
- Daemon API and monitor UI visibility for stack/artifact state
- CLI/MCP/Pi/Claude plugin consumer surface updates
- Documentation (`docs/stacking.md`, README updates, generated reference docs)
