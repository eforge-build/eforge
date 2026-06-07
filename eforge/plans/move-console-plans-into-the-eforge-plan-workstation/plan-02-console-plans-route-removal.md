---
id: plan-02-console-plans-route-removal
name: Remove the Core Console Plans Route
branch: move-console-plans-into-the-eforge-plan-workstation/plan-02-console-plans-route-removal
---

# Remove the Core Console Plans Route

## Architecture Context

After the extension workstation from plan 01 exists, the core Console must no longer expose a first-party planning product route. The Console remains the shell, build observability/control surface, System/configuration surface, and workstation host. Planning-specific browsing and mutation UI moves under `/console/workstations` as an extension-owned iframe.

## Implementation

### Overview

Delete the `plans` route ID from Console navigation and routing, remove the lazy `PlansView` import/render branch, delete the now-unreachable `src/views/plans/` route implementation and its tests, and update Console route/header/app tests to lock in fallback-to-Now behavior for the removed path.

### Key Decisions

1. Remove the route ID rather than hiding the nav item. Keeping `plans` in route types or parser branches would preserve a first-party product surface.
2. Treat the removed path as an unrecognized/deleted route. `parseConsoleRoute('/console/plans')` must return `now`, matching the existing behavior for deleted `queue` and `activity` paths.
3. Delete the route implementation files instead of retaining a hidden core Plans view. Reusable planning projection logic now lives in the `eforge-plan` extension from plan 01.

## Scope

### In Scope

- Remove `plans` from route types, ordering, labels, path mapping, parser branches, and nav items.
- Remove the `PlansView` lazy import and render branch from the Console app.
- Delete `packages/console-ui/src/views/plans/` and its route-specific tests.
- Update Console navigation, app, and header tests for the deleted route and absent nav item.
- Update the Console README route table and planning data-flow text so planning product UX is documented as extension-workstation-owned.

### Out of Scope

- No daemon/client session-plan or plan-set route changes.
- No Pi, Claude, or CLI command changes.
- No System session-plan section changes; plan 03 removes that remaining first-party summary surface.

## Files

### Delete

- `packages/console-ui/src/views/plans/index.ts`
- `packages/console-ui/src/views/plans/planning-artifacts.ts`
- `packages/console-ui/src/views/plans/plans-view.tsx`
- `packages/console-ui/src/views/plans/session-plan-detail.tsx`
- `packages/console-ui/src/views/plans/session-plan-fetches.ts`
- `packages/console-ui/src/views/plans/session-plan-list.tsx`
- `packages/console-ui/src/views/plans/session-plan-markdown-preview.tsx`
- `packages/console-ui/src/views/plans/session-plan-selectors.ts`
- `packages/console-ui/src/views/plans/session-plan-set-detail.tsx`
- `packages/console-ui/src/views/plans/use-session-plans.ts`
- `packages/console-ui/src/views/plans/__tests__/plans-view.test.tsx`
- `packages/console-ui/src/views/plans/__tests__/session-plan-fetches.test.ts`
- `packages/console-ui/src/views/plans/__tests__/session-plan-selectors.test.ts`

### Modify

- `packages/console-ui/src/lib/navigation.ts` — remove `plans` from `ConsoleRouteBaseId`, `ConsoleRouteId`, `consoleRouteOrder`, `ROUTE_LABELS`, `toConsolePath`, `parseConsoleRoute`, and `buildNavItems`.
- `packages/console-ui/src/App.tsx` — remove the `PlansView` lazy import and `currentRoute === 'plans'` render branch.
- `packages/console-ui/src/__tests__/navigation.test.ts` — update route order/nav expectations, remove `toConsolePath('plans')`, and assert the removed plans path parses to `now` using a constructed string.
- `packages/console-ui/src/__tests__/app.test.tsx` — remove the `@/views/plans` mock and assert initial render at the removed path mounts `NowDashboard`.
- `packages/console-ui/src/__tests__/header.test.tsx` — assert no nav button labelled `Plans` exists and no click target navigates to the removed path.
- `packages/console-ui/README.md` — remove the `/console/plans` route row and replace the Planning Workspace data-flow section with extension-workstation ownership plus compatibility-route plumbing language.

## Implementation Notes

- `toConsolePath('now')` must still return `/console/`.
- `buildNavItems()` must return only Now, Workstations, and System for top-level navigation.
- Avoid adding literal deleted route strings to route-audit-sensitive tests. Construct the removed path from segments where existing tests use that pattern.
- After deleting `src/views/plans/`, run a repository search for `@/views/plans`, `PlansView`, `Planning Workspace`, and `parseConsoleRoute` expectations that still mention a `plans` result.

## Database Migration

None.

## Verification

- [ ] `packages/console-ui/src/lib/navigation.ts` has no `plans` member in `ConsoleRouteBaseId`, `ConsoleRouteId`, `consoleRouteOrder`, or `ROUTE_LABELS`.
- [ ] `parseConsoleRoute('/console/plans')` returns `now` in the navigation test through a constructed deleted-path string.
- [ ] `toConsolePath('now')` returns `/console/`.
- [ ] `buildNavItems()` returns three items with ids `now`, `workstations`, and `system`.
- [ ] `packages/console-ui/src/App.tsx` contains no `PlansView` import and no `currentRoute === 'plans'` branch.
- [ ] Initial render at the removed plans path displays the element with `data-testid="now-dashboard"`.
- [ ] Header tests assert no nav item has label `Plans` and no nav item has href for the removed plans path.
- [ ] `rg -n "PlansView|@/views/plans|src/views/plans|Planning Workspace" packages/console-ui/src` returns no matches.
- [ ] `packages/console-ui/README.md` route table contains no `/console/plans` row.
- [ ] `pnpm test -- packages/console-ui/src/__tests__/navigation.test.ts packages/console-ui/src/__tests__/app.test.tsx packages/console-ui/src/__tests__/header.test.tsx` exits 0.
