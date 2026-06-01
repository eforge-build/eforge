---
title: Add Read-Only Session Plan Set APIs and Console Browsing
created: 2026-05-30
depends_on: ["add-read-only-session-plan-set-artifacts-to-eforge-build-input"]
profile: gpt-claude-combo
landing: pr
stack_parent: add-read-only-session-plan-set-artifacts-to-eforge-build-input
---

# Add Read-Only Session Plan Set APIs and Console Browsing

## Problem / Motivation

This is the second split from `.eforge/session-plans/2026-05-27-umbrella-plan-set-workflow.md`.

It should run after `2026-05-28-session-plan-set-artifact-protocol.md` lands. The first plan provides read-only `@eforge-build/input` helpers for plan-set manifests, safe path resolution, loading, validation, and JSON-safe summaries. This plan exposes those helpers through typed daemon/client APIs and renders them in Console Planning Workspace.

Users need to see directory-backed session plan sets as coherent planning objects rather than unrelated files. Without daemon/client route contracts and Console browsing support, the artifact protocol remains invisible to the primary planning workspace.

The previous failed build tried to include API, daemon, Console, mutation, and build handoff in one broad Expedition. This plan avoids that failure mode by exposing only read-only list/show/validate behavior and rendering existing plan sets.

## Goal

Expose read-only session plan-set list, show, and validate behavior through typed daemon/client APIs and make existing plan sets browsable in Console Planning Workspace.

This plan intentionally remains read-only. It does not create, mutate, scaffold, or enqueue plan-set children.

## Approach

### Architecture Impact

- `@eforge-build/client` remains the owner of route constants, request types, response types, and helper functions.
- Daemon code must not inline new `/api/...` literals outside client-owned route constants.
- Daemon route handlers should be thin projections over `@eforge-build/input` read-only helpers.
- Daemon route handlers should not duplicate manifest parsing, path resolution, or summary shaping logic.
- Console UI should consume daemon/client data rather than reading `.eforge/session-plans/` directly.
- Console UI should preserve the distinction between flat session plans and session plan sets while showing them in one planning workspace.
- This plan does not change build engine behavior.

### Design Decisions

- Add read-only API before mutation API because read-only routes prove the contract and UI shape without creating source-of-truth or collision-handling problems.
- Wire responses use summary shapes, not parsed internals.
- The daemon should return JSON-safe summaries from `@eforge-build/input`, not `SessionPlan` objects with `Map` sections or other internal parser details.
- Console should continue to list and open flat session plans.
- Plan sets should appear as grouped artifacts, not replace the flat model.
- Console may display buildability, but it must not submit nested plan-set children until the build handoff plan defines safe semantics.
- Route constants and wire shapes should fail at compile/test time if daemon and client drift.

### Code Impact

Likely affected areas:

- `packages/client/src/routes.ts` for route constants.
- `packages/client/src/api/` for read-only session plan-set API helpers.
- `packages/client/src/index.ts` for exports.
- `packages/client/src/api-version-const.ts` if the daemon HTTP API surface changes incompatibly.
- `packages/monitor/src/server.ts` or route modules for daemon read-only handlers.
- `packages/console-ui/src/views/plans/` for grouped browsing and detail UI.
- Console Planning Workspace tests for flat plans plus plan sets.

Use bounded edits in large files. If daemon server changes would be large, prefer extracting focused route handlers rather than growing `packages/monitor/src/server.ts` substantially.

### Documentation Impact

Minimal documentation should be updated only where it describes Console Planning Workspace behavior or daemon route reference generation requires updates.

Do not document mutation or build-handoff workflows until those exist.

### Risks

- **Route drift risk:** daemon and client can disagree on route paths or response shapes. Mitigation: route constants and types live in `@eforge-build/client`.
- **Wire-shape risk:** summaries may leak parser internals. Mitigation: only return JSON-safe summary types.
- **UI scope creep risk:** grouped browsing can grow into editing/scaffolding. Mitigation: no mutation buttons or enqueue actions in this plan.
- **Large daemon file risk:** adding routes directly to `server.ts` can worsen maintainability. Mitigation: use bounded edits or focused extraction if needed.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Read-only route support is valuable before mutation support. | Console Planning Workspace roadmap calls for browsing/readiness/handoff visibility, and read-only APIs avoid mutation complexity. | high | low | Build route/UI tests around fixture plan sets. | Users may still need CLI/file editing until mutation support lands. |
| The artifact protocol plan has landed before this plan runs. | This plan depends on the helper surface created by `2026-05-28-session-plan-set-artifact-protocol.md`. | high | low | Check exported helpers before implementation. | This plan must be delayed or adjusted if the protocol API differs. |
| Console should show plan sets and flat plans together. | Planning Workspace is centered on session-plan artifacts, and users need to browse both flat and grouped planning objects. | high | low | Add UI tests with both artifact types. | Separate pages could be needed later, but grouped browsing remains useful. |
| No enqueue UI should be added yet. | Build handoff semantics are intentionally deferred because they caused previous review failures. | high | low | Confirm Console only renders metadata and navigation actions. | Users cannot submit children from Console until the follow-up handoff plan lands. |

### Profile Signal

Recommended profile: **Excursion**.

Rationale: this is cross-package work, but it is a read-only vertical slice with clear boundaries: client contracts, daemon projection, and Console rendering. A single cohesive plan can enumerate the necessary files and tests without delegated module planning.

## Scope

### In Scope

- Add route constants and typed request/response shapes in `@eforge-build/client` for read-only plan-set operations.
- Add client API helpers for listing, showing, and validating session plan sets.
- Add daemon handlers that call `@eforge-build/input` read-only helpers.
- Ensure daemon handlers return JSON-safe response bodies.
- Add Console Planning Workspace support for grouped plan-set browsing.
- Show umbrella-first context for a selected plan set.
- Show child metadata including id, file, kind, buildable flag, status, profile, dependencies, external references when present, and readiness/validation summary when available.
- Preserve existing flat session-plan listing and detail behavior.
- Add tests for route contracts, daemon handlers, client helpers, and Console display behavior.

### Out of Scope

- Creating plan sets.
- Adding child plans.
- Updating child metadata.
- Scaffolding umbrella/foundation/hardening structures.
- Enqueueing nested child plans.
- Marking plan-set children submitted.
- Rejecting or accepting plan-set artifacts in `normalizeBuildSource`.
- Updating Pi or Claude Code skills for creation workflows.
- External tracker sync.

## Acceptance Criteria

- `@eforge-build/client` owns route constants for listing session plan sets.
- `@eforge-build/client` owns route constants for showing a session plan set.
- `@eforge-build/client` owns route constants for validating a session plan set.
- `@eforge-build/client` exports request and response types for listing session plan sets.
- `@eforge-build/client` exports request and response types for showing a session plan set.
- `@eforge-build/client` exports request and response types for validating a session plan set.
- `@eforge-build/client` exports API helpers for read-only session plan-set operations.
- The daemon list route calls `@eforge-build/input` plan-set list helpers.
- The daemon show route calls `@eforge-build/input` plan-set load or summarize helpers.
- The daemon validate route calls `@eforge-build/input` validation helpers.
- The daemon read-only routes return JSON-safe response bodies.
- The daemon read-only routes do not parse plan-set manifests with local duplicate logic.
- The daemon read-only routes do not inline route path literals outside client-owned constants.
- Console Planning Workspace continues to display flat session plans.
- Console Planning Workspace displays session plan sets as grouped planning artifacts.
- Console plan-set rows show the plan-set title.
- Console plan-set rows show the plan-set status.
- Console plan-set rows show the child count.
- Console plan-set detail shows the umbrella anchor content or an actionable missing-anchor diagnostic.
- Console plan-set detail shows each child id.
- Console plan-set detail shows each child file.
- Console plan-set detail shows each child kind.
- Console plan-set detail shows each child buildable flag.
- Console plan-set detail shows each child status.
- Console plan-set detail shows each child profile when present.
- Console plan-set detail shows each child dependencies when present.
- Console plan-set detail shows each child external reference when present.
- Console does not expose plan-set create actions in this plan.
- Console does not expose plan-set update actions in this plan.
- Console does not expose nested child enqueue actions in this plan.
- Existing flat session-plan route tests pass.
- New read-only plan-set route tests pass.
- New Console plan-set browsing tests pass.
- New implementation files are each at most 600 lines.
- Existing oversized implementation files do not grow beyond their baseline ceilings.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
