---
id: plan-01-finish-plan-04
name: "Finish Plan-04: Source Fix, Test Fixture Migration, New Tests, Plan-Load
  Validation"
depends_on: []
branch: complete-per-agent-runtime-configuration/finish-plan-04
agents:
  builder:
    effort: xhigh
    rationale: Large mechanical fixture migration across 25+ files plus 3 new tests
      plus plan-load validation. Fails fast without the AgentTerminalError
      source fix landing alongside. One-shot scope is broad; high reasoning
      keeps the builder from drifting during the repetitive fixture pass.
  reviewer:
    effort: high
    rationale: "Must verify no backend: 'claude-sdk' | 'pi' remnants and that the
      new tests actually assert rejection semantics + plan-load validation."
---

# Finish Plan-04: Source Fix, Test Fixture Migration, New Tests, Plan-Load Validation

## Architecture Context

The feature branch `eforge/per-agent-runtime-configuration-harness-model` carries a WIP commit (`212af9e`) where the source-side rename to `agentRuntimes` + harness terminology has landed but ~25 test fixtures still construct configs with the old scalar `backend: 'claude-sdk' | 'pi'` shape. The `configYamlSchema` now rejects that shape at parse time. Additionally, the `AgentTerminalError` constructor currently prepends `<subtype>: ` to `.message`, breaking idiomatic Error usage and failing one new test.

This plan closes A1-A4 of the PRD in a single coordinated commit set because the fixture migration cannot go green without the source fix, and the new behavior tests only become observable once the fixtures are migrated.

## Implementation

### Overview

1. Fix `AgentTerminalError` so `.message` is the plain detail (subtype lives on `.subtype`).
2. Migrate 25 test files that still use the old `backend: 'claude-sdk' | 'pi'` scalar inside `EforgeEngine.create({ config: ... })`.
3. Partially rewrite 3 test files that deliberately exercised the legacy shape - rewrite them to assert rejection of that shape.
4. Add 3 new tests for plan-level agentRuntime override precedence, legacy-config rejection message shape, and `agent:start` event payload carrying `{ agentRuntime, harness }`.
5. Add plan-load-time validation: in `packages/engine/src/plan.ts`, reject plan files that reference an `agentRuntime` name not declared in `config.agentRuntimes`.

### Key Decisions

1. **A1 and A2 land together.** Without the AgentTerminalError fix, `test/harness-rename.test.ts` stays red, which blocks the whole commit. They are a single atomic unit.
2. **Fixture migration uses the exact replacement pattern from the PRD.** Every `{ backend: 'claude-sdk' | 'pi', ...rest }` inside `EforgeEngine.create({ config })` call sites becomes `{ agentRuntimes: { default: { harness: 'claude-sdk' } }, defaultAgentRuntime: 'default', ...rest }`. Pi-backed tests use `harness: 'pi'`. The model tracker and related fields stay at the top level if they were already there.
3. **3 partially-rewritten tests shift semantics from acceptance to rejection.** `test/config.test.ts`, `test/config.agent-runtimes.schema.test.ts`, and `test/config-backend-profile.test.ts` retain coverage but now assert that `configYamlSchema.safeParse(...)` rejects scalar `backend:`, top-level `pi:`, and top-level `claudeSdk:` with a clear migration-pointer message. Profile-file fixtures (nested `backend: pi` inside `agentRuntimes.<name>`) remain valid.
4. **New tests are added under `packages/engine/test/`** (not `test/` at repo root) per the PRD's exact paths.
5. **Plan-load validation happens in the plan parser**, not deferred to resolver time, so dangling references fail loudly with the plan file path, role name, and referenced runtime name in the error.

## Scope

### In Scope

- `AgentTerminalError.message` fix in `packages/engine/src/harness.ts`.
- Mechanical fixture migration across 25 test files (A2 list in PRD).
- Partial rewrite of `test/config.test.ts`, `test/config.agent-runtimes.schema.test.ts`, `test/config-backend-profile.test.ts` to assert rejection of the legacy shape (reuse `test/stub-harness.ts` + `singletonRegistry(stub)` where a registry is needed).
- New test: `packages/engine/test/plan-file.agent-config.test.ts` - plan-level `agentRuntime` override precedence + validation failure on dangling ref.
- New test: `packages/engine/test/config.legacy-rejection.test.ts` - rejection-message shape for each of scalar `backend:`, top-level `pi:`, top-level `claudeSdk:`.
- New test: `packages/engine/test/events.agent-start.test.ts` - `agent:start` event carries `{ agentRuntime, harness }`, never `backend`.
- Plan-load-time validation in `packages/engine/src/plan.ts` for `agentRuntime` references.

### Out of Scope

- Any rename of `eforge/backends/` to `eforge/profiles/` (plan-03).
- Monitor-UI `backend` field rename to `harness` (plan-02).
- MCP / slash / HTTP route renames (plans 03-05).

## Files

### Create

- `packages/engine/test/plan-file.agent-config.test.ts` - plan-level agentRuntime override precedence + dangling-ref validation error.
- `packages/engine/test/config.legacy-rejection.test.ts` - rejection message shape for each of 3 legacy shapes.
- `packages/engine/test/events.agent-start.test.ts` - `agent:start` payload assertion for mixed-runtime config.

### Modify

- `packages/engine/src/harness.ts` - remove the `${subtype}: ` prefix in `AgentTerminalError` constructor; keep subtype on `.subtype`.
- `packages/engine/src/plan.ts` - validate each `PlanFile.agents.<role>.agentRuntime` exists in `config.agentRuntimes`; error message must include plan file path, role, and referenced runtime name.
- `test/watch-queue.test.ts` - fixture migration
- `test/greedy-queue-scheduler.test.ts` - fixture migration
- `test/engine-wiring.test.ts` - fixture migration
- `test/backend-common.test.ts` - fixture migration
- `test/gap-closer.test.ts` - fixture migration
- `test/monitor-reducer.test.ts` - fixture migration
- `test/continuation.test.ts` - fixture migration
- `test/cohesion-review.test.ts` - fixture migration
- `test/dependency-detector.test.ts` - fixture migration
- `test/doc-updater-wiring.test.ts` - fixture migration
- `test/evaluator-continuation.test.ts` - fixture migration
- `test/formatter-agent.test.ts` - fixture migration
- `test/merge-conflict-resolver.test.ts` - fixture migration
- `test/parallel-reviewer.test.ts` - fixture migration
- `test/pipeline-composer.test.ts` - fixture migration
- `test/pipeline.test.ts` - fixture migration
- `test/planner-continuation.test.ts` - fixture migration
- `test/planner-submission.test.ts` - fixture migration
- `test/prd-validator-fail-closed.test.ts` - fixture migration
- `test/retry.test.ts` - fixture migration
- `test/staleness-assessor.test.ts` - fixture migration
- `test/tester-wiring.test.ts` - fixture migration
- `test/validation-fixer.test.ts` - fixture migration
- `test/config.test.ts` - partial rewrite: drop `backendSchema` describe, rewrite `backend and pi validation` to assert `configYamlSchema` rejection; point `resolveConfig` / `mergePartialConfigs` coverage at `agentRuntimes`.
- `test/config-backend-profile.test.ts` - keep profile-file nested `backend: pi` fixtures intact; migrate only top-level config fixtures to `agentRuntimes`.
- `test/config.agent-runtimes.schema.test.ts` - rewrite legacy-coexistence assertions to rejection assertions.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `grep -R "backend: 'claude-sdk'\|backend: 'pi'" test/` returns zero matches.
- [ ] `grep -R "\\bbackendSchema\\b" packages/engine/src/` returns zero matches.
- [ ] `test/harness-rename.test.ts` assertion `err.message === 'Max turns exceeded'` passes.
- [ ] `packages/engine/test/plan-file.agent-config.test.ts` covers: (a) plan-level override beats role default, (b) plan referencing undeclared runtime fails plan-load with an error containing the plan file path, role name, and referenced runtime name.
- [ ] `packages/engine/test/config.legacy-rejection.test.ts` asserts rejection message includes `agentRuntimes:` and `defaultAgentRuntime:` migration pointer for each of scalar `backend:`, top-level `pi:`, top-level `claudeSdk:`.
- [ ] `packages/engine/test/events.agent-start.test.ts` asserts `agent:start` event payload exposes both `agentRuntime` and `harness` fields and contains no `backend` field, for a mixed-runtime config.
