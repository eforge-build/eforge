---
id: plan-01-scan-mode-plumbing
name: Scan Mode Plumbing and Baseline Metadata
branch: add-full-implementation-audit-mode-to-backlog-curation/plan-01-scan-mode-plumbing
agents:
  builder:
    effort: high
    rationale: Cross-file schema, workflow-index, source-provider, and apply-path
      metadata change where missing one consumer can break durable task reuse or
      preview parsing.
  reviewer:
    effort: high
    rationale: Review must verify scan-mode metadata stays synchronized across
      action input, workflow entries, source fingerprints, preview output,
      retry/redraft, and accepted baselines.
---

# Scan Mode Plumbing and Baseline Metadata

## Architecture Context

Backlog curation semantics belong to the first-party `eforge-plan` extension. The daemon already supports `sourceProvider.input`, so scan mode must be passed as extension-owned task input rather than by adding daemon routes or route-specific behavior. Delta mode remains the default, low-cost path; full audit mode is represented explicitly but its evidence collector is added in plan-02.

## Implementation

### Overview

Add an explicit backlog curation scan-mode union (`delta` and `full-implementation-audit`) and propagate it through analyze-all action input, task start payloads, workflow entries, deferred source-provider input, source fingerprints, preview metadata, retry/redraft, and accepted-analysis baseline recording.

### Key Decisions

1. Default absent `scanMode` to `delta` for backward compatibility with existing callers and fixtures.
2. Store scan mode on durable workflow entries so active-task reuse, retry, redraft, preview labels, and apply-time baseline recording use the mode that produced the source.
3. Include scan mode in the source fingerprint projection so delta and full-audit contexts cannot be compared as equivalent.
4. Record accepted curation baselines with distinguishable pass kinds such as `backlog-curation:delta` and `backlog-curation:full-implementation-audit`, while preserving recommendation-refresh baseline behavior.

## Scope

### In Scope

- Add scan-mode schemas, TypeScript types, defaults, normalizers, and label helpers in the extension.
- Extend `analyze-all-backlog` input parsing and start request construction to include `sourceProvider.input.scanMode`.
- Make active curation task reuse mode-specific.
- Persist scan mode on planning workflow entries and expose it through list/retry/redraft/apply paths.
- Parse deferred source-provider input and pass the mode to source construction.
- Add `scanMode` and mode guidance to source JSON, preview metadata, and source fingerprints.
- Preserve current delta git-delta collection behavior.
- Record mode-aware accepted-analysis baseline pass kind and coverage diagnostics during curation apply.
- Add/update focused extension tests for schemas, action payloads, active reuse, source fingerprints, preview metadata, retry/redraft preservation, and baseline pass kind.

### Out of Scope

- Full implementation audit evidence collection beyond mode placeholders; plan-02 adds that collector.
- Workstation mode selection UI and docs; plan-03 adds those changes.
- Daemon HTTP routes, engine scheduling, and core planning-task execution changes.

## Files

### Create

- None expected.

### Modify

- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — add `BacklogCurationScanModeSchema`, default/type exports, mode-aware analyze-all input, workflow entry field, preview details field, and preview metadata schema pieces needed by later plans.
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — add optional `scanMode` to `PlanningTaskWorkflowEntrySchema` and exported workflow entry type.
- `eforge/extensions/eforge-plan/backlog-curation-actions.ts` — accept `scanMode`, derive mode-specific task topic text, put `{ scanMode }` into `sourceProvider.input`, key the start lock by mode, record mode on workflow entries, and reuse only queued/running unapplied curation tasks with the same mode.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts` — read `context.input.scanMode`, normalize it, and pass it to `buildBacklogCurationSource`.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — accept `scanMode` in build options, include `scanMode` and compact `scanModeGuidance` in source JSON/source text, include the mode in the fingerprint projection, and write/read mode-aware preview metadata.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — preserve parent curation scan mode during retry/redraft source rebuilds and linked workflow entries.
- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts` — keep backlog-curation list/find helpers compatible with optional scan-mode filtering where needed by action reuse and tests.
- `eforge/extensions/eforge-plan/backlog-curation-accepted-baseline.ts` — accept curation scan mode, compute pass kind and coverage metadata, and leave recommendation-refresh calls intact.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — pass `entry.scanMode ?? 'delta'` into accepted baseline recording and return preview `scanMode` from source metadata when present.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts` — cover explicit `delta`, explicit `full-implementation-audit`, start payload `sourceProvider.input`, and active-task reuse separation by mode.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — cover fingerprint differences between delta and full mode and preview metadata scan-mode persistence.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-accepted-baseline.test.ts` — cover mode-aware curation pass kinds and coverage diagnostics.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — cover apply passing workflow-entry scan mode into baseline recording.
- `eforge/extensions/eforge-plan/__tests__/planning-agent-task-actions.test.ts` or existing retry/redraft test file if a closer fit exists — cover curation retry/redraft preserving scan mode on the new workflow entry.

## Verification

- [ ] `AnalyzeAllBacklogInputSchema` accepts `{}`, `{ "scanMode": "delta" }`, and `{ "scanMode": "full-implementation-audit" }`, and rejects any other mode string.
- [ ] `analyze-all-backlog` start payload contains `sourceProvider.input.scanMode` for both modes.
- [ ] A queued or running delta task is reused only for a delta request; a full-audit request starts a separate task.
- [ ] Delta and full-audit source fingerprints differ for the same backlog state.
- [ ] Source preview metadata and `preview-backlog-curation-task` output expose the scan mode that produced the source.
- [ ] Retry and redraft of a curation workflow entry preserve that entry's scan mode.
- [ ] Accepted curation apply records a mode-specific pass kind and coverage metadata, and recommendation-refresh baseline recording is unchanged.
- [ ] Existing delta-mode git-delta regression tests still pass.