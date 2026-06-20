---
id: plan-02-source-first-audit-ui-docs
name: Source-First Audit Workstation and Docs
branch: source-first-backlog-implementation-audit/plan-02-source-first-audit-ui-docs
agents:
  builder:
    effort: medium
    rationale: This plan updates workstation view models, fixtures, tests, and
      user-facing documentation after the core source-first metadata contract
      exists.
  reviewer:
    effort: medium
    rationale: Review must verify UI labels do not imply historical evidence can
      close source-first items.
  tester:
    effort: medium
    rationale: UI/view-model tests must cover evidence rendering and action input
      propagation.
---

# Source-First Audit Workstation and Docs

## Architecture Context

This plan depends on `plan-01-source-first-audit-core`. The workstation consumes extension action schemas and preview metadata; it does not infer closure authority. Server preview/apply remains authoritative.

The UI must make the existing canonical `full-implementation-audit` scan mode understandable as a source-first implementation audit. It must display current-source evidence as closure-capable and historical evidence as navigation hints only.

## Implementation

### Overview

Update workstation types, controls, labels, preview rendering, fixtures, tests, and user docs for source-first audit evidence and concurrency.

### Key Decisions

1. Keep the select value `full-implementation-audit`, but show the label “Source-first implementation audit”.
2. Expose `itemAuditConcurrency` only with the source-first mode; default display value is `4` and maximum display value is `8`.
3. Render source-first item outcomes and current-source citations from server preview metadata, never from client-side inference.
4. Mark git/PR/lifecycle entries as navigation hints in source-first preview UI.

## Scope

### In Scope

- Workstation scan-mode labels and help text.
- Workstation concurrency input and action payload propagation.
- Preview rendering for source-first item outcomes, current-source citations, diagnostics, caps, concurrency, and historical hints.
- Fixture updates for source-first audit evidence.
- README/help text updates and contract tests.
- Targeted workstation/view-model tests.

### Out of Scope

- Runtime source-first classification and apply validation; those are handled in `plan-01-source-first-audit-core`.
- New daemon routes.
- New backlog management workflows beyond analyze-all curation.

## Files

### Create

- `eforge/extensions/eforge-plan/workstation-src/plans/src/backlog-curation-types.ts` — extracted curation preview/action types if `types.ts` would exceed the 600-line file-size ceiling.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-curation.ts` — extracted source-first curation fixture data if `fixtures/mock-data.ts` would exceed the 600-line file-size ceiling.

### Modify

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — add or re-export source-first preview fields and optional workflow `itemAuditConcurrency`; keep this file under 600 lines by extracting curation types if needed.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/analyze-backlog-control.tsx` — display the source-first mode label, show concurrency help, collect `itemAuditConcurrency`, clamp or constrain the UI to the server maximum, and pass the value to `onAnalyze`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts` — send `{ scanMode, itemAuditConcurrency }` to `analyze-all-backlog` for source-first mode and include concurrency in toast text when supplied.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.ts` — update labels/warnings, evidence label extraction, source-first evidence matching, caps/concurrency display rows, and historical-hint wording.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-full-audit-panel.tsx` — retitle the panel to source-first audit metadata, render per-item intents, current-source citations, historical navigation hints, diagnostics, caps, and concurrency settings.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.tsx` — render source-first warnings/help, source-current evidence chips, and preview evidence attached to item patches.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx` — show the source-first scan-mode label and optional concurrency on curation tasks.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — move or update curation fixtures to include source-first preview metadata without exceeding file-size limits.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — ensure mock analyze-all and preview actions accept/pass source-first concurrency in local development fixtures.
- `eforge/extensions/eforge-plan/README.md` — update analyze-all, preview/apply, scan-mode, source-first closure, and concurrency/caps documentation.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-view-model.test.ts` — cover source-first labels, warning text, source evidence labels, historical-hint labels, and evidence matching.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-full-audit-panel.test.tsx` — cover source-first metadata, per-item evidence, caps, concurrency, and diagnostics rendering.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/backlog-curation-preview.test.tsx` — cover source-first preview evidence rendering and confirmation behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.test.tsx` — cover analyze-all payloads for source-first concurrency and default mode.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` — cover source-first task labels.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — update static source assertions for new source-first labels/action payloads.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — require README text for source-first current-source authority, historical hints, concurrency default, and maximum cap.
- `eforge/extensions/eforge-plan/__tests__/docs-validation-contract.test.ts` — update docs contract expectations for source-first mode if the existing test asserts the old full-audit wording.

## Implementation Details

### Workstation action shape

Prefer an `onAnalyze` signature that accepts a small object:

```ts
{ scanMode: BacklogCurationScanMode; itemAuditConcurrency?: number }
```

The hook must continue to support delta mode with no concurrency field. For source-first mode, send the selected `itemAuditConcurrency` to the extension action. The UI can constrain the input to `1..8`, but server schema validation remains authoritative.

### Preview rendering

The preview panel must display:

- Scan-mode label: “Source-first implementation audit”.
- Warning/help text stating that current source is the only closure authority.
- Concurrency and caps from server metadata.
- Per-item source-first intent counts or rows.
- Current-source citations for source-shipped/source-superseded item patches.
- Historical hints with wording that they are navigation hints, not closure evidence.
- Diagnostics from source assembly.

Do not infer closure from draft evidence text alone. Use `curationPreview.fullImplementationAudit` metadata from the server.

### Docs

Update README text that currently says full-audit coverage is bounded by git/PR history. It must state that source-first mode audits open items against current source, history is only a navigation hint, closure requires current-source citations, ambiguous cases fail closed, and per-item audits run with default concurrency `4` and maximum `8`.

## Verification

- [ ] The analyze-all control renders “Source-first implementation audit” for the `full-implementation-audit` option.
- [ ] Selecting source-first mode shows help text stating that current source is the only closure authority.
- [ ] Selecting source-first mode sends `itemAuditConcurrency` in the `analyze-all-backlog` action payload.
- [ ] Delta mode sends no `itemAuditConcurrency` field.
- [ ] Source-first curation task cards display the source-first label and selected concurrency when present.
- [ ] Source-first preview metadata renders current-source evidence chips for shipped and superseded patches.
- [ ] Source-first preview metadata renders git/PR/lifecycle entries as navigation hints, not closure evidence labels.
- [ ] Source-first fixture data includes per-item audit evidence, caps, concurrency settings, and diagnostics.
- [ ] README text documents current-source closure authority, fail-closed behavior, concurrency default `4`, and maximum `8`.
- [ ] Workstation type-check passes with extracted curation types or with `types.ts` still under the file-size ceiling.
- [ ] No workstation code calls a new daemon route for source-first curation.