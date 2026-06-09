---
id: plan-02-lifecycle-projections
name: Lifecycle Projections and Conservative Evidence Semantics
branch: link-eforge-plan-backlog-items-session-plans-queue-runs-and-landed-builds/plan-02-lifecycle-projections
agents:
  builder:
    effort: high
    rationale: This plan introduces shared projection types consumed by board,
      session-plan, recommendation freshness, and lifecycle tests.
  reviewer:
    effort: high
    rationale: Review must check JSON-safe action output shapes, partial-state
      semantics, and conservative status mutation.
---

# Lifecycle Projections and Conservative Evidence Semantics

## Architecture Context

Trace sidecars are the extension-owned correlation store. Consumers must read lifecycle state through extension actions and projections rather than private files. This plan adds projection helpers and action outputs that connect backlog items to session plans, queue PRDs, build runs/sessions, PRs, landing results, last events, and epic progress.

## Implementation

### Overview

Add focused lifecycle projection helpers, enrich trace summaries, attach lifecycle data to kanban cards, expose epic and session-plan lifecycle projections in action outputs, and tighten tests for PR-open, failed/skipped, merge, and partial multi-source behavior.

### Key Decisions

1. Persisted trace sidecars remain additive and readable: new rich data is derived from existing arrays rather than requiring a sidecar version bump.
2. Item status mutation remains conservative: only confirmed merge or auto-merge evidence marks correlated item ids shipped.
3. Plan and epic `partial` states are derived from mixed per-item lifecycle states instead of stored as mutable epic status.
4. Recommendation fingerprints include compact, sorted lifecycle summary fields to avoid private-storage leakage and noisy churn.

## Scope

### In Scope

- Lifecycle stage/link-row projection types and TypeBox schemas.
- Trace summaries with session plan, queue PRD, build run, build session, PR URL, landing status, last-event, affected item id, failure, and stage evidence.
- `list-board` lifecycle projections for linked items and epic progress.
- `list-planning-artifacts` and `show-session-plan` source refs plus lifecycle evidence for linked session plans.
- Partial plan/epic lifecycle projections with per-item evidence rows.
- Lifecycle tests for PR-open, merge, failed, skipped, and partial cases.

### Out of Scope

- Workstation React rendering.
- New daemon HTTP routes, monitor DB fields, or client event variants.
- Automatic recommendation refresh tasks from lifecycle hooks.

## Files

### Create

- `eforge/extensions/eforge-plan/lifecycle-projection.ts` — projection helpers for lifecycle state, link rows, trace summaries, item rows, session-plan lifecycle, and epic progress aggregation.

### Modify

- `eforge/extensions/eforge-plan/backlog-domain.ts` — extend `TraceSummary` and add shared lifecycle/source projection interfaces or type imports.
- `eforge/extensions/eforge-plan/trace-store.ts` — enrich `summarizeTrace` with lifecycle rows, PR/landing refs, failure evidence, and affected item ids while preserving active booleans/reasons.
- `eforge/extensions/eforge-plan/schema.ts` — add JSON-safe TypeBox schemas for lifecycle state, link rows, item lifecycle, plan source refs, PR/landing refs, failure evidence, and epic progress; wire them into board output/card schemas with `additionalProperties: false` for new shapes.
- `eforge/extensions/eforge-plan/kanban.ts` — attach item lifecycle projections to cards and keep active-trace lane behavior compatible.
- `eforge/extensions/eforge-plan/board-actions.ts` — return top-level lifecycle link rows and epic progress in `list-board`, and keep markdown rendering stable.
- `eforge/extensions/eforge-plan/session-plan-view-model.ts` — project source refs and lifecycle evidence for flat session plans and plan list entries when available.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — build lifecycle context for `list-planning-artifacts` and `show-session-plan` using backlog items, epics, traces, and session-plan source metadata.
- `eforge/extensions/eforge-plan/recommendation-status.ts` — include compact lifecycle stage/link indicators in recommendation source fingerprints with deterministic sorting.
- `eforge/extensions/eforge-plan/lifecycle.ts` — add guard tests or small code refinements so failed/skipped/PR-open evidence records traces without closing items, and merge evidence ships only correlated item ids.
- `eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts` — expand apply-level assertions for PR-open, failed/skipped, confirmed merge, and multi-source isolation.
- `eforge/extensions/eforge-plan/__tests__/kanban.test.ts` — assert card lifecycle rows and partial item evidence projections.
- `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` — assert `show-session-plan` and/or `list-planning-artifacts` return source refs and lifecycle evidence.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update schema key expectations and JSON-safe board output assertions for lifecycle links and epic progress.
- `eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts` — assert recommendation freshness remains stale after correlated lifecycle updates and compact fingerprints include lifecycle summary changes.

## Projection Shape Guidance

Use stable JSON field names for new outputs:

- `lifecycleState`: `none | planned | active | queue | build | pr-open | merged | shipped | failed | partial`.
- `linkRows[]`: rows with `kind`, `stage`, `status`, `label`, optional ids/paths (`session`, `prdId`, `runId`, `sessionId`, `featureBranch`, `commitSha`, `prUrl`), `timestamp`, and `affectedItemIds`.
- `prRefs[]`: PR display rows derived from landing results with `prUrl`.
- `landingRefs[]`: landing display rows derived from `landingResults`.
- `failureEvidence[]`: failed/skipped/cancelled queue, run, session, or landing rows.
- `sourceRefs`: session-plan source item ids, epic ids, recommendation ref, and promoted timestamp.
- `itemRows[]`: per-source item lifecycle rows for plan/epic partial states.
- `epicProgress[]`: counts by backlog status and lifecycle state plus per-item rows.

## Verification

- [ ] `list-board` returns lifecycle rows for session plan, queue PRD, build run, build session, PR URL, landing status, and last event evidence.
- [ ] Each lifecycle row includes `affectedItemIds`.
- [ ] `list-board` returns epic progress with counts by backlog status and lifecycle state.
- [ ] `show-session-plan` or `list-planning-artifacts` returns source item ids, source epic ids, recommendation ref, and lifecycle evidence for a linked plan.
- [ ] `landing:complete` with `action: "pr"` records `pr-open` evidence and leaves the item status active.
- [ ] Failed `queue:prd:complete` apply records trace status `failed` and leaves item status active/planned.
- [ ] Skipped `queue:prd:complete` apply records trace status `skipped` and leaves item status active/planned.
- [ ] Confirmed merge with `commitSha` marks only correlated item ids shipped.
- [ ] Mixed shipped and non-shipped source items project `partial` for the linked plan and include per-item rows.
- [ ] Mixed shipped and non-shipped epic items project `partial` for the epic and include per-item rows.
- [ ] Recommendation freshness remains `stale` after correlated lifecycle updates until an apply/refresh path records a fresh fingerprint.
- [ ] All new action outputs contain no `undefined` values after `toJsonSafeObject` projection.
