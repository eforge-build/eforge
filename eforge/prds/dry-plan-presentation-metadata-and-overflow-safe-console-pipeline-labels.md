---
title: DRY Plan Presentation Metadata and Overflow-Safe Console Pipeline Labels
created: 2026-07-13
depends_on: ["keep-eforge-plan-search-index-clean-after-read-only-workstation-refresh"]
stack_parent: keep-eforge-plan-search-index-clean-after-read-only-workstation-refresh
landing: pr
landing_auto_merge: true
---

# DRY Plan Presentation Metadata and Overflow-Safe Console Pipeline Labels

## Problem / Motivation

The Console pipeline currently resolves plan identity, names, labels, artifacts, and tooltips through separate paths. This causes semantic plan IDs such as `eforge-plan-search-dirty-refresh` to render directly as user-facing labels.

On live builds, `/api/plans/:runId` may be fetched before `planning:complete` and is not refreshed, leaving `planArtifact` unavailable even though the reduced `planning:complete` state already contains the human-readable plan name. The fallback tooltip then repeats the raw ID.

Long unbroken IDs also exceed the nominal label column and overlap the build-stage strip.

The current run demonstrates that the wire event contains the readable name `Keep eforge-plan search dirty tracking stable across no-op refreshes`, while the pipeline and tooltip both show only `eforge-plan-search-dirty-refresh`.

## Goal

Introduce one DRY, Console-owned plan presentation model that centrally resolves plan order, readable labels, names, IDs, preview bodies, and source precedence. Render readable ordinal labels such as `Plan 01 — Keep eforge-plan search dirty tracking stable across no-op refreshes`, retain semantic plan IDs for correlation and operations, and make the pipeline label column robust against long names and IDs.

## Approach

- Add a focused plan-presentation builder or selector with a shape equivalent to:
  - `id`
  - `name`
  - `ordinal`
  - canonical display `label`
  - optional preview `body`
  - any existing plan metadata needed by the pipeline, without duplicating lookup or precedence logic
- Define source precedence once:
  - Reduced `planning:complete` / `earlyOrchestration` data is authoritative for plan identity, readable name, declaration order, dependencies, and build configuration during live execution.
  - REST `/api/plans` data enriches preview bodies and supplemental artifact metadata when available.
  - Resume artifacts remain a recovery fallback.
- Do not independently reimplement metadata fallback or label formatting in `PipelineSection`, `ThreadPipeline`, and `PlanRow`; consumers should use the shared presentation model.
- Format real compiled plans by declaration order as `Plan NN — <human-readable name>`, with zero-padded ordinals. Do not infer ordinals from semantic IDs.
- Keep phase and synthetic lanes—including `Planning`, `Satisfaction Gate`, `Map atoms`, reduce levels, validation, base sync, feature branches, and similar lanes—on their existing lane-display path. They must not be presented as numbered compiled plans.
- Keep the underlying plan ID for event correlation, preview lookup, diff APIs, dependencies, review-cycle detail, and other operations.
- Make the visible plan tooltip useful and non-duplicative by showing the readable plan label or name, the underlying ID as secondary metadata, and dependency information where currently applicable.
- Ensure plan preview still opens correctly by ID and uses the best available body.
- Eliminate the live timing failure where opening run detail before `planning:complete` permanently prevents readable metadata or preview content from appearing. Prefer deriving available metadata or body from reduced events over unnecessary polling; if a refetch remains necessary, target it to planning completion.
- Fix overflow by using a genuinely bounded first grid column and consistent `min-w-0`, `max-w-full` / `w-full`, `overflow-hidden`, and truncation behavior across artifact, fallback, PRD, and grouped-lane label branches. The timeline or stage column must never be overlapped by a long label. Preserve the full label in the tooltip.

## Scope

### In scope

- Console pipeline plan-presentation metadata and rendering.
- Central resolution of plan order, readable labels, names, IDs, preview bodies, metadata, and source precedence.
- Live-event and REST plan-data integration needed to prevent stale or missing readable metadata and preview content.
- Pipeline label-column overflow and truncation behavior.
- Relevant Console tests and stories.
- Likely implementation areas:
  - `packages/console-ui/src/views/run-detail/pipeline-section.tsx`
  - `packages/console-ui/src/components/pipeline/thread-pipeline.tsx`
  - `packages/console-ui/src/components/pipeline/plan-row.tsx`
  - `packages/console-ui/src/hooks/use-run-detail.ts`
  - `packages/console-ui/src/lib/run-state/` selectors and types

### Out of scope

- Unrelated planning or daemon redesign.
- Changing engine plan IDs, artifact names, branches, daemon contracts, or event schemas solely for presentation.
- Moving phase or synthetic lanes onto the numbered compiled-plan presentation path.

### Repository constraints

- Follow repository maintainability rules.
- Use semantic region markers where required.

## Acceptance Criteria

- A compiled plan with ID `eforge-plan-search-dirty-refresh` and readable name `Keep eforge-plan search dirty tracking stable across no-op refreshes` renders as a numbered readable label, not as the raw ID.
- The readable label appears during a live run even if the initial plans REST request completed before `planning:complete`.
- The tooltip shows readable presentation and the underlying ID rather than repeating the ID as both label and tooltip.
- Long semantic IDs truncate within the bounded label column and never overlap stage pills or the timeline.
- Long readable names truncate within the bounded label column and never overlap stage pills or the timeline.
- Multiple plans receive stable `Plan 01`, `Plan 02`, and subsequent numbering based on orchestration declaration order.
- Existing synthetic, phase, and map-reduce lane labels remain unchanged.
- Existing synthetic, phase, and map-reduce lane ordering remains unchanged.
- Plan preview continues to open correctly by ID and uses the best available body.
- Review-cycle selection continues to work by underlying plan ID.
- Dependency display continues to work.
- ID-based API behavior continues to work.
- Tests cover semantic plan IDs.
- Tests cover absent or stale REST plan data combined with live-event metadata.
- Tests cover multiple-plan numbering.
- Tests cover tooltip content.
- Tests cover the overflow classes and layout contract.
- Tests cover synthetic-lane non-regression.
- Relevant targeted Console tests pass.
- The Console type-check passes.
- The repository maintainability checks pass.

## Manual Verification Notes

N/A