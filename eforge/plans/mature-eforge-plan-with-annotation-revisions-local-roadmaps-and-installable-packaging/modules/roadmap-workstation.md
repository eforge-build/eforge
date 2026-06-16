# Roadmap Workstation

## Architecture Reference

This module implements the **Roadmap design**, **Roadmap action contract**, **Roadmap context flow**, and `roadmap-workstation` module guidance from the architecture for **Mature eforge-plan: annotation revisions, local roadmaps, installable package**.

Key constraints from architecture:
- Depend on `roadmap-backend` action contracts: `get-roadmap-state`, `update-roadmap-state`, and the existing `refresh-recommendations` action. Do not import backend implementation helpers into the workstation bundle.
- Display local steering separately from configured shared context and discovered conventional context.
- Treat shared project roadmap files as read-only context in the UI; the workstation editor writes only the local focus roadmap through `update-roadmap-state`.
- Keep action payloads bounded and JSON-safe. The UI must honor `localFocus.maxContentBytes` before submitting local focus content.
- Use the existing workstation bridge action surface; do not add daemon routes, route literals, or daemon wire-shape declarations.
- Refresh recommendations by invoking the extension-owned `refresh-recommendations` action after saved roadmap changes, then reload workstation data so freshness and active refresh task state update from backend projections.
- Keep new implementation files under 600 lines and split UI helpers/tests before a file approaches the limit.

## Scope

### In Scope
- Add workstation-facing TypeScript interfaces for roadmap source projections, config, conflicts, state responses, update requests, and refresh-recommendation responses.
- Load roadmap state with local focus content during the main workstation data refresh.
- Expose hook callbacks for saving local focus content and starting a recommendation refresh.
- Render a roadmap panel that shows:
  - local focus roadmap status and storage path,
  - configured shared context source status,
  - discovered conventional context source status,
  - roadmap assumptions, conflicts, truncation counts, hashes, and timestamps when present.
- Provide an editable local focus roadmap textarea with byte-limit feedback, save/reset controls, optimistic `expectedLocalFocusSha256`, and error/success toasts.
- Provide a recommendation refresh control after roadmap edits are saved. The control starts or reuses `refresh-recommendations`, displays active refresh progress, and reloads recommendation freshness data.
- Add dev/mock bridge support for roadmap state, local focus mutation, and recommendation refresh so local workstation development can exercise the new panel without a daemon.
- Add focused component and hook tests for roadmap loading, editing, source status display, disabled states, and recommendation refresh invocation.

### Out of Scope
- Backend roadmap schemas, storage helpers, planner context, curation, refresh source text, and freshness fingerprints; `roadmap-backend` owns those.
- Editing configured shared source lists in the workstation. Shared source configuration remains available through extension actions and can be surfaced by future UI work.
- Writing or rewriting shared project roadmap files.
- Documentation updates for install/update/trust/storage/privacy; `packaging-docs-validation` owns those.
- Annotation UI or revision-flow changes.
- New daemon routes, daemon scheduling/orchestration, or daemon wire-shape ownership changes.

## Implementation Approach

### Overview

Add a small roadmap panel to the workstation shell above the active tab content. `useWorkstationData` becomes the single data-loading point for roadmap state, matching its existing board/artifact/recommendation loading role. The hook loads `get-roadmap-state` with `{ includeLocalFocusContent: true }` alongside the existing sources, stores the bounded state response, and exposes two mutation callbacks:

1. `saveRoadmapState(input)` calls `update-roadmap-state`, updates `roadmapState` from the action response, then reloads the standard workstation data so recommendation freshness reflects the new roadmap source fingerprint.
2. `refreshRecommendations()` calls `refresh-recommendations`, seeds the active refresh task from the response, then reloads workstation data so the recommendations panel and roadmap panel show the backend-derived active refresh state.

The UI stays action-contract based. It receives `RoadmapStateResponse | null`, recommendation freshness, and callbacks as props. It never reads local files and never mutates shared-source paths directly. Source status rendering uses the backend projection fields (`role`, `kind`, `configured`, `editable`, `exists`, `sha256`, `updatedAt`, `headings`, and `excerpts`) rather than inferring special meaning from paths such as `docs/roadmap.md`.

### Key Decisions

1. **Render roadmap controls in `App.tsx`, not inside the kanban board.** Roadmap steering affects recommendation refresh and planner context globally, so the panel appears once in the shell above the tab content. This uses the architecture-assigned `App.tsx` placement region and avoids coupling roadmap editing to a specific board selection state.
2. **Keep the panel collapsed by default.** Follow the existing `CollapsiblePanel` pattern so the board remains the primary surface. The summary chips expose local/shared/discovered counts, conflicts, and recommendation freshness while the details stay available on demand.
3. **Do not add a shared-source editor.** The backend action supports shared source config, but this module only edits local focus content. Shared sources are listed with read-only labels and conflict messages to avoid accidental committed-file writes.
4. **Use optimistic local focus hashing.** When `localFocus.sha256` exists, pass it as `expectedLocalFocusSha256` during save. If the backend rejects a stale edit, show the bridge error toast and keep the draft text intact so the user can copy or retry after reload.
5. **Disable recommendation refresh while the local editor is dirty.** `refresh-recommendations` consumes saved source state, so the button title explains that the local focus roadmap must be saved before refresh.
6. **Avoid growing `mock-data.ts`.** That fixture file is already at the 600-line implementation limit. Add roadmap mock state in a new `fixtures/mock-roadmap.ts` and wire it through `bridge.ts` with bounded switch cases.
7. **Keep source status formatting pure.** Put byte counting, summary chip derivation, source grouping labels, and refresh-disabled reasons in `views/roadmap/roadmap-view-model.ts` so component tests can cover edge cases without rendering the full panel.
8. **No local route or daemon API use.** The workstation calls bridge actions by action ID only: `get-roadmap-state`, `update-roadmap-state`, and `refresh-recommendations`.

### Component Contract

Use this prop shape for the panel unless implementation exposes a narrower existing convention:

```tsx
// --- eforge:region plan-05-roadmap-workstation ---
export interface RoadmapPanelProps {
  state: RoadmapStateResponse | null;
  loading: boolean;
  recommendationStatus: RecommendationStatus | null;
  activeRecommendationRefreshTask: PlanningAgentTaskRecord | null;
  onSaveLocalFocus: (input: UpdateRoadmapStateRequest) => Promise<RoadmapStateResponse>;
  onRefreshRecommendations: () => Promise<RefreshRecommendationsResponse>;
  onReloadRoadmap: () => Promise<void>;
}
// --- eforge:endregion plan-05-roadmap-workstation ---
```

The panel submits only local focus edits:

```tsx
// --- eforge:region plan-05-roadmap-workstation ---
await onSaveLocalFocus({
  localFocusContent: draft,
  ...(state.localFocus.sha256 ? { expectedLocalFocusSha256: state.localFocus.sha256 } : {}),
});
// --- eforge:endregion plan-05-roadmap-workstation ---
```

## Files

### Create
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-view-model.ts` — pure helpers for UTF-8 byte counts, source count summaries, source kind labels, status chip text, refresh-disabled reasons, and source list grouping. Keep this free of React and bridge imports.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-panel.tsx` — collapsible roadmap status/editor panel. Render local focus textarea, source status lists, conflicts/assumptions, truncation notes, save/reset/reload controls, and recommendation refresh controls.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-view-model.test.ts` — tests for byte-limit calculations, dirty/over-limit states, source count summaries, source kind labels, and refresh-disabled reasons.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap/roadmap-panel.test.tsx` — component tests for source status rendering, local focus editing/saving, conflict display, dirty-state refresh disabling, active refresh disabling, and refresh action invocation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-roadmap.ts` — bounded dev fixture for `get-roadmap-state`, `update-roadmap-state`, `refresh-recommendations`, and a wrapper that overlays active mock refresh tasks onto `getMockRecommendationsResponse()` without editing `mock-data.ts`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/App.test.tsx` — lightweight placement test that renders `App` with a bridge stub and asserts the roadmap panel appears in the shell with loaded local focus/source status data.

### Modify
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add roadmap action response interfaces and update `WorkstationData`/hook-facing types to include `roadmapState` and refresh mutation types `[region: roadmap-workstation, roadmap state/action response interfaces]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` — load `get-roadmap-state` in the main refresh, keep board/artifact/recommendation failures isolated, expose `saveRoadmapState` and `refreshRecommendations`, and refresh derived recommendation status after roadmap saves `[region: roadmap-workstation, roadmap loading and refresh coupling]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/App.tsx` — import and render `RoadmapPanel` above the active tab content, passing roadmap state, recommendation status, active refresh task, and hook callbacks `[region: roadmap-workstation, roadmap panel placement in shell main]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — import `mock-roadmap` helpers, route mock `get-roadmap-state`, `update-roadmap-state`, and `refresh-recommendations` action cases, and wrap mock `get-recommendations` so active roadmap refresh tasks appear in dev mode `[region: roadmap-workstation, mock roadmap action cases and recommendation wrapper]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` — update existing bridge stubs to return roadmap state, assert initial roadmap loading, assert save calls `update-roadmap-state`, and assert refresh calls `refresh-recommendations` followed by a recommendations reload.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/styles.css` — add only minimal utility classes if Tailwind utilities cannot express required line clamping or source-status overflow behavior. Prefer existing utility classes; skip this edit when the panel can be styled without new CSS.

Shared-file note: `bridge.ts` is not listed in the architecture Shared File Registry, but both workstation modules may add mock action cases. Use non-overlapping switch cases: this module owns `get-roadmap-state`, `update-roadmap-state`, `refresh-recommendations`, and the mock recommendation wrapper; annotation-workstation owns annotation action cases if it needs mock bridge support.

## Testing Strategy

### Unit Tests
- `roadmap-view-model.test.ts`
  - UTF-8 byte counting reports multibyte content over `localFocus.maxContentBytes`.
  - Dirty local focus content enables save, and matching content disables save.
  - Refresh-disabled reasons distinguish dirty editor state, running refresh task, and saving state.
  - Source summary counts configured shared sources separately from discovered conventional sources.
  - Source labels render `local focus`, `configured shared`, and `discovered conventional` without making `docs/roadmap.md` canonical.
- `use-workstation-data.test.tsx`
  - Initial refresh invokes `get-roadmap-state` with `{ includeLocalFocusContent: true }` and stores the response.
  - A roadmap load failure contributes `roadmap: <message>` to the aggregated error while board/artifact/recommendation state remains populated when those calls succeed.
  - `saveRoadmapState` invokes `update-roadmap-state` with `localFocusContent` and `expectedLocalFocusSha256`, updates `roadmapState`, and reloads recommendation status.
  - `refreshRecommendations` invokes `refresh-recommendations`, returns the action output, updates `activeRecommendationRefreshTask` from the returned task, and reloads recommendations.

### Component Tests
- `roadmap-panel.test.tsx`
  - Renders local focus storage path, content hash, update timestamp, configured shared source rows, discovered source rows, conflicts, assumptions, and truncation metadata.
  - Editing local focus content enables `Save local focus`; clicking save calls `onSaveLocalFocus` with `localFocusContent` and the current `sha256`.
  - Over-limit local focus content disables save and displays current bytes plus max bytes.
  - Reset restores the latest saved local focus content and disables save.
  - `Refresh recommendations from roadmap` is disabled while the editor is dirty.
  - `Refresh recommendations from roadmap` is disabled while an active refresh task is queued or running and displays that task's progress message.
  - Clicking the refresh button calls `onRefreshRecommendations` once and displays a success toast containing the returned task id.
- `App.test.tsx`
  - Renders `App` with a bridge stub and asserts the roadmap panel appears above the active tab content.
  - Confirms the bridge stub receives `get-roadmap-state`, `get-recommendations`, `list-board-compact`, and `list-planning-artifacts` during startup.

### Integration/Regression Tests
- Keep existing recommendations-panel tests intact; the roadmap panel owns manual recommendation refresh controls, so do not reintroduce a refresh button inside `RecommendationsPanel`.
- Mock bridge regression: in dev-mode bridge tests or component tests, call `refresh-recommendations`, then `get-recommendations`, and assert the returned recommendations response includes `activeRefreshTask` from `mock-roadmap.ts`.

## Verification

- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test -- src/views/roadmap/roadmap-view-model.test.ts src/views/roadmap/roadmap-panel.test.tsx src/hooks/use-workstation-data.test.tsx src/App.test.tsx` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation build` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `RoadmapPanel` tests observe separate text for `Local focus`, `Configured shared context`, and `Discovered context`.
- [ ] `RoadmapPanel` tests observe `docs/roadmap.md` only inside a discovered source row and not as a canonical label.
- [ ] `RoadmapPanel` tests observe `update-roadmap-state` payloads containing `localFocusContent` and `expectedLocalFocusSha256`, with no `sharedSources` key for local-focus-only saves.
- [ ] `RoadmapPanel` tests observe `refresh-recommendations` invoked only after the local focus draft matches the saved content.
- [ ] `useWorkstationData` tests observe a roadmap load failure leaving board items and artifacts populated.
- [ ] `rg "/api/" eforge/extensions/eforge-plan/workstation-src/plans/src/views/roadmap eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.ts` returns no matches.
- [ ] No new implementation file exceeds 600 lines.
- [ ] No new test file exceeds 1,200 lines.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
