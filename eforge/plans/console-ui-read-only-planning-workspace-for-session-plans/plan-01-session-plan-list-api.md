---
id: plan-01-session-plan-list-api
name: Session Plan List API Submitted Visibility
branch: console-ui-read-only-planning-workspace-for-session-plans/plan-01-session-plan-list-api
agents:
  builder:
    effort: high
    rationale: This plan touches shared input helpers, typed client contracts, and a
      large daemon route file; bounded edits and compatibility preservation need
      careful coordination.
  reviewer:
    effort: high
    rationale: The reviewer must verify additive API compatibility and that
      active-plan callers keep their current default behavior.
---

# Session Plan List API Submitted Visibility

## Architecture Context

Session plans are filesystem-backed input artifacts parsed by `@eforge-build/input` and exposed through typed daemon routes in `@eforge-build/client`. Console UI must request handed-off/submitted plans without changing existing active-plan discovery used by Pi and Claude workflows. This plan adds an additive query contract and keeps the no-query list behavior active-only (`planning`, `ready`).

Project constraints:
- Route constants and daemon wire shapes stay in `@eforge-build/client`.
- The daemon uses `@eforge-build/input` as the session-plan parser/source of truth.
- `packages/input/src/session-plan.ts`, `packages/monitor/src/server.ts`, and `test/daemon-session-plan-routes.test.ts` exceed 1,000 lines; edit them with bounded exact edits only.
- No database migration is required.

## Implementation

### Overview

Add a generalized input listing helper that accepts lifecycle statuses, expose a typed list query shape in the client package, and make `GET /api/session-plan/list` honor an explicit include-submitted query while preserving the current default.

### Key Decisions

1. Use an additive `includeSubmitted` query option for this slice. This satisfies the submitted-plan visibility requirement without exposing abandoned plans in the Console UI.
2. Add `listSessionPlans({ cwd, statuses })` and keep `listActiveSessionPlans({ cwd })` as a compatibility wrapper over `planning` + `ready`.
3. Include optional `eforge_session` on list entries so the Console list can show lifecycle links without fetching each plan detail first.
4. Do not bump `DAEMON_API_VERSION`; the route remains backward-compatible when called without the new query option.

## Scope

### In Scope

- Generalized input helper for listing session plans by status.
- Active-only default compatibility for `listActiveSessionPlans()` and `GET /api/session-plan/list`.
- Typed client query/request shape and helper options for requesting submitted plans.
- Optional `eforge_session` field on session-plan list entries and wire types.
- Daemon route parsing for `includeSubmitted=true` / `includeSubmitted=1`.
- Input, client-helper, and daemon tests covering default active listing and submitted listing.

### Out of Scope

- Session-plan mutation behavior.
- Abandoned-plan exposure in Console UI.
- Browser UI changes.
- Planning model configuration.
- Database schema changes.

## Files

### Create

- `test/session-plan-list-client.test.ts` — focused tests for the exported client list helper or any public list-path/query helper, covering no-query compatibility and `includeSubmitted=true` query construction.

### Modify

- `packages/input/src/session-plan.ts` — add `ListSessionPlansOpts`, `listSessionPlans()`, optional `eforge_session` on `SessionPlanListEntry`, and convert `listActiveSessionPlans()` into a wrapper with active statuses.
- `packages/input/src/index.ts` — export `listSessionPlans`, `ListSessionPlansOpts`, and the updated list entry type.
- `packages/client/src/routes.ts` — add `SessionPlanListRequest` (query shape) and optional `eforge_session` on `SessionPlanListEntryWire`.
- `packages/client/src/api/session-plan.ts` — accept optional `includeSubmitted` in `apiSessionPlanList()` and `apiSessionPlanListIfRunning()`, build the query string from `API_ROUTES.sessionPlanList`, and re-export the request type.
- `packages/client/src/index.ts` — export the new request/query type and any public helper introduced for list path construction.
- `packages/client/src/browser.ts` — export the new request/query type for Console UI browser code.
- `packages/monitor/src/server.ts` — update the session-plan list route to parse the query, call `listSessionPlans()` with active statuses plus submitted when requested, and return `eforge_session` when present.
- `test/session-plan.test.ts` — add tests for `listSessionPlans()` default/explicit statuses, submitted inclusion, `eforge_session`, and `listActiveSessionPlans()` compatibility.
- `test/daemon-session-plan-routes.test.ts` — add route tests for default active-only behavior and `includeSubmitted=true` behavior, including `eforge_session` in a submitted plan response.
- `test/client-no-start-api-helpers.test.ts` — update only if the typed helper signature requires fixture changes; no behavior change is expected for the no-start default call.

## Implementation Notes

- Keep the status set explicit in code:
  - default/active: `['planning', 'ready']`
  - include submitted: `['planning', 'ready', 'submitted']`
- Do not let malformed session-plan files fail the entire listing; preserve the existing skip-on-parse-error behavior.
- Keep sorting by session ID after filtering.
- When adding `eforge_session`, read it from parsed frontmatter and omit the property for plans that do not define it.
- Query parsing in the daemon must treat missing `includeSubmitted` as false.
- If a client URL builder is introduced, keep it local to `packages/client/src/api/session-plan.ts` unless tests need a public export.

## Verification

- [ ] Calling `listActiveSessionPlans({ cwd })` returns only `planning` and `ready` plans in session ID order.
- [ ] Calling `listSessionPlans({ cwd, statuses: ['planning', 'ready', 'submitted'] })` returns submitted plans and excludes abandoned plans.
- [ ] A submitted plan with `eforge_session: run-123` appears in list output with `eforge_session` equal to `run-123`.
- [ ] `GET /api/session-plan/list` without a query returns `planning` and `ready` plans only.
- [ ] `GET /api/session-plan/list?includeSubmitted=true` returns `planning`, `ready`, and `submitted` plans only.
- [ ] Existing callers of `apiSessionPlanList({ cwd })` compile without passing query options.
- [ ] The client list helper or public list-path helper has a test that asserts the default request omits `includeSubmitted` and the submitted request includes `includeSubmitted=true`.
- [ ] New client/browser exported types compile when imported from `@eforge-build/client` and `@eforge-build/client/browser`.