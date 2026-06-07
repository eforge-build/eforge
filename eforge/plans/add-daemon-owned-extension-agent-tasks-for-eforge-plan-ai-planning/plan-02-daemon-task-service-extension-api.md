---
id: plan-02-daemon-task-service-extension-api
name: Daemon Task Service and Extension Action API
branch: add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning/plan-02-daemon-task-service-extension-api
agents:
  builder:
    effort: high
    rationale: Implements local HTTP routes, background task lifecycle management,
      task persistence, cancellation, and action-context bridging across
      monitor, engine, and extension-sdk.
  reviewer:
    effort: high
    rationale: This plan touches local HTTP security, cancellation, and trusted
      extension boundaries.
---

# Daemon Task Service and Extension Action API

## Architecture Context

The daemon owns task lifecycle, local HTTP routing, persistence, profile/runtime resolution, cancellation, and event emission. Extension actions receive a narrow `ctx.agentTasks` API and never import provider SDKs or `AgentHarness`. This plan consumes the contracts from plan 01 and leaves eforge-plan-specific UI/actions to plan 03.

## Implementation

### Overview

Add an in-process monitor task service, JSON-file task storage under `.eforge/storage/agent-tasks`, local-only typed routes for start/get/cancel, and `ctx.agentTasks.start/get/cancel` wiring through the extension action dispatcher.

### Key Decisions

1. Use an in-process service for the MVP with an `AbortController` per running task.
2. Persist a `running` task record before queuing the background harness run.
3. Resolve the active/default profile at task start, then resolve the existing `planner` role with `AgentRuntimeRegistry.forRoleResolved('planner')` plus `resolveAgentConfig('planner', ...)`.
4. Pass resolved planner config to the engine runner from plan 01; the runner enforces `tools: 'read-only'`.
5. Use daemon-owned task events for observability and keep raw context/result payloads out of events.

## Scope

### In Scope

- Monitor task storage, task projection, and task lifecycle service.
- Local-only task start/read/cancel HTTP routes.
- Route registration updates so every `API_ROUTES` key has a monitor route.
- Extension SDK and engine action-runtime types for `ctx.agentTasks`.
- Monitor contribution dispatcher wiring that binds task requests to the invoking extension identity.
- Failure and cancellation handling that updates task records and emits typed events.
- Extension docs and SDK README updates for daemon-owned task boundaries.
- Tests for routes/service, action-context API, local security, persistence, events, and cancellation.

### Out of Scope

- Worker-process isolation.
- eforge-plan-specific actions and workstation UI.
- Generic task-kind registration by extensions.
- Multi-turn chat and arbitrary prompt templates.

## Files

### Create

- `packages/monitor/src/routes/extensions/agent-task-store.ts` — safe task-id validation, `.eforge/storage/agent-tasks` path resolution, atomic JSON read/write helpers, and record projection.
- `packages/monitor/src/routes/extensions/agent-task-events.ts` — helpers that emit the five typed lifecycle events with sanitized metadata.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — in-process start/get/cancel service with active `AbortController` tracking and planner runtime resolution.
- `packages/monitor/src/routes/extensions/agent-tasks.ts` — HTTP route handlers for start/get/cancel.
- `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` — route/service tests with a StubHarness-backed task run.
- `test/extension-action-agent-tasks.test.ts` — extension action dispatcher test proving `ctx.agentTasks` is present, typed structurally, and delegates start/get/cancel.

### Modify

- `packages/monitor/src/routes/extensions/index.ts` — create one task service per route set and register task routes; pass the service to contribution routes.
- `packages/monitor/src/routes/extension-content.ts` — add the three task route keys to `EXTENSION_CONTENT_ROUTE_KEYS`.
- `packages/monitor/src/routes/extensions/contributions.ts` — keep action invocation route behavior while passing task API wiring to the contribution service.
- `packages/monitor/src/routes/extensions/contribution-service.ts` — pass a per-extension task API provider into `dispatchExtensionAction`.
- `packages/engine/src/extensions/action-runtime.ts` — add `agentTasks` to action contexts, with an unavailable default for tests or runtimes that omit the provider.
- `packages/engine/src/extensions/types.ts` — add `agentTasks` to `ExtensionActionContextShape`.
- `packages/extension-sdk/src/contributions.ts` — define `ExtensionAgentTasksApi` and add `agentTasks` to `ExtensionActionContext`.
- `packages/extension-sdk/src/index.ts` — export the new task API type.
- `test/extension-sdk-example.test.ts` — include the new task API type in the type-export surface check if needed.
- `docs/extensions.md` — document daemon-owned single-shot agent tasks, read-only MVP limits, no raw prompts, and unsupported multi-turn chat.
- `docs/extensions-api.md` — add the `ctx.agentTasks` action-context API reference.
- `packages/extension-sdk/README.md` — describe the daemon-owned task boundary, read-only MVP limitation, and unsupported multi-turn chat.

## Verification

- [ ] Starting a task through the HTTP route returns a stable task id and writes a `running` JSON record before the StubHarness receives a call.
- [ ] Reading a task through the HTTP route returns the persisted record for the requested task id.
- [ ] Cancelling a running task aborts its controller, writes `status: 'cancelled'`, and emits `extension:agent-task:cancelled`.
- [ ] A StubHarness-backed completed task writes a completed record with a JSON-safe result and emits start, progress, and complete task events.
- [ ] A StubHarness failure writes `status: 'failed'`, stores a sanitized error message, emits `extension:agent-task:failed`, and leaves the daemon process running.
- [ ] Route tests reject non-loopback Host, cross-site browser headers, invalid JSON, invalid task ids, unknown task ids, and unsupported task kinds with the expected HTTP status codes.
- [ ] Action-runtime tests show `ctx.agentTasks.start`, `ctx.agentTasks.get`, and `ctx.agentTasks.cancel` call the provider without exposing `AgentHarness` or provider SDK imports to extension code.
- [ ] The monitor route aggregation test passes with exactly one registered route for every client `API_ROUTES` key.
- [ ] Docs mention daemon-owned tasks, read-only MVP tools, no raw prompt templates, and unsupported multi-turn chat.
