---
id: plan-02-resolved-planning-tasks
name: Resolved Planning Task Execution
branch: move-eforge-plan-prompts-to-extension-owned-tasks/plan-02-resolved-planning-tasks
agents:
  builder:
    effort: high
    rationale: Coordinates generic engine execution, daemon owner-scoped resolution,
      and several eforge-plan planning flows.
  reviewer:
    effort: high
    rationale: Touches extension owner validation and prompt asset path resolution,
      so review needs extra depth.
---

# Resolved Planning Task Execution

## Architecture Context

This plan uses the contribution contract from plan-01 to shift planning draft, session-plan creation, plan revision, and recommendation refresh starts onto eforge-plan-owned task contributions. The engine gains only a generic resolved-prompt runner: it accepts prompt text, variables, tools, cancellation, and result callbacks, then invokes the configured harness. The daemon/extension layer resolves owner-scoped contributions and prompt assets before engine invocation.

## Implementation

### Overview

Add a generic engine runner for resolved prompts, move planning submit/progress tool ownership into the eforge-plan extension, add eforge-plan planning contribution declarations, and update daemon task service resolution for owner-scoped starts. The legacy eforge-plan engine runner may remain unused until plan-03 removes all residual eforge-plan engine code.

### Key Decisions

1. **Resolved prompt text enters the engine, not prompt names.** The new engine runner accepts a prompt template string plus variables and calls the shared interpolation function. It does not accept file paths or prompt ids.
2. **The daemon resolves assets under the requesting extension root.** For action-started tasks, `options.owner` is authoritative. Direct route requests with `task.owner` must resolve to a loaded extension contribution; direct legacy kind requests are adapted outside engine execution only if the matching contribution is installed.
3. **Custom tools are extension-owned.** eforge-plan owns the submit/progress tool definitions, result validation, readiness checks, and missing-submission messages.
4. **Planning flows declare separate contributions even when they share prompt text.** `planning-draft`, `session-plan-creation`, `plan-revision`, and `recommendation-refresh` can reuse the planning prompt asset while preserving distinct owner-scoped task ids.

## Scope

### In Scope

- Generic resolved agent task runner in `@eforge-build/engine`.
- Shared fail-closed interpolation for kernel and extension-resolved prompts.
- eforge-plan planning prompt copied into extension-owned assets.
- eforge-plan planning submit/progress tools moved out of engine ownership.
- eforge-plan task declarations for planning draft, session-plan creation, plan revision, and recommendation refresh.
- eforge-plan actions updated to start owner-scoped contributions.
- Daemon service owner-scoped contribution resolution for non-curation planning tasks.
- Tests for generic runner behavior, unresolved variables, owner-scoped daemon resolution, lifecycle events, cancellation, and planning result validation.

### Out of Scope

- Backlog-curation item-audit and reducer contribution execution.
- Removing engine eforge-plan prompt files and legacy runner files; plan-03 completes the removal.
- Changing eforge-plan result schema semantics.

## Files

### Create

- `packages/engine/src/agents/resolved-agent-task.ts` — product-agnostic runner that renders resolved prompt templates, invokes `AgentHarness`, yields lifecycle events according to the existing verbose/always-yield rules, supports cancellation, downgrades late retryable infrastructure errors after accepted results, and returns `getResult()` output.
- `test/resolved-agent-task-runner.test.ts` — neutral fixtures covering prompt rendering, custom tool result capture, unresolved-variable failure before harness invocation, tool preset forwarding, cancellation signal forwarding, and absence of path-based prompt loading.
- `eforge/extensions/eforge-plan/prompts/eforge-plan-planning-draft.md` — exact moved copy of the current planning draft prompt text.
- `eforge/extensions/eforge-plan/planning-agent-tools.ts` — moved planning submit/progress custom tools and result validation logic, using SDK custom tool types instead of engine imports.
- `eforge/extensions/eforge-plan/agent-task-contributions.ts` — planning contribution declarations and shared resolver helpers for planning draft, session-plan creation, plan revision, and recommendation refresh.
- `packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts` — daemon service tests for owner-scoped contribution lookup, prompt asset loading, input validation, lifecycle events, cancellation, unknown task ids, and path-containment rejection.

### Modify

- `packages/engine/src/prompts.ts` — add/export `renderPromptTemplate(template, vars, append, label)` and make `loadPrompt()` use it so extension-resolved and kernel prompts share unresolved-token failure behavior.
- `test/prompts.test.ts` and `test/prompt-resolution.test.ts` — move eforge-plan prompt assertions to extension-owned prompt loading/rendering and add neutral `renderPromptTemplate` assertions.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — add contribution resolution, declared prompt asset loading, input schema validation, task metadata projection, and generic runner invocation for owner-scoped planning tasks.
- `packages/monitor/src/routes/extensions/contribution-service.ts` — pass the already loaded native extension registry into `agentTaskService.start()` from action contexts.
- `packages/monitor/src/routes/extensions/contributions.ts` — wire any service constructor/options changes needed by the action path.
- `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` — update route/service tests to use registered task contributions instead of engine prompt-name fallbacks; preserve assertions for lifecycle events, progress, failed submissions, and cancellation.
- `eforge/extensions/eforge-plan/index.ts` — register the four planning task contributions.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — start `planning-draft` or `session-plan-creation` contributions based on requested output sections; use contribution ids in retry/redraft flows.
- `eforge/extensions/eforge-plan/recommendation-refresh.ts` — start the `recommendation-refresh` contribution.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` — start the `plan-revision` contribution for revision turns and retries.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts`, `test/eforge-plan-agent-task-actions.test.ts`, and plan-revision tests — update expected start payloads to `{ task: { id: ... }, input: ... }`.

## Verification

- [ ] `runResolvedAgentTask()` renders `Hello {{name}}` with `{ name: 'Ada' }` and the harness receives `Hello Ada`.
- [ ] `runResolvedAgentTask()` throws an unresolved-template-variable error before `harness.run()` when `{{missing}}` is not supplied.
- [ ] A daemon service test starts an owner-scoped `neutral-task` contribution and the harness receives prompt text loaded from the declared asset.
- [ ] A daemon service test rejects a contribution whose declared asset path escapes the extension root.
- [ ] eforge-plan `start-planning-agent-task` starts `session-plan-creation` when `requestedOutputSections` includes `sessionPlanCreationDraft`.
- [ ] eforge-plan `start-plan-revision-turn` starts `plan-revision` and preserves `existingSessionPlan`, `sourceText`, `planningType`, and `planningDepth` in contribution input.
- [ ] eforge-plan `refresh-recommendations` starts `recommendation-refresh` and preserves recommendation source fingerprint workflow metadata.
- [ ] Existing submit tool rejection messages for malformed planning results still include `Submission rejected:`.
- [ ] Existing section progress updates still persist to task metadata and emit `extension:agent-task:progress` events.
- [ ] Cancelling a running owner-scoped task aborts the harness signal and persists `cancelled` status.
- [ ] `pnpm vitest run test/resolved-agent-task-runner.test.ts packages/monitor/src/__tests__/extension-agent-task-contribution-resolution.test.ts packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts test/eforge-plan-agent-task-actions.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.