---
id: plan-01-recommendation-freshness-state
name: Recommendation Freshness State and Workstation Surfacing
branch: lifecycle-driven-recommendation-refresh-for-eforge-plan/plan-01-recommendation-freshness-state
---

# Recommendation Freshness State and Workstation Surfacing

## Architecture Context

`eforge-plan` already has most of the recommendation-refresh foundation in place: private recommendation storage at `.eforge/storage/extensions/eforge-plan/recommendations/current.json`, a `status.json` sidecar, lifecycle trace correlation, a `refresh-recommendations` daemon-task wrapper, and a workstation recommendations panel. The remaining source-document gaps are in the freshness contract: lifecycle stale reasons are not structured enough, stale reason history is unbounded, board/markdown outputs do not expose freshness, and the workstation/docs/tests need to reflect the richer state.

Lifecycle hooks remain invalidators only. They must not start daemon-owned agent tasks. Recommendation refresh execution stays behind generic extension action invocation (`refresh-recommendations` / planning-agent task actions), not Pi- or Claude-specific commands.

## Implementation

### Overview

Evolve the existing recommendation status sidecar and outputs into a bounded, JSON-safe freshness model. Correlated lifecycle evidence changes mark recommendations stale with event type, item ids, correlation kind, timestamp, and bounded summary metadata. Successful recommendation writes mark the state fresh only after the validated model has been written. Board actions, markdown rendering, and the workstation surface the freshness state and refresh affordance through extension actions.

### Key Decisions

1. Keep the existing `recommendations/status.json` sidecar path for compatibility, but extend its schema and output projection with explicit freshness fields (`freshAt`, `staleSince`, `lastRefreshedBy`, structured `reasons`). Retain existing `state` and `staleReasons` output fields as compatibility aliases for current consumers.
2. Bound persisted stale reason history to a fixed latest-entry window (use 20 entries unless implementation finds an existing project constant). Deduplicate exact repeated reasons before trimming.
3. Treat lifecycle hooks as non-blocking observers: they write extension-owned freshness metadata after correlated trace/status mutation, and never call `ctx.agentTasks` or host-specific planning commands.
4. Preserve mutation ordering: validate recommendation payloads and references first, write `current.json` second, then mark freshness fresh. Failed validation or write errors leave the status sidecar unchanged.
5. Expose freshness through generic extension outputs: `get-recommendations`, `list-board`, `render-board-markdown`, and the existing workstation bridge.

## Scope

### In Scope

- Extend recommendation freshness/status schemas and sidecar read/write helpers.
- Mark stale from correlated or bootstrapped lifecycle updates with structured lifecycle reason metadata.
- Mark fresh from successful `put-recommendations`, `apply-planner-result`, and `apply-planning-agent-task-result` recommendation writes, with `lastRefreshedBy` set to the relevant mutation path.
- Return freshness state from `get-recommendations` and `list-board` in JSON-safe shapes.
- Render fresh/stale recommendation notes in `render-board-markdown`.
- Update workstation source and generated assets so the recommendations panel displays structured stale reasons and uses the existing generic refresh action.
- Update `eforge/extensions/eforge-plan/README.md` and contract tests.

### Out of Scope

- Removing or changing Pi/Claude hardcoded `/eforge:plan` surfaces.
- Adding automatic AI task starts from lifecycle hooks.
- Engine kernel changes.
- Session-plan/playbook extraction work.
- Epic progress/status rollups or partial-completion semantics beyond the freshness metadata required here.
- Writing any recommendation state to `.backlog/recommendations.json`.

## Files

### Create

- None expected.

### Modify

- `eforge/extensions/eforge-plan/schema.ts` — Add/extend TypeBox schemas for structured freshness reasons/state, `lastRefreshedBy`, and board output freshness projection. Keep the existing recommendation model schema unchanged.
- `eforge/extensions/eforge-plan/recommendation-status-schemas.ts` — Re-export new freshness schemas/types and update `get-recommendations` output schema.
- `eforge/extensions/eforge-plan/recommendation-status.ts` — Evolve sidecar parsing/writing, add bounded reason append/trim helpers, record fresh origins, handle stale sidecar state even when `current.json` is absent, and preserve compatibility output fields.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — Ensure `get-recommendations` returns the enriched status and `put-recommendations` marks fresh only after a successful model write.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — Pass `lastRefreshedBy` values for direct planner application and planning-agent task application; preserve failure-before-write behavior.
- `eforge/extensions/eforge-plan/lifecycle.ts` — Pass effective correlation kind, event timestamp, item ids, and bounded summary refs into stale marking after correlated trace/status updates. Keep uncorrelated and ambiguous events from dirtying freshness.
- `eforge/extensions/eforge-plan/board-actions.ts` — Read derived freshness alongside recommendations, include `recommendationStatus` in `list-board`, and render visible fresh/stale notes in board markdown.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — Update workstation status/reason types for structured freshness fields while preserving legacy fields.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.tsx` — Render structured stale reason metadata and keep the existing `refresh-recommendations` action path.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` — Add mock fresh/stale structured status examples.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/hooks/use-workstation-data.test.tsx` and/or `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.test.tsx` — Update UI expectations for structured freshness state.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` — Regenerate from workstation source with `pnpm build:eforge-plan-workstation`; do not hand-edit generated bundle code.
- `eforge/extensions/eforge-plan/README.md` — Document freshness storage, structured stale marking semantics, bounded history, and the explicit refresh workflow.
- `eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts` — Cover sidecar path, fresh fields, missing-current behavior, source-drift projection, and bounded reason trimming.
- `eforge/extensions/eforge-plan/__tests__/recommendation-invalidation.test.ts` and/or `eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts` — Assert correlated lifecycle events update trace sidecars and record structured stale reasons; assert uncorrelated events preserve status bytes.
- `eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts` — Keep validation/no-legacy-storage assertions and add invalid-write/no-fresh-state coverage if not covered elsewhere.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` and/or `eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts` — Assert apply-result freshening and failed apply no-change behavior.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — Update action output schema expectations and board/markdown freshness assertions.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — Verify generated bundle/source still invoke only bridge actions and expose freshness/refresh UI text.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — Update README contract assertions for structured freshness semantics.

## Detailed Requirements

### Freshness schema and sidecar

- Add a structured reason shape with at least `eventType`, `itemIds`, `correlationKind`, `timestamp`, and `summary` fields. Optional compatibility fields such as `code`, `message`, `refs`, `sourceFingerprint`, and `lastAppliedSourceFingerprint` may remain for drift/backlog mutation reasons.
- Add `freshAt`, `staleSince`, `lastRefreshedBy`, and `reasons` to the persisted sidecar and derived status output.
- Keep `state: 'missing' | 'fresh' | 'stale'`, `currentPath`, `statusPath`, `sourceFingerprint`, `lastAppliedSourceFingerprint`, and `staleReasons` for current consumers.
- When no `current.json` exists and no stale sidecar exists, return `state: 'missing'` without creating files.
- When a correlated lifecycle event happens before `current.json` exists, write the sidecar and let `get-recommendations` expose stale freshness with `recommendations: null`.
- Never read or write `.backlog/recommendations.json`.

### Lifecycle invalidation

- Mark stale only after `applyLifecycleEvent` has item ids from single, multi, or queued-PRD bootstrap correlation.
- Include the event `type` as `eventType`, all affected backlog item ids, the effective correlation kind (`single`, `multi`, or `bootstrapped`), the event timestamp when present, and a bounded summary string with relevant lifecycle identifiers.
- Do not mark stale for `none` correlation without bootstrap or for ambiguous lifecycle events.
- Preserve existing trace sidecar and shipped-status mutation behavior.

### Freshening paths

- `put-recommendations` must write the model and then mark fresh with `lastRefreshedBy: 'put-recommendations'`.
- `apply-planner-result` must write the model and then mark fresh with `lastRefreshedBy: 'apply-planner-result'`.
- `apply-planning-agent-task-result` with `applyRecommendations: true` must write the model and then mark fresh with `lastRefreshedBy: 'apply-planning-agent-task-result'`, preserving recommendation refresh source-fingerprint drift handling.
- Invalid payloads, unknown item/epic references, empty safe-parallelizable groups, or failed writes must leave `current.json` and the status sidecar unchanged.

### Board, markdown, and workstation surfacing

- `list-board` must return `recommendationStatus` alongside existing `recommendationSummary` and `traceSummaries`.
- `render-board-markdown` must include a visible recommendation freshness note when freshness is fresh or stale. Include stale reason summary text when stale reasons exist.
- The workstation must display the enriched stale reason metadata and keep the existing refresh button wired through `refresh-recommendations` / `window.eforge.invokeAction`.
- Regenerate workstation assets after source changes.

## Database Migration

No database migrations.

## Verification

- [ ] Correlated lifecycle event processing updates the relevant trace sidecar and returns `get-recommendations.status.state === 'stale'` with a structured reason containing `eventType`, `itemIds`, `correlationKind`, `timestamp`, and `summary`.
- [ ] Uncorrelated lifecycle event processing leaves the recommendation status sidecar bytes unchanged.
- [ ] Repeated stale marking trims persisted reason history to the configured maximum count.
- [ ] Valid `put-recommendations` writes `current.json`, marks status fresh, and records `lastRefreshedBy: 'put-recommendations'`.
- [ ] Invalid `put-recommendations` leaves `current.json` absent or unchanged and does not mark status fresh.
- [ ] Direct planner recommendation application records `lastRefreshedBy: 'apply-planner-result'` after the model write.
- [ ] Planning-agent recommendation application records `lastRefreshedBy: 'apply-planning-agent-task-result'` after the model write and preserves drift-to-stale behavior for stale refresh fingerprints.
- [ ] `get-recommendations` returns the private model path plus JSON-safe enriched freshness status.
- [ ] `list-board` returns `recommendationStatus`, `recommendationSummary`, and `traceSummaries` in one JSON-safe output.
- [ ] `render-board-markdown` contains a fresh note for fresh status and a stale note for stale status.
- [ ] Workstation source and generated bundle display stale/current freshness state and call `refresh-recommendations` through the bridge, with no `fetch`, queue-route, Pi-specific, or Claude-specific refresh path.
- [ ] `README.md` documents storage, stale marking semantics, bounded reason history, and the explicit refresh workflow.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- eforge-plan` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
