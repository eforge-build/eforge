---
id: plan-05-playbook-session-plan-routes
name: Extract Playbook and Session-Plan Route Groups
branch: add-llm-friendly-code-rules-and-incrementally-refactor-monitor-server-routes/plan-05-playbook-session-plan-routes
agents:
  builder:
    effort: high
    rationale: Playbook and session-plan routes share queue/session-plan behavior
      and include many request-validation branches.
---

# Extract Playbook and Session-Plan Route Groups

## Architecture Context

Playbook and session-plan routes bridge the daemon with `@eforge-build/input` and queueing behavior. The HTTP contract remains owned by `@eforge-build/client`, and route order must remain observationally unchanged.

Full-file replacement of `packages/monitor/src/server.ts` is forbidden. Move route chunks in bounded sections and preserve early-return behavior by converting completed route branches to `return true;`.

## Implementation

### Overview

Extract playbook and session-plan route handling from the main callback. Because `sessionPlanCreateFromPlaybook` currently sits between playbook route blocks, preserve the current observable order with a small ordered dispatcher that delegates to playbook-content, create-from-playbook, playbook-management, and session-plan helpers.

### Key Decisions

1. Keep route constants from `API_ROUTES` as the only source of truth.
2. Preserve queue mutation notifications after playbook enqueue operations.
3. Preserve validation error text for playbook names, session IDs, planning dimensions, and readiness checks.
4. Keep helper names and marker slugs aligned with future module extraction: `playbook` and `session-plan`.

## Scope

### In Scope

- Extract playbook list/show/save/run routes.
- Extract session-plan create-from-playbook route in its current relative order.
- Extract playbook promote/demote/validate/copy routes.
- Extract session-plan list/show/create/set-section/skip-dimension/set-status/select-dimensions/readiness/migrate-legacy routes.
- Update the dispatcher to call the playbook/session-plan route group after extension routes and before model/config routes.

### Out of Scope

- Changing playbook or session-plan schemas in `@eforge-build/input`.
- Changing queue semantics or enqueue worker arguments.
- Changing public daemon paths.
- Moving these routes to a new module.

## Files

### Modify

- `packages/monitor/src/server.ts` — Move playbook and session-plan route blocks into handled-return helpers and update the dispatcher.

## Verification

- [ ] `pnpm vitest run test/playbook-api.test.ts test/daemon-session-plan-routes.test.ts` exits 0.
- [ ] Playbook routes still use `API_ROUTES.playbookList`, `API_ROUTES.playbookShow`, `API_ROUTES.playbookSave`, `API_ROUTES.playbookRun`, `API_ROUTES.playbookPromote`, `API_ROUTES.playbookDemote`, `API_ROUTES.playbookValidate`, and `API_ROUTES.playbookCopy`.
- [ ] Session-plan routes still use `API_ROUTES.sessionPlan*` constants.
- [ ] `sessionPlanCreateFromPlaybook` remains evaluated before later session-plan CRUD routes in the dispatcher sequence.
- [ ] Each playbook/session-plan helper returns `false` when no route in that helper matches.