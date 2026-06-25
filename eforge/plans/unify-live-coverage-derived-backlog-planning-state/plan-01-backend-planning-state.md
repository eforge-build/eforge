---
id: plan-01-backend-planning-state
name: Backend Live Coverage and Readiness Projection
branch: unify-live-coverage-derived-backlog-planning-state/plan-01-backend-planning-state
agents:
  builder:
    effort: high
    rationale: Coordinates SQLite canonical sync, projection eligibility, planning
      guards, recommendation actionability, and readiness caching across
      multiple backend files.
  reviewer:
    effort: high
    rationale: The backend contract affects duplicate planning prevention and
      cross-surface state; review needs focused checks for drift between
      coverage and eligibility helpers.
  tester:
    effort: high
    rationale: Regression coverage must exercise real extension workflows plus
      targeted canonical and projection cases.
---

# Backend Live Coverage and Readiness Projection

## Architecture Context

`eforge-plan` now reads most backlog and workstation state from SQLite projections. The current implementation still lets `lifecycle_evidence` rows with `planned-session-plan` act as live state after a session plan is abandoned or deleted, and session-plan readiness returned by adapter mutations is not persisted into `session_plans.readiness_summary_json`. This plan makes backend live coverage and session-plan readiness the authoritative contract that board, item detail, recommendations, and planning-task guards consume.

## Implementation

### Overview

Add a shared backend planning-state policy that separates live coverage blockers from historical audit evidence. Active session plans, submitted plans, planning tasks, active build sessions, queue/build/PR state, and current failed/partial/shipped/merged result evidence block planning. Abandoned, deleted, superseded, completed, or otherwise terminal session plans remain searchable/auditable but no longer create current `planned-session-plan` coverage. Persist or recompute readiness from the Markdown file before SQL projections render session-plan details or artifact lists.

### Key Decisions

1. Active session-plan coverage must come from `session_plan_items` joined to nonterminal `session_plans`, not from `lifecycle_evidence` rows whose reason is `planned-session-plan`.
2. Planning eligibility is a backend projection field (`planEligible`) derived from the same live-coverage/result-blocker helper used by recommendation actionability and planning-task start/apply validation.
3. `user_status` values `planned` and `active` may still influence legacy/fallback lane display, but they must not make an item non-eligible when no backend live coverage or current result blocker exists.
4. Readiness projections must prefer persisted cache only when it represents the current Markdown body; if cache is absent or stale, parse the current file and mark the source/freshness in projection output.

## Scope

### In Scope

- Shared backend terminal-status and plan-eligibility policy.
- Canonical session-plan sync handling for terminal statuses and stale planned lifecycle evidence.
- Projection coverage, lifecycle, item, board, recommendation actionability, and planning guard consumers.
- Session-plan readiness persistence for action handlers and planning-task creation draft apply.
- SQL projection fallback that parses current Markdown readiness when cache is absent or stale.
- Backend tests for canonical coverage, projection coverage, actionability, planning guards, and real extension workflow regression.
- `eforge/extensions/eforge-plan/README.md` updates for new compact board/readiness projection fields.

### Out of Scope

- eforge build-engine orchestration.
- Daemon scheduling.
- Historical audit artifact deletion.
- New planning UX beyond the fields required by this source.

## Files

### Create

- `eforge/extensions/eforge-plan/planning-state-policy.ts` — shared terminal-status, live-coverage, and plan-eligibility policy helpers for canonical and projection layers.
- `eforge/extensions/eforge-plan/__tests__/live-coverage-planning-state-regression.test.ts` — real extension workflow regression for create/start/apply readiness, abandon/delete eligibility, board/get-item/recommendation actionability, and planning-task restart.

### Modify

- `eforge/extensions/eforge-plan/canonical/coverage.ts` — reuse shared policy; add a plan-eligibility guard that includes current failed/partial/shipped/merged result blockers while excluding terminal session-plan rows.
- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts` — persist readiness summaries when provided; write `status` on planned evidence; stop writing current planned evidence for terminal session statuses; mark existing current planned evidence for the session non-current when a terminal status is synced.
- `eforge/extensions/eforge-plan/sqlite/repositories/projections/lifecycle.ts` — expose fields needed by policy filtering, such as `evidenceKind`, and keep projection row mapping aligned with lifecycle evidence columns.
- `eforge/extensions/eforge-plan/projections/lifecycle.ts` — ignore `planned-session-plan` lifecycle evidence for effective lifecycle decisions; use shared terminal-status policy; return `planEligible` from `computeEffectiveLifecycle`.
- `eforge/extensions/eforge-plan/projections/coverage.ts` — split store-level coverage/eligibility logic from the `withProjectionStore` wrapper; use the shared policy for live blockers and terminal result blockers.
- `eforge/extensions/eforge-plan/projections/items.ts` — include `planEligible` and any compact eligibility reason/link metadata on compact items and `get-item` detail; derive it from the shared backend policy, not local reason-code lists.
- `eforge/extensions/eforge-plan/projections/board.ts` — ensure lane counts/page entries use compact items whose lifecycle and `planEligible` came from the shared backend helper.
- `eforge/extensions/eforge-plan/projections/recommendations.ts` — build recommendation actionability from the shared plan-eligibility projection so terminal abandoned/deleted plan evidence is actionable and current blockers are suppressed/de-actioned.
- `eforge/extensions/eforge-plan/recommendation-actionability.ts` — route SQL-backed actionability and selection validation through the shared backend plan-eligibility helper; keep legacy fallback only when no projection store exists.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — replace the duplicate-only start guard with the shared plan-eligibility guard for selected backlog items.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — use the same guard for apply-time handoff/creation-draft target validation; persist readiness after creation drafts and section patch applies.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — pass readiness summaries into canonical sync after `create-session-plan`, `select-session-plan-dimensions`, `set-session-plan-section`, `skip-dimension`, `set-session-plan-ready`, `delete-session-plan`, and metadata updates.
- `eforge/extensions/eforge-plan/projections/session-plans.ts` — add Markdown-readiness recomputation/cache-freshness helpers; return readiness plus `readinessSource`/freshness metadata from `show-session-plan` and `list-planning-artifacts` plan artifacts.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — extend compact item schemas with backend `planEligible` and eligibility metadata fields.
- `eforge/extensions/eforge-plan/search/schemas.ts` — keep search compact item schema in sync with compact board fields.
- `eforge/extensions/eforge-plan/projections/types.ts` — add typed `planEligible` and eligibility/readiness projection fields.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts` — add active/abandoned/deleted/superseded/completed session-plan coverage cases and stale lifecycle evidence cases.
- `eforge/extensions/eforge-plan/__tests__/sqlite-projections-lifecycle.test.ts` — add projection cases for stale current planned evidence, user-status-only fallback, terminal result blockers, and planEligible output.
- `eforge/extensions/eforge-plan/__tests__/sqlite-board-projections.test.ts` — assert compact board items expose `planEligible` and abandoned/deleted historical plan coverage returns candidate items to an eligible open state.
- `eforge/extensions/eforge-plan/__tests__/sqlite-recommendation-actionability.test.ts` — assert recommendations suppress live coverage, de-action current result blockers, and allow abandoned/deleted historical plan evidence.
- `eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts` — add a SQL-vs-legacy trace disagreement case proving SQL live coverage wins.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — add start guard rejection/allowance cases for live coverage versus abandoned/deleted historical plan evidence.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — assert creation draft apply and abandoned replacement persist SQL readiness matching adapter-parsed Markdown readiness.
- `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` — assert readiness cache and projection output after create/select/set-section/skip-dimension/ready/delete/metadata flows.
- `eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts` — add cache-missing/cache-stale readiness recomputation and readiness source/freshness assertions.
- `eforge/extensions/eforge-plan/README.md` — document `planEligible` and readiness source/freshness fields in compact board, get-item, show-session-plan, and planning artifact projections.

## Verification

- [ ] `syncSessionPlanArtifact` with `status: "ready"` yields live `planned-session-plan` coverage for source items.
- [ ] `syncSessionPlanArtifact` with `status: "abandoned"`, `"deleted"`, `"superseded"`, or `"completed"` yields no live `planned-session-plan` coverage for source items.
- [ ] Current `lifecycle_evidence` rows for `planned-session-plan` tied to terminal session plans do not change `planEligible` to `false`.
- [ ] Items whose only signal is `user_status: planned` or `user_status: active` keep `planEligible: true` when no live coverage/result blocker/dependency blocker exists.
- [ ] Current failed, partial, shipped, and merged result evidence yields `planEligible: false` with the matching reason code.
- [ ] Non-eligible live blockers for active editable/submitted plans, active tasks, queued/running builds, active build sessions, open PRs, and current failed/partial/shipped/merged results include explanatory reason/link metadata in compact item, item detail, and recommendation projections.
- [ ] `create-session-plan`, `select-session-plan-dimensions`, `set-session-plan-section`, `skip-dimension`, `set-session-plan-ready`, metadata update, creation-draft apply, and abandoned-plan replacement persist `session_plans.readiness_summary_json` matching adapter-parsed Markdown readiness.
- [ ] `show-session-plan` and `list-planning-artifacts` return Markdown-derived readiness with a non-cache source indicator when `readiness_summary_json` is absent or stale.
- [ ] Recommendation actionability returns actionable entries for abandoned/deleted historical plan evidence and non-actionable entries for active session plans, active tasks, queued/running builds, active build sessions, open PRs, failed/partial results, shipped results, and merged results.
- [ ] Starting a planning task succeeds for an item whose only plan evidence is abandoned/deleted historical evidence and rejects an item with live coverage or current result blocker.
- [ ] The real workflow regression captures an item, starts and applies a creation draft, verifies SQL, `show-session-plan`, and `list-planning-artifacts` readiness matches the apply response and Markdown readiness, abandons/deletes the plan, verifies board/get-item/recommendations mark the item eligible/actionable, and starts a new planning task.
