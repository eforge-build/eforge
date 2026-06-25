---
title: Unify live coverage-derived backlog planning state
created: 2026-06-25
---

# Unify live coverage-derived backlog planning state

## Problem / Motivation

The `eforge-plan` workstation can leave backlog items stuck in a Planned or ready-but-not-plan-eligible state after their source session plan is deleted or abandoned. In the observed case, the item has `userStatus` `candidate` and only an abandoned session plan, but board, recommendation, and planning-task flows still see `planned-session-plan` coverage and suppress new planning with `reasonCode` `planned-session-plan`.

This makes the workstation unreliable for AI-first backlog planning because users cannot restart planning after discarding a stale plan, and different surfaces can disagree about whether an item is actionable.

The root cause is split source of truth after SQLite projections became the hot path for backlog and planning workstation state. File content, SQLite cached summaries, `lifecycle_evidence.is_current`, `session_plan_items`, legacy trace sidecars, recommendation actionability, backend start guards, and frontend `isPlanEligible` all encode overlapping planning-state rules.

Two concrete failures demonstrate the issue:

1. Session-plan sync writes current `planned-session-plan` lifecycle evidence for source items. When the session plan is later abandoned or deleted, the plan row changes status but current lifecycle evidence can remain authoritative, so board projections and duplicate-coverage guards treat historical planned coverage as live coverage.
2. Planning-task creation applies a valid `sessionPlanCreationDraft`, writes a populated Markdown file, computes readiness, and returns readiness to the caller, but subsequent SQLite sync calls do not persist `readinessSummary`. SQL projections read only `session_plans.readiness_summary_json`, so the workstation shows no selected, covered, or missing dimensions even though parsing the file would show them.

The build tested many individual shapes and return values, but not end-to-end workflow invariants after the SQLite projection became authoritative.

## Goal

Backlog lane state and planning eligibility should come from one backend live-coverage projection instead of stale lifecycle evidence or duplicated frontend reason-code rules.

Candidate items with only historical abandoned or deleted plan evidence should return to an eligible open state and be plannable again, while active nonterminal coverage continues to block duplicate planning with explanatory links.

## Approach

- Treat live nonterminal coverage as the source of truth for plan eligibility.
- Treat `user_status` as human-authored metadata or fallback, not proof of active plan coverage.
- Use a shared backend helper or projection that returns `planEligible`, explanatory coverage links, and actionability data.
- Have board, item detail, recommendation, and planning-task guard code call the shared backend helper or consume its projection.
- Keep canonical/session-plan sync, projection coverage, lifecycle, and read models aligned around one terminal-status and live-coverage policy.
- Make deleted, abandoned, superseded, or otherwise terminalized session plans stop producing current `planned-session-plan` coverage.
- Mark existing current `planned-session-plan` lifecycle evidence tied to terminal session plans non-current during sync or repair, or make all live projections and duplicate-coverage guards ignore it.
- Retain historical session plans and lifecycle evidence for audit and search, but make historical evidence non-current or ignored for nonterminal coverage.
- Keep SQLite readiness synchronized with the current Markdown file by persisting `readiness_summary_json` or recomputing readiness from the file when cached readiness is absent or stale.
- Expose an explicit readiness freshness or source indicator in SQL planning projections when useful, so missing cached readiness cannot silently render as “no dimensions selected.”
- Centralize terminal-status and live-coverage policy, or add cross-surface contract tests to prevent drift.
- Do not accidentally make failed or partial current results eligible if product policy still treats them as blocking.
- Keep frontend schema and type changes synchronized with backend projections.

Likely implementation touchpoints include:

- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts`
- `eforge/extensions/eforge-plan/canonical/coverage.ts`
- `eforge/extensions/eforge-plan/projections/coverage.ts`
- `eforge/extensions/eforge-plan/projections/lifecycle.ts`
- `eforge/extensions/eforge-plan/projections/items.ts`
- `eforge/extensions/eforge-plan/projections/recommendations.ts`
- `eforge/extensions/eforge-plan/recommendation-actionability.ts`
- `eforge/extensions/eforge-plan/agent-task-actions.ts`
- `eforge/extensions/eforge-plan/planner-orchestration.ts`
- Workstation types, adapters, and views such as `board-model.ts`, `use-backlog-selection.ts`, `recommendations-rail.tsx`, and compact-board adapters.

## Scope

In scope:

- Canonical/session-plan sync.
- Projection coverage models.
- Projection lifecycle models.
- Projection read models.
- Recommendation actionability.
- Planning-task duplicate-coverage guards.
- Planning-task start validation.
- Workstation board consumers.
- Workstation selection consumers.
- Readiness persistence or recomputation for session plans.
- Repair or ignore behavior for stale `lifecycle_evidence.is_current` rows.
- Tests for SQLite projections, actionability, planning guards, and workstation consumers.

Out of scope:

- eforge build-engine orchestration.
- Daemon scheduling.
- Broadening the engine into planning UX.
- Destructive removal of historical audit artifacts.
- Changing audit/search retention of historical session plans or lifecycle evidence.

## Acceptance Criteria

- After a completed `sessionPlanCreationDraft` is applied, SQL readiness data for the session plan matches the readiness returned by the apply action.
- After a completed `sessionPlanCreationDraft` is applied, `show-session-plan` immediately returns readiness data that matches the apply action response.
- After a completed `sessionPlanCreationDraft` is applied, `list-planning-artifacts` immediately returns readiness data that matches the apply action response.
- After a completed `sessionPlanCreationDraft` is applied, readiness is persisted in `session_plans.readiness_summary_json` or recomputed from the current Markdown file before SQL projections render it.
- After `create-session-plan`, SQL readiness exposed to consumers matches readiness parsed from the current Markdown file.
- After `select-session-plan-dimensions`, SQL readiness exposed to consumers matches readiness parsed from the current Markdown file.
- After `set-session-plan-section`, SQL readiness exposed to consumers matches readiness parsed from the current Markdown file.
- After `skip-dimension`, SQL readiness exposed to consumers matches readiness parsed from the current Markdown file.
- After metadata updates that affect readiness, SQL readiness exposed to consumers matches readiness parsed from the current Markdown file.
- After abandoned-plan replacement, SQL readiness exposed to consumers matches readiness parsed from the current Markdown file.
- When cached readiness is absent or stale, SQL projections return readiness parsed from the current Markdown file instead of rendering selected, covered, and missing dimensions as empty solely because `readiness_summary_json` is missing.
- SQL planning projections expose an explicit readiness freshness or source indicator when missing cached readiness would otherwise be indistinguishable from “no dimensions selected.”
- Deleting a session plan stops producing current `planned-session-plan` coverage for its source items.
- Abandoning a session plan stops producing current `planned-session-plan` coverage for its source items.
- Superseding a session plan stops producing current `planned-session-plan` coverage for its source items.
- Otherwise terminalizing a session plan stops producing current `planned-session-plan` coverage for its source items.
- After `delete-session-plan` marks a session plan abandoned while retaining its Markdown file, the retained Markdown file does not produce current `planned-session-plan` coverage.
- Existing current `planned-session-plan` lifecycle evidence tied to terminal session plans does not affect live projections.
- Existing current `planned-session-plan` lifecycle evidence tied to terminal session plans does not affect duplicate-coverage guards.
- Board lane counts derive plan eligibility from the shared backend live-coverage policy.
- Board readiness counts derive plan eligibility from the shared backend live-coverage policy.
- `get-item` detail derives plan eligibility from the shared backend live-coverage policy.
- Recommendation actionability derives plan eligibility from the shared backend live-coverage policy.
- Planning-task start validation derives plan eligibility from the shared backend live-coverage policy.
- Workstation board consumers use backend `planEligible`, coverage, or actionability projection data instead of independent hard-coded reason-code eligibility rules when that backend data is present.
- Workstation selection consumers use backend `planEligible`, coverage, or actionability projection data instead of independent hard-coded reason-code eligibility rules when that backend data is present.
- Candidate items with only historical abandoned plan evidence return to Inbox or another eligible open state.
- Candidate items with only historical deleted plan evidence return to Inbox or another eligible open state.
- Candidate items with only historical abandoned plan evidence can start a new planning task.
- Candidate items with only historical deleted plan evidence can start a new planning task.
- Items with active editable plans remain non-eligible with explanatory links.
- Items with active submitted plans remain non-eligible with explanatory links.
- Items with active planning tasks remain non-eligible with explanatory links.
- Items with queued builds remain non-eligible with explanatory links.
- Items with running builds remain non-eligible with explanatory links.
- Items with active build sessions remain non-eligible with explanatory links.
- Items with open PRs remain non-eligible with explanatory links.
- Items with failed current results remain non-eligible with explanatory links.
- Items with partial current results remain non-eligible with explanatory links.
- Items with shipped terminal results remain non-eligible with explanatory links.
- Items with merged terminal results remain non-eligible with explanatory links.
- A real extension workflow regression test captures a backlog item in a temp project.
- A real extension workflow regression test starts and applies an agent creation draft for the captured item.
- A real extension workflow regression test verifies SQL plan readiness matches the parsed session-plan Markdown file after draft apply.
- A real extension workflow regression test abandons or deletes the session plan.
- A real extension workflow regression test verifies board data marks the item eligible when no live coverage remains.
- A real extension workflow regression test verifies `get-item` marks the item eligible when no live coverage remains.
- A real extension workflow regression test verifies recommendations mark the item actionable when no live coverage remains.
- A real extension workflow regression test verifies starting a planning task succeeds when no live coverage remains.
- A SQLite canonical or projection test verifies active session plans produce live `planned-session-plan` coverage for source items.
- A SQLite canonical or projection test verifies abandoned session plans do not produce live `planned-session-plan` coverage for source items.
- A SQLite canonical or projection test verifies deleted session plans do not produce live `planned-session-plan` coverage for source items.
- A SQLite canonical or projection test verifies stale `lifecycle_evidence.is_current` rows tied to terminal session plans do not produce live coverage.
- A test verifies `user_status: planned` alone is treated as metadata or fallback, not proof of active plan coverage.
- A test verifies `user_status: active` alone is treated as metadata or fallback, not proof of active plan coverage.
- A test verifies live backend coverage wins over legacy trace-sidecar data when they disagree.
- A workstation test verifies board ready filtering uses backend `planEligible` instead of local reason-code duplication.
- A workstation test verifies backlog selection uses backend `planEligible` instead of local reason-code duplication.
- A recommendation actionability test suppresses planning for an item with live nonterminal coverage.
- A recommendation actionability test allows planning for an item with only historical abandoned or deleted plan evidence.
- A start-planning-agent-task duplicate-coverage guard test rejects an item with live nonterminal coverage.
- A start-planning-agent-task duplicate-coverage guard test allows an item with only historical abandoned or deleted plan evidence.
- Targeted vitest suites for `eforge-plan` canonical, projection, actionability, action, and workstation coverage exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

Reproduction scenario to preserve:

1. Start with a candidate backlog item that has no active plan, task, build, or PR coverage.
2. Create or sync a session plan sourced from that item so `planned-session-plan` coverage appears.
3. Delete or abandon the session plan through `delete-session-plan`, which marks the plan abandoned while retaining the Markdown file.
4. Refresh or list board data, get the item detail, inspect recommendations actionability, and attempt to start a new planning task for the same item.
5. Expected behavior is that because no nonterminal plan, task, queue, build, PR, or result covers the item, it returns to Inbox or another eligible open state and can be planned again.
6. Current failure is that stale current lifecycle evidence or duplicated frontend eligibility rules can keep the item in a planned and non-actionable state with `reasonCode` `planned-session-plan`.