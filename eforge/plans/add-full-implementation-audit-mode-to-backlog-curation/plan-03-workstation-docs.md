---
id: plan-03-workstation-docs
name: Workstation UI, Preview Rendering, and Documentation
branch: add-full-implementation-audit-mode-to-backlog-curation/plan-03-workstation-docs
agents:
  builder:
    effort: medium
    rationale: UI and docs changes span several files but follow existing
      workstation patterns and server-authoritative preview contracts.
  reviewer:
    effort: high
    rationale: Review must verify user-facing mode copy, warning states, and
      full-audit evidence display align with the new server contract.
  doc-author:
    effort: medium
    rationale: The source explicitly requires README/action documentation and
      workstation copy for both scan modes.
---

# Workstation UI, Preview Rendering, and Documentation

## Architecture Context

The workstation is the user-facing surface for starting analyze-all curation and reviewing server-authoritative previews. It must expose full implementation audit as an explicit opt-in mode, label previews by mode, and warn that full audit is comprehensive over open items but bounded by caps and available git/PR history. The workstation must render server-provided metadata; it must not run local git, PR, or source searches.

## Implementation

### Overview

Update workstation types, hooks, panel controls, preview rendering, fixtures, tests, and docs to support selecting `delta` or `full-implementation-audit`, starting the selected mode, showing scan-mode labels on tasks/previews, displaying full-audit coverage/caps/diagnostics/evidence source/confidence, and documenting the two modes.

### Key Decisions

1. Default the UI selection to `delta`; require a visible user selection before starting `full-implementation-audit`.
2. Pass the selected mode through `analyze-all-backlog` action input instead of encoding mode in daemon-specific behavior.
3. Display mode from server/workflow metadata when available, with `delta` as the fallback for older entries.
4. Render full-audit evidence from preview/source metadata only; do not replay source searches or recommendation overlays in the browser.
5. Keep existing preview/apply confirmation flow unchanged: preview first, then explicit acknowledgment, then confirm apply or curation-only discard.

## Scope

### In Scope

- Add workstation TypeScript types for scan mode and full-audit preview metadata.
- Update `usePlanningTaskWorkflows` so `analyzeAllBacklog(scanMode)` sends `{ scanMode }` and toasts the selected/reused mode.
- Update `PlanWithAiPanel` with mode selection, descriptions for both modes, disabled/loading states, and a full-audit warning.
- Update task cards/labels to show scan mode for backlog curation entries.
- Update `BacklogCurationPreview` to show scan-mode label, full-audit warning, audit coverage, caps, diagnostics, and per-proposed-change evidence source/confidence where preview metadata matches draft evidence.
- Add or update view-model helpers for mode labels, warnings, audit coverage/caps formatting, and evidence-source/confidence chips.
- Update mock bridge/data so local UI can start and reuse curation tasks independently by mode.
- Update workstation tests for mode selection, disabled/loading states, preview mode label, full-audit warning, and evidence display.
- Update `eforge-plan` README/action documentation and workstation README/copy for `delta` and `full-implementation-audit` modes.

### Out of Scope

- Server evidence collection; plan-02 owns it.
- Browser-side git/PR/source search.
- Changes to core engine scheduling, daemon routes, or build queue behavior.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-full-audit-panel.tsx` — focused renderer for full-audit coverage/caps/diagnostics/evidence summaries if keeping it separate avoids growing `backlog-curation-preview.tsx` too much.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-full-audit-panel.test.tsx` — focused renderer tests if the new component is created.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add `BacklogCurationScanMode`, `scanMode` on workflow entries/preview responses, and full-audit preview/evidence interfaces.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — change `analyzeAllBacklog` signature to accept a scan mode and send it in action input.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx` — add scan-mode controls, descriptions, full-audit warning copy, and mode-aware action button text/disabled state.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — display `Delta curation` or `Full implementation audit` badges for backlog curation tasks.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.tsx` — show scan-mode label, warning, audit metadata panel, and evidence source/confidence chips for proposed changes.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-git-delta-panel.tsx` — update copy so delta diagnostics remain clear when shown alongside full-audit metadata.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.ts` — add mode labels, warning text, audit coverage/caps formatting, and evidence-detail matching helpers.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — add delta and full-audit curation fixtures, mode-aware analyze mock behavior, preview coverage/caps/diagnostics, and evidence source/confidence examples.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — pass mock action input into `analyzeMockBacklog(input)`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.test.tsx` — cover mode selection and disabled/loading states.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx` — cover action input for delta and full-audit starts.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.test.tsx` — cover preview mode label, full-audit warning, coverage/caps/diagnostics, and evidence source/confidence display.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.test.ts` — cover formatting/matching helpers.
- `eforge/extensions/eforge-plan/workstation-src/plans/README.md` — document server-authoritative full-audit preview fields and no browser-side evidence gathering.
- `eforge/extensions/eforge-plan/README.md` — document action input `{ "scanMode": "delta" }` and `{ "scanMode": "full-implementation-audit" }`, mode behavior, accepted baseline behavior, caps/diagnostics, conservative closure rules, and workstation copy.
- `eforge/extensions/eforge-plan/index.ts` — update contribution/action copy for analyze-all to mention default delta mode and the workstation full-audit option.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` and `eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts` — update documentation contract assertions for the two modes and full-audit warning copy.

## Verification

- [ ] The Plan with AI panel renders `delta` as the default curation mode and sends `{ scanMode: "delta" }` when started from the default control.
- [ ] Selecting full implementation audit sends `{ scanMode: "full-implementation-audit" }` and renders a warning that the audit may take longer and use more context.
- [ ] Analyze-all controls are disabled while workflow loading or busy state is true.
- [ ] Task cards and curation previews show the scan mode that produced the task/preview.
- [ ] Full-audit curation previews render a warning that the audit may take longer and use more context.
- [ ] Full-audit previews show coverage, caps, diagnostics, evidence source, and confidence from server preview metadata.
- [ ] Full-audit previews render PR/git unavailable diagnostics as warnings rather than hiding the preview.
- [ ] Existing delta git-delta diagnostics still render baseline, head, coverage, caps, scanned commit count, diagnostics, and affected candidates.
- [ ] Mock bridge reuse is separated by scan mode.
- [ ] README/action documentation contains both `delta` and `full-implementation-audit` mode descriptions.
- [ ] Workstation README states preview/apply data is server-authoritative and the browser does not gather git, PR, or source-search evidence.