---
title: Add Daemon-Owned Extension Agent Tasks for eforge-plan AI Planning
created: 2026-06-07
landing: pr
landing_auto_merge: true
---

# Add Daemon-Owned Extension Agent Tasks for eforge-plan AI Planning

## Problem / Motivation

The current eforge-plan workstation can promote backlog selections into session-plan artifacts, but this is deterministic synthesis rather than the interactive and investigation-heavy planning behavior users are used to from `/eforge:plan`. The product direction is to let users live in Console while still getting LLM-assisted planning.

Evidence gathered:

- `docs/roadmap.md` says Console should be the canonical local-first control surface, planning workflow UX should live in extension-owned workstations, and Pi/Claude integrations should become thin launch/deep-link/status/build entry points.
- `eforge/extensions/eforge-plan/README.md` documents that planner orchestration is action-first through `prepare-planner-context` and `apply-planner-result`, daemon-owned chat state is unsupported, and general extension-owned AI chat runtime support is not implemented.
- `packages/extension-sdk/src/api.ts` exposes extension hooks/actions for event handling, `onAgentRun` prompt/tool augmentation, profile routers, input sources, PRD enrichers, reviewer perspectives, validation providers, actions, contributions, and workstations, but does not expose a generic `ctx.agent.run(...)` or extension-requested agent task API.
- `packages/extension-sdk/src/context.ts` shows extension contexts have logger, path helpers, shell exec, and per-hook metadata, but no LLM or harness invocation capability.
- `packages/engine/src/harness.ts` defines the existing `AgentHarness` abstraction and `ToolPreset` union: `coding`, `read-only`, and `none`.
- `packages/engine/src/agents/planner.ts` is a build-compile planner that runs through `AgentHarness.run(...)`, uses `tools: 'coding'`, emits `planning:*` events, and writes plan-set artifacts. It is not suitable as-is for extension workstation planning because the desired MVP is single-shot, structured-output, preview/apply, and read-only.
- Route/code search found existing extension action invocation and workstation bridge routes, plus build/compile agent runtime resolution, but no `agent-task` or extension-requested planning task route or storage path.

Working conclusion:

- The missing capability is a daemon-owned extension agent task runtime.
- Extensions should not call LLM providers directly.
- An extension should request a known structured task kind with bounded context.
- The daemon should own prompt templates, profile/tier/harness resolution, read-only tool enforcement, task persistence, event streaming, cancellation, and result validation.
- eforge-plan should be the first consumer with a single-shot planning task.

## Goal

Add a daemon-owned, extension-requested single-shot agent task capability and wire the first task kind into eforge-plan planning workflows. Users should be able to run AI-assisted planning from Console, preview the structured result, and explicitly apply accepted recommendations or session-plan content.

## Approach

### Key decisions

1. Use a daemon-owned task runtime, not extension-owned LLM calls.
   - Rationale: the daemon already owns profiles, harnesses, model/spend events, cancellation primitives, and local security. Direct provider calls from extensions would duplicate credentials/config and bypass observability.

2. Start with single-shot structured tasks only.
   - Rationale: the user explicitly wants single-shot first. This closes the current workstation gap without designing chat transcripts, message append semantics, or conversation memory.

3. Use known task kinds instead of extension-supplied prompt templates.
   - Rationale: task kinds let the daemon own prompt templates and output schemas. This avoids arbitrary prompt injection as a platform contract while still letting extensions supply structured context and a user goal.
   - Initial task kind: `eforge-plan.planning-draft` or `planning.recommendation-and-session-plan`.

4. Run through the existing default profile’s planner role/planning tier.
   - Rationale: this reuses current model/harness config and avoids a new config surface for the MVP.
   - The task runner should resolve `planner` through `AgentRuntimeRegistry.forRoleResolved('planner')` and `resolveAgentConfig('planner', ...)` or an equivalent exported helper.

5. Force read-only tools for agent tasks.
   - Rationale: planning needs code/docs inspection, not mutation.
   - `AgentRunOptions.tools` already supports `read-only`.
   - Existing reviewer/unknown-acceptance flows prove this preset is available.
   - The task runner should override the tool preset to `read-only` even when the planner role’s ordinary compile flow uses broader tools.

6. Use a structured submission custom tool, not prose parsing.
   - Rationale: existing planner code already uses custom submission tools and TypeBox validation.
   - A task-specific submission tool provides deterministic result capture, validation errors for retry, and clear completion semantics.

7. Persist task state in daemon-owned storage.
   - Rationale: task state is not eforge-plan backlog state.
   - Store task state under a daemon-owned project-local path such as `.eforge/storage/agent-tasks/<taskId>.json`.
   - Extension traces can reference task ids if useful.

8. Expose task access to extensions through action context.
   - Rationale: eforge-plan workstation code already uses `window.eforge.invokeAction`.
   - Add `ctx.agentTasks.start/get/cancel` to `ExtensionActionContext`.
   - eforge-plan can wrap task operations in its own allowed actions without exposing raw daemon routes to the sandboxed iframe.

9. Keep application separate from generation.
   - Rationale: agent task output should be previewed first.
   - Applying recommendations/session-plan sections should call existing eforge-plan mutation actions after explicit user confirmation.

10. Prefer additive MVP contracts.
   - Rationale: current extension action/workstation APIs can remain valid.
   - New task actions and events should be additive.
   - Bump the daemon API version only if first-party clients rely on the new contracts.

### Open design choice

The implementation must choose whether the background task service runs in the daemon process using the existing `AgentRuntimeRegistry` or spawns a worker subprocess. In-process is simpler and can use `AbortController`, but long-running LLM calls in the daemon may deserve worker isolation. The MVP can choose in-process if it keeps failures contained and persists status robustly.

### Architecture impact

This change crosses the client, daemon, engine, and extension boundary while keeping ownership separated.

- `@eforge-build/client` owns route constants, wire schemas, typed request/response helpers, and event variants for extension agent tasks.
- `@eforge-build/monitor` owns HTTP routing, task storage/projection, task lifecycle management, and broadcasting/persisting daemon-scoped task events.
- `@eforge-build/engine` continues to own `AgentHarness`, profile/tier runtime resolution, prompt templates, custom-tool structured submission, model/spend event emission, and read-only tool preset enforcement.
- `@eforge-build/extension-sdk` exposes a narrow daemon-owned task API to extension action handlers.
- Extensions request known task kinds with structured context but do not receive raw harness/provider access.
- `eforge/extensions/eforge-plan` owns eforge-plan-specific task request actions, planner context preparation, result preview/application, recommendation/session-plan updates, and workstation UI.
- `packages/console-ui` and the workstation bridge should continue avoiding private parent-Console imports in extension code.
- The eforge-plan iframe can use `window.eforge.invokeAction` to call eforge-plan actions that wrap the task API.

### Proposed data/control flow

1. User selects backlog items or a recommendation in the eforge-plan workstation.
2. The workstation invokes an eforge-plan action such as `start-planning-agent-task`.
3. The action calls existing eforge-plan preparation logic to build bounded structured context.
4. The action calls a new daemon-owned action-context API such as `ctx.agentTasks.start(...)`.
5. The daemon task service creates a task id.
6. The daemon task service persists an initial task record.
7. The daemon task service resolves the configured agent runtime for the `planner` role.
8. The daemon task service starts a background single-shot agent run.
9. The agent runs with `tools: 'read-only'`.
10. The agent uses a daemon/engine-owned prompt template selected by the task kind.
11. The prompt requires submission through a structured custom tool such as `submit_extension_planning_result`.
12. The structured tool handler validates and captures JSON output.
13. The service persists final result or failure state.
14. The service emits lifecycle events.
15. The service makes task status/result queryable.
16. The workstation polls via an eforge-plan action such as `get-planning-agent-task` or receives updates through existing Console/daemon event mechanisms if that is cheap.
17. The user reviews the structured result.
18. The user explicitly applies the result through existing eforge-plan actions such as `apply-planner-result`, `set-session-plan-section`, `put-recommendations`, or a purpose-built wrapper action.

### New or changed contracts

- Add client route keys for agent task start, get, and cancel if exposed directly.
- Add route/events used by the daemon service and task action wrappers at minimum.
- Add client event variants such as `extension:agent-task:start`, `extension:agent-task:progress`, `extension:agent-task:complete`, `extension:agent-task:failed`, and `extension:agent-task:cancelled`.
- Task events should include task id, extension name, task kind, status, timestamps, and sanitized error/result metadata.
- Add a JSON-safe task result schema for the eforge-plan planning result.
- The eforge-plan planning result schema should include summary.
- The eforge-plan planning result schema should include assumptions/open questions.
- The eforge-plan planning result schema should include a recommendation model delta or full model.
- The eforge-plan planning result schema should include session-plan draft sections.
- Bump `DAEMON_API_VERSION` if first-party Console/Pi/Claude/client code relies on new routes/events.

### Boundary constraints

- Extension code must not import provider SDKs or `AgentHarness` directly.
- Extension code must not supply raw prompt templates in this MVP.
- Agent task execution must not enqueue builds.
- Agent task execution must not mutate backlog/session plans by itself.
- Result application remains explicit and extension-owned.

### Recommended profile signal

Recommended profile: **Excursion**.

Rationale: this is a cross-package architecture feature, but it is a cohesive single capability with clear package boundaries and a bounded MVP. A single planner can enumerate the client, monitor, engine, extension-sdk, eforge-plan, Console/workstation, docs, and test changes without delegating independent module-planning work. Expedition would be premature unless implementation discovers that task execution isolation requires a much larger worker-process architecture redesign.

## Scope

Add a daemon-owned, extension-requested single-shot agent task capability and wire the first task kind into eforge-plan planning workflows.

### In scope

- Add typed client route constants, request/response schemas, and node/browser helpers for extension agent tasks.
- Add daemon/monitor routes and a task service that can start, inspect, and cancel extension-requested agent tasks.
- Add a runtime API on extension action contexts so trusted extension actions can start/read/cancel tasks without calling provider SDKs or raw HTTP themselves.
- Add the first task kind for eforge-plan AI planning, using structured context from existing eforge-plan planner actions such as `prepare-planner-context`.
- Run the task through the existing eforge agent runtime/profile machinery.
- Resolve the default profile’s `planner` role/planning tier unless a later explicit override is added.
- Force read-only tool execution for the planning task even if the selected profile’s normal planner role would otherwise expose broader tools.
- Persist task state/results under `.eforge/storage/agent-tasks` or an equivalent daemon-owned project-local storage path.
- Emit typed task lifecycle events so Console and daemon event views can observe task progress and failures.
- Extend eforge-plan with workstation actions/UI for a `Plan with AI` single-shot flow.
- The `Plan with AI` flow prepares context, starts a task, shows progress/result, and applies accepted structured output through existing safe eforge-plan actions.
- Document the new extension task boundary in extension docs, SDK README, and eforge-plan README.

### Out of scope

- Multi-turn chat or long-lived conversation state.
- Arbitrary extension-supplied prompt templates or raw free-form LLM prompts.
- Mutation-capable tools during agent task execution.
- Automatic application of task output without user review.
- Auto-mode backlog draining or autonomous queue orchestration.
- Retiring `/eforge:plan`, Pi backlog extension, or built-in session-plan/playbook compatibility surfaces.
- General marketplace/package permission policy beyond trusted local/project extensions.
- A broad task-kind plugin registry.
- The MVP may hardcode one known task kind and leave generic registration for a follow-up.

### Roadmap alignment

This supports the roadmap direction that Console should own rich planning workflows through extension-owned workstations, while keeping the engine headless and host integrations thin. It also respects the kernel boundary by making the daemon own agent execution/profile/tool policy and making eforge-plan own product-specific planning state and application semantics.

## Acceptance Criteria

- `@eforge-build/client` exports typed route constants for starting extension agent tasks.
- `@eforge-build/client` exports typed route constants for reading extension agent tasks.
- `@eforge-build/client` exports typed route constants for cancelling extension agent tasks.
- `@eforge-build/client` exports request schemas for starting extension agent tasks.
- `@eforge-build/client` exports request schemas for reading extension agent tasks.
- `@eforge-build/client` exports request schemas for cancelling extension agent tasks.
- `@eforge-build/client` exports response schemas for starting extension agent tasks.
- `@eforge-build/client` exports response schemas for reading extension agent tasks.
- `@eforge-build/client` exports response schemas for cancelling extension agent tasks.
- `@eforge-build/client` exports helper functions for starting extension agent tasks.
- `@eforge-build/client` exports helper functions for reading extension agent tasks.
- `@eforge-build/client` exports helper functions for cancelling extension agent tasks.
- The daemon exposes local-only typed HTTP handling for extension agent task start requests.
- The daemon exposes local-only typed HTTP handling for extension agent task status/read requests.
- The daemon exposes local-only typed HTTP handling for extension agent task cancellation requests.
- Starting an extension agent task returns a stable task id.
- Starting an extension agent task persists a task record with status `running` before the agent harness begins execution.
- Extension action handlers can start daemon-owned agent tasks through a typed action-context API without importing provider SDKs or `AgentHarness`.
- Extension action handlers can read daemon-owned agent tasks through a typed action-context API without importing provider SDKs or `AgentHarness`.
- Extension action handlers can cancel daemon-owned agent tasks through a typed action-context API without importing provider SDKs or `AgentHarness`.
- The initial eforge-plan planning task kind accepts structured context.
- The initial eforge-plan planning task kind accepts a user goal.
- The initial eforge-plan planning task kind rejects raw prompt-template input.
- The initial eforge-plan planning task resolves the existing configured `planner` role runtime from the active/default profile.
- The initial eforge-plan planning task invokes the agent harness with `tools: 'read-only'`.
- The initial eforge-plan planning task uses `tools: 'read-only'` regardless of the normal planner compile-stage tool preset.
- The initial eforge-plan planning task captures final output through a TypeBox-validated custom submission tool.
- The initial eforge-plan planning task does not capture final output by parsing free-form prose.
- Completed planning task records persist a JSON-safe result containing a summary.
- Completed planning task records persist a JSON-safe result containing assumptions or open questions.
- Completed planning task records persist a JSON-safe result containing an eforge-plan-applicable recommendation model or session-plan draft.
- Failed planning task records persist a sanitized error message.
- Failed planning task records emit a typed failure event.
- Failed planning task failures do not crash the daemon.
- Cancelling a running planning task aborts the agent run.
- Cancelling a running planning task updates the task status to `cancelled`.
- Cancelling a running planning task emits a typed cancellation event.
- The daemon emits a typed `extension:agent-task:start` event when an extension agent task starts.
- The daemon emits a typed `extension:agent-task:progress` event when extension agent task progress is reported.
- The daemon emits a typed `extension:agent-task:complete` event when an extension agent task completes.
- The daemon emits a typed `extension:agent-task:failed` event when an extension agent task fails.
- The daemon emits a typed `extension:agent-task:cancelled` event when an extension agent task is cancelled.
- Extension agent task lifecycle events include task id.
- Extension agent task lifecycle events include extension name.
- Extension agent task lifecycle events include task kind.
- Extension agent task lifecycle events include status.
- Extension agent task lifecycle events include timestamps.
- Extension agent task lifecycle events include sanitized error/result metadata.
- The eforge-plan extension registers an action that lets its workstation start a planning task.
- The eforge-plan extension registers an action that lets its workstation inspect task state/result.
- The eforge-plan extension registers an action that lets its workstation apply an accepted result through existing eforge-plan mutation paths.
- The eforge-plan workstation exposes a single-shot `Plan with AI` flow.
- The eforge-plan workstation `Plan with AI` flow shows task progress.
- The eforge-plan workstation `Plan with AI` flow requires explicit user confirmation before applying generated recommendations.
- The eforge-plan workstation `Plan with AI` flow requires explicit user confirmation before applying generated session-plan content.
- Generated planning task output never enqueues a build.
- Generated planning task output never marks a backlog item shipped by itself.
- Extension docs describe the daemon-owned agent task boundary.
- Extension docs describe the read-only MVP limitation.
- Extension docs describe the unsupported status of multi-turn chat.
- The SDK README describes the daemon-owned agent task boundary.
- The SDK README describes the read-only MVP limitation.
- The SDK README describes the unsupported status of multi-turn chat.
- The eforge-plan README describes the daemon-owned agent task boundary.
- The eforge-plan README describes the read-only MVP limitation.
- The eforge-plan README describes the unsupported status of multi-turn chat.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- Tests cover client schemas/helpers for extension agent tasks.
- Tests cover daemon task service/routes for extension agent tasks.
- Tests cover extension action-context task API behavior.
- Tests cover eforge-plan workstation/action behavior.

## Manual Verification Notes

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The daemon can access or construct an `AgentRuntimeRegistry` for standalone task execution. | `packages/monitor/src/types.ts` exposes `StartServerOptions.agentRuntimes`, and compile stages use `ctx.agentRuntimes.forRoleResolved('planner')`; `packages/engine/src/agent-runtime-registry.ts` can build a registry from config. | medium | low | Inspect daemon startup wiring and choose either `context.options.agentRuntimes` or an engine helper that builds from loaded config. | The task service may need a small engine/daemon helper before it can resolve harnesses reliably. |
| A read-only tool preset is sufficient for the first planning task. | `packages/engine/src/harness.ts` defines `ToolPreset = 'coding' \| 'read-only' \| 'none'`; existing reviewer and acceptance unknown resolver flows invoke harnesses with `tools: 'read-only'`. | high | low | Add a focused test that task execution passes `tools: 'read-only'` to a stub harness. | If read-only tools are too weak, AI planning may lack needed evidence; if too broad, it could mutate files unexpectedly. |
| Extension action context can grow an `agentTasks` API without breaking existing actions. | `packages/extension-sdk/src/contributions.ts` defines `ExtensionActionContext`; adding an optional or always-present field is an additive TypeScript/API change for existing handlers. | high | low | Compile extension SDK and existing extension tests after adding the field. | If the context shape cannot grow cleanly, the workstation may need a bridge or direct daemon route instead. |
| Known task kinds are enough for the MVP. | User explicitly agreed that extensions should supply structured task type + context while daemon owns prompt templates; current requested consumer is eforge-plan only. | high | low | Implement one closed task-kind union and leave task-kind registration for follow-up. | If other extensions immediately need custom tasks, the MVP may feel too narrow but remains safe. |
| In-process background execution in the daemon is acceptable for the MVP. | Existing daemon services already manage background-like operations and `AgentHarness.run` accepts `AbortSignal`; however normal builds run in workers, so this is not fully proven for long LLM runs. | medium | medium | Prototype with stub harness and one live harness; verify cancellation, failure containment, and daemon responsiveness. | If wrong, the implementation should switch to a worker/subprocess task runner before shipping. |
| eforge-plan can wrap task operations as extension actions for the workstation. | The workstation already uses `window.eforge.invokeAction`, and eforge-plan already registers action wrappers for planner context and result application. | high | low | Add `start/get/cancel/apply` action tests and workstation bridge tests. | If wrong, Console/workstation bridge APIs may need to expose task operations directly. |
| The initial structured result shape can cover recommendations and session-plan drafts. | Existing eforge-plan `apply-planner-result` accepts recommendation models and handoff drafts; session-plan action paths can update sections and metadata. | medium | low | Define the result schema and map it to existing eforge-plan mutation actions in tests. | If too narrow, generated output may need manual copy/paste or a follow-up schema expansion. |

No low-confidence/high-impact assumption is accepted silently. The main unresolved implementation choice is in-process versus worker-backed task execution; the plan records this as an explicit design choice with a validation path rather than pretending it is settled.