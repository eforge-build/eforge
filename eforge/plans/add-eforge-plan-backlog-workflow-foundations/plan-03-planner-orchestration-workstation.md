---
id: plan-03-planner-orchestration-workstation
name: Planner Orchestration Actions and Workstation Controls
branch: add-eforge-plan-backlog-workflow-foundations/plan-03-planner-orchestration-workstation
---

# Planner Orchestration Actions and Workstation Controls

## Architecture Context

This plan adds AI-planning orchestration hooks as typed extension actions. It does not introduce a daemon-owned chat runtime, raw extension HTTP routes, private Console imports, or engine-side planning state. The eforge-plan workstation remains the Console-facing surface and invokes extension actions through `window.eforge.invokeAction`.

## Implementation

### Overview

Add planner context/result action contracts, implement JSON-safe planner context packets, apply structured planner results to private recommendations or selection handoff, expose user-visible workstation controls for recommended item/group/epic promotion, and document the new boundaries.

### Key Decisions

1. Planner orchestration is action-first: one action prepares a context packet, another action applies a structured result.
2. Planner packets include backlog items, epics, recommendations, dependency/blocker context, and roadmap evidence as JSON-safe data.
3. Applying a handoff draft uses the same `promote-selection` path from plan-02 rather than writing arbitrary build artifacts directly.
4. Workstation UI changes stay inside `eforge/extensions/eforge-plan/workstation-assets/plans/` and avoid `packages/console-ui/src` imports.

## Scope

### In Scope

- Add `prepare-planner-context` and `apply-planner-result` extension actions.
- Return selected backlog items, related epics, recommendation rationale, dependency/blocker context, and roadmap evidence from planner context packets.
- Apply structured recommendation updates to private recommendation storage.
- Apply structured handoff drafts through the selection promotion helper.
- Add workstation controls for promoting a recommended item, recommended group, epic, and a user-selected one-or-more-item set.
- Update Console contribution/action allow-lists for the new actions.
- Update `README.md` with private recommendation storage, multi-source promotion, planner orchestration boundaries, and non-goals.
- Add tests for planner packets, planner results, registration, workstation action usage, and README text.

### Out of Scope

- General-purpose extension-owned AI chat runtime APIs.
- Daemon-owned chat state, scheduling, auto-mode backlog draining, or queue orchestration.
- Private Console React imports, parent Console plugins, raw extension-owned HTTP routes, or core Console Plans UI changes.
- `.backlog/recommendations.json` import/export.

## Files

### Create

- `eforge/extensions/eforge-plan/planner-orchestration.ts` — Build planner context packets and apply structured planner results using recommendation-store and promotion-selection helpers.
- `eforge/extensions/eforge-plan/planner-actions.ts` — Define `prepare-planner-context` and `apply-planner-result` extension actions.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — Cover context packet fields, roadmap evidence, recommendation result application, and handoff draft application.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — Assert README coverage for private recommendation storage, multi-source promotion, planner orchestration boundaries, and AI chat runtime non-goals.

### Modify

- `eforge/extensions/eforge-plan/schema.ts` — Add planner context input/output schemas, planner result input/output schemas, roadmap evidence schemas, dependency context schemas, and reusable selection schemas where needed.
- `eforge/extensions/eforge-plan/backlog-domain.ts` — Expose any dependency/blocker projection helpers needed by planner context packets if plan-02 kept them internal.
- `eforge/extensions/eforge-plan/index.ts` — Register planner actions, add Console contribution blocks for recommendation/planner workflows, and add workstation `allowedActions` for `get-recommendations`, `put-recommendations`, `promote-selection`, `prepare-planner-context`, and `apply-planner-result`.
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` — Render recommendation summary data, render epics, and wire buttons and item-selection controls that invoke `promote-selection` for recommended item, user-selected item set, recommendation group, and epic handoff.
- `eforge/extensions/eforge-plan/workstation-assets/plans/style.css` — Add styles for recommendation, item-selection, and epic controls if the existing classes do not cover them.
- `eforge/extensions/eforge-plan/README.md` — Document storage, actions, promotion flow, planner orchestration, workstation usage, and non-goals.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — Update action lists, read/write side-effect sets, workstation allowed actions, contribution expectations, integration/deep-link expectations if changed.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — Assert workstation source invokes `promote-selection` through the bridge and retains the no-fetch/no-private-import boundary.

## Planner Action Contracts

### `prepare-planner-context`

Input fields:

- `itemIds?: string[]`
- `epicId?: string`
- `recommendationRef?: string`
- `includeRoadmap?: boolean` defaulting to `true`

When a selector is present, reuse the plan-02 selection resolver. When no selector is present, include open backlog items, all epics, current recommendation data when present, and board dependency/blocker summaries.

Output fields:

- `schemaVersion: 1`
- `selection`: selector metadata and selected IDs
- `items`: JSON-safe selected/open backlog item projections with title, status, epic, tags, dependencies, extracted sections, and source-reference summaries
- `epics`: JSON-safe epic projections
- `recommendations`: current recommendation model or an empty model with `exists: false`
- `recommendationRationale`: `rationaleAndAssumptions` from the current model
- `dependencies`: per-item dependency and blocker context
- `roadmapEvidence`: `{ path: 'docs/roadmap.md', exists: boolean, headings: string[], excerpts: string[] }`

### `apply-planner-result`

Input fields:

- `recommendations?: BacklogRecommendationModel`
- `handoffDraft?: { selection: PromotionSelectionInput, session?: string, title?: string, profile?: PlanningProfile }`

At least one field must be present. If `recommendations` is present, validate and write it through the private store. If `handoffDraft` is present, call the plan-02 promotion helper and return the generated session details. Do not accept raw Markdown or raw filesystem paths from the planner result.

## Workstation Controls

The workstation must expose buttons rendered from action output, not private imports:

- Recommended item: invoke `promote-selection` with `{ recommendationRef: ref, status: 'active' }` when a `recommendedNextSequence` entry supplies `ref`; otherwise invoke `promote-selection` with `{ itemIds: [itemId], status: 'active' }`.
- Selected item set: let users select one or more visible backlog items and invoke `promote-selection` with `{ itemIds: selectedItemIds, status: 'active' }`.
- Recommended group: invoke `promote-selection` with `{ recommendationRef: ref, status: 'active' }`.
- Epic: invoke `promote-selection` with `{ epicId, status: 'active' }`.

After a promotion action resolves, refresh planning artifacts and show the returned session/path in the status text.

## Verification

- [ ] `prepare-planner-context` returns `schemaVersion: 1`, `items`, `epics`, `recommendations`, `recommendationRationale`, `dependencies`, and `roadmapEvidence` for a seeded project.
- [ ] `prepare-planner-context` with `itemIds` returns only the selected item IDs in `selection.itemIds`.
- [ ] `prepare-planner-context` includes `roadmapEvidence.exists: true` and at least one heading when `docs/roadmap.md` exists in the temp project.
- [ ] `apply-planner-result` with a recommendation update writes `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- [ ] `apply-planner-result` with a handoff draft writes one `.eforge/session-plans/<session>.md` file through the promotion-selection helper.
- [ ] The workstation bundle contains `window.eforge.invokeAction` calls for `promote-selection` and contains no `fetch(`, `XMLHttpRequest`, `packages/console-ui/src`, or `@/` imports.
- [ ] The workstation bundle contains a control path that invokes `promote-selection` with a user-selected one-or-more-item ID array.
- [ ] The recommended item control invokes `promote-selection` with `recommendationRef` when a recommended sequence entry supplies `ref` and falls back to `itemIds: [itemId]` when no ref exists.
- [ ] The registered workstation `allowedActions` contains `promote-selection`, `prepare-planner-context`, and `apply-planner-result`.
- [ ] The README contains `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- [ ] The README contains the action IDs `promote-selection`, `prepare-planner-context`, and `apply-planner-result`.
- [ ] The README states that general extension-owned AI chat runtime support is not implemented by this extension.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` exits 0.
