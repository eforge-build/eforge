---
id: plan-01-consolidate-evaluators
name: Consolidate Evaluators and Relocate Parser
dependsOn: []
branch: agent-architecture-review-validated/consolidate-evaluators
---

# Consolidate Evaluators and Relocate Parser

## Architecture Context

eforge has two plan-phase evaluator agents - `plan-evaluator.ts` and `cohesion-evaluator.ts` - that are character-for-character identical except for interface name, event type strings, prompt name, and agent role string. Their prompts share ~95% structure with ~5 lines of domain-specific differences. Additionally, `parseEvaluationBlock()` and related types live in `builder.ts` despite being imported by both evaluators and tests - `common.ts` is their natural home since it already houses all provider-agnostic XML parsers.

Both refactorings are zero-behavioral-change. All event types, agent roles, CLI display, monitor UI, and tracing remain identical.

## Implementation

### Overview

Two independent refactorings executed in sequence:

**R1**: Merge `plan-evaluator.ts` and `cohesion-evaluator.ts` into a single parameterized runner function accepting `mode: 'plan' | 'cohesion'`. Unify the two prompt files into one with template variables for domain-specific lines. Delete `cohesion-evaluator.ts` and `cohesion-evaluator.md`.

**R2**: Move `parseEvaluationBlock()`, `extractChildElement()`, `EvaluationVerdict`, and `EvaluationEvidence` from `builder.ts` to `common.ts`. Update all import sites.

### Key Decisions

1. **Single `mode` parameter, not a generic options bag** - The two evaluators differ only in event prefix, prompt name, and role string. A `mode: 'plan' | 'cohesion'` discriminant is the simplest dispatch mechanism - no need for a factory or config object.

2. **Template variables in prompt, not string concatenation in TypeScript** - The prompt differences are small enough to handle with `{{mustache}}` variables injected via `loadPrompt()`. This keeps the prompt readable as a single document rather than fragmenting it across code.

3. **Preserve both exported function names as thin wrappers** - Export `runPlanEvaluate()` and `runCohesionEvaluate()` as thin wrappers around the consolidated `runEvaluate()` function. This preserves the existing call signatures in `pipeline.ts` and tests, keeping the change surgical. Both wrappers delegate to the same internal generator with `mode` set.

4. **Move parser to `common.ts`, not a new file** - `common.ts` already has the pattern: provider-agnostic XML parsers with no SDK imports. `parseEvaluationBlock` fits this convention exactly.

5. **`extractChildElement` stays private** - It's a helper used only by `parseEvaluationBlock`. Export only the parser function and the types.

## Scope

### In Scope
- Consolidating `plan-evaluator.ts` and `cohesion-evaluator.ts` into a single parameterized runner
- Unifying `plan-evaluator.md` and `cohesion-evaluator.md` into one prompt with template variables
- Deleting `cohesion-evaluator.ts` and `cohesion-evaluator.md`
- Relocating `parseEvaluationBlock`, `extractChildElement`, `EvaluationVerdict`, `EvaluationEvidence` from `builder.ts` to `common.ts`
- Updating imports in `pipeline.ts`, `index.ts`, `builder.ts`, test files

### Out of Scope
- Build-phase evaluator (`builderEvaluate()`) - different domain, different granularity (per-hunk, strictness injection)
- `STRICTNESS_BLOCKS` - stays in `builder.ts`, only used by `builderEvaluate()`
- Changing event types, agent roles, or any observable behavior
- Plan reviewer / cohesion reviewer consolidation

## Files

### Modify
- `src/engine/agents/plan-evaluator.ts` - Add `mode: 'plan' | 'cohesion'` parameter to internal runner. Add `EvaluatorMode` type. Create shared `PlanPhaseEvaluatorOptions` interface with `mode` field. Keep `PlanEvaluatorOptions` and `runPlanEvaluate()` as the public API; add `CohesionEvaluatorOptions` type alias and `runCohesionEvaluate()` wrapper that delegates with `mode: 'cohesion'`. The internal runner dispatches event types (`plan:evaluate:*` vs `plan:cohesion:evaluate:*`), prompt name (`plan-evaluator`), and backend role string (`plan-evaluator` vs `cohesion-evaluator`) based on mode.
- `src/engine/prompts/plan-evaluator.md` - Add template variables for the ~5 domain-specific lines: `{{evaluator_title}}` (title line), `{{evaluator_context}}` (context paragraph describing what was reviewed), `{{strict_improvement_bullet_1}}` (first bullet of the strict improvement list), `{{accept_patterns_table}}` (accept examples table rows), `{{reject_criteria_extra}}` (empty for plan mode, the "Module boundary change" criterion for cohesion mode). Renumber reject criteria to accommodate optional extra criterion.
- `src/engine/agents/common.ts` - Add `parseEvaluationBlock()`, `extractChildElement()` (non-exported), and type exports for `EvaluationVerdict` and `EvaluationEvidence`. Import `evaluationVerdictSchema` and `evaluationEvidenceSchema` from `../schemas.js`.
- `src/engine/agents/builder.ts` - Remove `parseEvaluationBlock()`, `extractChildElement()`, `EvaluationVerdict`, and `EvaluationEvidence` definitions. Import `parseEvaluationBlock` from `./common.js`. Re-export `EvaluationVerdict` and `EvaluationEvidence` types from `./common.js` for backwards compat (barrel already exports from builder).
- `src/engine/index.ts` - Change `parseEvaluationBlock` export source from `./agents/builder.js` to `./agents/common.js`. Change `EvaluationVerdict` and `EvaluationEvidence` type export source to `./agents/common.js`. Remove the `cohesion-evaluator` section; add `runCohesionEvaluate` and `CohesionEvaluatorOptions` exports to the `plan-evaluator` section.
- `src/engine/pipeline.ts` - Remove `import { runCohesionEvaluate } from './agents/cohesion-evaluator.js'`. Add `runCohesionEvaluate` to the existing `import { runPlanEvaluate } from './agents/plan-evaluator.js'` line.
- `test/agent-wiring.test.ts` - Import path already points to `plan-evaluator.js` - no change needed for plan-evaluator tests. Verify existing tests still pass.
- `test/cohesion-review.test.ts` - Change import from `../src/engine/agents/cohesion-evaluator.js` to `../src/engine/agents/plan-evaluator.js`.
- `test/xml-parsers.test.ts` - Change `parseEvaluationBlock` import from `../src/engine/agents/builder.js` to `../src/engine/agents/common.js`.

### Delete
- `src/engine/agents/cohesion-evaluator.ts`
- `src/engine/prompts/cohesion-evaluator.md`

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 (all existing tests pass, no new test failures)
- [ ] `cohesion-evaluator.ts` does not exist at `src/engine/agents/cohesion-evaluator.ts`
- [ ] `cohesion-evaluator.md` does not exist at `src/engine/prompts/cohesion-evaluator.md`
- [ ] `grep -r 'cohesion-evaluator' src/` returns zero matches (no lingering imports to the deleted file)
- [ ] `grep 'parseEvaluationBlock' src/engine/agents/builder.ts` returns only an import line from `./common.js`, not a function definition
- [ ] `grep 'parseEvaluationBlock' src/engine/agents/common.ts` returns a function definition (`export function parseEvaluationBlock`)
- [ ] `grep "mode.*plan.*cohesion" src/engine/agents/plan-evaluator.ts` confirms the mode parameter exists
- [ ] The cohesion-review-cycle stage in `pipeline.ts` calls `runCohesionEvaluate` (imported from `plan-evaluator.js`)
- [ ] Both `plan-evaluator` and `cohesion-evaluator` remain in `AGENT_ROLES` in `config.ts` (zero changes to that file)
- [ ] The cohesion-review test suite in `test/cohesion-review.test.ts` still exercises `runCohesionEvaluate` and asserts `plan:cohesion:evaluate:*` events
- [ ] The plan-evaluator test suite in `test/agent-wiring.test.ts` still exercises `runPlanEvaluate` and asserts `plan:evaluate:*` events
