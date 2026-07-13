---
id: console-plan-presentation-and-id-compatibility
name: Console plan presentation and ID compatibility
branch: dry-plan-presentation-metadata-and-overflow-safe-console-pipeline-labels/console-plan-presentation-and-id-compatibility
---

# Console plan presentation and ID compatibility

Reconcile REST and late live metadata; derive plan-only readable labels, deterministic numbering, fallbacks, and ID-aware tooltips; constrain shrink and overflow; preserve special lanes and order. Presentation data never replaces canonical IDs in routes, requests, lookup, selection, review, or dependencies. Reuse client-owned contracts and author focused implementation regressions.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012, ac-020, ac-021
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:general:general, ac-006:general:general, ac-007:general:general, ac-008:general:general, ac-009:general:general, ac-010:general:general, ac-011:general:general, ac-012:interface:api, ac-012:subsystem:api, ac-020:general:general, ac-021:general:general

## Validation

Test late metadata, fallback text, numbering, tooltip, short and pathological overflow inputs, lanes/order, and ID-keyed API/interactions; run Console tests, type-check, and maintainability checks.

## Fragment: Preserve ID-based API compatibility

### ID-based API compatibility

Preserve canonical IDs throughout the API-facing portion of the presentation refactor. Any new presentation metadata is additive and must not replace IDs in route-helper inputs, request bodies, response identity fields, or consumer lookup keys. Continue to use the typed helpers and contracts owned by `@eforge-build/client`; do not add inline `/api/...` paths or duplicate wire shapes.

Add a focused regression test around the affected flow that invokes it by canonical ID and verifies the same entity/result is selected after presentation metadata is available. Run the relevant client and console test slices plus type-checking.
## Fragment: Render live, stable, overflow-safe plan lane labels

Update the Console pipeline model/rendering as one cohesive change. Reconcile presentation metadata from live `planning:complete` activity with any earlier plans snapshot, then derive `Plan NN — readable name` labels for real plans in orchestration declaration order. Keep canonical IDs as identity keys for preview, review-cycle selection, dependencies, and API interactions, following the prerequisite client-owned ID contract. Tooltips should expose both readable presentation and ID. Constrain the label cell with shrinkable layout and ellipsis so either readable names or ID fallbacks cannot intrude into stage pills or the timeline. Do not alter synthetic, phase, or map-reduce lane labels or ordering. Add focused Console regressions for late metadata, numbering, identity-based interactions, preserved special lanes, and both overflow cases; run Console type-check and repository maintainability checks.

## Execution Intent

Test ownership: builder
Review depth: standard
Review rationale: risk score 0 (dependency-root); declared docs work none, test work author-new, test owner builder; model review intent standard (Review must trace asynchronous metadata precedence, presentation-versus-identity boundaries, client-owned routes, ordering, and CSS shrink behavior.); derived build implement -> test-cycle -> review-cycle and auto review with perspectives code, test, 1 round(s), standard evaluation