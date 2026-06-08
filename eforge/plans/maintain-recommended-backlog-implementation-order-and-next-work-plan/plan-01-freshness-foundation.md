---
id: plan-01-freshness-foundation
name: Recommendation Freshness Foundation and Apply Validation
branch: maintain-recommended-backlog-implementation-order-and-next-work-plan/plan-01-freshness-foundation
agents:
  builder:
    effort: high
    rationale: Adds new storage semantics, source fingerprinting, reference
      validation, and apply-state transitions across existing strict
      recommendation and planner code.
  reviewer:
    effort: high
    rationale: The plan changes extension action contracts and local-write safety
      around recommendation storage.
---

# Recommendation Freshness Foundation and Apply Validation

## Architecture Context

`eforge-plan` already stores the strict recommendation model at `.eforge/storage/extensions/eforge-plan/recommendations/current.json`. This plan adds the private freshness/status sidecar and apply-time validation foundation without changing daemon routes, build-engine ownership, or the strict `BacklogRecommendationModelSchema` model shape.

The sidecar is extension-owned metadata. `current.json` remains the planner-output model and stays strict/backward-compatible. The legacy `.backlog/recommendations.json` file remains ignored.

## Implementation

### Overview

Add recommendation freshness schemas and helpers, deterministic source fingerprinting, reference validation before writes, planner trace summaries, and apply-state transitions for direct planner result applies.

### Key Decisions

1. Store status metadata at `.eforge/storage/extensions/eforge-plan/recommendations/status.json`; never embed freshness fields in `current.json`.
2. Compute the source fingerprint from independent recommendation inputs: open backlog item/epic projections, dependency/blocker projections, roadmap excerpts, and trace summaries. Include current recommendations in AI context packets for reasoning, but exclude `current.json` from the fingerprint so applying a generated model does not invalidate itself.
3. Treat a missing `current.json` as `state: "missing"`. Treat an existing model with no sidecar or a fingerprint mismatch as `state: "stale"` with machine-readable reasons.
4. Validate all generated recommendation references against current backlog/epic IDs before writing `current.json`; preserve the previous model on validation failure.
5. Keep `schema.ts` under the 600-line maintainability cap by placing new freshness/action schemas in focused recommendation modules. Only add the minimal planner-context field needed for trace summaries to `schema.ts`.

## Scope

### In Scope

- Freshness/status TypeBox schemas and TypeScript types.
- Status sidecar path helpers, normalized read/write, stale/fresh/missing derivation, and applied-refresh transitions.
- Deterministic source projection and SHA-256 fingerprint helpers.
- Reference validation for recommendation item refs, parallel groups, epic refs, blocked-chain item refs, and blocker refs.
- Planner context trace summaries.
- Direct `get-recommendations`, `put-recommendations`, and `apply-planner-result` status behavior.
- Backend tests for storage, missing status, fingerprint drift, trace summaries, and reference validation.

### Out of Scope

- Starting daemon recommendation refresh tasks.
- Lifecycle stale invalidation.
- Workstation rendering.
- Queue orchestration, enqueueing, plan-set creation, or build dependencies.
- `.backlog/recommendations.json` import/export.

## Files

### Create

- `eforge/extensions/eforge-plan/recommendation-status-schemas.ts` — TypeBox schemas/types for freshness sidecar data, stale reasons, derived status output, and get-recommendations-with-status output.
- `eforge/extensions/eforge-plan/recommendation-status.ts` — status path resolution, sidecar normalization, canonical JSON hashing, source projection/fingerprint helpers, derived status reads, stale/applied transitions, and recommendation reference validation.
- `eforge/extensions/eforge-plan/planner-source-bounds.ts` — shared bounded source-text serializer extracted from `agent-task-actions.ts` so later refresh tasks reuse the same caps.
- `eforge/extensions/eforge-plan/__tests__/recommendation-status.test.ts` — freshness sidecar path, missing/fresh/stale derivation, fingerprint, and legacy-file non-use coverage.
- `eforge/extensions/eforge-plan/__tests__/recommendation-apply-validation.test.ts` — generated model reference validation and apply-state transition coverage.

### Modify

- `eforge/extensions/eforge-plan/recommendations-store.ts` — keep `current.json` strict, expose schema-only parsing separately from cwd-aware validated writes, and preserve existing summaries.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — return derived recommendation status from `get-recommendations`; make `put-recommendations` validate refs and update freshness metadata after a valid write.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` — include trace summaries in planner context; validate recommendation refs before applying; update freshness metadata when `applyPlannerResult` writes recommendations.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — import the shared source-text bounding helper with no behavioral change for existing planning tasks.
- `eforge/extensions/eforge-plan/schema.ts` — add `traceSummaries: Type.Array(Type.Unknown())` to `PreparePlannerContextOutputSchema` while keeping the file at or below 600 lines.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — assert trace summaries are present and direct apply updates freshness.
- `eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts` — seed referenced backlog IDs where needed and assert missing `get-recommendations` returns status without writing `.backlog/recommendations.json`.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update output-schema assertions for the extended `get-recommendations` contract.

## Verification

- [ ] `eforge-plan:get-recommendations` with no `current.json` returns `recommendations: null`, `status.state: "missing"`, the private `current.json` path, and the sidecar status path.
- [ ] `eforge-plan:get-recommendations` with no `current.json` does not create `.backlog/recommendations.json`.
- [ ] A valid recommendation model with known item and epic IDs writes `current.json` and records a last-applied source fingerprint in the sidecar.
- [ ] Unknown `activeWork`, `readyCandidates`, `recommendedNextSequence`, group `itemIds`, group `epicIds`, blocked-chain `itemIds`, and blocked-chain `blockedBy` refs reject before `current.json` changes.
- [ ] Empty `safeParallelizableGroups[].itemIds` still rejects before `current.json` changes.
- [ ] `applyPlannerResult` with recommendations clears stale reasons when the current source fingerprint matches the applied fingerprint.
- [ ] `applyPlannerResult` after source drift writes the valid model and returns/records a stale reason naming the drift.
- [ ] `preparePlannerContext` includes compact trace summaries derived from trace sidecars.
- [ ] Existing planning-agent task source text stays within the configured 60,000-character cap after moving the bounder.
- [ ] `pnpm maintainability:check` exits 0 with `schema.ts` at or below 600 lines.