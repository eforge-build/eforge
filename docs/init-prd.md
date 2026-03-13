# aroh-forge: Standalone CLI Tool

## Context

Mark's schaake-cc-marketplace plugins (EEE, orchestrate, review) implement a complete plan-build-review loop for autonomous code generation. Chandra proved the concept overnight with a 12-hour multi-agent pipeline build. The goal is to extract this workflow into a standalone TypeScript CLI (`aroh-forge`) built on `@anthropic-ai/claude-agent-sdk`, so it works outside of Claude Code as an independent developer tool.

This is primarily an **extraction and repackaging** exercise — the skill logic, plan formats, orchestration patterns, and review policies already exist and are battle-tested.

## CLI Shape

```
aroh-forge plan <prd-or-prompt>    # PRD → execution plans
aroh-forge build <plan-set>        # Execute plans (implement + review)
aroh-forge review <plan-set>       # Review code against plans
aroh-forge status                  # Check running builds
```

Flags: `--auto` (bypass approval gates), `--verbose` (stream agent output), `--dry-run` (validate without executing)

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js
- **Agent SDK**: `@anthropic-ai/claude-agent-sdk` (v0.2.74)
- **CLI framework**: Commander.js or similar (lightweight)
- **Output**: stdout + log files (consider `ora` for spinners, keep it simple)
- **Package manager**: pnpm
- **Build**: tsup or tsx

## Project Structure

```
aroh-forge/
  package.json
  tsconfig.json
  src/
    cli.ts                    # Entry point, command definitions
    config.ts                 # Project config loading (forge.yaml)

    # Core domain (reuse existing formats exactly)
    plan.ts                   # Plan/PlanSet parsing (YAML frontmatter)
    state.ts                  # Build state (.forge-state.json)

    # Agents — each wraps a claude-agent-sdk call
    agents/
      planner.ts              # PRD → plan files
      builder.ts              # Plan → implementation (multi-turn for fix eval)
      reviewer.ts             # Blind review → unstaged fixes

    # Prompts — extracted from existing skills (.md files)
    prompts/
      planner.md              # From: eee excursion-planner + module-planner
      builder.md              # From: orchestrate run-executor prompt
      reviewer.md             # From: review code-review-policy + security-audit
      evaluator.md            # From: review fix-evaluation-policy

    # Orchestration
    orchestrator.ts           # Dependency-aware parallel execution
    worktree.ts               # Git worktree lifecycle

    # Output
    display.ts                # Progress display, log management
```

## Extraction Map

Source skills → aroh-forge components:

| Source (schaake-cc-marketplace) | Target (aroh-forge) | What to extract |
|---|----|---|
| `eee/skills/excursion-plan/` | `prompts/planner.md` + `agents/planner.ts` | Plan generation logic, format spec, codebase exploration strategy |
| `eee/skills/expedition-compiler/` | `plan.ts` | orchestration.yaml + plan file format, dependency resolution |
| `orchestrate/skills/orchestration-coordinator/` | `orchestrator.ts` + `worktree.ts` | Wave execution, worktree management, merge strategy, state tracking |
| `orchestrate/skills/plan-parser/` | `plan.ts` | Frontmatter parsing, plan validation |
| `review/skills/code-review/` + policies | `prompts/reviewer.md` + `agents/reviewer.ts` | Review criteria, severity levels, multi-policy review |
| `review/skills/evaluate-fixes/` | `prompts/evaluator.md` (used in builder turn 2) | Accept/reject/review hunk classification |

## Agent Architecture

Note: The SDK supports loading Claude Code plugins directly (`plugins: [{ type: 'local', path: '...' }]`), but we're deliberately choosing self-contained prompts for portability. Skill logic is extracted into standalone `.md` prompt files — no dependency on the schaake-cc-marketplace plugins at runtime.

Same three-agent pattern as existing plugins, but using SDK `query()` calls instead of spawning `claude --print` via shell scripts:

1. **Planner** — `query()` one-shot. Gets full tool access to explore codebase. Writes plan files.
2. **Builder** — Multi-turn (SDK client). Turn 1: implement plan. After blind review completes, Turn 2: evaluate reviewer's unstaged fixes.
3. **Reviewer** — `query()` one-shot. Blind (no builder context). Reviews committed code, leaves fixes unstaged.

## Orchestration Flow

Same as existing orchestrate plugin:
1. Parse orchestration.yaml → resolve dependency graph → compute execution waves
2. Create sibling worktree directory (`../{project}-{set}-worktrees/`)
3. Launch wave 1 plans in parallel (each in its own worktree)
4. Each plan: build → blind review → fix evaluation → final commit
5. As plans complete, launch newly-unblocked plans
6. Merge all branches in topological order
7. Run post-merge validation commands
8. Cleanup worktrees

## Implementation Sequence

### Phase 1: Scaffold + Plan command
1. Initialize repo: `package.json`, `tsconfig.json`, basic structure
2. `cli.ts` with Commander commands
3. `plan.ts` — parse plan files (port frontmatter parsing)
4. `agents/planner.ts` — wire up SDK `query()` with planner prompt
5. `prompts/planner.md` — extract from excursion-planner skill
6. **Test**: `aroh-forge plan "Add a health check endpoint"` in a test repo

### Phase 2: Build command (single plan, no parallelism)
1. `agents/builder.ts` — implement with multi-turn SDK client
2. `agents/reviewer.ts` — blind review with `query()`
3. `prompts/builder.md`, `prompts/reviewer.md`, `prompts/evaluator.md`
4. `state.ts` — build state tracking
5. **Test**: `aroh-forge build <plan-set>` with a single-plan set

### Phase 3: Parallel orchestration
1. `orchestrator.ts` — dependency-aware wave execution
2. `worktree.ts` — git worktree lifecycle
3. `display.ts` — progress output
4. **Test**: multi-plan set with dependencies

### Phase 4: Polish
1. `config.ts` — forge.yaml project config
2. Resume support (detect existing .forge-state.json)
3. `--auto` / interactive gate points
4. `aroh-forge status` and `aroh-forge review` commands
5. Error handling, cleanup on interrupt

## Repo

Separate repo at `~/projects/aroh/forge/` (GitHub: `aroh-ai/forge`). Bring into flywheel monorepo via `git subtree add` once baked. Zero code dependencies on flywheel — connects via MCP only.

## Telemetry

Langfuse tracing from day 1. Every agent SDK call (plan, build, review) gets a Langfuse trace. Dogfoods the aroh observability story — forge becomes the first "customer" of the diagnosis flywheel.

- **SDK**: `langfuse` npm package (JS SDK)
- **Config**: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` from env or forge.yaml
- **Trace structure**: one trace per `aroh-forge` invocation, spans per agent call (planner, builder, reviewer, evaluator)
- **Captured**: model, token usage, wall-clock duration, success/failure, plan metadata

## Open Questions (deferred)

- **Package publishing**: npm? GitHub package? Private for now?
- **MCP integration**: Should forge optionally connect to aroh flywheel MCP to receive findings as input to plan generation?

## Verification

1. `aroh-forge plan "Add a health check endpoint to an Express app"` → produces valid plan files
2. `aroh-forge build <plan-set>` → implements code, runs review, produces clean commits
3. `aroh-forge status` → shows progress of running build
4. Multi-plan with dependencies → executes in correct order, merges cleanly
5. `--auto` mode → runs end-to-end without prompts
