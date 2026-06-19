---
title: Add Full Implementation Audit Mode to Backlog Curation
created: 2026-06-19
---

# Add Full Implementation Audit Mode to Backlog Curation

## Problem / Motivation

Current analyze-all backlog curation is centered on git-delta evidence since the last accepted analysis baseline. Dogfood feedback shows this is not enough for trust-building cleanup passes: users need an explicit mode that rechecks every open backlog item for shipped, partially implemented, superseded, stale/invalid, or still-valid status, including work implemented before the current baseline or by manual/out-of-band changes. Without this, generated recommendations can keep pointing at already-done or partially-done work.

## Goal

Add explicit backlog curation scan modes for routine delta analysis and opt-in full implementation audits, so users can choose between lower-cost baseline-based analysis and comprehensive open-item rechecks with bounded evidence.

## Approach

- Represent scan mode as an explicit string union, such as `delta` and `full-implementation-audit`, rather than inferring behavior from a missing baseline or redraft steering.
- Keep `delta` mode as the routine, lower-cost path.
- Make full implementation audit mode explicitly opt-in.
- In full audit mode, include every open backlog item in the audit scope, not only items matched by the git-delta range.
- Collect bounded evidence from current repository state, code search, test search, documentation search, lifecycle traces, git history, PR history when available, and existing shipped/superseded evidence classifiers.
- Surface evidence source, confidence, coverage, caps, and diagnostics in the source context and preview so the planning agent and user can distinguish strong, partial, ambiguous, and no-change findings.
- Keep source generation deterministic and bounded.
- Provide the planning agent with compact candidates, evidence prefixes, confidence, and diagnostics.
- Do not allow the planning agent to invent repository evidence.
- Prefer `sourceProvider.input` for passing scan mode to the daemon-owned planning task so the daemon remains a generic task runner and the `eforge-plan` extension owns curation semantics.
- Include scan mode in source fingerprints so previews, recommendation freshness, and accepted baselines cannot accidentally compare delta and full-audit contexts as equivalent.
- Preserve conservative closure rules: only strong lifecycle/git/PR evidence can close items.
- Route ambiguous shipped/superseded candidates to skipped or needs-input outcomes.
- Keep partial implementation items open while appending evidence/recheck notes and shaping recommendations around remaining work.
- Reuse existing recommendation overlay logic after mentally applying curation changes, rather than building a parallel recommendation pipeline.
- Ensure generated recommendations are based on the prospective post-curation state for full-audit drafts.
- UI copy should call out that full audit is comprehensive but still bounded by caps and availability, especially when PR history or git history cannot be fully enriched.
- Keep the work in the first-party `eforge-plan` extension.
- The engine and daemon should continue to provide generic planning-task execution, deferred source-provider loading, and result storage.
- Curation-specific scan modes, evidence gathering, and UI controls belong in the extension/workstation.

### Code Impact

- Update `eforge/extensions/eforge-plan/backlog-curation-actions.ts` to extend analyze-all input handling, task topic/derived request, sourceProvider input, active-task reuse rules, and workflow entry metadata for scan mode.
- Update `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` to add a scan-mode union and preview/workflow fields if persisted/displayed there.
- Update `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` to add a scan-mode union and preview/workflow fields if persisted/displayed there.
- Update `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts` to read `context.input.scanMode` and pass it to source construction.
- Update `eforge/extensions/eforge-plan/backlog-curation-source.ts` to include scan mode in source text, fingerprint, and preview metadata.
- Update `eforge/extensions/eforge-plan/backlog-curation-source.ts` to preserve current delta collection.
- Update `eforge/extensions/eforge-plan/backlog-curation-source.ts` to add full-audit evidence context with truncation and diagnostics.
- Reuse existing evidence modules such as `backlog-curation-git-delta.ts`, `backlog-curation-evidence-classification.ts`, `shipped-evidence-*`, `trace-store.ts`, and `trace-activity.ts` before adding a focused full-audit collector module.
- Update `backlog-curation-accepted-baseline.ts` and the apply flow to decide whether accepted full-audit runs advance the delta baseline.
- Update `backlog-curation-accepted-baseline.ts` and the apply flow to record a distinguishable pass kind/coverage diagnostic.
- Update workstation UI under `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/`.
- Update `PlanWithAiPanel`.
- Update `use-planning-task-workflows`.
- Update `BacklogCurationPreview`.
- Update the workstation backlog view model.
- Update workstation backlog types.
- Update workstation backlog mock data.
- Update workstation backlog tests.
- Add or update focused tests in `eforge/extensions/eforge-plan/__tests__/backlog-curation-*.test.ts`.
- Add or update workstation preview and panel tests.

### Assumptions

- The existing deferred source-provider contract supports an input object, so no daemon HTTP route change is required just to pass scan mode.
- PR history enrichment may be unavailable.
- Full audit must degrade with diagnostics rather than fail the whole curation task when PR history enrichment is unavailable.
- Full audit can be comprehensive over open backlog items while still using bounded evidence per item.

### Risks And Mitigations

- False-positive closures are the highest risk.
- False-positive closures should be mitigated with strict strong-evidence prefixes, confidence, and needs-input routing for ambiguity.
- Full audit can exceed context or runtime budgets.
- Context and runtime budget risks should be mitigated with caps, truncation counters, diagnostics, and a UI warning.
- Mode metadata can drift between action input, workflow index, source fingerprint, preview metadata, and workstation types.
- Mode metadata drift should be mitigated with schemas, tests, and fixtures.
- PR/git history may be unavailable or incomplete in shallow/offline repos.
- Full audit must degrade gracefully when PR/git history is unavailable or incomplete.
- Recommendation overlay can accidentally reference same-draft closures.
- Recommendation overlay risks should be mitigated with validation gates and tests around prospective post-curation state.

### Validation Plan

- Add unit tests for scan-mode schema parsing.
- Add unit tests for action start payloads.
- Add unit tests for active-task reuse by mode.
- Add unit tests for source fingerprint differences.
- Add source/evidence tests for pre-baseline shipped evidence.
- Add source/evidence tests for partial implementation.
- Add source/evidence tests for an unchanged fresh item.
- Add source/evidence tests for ambiguous shipped/superseded matches.
- Add preview/apply/recommendation overlay tests that prove same-draft closures are excluded.
- Add preview/apply/recommendation overlay tests that prove partial items remain recommended only for remaining work.
- Add workstation tests for mode selection.
- Add workstation tests for disabled/loading states.
- Add workstation tests for preview mode label.
- Add workstation tests for the full-audit warning.
- Run targeted vitest files.
- Run `pnpm type-check`.
- Run `pnpm maintainability:check` if new modules or large UI files are touched.

## Scope

### In Scope

- Add explicit scan modes for backlog curation: delta since last accepted analysis and full implementation audit.
- Keep delta mode as the routine, lower-cost path.
- Make full audit explicitly opt-in.
- Include every open backlog item in full audit scope.
- Preserve current delta collection.
- Add full-audit evidence context with truncation and diagnostics.
- Support shipped, superseded, partial-implementation, stale/invalid, no-change, skipped, and needs-input outcomes.
- Support partial implementation proposals by appending evidence/recheck notes and shaping recommendations around remaining work instead of closing the item.
- Ensure generated recommendations are based on the prospective post-curation state for full-audit drafts.
- Update the workstation UI so users can choose the mode.
- Ensure previews clearly identify which mode produced them.
- Add a workstation UI warning that full audit may take longer or use more context.
- Update `eforge-plan` README/action documentation for the two modes.
- Update workstation copy for the two modes.

### Out Of Scope

- Automatic mutation without preview/apply.
- Changing core build-engine scheduling.
- Adding auto-mode backlog draining.

## Acceptance Criteria

- Analyze-all backlog curation can be started in `delta` mode.
- Analyze-all backlog curation can be started in `full-implementation-audit` mode.
- Delta mode uses the existing accepted-baseline behavior for determining analysis scope.
- Existing delta-mode regression expectations continue to pass.
- Full implementation audit mode includes every open backlog item in the audit scope.
- Full implementation audit mode can produce a `shipped` outcome.
- Full implementation audit mode can produce a `superseded` outcome.
- Full implementation audit mode can produce a `partial-implementation` outcome.
- Full implementation audit mode can produce a `stale/invalid` outcome.
- Full implementation audit mode can produce a `no-change` outcome.
- Full implementation audit mode can produce a `skipped` outcome.
- Full implementation audit mode can produce a `needs-input` outcome.
- Full audit evidence can cite repository code search.
- Full audit evidence can cite tests.
- Full audit evidence can cite documentation.
- Full audit evidence can cite current file state.
- Full audit evidence can cite lifecycle traces.
- Full audit evidence can cite git history.
- Full audit evidence can cite PR history when PR history is available.
- Each proposed change in full audit preview shows evidence source.
- Each proposed change in full audit preview shows evidence confidence.
- Full audit source context and preview show coverage information.
- Full audit source context and preview show evidence caps.
- Full audit source context and preview show diagnostics.
- Strong full-audit evidence can support shipped closures when the implementation predates the last accepted analysis baseline.
- Strong full-audit evidence can support superseded closures when the implementation predates the last accepted analysis baseline.
- Ambiguous shipped evidence is routed to `skipped` or `needs-input`.
- Ambiguous superseded evidence is routed to `skipped` or `needs-input`.
- Ambiguous shipped evidence does not produce a closure patch.
- Ambiguous superseded evidence does not produce a closure patch.
- Partial implementation proposals preserve the backlog item as open.
- Partial implementation proposals update evidence/recheck notes.
- Partial implementation proposals shape recommendations around remaining work.
- Full-audit generated recommendations exclude closures proposed in the same draft.
- Full-audit generated recommendations reflect partial implementation proposals.
- Full-audit generated recommendations reflect shipped proposals.
- Full-audit generated recommendations reflect superseded proposals.
- UI previews show the scan mode that produced the preview.
- UI previews include a warning that full audit may take longer.
- UI previews include a warning that full audit may use more context.
- The `eforge-plan` README documents the `delta` mode.
- The `eforge-plan` README documents the `full-implementation-audit` mode.
- The `eforge-plan` action documentation documents the `delta` mode.
- The `eforge-plan` action documentation documents the `full-implementation-audit` mode.
- Workstation copy describes the `delta` mode.
- Workstation copy describes the `full-implementation-audit` mode.
- Regression tests cover full-audit closure behavior.
- Regression tests cover partial implementation behavior.
- Regression tests cover a fresh no-change item.
- Regression tests cover an ambiguous match.
- Regression tests cover recommendation overlay behavior.
- Scan-mode schema parsing tests pass.
- Action start payload tests pass.
- Active-task reuse by mode tests pass.
- Source fingerprint difference tests pass.
- Source/evidence tests for pre-baseline shipped evidence pass.
- Source/evidence tests for partial implementation pass.
- Source/evidence tests for an unchanged fresh item pass.
- Source/evidence tests for ambiguous shipped/superseded matches pass.
- Preview/apply/recommendation overlay tests prove same-draft closures are excluded.
- Preview/apply/recommendation overlay tests prove partial items remain recommended only for remaining work.
- Workstation tests for mode selection pass.
- Workstation tests for disabled/loading states pass.
- Workstation tests for preview mode label pass.
- Workstation tests for the full-audit warning pass.
- Targeted vitest files exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0 when new modules or large UI files are touched.