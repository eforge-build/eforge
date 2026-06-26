---
id: plan-01-plan-artifact-lifecycle-projection
name: Plan Artifact Lifecycle Projection and Handoff State
branch: eforge-plan-workstation-ux-polish/plan-01-plan-artifact-lifecycle-projection
agents:
  builder:
    effort: medium
    rationale: Backend projection and canonical-state updates are focused but affect
      shared API output consumed by the workstation.
---

# Plan Artifact Lifecycle Projection and Handoff State

## Architecture Context

The eforge-plan extension owns session-plan artifact projections, canonical SQLite rows, and the workstation actions that read them. The workstation must not parse artifact files to derive lifecycle timestamps, so list/detail timestamp data belongs in `list-planning-artifacts` and `show-session-plan` projections. Handoff remains an explicit action backed by the existing daemon build queue; this plan only records the successful submission state in the existing canonical store and projection layer.

## Implementation

### Overview

Expose normalized session-plan lifecycle timestamps from the projection/API layer and mark successfully handed-off session plans as submitted in canonical SQLite so active artifact lists stop showing stale ready plans after reconciliation.

### Key Decisions

1. Use existing canonical rows and lifecycle links instead of adding a database migration. `session_plans.created_at`, `updated_at`, `submitted_at`, source frontmatter metadata, and build/queue lifecycle link timestamps cover the available fields.
2. Keep the Markdown artifact status unchanged during handoff. The canonical projection records `submitted` state and hides it from active lists without rewriting the user-facing plan file.
3. Preserve backend validation and queue semantics. `handoff-session-plan` still rejects not-ready plans and reports enqueue failures without recording submitted state.

## Scope

### In Scope

- Project `createdAt`, `updatedAt`, `readyAt`, `submittedAt`, and `lastBuildActivityAt` from `list-planning-artifacts` for flat session plans when source data exists.
- Project the same timestamp fields from `show-session-plan`, including the code path that loads the Markdown body through the input adapter.
- Derive `lastBuildActivityAt` from queue/build/session/PR/landing lifecycle link rows rather than frontend parsing.
- Record successful handoff submissions in canonical `session_plans` as `status: submitted`, `submitted_at`, and `updated_at` while retaining queue PRD and submitted lifecycle evidence.
- Return submission metadata from `handoff-session-plan` for callers that want immediate feedback.
- Add projection and handoff regression tests for present and missing timestamp data.

### Out of Scope

- Database schema migrations.
- Daemon queue orchestration changes.
- Build-engine scheduling changes.
- Frontend rendering changes; those are handled by plan 02.

## Files

### Create

- None.

### Modify

- `eforge/extensions/eforge-plan/projections/session-plans.ts` — add small timestamp-normalization helpers; include lifecycle timestamp fields on list artifacts, SQL-backed detail plans, and top-level detail output as useful for consumers.
- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts` — update `recordSessionPlanSubmitted` to persist canonical submitted state on the session-plan row while preserving existing topic/path/frontmatter/readiness fields.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — compute one submission timestamp for handoff success, pass it into `recordSessionPlanSubmitted`, and include it in the successful action response.
- `eforge/extensions/eforge-plan/__tests__/sqlite-session-plan-projections.test.ts` — cover present timestamp projection values, missing timestamp projection values, and `lastBuildActivityAt` derivation from lifecycle links.
- `eforge/extensions/eforge-plan/__tests__/sqlite-canonical-session-plan-writes.test.ts` — assert submitted handoff state is written to `session_plans` in addition to queue/evidence rows.
- `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` — assert successful handoff disappears from default active artifact projection after refresh and enqueue failure leaves the plan active.
- `eforge/extensions/eforge-plan/README.md` — sync action/workstation docs to mention submitted canonical handoff state and projected lifecycle timestamps.

## Verification

- [ ] `listPlanningArtifactsProjection` returns present `createdAt`, `updatedAt`, `readyAt`, `submittedAt`, and `lastBuildActivityAt` values from a seeded SQLite project.
- [ ] `showSessionPlanProjection` returns the same present timestamp fields after loading Markdown body content through the adapter path.
- [ ] Projection tests cover missing timestamp source fields without output values equal to the strings `null`, `undefined`, or an invalid date literal.
- [ ] Successful `handoff-session-plan` writes `session_plans.status = 'submitted'`, `submitted_at`, a queue PRD row, and submitted lifecycle evidence.
- [ ] Default `list-planning-artifacts` output excludes the submitted plan after successful handoff reconciliation.
- [ ] Enqueue-failed handoff leaves the canonical session-plan row status as `ready` and keeps the plan visible in default artifact output.
- [ ] Targeted backend tests for session-plan projection and handoff pass.