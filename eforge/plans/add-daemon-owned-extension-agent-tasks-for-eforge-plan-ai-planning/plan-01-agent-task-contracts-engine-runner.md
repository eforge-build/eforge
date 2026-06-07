---
id: plan-01-agent-task-contracts-engine-runner
name: Shared Agent Task Contracts and Engine Runner
branch: add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning/plan-01-agent-task-contracts-engine-runner
agents:
  builder:
    effort: high
    rationale: Defines new public client contracts, persisted event variants, and a
      read-only structured agent runner used by later plans.
  reviewer:
    effort: high
    rationale: Shared API/event contracts and read-only harness enforcement need
      API-focused review.
---

# Shared Agent Task Contracts and Engine Runner

## Architecture Context

`@eforge-build/client` owns daemon route constants, request/response schemas, event variants, and wire result shapes. `@eforge-build/engine` owns the first single-shot structured runner and prompt template. This plan creates those shared foundations before monitor and eforge-plan consume them.

## Implementation

### Overview

Add a closed `eforge-plan.planning-draft` task contract, task lifecycle events, client helpers, Console event-union updates, a DAEMON_API_VERSION bump, and an engine runner that forces `tools: 'read-only'` and captures output only through a TypeBox-validated custom submission tool.

### Key Decisions

1. Use a closed task-kind union for the MVP; do not accept extension-supplied prompt templates.
2. Put the eforge-plan planning result schema in the client package so monitor and eforge-plan import one wire contract.
3. Keep full task results out of lifecycle events; events carry sanitized metadata only.

## Scope

### In Scope

- Client task route constants for start, get, and cancel.
- TypeBox schemas/types for task requests, responses, task records, statuses, sanitized metadata, and eforge-plan planning results.
- Node and browser-safe task helper functions.
- Event variants: `extension:agent-task:start`, `extension:agent-task:progress`, `extension:agent-task:complete`, `extension:agent-task:failed`, and `extension:agent-task:cancelled`.
- Event registry metadata and semantic validation for sanitized task events.
- Console run-state/timeline updates for the new closed event variants.
- Engine prompt and runner for `eforge-plan.planning-draft`.
- DAEMON_API_VERSION bump for first-party task route/event support.

### Out of Scope

- Monitor route handlers, storage, background execution, and cancellation.
- Extension action-context task API.
- eforge-plan actions and workstation UI.
- Multi-turn chat, transcripts, arbitrary prompts, and mutation-capable tools.

## Files

### Create

- `packages/client/src/extension-agent-tasks.ts` — task schemas, parse helpers, types, and eforge-plan planning result wire schema.
- `packages/client/src/api/extension-agent-tasks.ts` — Node daemon helpers and `IfRunning` variants.
- `packages/client/src/browser-extension-agent-tasks.ts` — browser-safe same-origin fetch helpers.
- `packages/engine/src/agents/extension-planning-task.ts` — read-only structured planning-draft runner.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — daemon-owned prompt template.
- `packages/client/src/__tests__/extension-agent-tasks.test.ts` — client schema/helper tests.
- `packages/client/src/__tests__/events-schemas-extension-agent-tasks.test.ts` — task lifecycle event tests.
- `test/extension-planning-task.test.ts` — StubHarness tests for the engine runner.

### Modify

- `packages/client/src/routes/route-map.ts` — add task route keys.
- `packages/client/src/routes.ts` — re-export task route types if the route facade needs them.
- `packages/client/src/index.ts` — export task contracts and Node helpers.
- `packages/client/src/browser.ts` — export browser-safe task contracts and helpers.
- `packages/client/src/api-version-const.ts` — bump to v61 with an extension agent task note.
- `packages/client/src/events/variants/extensions.ts` — add task lifecycle variants.
- `packages/client/src/event-registry.ts` — register task lifecycle events as daemon-scoped persisted events.
- `packages/client/src/event-validation.ts` — reject raw prompt/context/result/transcript fields on task lifecycle events.
- `packages/client/src/__tests__/events-schema-test-helpers.ts` — add representative task lifecycle fixtures.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — add task lifecycle events to `IGNORED_EVENT_TYPES`.
- `packages/console-ui/src/components/timeline/event-card.tsx` — render task lifecycle event summaries/details.

## Verification

- [ ] Client task schema tests accept valid start/get/cancel payloads and reject a start request containing `promptTemplate`.
- [ ] Node helper tests send requests through `API_ROUTES` and `buildPath` for all three task routes.
- [ ] Event schema tests accept all five task lifecycle variants and reject events containing full `result`, `context`, `prompt`, or raw transcript fields.
- [ ] `DAEMON_API_VERSION` equals 61 and its comment mentions extension agent task routes/events.
- [ ] Console run-state exhaustiveness compiles with the new event variants.
- [ ] StubHarness runner tests record `tools === 'read-only'`.
- [ ] StubHarness runner tests complete only after `submit_eforge_plan_planning_result` is called.
- [ ] StubHarness runner tests throw when the agent emits prose without a submission tool call.
- [ ] Captured planning results contain `summary`, `assumptionsOpenQuestions`, and at least one applicable output section.
