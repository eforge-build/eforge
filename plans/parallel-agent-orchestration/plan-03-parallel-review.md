---
id: plan-03-parallel-review
name: Multi-Perspective Build Review
depends_on: [plan-01-run-parallel]
branch: parallel-agent-orchestration/parallel-review
---

# Multi-Perspective Build Review

## Architecture Context

The current build review phase runs a single generalist reviewer that covers all categories (bugs, security, error handling, etc.) in one pass. The review plugin at `~/projects/schaake-cc-marketplace` already solves multi-perspective review with heuristic-based file categorization and parallel specialist reviewers. This plan ports those exact patterns into eforge's engine, splitting the review phase into parallel specialist agents when the changeset is large enough to benefit.

The key architectural choice: specialist reviewers are read-only (same as the current reviewer). After parallel reviewers report issues, a single review-fixer agent applies fixes. This separates "finding issues" (parallelizable, read-only) from "fixing issues" (sequential, writes files). The existing evaluator phase runs unchanged after the fixer - it evaluates unstaged changes exactly as today.

## Implementation

### Overview

Six sub-components, each building on the previous:

1. **File categorization utility** (`review-heuristics.ts`) - categorize changed files, determine applicable review perspectives, decide whether to parallelize
2. **Specialist reviewer prompts** (4 new `.md` files) - focused prompts for code, security, API, and docs review
3. **Parallel review runner** (`parallel-reviewer.ts`) - orchestrate fan-out to specialists via `runParallel`, aggregate and deduplicate issues
4. **Review fixer agent** (`review-fixer.ts` + prompt) - single agent that applies fixes for aggregated issues
5. **New events + agent role** (`events.ts`) - parallel review lifecycle events, `review-fixer` agent role
6. **Build pipeline wiring** (`eforge.ts`) - replace single reviewer with parallel-or-single decision in `planRunner`, wire fixer between reviewers and evaluator
7. **Display updates** (`display.ts`) - render new events

### Key Decisions

1. **Parallelization threshold: 10+ files OR 500+ changed lines** - ported directly from the review plugin's heuristic. Below threshold, the existing single `runReview()` runs unchanged. This avoids overhead for small changes where a single reviewer covers everything.
2. **Specialist reviewers use `tools: 'none'`** (read-only, same as current reviewer) - they find issues but do not write fixes. This matches the review plugin's pattern and allows true parallelism without write conflicts.
3. **Single fixer agent after parallel review** - receives all aggregated issues and applies fixes in priority order (critical first). Runs with `tools: 'coding'`. Leaves fixes unstaged for the evaluator - identical to how the current single reviewer leaves fixes unstaged.
4. **Deduplication by file + line + description** - when multiple specialist reviewers flag the same issue (e.g., code reviewer and security reviewer both find an unsafe cast), deduplicate to avoid double-counting. Keep the highest severity.
5. **`review-fixer` is a new `AgentRole`** - distinct from the existing `reviewer` and `evaluator` roles for tracing clarity and prompt routing.
6. **Specialist reviewers reuse the `reviewer` AgentRole** - they are still reviewers, just with different prompts. The `perspective` field in events distinguishes them.

## Scope

### In Scope
- File categorization and applicability matrix (ported from review plugin)
- 4 specialist reviewer prompts (code, security, API, docs)
- Parallel review orchestration with `runParallel`
- Review fixer agent and prompt
- New events for parallel review lifecycle
- Build pipeline wiring (parallel-or-single decision)
- Display rendering for new events
- Tests for heuristics, parallel reviewer wiring

### Out of Scope
- Changes to the existing single `runReview()` function (it remains as the fallback)
- Changes to the evaluator (`builderEvaluate`) - it runs unchanged after the fixer
- Plan review parallelization (only build review is parallelized)
- Parallelized build implementation (future roadmap item)

## Files

### Create
- `src/engine/review-heuristics.ts` - `FileCategories` interface, `ReviewPerspective` type, `categorizeFiles()`, `determineApplicableReviews()`, `shouldParallelizeReview()`. Categorization uses glob-style pattern matching against file paths. Applicability matrix: code files → code + security; API files → api; doc files → docs; dep files → security (if not already). Threshold: 10+ files OR 500+ lines.
- `src/engine/agents/parallel-reviewer.ts` - `runParallelReview()` async generator. Gets changed files via `git diff {baseBranch}...HEAD --name-only`, diff stat via `git diff {baseBranch}...HEAD --stat`. Calls `shouldParallelizeReview` - if false, delegates to existing `runReview()`. If true, builds `ParallelTask[]` for each applicable perspective, runs via `runParallel`, aggregates issues, deduplicates, yields `build:review:complete` with merged issues.
- `src/engine/agents/review-fixer.ts` - `runReviewFixer()` async generator. One-shot agent with `tools: 'coding'`. Receives aggregated `ReviewIssue[]`, formats them into the prompt, runs backend. Does NOT stage or commit. Yields `build:review:fix:start` and `build:review:fix:complete` events.
- `src/engine/prompts/reviewer-code.md` - Code quality specialist. Covers: bugs, types, DRY, performance, maintainability, error handling, edge cases. Explicitly states that security is handled by another agent. Same `<review-issues>` output format as `reviewer.md`. Uses `tools: 'none'`.
- `src/engine/prompts/reviewer-security.md` - Security specialist. Covers: OWASP categories, injection, secrets exposure, auth/authz, unsafe operations, dependency vulnerabilities. Same output format.
- `src/engine/prompts/reviewer-api.md` - API design specialist. Covers: REST conventions, request/response contracts, input validation, breaking changes, error responses. Same output format.
- `src/engine/prompts/reviewer-docs.md` - Documentation specialist. Covers: accuracy of code examples, env var documentation, missing/stale docs, README completeness. Same output format.
- `src/engine/prompts/review-fixer.md` - Fix application prompt. Receives aggregated issues sorted by severity. Instructions: apply minimal fixes, work through critical issues first, do NOT stage or commit. Uses `tools: 'coding'`.
- `test/review-heuristics.test.ts` - Tests for `categorizeFiles()` (TypeScript files → code, route files → api, README → docs, package.json → deps, config files → config), `determineApplicableReviews()` (code files trigger code+security, API files add api, docs files add docs, deps add security, deduplication), `shouldParallelizeReview()` (below threshold returns false, 10+ files returns true, 500+ lines returns true).
- `test/parallel-reviewer.test.ts` - Tests using StubBackend for parallel reviewer wiring: issue aggregation from multiple perspectives, deduplication of same-file-same-line issues, delegation to single `runReview()` below threshold. Tests for review fixer event emission.

### Modify
- `src/engine/events.ts` - Add `'review-fixer'` to the `AgentRole` union. Add 5 new event types: `build:review:parallel:start` (with `planId`, `perspectives: ReviewPerspective[]`), `build:review:parallel:perspective:start` (with `planId`, `perspective`), `build:review:parallel:perspective:complete` (with `planId`, `perspective`, `issues: ReviewIssue[]`), `build:review:fix:start` (with `planId`, `issueCount: number`), `build:review:fix:complete` (with `planId`). Import `ReviewPerspective` type from `review-heuristics.ts`.
- `src/engine/eforge.ts` - Replace the review phase in the `planRunner` closure. Import `runParallelReview` from `parallel-reviewer.ts` and `runReviewFixer` from `review-fixer.ts`. The new flow: (1) call `runParallelReview()` which handles the parallel-or-single decision internally and always yields `build:review:complete` with issues, (2) if parallel review found issues, call `runReviewFixer()` to apply fixes (unstaged), (3) existing evaluator phase runs unchanged via `runReviewCycle`'s evaluator half. The `runReviewCycle` config changes: the reviewer closure now calls `runParallelReview` instead of `runReview`, and a fixer step is inserted between reviewer and evaluator.
- `src/cli/display.ts` - Handle 5 new event types. `build:review:parallel:start` → update spinner text to show perspectives being run (e.g., "reviewing: code, security, api"). `build:review:parallel:perspective:start` → no-op or update spinner. `build:review:parallel:perspective:complete` → log per-perspective issue count. `build:review:fix:start` → update spinner text to "applying fixes ({N} issues)". `build:review:fix:complete` → update spinner text to "fixes applied".

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes including new test files `test/review-heuristics.test.ts` and `test/parallel-reviewer.test.ts`
- [ ] `pnpm build` produces `dist/cli.js` without errors
- [ ] `categorizeFiles()` assigns `src/engine/agents/reviewer.ts` to `code`, `README.md` to `docs`, `package.json` to `deps`
- [ ] `determineApplicableReviews({ code: ['a.ts'], api: [], docs: [], config: [], deps: [] })` returns `['code', 'security']`
- [ ] `shouldParallelizeReview(['a.ts'], { lines: 100 })` returns `false` (1 file, 100 lines - below both thresholds)
- [ ] `shouldParallelizeReview(Array(10).fill('a.ts'), { lines: 100 })` returns `true` (10 files hits threshold)
- [ ] `shouldParallelizeReview(['a.ts'], { lines: 500 })` returns `true` (500 lines hits threshold)
- [ ] Below threshold, `runParallelReview()` delegates to existing `runReview()` - emits `build:review:start` and `build:review:complete` only (no parallel events)
- [ ] Above threshold, `runParallelReview()` emits `build:review:parallel:start`, per-perspective start/complete events, then `build:review:complete` with merged issues
- [ ] Duplicate issues (same file + line + description across perspectives) are deduplicated, keeping the highest severity
- [ ] Review fixer runs with `tools: 'coding'` and does NOT run `git add` or `git commit`
- [ ] Existing single-reviewer path is unchanged when changeset is below threshold
