---
title: Structured plan-review fix submissions to prevent YAML corruption
created: 2026-04-30
---

# Structured plan-review fix submissions to prevent YAML corruption

## Problem / Motivation

The plan-reviewer agent currently writes fixes to plan artifacts directly via the Write tool, with prompt guidance at `packages/engine/src/prompts/plan-reviewer.md:41` that says "Write the fix directly to the plan file using your editing tools". When it rewrites `orchestration.yaml` it produces raw YAML by hand, bypassing `stringifyYaml` from `packages/engine/src/plan.ts:6`. This caused a build failure where the agent emitted an unquoted `description` scalar containing `: ` that the YAML parser correctly rejected as a nested mapping. `validatePlanSet` at `packages/engine/src/plan.ts:403-414` then surfaces "Failed to parse orchestration config" and the build phase fails immediately after compile.

The same risk exists for `cohesion-reviewer` and `architecture-reviewer`, which share the "edit files directly, leave unstaged" pattern.

## Goal

All three reviewer agents (plan-reviewer, cohesion-reviewer, architecture-reviewer) submit fixes through Zod-validated custom tools. The engine applies those fixes by calling `stringifyYaml` for every YAML field. Write, Edit, and NotebookEdit are removed from the reviewers' tool surface so the structural guarantee is enforced, not just documented. Existing `<review-issue>` text emission and the plan-evaluator's git-diff handoff stay intact - only the path by which fixes hit disk changes.

## Approach

1. **Add Zod schemas in `packages/engine/src/schemas.ts`** next to existing `planSetSubmissionSchema` and `architectureSubmissionSchema`.
   - Define `planReviewFixSchema` as a discriminated union with three cases:
     - `replace_orchestration` (full top-level orchestration fields)
     - `replace_plan_file` (planId + frontmatter + body)
     - `replace_plan_body` (planId + body)
   - Wrap in `planReviewSubmissionSchema = { fixes: planReviewFixSchema[] }`.
   - Allow empty fixes.
   - Reuse existing `orchestrationPlanSchema` and `planAgentsSchema` building blocks.
   - Export inferred TS types and a `getPlanReviewSubmissionSchemaYaml` helper.
   - Add parallel schemas for cohesion and architecture reviewers.

2. **Add `applyPlanReviewFixes` in `packages/engine/src/plan.ts`** after `injectPipelineIntoOrchestrationYaml`.
   - Signature takes `{ cwd, outputDir, planSetName, fixes }`.
   - For `replace_orchestration`: read existing `orchestration.yaml` to preserve fields the agent did not touch (notably `pipeline`), merge agent fields, write via `stringifyYaml`. Translate camelCase agent fields to snake_case on-disk keys (`baseBranch` to `base_branch`, `dependsOn` to `depends_on`).
   - For `replace_plan_file`: write `---\n` + `stringifyYaml(frontmatter).trim()` + `\n---\n\n` + body.
   - For `replace_plan_body`: regex-extract the existing frontmatter prefix using the same regex as `parsePlanFile` (line 143), preserve it, replace the body.
   - Function must NOT run `git add` - fixes stay unstaged for the plan-evaluator.
   - Mirror with `applyCohesionReviewFixes` and `applyArchitectureReviewFixes`.

3. **Wire the submission tool into `packages/engine/src/agents/plan-reviewer.ts`** mirroring the planner's `createPlanSetSubmissionTool` pattern at `packages/engine/src/agents/planner.ts:83-101`.
   - Inject `customTools` and add `disallowedTools` of Write, Edit, and NotebookEdit.
   - The harness already supports both knobs at `packages/engine/src/harness.ts:109` and 113.
   - After the agent run, if a submission was captured, call `applyPlanReviewFixes` before `parseReviewIssues`.
   - Issues remain parsed from agent text.
   - Apply the same wiring to cohesion-reviewer and architecture-reviewer.

4. **Update `packages/engine/src/prompts/plan-reviewer.md`.**
   - Rewrite the Fix Instructions section at lines 37-58.
   - Remove "Write the fix directly to the plan file using your editing tools".
   - Add direction to submit fixes via the `{{submitTool}}` placeholder.
   - Note Write/Edit/NotebookEdit are unavailable.
   - Reference the schema YAML via a new `{{submission_schema}}` placeholder.
   - Wire those placeholders in `runPlanReview` analogously to `runPlanner` at lines 200-214 using `harness.effectiveCustomToolName`.
   - Keep "Do NOT stage / Do NOT commit" guardrails as a backstop.
   - Apply parallel updates to the cohesion-reviewer and architecture-reviewer prompt files.

5. **Tests.** Add `test/plan-review-fix-application.test.ts` covering:
   - `replace_orchestration` round-trip with a description containing `: ` and asserting `parseOrchestrationConfig` returns the exact string.
   - `replace_orchestration` preserves pipeline when the fix omits it.
   - `replace_plan_file` frontmatter round-trip with a name containing `: `.
   - `replace_plan_body` preserves frontmatter byte-identical.
   - Schema rejects unknown fix type.
   - Add equivalent tests for cohesion and architecture helpers.

## Scope

### Files to modify

- `packages/engine/src/schemas.ts`
- `packages/engine/src/plan.ts`
- `packages/engine/src/agents/plan-reviewer.ts`
- `packages/engine/src/agents/cohesion-reviewer.ts`
- `packages/engine/src/agents/architecture-reviewer.ts`
- `packages/engine/src/prompts/plan-reviewer.md`
- `packages/engine/src/prompts/cohesion-reviewer.md`
- `packages/engine/src/prompts/architecture-reviewer.md`

### Files to create

- `test/plan-review-fix-application.test.ts`

### Out of scope

- Plan-evaluator workflow changes. It still inspects unstaged changes via git diff.
- Removing `<review-issue>` text emission.
- Planner submission flow. `submit_plan_set` already uses `stringifyYaml`.
- Partial patches over file fields. Full-file replacements are simpler.
- Backporting to review-fixer or builder agents. They edit implementation, not plan artifacts.

## Acceptance Criteria

- `pnpm type-check` exits 0.
- `pnpm build` exits 0.
- `pnpm test` exits 0 with the new test file passing.
- Round-trip assertion passes for a description containing `: `.
- Re-enqueue the previously failed cancel-build-button PRD. The plan-review-cycle completes without a YAML parse error.
- `grep -n ': .*: ' eforge/plans/*/orchestration.yaml` after a build returns nothing.
- Query `monitor.db SELECT data FROM events WHERE type='agent:tool_use' AND agent='plan-reviewer' AND data LIKE '%"tool":"Write"%'` returns zero rows for new runs.
