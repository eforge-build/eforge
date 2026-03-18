---
title: Add eforge attribution to commit messages
created: 2026-03-17
status: pending
---

## Problem / Motivation

Commits created by eforge - squash commits, agent commits, and operational commits - carry no attribution in git history. There's no way to distinguish eforge's contributions from human commits when browsing `git log`. Making eforge visible in commit history improves traceability and gives the tool proper credit for its work.

## Goal

All commits created by eforge should include the attribution trailer `Forged by eforge https://eforge.run` at the end of the commit message, applied consistently across both programmatic `git commit` calls and agent-driven commits via prompt templates.

## Approach

Define the attribution string once as a constant and inject it everywhere eforge creates a commit:

1. **Define constant and auto-inject into prompts** - Add `EFORGE_ATTRIBUTION` constant in `src/engine/prompts.ts`. Auto-inject it as `{{attribution}}` into all prompt templates via `loadPrompt`. Export the constant from `src/engine/index.ts` for use in programmatic commits.

2. **Update prompt templates** - Each prompt that instructs an agent to commit needs a multi-line commit message with the attribution as a trailer (after a blank line). Change single-line `-m "..."` patterns to multi-line messages with `\n\n{{attribution}}` appended.
   - `src/engine/prompts/builder.md` (line 53) - `feat(plan_id): plan_name`
   - `src/engine/prompts/evaluator.md` (line 195) - `feat(plan_id): plan_name`
   - `src/engine/prompts/plan-evaluator.md` (line 150) - `plan(plan_set_name): planning artifacts`
   - `src/engine/prompts/cohesion-evaluator.md` (line 150) - `plan(plan_set_name): planning artifacts`
   - `src/engine/prompts/validation-fixer.md` (line 29) - `fix: resolve validation failures`

3. **Update programmatic commits in engine code** - Import `EFORGE_ATTRIBUTION` and append `\n\n${EFORGE_ATTRIBUTION}` to commit messages in:
   - `src/engine/eforge.ts` - `composeSquashMessage()` (line 671), `cleanupPlanFiles()` (line 745)
   - `src/engine/pipeline.ts` - `commitPlanArtifacts()` (line 933), post-parallel-group auto-commit (line 908)

4. **Skip merge commits** - Merge commits in `src/engine/worktree.ts` are structural git operations, not eforge work product - no attribution needed.

## Scope

**In scope:**
- New `EFORGE_ATTRIBUTION` constant in `src/engine/prompts.ts`
- Auto-injection of `{{attribution}}` variable in `loadPrompt`
- Export from `src/engine/index.ts`
- Updates to all five prompt templates (`builder.md`, `evaluator.md`, `plan-evaluator.md`, `cohesion-evaluator.md`, `validation-fixer.md`)
- Updates to programmatic commit calls in `src/engine/eforge.ts` and `src/engine/pipeline.ts`

**Out of scope:**
- Merge commits in `src/engine/worktree.ts` (structural git operations, not work product)

## Acceptance Criteria

- `pnpm type-check` passes with no type errors
- `pnpm test` passes - all existing tests green
- `rg 'git.*commit.*-m' src/engine/` confirms no commit message sites were missed
- The attribution string `Forged by eforge https://eforge.run` appears exactly once per commit message, as a trailer after a blank line
- The attribution constant is defined in a single location (`src/engine/prompts.ts`) and reused everywhere
- Prompt templates use `{{attribution}}` injected by `loadPrompt`, not hardcoded strings
- Merge commits in `src/engine/worktree.ts` do not include attribution
