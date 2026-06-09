---
id: plan-04-workstation-curation-ui
name: Backlog workstation analyze-all control, curation task labels, read-only
  previews, two-step apply confirmation, mocks, and bundle guards.
branch: migrate-eforge-plan-backlog-storage-and-add-analyze-all-curation/workstation-curation-ui
---

# Workstation Curation UI

## Architecture Reference

This module implements the `workstation-curation-ui` entry from the architecture's module dependency graph and consumes the contracts produced by `planning-task-contract` and `curation-workflow`.

Key constraints from architecture:
- The workstation starts curation only through the trusted extension action `analyze-all-backlog`; browser code must not call daemon routes directly, use raw `fetch`, import private Console APIs, or hard-code private storage paths.
- The daemon-owned task remains read-only. The workstation renders `backlogCurationDraft` as a preview and applies mutations only by invoking `apply-planning-agent-task-result` with `applyBacklogCurationDraft` confirmation flags.
- `backlog-curation` tasks use the same durable Plan with AI monitor affordances as other planning tasks: label, poll, retry, redraft, cancel, remove, and apply.
- Curation results can include generated recommendations, but a curation task must not expose standalone `applyRecommendations`; recommendations are applied only as part of `applyBacklogCurationDraft`.
- The UI consumes the shared `@eforge-build/client` curation draft type. It may define view-model helpers, but it must not define a second validation schema for the task wire shape.
- Generated workstation assets under `eforge/extensions/eforge-plan/workstation-assets/plans/*` are rebuilt by `docs-assets-validation`, not by this module.

## Scope

### In Scope

- Add a visible **Analyze all backlog** control in the Backlog workstation.
- Extend the shared planning-task workflow hook with `analyzeAllBacklog()` that invokes `analyze-all-backlog` through the workstation bridge.
- Extend workstation types for `backlog-curation` workflow entries, `backlogCurationDraft` task results, analyze-all responses, curation apply inputs, and curation apply outputs.
- Label `backlog-curation` tasks in Plan with AI and include curation counts in task summaries.
- Render read-only curation previews for item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, and generated recommendations.
- Gate curation apply behind two explicit in-app confirmation actions and send `{ applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }` to the backend.
- Offer redraft with steering for completed curation drafts and retain the existing needs-input redraft flow.
- Prevent the generic recommendations apply button from rendering for `backlog-curation` tasks.
- Update mock data and the mock bridge so local workstation development includes curation tasks, analyze-all start/reuse behavior, curation apply responses, retry/redraft behavior, and applied-task state.
- Add source and bundle guards that prove curation uses `window.eforge.invokeAction`, contains no raw `fetch`, imports no private Console modules, and leaks no `.eforge/storage/extensions` paths.

### Out of Scope

- Backend action registration, action schemas, curation source building, curation validation, private backlog writes, recommendation freshness writes, and workflow index mutations; these belong to `curation-workflow`.
- Client/engine `backlogCurationDraft` schema and prompt/tool changes; these belong to `planning-task-contract`.
- README updates, README contract tests, and committed generated workstation assets; these belong to `docs-assets-validation`.
- Scheduling, stale-triggered analysis, unattended apply, build enqueueing, queue orchestration, and core Console Plans changes.

## Implementation Approach

### Overview

Treat analyze-all curation as another durable planning-task workflow in the Backlog workstation. The UI starts or reuses the backend task through the existing bridge, renders the completed `backlogCurationDraft` in a new focused preview component, and sends the backend confirmation flags only after the user completes two in-app confirmation steps.

Keep curation rendering out of the generic result preview file as much as possible. `planning-task-result-preview.tsx` becomes a dispatcher: needs-input tasks still render the existing answer/redraft form; ready curation tasks render the new curation preview; all other ready tasks use the existing recommendations/session-plan/handoff preview. This prevents curation-specific UI from making the generic result preview hard to test.

### Key Decisions

1. **Start analyze-all from Plan with AI.** Add an `Analyze all backlog` button to the Plan with AI panel header. The task appears in that same monitor, so users can see immediate queued/running/completed state without another panel.
2. **Use a dedicated curation preview component.** Create `backlog-curation-preview.tsx` for curation-specific rendering and confirmation state. This keeps `planning-task-result-preview.tsx` small and preserves existing task previews.
3. **Use client-exported task types in UI type aliases.** In `types.ts`, import the curation draft type from `@eforge-build/client/browser` with `import type` and export a local alias for component ergonomics. Do not create a TypeBox schema or a divergent curation result interface.
4. **Represent two-step confirmation as two UI actions.** The curation preview first requires a `I reviewed this curation preview` click. Only after that click does `Confirm apply curation` appear. The second click invokes `apply-planning-agent-task-result` with both backend flags set to `true`. Do not use `window.confirm`.
5. **Separate curation recommendations from recommendation refresh.** When `result.backlogCurationDraft` is present, render generated recommendations as read-only content inside the curation preview and suppress the generic `Apply recommendations` button.
6. **Keep mocks stateful.** The mock bridge must demonstrate curation start/reuse, retry/redraft, apply, and applied-state transitions without writing files or exposing real private storage paths.
7. **Avoid bundle drift in this module.** Update workstation source and tests only. Let `docs-assets-validation` run `pnpm build:eforge-plan-workstation` and commit the generated `workstation-assets/plans/*` output.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.tsx` — render the read-only curation draft preview, generated recommendation summary, curation redraft steering form, applied-state banner, and two-action apply confirmation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.ts` — pure helpers for curation counts, ID labels, metadata patch display rows, section-operation labels, abbreviated fingerprints, and recommendation summary counts.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.test.tsx` — component tests for curation preview groups, generated recommendations, redraft steering, two-step apply confirmation payload, and applied-state behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx` — hook tests for `analyzeAllBacklog()` invoking `analyze-all-backlog`, reloading task state, surfacing reuse toasts, and avoiding data refresh until apply.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` — task-card tests for the `Backlog curation` label, curation running badge text, cancel/remove/retry button availability, and no standalone recommendation apply button for curation tasks.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — import/export the shared curation draft type, add `PlanningTaskWorkflowEntry.purpose: 'recommendation-refresh' | 'backlog-curation'`, add optional `appliedAt`, add `AnalyzeAllBacklogResponse`, extend `PlanningTaskResult` with `backlogCurationDraft`, and extend `ApplyPlanningTaskResponse` with optional curation apply details. Use type aliases to the browser client contract rather than defining a second schema.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — add `analyzeAllBacklog()` to `PlanningTaskWorkflowsApi`; invoke `bridge.invokeAction<AnalyzeAllBacklogResponse>('analyze-all-backlog', {})`; toast `Started` vs `Reusing`; reload tasks; keep apply behavior refreshing board/recommendation data after successful curation apply.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx` — add the `Analyze all backlog` header action, include `backlog-curation` running/ready counts in the panel summary, and keep the existing `Refresh tasks` action.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — label `entry.purpose === 'backlog-curation'` as `Backlog curation`, show `appliedAt` for applied curation entries, and pass the workflow entry to the result preview so curation apply can be hidden after apply.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx` — dispatch ready curation results to `BacklogCurationPreview`; pass `onRedraft`; prevent generic recommendation apply for curation tasks; preserve existing session-plan creation, handoff, session-plan patch, and recommendation-refresh previews.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.tsx` — if curation workflow state is surfaced here after implementation, restrict edits to a compact notice that analyze-all recommendations remain read-only until curation apply. If this file grows past 300 lines, wrap the new curation notice helpers in a durable semantic region marker such as `// --- eforge:region workstation-curation-recommendation-notice ---` / `// --- eforge:endregion workstation-curation-recommendation-notice ---`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx` — pass the extended workflow API through unchanged; if the curation control needs active-task data outside Plan with AI, derive it from `workflows.items` instead of calling another action.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — add mock cases for `analyze-all-backlog` and curation apply through `apply-planning-agent-task-result`; keep all calls inside `invokeAction` and do not add raw network calls.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add mock curation draft data, a completed curation workflow entry, dynamic analyze-all start/reuse helpers, curation retry/redraft preservation, and `applyMockBacklogCurationDraft()` that marks the entry applied and returns curation counts. Use bounded edits inside the existing durable planning-task fixture section; if adding markers, use a durable semantic slug such as `workstation-curation-fixtures`.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — update source and bundle guards for curation action IDs, labels, preview text, confirmation flags, mock bridge coverage, and no raw network/storage/private Console leakage `[region: workstation-curation-ui, source/bundle guard assertions for analyze-all and curation preview]`.

### Do Not Modify

- `eforge/extensions/eforge-plan/workstation-assets/plans/*` — generated by `docs-assets-validation` after source changes settle.
- `eforge/extensions/eforge-plan/index.ts` — action registration and workstation allowed-actions are owned by `curation-workflow`.
- `eforge/extensions/eforge-plan/README.md` and `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — documentation and README contract work are owned by `docs-assets-validation`.
- `packages/client/src/extension-agent-tasks.ts` and engine planning task files — owned by `planning-task-contract`.

## UI Contract Details

### Analyze-all workflow hook

Add this shape to the hook API:

```ts
interface PlanningTaskWorkflowsApi {
  // existing fields...
  analyzeAllBacklog: () => Promise<PlanningAgentTaskRecord | null>;
}
```

`analyzeAllBacklog()` must:

1. Set `busy` while the action is in flight.
2. Invoke `analyze-all-backlog` through `bridge.invokeAction`.
3. Toast `Started backlog curation task <id>.` or `Reusing backlog curation task <id>.` based on `response.reused`.
4. Reload `list-planning-agent-tasks`.
5. Return the task record or `null` after an error.
6. Avoid calling `onRefresh()` because analyze-all only starts/reuses a read-only task. The existing `apply()` path calls `onRefresh()` after mutations.

### Curation task label and action gating

Task cards must show:

- `Backlog curation` badge when `entry.purpose === 'backlog-curation'`.
- `Recommendation refresh` badge for existing refresh tasks.
- `applied <relative time>` when `entry.appliedAt` exists.
- Cancel for queued/running curation tasks.
- Retry for failed/cancelled curation tasks when the task record is available.
- Dismiss/remove for non-running curation tasks.
- Redraft with steering for completed curation drafts through `redraft-planning-agent-task`.
- Apply only for unapplied completed curation drafts.

### Curation preview

`BacklogCurationPreview` renders these sections from `draft`:

- Header with source fingerprint, generated time, and count chips for item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, and generated recommendations.
- Summary bullets from `draft.summary`.
- Item changes grouped by item ID, including metadata field changes, section operations, rationale, and evidence bullets.
- Epic changes grouped by epic ID, including metadata field changes, section operations, rationale, and evidence bullets.
- No-op rechecks showing ID, kind, `last_checked`, `stale_after`, and rationale.
- Skipped cases showing kind, ID when present, and reason.
- Needs-input cases showing kind, ID when present, question, and reason.
- Generated recommendations as a read-only summary of next-sequence count, safe-parallel group count, blocked-chain count, and rationale/assumption bullets.

The preview must render generated Markdown content through `SafeMarkdown` or escaped/preformatted text. It must not use `dangerouslySetInnerHTML` outside existing `SafeMarkdown` internals.

### Two-step curation apply

The apply controls use local component state:

1. Initial button: `I reviewed this curation preview`.
2. After the first click, show `Confirm apply curation` and `Cancel`.
3. `Confirm apply curation` invokes:

```ts
onApply(taskId, {
  applyBacklogCurationDraft: {
    previewAcknowledged: true,
    confirmApply: true,
  },
});
```

When `entry.appliedAt` exists, render the applied timestamp and do not render the apply buttons.

### Mock behavior

Add mock curation fixtures with IDs matching existing board items and epics:

- one item patch updating `auto-mode` dependency/status metadata and appending evidence;
- one epic patch updating `planning` recheck metadata;
- one no-op recheck for `traceability`;
- one skipped case for a legacy/ambiguous record;
- one needs-input case for a claim without durable evidence;
- generated recommendations using the existing `mockRecommendations` shape.

`analyzeMockBacklog()` returns an existing queued/running/applied-state-aware curation task when one is reusable, otherwise pushes a new running task with `purpose: 'backlog-curation'`, `requestedOutputSections: ['backlogCurationDraft', 'recommendations']`, and a stable mock `sourceFingerprint`.

`applyMockBacklogCurationDraft(taskId)` returns a JSON-safe response with `schemaVersion: 1`, `taskId`, `applied.backlogCuration`, `backlogCuration.changedItemIds`, `backlogCuration.changedEpicIds`, `backlogCuration.recheckedItemIds`, `backlogCuration.skipped`, `backlogCuration.needsInput`, and recommendation details. It also updates the matching mock workflow entry with `appliedAt`.

## Testing Strategy

### Unit Tests

- `backlog-curation-view-model.test.ts` coverage can live in the preview test or a focused pure-helper test if helper logic grows: curation count summaries, metadata field display, fingerprint abbreviation, and recommendation summary counts.
- `backlog-curation-preview.test.tsx` renders all curation categories, generated recommendations, no-op rechecks, skipped cases, needs-input cases, and applied-state text.
- `backlog-curation-preview.test.tsx` proves the first confirmation click does not call `onApply` and the second confirmation click calls `onApply(taskId, { applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } })`.
- `backlog-curation-preview.test.tsx` proves curation preview offers redraft only after non-empty steering text and calls `onRedraft(taskId, { steering })`.
- `planning-task-card.test.tsx` proves curation labels render and generic recommendation apply is absent for curation tasks that include recommendations.

### Integration Tests

- `use-planning-task-workflows.test.tsx` uses a fake `window.eforge` bridge and verifies `analyzeAllBacklog()` invokes `analyze-all-backlog`, reloads `list-planning-agent-tasks`, returns the task, and does not call the external refresh callback.
- `use-planning-task-workflows.test.tsx` verifies `apply()` with curation payload invokes `apply-planning-agent-task-result`, calls the external refresh callback once, and reloads tasks.
- `workstation-assets.test.ts` verifies source and built bundle text includes `analyze-all-backlog`, `Backlog curation`, `backlogCurationDraft`, `applyBacklogCurationDraft`, `previewAcknowledged`, and `confirmApply`.
- `workstation-assets.test.ts` verifies curation source and bundle text contain no raw `fetch`, `XMLHttpRequest`, private Console import path, or `.eforge/storage/extensions` literal.

### Regression Tests

- Existing recommendation refresh UI tests continue to pass with `refresh-recommendations`, `applyRecommendations`, and recommendation freshness behavior unchanged.
- Existing session-plan creation, needs-input redraft, handoff draft, and session-plan patch previews continue to render and apply with their current payloads.
- Existing mock bridge tests continue to include all durable planning task workflow action IDs, plus `analyze-all-backlog`.

### Targeted Commands

```bash
pnpm --filter @eforge-build/eforge-plan-workstation test
pnpm --filter @eforge-build/eforge-plan-workstation type-check
pnpm test -- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts
pnpm build:eforge-plan-workstation
```

Final expedition validation still runs `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` after generated assets are rebuilt by `docs-assets-validation`.

## Verification

- [ ] The Backlog workstation renders a button with accessible name `Analyze all backlog`.
- [ ] Clicking `Analyze all backlog` invokes `window.eforge.invokeAction('analyze-all-backlog', {})` through the shared bridge.
- [ ] `usePlanningTaskWorkflows().analyzeAllBacklog()` reloads `list-planning-agent-tasks` after a successful analyze-all response.
- [ ] `usePlanningTaskWorkflows().analyzeAllBacklog()` does not call the hook `onRefresh` callback.
- [ ] A task with `entry.purpose === 'backlog-curation'` renders a `Backlog curation` badge.
- [ ] A running curation task renders a cancel button.
- [ ] A failed curation task renders a retry button when `item.available === true`.
- [ ] A completed curation task renders a dismiss/remove button.
- [ ] A completed curation task with `backlogCurationDraft` renders item changes.
- [ ] A completed curation task with `backlogCurationDraft` renders epic changes.
- [ ] A completed curation task with `backlogCurationDraft` renders no-op rechecks.
- [ ] A completed curation task with `backlogCurationDraft` renders skipped cases.
- [ ] A completed curation task with `backlogCurationDraft` renders needs-input cases.
- [ ] A completed curation task with generated recommendations renders those recommendations inside the curation preview.
- [ ] A curation task with generated recommendations does not render the generic `Apply recommendations` button.
- [ ] The first curation confirmation click leaves `onApply` call count at `0`.
- [ ] The second curation confirmation click calls `onApply` with `applyBacklogCurationDraft.previewAcknowledged === true` and `applyBacklogCurationDraft.confirmApply === true`.
- [ ] A curation entry with `appliedAt` renders the applied timestamp and no curation apply button.
- [ ] Curation redraft with non-empty steering calls `onRedraft(taskId, { steering })`.
- [ ] The mock bridge contains a `case 'analyze-all-backlog'` branch.
- [ ] The mock bridge curation apply branch returns `applied.backlogCuration` counts.
- [ ] The workstation source contains no `fetch(` literal in curation flow files.
- [ ] The workstation source contains no `XMLHttpRequest` literal in curation flow files.
- [ ] The workstation source contains no `packages/console-ui/src` import path.
- [ ] The workstation source contains no `.eforge/storage/extensions` literal.
- [ ] The built workstation bundle contains `analyze-all-backlog`.
- [ ] The built workstation bundle contains `applyBacklogCurationDraft`.
- [ ] The built workstation bundle contains no `.eforge/storage/extensions` literal.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` exits 0.
- [ ] `pnpm build:eforge-plan-workstation` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
