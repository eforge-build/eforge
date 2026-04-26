---
id: plan-01-sharded-implement
name: Sharded implement stage with stash-based per-shard retry
branch: sharded-implement-for-mechanical-refactors/sharded-implement
agents:
  builder:
    effort: xhigh
    rationale: Large refactor introducing parallelism into the implement stage with
      coordinator phase, stash-based checkpoint mechanism, and scope enforcement
      — touches builder agent, build-stages pipeline, retry policy, and config
      schema together. High coordination complexity across files.
  reviewer:
    effort: high
    rationale: Concurrency + git state machine (stash push/pop, staged/unstaged
      transitions, scope enforcement) needs careful review for race conditions,
      ordering bugs, and missed edge cases.
---

# Sharded implement stage with stash-based per-shard retry

## Architecture Context

Today the `implement` stage runs a single `builderImplement` call with optional retry/continuation (commit-based WIP checkpoints). For large mechanical refactors (e.g. rename a type across 30+ files), one builder thread serially burns its 80-turn budget, checkpoints, and re-enters — wall-clock cost is dominated by single-thread iteration.

This plan adds optional `shards` to the resolved builder config. When the planner emits `shards`, the `implement` stage fans out to N parallel `builderImplement` calls (each with a scope notice), then runs a coordinator phase that performs verification, scope enforcement, and a single commit. Absence of `shards` preserves today's behavior bit-for-bit.

**Key invariants preserved:**
- One commit per plan (coordinator commit, not per-shard).
- No new agent role, no new pipeline stage, no harness-specific prompt language.
- Region marker infrastructure for shared files is orthogonal and untouched.
- Single-builder retry policy (commit-based WIP checkpoint via `buildBuilderContinuationInput` in `packages/engine/src/retry.ts:322`) is unchanged. Sharded mode uses a parallel **stash-based** mechanism so concurrent shards don't fight over the index/HEAD.

**Reused without modification:**
- `runParallel` from `packages/engine/src/concurrency.ts:127` for fan-out.
- `withRetry` from `packages/engine/src/retry.ts:583` per-shard.
- `forgeCommit` from `packages/engine/src/git.ts:110` for the coordinator commit.
- Existing `formatBuilderParallelNotice` pattern in `packages/engine/src/agents/builder.ts:50` as the model for the new shard scope notice.

## Implementation

### Overview

1. Extend the per-role builder config in `packages/engine/src/config.ts` with an optional `shards` array (validated: at least one of `roots`/`files` per shard, unique `id`s within a plan).
2. Add `shardScope` to `BuilderOptions` in `packages/engine/src/agents/builder.ts`. When set, `builderImplement` injects a per-shard scope notice into the prompt and replaces verification/commit instructions with a one-liner deferring those to the coordinator.
3. Rewrite the `implement` stage in `packages/engine/src/pipeline/stages/build-stages.ts` to detect `shards` and either: run today's single-builder flow (no shards) or run N shards in parallel via `runParallel`, then execute a coordinator phase (pop stashes → verify → enforce scope → single `forgeCommit`).
4. Add a stash-based continuation builder for the shard-mode retry policy in `packages/engine/src/retry.ts` alongside the existing commit-based one. Each shard gets its own retry budget (4 attempts × `maxTurns`).
5. Update `packages/engine/src/prompts/builder.md` with a `{{shardScope}}` injection point and conditional rendering for the verification/commit sections.
6. Update `packages/engine/src/prompts/planner.md` to add sharding judgment guidance for mechanical-refactor PRDs.

### Key Decisions

1. **Stash-based per-shard checkpoints (not commits).** Concurrent shards cannot all create commits — they would race on HEAD. Each shard, on `error_max_turns`, runs `git stash push --keep-index -m "eforge-shard-<id>-attempt-<N>"` over its scope's working-tree changes (not staged), and the continuation context references the stash diff. Successful shards leave their changes staged; the coordinator pops failed-shard stashes back into the index before the final commit. **Rationale:** preserves "one commit per plan," supports per-shard retry without HEAD contention, lets the coordinator validate the full set of staged changes atomically.
2. **Scope enforcement runs after all shards stage their changes.** A new helper `enforceShardScope(stagedFiles, shards)` in `packages/engine/src/pipeline/stages/build-stages.ts` matches each staged file path against shard `roots` (using `picomatch`-style globs already available in the codebase, or `minimatch` if needed — check existing dependencies first; otherwise simple `path.startsWith(root)` suffices since `roots` are directory globs) and explicit `files`. **Failure modes:** zero claimants (out-of-scope edit) or multiple claimants (overlap) → fail the stage with a clear error message listing the offending files. **Rationale:** the PRD explicitly calls for this as a sanity check; it gives a clean failure mode when the planner emits overlapping shards.
3. **Coordinator phase runs verification once, after all shards finish.** Verification commands today are interpolated into the builder prompt as `VERIFICATION_FULL` / `VERIFICATION_BUILD_ONLY`. In shard mode, the builder prompt's verification section is replaced with: "Verification will run once after all shards finish; do not run it yourself." The coordinator parses the plan's "Verification" section commands and executes them via `execFile`, similar to how the orchestrator runs post-merge validation. **Rationale:** running verification N times in parallel is wasteful and verification only makes sense on the unified state.
4. **`shardScope` injected into the prompt as a single block, not a structured field.** Same pattern as `formatBuilderParallelNotice`. The notice tells the agent: your scope is `<roots>` and `<files>`, do not touch other files, use targeted `git add <file>`, do not commit, do not run verification. **Rationale:** harness-agnostic, matches the existing notice pattern, no harness-specific tool names.
5. **Per-shard retry uses the existing `withRetry` wrapper with a new continuation-input builder.** A new exported function `buildShardedBuilderContinuationInput` in `packages/engine/src/retry.ts` handles stash-push instead of WIP-commit. The existing `buildBuilderContinuationInput` is left intact for non-shard mode. **Rationale:** clean separation, no compat shim.
6. **Each shard's retry policy is independent.** A shard exhausting its 4 attempts fails the entire `implement` stage (other shards may continue running; the stage waits for all to finish before failing, so partial state can be inspected). **Rationale:** mirrors today's failure semantics — single-builder retry exhaustion fails the stage.
7. **`runParallel` parallelism is unbounded** (set via `parallelism: shards.length` so the semaphore doesn't serialize them). **Rationale:** N shards is typically 2–6; capping by `availableParallelism()` would unnecessarily serialize a wall-clock-critical path.

## Scope

### In Scope

- Optional `shards` field in the resolved builder config schema with validation.
- `BuilderOptions.shardScope` in `packages/engine/src/agents/builder.ts`.
- New `formatShardScopeNotice(shardScope)` helper in `packages/engine/src/agents/builder.ts` (sibling to `formatBuilderParallelNotice`).
- Conditional rendering of `verification_scope` and the commit section in `packages/engine/src/prompts/builder.md` based on whether `shardScope` is present.
- `implement` stage in `packages/engine/src/pipeline/stages/build-stages.ts` detects `shards`, fans out via `runParallel`, runs coordinator (pop stashes, verify, enforce scope, single `forgeCommit`).
- New helper `runVerificationCommands(plan, cwd)` extracted from the existing prompt-string verification logic into the coordinator.
- New helper `enforceShardScope(stagedFiles, shards)` for scope enforcement.
- New `buildShardedBuilderContinuationInput` continuation builder in `packages/engine/src/retry.ts` plus a new policy variant for sharded builders (e.g. `DEFAULT_RETRY_POLICIES['builder-shard']` or expose via a factory). The non-shard `DEFAULT_RETRY_POLICIES.builder` is unchanged.
- New per-shard tracing spans nested under the existing `implement` span (`ctx.tracing.createSpan('builder', { planId, phase: 'implement', shardId })`).
- `packages/engine/src/prompts/planner.md` sharding judgment guidance under the existing "Rename-and-update-all-callers" section (~line 85).
- Tests:
  - Unit tests for `formatShardScopeNotice` (notice rendering, roots-only / files-only / both).
  - Unit tests for `enforceShardScope` (zero-claimant, multi-claimant, glob match, explicit file match).
  - Unit tests for `buildShardedBuilderContinuationInput` (stash creation, stash diff capture, failure when no scope changes).
  - Integration test for the sharded `implement` stage end-to-end using `StubHarness` (multiple shards, success path, scope-violation failure, per-shard retry exhaustion).
  - Identity test confirming non-shard plans run unchanged through the modified stage.
  - Schema test for `shards` validation rules.

### Out of Scope

- New entry in `AGENT_ROLE_TIERS` or a new `refactor` agent role (PRD §Scope explicitly forbids).
- New pipeline stage (PRD §Scope: extend `implement` internals, not the stage graph).
- Harness-specific language in any prompt (PRD §Scope).
- Engine-side worktree orchestration — all shards share one worktree (PRD §Scope).
- Changing the "one commit per plan" invariant (PRD §Decisions).
- Reviewer/evaluator/test-stage modifications — they run on the coordinator commit unchanged.
- Region-marker logic for shared files within a single shard's scope (already supported via existing region infrastructure).
- Real end-to-end runs against actual large refactors (manual acceptance: §Acceptance Criteria #2/#3 — the engine surface is what this plan delivers).

## Files

### Create

- `test/sharded-builder.test.ts` — Unit tests for `formatShardScopeNotice`, `enforceShardScope`, and `buildShardedBuilderContinuationInput`. Uses inline data construction (no fixtures) per repo testing convention.
- `test/sharded-implement-stage.test.ts` — Integration test for the sharded `implement` stage using `StubHarness` from `test/stub-harness.ts`. Covers: identity (no shards → unchanged flow), success path (2 shards staging non-overlapping files), scope-violation failure, per-shard retry exhaustion. **Critical:** initialize a real git repo in a temp dir (use `mkdtemp` + `git init` + initial commit) so stash and `git diff --cached` operations have something to work against.

### Modify

- `packages/engine/src/config.ts` — Extend the per-role config schema (`roles.builder`) with optional `shards: z.array(shardScopeSchema).optional()`. Define `shardScopeSchema` with `id` (string, required), `roots` (string array, optional), `files` (string array, optional), with a `.refine()` that requires at least one of `roots`/`files`. Add a plan-level validation hook (or do it inline in `resolveAgentConfig` in `packages/engine/src/pipeline/agent-config.ts`) that asserts unique `id`s across the plan's shard list. Export `ShardScope` type.
- `packages/engine/src/agents/builder.ts` — Add `shardScope?: ShardScope` to `BuilderOptions`. Add `formatShardScopeNotice(shardScope)` helper modeled on `formatBuilderParallelNotice` (lines 50-68). In `builderImplement`, when `shardScope` is present: inject the shard notice via a new `{{shardScope}}` template variable, set `verification_scope` to a one-liner ("Verification will run once after all shards finish; do not run it yourself"), and replace the commit section (via a new template variable `{{commit_section}}`) with a one-liner instructing the agent to stage scoped files via targeted `git add <file>` and stop without committing. The non-shard path renders the same templates with the existing strings — no behavior change.
- `packages/engine/src/prompts/builder.md` — Add `{{shardScope}}` interpolation point above `{{parallelLanes}}`. Replace the static `## Commit` section (lines 48-56) with `{{commit_section}}` so the engine can swap in a shard-mode variant. Update the `## Verification` section similarly to render `{{verification_scope}}` (already templated) with shard-mode override.
- `packages/engine/src/pipeline/stages/build-stages.ts` — Replace the `implementStage` body (lines 251-299). New flow: (a) capture `preImplementCommit`, (b) read `agentConfig.shards`, (c) if absent, run today's single-builder flow exactly as it is; (d) if present, fan out via `runParallel(shards.map(s => ({ run: () => runShardAttempt(s, ctx, agentConfig, parallelStages) })), { parallelism: shards.length })` collecting per-shard outcomes, (e) coordinator phase: pop any retry-stashed changes back into the working tree and `git add` them within scope, (f) call `enforceShardScope` on `git diff --cached --name-only`, (g) run verification commands derived from the plan's Verification section, (h) `forgeCommit` with the existing builder commit message template. Each shard runs under its own retry policy via `withRetry` with `buildShardedBuilderContinuationInput`. Add new helpers `runShardAttempt`, `runVerificationCommands`, `enforceShardScope` (or place the latter two in a new sibling helper file `packages/engine/src/pipeline/stages/shard-helpers.ts` if the file grows past ~600 lines).
- `packages/engine/src/retry.ts` — Add `BuilderShardContinuationInput` type (extends `BuilderContinuationInput` with `shardId: string` and `shardScope: ShardScope`). Add `buildShardedBuilderContinuationInput` that: (a) checks the shard's scope for working-tree changes (using `git status --porcelain` filtered by scope-matching), aborts the retry if none, (b) `git stash push --keep-index -m "eforge-shard-<id>-attempt-<N>" -- <scope-paths>` to stash only the shard's scope, (c) builds a `completedDiff` from `git stash show -p stash@{0}` truncated to 50k chars, (d) splices `continuationContext` into options. Add the corresponding policy entry (or expose via a factory `buildShardPolicy(shardId)` since `planIdFromInput` and `onRetry` need shard awareness for tracing). The new `agent:retry` and `plan:build:implement:continuation` events should include `shardId` for monitor visibility — extend the event types if needed in `packages/engine/src/events.ts` (additive, optional field).
- `packages/engine/src/prompts/planner.md` — Append a paragraph after line 86 ("Rename-and-update-all-callers refactors") explaining: for mechanical-refactor PRDs, inspect the candidate file set and judge whether to shard. Heuristics: shard when expected work substantially exceeds a single 80-turn budget; 5 large files may warrant sharding while 30 small files may not. When sharding, emit a `shards` block under `agents.builder` with a mix of `roots` (directory globs) and `files` (explicit paths). Include the YAML example from the PRD's "Plan frontmatter shape" section. Explicitly state that scope enforcement is automatic — do not emit overlapping shards.
- `packages/engine/src/events.ts` — If `agent:retry` and `plan:build:implement:continuation` event types need an optional `shardId` field, add it as `shardId?: string` (additive, no breaking change). Confirm by reading the existing event type definitions before deciding whether to modify.

## Verification

- [ ] `pnpm type-check` passes with zero errors after all changes.
- [ ] `pnpm test` passes — all existing tests continue to pass and new tests in `test/sharded-builder.test.ts` and `test/sharded-implement-stage.test.ts` pass.
- [ ] `pnpm build` succeeds with no warnings.
- [ ] The schema test in `test/schemas.test.ts` accepts a builder config with valid `shards` and rejects: missing `roots` and `files` together; duplicate `id` within one plan's shards.
- [ ] Integration test confirms a plan with no `shards` block runs the single-builder flow with byte-identical output (same events, same commit message, same retry behavior) — `runShardAttempt`/coordinator path is bypassed.
- [ ] Integration test confirms a plan with 2 non-overlapping shards: both shards stage their scoped files, coordinator runs verification once, scope enforcement passes, exactly one commit is created using `forgeCommit` with the standard `feat({{plan_id}}): {{plan_name}}` message.
- [ ] Integration test confirms a plan with 2 overlapping shards (a file matches both shards' roots) fails the stage with a `plan:build:failed` event whose error message names the offending file and both claiming shard IDs, and no commit is created.
- [ ] Integration test confirms a shard exhausting its 4-attempt retry budget: the failing shard yields `plan:build:failed`, other shards complete, the coordinator does not run verification or create a commit, and the stash from the failing shard's last attempt is recoverable (visible in `git stash list`).
- [ ] Unit test confirms `formatShardScopeNotice` renders the scope (roots, files, or both) and the lane-discipline instructions (no out-of-scope edits, targeted `git add <file>`, no commit, no verification) without referencing any harness tool name (`Task`, `Bash`, etc.) — assert via substring exclusion.
- [ ] Unit test confirms `enforceShardScope` returns `{ ok: false, reason: 'unclaimed', files: [...] }` for files matched by zero shards and `{ ok: false, reason: 'overlap', files: [...] }` for files matched by multiple shards.
- [ ] Unit test confirms `buildShardedBuilderContinuationInput` creates a stash with the expected message format `eforge-shard-<id>-attempt-<N>`, captures the diff, and aborts (throws) when the shard's scope has no working-tree changes.
- [ ] Manual confirmation: the builder prompt template renders correctly with and without `shardScope` — no leftover `{{commit_section}}` placeholders, no double headers, sharded prompt does NOT contain the `git add -A && git commit` instruction.
- [ ] Manual confirmation: `packages/engine/src/prompts/planner.md` sharding guidance is present and contains the YAML frontmatter example with `roots` and `files`.
