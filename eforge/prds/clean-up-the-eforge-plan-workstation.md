---
title: Clean Up the eforge-plan Workstation
created: 2026-06-24
---

# Clean Up the eforge-plan Workstation

## Problem / Motivation

The eforge-plan workstation is close to the desired AI-first planning loop, but three cleanup gaps make it noisy and duplicate-prone.

Session-plan review is harder than it should be unless every plan has a concise executive summary that states changed surfaces, intended direction, out-of-scope boundaries, and validation confidence. Most UI and persistence behavior appears present, so the remaining risk is prompt specificity and regression coverage.

Several eforge-plan list contributions still risk large agent-context payloads or incomplete action metadata, while the broad-action linter currently flags single-record reads and writes because it scans free-text titles and descriptions.

The Recommendations rail can invite users or direct action callers to plan work that is already planned, submitted, queued, running, or PR-open because actionability is not provided as an extension-owned server projection.

Together, these gaps undermine the local-focus roadmap goal of a small, actionable, AI-first backlog workstation with safe human-in-the-loop planning.

## Goal

Plan an excursion-sized eforge-plan workstation cleanup that finishes the executive-summary prompt/test gap, applies compact paginated agent projections to remaining broad eforge-plan list actions, narrows false-positive contribution diagnostics, and makes recommendation lanes server-actionable so already planned or in-process work is suppressed or de-actioned.

The scope is bounded to the eforge-plan extension/workstation, planning prompt, and contribution validator surfaces; it does not expand engine scheduling or replace existing session-plan UX.

## Approach

Tighten the planning prompt so generated executive summaries explicitly cover changed surfaces, intended direction, out-of-scope boundaries, and validation/build confidence.

Prioritize prompt specificity and tests over rewriting already implemented executive-summary UI or persistence code.

Keep executive-summary behavior additive and backward compatible: plans with no summary still render safely, plans with a summary show it near the top, and detailed sections remain inspectable/editable behind progressive disclosure.

Add focused regression tests around summary persistence, plan-detail rendering, graceful fallback for legacy plans, progressive disclosure, and build-source normalization where current behavior exists.

Apply the existing compact planning-task listing pattern to remaining broad list actions: default compact output for agents, explicit pagination, and opt-in or full detail only when necessary.

Prefer `limit` plus `offset` pagination for consistency with `list-plan-revision-sessions` unless a specific action already has a cursor-based convention.

Add `outputProfile` metadata to list actions as appropriate, using `agent-compact` or `agent-paginated`.

Refine broad-action contribution diagnostics around structured action characteristics, ids/effective ids, side effects, output profile, and pagination rather than unstructured title or description text.

Do not classify `get-`, `preview-`, `remove-`, or write-side-effect actions as broad merely from free-text descriptions.

Extend `get-recommendations` or the equivalent eforge-plan projection with server-derived per-lane actionability, suppression reasons, lifecycle state, and associated plan/task/session links when available.

Recommendation entries should carry an actionability state such as actionable/non-actionable, a reason code/message, lifecycle evidence, and associated links.

The workstation should render the extension-owned recommendation actionability projection.

The Recommendations rail should render `Plan` only for actionable entries and optionally show suppressed entries as read-only links.

Duplicate guards for `start-planning-agent-task` should fail closed: when lifecycle evidence indicates a selection is already planned or in process, direct calls should return a clear reuse, reject, or deduplicated response rather than enqueueing another planning task.

The extension should compute recommendation actionability; the workstation should render that projection; the engine and daemon should not gain scheduling or authoring responsibility for this workflow.

Keep prompt edits minimal and compatible with current ownership.

Keep new and edited files within repository maintainability limits.

Use bounded edits for large existing files.

If `outputProfile`, pagination, or broad-action linting semantics are documented for extension authors, update the relevant docs or generated reference artifacts and run the docs drift gate.

Validation should provide high confidence through focused unit/component tests, contribution diagnostic checks, type-check, build, and maintainability gates.

Run targeted tests during each implementation slice.

Likely source surfaces include:

- `packages/engine/src/prompts/eforge-plan-planning-draft.md` for minimal prompt wording changes.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` for confirming summary persistence behavior.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` for confirming or fixing top summary rendering and progressive disclosure only if tests reveal drift.
- Build-source/session-plan normalization helpers wherever the executive summary is converted into build input.
- `eforge/extensions/eforge-plan/draft-plan-unit-actions.ts` for draft-unit pagination and projection.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` for planning-artifact pagination and projection.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` for `outputProfile` metadata on revision-session listing.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` and related schemas for confirming planning-task list compliance and updating duplicate guards.
- `packages/engine/src/extensions/contribution-validation.ts` for the broad-action linter heuristic.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` and `eforge/extensions/eforge-plan/schema.ts` for actionability wire/projection shape.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/recommendations-rail.tsx` for suppression and de-actioning UI.
- Existing lifecycle/session-plan/trace lookup utilities used by eforge-plan to derive active, planned, build, and PR state.

Assumptions:

- Current source audits are accurate: executive-summary UI/persistence/build-source behavior is mostly implemented.
- `list-planning-agent-tasks` is already compact and paginated.
- Recommendation actionability is only partially plumbed.
- Associated lifecycle signals are available from session plans, planning tasks, traces, queue/build state, and PR-open traces through existing eforge-plan utilities or storage readers.
- The workstation can accept additive actionability fields without requiring a breaking recommendation file format change.

Risks to validate against:

- Over-suppression from stale lifecycle data should be mitigated with reason/link metadata and mixed-lane tests.
- Under-suppression from stale browser state or direct action calls should be mitigated with server-derived actionability and `start-planning-agent-task` guards.
- Linter narrowing that misses true broad reads should be mitigated with tests that still flag an intentionally unbounded broad list action.

## Scope

In scope:

- Tighten the planning prompt so generated summaries explicitly cover changed surfaces, intended direction, out-of-scope boundaries, and validation/build confidence.
- Add focused regression tests around summary persistence where current behavior exists.
- Add focused regression tests around summary rendering where current behavior exists.
- Add focused regression tests around build-source normalization where current behavior exists.
- Avoid reworking already shipped executive-summary UI unless the audit finds drift.
- Apply pagination plus compact projection/outputProfile metadata to `list-draft-units`.
- Apply pagination plus compact projection/outputProfile metadata to `list-planning-artifacts`.
- Add `outputProfile` metadata to `list-plan-revision-sessions` while preserving its existing pagination controls.
- Confirm `list-planning-agent-tasks` remains compliant after the already shipped compact pagination work.
- Narrow broad-action contribution validation so `get-item` is not flagged solely because broad words appear in free-text fields.
- Narrow broad-action contribution validation so `preview-backlog-curation-task` is not flagged solely because broad words appear in free-text fields.
- Narrow broad-action contribution validation so `remove-planning-agent-task` is not flagged solely because broad words appear in free-text fields.
- Narrow broad-action contribution validation so write-like actions are not flagged solely because broad words appear in free-text fields.
- Extend `get-recommendations` or the equivalent eforge-plan projection with server-derived per-lane actionability.
- Include suppression reasons in recommendation actionability metadata.
- Include lifecycle state in recommendation actionability metadata.
- Include associated plan/task/session links in recommendation actionability metadata when available.
- Update the Recommendations rail to omit or clearly de-action planned/in-process recommendation lanes.
- Ensure the Recommendations rail never shows Plan CTAs for non-actionable entries.
- Add duplicate guards to `start-planning-agent-task` so stale UI or direct invocation reuses, rejects, or clearly de-duplicates already planned/in-process selections.

Out of scope:

- Moving eforge-plan-specific prompts out of the engine kernel.
- Expanding engine scheduling.
- Replacing existing session-plan UX.
- Redesigning the full plan-detail editor beyond progressive disclosure behavior that is already in place.
- Replacing recommendation generation.
- Replacing queue scheduling.
- Replacing PR/build lifecycle systems.
- Removing intentional full/debug board outputs if they are documented as debug-rich rather than normal agent list reads.

## Acceptance Criteria

- Planner prompt guidance explicitly requires executive summaries to state changed surfaces.
- Planner prompt guidance explicitly requires executive summaries to state intended direction.
- Planner prompt guidance explicitly requires executive summaries to state out-of-scope boundaries.
- Planner prompt guidance explicitly requires executive summaries to state validation/build confidence.
- Focused tests confirm or repaired behavior preserves executive summaries during persistence.
- Focused tests confirm or repaired behavior renders executive summaries in plan detail.
- Focused tests confirm or repaired behavior gracefully falls back for legacy plans without executive summaries.
- Focused tests confirm or repaired behavior keeps detailed sections inspectable/editable behind progressive disclosure.
- Focused tests confirm or repaired behavior normalizes executive summaries into build sources.
- `list-draft-units` exposes bounded pagination.
- `list-draft-units` returns a compact agent-oriented projection.
- `list-draft-units` declares `outputProfile` as `agent-compact` or `agent-paginated` as appropriate.
- `list-planning-artifacts` exposes bounded pagination.
- `list-planning-artifacts` returns a compact agent-oriented projection.
- `list-planning-artifacts` declares `outputProfile` as `agent-compact` or `agent-paginated` as appropriate.
- `list-plan-revision-sessions` declares an `outputProfile`.
- `list-plan-revision-sessions` preserves its existing `limit` behavior.
- `list-plan-revision-sessions` preserves its existing `offset` behavior.
- `list-planning-agent-tasks` remains compact after the already shipped compact pagination work.
- `list-planning-agent-tasks` remains paginated after the already shipped compact pagination work.
- Contribution diagnostics produce zero broad-action warnings for `get-item` solely because title or description text contains list/search/board words.
- Contribution diagnostics produce zero broad-action warnings for `preview-backlog-curation-task` solely because title or description text contains list/search/board words.
- Contribution diagnostics produce zero broad-action warnings for `remove-planning-agent-task` solely because title or description text contains list/search/board words.
- Contribution diagnostics produce zero broad-action warnings for write-like actions solely because title or description text contains list/search/board words.
- Any remaining broad-action warnings correspond only to genuinely broad large-output reads or intentional debug-rich actions.
- `get-recommendations` or an extension-owned projection returns server-derived actionability metadata for recommendation entries.
- Recommendation actionability metadata includes non-actionable reasons when an entry is non-actionable.
- Recommendation actionability metadata includes associated plan links when available.
- Recommendation actionability metadata includes associated task links when available.
- Recommendation actionability metadata includes associated session links when available.
- Recommendations Next up omits or clearly suppresses items already linked to planned session plans.
- Recommendations Next up omits or clearly suppresses items already linked to submitted session plans.
- Recommendations Next up omits or clearly suppresses items already linked to active planning tasks.
- Recommendations Next up omits or clearly suppresses items already linked to queued build traces.
- Recommendations Next up omits or clearly suppresses items already linked to running build traces.
- Recommendations Next up omits or clearly suppresses items already linked to active build sessions.
- Recommendations Next up omits or clearly suppresses items already linked to PR-open traces.
- Recommendations Safe in parallel omits or clearly suppresses items already linked to planned session plans.
- Recommendations Safe in parallel omits or clearly suppresses items already linked to submitted session plans.
- Recommendations Safe in parallel omits or clearly suppresses items already linked to active planning tasks.
- Recommendations Safe in parallel omits or clearly suppresses items already linked to queued build traces.
- Recommendations Safe in parallel omits or clearly suppresses items already linked to running build traces.
- Recommendations Safe in parallel omits or clearly suppresses items already linked to active build sessions.
- Recommendations Safe in parallel omits or clearly suppresses items already linked to PR-open traces.
- The Recommendations rail never renders the Plan CTA for a non-actionable recommendation entry.
- Direct `start-planning-agent-task` calls cannot create duplicate planning work for already planned selections.
- Direct `start-planning-agent-task` calls cannot create duplicate planning work for in-process selections.
- Direct `start-planning-agent-task` calls reject, reuse, or de-duplicate already planned selections with a clear result.
- Direct `start-planning-agent-task` calls reject, reuse, or de-duplicate in-process selections with a clear result.
- Tests cover recommendation actionability for a planned session plan.
- Tests cover recommendation actionability for a submitted session plan.
- Tests cover recommendation actionability for an active planning task.
- Tests cover recommendation actionability for a queued trace.
- Tests cover recommendation actionability for a building trace.
- Tests cover recommendation actionability for a PR-open trace.
- Tests cover recommendation actionability for mixed safe-parallel lanes.
- Tests cover list-action metadata for each previously unbounded list action.
- Tests cover list-action pagination for each previously unbounded list action.
- Tests cover compact projections for each previously unbounded list action.
- Tests cover linter false-positive cases for `get-item`.
- Tests cover linter false-positive cases for `preview-backlog-curation-task`.
- Tests cover linter false-positive cases for `remove-planning-agent-task`.
- Tests cover linter false-positive cases for write-like actions.
- Tests confirm a deliberately unbounded broad list read still produces a broad-action warning.
- UI tests confirm the Recommendations rail hides Plan for non-actionable entries.
- UI tests confirm suppressed recommendation entries render links when displayed and links are available.
- UI tests confirm suppressed recommendation entries render reasons when displayed.
- Tests cover direct `start-planning-agent-task` invocation for duplicate planned selections.
- Tests cover direct `start-planning-agent-task` invocation for duplicate in-process selections.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm build` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm docs:check` exits 0 when generated docs or extension contribution reference artifacts change.