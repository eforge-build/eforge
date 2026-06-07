---
id: plan-03-eforge-plan-ai-workstation-flow
name: eforge-plan AI Planning Actions and Workstation Flow
branch: add-daemon-owned-extension-agent-tasks-for-eforge-plan-ai-planning/plan-03-eforge-plan-ai-workstation-flow
agents:
  builder:
    effort: high
    rationale: Wires new daemon task APIs into a trusted extension, adds explicit
      preview/apply behavior, and updates bundled workstation assets.
---

# eforge-plan AI Planning Actions and Workstation Flow

## Architecture Context

`eforge-plan` is the first consumer of daemon-owned extension agent tasks. It owns backlog/session-plan state and result application semantics, while the daemon owns agent execution. The workstation must preview generated output and require explicit user confirmation before writing recommendations or session-plan content.

## Implementation

### Overview

Add eforge-plan actions for starting, reading, cancelling, and applying a planning agent task. Extend the planning workstation with a single-shot `Plan with AI` flow that prepares bounded context, starts a daemon-owned task, polls status, previews the result, and applies selected output through existing safe mutation paths.

### Key Decisions

1. The start action calls existing `preparePlannerContext` first, then passes that structured packet plus `userGoal` to `ctx.agentTasks.start` with `taskKind: 'eforge-plan.planning-draft'`.
2. The apply action fetches the completed task and writes only the user-selected portions: recommendations through `applyPlannerResult`, handoff drafts through existing promotion helpers, and session-plan draft sections through the session-planning adapter.
3. The workstation uses in-app two-step confirmation controls instead of `window.confirm`.
4. No generated output enqueues a build or marks backlog items shipped.

## Scope

### In Scope

- eforge-plan action schemas for start/get/cancel/apply planning task operations.
- Action registration, contribution blocks, and workstation allowed-action updates.
- Workstation UI for `Plan with AI` start, progress, cancel, result preview, and explicit apply controls.
- Mock bridge and production bundle updates.
- eforge-plan README updates for daemon-owned tasks and MVP limitations.
- Tests for extension action behavior, registration, workstation source/assets, and README contract.

### Out of Scope

- Multi-turn chat UI.
- Auto-application of generated output.
- Queue enqueue or autonomous backlog draining.
- Marking backlog items shipped from task output.

## Files

### Create

- `eforge/extensions/eforge-plan/agent-task-actions.ts` — start/get/cancel/apply planning task actions and helpers that use `ctx.agentTasks` plus existing planner/session-plan mutation helpers.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — action tests with a fake task API provider and temp project storage.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx` — workstation panel for task start/progress/result/apply.

### Modify

- `eforge/extensions/eforge-plan/schema.ts` — add input/output schemas for `start-planning-agent-task`, `get-planning-agent-task`, `cancel-planning-agent-task`, and `apply-planning-agent-task-result`; reuse client task schemas where possible.
- `eforge/extensions/eforge-plan/planner-actions.ts` — include the new task actions with the existing planner actions export.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — add helper functions for applying completed task results through recommendations, handoff drafts, and session-plan draft sections if action code needs shared logic.
- `eforge/extensions/eforge-plan/index.ts` — register new actions, add contribution controls, and add task actions to the workstation allowed-action list.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update expected action IDs, side effects, contribution blocks, and allowed actions.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — add coverage for task-result application helpers if implemented in this module.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — assert the workstation source/bundle invoke task actions through the bridge and require in-app confirmation for applying generated output.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — assert README coverage for daemon-owned tasks and unsupported chat.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add task record/result/progress types consumed by the UI.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — add mock responses for start/get/cancel/apply planning task actions.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` — render the `Plan with AI` panel using selected backlog items and recommendation refs.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add sample task result data.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` — rebuild production workstation bundle.
- `eforge/extensions/eforge-plan/workstation-assets/plans/style.css` — update production styles if the Vite build changes CSS.
- `eforge/extensions/eforge-plan/README.md` — document the daemon-owned task boundary, read-only MVP, unsupported multi-turn chat, and explicit preview/apply flow.

## Verification

- [ ] Registration tests list the four new planning task action IDs and show no action declares `build-queue` side effects.
- [ ] The start action calls `preparePlannerContext` and then calls `ctx.agentTasks.start` with `taskKind: 'eforge-plan.planning-draft'`, the user goal, and structured context.
- [ ] The get action returns the task API record for the requested task id.
- [ ] The cancel action delegates to `ctx.agentTasks.cancel` and returns the cancelled record.
- [ ] The apply action rejects running, failed, cancelled, missing-result, and wrong-kind task records.
- [ ] The apply action can write recommendations through existing recommendation storage without enqueueing a build.
- [ ] The apply action can write session-plan draft sections through the session-planning adapter without marking backlog items shipped.
- [ ] Workstation source contains task start/get/cancel/apply action IDs and no direct daemon `fetch` calls.
- [ ] Workstation source requires an in-app confirmation state before applying generated recommendations.
- [ ] Workstation source requires an in-app confirmation state before applying generated session-plan content.
- [ ] Production workstation assets are rebuilt from the updated source.
- [ ] eforge-plan README mentions daemon-owned tasks, read-only MVP tools, unsupported multi-turn chat, and explicit preview/apply.
