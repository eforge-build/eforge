# Parallel Execution & Profile Gaps

Captures the gaps identified during the workflow-profiles build session (2026-03-16). These are concrete issues found through building, reviewing, and running the profile system - not speculative features.

## 1. Merge Conflict Resolver Agent

### Problem

When same-wave plans touch the same file, the merge step fails. The `MergeResolver` callback infrastructure is wired (types in `worktree.ts`, plumbing through orchestrator), but no agent backs it. The current behavior is: attempt merge, fail, abort, mark plan as failed, propagate to dependents.

The conflict that surfaced this: `cli-and-display` and `monitor-and-downstream` (both wave 4) both modified `display.ts`. One merged first, the second conflicted on a trivial variable naming difference.

### Design

The merge resolver agent is a one-shot coding agent that receives `MergeConflictInfo` (branch names, conflicted files, full diff with conflict markers) and resolves the conflicts in the working tree.

Key considerations:
- The agent needs context from both plans to understand intent - not just the diff, but what each plan was trying to accomplish
- `MergeConflictInfo` should be extended with plan content or summaries from both sides
- The agent should have tool access (`coding` preset) to read files beyond the conflicted ones for context
- Resolution must be verified: after the agent runs, check that no conflict markers remain and the merge can complete
- If the agent can't resolve, fall through to abort (existing behavior)

### Implementation

- New agent: `src/engine/agents/merge-resolver.ts`
- New prompt: `src/engine/prompts/merge-resolver.md`
- Wire the agent as the `MergeResolver` callback in `eforge.ts` when constructing the orchestrator
- Extend `MergeConflictInfo` in `worktree.ts` with optional plan context (plan names, summaries)
- Add `merge:resolve:start` / `merge:resolve:complete` events for monitor visibility

## 2. Edit Region Markers

### Problem

Merge conflicts between same-wave plans are preventable when the planner knows upfront which files will be shared. Today the cohesion reviewer detects shared files and flags overlaps, but there's no mechanism to prevent the conflict at the source.

### Design

During expedition planning, when the planner or module planners detect that multiple modules will touch the same file, they insert marker comments that delineate each module's edit region:

```typescript
// --- eforge:region module-a ---
// Module A's additions here
// --- eforge:endregion module-a ---

// --- eforge:region module-b ---
// Module B's additions here
// --- eforge:endregion module-b ---
```

Each builder is instructed (via prompt) to only edit within its assigned regions. Because the regions are non-overlapping, git auto-merges succeed.

Key considerations:
- Markers work best for additive changes (new functions, new exports, new routes). They're less useful when two modules need to modify the same existing code.
- The planner needs to identify shared files during architecture planning and create the markers before module planning begins.
- Barrel files (`index.ts`), config files, and route registries are the most common shared file patterns.
- Markers should be cleaned up after successful build (or left as benign comments).

### Implementation

- Extend the planner prompt to detect shared files and emit marker regions
- Module planner prompts include instructions to respect region boundaries
- Builder prompts include instructions to only edit within assigned regions
- Optional post-build cleanup step to remove marker comments
- Cohesion reviewer validates that regions don't overlap

## 3. Review Strategy Wiring

### Problem

`ReviewProfileConfig` is fully defined, parsed, validated, merged through extends chains, and surfaced in the monitor UI. But the actual review and evaluate stages in `pipeline.ts` don't read any of these fields. The review stage uses the hardcoded `runParallelReview()` with its internal `shouldParallelizeReview()` heuristic regardless of profile config.

The defaults (`strategy: auto`, `maxRounds: 1`, `evaluatorStrictness: standard`, `perspectives: ['code']`) match current behavior, so this isn't a bug today. It becomes a bug when someone configures non-default values and they're silently ignored.

### Fields to wire

| Field | Where it takes effect | Current behavior |
|-------|----------------------|------------------|
| `strategy` | Review build stage | `auto` heuristic via `shouldParallelizeReview()` - needs to respect `single`/`parallel` overrides |
| `perspectives` | Parallel review fan-out | Hardcoded in `runParallelReview()` via `determineApplicableReviews()` - needs to use profile value |
| `maxRounds` | Review-fix-evaluate loop | Always 1 round - needs a loop in the build pipeline |
| `autoAcceptBelow` | Before review-fixer/evaluator | No filtering today - needs severity filter on `ReviewIssue[]` |
| `evaluatorStrictness` | Evaluator prompt selection | Single prompt today - needs prompt variants or template variable |

### Implementation

- **Review stage** (`pipeline.ts`): Read `ctx.profile.review.strategy` and `ctx.profile.review.perspectives`. When `strategy` is `single`, skip `runParallelReview` and use `runReview` directly. When `parallel`, skip the heuristic check and always fan out. Pass `perspectives` to `runParallelReview`.
- **Review round loop**: Wrap the review → review-fix → evaluate sequence in a loop controlled by `ctx.profile.review.maxRounds`. After each round, check if there are still issues above the accept threshold.
- **Severity filter**: Before passing `ReviewIssue[]` to the review-fixer, filter out issues at or below `autoAcceptBelow` severity. Auto-accepted issues are still reported in the event but don't trigger fixes.
- **Evaluator strictness**: Add a `strictness` template variable to the evaluator prompt. `strict` = reject unless the fix is clearly correct. `lenient` = accept unless the fix is clearly wrong. `standard` = current behavior.

## 4. Dynamic Profile Generation

### Problem

The current profile system selects from a predefined menu. Every PRD is unique - a migration that touches auth might need security review perspectives that a generic "migration" profile doesn't include. There's no way to tailor the profile to the specific work without pre-defining every possible combination.

### Design

A mode where the planner (or a dedicated profile-generation agent) reads the PRD and available profiles, then either extends a base profile with per-run overrides or generates a complete profile from scratch when no base fits.

The infrastructure is ready: `plan:profile` events already carry an optional `config: ResolvedProfileConfig`, and the pipeline prefers `event.config` over named lookup. The missing piece is the agent that produces the config.

### Flow

```
eforge run prd.md                          # default: select from menu (today)
eforge run prd.md --generate-profile       # agent generates/extends a profile
```

1. Agent reads PRD + available profile descriptions
2. If a base profile fits, output: `{ extends: "excursion", overrides: { review: { perspectives: ["code", "security"], maxRounds: 2 } } }`
3. If no base fits, output a complete `ResolvedProfileConfig`
4. Engine validates the generated config (required fields present, stage names valid, no unknown agent roles)
5. `plan:profile` event carries the generated config inline

### Implementation

- Config validation function in `config.ts`: `validateProfileConfig(config: ResolvedProfileConfig): { valid: boolean; errors: string[] }`
- Planner prompt variant or separate agent for profile generation
- `--generate-profile` CLI flag
- Eval support: compare generated vs pre-defined profiles on same PRDs

## Priority

These are ordered by impact on current builds:

1. **Review strategy wiring** - Users can already configure these fields; they just don't work. Low effort, high trust impact.
2. **Merge conflict resolver agent** - Infrastructure wired, agent needed. Directly prevents build failures we've already seen.
3. **Edit region markers** - Proactive prevention. Higher effort but eliminates the conflict class entirely for additive changes.
4. **Dynamic profile generation** - Enhancement, not a fix. Depends on review strategy wiring being done first (otherwise generated profiles with non-default review config would also be silently ignored).
