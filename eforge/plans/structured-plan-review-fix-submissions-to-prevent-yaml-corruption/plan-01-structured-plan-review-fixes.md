---
id: plan-01-structured-plan-review-fixes
name: Structured plan-review fix submissions
branch: structured-plan-review-fix-submissions-to-prevent-yaml-corruption/main
---

# Structured plan-review fix submissions

## Architecture Context

The `plan-reviewer`, `cohesion-reviewer`, and `architecture-reviewer` agents currently use the SDK Write/Edit tools to mutate plan artifacts in place. Because the agents hand-author YAML, a fix that contains a colon-space sequence (`': '`) inside an unquoted scalar produces a malformed `orchestration.yaml` that `parseOrchestrationConfig` (`packages/engine/src/plan.ts:204-277`) rejects. `validatePlanSet` (`packages/engine/src/plan.ts:403-414`) then surfaces a `Failed to parse orchestration config` error and the plan-review-cycle phase fails.

The planner agent already avoids this hazard by submitting through `submit_plan_set` (a custom tool wired in `packages/engine/src/agents/planner.ts:83-101`), whose handler validates a Zod payload and writes via `writePlanSet` in `plan.ts`, which always serializes through `stringifyYaml`. This plan extends that pattern to the three plan-review-cycle reviewer agents and removes Write/Edit/NotebookEdit from their tool surface so the structural guarantee is enforced rather than merely documented.

The plan-evaluator workflow stays unchanged: applied fixes remain unstaged so `git diff` continues to feed the evaluator. The `<review-issues>` text emission also stays — only the path by which reviewer fixes hit disk changes.

## Implementation

### Overview

Introduce three discriminated-union submission schemas (one per reviewer role), three matching `apply...ReviewFixes` helpers in `plan.ts`, wire `customTools` + `disallowedTools` into the three reviewer agents, and rewrite the Fix Instructions section of the three reviewer prompts to direct the agent to the new tool.

### Key Decisions

1. **Discriminated union per reviewer.** Each reviewer's fix surface is small and well-defined, so a single union with a `kind` discriminator is simpler than separate tools.
   - `plan-reviewer` reviews orchestration.yaml + per-plan `.md` files: union over `replace_orchestration`, `replace_plan_file`, `replace_plan_body`.
   - `cohesion-reviewer` reviews module-plan `.md` files in `<planSet>/modules/`: union over `replace_plan_file` (full frontmatter + body) and `replace_plan_body` (preserve frontmatter). Cohesion-reviewer does not touch `orchestration.yaml`, so the orchestration variant is omitted.
   - `architecture-reviewer` reviews `architecture.md`: union with a single `replace_architecture` variant carrying the full markdown body. (`architecture.md` has no frontmatter and `index.yaml` is not in the architecture-reviewer's edit surface.)
2. **Full-file replacement, no patches.** Per the PRD, partial patches are out of scope; full-file replacements are simpler and the agent rewriting a whole plan body is a non-issue at the body sizes in play.
3. **Pipeline preservation on `replace_orchestration`.** Reviewers must not be required to know about `pipeline:`; the apply helper reads the existing `orchestration.yaml`, merges the agent-supplied fields over the on-disk object, and writes through `stringifyYaml`. Fields the agent did not touch (notably `pipeline`) are preserved.
4. **camelCase agent fields → snake_case on disk.** Submission schemas use `baseBranch` / `dependsOn` to match existing engine conventions; the apply helper translates these to `base_branch` / `depends_on` keys when writing the orchestration file (matching `writePlanSet` at `plan.ts:691-703`).
5. **No `git add` from apply helpers.** Fixes stay unstaged so the plan-evaluator's `git diff` workflow at the next pipeline stage continues to function unchanged.
6. **Frontmatter preservation regex.** `replace_plan_body` reuses the same regex shape as `parsePlanFile` (`/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/` at `plan.ts:143`) to extract the existing `---\n<frontmatter>\n---\n` prefix verbatim, then concatenates the new body. This guarantees byte-identical frontmatter preservation.
7. **Schema YAML reuse via `getSchemaYaml`.** Each new schema gets a `get<Role>SubmissionSchemaYaml()` helper that reuses the cached YAML formatter at `schemas.ts:284-320`, mirroring `getPlanSetSubmissionSchemaYaml` at line 669.
8. **Backend-visible tool name resolution via `harness.effectiveCustomToolName`.** Each reviewer's `runX` function resolves the effective tool name (Claude SDK prepends an MCP-server prefix; Pi returns the bare name) before injecting it into the prompt's `{{submitTool}}` placeholder, mirroring `runPlanner` at `planner.ts:179`.
9. **Disallow Write, Edit, NotebookEdit on the reviewer runs.** Each reviewer passes `disallowedTools: ['Write', 'Edit', 'NotebookEdit']` through `harness.run`. `AgentRunOptions.disallowedTools` is already supported at `harness.ts:109`; both the Claude SDK and Pi backends wire it through.
10. **Empty fixes allowed.** A reviewer that finds no actionable fix should still be able to call the tool with `{ fixes: [] }`, or skip calling the tool entirely. Apply helpers must no-op on an empty fix array. Issues are still parsed from agent text via `parseReviewIssues`.

## Scope

### In Scope

- New Zod schemas in `packages/engine/src/schemas.ts`:
  - `planReviewFixSchema` (3-variant discriminated union) and `planReviewSubmissionSchema = { fixes: planReviewFixSchema[] }`.
  - `cohesionReviewFixSchema` (2-variant discriminated union) and `cohesionReviewSubmissionSchema = { fixes: cohesionReviewFixSchema[] }`.
  - `architectureReviewFixSchema` (1-variant union — kept as a discriminated union with one `kind` for future extensibility) and `architectureReviewSubmissionSchema = { fixes: architectureReviewFixSchema[] }`.
  - Inferred TS types: `PlanReviewSubmission`, `CohesionReviewSubmission`, `ArchitectureReviewSubmission`.
  - YAML helpers: `getPlanReviewSubmissionSchemaYaml()`, `getCohesionReviewSubmissionSchemaYaml()`, `getArchitectureReviewSubmissionSchemaYaml()` (route through the existing `getSchemaYaml` cache).
  - Each schema reuses orchestration/agents building blocks where applicable; specifically the orchestration variant references shapes equivalent to `orchestrationPlanSchema` and `planAgentsSchema`.
- New apply helpers in `packages/engine/src/plan.ts` (placed after `injectPipelineIntoOrchestrationYaml`):
  - `applyPlanReviewFixes({ cwd, outputDir, planSetName, fixes })` — handles all three plan-reviewer variants.
  - `applyCohesionReviewFixes({ cwd, outputDir, planSetName, fixes })` — handles `replace_plan_file` and `replace_plan_body` against `<planSet>/modules/<planId>.md`.
  - `applyArchitectureReviewFixes({ cwd, outputDir, planSetName, fixes })` — handles `replace_architecture` against `<planSet>/architecture.md`.
- Submission-tool wiring in the three reviewer agents (`packages/engine/src/agents/{plan,cohesion,architecture}-reviewer.ts`):
  - Replicate the planner's `createPlanSetSubmissionTool` pattern (`planner.ts:83-101`) for each reviewer's submission schema.
  - Pass `customTools: [submissionTool]` and `disallowedTools: ['Write', 'Edit', 'NotebookEdit']` into `harness.run`.
  - After the run, if a payload was captured, call the matching `applyXReviewFixes` before `parseReviewIssues`. Issues stay parsed from agent text.
  - Resolve the backend-visible tool name via `harness.effectiveCustomToolName` and pass it into the prompt as `submitTool`.
  - Reuse the planner's `formatSubmissionValidationError` retry-friendly error formatter (export it from `planner.ts` or re-implement in a shared helper file). Decision: export `formatSubmissionValidationError` from `planner.ts` (rename to a shared utility location only if cross-import becomes awkward).
- Prompt rewrites in `packages/engine/src/prompts/{plan,cohesion,architecture}-reviewer.md`:
  - Rewrite the **Fix Instructions** section. Remove `Write the fix directly to the plan file using your editing tools`. Direct the agent to call `{{submitTool}}` with a `fixes` array, leaving `fixes: []` (or skipping the call) when nothing is fixable.
  - Add a new **Fix Submission Schema** section that interpolates `{{submission_schema}}`.
  - Note explicitly that `Write`, `Edit`, and `NotebookEdit` are unavailable.
  - Keep the existing `Do NOT stage / Do NOT commit` guardrails in the **Constraints** section as a backstop in case the agent has shell access.
- New test file `test/plan-review-fix-application.test.ts` covering:
  - `applyPlanReviewFixes` `replace_orchestration` round-trip with a `description` containing `: ` — assert `parseOrchestrationConfig` returns the exact string.
  - `applyPlanReviewFixes` `replace_orchestration` preserves `pipeline` when the fix payload omits it.
  - `applyPlanReviewFixes` `replace_orchestration` translates `baseBranch` → `base_branch` and `dependsOn` → `depends_on` on disk.
  - `applyPlanReviewFixes` `replace_plan_file` round-trip with a `name` containing `: ` — assert `parsePlanFile` returns the exact string.
  - `applyPlanReviewFixes` `replace_plan_body` preserves the existing frontmatter byte-identically.
  - `planReviewSubmissionSchema` rejects an unknown `kind` value.
  - `applyCohesionReviewFixes` `replace_plan_file` round-trip against `<planSet>/modules/<planId>.md`.
  - `applyCohesionReviewFixes` `replace_plan_body` preserves frontmatter byte-identically against a module file.
  - `applyArchitectureReviewFixes` `replace_architecture` writes the agent-supplied markdown to `<planSet>/architecture.md` verbatim.
  - `cohesionReviewSubmissionSchema` and `architectureReviewSubmissionSchema` each reject an unknown `kind` value.
  - `applyXReviewFixes` is a no-op for an empty `fixes` array (does not modify any file mtime).

### Out of Scope

- Changes to the plan-evaluator / cohesion-evaluator / architecture-evaluator. They continue to inspect unstaged changes via `git diff`.
- Removing the `<review-issues>` text emission. Issues are still parsed from agent text.
- The planner's existing submission flow (`submit_plan_set` / `submit_architecture`). Already correct.
- Partial patches over file fields. Full-file replacements only.
- Backporting the pattern to the `review-fixer` or `builder` agents. Those edit implementation code, not plan artifacts.
- Changes to `index.yaml` write/parse paths.

## Files

### Create

- `test/plan-review-fix-application.test.ts` — vitest covering all schema and apply-helper round-trips and rejection cases listed above. No mocks; constructs inputs inline; uses tmpdir-style fixture directories where filesystem I/O is required.

### Modify

- `packages/engine/src/schemas.ts` — append the three submission schemas, exported TS types, and `get*SubmissionSchemaYaml()` helpers next to the existing `planSetSubmissionSchema` / `architectureSubmissionSchema` blocks. Reuse `orchestrationPlanSchema` shape and `planAgentsSchema` building blocks where the orchestration variant overlaps. Keep schemas.ts leaf-level (no engine imports).
- `packages/engine/src/plan.ts` — add `applyPlanReviewFixes`, `applyCohesionReviewFixes`, `applyArchitectureReviewFixes` after `injectPipelineIntoOrchestrationYaml`. Reuse `parseYaml` / `stringifyYaml` already imported at line 6. Use the same frontmatter-extract regex shape as `parsePlanFile` at line 143. Do not run `git add`.
- `packages/engine/src/agents/plan-reviewer.ts` — add a `createPlanReviewSubmissionTool` factory mirroring `createPlanSetSubmissionTool` from `planner.ts:83-101`. Build `customTools` + `disallowedTools: ['Write', 'Edit', 'NotebookEdit']`. Resolve `submitTool` via `harness.effectiveCustomToolName` and pass it plus `submission_schema` into `loadPrompt`. After the harness loop, if a payload was captured, call `applyPlanReviewFixes` before `parseReviewIssues`.
- `packages/engine/src/agents/cohesion-reviewer.ts` — same wiring against `cohesionReviewSubmissionSchema` and `applyCohesionReviewFixes`.
- `packages/engine/src/agents/architecture-reviewer.ts` — same wiring against `architectureReviewSubmissionSchema` and `applyArchitectureReviewFixes`.
- `packages/engine/src/prompts/plan-reviewer.md` — rewrite Fix Instructions section (lines 37–58 in the current file), add `{{submission_schema}}` block, replace tool-name references with `{{submitTool}}`, and explicitly note Write/Edit/NotebookEdit are unavailable. Preserve the Output Format / Review Categories / Severity Mapping / Constraints sections.
- `packages/engine/src/prompts/cohesion-reviewer.md` — same rewrite, scoped to cohesion-reviewer's two-variant fix surface (no orchestration variant). Preserve all existing review categories and edit-region-marker validation logic.
- `packages/engine/src/prompts/architecture-reviewer.md` — same rewrite, scoped to the single `replace_architecture` variant. Preserve all existing review focus areas.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] `pnpm test` exits 0 with the new `test/plan-review-fix-application.test.ts` passing.
- [ ] Round-trip assertion in the new test passes for an `orchestration.description` containing `: ` (`parseOrchestrationConfig` returns the exact string written via `applyPlanReviewFixes`).
- [ ] Round-trip assertion in the new test passes for a plan `frontmatter.name` containing `: ` (`parsePlanFile` returns the exact string).
- [ ] `applyPlanReviewFixes` `replace_orchestration` preserves the existing `pipeline:` block when the fix omits it (asserted in the new test).
- [ ] `applyPlanReviewFixes` `replace_plan_body` preserves the existing frontmatter byte-identically (asserted in the new test by reading the file before and after and comparing the prefix).
- [ ] All three submission schemas reject an unknown `kind` value (`safeParse` returns `success: false`, asserted in the new test).
- [ ] All three reviewer agent files pass `customTools: [submissionTool]` and `disallowedTools: ['Write', 'Edit', 'NotebookEdit']` into `harness.run` (verifiable by code grep: `disallowedTools` references in `packages/engine/src/agents/{plan,cohesion,architecture}-reviewer.ts`).
- [ ] All three reviewer prompt files no longer contain the literal string `Write the fix directly to the plan file using your editing tools` (verifiable by grep returning zero matches).
- [ ] All three reviewer prompt files contain a `{{submission_schema}}` placeholder (verifiable by grep returning three matches).
- [ ] All three reviewer agent files pass a `submission_schema` key into `loadPrompt` (verifiable by grep returning three matches in `packages/engine/src/agents/{plan,cohesion,architecture}-reviewer.ts`).
- [ ] No `applyXReviewFixes` helper invokes `git add` (verifiable by grep for `git add` and `execAsync.*git.*add` in `packages/engine/src/plan.ts` returning zero new matches inside the apply helpers).
