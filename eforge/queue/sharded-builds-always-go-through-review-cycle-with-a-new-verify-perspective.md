---
title: Sharded builds always go through review-cycle (with a new `verify` perspective)
created: 2026-04-28
---

# Sharded builds always go through review-cycle (with a new `verify` perspective)

## Problem / Motivation

Today the sharded build path has a structural asymmetry with the single-builder path.

In the single-builder flow, the builder agent self-verifies and the retry loop wraps the agent (`build-stages.ts:486-503`, `withRetry(builderPolicy, runBuilderAttempt)`, `maxAttempts = maxContinuations + 1`): when verification fails, another builder attempt runs with continuation context describing the failure. Builder fixes its own mistakes. This is the implicit "fix cycle" that happens *during* implement.

In the sharded flow, individual shards are deliberately told NOT to verify (`build-stages.ts:396`: "shardScope instructs the agent not to verify") because each shard only sees a slice. Verification is hoisted to a one-shot coordinator step at `build-stages.ts:577-597`. That step has **no agent loop wrapped around it** — first non-zero exit sets `ctx.buildFailed = true; return;` and the build dies.

The cost of this asymmetry just bit us: the `replace-backend-with-harness` PRD's plan-01 shard correctly bumped `DAEMON_API_VERSION 9 → 10`, didn't notice a hand-coupled tripwire test asserting the literal `9`, and post-merge `pnpm test` died at the coordinator with no fix path.

## Goal

Make the sharded build path produce a coordinator state that flows into the same review-cycle as a single-builder result, so the existing iterative review→fix→evaluate loop handles verification failures exactly the way it handles every other class of issue. No special sharded path for downstream stages, no new agent role, no special "coordinator-builder" — just the existing review-cycle machinery extended with one new reviewer perspective.

## Approach

Three coordinated changes (plus a planner/runtime guard):

### 1. New `verify` reviewer perspective

Add a sixth perspective to `parallel-reviewer.ts`:

- New prompt `packages/engine/src/prompts/reviewer-verify.md`. Unlike the existing reviewers, this one **runs commands** rather than reading a diff. Prompt sketch:
  > Your job is to run the project's verification commands extracted from the plan body's `## Verification` section, plus the project's `postMergeCommands`, and emit each failure as a critical review issue. Do not analyze the diff. Do not run any other commands. Output one issue per failing command, with the command, exit code, and full stdout/stderr in the `<fix>` element so the review-fixer has enough context to repair the cause.
- Wire `verify: 'reviewer-verify'` into `PERSPECTIVE_PROMPTS` (`parallel-reviewer.ts:49-55`).
- Wire `verify` into `PERSPECTIVE_SCHEMA_YAML` (`parallel-reviewer.ts:58-64`) — likely reusing the code review schema; verify-category issues use the same `<issue>` shape as other reviewers.
- Add `'verify'` to the `ReviewPerspective` union in `review-heuristics.ts`.
- Document that `verify` perspective runs subprocess commands; this is intentional and distinguishes it from the diff-based perspectives.

### 2. Drop the coordinator verification step

In `build-stages.ts`, the sharded coordinator branch (lines 534-609) becomes:

```
1. Stage all working-tree changes (unchanged, lines 540-546)
2. Scope enforcement (unchanged, lines 548-575)
3. Single coordinator commit (unchanged, lines 599-607)
4. Emit plan:build:implement:complete (unchanged, line 609)
```

Lines 577-597 — the `runVerificationCommands` call and its fail-terminal handling — are **deleted**. Verification now belongs to the review-cycle stage that runs after implement.

This means the implement stage of a sharded plan ends in the same shape as a single-builder implement stage: a single commit on the worktree's branch, ready for review-cycle.

### 3. Review-fixer prompt: allow cross-diff edits for verify-category issues

Today the review-fixer (`prompts/review-fixer.md`) is implicitly scoped to repairing files mentioned in review issues, which under the diff-based perspectives are always files in the diff. With the new `verify` perspective, a failing test in an unchanged file (e.g. the `DAEMON_API_VERSION` tripwire) becomes a critical issue pointing at a path *outside* the original diff. The fixer must be willing to edit it.

Add a short clause to `prompts/review-fixer.md`:

> When a review issue is in the `verify` category, the fix may require editing files outside the original diff. Verification failures often reveal coupling between code you changed and tests/config/docs you didn't. Edit whatever is needed to make the failing command pass — the issue's `<fix>` element will name the file and the repair.

That's the entire change. The fixer's existing machinery (read issues, apply fixes, write files) already supports it; only the prompt needed a nudge.

### 4. Planner / runtime guard: sharded plans always include review-cycle

The build pipeline (the array of stages a plan executes — e.g. `['implement', ['review', 'doc-update'], 'evaluate']`) is decided by the planner agent and resolved at runtime. Today it can omit `review-cycle` for cheap plans; that's fine for non-sharded.

Required behavior change:

- **Planner prompt update** (`prompts/planner.md`): when the planner selects a sharded agent config for a plan, the build pipeline **must** include `review-cycle`. Add this as a hard rule in the prompt, with one sentence of rationale: "shards don't self-verify, so review-cycle's verifier perspective is the integration gate."
- **Runtime guard** in the engine, belt-and-suspenders: when resolving a plan's pipeline, if `agentConfig.shards` is set and `review-cycle` is not in the stage list, inject it. This prevents a stale or missed-prompt-update from producing an unverified merge.
  - Implementation point: probably in the same place that resolves the plan's `build` array. Likely `packages/engine/src/orchestrator/` or `packages/engine/src/pipeline/`. Find the resolution site; add the guard there.
- **review-cycle perspective requirement**: when review-cycle runs under a sharded plan, the `verify` perspective must be in `ctx.review.perspectives`. If it isn't, inject it. Same belt-and-suspenders pattern.

### Why this layering is clean

| Layer | Single-builder path | Sharded path | Fix cycle |
|-------|---------------------|--------------|-----------|
| Implement | builder self-verifies inside `withRetry(builderPolicy)` | shards (no verify) → coordinator commits without verifying | builder retries internally |
| Review-cycle | optional (planner choice); inspects diff via diff-based perspectives | **required**; includes `verify` perspective that runs verification commands | review→fix→evaluate iterates up to `maxRounds` |
| Build validate | `phases.validate` with `validationFixer` retry loop | same | validationFixer retries up to `maxValidationRetries` |

For non-sharded plans nothing changes. For sharded plans:
- Coordinator gets simpler (drops verification logic).
- The verification work moves into a perspective that's iterated through review-cycle, which already has the fix loop.
- No new agent ROLE, just one new PERSPECTIVE — strictly smaller code change than adding a coordinator-builder.

### Critical files

**New:**
- `packages/engine/src/prompts/reviewer-verify.md` — new perspective prompt that runs verification commands and emits failures as critical issues with full output in the `<fix>` element.

**Modified:**
- `packages/engine/src/pipeline/stages/build-stages.ts:534-609` — delete lines 577-597 (the `runVerificationCommands` call); rest unchanged. Optionally also delete the `runVerificationCommands` helper at lines 313-377 if no other caller — verify by grep first.
- `packages/engine/src/agents/parallel-reviewer.ts:49-64` — add `verify` to `PERSPECTIVE_PROMPTS` and `PERSPECTIVE_SCHEMA_YAML`.
- `packages/engine/src/review-heuristics.ts` — add `'verify'` to the `ReviewPerspective` union; decide whether `determineApplicableReviews` should include `verify` automatically (probably not — `verify` should only be added by the sharded-plan guard, otherwise it slows down every diff-based review).
- `packages/engine/src/prompts/review-fixer.md` — add the cross-diff clause for verify-category issues (see section 3 above).
- `packages/engine/src/prompts/planner.md` — add the rule that sharded plans must include `review-cycle` with the `verify` perspective.
- (Pipeline resolution site — TBD by exploration; likely `packages/engine/src/orchestrator/` or `packages/engine/src/pipeline/registry.ts`) — add the runtime guard that injects `review-cycle` and `verify` perspective when shards are configured but missing from the pipeline / perspectives.

### Alternative considered (rejected)

Earlier draft of this plan added a new `coordinator-builder` agent role that would run a regular builder retry loop on the merged shard worktree. Rejected in favor of the verifier-perspective approach because:
- New agent role = new prompt + new role registration + new continuation plumbing.
- Verifier-perspective approach = one new prompt, one map entry, no new retry machinery (review-cycle already iterates).
- The user's framing — "treat sharded post-build like a regular builder, use the review-cycle" — is more naturally expressed as "let the review-cycle do its job, with a perspective that knows how to run verification."
- Simpler is better.

### Open questions

1. **Should `verify` perspective also run on non-sharded plans where review-cycle is in the pipeline?** Probably yes when explicitly requested (the planner can include it), but not by default — the single-builder already self-verifies, so the verify perspective is redundant cost in that path. Default: only inject when sharding.

2. **What's the right `maxRounds` default for sharded plans?** Single-builder uses whatever the global review config says. Sharded might need higher to give the verify→fix loop room to converge on coupling issues. Defer to default until we see real data; revisit if review-cycle keeps maxing out.

_(Question 3 resolved — folded into the approach as section 3: review-fixer prompt gets a cross-diff clause for verify-category issues.)_

### Sequencing

This is one self-contained PRD. Estimated agent-build effort: small to medium (one new prompt, one perspective registration, removal of the coordinator verification block, planner prompt update, runtime guard, tests). No breaking config changes. Existing single-builder tests should pass without modification.

When ready to enqueue:
- Drop a PRD `eforge/queue/sharded-build-via-review-cycle.md` with the goal/approach/verification sections above.
- Let the daemon build it.
- Once it lands and `replace-backend-with-harness` has been retried successfully, the structural hole is closed.

## Scope

### In scope

- New `verify` reviewer perspective with prompt `packages/engine/src/prompts/reviewer-verify.md` that runs subprocess commands.
- Wiring `verify` into `PERSPECTIVE_PROMPTS` and `PERSPECTIVE_SCHEMA_YAML` in `parallel-reviewer.ts`.
- Adding `'verify'` to the `ReviewPerspective` union in `review-heuristics.ts`.
- Deletion of the coordinator verification step (lines 577-597 in `build-stages.ts`); optional removal of the `runVerificationCommands` helper at lines 313-377 if unused.
- Cross-diff clause added to `prompts/review-fixer.md` for verify-category issues.
- Planner prompt update (`prompts/planner.md`) requiring sharded plans to include `review-cycle`.
- Runtime guard in the engine that injects `review-cycle` and the `verify` perspective when shards are configured but missing.
- Tests: `test/reviewer-verify.test.ts`, extension of `test/agent-wiring.test.ts`, and a new sharded-plan scenario test covering the post-coordinator review-cycle.

### Out of scope (explicit non-goals)

- Don't change per-shard builder behavior. Shards still don't verify.
- Don't change scope enforcement. The coordinator still scope-enforces before committing.
- Don't change the global post-merge `phases.validate` phase. That stays as the build-level gate.
- Don't change recovery behavior. If review-cycle exhausts `maxRounds` without converging, the existing failure path takes over.
- Don't add `verify` to the auto-applicable perspective set for non-sharded plans. Diff-based reviewers don't need to run commands. `verify` is opt-in via the sharded-plan guard.

## Acceptance Criteria

End-to-end stub-harness scenario:

1. Set up a 2-shard plan in a temp git repo.
2. Configure shards to stage benign changes that, post-merge, break a tripwire test (mirror the `DAEMON_API_VERSION` shape).
3. Configure StubHarness:
   - Reviewer (`verify` perspective): runs `pnpm test`, sees failure, emits one critical issue with the failing test path and the assertion mismatch in the `<fix>` element. The path it names is outside the original diff.
   - Other perspectives: no issues.
   - Review-fixer: reads the issue, edits the tripwire test (a file outside the diff — confirms the cross-diff prompt clause works) to assert the new value or remove it.
   - Evaluator: accepts the fix.
4. Assert:
   - Coordinator commits the merged shards without running verification.
   - review-cycle runs once with the failing verify result, fixer repairs, evaluator accepts.
   - review-cycle's second round shows verify passing, no actionable issues, loop exits.
   - Plan ends in `merged` status.

Additional criteria:

- Run full `pnpm test` to confirm no regressions in the single-builder or non-sharded paths.
- Verify (manually or by test) that non-sharded plans without `review-cycle` still work unchanged.
- Existing single-builder tests pass without modification.
- No breaking config changes.
