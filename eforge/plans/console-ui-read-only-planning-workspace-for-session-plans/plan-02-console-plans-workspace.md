---
id: plan-02-console-plans-workspace
name: Console Plans Workspace UI
branch: console-ui-read-only-planning-workspace-for-session-plans/plan-02-console-plans-workspace
agents:
  builder:
    effort: high
    rationale: This plan adds a new route, navigation, data-fetching hook,
      interactive workspace UI, tests, and docs across console-ui.
  reviewer:
    effort: high
    rationale: The reviewer must check SPA routing, typed API usage, accessibility
      of controls, and submitted build-detail linking.
---

# Console Plans Workspace UI

## Architecture Context

`packages/console-ui/` is the active dashboard. Routing is a small in-memory parser/renderer in `src/lib/navigation.ts` and `src/app.tsx`; header links route through `ConsoleShell`/`Header`/`ControlSurfaceLinks`. Session-plan data comes from daemon/client route types and must not be re-parsed as an authoritative browser model.

This plan depends on `plan-01-session-plan-list-api` for the typed include-submitted query and `eforge_session` list field.

## Implementation

### Overview

Add `/console/plans` as a first-class read-only Planning Workspace. The view fetches active session plans by default, lets the user include handed-off/submitted plans, fetches the selected plan detail from the daemon, and renders metadata/readiness plus a scrollable markdown preview.

### Key Decisions

1. Use list/sidebar plus detail panel layout with existing shadcn-style primitives (`Card`, `Badge`, `Button`, `Switch`, `ScrollArea`, `Resizable`, and table/list patterns).
2. Fetch list data through `API_ROUTES.sessionPlanList` and `URLSearchParams`, with no inline `/api/...` strings.
3. Fetch selected detail via `API_ROUTES.sessionPlanShow`; use `SessionPlanShowResponse` as the source of metadata, dimensions, readiness, and markdown body.
4. Reuse the existing `PlanBodyHighlight` markdown renderer for preview rendering, but pass only the daemon-returned session-plan body.
5. Route submitted `eforge_session` links through `onNavigate(toConsolePath({ id: 'runDetail', detailId }))` when the handler is available so Console navigation stays in-app.

## Scope

### In Scope

- `/console/plans` route parsing and rendering.
- Plans navigation entry in the header/control surface.
- Read-only Planning Workspace view with active default filter and include-submitted switch.
- List/sidebar rows with session ID, topic, lifecycle status, readiness state, missing dimensions, path, and submitted build session when present.
- Selected-plan detail panel with session ID, topic, lifecycle status, planning type/depth, profile, required dimensions, optional dimensions, skipped dimensions, open questions, readiness detail, path, and `eforge_session` when present.
- Scrollable markdown body preview.
- Submitted build-detail links to `/console/runs/{eforge_session}`.
- Console UI tests for navigation, default filtering, include-submitted filtering, selected detail rendering, markdown preview rendering, and build-detail links.
- README route table and data-flow update for `/console/plans`.

### Out of Scope

- Creating or editing plans.
- Chat/free-form planning interaction.
- Agent-assisted workflows.
- Screenshot/image attachment support.
- Planning model/harness preference UI.
- Enqueue/build action buttons.
- Arbitrary file write/edit/bash capability.
- Abandoned-plan UI filters.

## Files

### Create

- `packages/console-ui/src/views/plans/index.ts` — barrel export for the route.
- `packages/console-ui/src/views/plans/plans-view.tsx` — top-level Planning Workspace component.
- `packages/console-ui/src/views/plans/use-session-plans.ts` — list/detail fetch state, selected session state, and refresh/include-submitted handling.
- `packages/console-ui/src/views/plans/session-plan-fetches.ts` — typed fetch functions using `API_ROUTES`, `URLSearchParams`, and response types from `@eforge-build/client/browser`.
- `packages/console-ui/src/views/plans/session-plan-selectors.ts` — view selectors for readiness labels, default selection, dimension labels, and optional summary counts.
- `packages/console-ui/src/views/plans/session-plan-list.tsx` — sidebar/list presentation for session plans.
- `packages/console-ui/src/views/plans/session-plan-detail.tsx` — selected workspace detail panel and metadata/readiness sections.
- `packages/console-ui/src/views/plans/session-plan-markdown-preview.tsx` — scrollable wrapper around the markdown preview renderer.
- `packages/console-ui/src/views/plans/__tests__/session-plan-fetches.test.ts` — verifies route constants and include-submitted query construction.
- `packages/console-ui/src/views/plans/__tests__/plans-view.test.tsx` — verifies filtering behavior, selection detail, markdown preview, and submitted build-detail links.
- `packages/console-ui/src/views/plans/__tests__/session-plan-selectors.test.ts` — verifies selector behavior if non-trivial selectors are added.

### Modify

- `packages/console-ui/src/lib/navigation.ts` — add `plans` route ID, label, route order entry, `toConsolePath()` case, parser case, and nav item entry.
- `packages/console-ui/src/app.tsx` — lazy-load/render `PlansView` for the new route and pass `onNavigate`.
- `packages/console-ui/src/components/header/control-surface-links.tsx` — render top-level Console nav links including Plans, call `onNavigate` on internal links, and keep the Monitor back-link.
- `packages/console-ui/src/__tests__/navigation.test.ts` — update route order/nav expectations and add `/console/plans` parse/path coverage.
- `packages/console-ui/src/__tests__/header.test.tsx` — assert the Plans navigation entry renders and invokes `onNavigate('/console/plans')` without relying on document reload.
- `packages/console-ui/src/__tests__/app.test.tsx` — mock the new lazy route and assert `/console/plans` renders the Plans route while unknown routes still render Now.
- `packages/console-ui/README.md` — add `/console/plans` to the route table and mention session-plan list/show daemon calls in the data-flow notes.
- `packages/console-ui/src/views/system/session-plans-section.tsx` — optional: add a compact link to `/console/plans`; keep the existing System summary functional if this file is changed.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` — update only if the System session-plan section receives the optional Planning Workspace link.

## UI Behavior Details

- Header label: `Plans`.
- Page title: `Planning Workspace`.
- Default filter label: `Actionable` for the default active set.
- Toggle label: `Include handed off` or `Include submitted`; choose one label and use it consistently in component text and tests.
- Empty active list text: `No actionable session plans found`.
- Empty submitted-inclusive list text: `No session plans found`.
- List rows must be buttons or anchors with accessible names containing the session ID and topic.
- Selected detail must fetch from `sessionPlanShow` after selection rather than deriving full detail from the list response.
- The markdown preview must render the body returned by `SessionPlanShowResponse.plan.body` in a scrollable region.
- Build-detail links must have `href` equal to `/console/runs/{eforge_session}` and use `onNavigate` when clicked inside the app.

## Verification

- [ ] `parseConsoleRoute('/console/plans')` returns `plans`.
- [ ] `toConsolePath('plans')` returns `/console/plans`.
- [ ] `buildNavItems()` includes a Plans item between Now and System.
- [ ] Clicking the Plans header link calls the supplied navigation handler with `/console/plans`.
- [ ] Rendering `App` at `/console/plans` mounts the Planning Workspace route.
- [ ] Rendering `App` at `/console/not-a-route` mounts the Now dashboard.
- [ ] The default Plans view fetches `API_ROUTES.sessionPlanList` without `includeSubmitted` and renders only returned active plans.
- [ ] Enabling the include-submitted control fetches the list with `includeSubmitted=true` and renders a submitted plan returned by the daemon.
- [ ] Selecting a plan fetches `API_ROUTES.sessionPlanShow?session=<selected>` and displays lifecycle status, planning type, planning depth, profile, dimensions, open questions, readiness detail, and path from the response.
- [ ] A submitted plan with `eforge_session: run-123` renders a link with `href="/console/runs/run-123"`.
- [ ] The markdown preview test observes text from `SessionPlanShowResponse.plan.body` inside the preview container.
- [ ] `packages/console-ui/README.md` lists `/console/plans` with route ID `plans`.