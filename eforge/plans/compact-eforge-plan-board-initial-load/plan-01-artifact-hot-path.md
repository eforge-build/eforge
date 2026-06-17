---
id: plan-01-artifact-hot-path
name: Remove Rich Board Payload From Workstation Artifact Load
branch: compact-eforge-plan-board-initial-load/plan-01-artifact-hot-path
---

# Remove Rich Board Payload From Workstation Artifact Load

## Architecture Context

The compact board path is already present: `useWorkstationData` calls `list-board-compact`, adapts it through `compact-board-adapter`, loads closed lanes through compact pagination, and loads drawer detail through `get-item`. The remaining hot-path gap is `list-planning-artifacts`: the workstation calls it during startup for Plans data, and the action currently builds and returns a rich board payload by default through `buildBoard()`/`projectBoardOutput()`. That hidden payload can include rich item/epic data and closed history even though the Backlog view ignores it.

This plan keeps `list-board` as the explicit debug-rich board read and makes planning artifacts artifact-only on the workstation startup path.

## Implementation

### Overview

Change `list-planning-artifacts` so it does not build or return a board unless a caller explicitly opts into the legacy board field. Update the workstation to pass an explicit no-board request, update the mock bridge, and add tests that fail if startup reintroduces an unbounded rich board payload.

### Key Decisions

1. Default `list-planning-artifacts` responses omit `board`; the action returns `artifacts`, `plans`, and `planSets` plus existing artifact lifecycle/source fields.
2. Preserve compatibility by gating the legacy rich `board` field behind `includeBoard: true`; the workstation never sends that flag as true.
3. Keep `list-board-compact` as the only Backlog board data source used by `useWorkstationData` for initial load, open pagination, and closed-lane pagination.

## Scope

### In Scope

- Make default `list-planning-artifacts` dispatch avoid `buildBoard()` and omit `board`.
- Add `includeBoard?: boolean` to `ListPlanningArtifactsInputSchema` and use existing `includeArchive`/`epic` only when `includeBoard` is true.
- Update workstation startup to call `list-planning-artifacts` with `{ includeBoard: false }`.
- Update mock bridge behavior so local/dev workstation startup receives artifact-only data.
- Update tests for session-plan actions, workstation startup calls, and action schema/registration drift.
- Update eforge-plan README notes for artifact-only startup and explicit rich/debug reads.

### Out of Scope

- Rewriting the compact board adapter or Backlog UI components that already use compact data.
- Changing `list-board-compact`, `get-item`, `get-epic`, or `search-items` schemas unless required by type errors from this change.
- Removing the `list-board` debug-rich action.

## Files

### Create

- None.

### Modify

- `eforge/extensions/eforge-plan/session-plan-schemas.ts` — add `includeBoard` to `ListPlanningArtifactsInputSchema`; keep `board` optional in `ListPlanningArtifactsOutputSchema`.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — split artifact listing from optional rich board projection; call `buildBoard()` only when `input.includeBoard === true`; keep default artifact and lifecycle projection working when board projection fails or is omitted.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — invoke `list-planning-artifacts` with `{ includeBoard: false }` and keep the returned `artifacts` as the only consumed field.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — return `{ artifacts }` for default mock `list-planning-artifacts` calls and include `board: mockBoard` only for `{ includeBoard: true }`.
- `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` — update default artifact-list test to assert `board` is absent and seeded backlog body text is absent; add or update a compatibility test for `{ includeBoard: true }` returning a board.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — assert startup calls `list-planning-artifacts` with `{ includeBoard: false }` and still never calls `list-board`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/App.test.tsx` — assert shell startup uses the artifact-only list-planning-artifacts input.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert the `list-planning-artifacts` input schema exposes `includeBoard` and the workstation allowlist still excludes `list-board`.
- `eforge/extensions/eforge-plan/README.md` — update compact-load and action-table notes so `list-planning-artifacts` is described as artifact-only by default, with rich board reads reserved for `list-board` or explicit legacy artifact requests.

## Verification

- [ ] Default `eforge-plan:list-planning-artifacts` dispatch returns no `board` field.
- [ ] Default `eforge-plan:list-planning-artifacts` dispatch JSON does not contain seeded backlog item body text from session-plan action tests.
- [ ] `eforge-plan:list-planning-artifacts` with `{ includeBoard: true }` returns a `board` field for legacy callers.
- [ ] `useWorkstationData` startup calls `list-board-compact` with `{ limit: 50, includeArchive: true }`.
- [ ] `useWorkstationData` startup calls `list-planning-artifacts` with `{ includeBoard: false }`.
- [ ] `useWorkstationData` startup records zero `list-board` calls.
- [ ] Mock bridge default `list-planning-artifacts` output has `artifacts` and no `board`.
- [ ] README states workstation Backlog board data comes from `list-board-compact` and artifact loading omits rich board data by default.
- [ ] Targeted tests pass: `session-plan-actions.test.ts`, `use-workstation-data.test.tsx`, `App.test.tsx`, `registration.test.ts`, and `test/eforge-plan-workstation.test.ts`.
- [ ] `pnpm type-check` exits 0.