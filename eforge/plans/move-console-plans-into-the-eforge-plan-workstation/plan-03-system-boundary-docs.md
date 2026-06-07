---
id: plan-03-system-boundary-docs
name: Remove System Session-Plan Summary and Sync Boundary Docs
branch: move-console-plans-into-the-eforge-plan-workstation/plan-03-system-boundary-docs
---

# Remove System Session-Plan Summary and Sync Boundary Docs

## Architecture Context

With the extension workstation owning planning interactions and the core Plans route removed, the remaining first-party System `Session Plans` section would still make the core Console render planning artifact readiness/list data. This plan removes that first-party summary/fetch path and syncs documentation to the new boundary: Console observes builds and hosts workstations, while `eforge-plan` owns planning workflow UX.

## Implementation

### Overview

Remove the System session-plan fetch, state slice, section component, selector, and tests. Update docs that still describe first-party Console planning artifact browsing or System session-plan summaries. Keep daemon/client session-plan compatibility routes untouched.

### Key Decisions

1. Delete the first-party System section rather than replacing it with a second artifact list. Extension Contributions and Workstations already surface extension-owned planning information without direct core Console session-plan fetching.
2. Remove the System fetch helper for `API_ROUTES.sessionPlanList`; compatibility route constants stay in `@eforge-build/client` and monitor routes, but System no longer calls them for a core section.
3. Update roadmap wording so planning workflow UX is under extension workstations while Console remains build observability/control and configuration.

## Scope

### In Scope

- Remove `SessionPlansSection` and all System state/fetch/rendering dedicated to session plans.
- Remove the System selector and tests used only by that section.
- Update System tests to match the reduced surface set.
- Update Console README text that lists System session plans or core planning browsing.
- Update `docs/roadmap.md` stale Console planning wording.
- Add compatibility-route preservation checks to verification.

### Out of Scope

- No removal of `API_ROUTES.sessionPlan*` or `API_ROUTES.sessionPlanSet*`.
- No monitor route removal.
- No `DAEMON_API_VERSION` bump.
- No Pi/Claude/CLI command removal.

## Files

### Delete

- `packages/console-ui/src/views/system/session-plans-section.tsx`

### Modify

- `packages/console-ui/src/views/system/use-system-surfaces.ts` — remove `sessionPlans` initial state, loading state, fetch call, and error/success updates.
- `packages/console-ui/src/views/system/system-fetches.ts` — remove `fetchSystemSessionPlanList` and its `SessionPlanListResponse` import.
- `packages/console-ui/src/views/system/system-types.ts` — remove `SessionPlanListResponse` imports/re-exports, `sessionPlans` state slice, and `sessionPlans.list` surface key.
- `packages/console-ui/src/views/system/system-view-content.tsx` — remove `SessionPlansSection` import/render and remove session-plan wording from page copy.
- `packages/console-ui/src/views/system/__tests__/use-system-surfaces.test.tsx` — remove session-plan endpoint fixture and state assertions.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` — remove the `fetchSystemSessionPlanList` test.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` — remove `sessionPlans` fixture state and assert no `Session Plans` section is rendered.
- `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts` — remove `selectSessionPlanReadinessCounts` coverage.
- `packages/console-ui/src/lib/selectors/system.ts` — remove `SessionPlanListEntryWire` import, `SessionPlanReadinessCounts`, and `selectSessionPlanReadinessCounts`.
- `packages/console-ui/README.md` — remove remaining System session-plan wording and state that session-plan routes remain compatibility plumbing for non-Console and extension-owned workflows.
- `docs/roadmap.md` — replace the stale Console planning artifact browsing bullet with extension-workstation planning UX wording.

## Implementation Notes

- Keep `ExtensionContributionsSection` in System. It may list extension-registered workstation/action metadata, but it must not fetch `API_ROUTES.sessionPlanList` as a core System surface.
- If any tests need fixture `SystemSurfacesState`, remove the `sessionPlans` field from the fixture object rather than keeping an idle unused field.
- Run a search for `fetchSystemSessionPlanList`, `SessionPlansSection`, and `sessionPlans.list` after edits.
- Do not edit `packages/client/src/routes/session-plan.ts`, `packages/client/src/api/session-plan.ts`, `packages/client/src/api/session-plan-set.ts`, `packages/monitor/src/routes/session-plans.ts`, or `packages/monitor/src/routes/session-plan-sets.ts` except for unrelated compile errors caused by type imports. No such compile errors are expected.

## Database Migration

None.

## Verification

- [ ] `rg -n "fetchSystemSessionPlanList|SessionPlansSection|sessionPlans\.list" packages/console-ui/src` returns no matches.
- [ ] `packages/console-ui/src/views/system/use-system-surfaces.ts` contains no `API_ROUTES.sessionPlanList` fetch path through `system-fetches.ts`.
- [ ] System view content tests render no section title `Session Plans`.
- [ ] `packages/console-ui/src/lib/selectors/system.ts` contains no `selectSessionPlanReadinessCounts` export.
- [ ] `packages/client/src/routes/session-plan.ts` still exports `SessionPlanListResponse`, `SessionPlanShowResponse`, and `SessionPlanSetStatusRequest`.
- [ ] `packages/client/src/api/session-plan.ts` still exports `apiSessionPlanList`, `apiSessionPlanShow`, `apiSessionPlanCreate`, `apiSessionPlanSetSection`, `apiSessionPlanSetStatus`, and `apiSessionPlanReadiness`.
- [ ] `packages/client/src/api/session-plan-set.ts` still exports session plan-set client helpers.
- [ ] `packages/monitor/src/routes/session-plans.ts` and `packages/monitor/src/routes/session-plan-sets.ts` remain present and registered by existing monitor tests.
- [ ] `API_ROUTES.sessionPlan*` and `API_ROUTES.sessionPlanSet*` constants remain available from `@eforge-build/client`.
- [ ] `docs/roadmap.md` no longer says first-party Console keeps planning artifact browsing as a core route/page.
- [ ] `packages/console-ui/README.md` distinguishes extension-owned planning product UX from daemon/client compatibility routes.
- [ ] `pnpm test -- packages/console-ui/src/views/system/__tests__/system-fetches.test.ts packages/console-ui/src/views/system/__tests__/use-system-surfaces.test.tsx packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx packages/console-ui/src/views/system/__tests__/system-selectors.test.ts packages/monitor/src/__tests__/routes-session-plans.test.ts packages/monitor/src/__tests__/routes-session-plan-sets.test.ts packages/monitor/src/__tests__/routes-extension-content-source-contract.test.ts` exits 0.
