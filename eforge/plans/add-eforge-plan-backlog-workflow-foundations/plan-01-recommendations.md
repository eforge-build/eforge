---
id: plan-01-recommendations
name: Recommendation Store and Board Projection
branch: add-eforge-plan-backlog-workflow-foundations/plan-01-recommendations
---

# Recommendation Store and Board Projection

## Architecture Context

`eforge-plan` is a project-team extension. Recommendation data is private extension metadata, not a public `.backlog` contract and not an engine-owned queue or daemon route. This plan adds the storage/model layer and read/write actions first so later promotion and planner orchestration can resolve recommendation references through typed extension APIs.

Use `ctx.paths.extensionStoragePath('project-local', ['recommendations', 'current.json'])` from action handlers, and use `createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' })` only in module-level helpers and tests that do not have an action context.

## Implementation

### Overview

Add a typed recommendation model, a focused private store module, typed read/write actions, and board projections that include recommendation summaries when private storage exists.

### Key Decisions

1. The canonical recommendation file is `.eforge/storage/extensions/eforge-plan/recommendations/current.json`; no code reads or writes `.backlog/recommendations.json`.
2. The public contract is extension actions and JSON-safe board output, not the raw JSON file.
3. `list-board` gains an optional `recommendationSummary` field so existing callers that ignore unknown data keep working.
4. `render-board-markdown` renders a recommendation section only when the private recommendation file exists.

## Scope

### In Scope

- Add TypeBox schemas and TypeScript types for recommendation records in `schema.ts`.
- Create private recommendation persistence helpers.
- Add `get-recommendations` and `put-recommendations` extension actions.
- Include recommendation summary data in board JSON and board Markdown when storage exists.
- Add tests for storage paths, validation rejection, action registration, board JSON, and board Markdown.

### Out of Scope

- `.backlog/recommendations.json` import, export, migration, or compatibility reads.
- Multi-source promotion, epic promotion, recommendation-reference handoff, or planner packet actions.
- Engine, daemon route, queue schema, or client route changes.
- Core Console Plans UI changes.

## Files

### Create

- `eforge/extensions/eforge-plan/recommendations-store.ts` — Resolve the private path, validate recommendation payloads, read/write `current.json`, create an empty/default model, and project JSON-safe summaries for boards.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — Define `get-recommendations` and `put-recommendations` actions with local-read/local-write side effects.
- `eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts` — Cover private path resolution, valid writes, missing storage reads, malformed-payload rejection, and absence of `.backlog/recommendations.json` behavior.

### Modify

- `eforge/extensions/eforge-plan/schema.ts` — Add schemas/types for `BacklogRecommendationModel`, item refs, group refs, blocked chains, rationale entries, `RecommendationSummary`, get/put action inputs, and get/put action outputs. Add `recommendationSummary` as an optional field on `ListBoardOutputSchema`.
- `eforge/extensions/eforge-plan/board-actions.ts` — Load the recommendation store in `buildBoard`, include a summary in `projectBoardOutput`, and render a `## Recommended Next Work` Markdown section when recommendations exist.
- `eforge/extensions/eforge-plan/index.ts` — Register the new recommendation actions without changing existing action IDs.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — Add the two actions to the expected registration list, read/write side-effect sets, and `list-board` output schema keys.
- `eforge/extensions/eforge-plan/__tests__/kanban.test.ts` or a new board-focused test file — Assert board JSON/Markdown recommendation projections with seeded private storage.

## Recommendation Model Shape

Implement schema version `1` with these top-level fields:

- `schemaVersion: 1`
- `updatedAt?: string`
- `activeWork: RecommendationItemRef[]`
- `readyCandidates: RecommendationItemRef[]`
- `recommendedNextSequence: RecommendationItemRef[]`
- `safeParallelizableGroups: RecommendationGroup[]`
- `blockedChains: RecommendationBlockedChain[]`
- `rationaleAndAssumptions: string[]`

Use these nested records:

- `RecommendationItemRef`: `{ ref?: string, itemId: string, rationale?: string, confidence?: string }`
- `RecommendationGroup`: `{ ref: string, title?: string, itemIds: string[], epicIds?: string[], safeToPlanTogether?: boolean, rationale?: string, recommendedProfile?: 'errand' | 'excursion' | 'expedition' }`
- `RecommendationBlockedChain`: `{ ref?: string, itemIds: string[], blockedBy: string[], rationale?: string }`

`RecommendationSummary` must include JSON-safe fields that the workstation can render without reading the raw file, including `recommendedNextItemIds`, `safeParallelizableGroups`, `blockedChainCount`, and `rationaleAndAssumptions`.

## Verification

- [ ] `resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }))` returns a path ending in `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- [ ] A valid `put-recommendations` action invocation writes `current.json` under `.eforge/storage/extensions/eforge-plan/recommendations/`.
- [ ] A malformed recommendation payload returns `invalid-input` or throws a validation error before `current.json` is created.
- [ ] No implementation path reads from or writes to `.backlog/recommendations.json`.
- [ ] `list-board` output contains `recommendationSummary.recommendedNextItemIds` when private recommendation storage exists.
- [ ] `render-board-markdown` output contains `## Recommended Next Work` and the recommended item IDs when private recommendation storage exists.
- [ ] Existing `list-board` output still contains `epics`, `items`, `lanes`, `blockedReasons`, and `traceSummaries`.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
