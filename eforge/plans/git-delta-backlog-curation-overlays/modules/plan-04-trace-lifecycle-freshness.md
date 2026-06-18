# Trace Lifecycle Freshness

## Architecture Reference

This module implements the **Recommendation freshness projection** and **Recommendation freshness and trace classification** sections from the architecture. It also implements the **Historical traces by default** principle for curation and board projections.

Key constraints from architecture:
- Trace rows remain audit evidence; activity is derived from current editable plan evidence, live queue/run/build evidence, current PR/landing evidence, or explicit backlog status.
- A submitted session-plan trace without a current editable plan or live queue/run/build/PR signal does not mark an item active or planned.
- Recommendation freshness is derived by comparing stored source fingerprints with a caller-provided current or prospective source fingerprint; sidecar state is not trusted as fresh by itself.
- This module exposes freshness and trace helpers for later overlay/UI modules without changing curation apply semantics, git-delta baseline storage, evidence classification, or workstation rendering.
- All writes remain private extension storage scoped; this module does not write `.backlog/recommendations.json`.

## Scope

### In Scope
- Add a context-aware trace activity projection that treats session-plan trace rows as active only when there is current editable plan evidence.
- Refine lifecycle state aggregation so historical submitted/completed trace rows do not produce `planned`, `queue`, `build`, or in-progress board state.
- Preserve historical trace rows in `linkRows`, `prRefs`, `landingRefs`, and fingerprint projections.
- Add a pure recommendation freshness view helper that compares stored recommendation metadata against a supplied source fingerprint.
- Add an async freshness view reader for current backlog fingerprints, plus a pure API that plan-03 can call with prospective post-curation fingerprints.
- Route board, compact backlog query, planner context, plan revision, session-plan lifecycle, and curation source trace summaries through the context-aware trace summarizer.
- Add regression tests for stale submitted session-plan traces and freshness view states.

### Out of Scope
- Git-delta baseline sidecar read/write and git history scanning.
- Commit-to-item matching, shipped/superseded evidence classification, and closed-status evidence prefix validation.
- Prospective recommendation overlay filtering/repositioning and curation apply call-site changes.
- Workstation component/type updates and documentation updates.
- Daemon queue/run inspection beyond the trace rows already stored by eforge-plan.

## Implementation Approach

### Overview

Create two focused helper modules and then update the existing projection code to use them:

1. `trace-activity.ts` loads current editable flat session-plan ids through `createSessionPlanningWorkflowAdapter().flat.list({ includeSubmitted: false })` and provides `summarizeProjectTraces(cwd, traces?)`.
2. `lifecycle-projection.ts` owns reusable activity predicates and lifecycle state aggregation. Session-plan rows are historical unless the activity context includes the session id and the row status is not terminal/submitted/abandoned.
3. `trace-store.ts` keeps raw trace storage behavior unchanged, but `summarizeTrace(trace, context)` uses the new activity predicates for active booleans/reasons.
4. Existing action/source call sites switch from `traces.flatMap((trace) => summarizeTrace(trace) ?? [])` to `summarizeProjectTraces(cwd, traces)` so production projections can see live editable plan evidence.
5. `recommendation-freshness.ts` exposes a pure `deriveRecommendationFreshnessView()` helper. `recommendation-status.ts` calls the same helper for a current-fingerprint reader and keeps the existing `RecommendationDerivedStatus` wire shape intact.

Historical trace rows stay in `linkRows`; only the active booleans, active reasons, lifecycle state, board lane derivation, and recommendation source fingerprints change.

### Key Decisions

1. **Current editable plans are the only session-plan activity source.** A trace sidecar row for `session-plan` is durable history. It becomes active only when the current flat session-plan list contains that session and the row status is not `submitted`, `abandoned`, or terminal.
2. **Plan-list failures are conservative.** If current session plans cannot be listed, `trace-activity.ts` returns an empty editable-session set. This avoids turning stale trace rows into active work.
3. **Queue/build activity remains trace-status based.** Queue and build rows are active when they have no `completedAt` and their status is not terminal (`completed`, `cancelled`, `failed`, `skipped`, `stale`, etc.). Completed queue/build rows remain visible history but do not produce `queue` or `build` lifecycle state.
4. **PR/landing state is explicit.** `pr-open` rows can produce active/in-progress evidence; `merged`, `landed`, `auto-merged`, and `shipped` remain terminal lifecycle evidence.
5. **Freshness comparison is pure.** `deriveRecommendationFreshnessView()` receives stored metadata plus `comparedSourceFingerprint`. Preview can pass a prospective fingerprint without writing status sidecars; current reads can pass `computeRecommendationSourceFingerprint(cwd)`.
6. **Existing response compatibility is retained.** `get-recommendations`, `list-board`, and apply outputs keep returning the existing `RecommendationDerivedStatus` shape. Later modules can add server payload fields using the exported freshness view schema/helper.

### Shared-file coordination notes

`backlog-curation-source.ts` is listed in the architecture registry for plan-01 and plan-02 only. This module needs a narrow, non-overlapping edit in the existing `readRawTraceSummaries()` path so curation uses the context-aware trace summarizer. Proposed registry addition:

- `plan-04-trace-lifecycle-freshness`: imports `summarizeProjectTraces` and replaces only the trace summary call inside `readRawTraceSummaries()`; no edits to git-delta source insertion, shipped evidence collection, ranking, caps, or fingerprint blocks.

Code examples that require build-coordination markers must use the compiled slug:

```ts
// --- eforge:region plan-04-trace-lifecycle-freshness ---
export interface TraceActivityContext {
  liveEditableSessionIds?: ReadonlySet<string>;
}
// --- eforge:endregion plan-04-trace-lifecycle-freshness ---
```

## Files

### Create
- `eforge/extensions/eforge-plan/trace-activity.ts` — load live editable session-plan ids and export `summarizeProjectTraces(cwd, traces?)` for action/source call sites.
- `eforge/extensions/eforge-plan/recommendation-freshness.ts` — pure `RecommendationFreshnessView` derivation from stored recommendation metadata and a caller-supplied compared fingerprint.
- `eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts` — regression coverage for submitted/historical session-plan traces, live editable plan evidence, queue/build/PR activity, and board/planner projections.
- `eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts` — pure and current-reader coverage for missing/fresh/stale freshness states.

### Modify
- `eforge/extensions/eforge-plan/lifecycle-projection.ts` — add `TraceActivityContext`, shared row activity predicates, and lifecycle aggregation that ignores historical session/queue/build rows for active states. `[region: plan-04-trace-lifecycle-freshness, projectTraceLifecycle/stateFromRows activity predicates and aggregation]`
- `eforge/extensions/eforge-plan/trace-store.ts` — extend `summarizeTrace(trace, context?)`, keep historical rows, and derive active booleans/reasons from the shared predicates. `[region: plan-04-trace-lifecycle-freshness, summary-helpers and active-entry helpers]`
- `eforge/extensions/eforge-plan/recommendation-status.ts` — call context-aware trace summaries for source fingerprints and planner trace summaries; export `readRecommendationFreshnessView(cwd, comparedSourceFingerprint?)`; reuse the pure freshness helper for drift reasoning. `[region: plan-04-trace-lifecycle-freshness, trace summary source-fingerprint calls and freshness derivation helpers]`
- `eforge/extensions/eforge-plan/recommendation-status-schemas.ts` — add `RecommendationFreshnessViewSchema` and exported type for downstream preview/UI schema work.
- `eforge/extensions/eforge-plan/board-actions.ts` — use `summarizeProjectTraces()` in `buildBoard()` so board lanes do not treat stale submitted plan traces as active.
- `eforge/extensions/eforge-plan/backlog-query-actions.ts` — use `summarizeProjectTraces()` in compact board/detail projections.
- `eforge/extensions/eforge-plan/session-plan-actions.ts` — use `summarizeProjectTraces()` when building plan lifecycle projections.
- `eforge/extensions/eforge-plan/plan-revision-orchestration.ts` — use `summarizeProjectTraces()` for revision target lifecycle context.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — replace the trace-summary call in `readRawTraceSummaries()` only. `[region: plan-04-trace-lifecycle-freshness, proposed registry addition: readRawTraceSummaries trace summary call]`
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — adjust the existing trace-summary expectation to either create a live editable plan before expecting a session-plan active reason or assert only the active build-run reason.
- `eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts` — update/extend source fingerprint tests so trace summaries are context-aware and submitted-only traces do not affect active state.
- `eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts` — add focused lifecycle projection assertions for submitted/completed historical rows versus active queue/build/PR rows.

## Detailed Implementation Steps

### Trace activity context

Implement `trace-activity.ts` with these exports:

```ts
export async function loadTraceActivityContext(cwd: string): Promise<TraceActivityContext>;
export async function summarizeProjectTraces(cwd: string, traces?: readonly TraceSidecar[]): Promise<TraceSummary[]>;
```

Behavior:
- `loadTraceActivityContext()` calls `createSessionPlanningWorkflowAdapter().flat.list({ cwd, includeSubmitted: false })`.
- Only plan entries with a non-empty `session` and status other than `submitted`/`abandoned` enter `liveEditableSessionIds`.
- Adapter/list errors return `{ liveEditableSessionIds: new Set() }`.
- `summarizeProjectTraces()` loads traces when `traces` is omitted, creates one context, maps every trace through `summarizeTrace(trace, context)`, and sorts by `itemId` for deterministic output.

### Lifecycle predicates

Add central predicates in `lifecycle-projection.ts`:

```ts
// --- eforge:region plan-04-trace-lifecycle-freshness ---
export function isActiveSessionPlanTraceEntry(
  entry: { session?: string; status?: string },
  context?: TraceActivityContext,
): boolean;

export function isActiveQueueOrBuildTraceEntry(entry: { status?: string; completedAt?: string }): boolean;
export function isActiveLandingTraceEntry(entry: { status?: string; prUrl?: string }): boolean;
// --- eforge:endregion plan-04-trace-lifecycle-freshness ---
```

Required status handling:
- Session-plan inactive statuses: `submitted`, `abandoned`, `completed`, `cancelled`, `canceled`, `failed`, `landed`, `shipped`, `skipped`, `superseded`, `stale`, `merged`, `auto-merged`.
- Queue/build inactive statuses: the same terminal set plus any row with `completedAt`.
- Landing active statuses: `pr-open`, `started`, `running`.
- Terminal lifecycle statuses continue to win in this order: shipped/landed/auto-merged, merged, pr-open, failed.
- Nonterminal `build`, `queue`, and `planned` lifecycle states are emitted only from active rows according to the predicates.

### Trace summary projection

Update `summarizeTrace()`:
- Add optional `TraceActivityContext` parameter.
- `hasActiveSessionPlan` uses `isActiveSessionPlanTraceEntry(entry, context)`.
- `hasActiveQueuePrd`, `hasActiveBuildRun`, and `hasActiveBuildSession` use the queue/build predicate.
- `hasActiveTrace` includes active session, queue, build, build-session, and active landing/PR evidence.
- `activeReasons` uses compact stable text, for example:
  - `active session-plan trace <session>`
  - `active queue trace <prdId>`
  - `active build run trace <runId>`
  - `active build session trace <sessionId>`
  - `active PR trace <prUrl-or-branch>`
  - `active landing trace <featureBranch-or-commitSha>`
- `projectTraceLifecycle(trace, context)` receives the same context.

### Call-site updates

Replace direct `summarizeTrace()` loops in these paths:
- `buildBoard()` in `board-actions.ts`
- `loadBoardCards()` in `backlog-query-actions.ts`
- `buildRecommendationSourceProjection()` and `readPlannerTraceSummaries()` in `recommendation-status.ts`
- `readRawTraceSummaries()` in `backlog-curation-source.ts`
- `buildLifecycleForPlan()` in `session-plan-actions.ts`
- `buildLifecycleForPlan()` in `plan-revision-orchestration.ts`

The call-site pattern is:

```ts
const traceSummaries = await summarizeProjectTraces(cwd, traces);
```

When callers need item filtering, filter after summary creation so the same activity context is reused for all traces.

### Recommendation freshness view

Implement `recommendation-freshness.ts` around these types:

```ts
export interface StoredRecommendationFreshnessStatus {
  currentExists: boolean;
  sidecar: RecommendationStatusSidecar | null;
  invalidReason?: RecommendationStaleReason;
}

export interface RecommendationFreshnessView {
  state: 'missing' | 'fresh' | 'stale';
  reason: string;
  storedSourceFingerprint?: string;
  comparedSourceFingerprint: string;
  baselineTaskId?: string;
}

export function deriveRecommendationFreshnessView(input: {
  storedStatus: StoredRecommendationFreshnessStatus;
  comparedSourceFingerprint: string;
  baselineTaskId?: string;
}): RecommendationFreshnessView;
```

Derivation rules:
- `missing` when no current recommendation model exists and no sidecar exists.
- `stale` when the sidecar is invalid, lacks `lastAppliedSourceFingerprint`, has persisted stale reasons, has no current model while a sidecar exists, or the stored fingerprint differs from `comparedSourceFingerprint`.
- `fresh` only when a current model exists, sidecar metadata is valid, there are no stale reasons, and `lastAppliedSourceFingerprint === comparedSourceFingerprint`.
- The first stale reason uses `summary`, then `message`, then a deterministic fallback string.
- `storedSourceFingerprint` is the sidecar `lastAppliedSourceFingerprint` when present.

Update `recommendation-status.ts`:
- Add `readRecommendationFreshnessView(cwd, comparedSourceFingerprint = await computeRecommendationSourceFingerprint(cwd))`.
- Reuse the pure helper for drift reason construction in `readDerivedRecommendationStatus()` without changing the existing output shape.
- Keep `markRecommendationsStale*()` and `recordPlannerRecommendationApplied*()` write behavior unchanged.

## Testing Strategy

### Unit Tests
- `deriveRecommendationFreshnessView()` returns `missing` for `{ currentExists: false, sidecar: null }`.
- `deriveRecommendationFreshnessView()` returns `fresh` when `currentExists` is true, the sidecar has no stale reasons, and fingerprints match.
- `deriveRecommendationFreshnessView()` returns `stale` when compared and stored fingerprints differ.
- `deriveRecommendationFreshnessView()` returns `stale` when persisted stale reasons exist even if fingerprints match.
- `deriveRecommendationFreshnessView()` returns `stale` for invalid/missing sidecar freshness metadata.
- Trace predicates classify `submitted` and `abandoned` session-plan rows as inactive even when the session id appears in `liveEditableSessionIds`.
- Trace predicates classify `ready`/`planning` session-plan rows as active only when the session id appears in `liveEditableSessionIds`.
- Queue/build predicates classify `running` rows as active and `completed` rows as inactive.
- Landing predicates classify `pr-open` and `started` rows as active, and `landed`/`auto-merged` rows as terminal.

### Integration Tests
- `summarizeProjectTraces()` with a submitted-only trace returns `hasActiveSessionPlan: false`, `hasActiveTrace: false`, `activeReasons: []`, and `lifecycleState: "none"`.
- `list-board` places a candidate item with only a submitted session-plan trace outside `in-progress`.
- `list-board-compact` returns the same lane for the same submitted-only trace case as `list-board`.
- `preparePlannerContext()` excludes active session-plan reasons for a stale submitted trace while preserving historical `linkRows`.
- `buildBacklogCurationSource()` includes the submitted session-plan row in `traceSummaries.linkRows` but does not set active trace fields from that row.
- A submitted session-plan trace plus a running queue row marks active due to the queue reason only.
- A submitted session-plan trace plus a running build row marks active due to the build reason only.
- A submitted session-plan trace plus `pr-open` landing evidence marks active due to the PR reason only.
- `readRecommendationFreshnessView(cwd, prospectiveFingerprint)` returns `stale` for a stored model written with a different fingerprint and does not rewrite `current.json` or `status.json`.

## Verification

- [ ] `summarizeTrace(submittedTrace, emptyContext)` returns `hasActiveSessionPlan === false`.
- [ ] `summarizeTrace(submittedTrace, emptyContext)` returns `hasActiveTrace === false` when no queue/build/PR rows exist.
- [ ] `summarizeTrace(submittedTrace, emptyContext)` returns `lifecycleState === "none"` when no terminal or live rows exist.
- [ ] `summarizeTrace(readyTrace, { liveEditableSessionIds: new Set([session]) })` returns an active session-plan reason for that session.
- [ ] `projectKanbanBoard()` keeps a candidate item with only submitted trace evidence out of the `in-progress` lane.
- [ ] `preparePlannerContext()` omits `active session-plan trace` from a submitted-only trace summary.
- [ ] `buildBacklogCurationSource()` preserves submitted trace rows in `traceSummaries` and reports no active trace fields for submitted-only evidence.
- [ ] `deriveRecommendationFreshnessView()` returns all three states: `missing`, `fresh`, and `stale` in dedicated tests.
- [ ] `readRecommendationFreshnessView()` compares against an explicit prospective fingerprint without writing recommendation files.
- [ ] Targeted Vitest suites for trace lifecycle and recommendation freshness exit 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

Suggested targeted commands:

```bash
pnpm test -- eforge/extensions/eforge-plan/__tests__/trace-lifecycle-freshness.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-freshness-view.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts
pnpm type-check
pnpm maintainability:check
```

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
