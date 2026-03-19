---
title: R3 + R4: Test Reviewer Perspective & Architecture Review Stage
created: 2026-03-19
status: pending
---

## Problem / Motivation

The eforge agent architecture has two validated gaps:

1. **No test quality review perspective** — The parallel reviewer currently lacks a dedicated test quality lens. Test files are categorized as generic code, so coverage gaps, flaky patterns, assertion quality issues, test isolation problems, and fixture design flaws go undetected during review cycles.

2. **No architecture review in expedition compile pipeline** — When the planner writes `architecture.md` for expeditions, it goes completely unreviewed before module planners build against it. Flawed module boundaries, vague integration contracts, or incomplete shared file registries propagate to all downstream module plans, compounding errors.

This plan assumes R1 (consolidate plan/cohesion evaluators into a single parameterized evaluator with `mode: 'plan' | 'cohesion'`) and R2 (relocate `parseEvaluationBlock` to `common.ts`) are already complete. Those changes provide the foundation - a proven `runReviewCycle()` helper in `pipeline.ts` and a consolidated evaluator that can be extended with a third mode.

## Goal

Add a `test` reviewer perspective to the parallel reviewer for catching test quality issues, and add an `architecture-review-cycle` compile stage to the expedition profile that validates `architecture.md` against the PRD before module planning begins.

## Approach

### R3: Test Reviewer Perspective

Add a `test` perspective to the parallel reviewer that catches test quality issues: coverage gaps, flaky patterns, assertion quality, test isolation, fixture problems.

**`src/engine/review-heuristics.ts`**:
- Add `'test'` to `ReviewPerspective` union type
- Add `test: string[]` to `FileCategories` interface
- Add `isTest()` function matching `*.test.{ts,tsx,js,jsx}`, `*.spec.{ts,tsx,js,jsx}`, files under `test/`, `tests/`, `__tests__/`
- Update `categorizeFiles()` to call `isTest()` before `isCode()` so test files land in the `test` bucket, not `code`
- Update `determineApplicableReviews()` to trigger `'test'` perspective when `categories.test.length > 0`

**`src/engine/schemas.ts`**:
- Define `testCategorySchema` with categories: `'coverage-gaps'`, `'test-quality'`, `'test-isolation'`, `'fixtures'`, `'assertions'`, `'flaky-patterns'`, `'test-design'`
- Create `testReviewIssueSchema` via `makeReviewIssueSchemaWithCategory(testCategorySchema)`
- Export `getTestsReviewIssueSchemaYaml()` getter

**`src/engine/agents/parallel-reviewer.ts`**:
- Add `test: 'reviewer-tests'` to `PERSPECTIVE_PROMPTS`
- Add `test: getTestsReviewIssueSchemaYaml` to `PERSPECTIVE_SCHEMA_YAML`
- Import `getTestsReviewIssueSchemaYaml` from `../schemas.js`

**`src/engine/prompts/reviewer-tests.md`** (NEW):
- Follow the existing specialist prompt template (role, context, scope, triage, categories, severity, fix instructions, schema, output, constraints)
- Role: test quality specialist performing blind review
- Focus areas: coverage gaps for new/changed code, assertion quality, test isolation (no shared mutable state), fixture design, flaky patterns (timing, ordering, external dependencies), test naming clarity
- Triage: skip generated test code, snapshot-only tests, test config files
- Categories match the `testCategorySchema` enum

**Files that need NO changes** (already generic): `events.ts` (uses generic `ReviewIssue` type), `reviewer.ts` (`parseReviewIssues()` accepts any category string), `review-fixer.ts` (processes any perspective's issues), `cli/display.ts`, monitor UI (all generic to perspectives).

### R4: Architecture Review Stage

Add an `architecture-review-cycle` compile stage to the expedition profile that validates `architecture.md` against the PRD before module planning begins.

**Pipeline position** — Current: `planner → module-planning → cohesion-review-cycle → compile-expedition`. New: `planner → architecture-review-cycle → module-planning → cohesion-review-cycle → compile-expedition`. Architecture review runs after the planner writes `architecture.md` but before module planners build against it.

**`src/engine/events.ts`**:
- Add to `EforgeEvent` union:
  - `plan:architecture:review:start`
  - `plan:architecture:review:complete` with `issues: ReviewIssue[]`
  - `plan:architecture:evaluate:start`
  - `plan:architecture:evaluate:complete` with `accepted: number; rejected: number`

**`src/engine/config.ts`**:
- Add `'architecture-reviewer'` to `AGENT_ROLES`
- Add `'architecture-evaluator'` to `AGENT_ROLES`
- Update `expedition` profile compile stages: `['planner', 'architecture-review-cycle', 'module-planning', 'cohesion-review-cycle', 'compile-expedition']`

**`src/engine/agents/architecture-reviewer.ts`** (NEW):
- `runArchitectureReview()` async generator
- Options: `backend, sourceContent, planSetName, architectureContent, cwd, verbose, abortController`
- Loads `architecture-reviewer` prompt, runs one-shot with `tools: 'coding'`
- Parses `<review-issues>` via `parseReviewIssues()` from `reviewer.ts`
- Yields `plan:architecture:review:start/complete`

**Architecture evaluator approach** — leverage R1's consolidated evaluator:
- Add `'architecture'` as a third mode to the consolidated compile-phase evaluator (`mode: 'plan' | 'cohesion' | 'architecture'`)
- Add architecture-specific domain examples to the prompt template variables (accept patterns: unclear module boundary clarified, missing integration contract added; reject patterns: changes module decomposition strategy)
- Event types: `plan:architecture:evaluate:start/complete`
- Agent role: `'architecture-evaluator'` (add to `AGENT_ROLES`)
- This avoids creating yet another near-identical evaluator file

**`src/engine/prompts/architecture-reviewer.md`** (NEW):
- Role: architecture reviewer performing blind review of `architecture.md` against PRD
- Focus: module boundary soundness, integration contract completeness, shared file registry clarity, data model feasibility, alignment with PRD requirements
- Categories: reuse plan review categories (`cohesion`, `completeness`, `correctness`, `feasibility`, `dependency`, `scope`) via `getPlanReviewIssueSchemaYaml()`
- Vague language detection: same regex as plan-reviewer and cohesion-reviewer
- Fix instructions: write fixes to `architecture.md` unstaged, don't commit

**`src/engine/pipeline.ts`**:
- Import `runArchitectureReview` from `./agents/architecture-reviewer.js`
- Register `'architecture-review-cycle'` compile stage using `runReviewCycle()` helper:
  - Only runs when `ctx.expeditionModules.length > 0`
  - Reads `architecture.md` from plan directory
  - Reviewer: `runArchitectureReview({...})`
  - Evaluator: consolidated evaluator with `mode: 'architecture'`
  - Non-fatal (try-catch with progress message on skip)

**`src/engine/index.ts`**:
- Add barrel exports for `runArchitectureReview` and its options type

**`src/cli/display.ts`**:
- Add cases for `plan:architecture:review:start/complete` and `plan:architecture:evaluate:start/complete` event rendering

**Monitor UI** (if `event-card.tsx` handles events explicitly):
- Add cases for architecture review events in `eventSummary()`
- Add `'architecture-reviewer'` and `'architecture-evaluator'` to `REVIEW_AGENTS`, `AGENT_COLORS`, `AGENT_TO_STAGE` in `thread-pipeline.tsx`

## Scope

**In scope:**
- R3: `test` reviewer perspective (heuristics, schema, parallel-reviewer wiring, prompt, tests)
- R4: `architecture-review-cycle` compile stage (events, config, agent, prompt, pipeline registration, CLI display, monitor UI, tests)
- Extending the consolidated evaluator with `mode: 'architecture'`

**Out of scope:**
- R1 (consolidate plan/cohesion evaluators) and R2 (relocate `parseEvaluationBlock`) — assumed already complete
- Changes to `events.ts` generic `ReviewIssue` type, `reviewer.ts` `parseReviewIssues()`, `review-fixer.ts`, or other already-generic infrastructure
- Any new evaluator file — architecture evaluation reuses the consolidated evaluator

## Acceptance Criteria

- `pnpm type-check` passes
- `pnpm test` passes, including all new tests
- **R3 heuristic tests** (`test/review-heuristics.test.ts`):
  - `*.test.ts`, `*.spec.ts`, `test/**` files categorize into the `test` bucket
  - Test files trigger the `'test'` perspective
  - Test files don't also appear in the `code` bucket
- **R3 integration**: running a parallel review on a changeset containing test files triggers the test perspective
- **R4 agent wiring tests** (`test/agent-wiring.test.ts` or `test/architecture-review.test.ts`):
  - `runArchitectureReview` emits lifecycle events and parses review issues from XML
  - Architecture evaluator mode emits correct event types and counts verdicts
- **R4 pipeline**: running an expedition compile executes the `architecture-review-cycle` between planner and module-planning
- Monitor dashboard renders all new event types correctly
