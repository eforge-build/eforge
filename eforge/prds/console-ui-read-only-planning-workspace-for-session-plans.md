---
title: Console UI Read-Only Planning Workspace for Session Plans
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Console UI Read-Only Planning Workspace for Session Plans

## Problem / Motivation

Session plans are first-class eforge lifecycle artifacts, but `console-ui` currently exposes them only as a compact diagnostic section under System. Users cannot use the active dashboard to comfortably browse active plans, include handed-off/submitted plans, inspect parsed plan status, or view the plan markdown artifact.

This makes the console incomplete as an out-of-the-box eforge interface and keeps planning visibility dependent on Pi/Claude Code sessions or manual filesystem inspection.

This is a narrowed implementation slice from the broader planning direction captured in `2026-05-27-console-ui-plan-ux.md`.

Evidence reviewed:
- `packages/console-ui/README.md`: `console-ui` is the active monitoring dashboard at `/console/`; current canonical routes are Now, Build Detail, and System.
- `packages/console-ui/src/lib/navigation.ts` and `packages/console-ui/src/app.tsx`: routing is a small in-memory parser/renderer; adding a Plans route requires updating route IDs, parsing, nav items, and app rendering.
- `packages/console-ui/src/views/system/session-plans-section.tsx`: session plans currently appear only as a compact System subsection.
- `packages/client/src/api/session-plan.ts` and `packages/client/src/routes.ts`: typed session-plan API helpers/routes exist for list/show/create/mutate/readiness.
- `packages/input/src/session-plan.ts`: `listActiveSessionPlans()` currently returns only `planning` and `ready` plans, so submitted/handoff visibility needs an API/listing expansion.
- `packages/monitor/src/server.ts`: enqueue marks local session-plan sources as `submitted` and records `eforge_session`, which should be displayed and linked when present.

## Goal

Build a read-only Planning Workspace in `console-ui` that makes session plans visible as first-class workflow artifacts.

The workspace should provide routing, listing, status parsing, submitted/handoff visibility, metadata inspection, build-detail linking, and markdown preview without adding write/edit actions, agent workflows, or planning model configuration.

## Approach

Recommended profile: `excursion`.

This first slice is multi-package but cohesive: one console route/workspace, a bounded session-plan list API expansion, and tests. It does not require delegated module planning or agent-workflow architecture.

High-level implementation approach:
- Add `/console/plans` as a first-class route.
- Add a Plans navigation entry in the console header/control surface.
- Build a read-only Plans view with a list/sidebar and selected-plan workspace/detail panel.
- Show `planning` and `ready` plans by default.
- Add a user-visible control labeled in user language, such as “Actionable” for default plans and “Include handed off” or “Include submitted” for submitted plans.
- Expand the session-plan list API or query contract so `console-ui` can request submitted plans without changing existing active-plan behavior used by Pi/Claude workflows.
- Keep the session-plan markdown file and daemon parser as the source of truth.
- Render typed daemon responses and readiness data in `console-ui`; do not make browser-side markdown parsing authoritative.
- Use existing shadcn-style UI primitives where possible: Card, Badge, Button, Switch, Table, ScrollArea, Resizable, Select.
- Add missing shadcn-style primitives only if needed.
- Avoid over-custom layout work.
- Keep the existing System session-plan section functional.
- Simplify the existing System session-plan section to a compact summary/link if that is cleaner.
- Link submitted plans with `eforge_session` to `/console/runs/{eforge_session}`.
- Do not expose abandoned plans in the first slice unless it falls out naturally from a general status filter.
- Do not introduce planning model configuration in this slice.

Expected console UI code impact:
- `packages/console-ui/src/lib/navigation.ts`: add `plans` route ID, label, `toConsolePath`, `parseConsoleRoute`, nav item ordering, and tests.
- `packages/console-ui/src/app.tsx`: render the new Plans route, likely lazy-loaded.
- `packages/console-ui/src/components/header/control-surface-links.tsx` and related header tests: expose Plans navigation consistently with existing console shell patterns.
- New `packages/console-ui/src/views/plans/` module for the list/workspace UI, fetch hook, selectors, and tests.
- `packages/console-ui/src/lib/fetch-json.ts` or a new helper only if required by the chosen fetch pattern.
- Existing GET behavior may be enough for this read-only slice.
- `packages/console-ui/README.md`: update the route table and data-flow notes for `/console/plans`.

Expected client/API code impact:
- `packages/client/src/routes.ts`: add typed query/request shape if the existing `sessionPlanList` route gains status filters.
- `packages/client/src/api/session-plan.ts`: add typed helper options for listing plans by status while preserving existing `apiSessionPlanList` active-plan behavior or providing a clearly named compatibility helper.
- Browser exports from `@eforge-build/client/browser` must expose any new route/query types used by `console-ui`.

Expected input/daemon code impact:
- `packages/input/src/session-plan.ts`: add a generalized list helper such as `listSessionPlans({ cwd, statuses })`, or extend the existing helper without changing active-only defaults.
- `packages/monitor/src/server.ts`: update `GET /api/session-plan/list` to honor the new typed status/includeSubmitted query and to map rows/plans consistently.
- Ensure list/show responses include the fields needed by the workspace, especially `eforge_session`, dimension lists, skipped dimensions, open questions, profile, planning type/depth, body, readiness detail, and path.

Expected test impact:
- Add or adjust input tests for listing active versus submitted plans.
- Add or adjust daemon/client route tests for query behavior.
- Add `console-ui` tests for navigation.
- Add `console-ui` tests for default filtering.
- Add `console-ui` tests for include-submitted filtering.
- Add `console-ui` tests for selected workspace detail rendering.
- Add `console-ui` tests for markdown preview rendering.
- Add `console-ui` tests for submitted build-detail links.

Design decisions:
- Make `/console/plans` a first-class route because session plans are workflow artifacts, not just System diagnostics.
- Keep this slice read-only.
- Establish routing, listing, status parsing, submitted visibility, and markdown preview without adding mutations or agents.
- Preserve active-plan compatibility.
- If `GET /api/session-plan/list` is expanded, its default behavior should remain active-only (`planning`, `ready`) unless a query explicitly requests submitted plans.
- Alternatively, add a new helper that makes the status selection explicit while leaving old helpers unchanged.
- Use status filters that match user language.
- Workspace layout should favor visibility over editing.
- A good default layout is list/sidebar plus detail panel with metadata/status checklist on one side and markdown preview in a scrollable pane.
- Submitted handoff should connect lifecycle views by linking `eforge_session` to `/console/runs/{eforge_session}`.
- Planning model configuration belongs to later planning-agent workflow work.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---|---|---|---|
| The current session-plan list path only returns active plans. | Verified in `packages/input/src/session-plan.ts`: `listActiveSessionPlans()` filters to `planning` and `ready`. | high | low | Add tests before/with the generalized list helper. | Submitted/handoff toggle cannot work without API/input changes. |
| Submitted plans can include an `eforge_session` that links to build detail. | Verified in `packages/monitor/src/server.ts` comments/code path: enqueue marks session-plan sources as `submitted` and records `eforge_session`. | high | low | Add a fixture/session-plan test with `eforge_session`. | Build-detail linking may be incomplete if metadata is absent for older submitted plans. |
| Console-ui can support a first-class Plans route with its current routing architecture. | Verified `packages/console-ui/src/lib/navigation.ts` and `src/app.tsx` route parsing/rendering pattern. | high | low | Implement route tests first. | Route/nav implementation may be slightly larger if shell assumptions change. |
| The workspace can be read-only while still valuable. | User agreed to narrow first slice; current pain is visibility/status/handoff before agent workflows. | high | low | Validate with resulting UI before adding mutations. | If users need edits immediately, a follow-up slice will be needed soon. |
| Browser-side markdown parsing should not become authoritative. | Existing daemon/input code already parses session-plan frontmatter and readiness. | high | low | Keep UI using `SessionPlanShowResponse` and readiness fields. | Client-side authority would create drift and bugs. |
| Existing System session-plan section can coexist with a new Plans route. | Current section is isolated in `packages/console-ui/src/views/system/session-plans-section.tsx`. | medium | low | Decide during implementation whether to keep as summary or link. | Duplicate UI may feel redundant if not simplified. |

## Scope

In scope:
- Add a top-level `/console/plans` route.
- Add a Plans navigation entry in the console header/control surface.
- Add a Plans view that lists session plans.
- Show `planning` and `ready` plans by default.
- Add a user-visible control to include `submitted`/handed-off plans.
- Expand the session-plan list API or query contract so `console-ui` can request submitted plans without changing existing active-plan behavior used by Pi/Claude workflows.
- Add a selected-plan workspace/detail view.
- Show parsed plan metadata from daemon-returned session-plan data: session ID, topic, status, planning type/depth, profile, required dimensions, optional dimensions, skipped dimensions, open questions, readiness detail, path, and `eforge_session` when present.
- Render the session-plan markdown body in a scrollable preview.
- Link submitted plans with `eforge_session` to `/console/runs/{eforge_session}`.
- Keep the existing System session-plan section functional.
- Simplify the existing System session-plan section to a compact summary/link if that is cleaner.
- Add or adjust input tests for listing active versus submitted plans.
- Add or adjust daemon/client route tests for query behavior.
- Add console-ui tests for navigation, default filtering, include-submitted filtering, selected workspace detail rendering, markdown preview rendering, and submitted build-detail links.

Out of scope:
- Creating or editing plans.
- Chat/free-form planning interaction.
- Agent-assisted workflows such as plan review or recommendations.
- Screenshot/image attachment support.
- Planning model/harness preference UI.
- Enqueue/build action buttons.
- Any arbitrary file write/edit/bash capability.
- Agent workflows.
- Chat.
- Screenshots.
- Planning model preferences.
- Write/edit actions.

## Acceptance Criteria

- `/console/plans` renders a dedicated Plans view.
- The console header exposes a Plans navigation entry.
- Activating the Plans navigation entry routes to `/console/plans` without a full page reload.
- Unrecognized console routes still resolve to the Now dashboard.
- The Plans view lists session plans with session ID, topic, lifecycle status, readiness state, missing dimensions, and file path.
- The default Plans view shows plans with status `planning` or `ready`.
- The Plans view provides a user-visible control to include plans with status `submitted`.
- Enabling the submitted-plan control displays submitted session plans returned by the daemon.
- Submitted plans display their `eforge_session` value when the session plan contains one.
- Submitted plans with an `eforge_session` value link to `/console/runs/{eforge_session}`.
- Selecting a plan opens a workspace detail view for that plan.
- The workspace detail view shows the selected plan's session ID, topic, lifecycle status, planning type, planning depth, and profile.
- The workspace detail view shows required dimensions, optional dimensions, skipped dimensions, and open questions from the daemon response.
- The workspace detail view shows readiness detail with covered, missing, and skipped required dimensions.
- The workspace detail view renders the selected plan's markdown body in a scrollable preview.
- The session-plan list API supports a typed way to request submitted plans.
- The default session-plan list API behavior remains compatible with active-plan discovery by returning `planning` and `ready` plans when no submitted/include-all option is provided.
- Console-ui uses route constants and response types from `@eforge-build/client` or `@eforge-build/client/browser` instead of inline `/api/...` strings.
- `packages/console-ui/README.md` documents the `/console/plans` route.
- Input tests validate listing active plans versus submitted plans.
- Daemon/client route tests validate session-plan list query behavior.
- Console-ui navigation tests validate the `/console/plans` route.
- Console-ui filtering tests validate default filtering for `planning` and `ready` plans.
- Console-ui filtering tests validate include-submitted filtering.
- Console-ui workspace tests validate selected plan detail rendering.
- Console-ui workspace tests validate markdown preview rendering.
- Console-ui workspace tests validate submitted build-detail links.
- `pnpm --filter @eforge-build/console-ui test` exits 0.
- `pnpm type-check` exits 0.
