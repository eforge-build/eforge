---
id: plan-02-agent-retry-pipeline-tests
name: Split Agent Wiring, Retry, and Pipeline Tests
branch: reduce-and-refactor-oversized-test-files/plan-02-agent-retry-pipeline-tests
agents:
  builder:
    effort: high
    rationale: Three large orchestration-adjacent suites share StubHarness and
      pipeline helpers, so the refactor must preserve harness inputs and retry
      event assertions across moved files.
---

# Split Agent Wiring, Retry, and Pipeline Tests

## Architecture Context

Agent wiring, retry policy behavior, and pipeline execution tests validate the engine-facing agent harness boundary. Project policy requires tests to use real code and `StubHarness` for agent wiring, so this plan moves existing tests and extracts test-only helpers without adding mocks or production exports.

## Implementation

### Overview

Split `agent-wiring.test.ts`, `retry.test.ts`, and `pipeline.test.ts` by their existing role and pipeline-phase boundaries. Extract repeated `StubHarness`, plan-file, retry-attempt, and pipeline-context builders into test-only helper modules under `test/`.

### Key Decisions

1. Keep stage/role tests grouped by behavior: planner/reviewer/build/evaluator wiring, module/architecture/PRD validation wiring, runtime config/thinking coercion, parallel review, retry policies, continuation input builders, generic retry control flow, and pipeline compile/build phases.
2. Reuse `test/stub-harness.ts` for harness behavior and add only local helpers for fixture construction or assertion de-duplication.
3. Keep all tests under `test/**/*.test.ts` so existing Vitest include patterns discover the split files without config changes.

## Scope

### In Scope

- Reduce `test/agent-wiring.test.ts`, `test/retry.test.ts`, and `test/pipeline.test.ts` to 1,000 lines or fewer.
- Create focused suites for agent role wiring, retry policy/continuation/control-flow behavior, and pipeline compile/build/runtime concerns.
- Extract shared test helper builders when the helper file remains 1,000 lines or fewer.

### Out of Scope

- Changes to agent harness implementations, retry production policy definitions, pipeline stage behavior, or public pipeline APIs.
- Raw SDK imports outside the existing harness-owned locations.

## Files

### Create

- `test/agent-wiring-planner-review.test.ts` — planner, plan-review, review, and submission-tool naming wiring tests.
- `test/agent-wiring-build-evaluate.test.ts` — builder, evaluator, module planner, architecture reviewer/evaluator, and PRD validator wiring tests.
- `test/agent-wiring-config-runtime.test.ts` — stage descriptor metadata, `validatePipeline`, stage registry formatting, agent config resolution, thinking coercion, retry policy registration, and runtime registry profile override tests.
- `test/agent-wiring-parallel-review.test.ts` — parallel review decision and verify-perspective tests.
- `test/agent-wiring-helpers.ts` — shared plan, config, and `StubHarness` fixture builders for agent wiring suites.
- `test/retry-policies.test.ts` — default retry policy definitions and unregistered-role behavior.
- `test/retry-continuation-inputs.test.ts` — builder/evaluator/review-fixer continuation input construction tests.
- `test/retry-with-retry.test.ts` — retry loop control-flow, exhaustion, non-retryable error, and stream terminal tests.
- `test/retry-stub-harness-integration.test.ts` — `StubHarness` integration coverage for builder and evaluator retry paths.
- `test/retry-helpers.ts` — retry attempt/event fixture builders.
- `test/pipeline-compile.test.ts` — stage registry, compile pipeline, and planner expedition wiring tests.
- `test/pipeline-build.test.ts` — build pipeline, parallel stage groups, and dirty-worktree guard tests.
- `test/pipeline-config-runtime.test.ts` — mutable context, agent config threading, options type, default stage list, and tier model resolution tests.
- `test/pipeline-planner-dependencies.test.ts` — missing orchestration and authoritative dependency override tests.
- `test/pipeline-helpers.ts` — shared pipeline context, plan, and config builders.

### Modify

- `test/agent-wiring.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/retry.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.
- `test/pipeline.test.ts` — shrink to a focused subset or retire after moved suites; final file must be 1,000 lines or fewer.

## Verification

- [ ] `pnpm vitest run 'test/agent-wiring*.test.ts' 'test/retry*.test.ts' 'test/pipeline*.test.ts'` exits 0.
- [ ] `find test -maxdepth 1 -type f \( -name 'agent-wiring*.ts' -o -name 'retry*.ts' -o -name 'pipeline*.ts' \) -print0 | xargs -0 wc -l | awk '$2 != "total" && $1 > 1000 { found=1; print } END { exit found }'` exits 0.
- [ ] Every original `describe(` title from the three source files appears exactly once across the resulting split files.
- [ ] Agent wiring tests continue to use `StubHarness`; no mock framework is introduced.