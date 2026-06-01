---
id: plan-02-console-plan-set-browsing
name: Console Plan-Set Browsing
branch: add-read-only-session-plan-set-apis-and-console-browsing/plan-02-console-plan-set-browsing
---

# Console Plan-Set Browsing

## Architecture Context

Console Planning Workspace currently lists flat session plans and opens a flat-plan detail view through daemon REST routes. This plan keeps that flat model intact and adds grouped plan-set artifacts as a second list item kind backed by the new read-only daemon/client contract from `plan-01-plan-set-api-contracts`.

Console must not read `.eforge/session-plans/` directly. All data comes from daemon routes via `API_ROUTES` and browser-safe wire types from `@eforge-build/client/browser`.

## Implementation

### Overview

Refactor the Planning Workspace list state to contain a discriminated union of flat session plans and session plan sets. Fetch flat plans and plan sets together, preserve flat plan selection/detail behavior, and add a plan-set detail component that renders umbrella context, validation diagnostics, and child metadata.

### Key Decisions

1. Keep `useSessionPlans` as the hook name to avoid churn outside the plans view, but change its internal list model to a local `PlanningArtifactListItem` union.
2. Encode selection keys as `plan:<session>` and `plan-set:<planSetId>` so flat plan sessions and plan-set directory ids cannot collide.
3. Render plan-set details in a dedicated component instead of overloading `SessionPlanDetail`; flat plan markdown preview behavior remains unchanged.
4. Use the existing Include handed off toggle for both artifact kinds by forwarding `includeSubmitted` to both list routes.

## Scope

### In Scope

- Fetch plan-set list/show data from daemon routes using `API_ROUTES`.
- Display flat session plans and plan sets in one Planning Workspace sidebar.
- Render plan-set row title, status, and child count.
- Render plan-set detail with umbrella anchor content or a missing-anchor diagnostic.
- Render each child id, file, kind, buildable flag, status, profile, dependencies, external references, and readiness/validation summary when present.
- Render validation summary and diagnostics from the show response.
- Update Console tests for combined browsing.
- Update Console README data-flow documentation.

### Out of Scope

- Plan-set creation controls.
- Plan-set update controls.
- Child enqueue, submit, or build handoff controls.
- Flat session-plan mutation behavior changes.
- System route plan-set surfaces.

## Files

### Create

- `packages/console-ui/src/views/plans/planning-artifacts.ts` — local discriminated union types, selection-key helpers, and list combination helpers for flat plans plus plan sets.
- `packages/console-ui/src/views/plans/session-plan-set-detail.tsx` — plan-set detail renderer for validation, umbrella anchor, diagnostics, and child metadata.

### Modify

- `packages/console-ui/src/views/plans/session-plan-fetches.ts` — add plan-set list/show/validate fetch helpers using `API_ROUTES` and `URLSearchParams`.
- `packages/console-ui/src/views/plans/use-session-plans.ts` — fetch both artifact lists, preserve selection by artifact key, and fetch detail for the selected kind.
- `packages/console-ui/src/views/plans/session-plan-selectors.ts` — keep existing flat-plan selectors and add artifact-key/default-selection helpers if not placed in `planning-artifacts.ts`.
- `packages/console-ui/src/views/plans/session-plan-list.tsx` — render flat plan rows and grouped plan-set rows from the union list.
- `packages/console-ui/src/views/plans/plans-view.tsx` — pass artifact keys to the list and switch between flat-plan and plan-set detail components.
- `packages/console-ui/src/views/plans/__tests__/session-plan-fetches.test.ts` — cover new fetch helpers and route constants.
- `packages/console-ui/src/views/plans/__tests__/session-plan-selectors.test.ts` — cover artifact-key selection and flat-plan selector compatibility.
- `packages/console-ui/src/views/plans/__tests__/plans-view.test.tsx` — cover combined flat/plan-set browsing, details, diagnostics, and absence of mutation controls.
- `packages/console-ui/README.md` — document that `/console/plans` browses flat session plans and read-only session plan sets through daemon REST.

## UI Behavior Details

- Initial load requests flat session plans and session plan sets with no `includeSubmitted` query.
- Toggling Include handed off requests both list routes with `includeSubmitted=true`.
- Flat rows retain their existing session/topic/status/readiness/path rendering.
- Plan-set rows show a grouped-artifact badge, `title`, `status`, and `<n> children`.
- Plan-set detail starts with plan-set title, manifest id, directory id, status, strategy, and validation state.
- Umbrella content renders before the child list when `anchorContent` exists.
- When the anchor is declared but missing, render a diagnostic block containing the `missing-anchor` code, the anchor file name, and text telling the user to create the anchor file or update `plan-set.yaml`.
- Child metadata renders from the summary only, including readiness/validation summary fields when present; do not fetch or display raw child markdown.
- Render external references as `kind: ref` text with optional title and URL when present.
- Do not add create, update, enqueue, submit, or build buttons for plan sets or children.

## Database Migration

None.

## Verification

- [ ] Planning Workspace initial load requests `API_ROUTES.sessionPlanList` and `API_ROUTES.sessionPlanSetList` with no `includeSubmitted` query.
- [ ] Include handed off toggle appends `includeSubmitted=true` to both list route requests.
- [ ] Existing flat session plan row and detail render session id, topic, status, readiness, and markdown body.
- [ ] Plan-set row renders fixture title, status, and child count.
- [ ] Selecting a plan-set row requests `API_ROUTES.sessionPlanSetShow` with the selected `planSetId` query value.
- [ ] Plan-set detail renders umbrella anchor content before the child metadata list.
- [ ] Missing-anchor fixture renders a diagnostic containing `missing-anchor` and the declared anchor file name.
- [ ] Child metadata renders id, file, kind, buildable flag, status, profile, dependencies, external references, and readiness/validation summary for a fixture child that includes readiness/validation data.
- [ ] Plan-set detail contains no text or button named `Create plan set`, `Update plan set`, `Enqueue child`, or `Submit child`.
- [ ] Existing Console hardcoded-route guard passes with no quoted `/api/` literals in new source.
