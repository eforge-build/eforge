---
id: plan-03-control-plane-profile-routes
name: Extract Control-Plane and Profile Route Groups
branch: add-llm-friendly-code-rules-and-incrementally-refactor-monitor-server-routes/plan-03-control-plane-profile-routes
agents:
  builder:
    effort: high
    rationale: The enqueue/recovery/profile routes are stateful and require careful
      return-value conversion when moved into helpers.
---

# Extract Control-Plane and Profile Route Groups

## Architecture Context

Plan 02 established the handled-return route helper convention. This plan reduces the main callback by moving the first large route groups while preserving route order and the existing closure-local dependencies.

Full-file replacement of `packages/monitor/src/server.ts` is forbidden. Move contiguous route chunks and convert `return;` statements inside matched routes to `return true;` only after a response has been sent or delegated.

## Implementation

### Overview

Extract control-plane daemon routes and agent runtime profile routes from the `createServer` callback into ordered helpers. Insert those helpers in the dispatcher after CORS/keep-alive and before extension routes.

### Key Decisions

1. Keep helpers nested in the server factory so existing access to `options`, `cwd`, `db`, `notifyQueueMutation`, and helper functions does not require a large context object.
2. Split control-plane helpers if needed to keep new/moved functions below the Sonar cognitive-complexity threshold of 30 unless a local comment documents the exception.
3. Preserve `API_ROUTES` usage and derived route bases such as `CANCEL_BASE` and `PROFILE_BASE`.
4. Keep profile route response shapes opaque where they already call `redactSensitive` and profile metadata helpers.

## Scope

### In Scope

- Extract control-plane routes currently covering enqueue, cancel, recover, apply recovery, daemon stop, auto-build get/set, and scheduler kick.
- Extract profile routes covering list, show, use, create, and delete.
- Add route-group marker comments around each extracted helper.
- Update the dispatcher to call control-plane before profile, then continue to existing inline routes.
- Preserve all request validation messages, status codes, headers, side effects, and worker-spawn arguments.

### Out of Scope

- Extracting extension, playbook, session-plan, model/config, stack, monitor-data, unknown API, or static routes beyond what prior plans already extracted.
- Changing auto-build state serialization or daemon DB projection helpers.
- Changing profile storage formats.

## Files

### Modify

- `packages/monitor/src/server.ts` — Add control-plane and profile route helpers and remove their inline blocks from the main callback.

## Verification

- [ ] `pnpm vitest run packages/monitor/src/__tests__/auto-build-route.test.ts test/profile-wiring.test.ts test/apply-recovery-route.test.ts` exits 0.
- [ ] `POST ${API_ROUTES.enqueue}` still validates missing source before spawning a worker.
- [ ] `POST ${API_ROUTES.autoBuildSet}` still returns the `autoBuildStateToWire` response.
- [ ] Profile routes still use `API_ROUTES.profileList`, `API_ROUTES.profileShow`, `API_ROUTES.profileUse`, `API_ROUTES.profileCreate`, and `PROFILE_BASE` for delete.
- [ ] Each new helper returns `false` when no route in that group matches.