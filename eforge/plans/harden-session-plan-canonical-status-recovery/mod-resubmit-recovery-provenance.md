---
id: mod-resubmit-recovery-provenance
name: Identity-preserving resubmit recovery and provenance
branch: harden-session-plan-canonical-status-recovery/mod-resubmit-recovery-provenance
---

# Identity-preserving resubmit recovery and provenance

Treat terminal failed, removed, and stale queue/build evidence as recoverable. Add or extend a first-class eforge-plan resubmit action/UX that uses the same plan identity, avoids delete/recreate duplication, cleans stale side effects, creates fresh lifecycle evidence, and preserves source item/epic IDs, suitable session identity, recommendation refs, and provenance links.

## Traceability

Criteria: ac-006, ac-007, ac-008, ac-009
Aspects: ac-006:subsystem:build, ac-006:subsystem:deleting, ac-006:subsystem:queue, ac-006:subsystem:recreating, ac-007:subsystem:provenance, ac-007:subsystem:recommendation, ac-008:subsystem:build, ac-008:subsystem:queue, ac-009:general:general

## Validation

Author cleanup -> resubmit -> handoff regression covering stable ids/refs, fresh queue/build records, and corrected ready/success projection.

## Fragment: Terminal queue/build evidence permits resubmit

Implement the policy layer for AC-006: when a submitted session plan is correlated with a terminal failed build record or removed queue/build record, treat that correlation as recoverable terminal evidence. The plan should become resubmittable rather than blocked behind delete/recreate workflows. Inspect/update localized surfaces such as `eforge/extensions/eforge-plan/planning-state-policy.ts`, `eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts`, `eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts`, and canonical lifecycle records. Preserve shared client-owned route/event contracts; do not inline daemon wire shapes.

## Fragment: First-class eforge-plan resubmit action/UX

Expose a deliberate resubmit affordance for submitted extension-managed session plans only when terminal failed/removed correlation makes recovery eligible. Implement it through eforge-plan action surfaces such as `eforge/extensions/eforge-plan/session-plan-actions.ts`, `eforge/extensions/eforge-plan/session-plan-schemas.ts`, `eforge/extensions/eforge-plan/canonical/session-plan-records.ts`, `eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts`, and `eforge/extensions/eforge-plan/index.ts`. Keep the action output actionable for active/non-terminal plans, preserve source item/epic/recommendation/provenance fields, and update `packages/pi-eforge/extensions/eforge/index.ts` plus Claude plugin/MCP skills or docs if a new or changed user-facing command/tool is exposed. If `eforge-plugin/` changes, bump its plugin version.

## Fragment: Resubmit without delete/recreate

Implement the action/control path so recovery resubmits the existing submitted session plan. The flow may clean stale queue/build side effects, but it must not delete the session plan or create a replacement plan. Audit localized surfaces including `eforge/extensions/eforge-plan/index.ts`, `eforge/extensions/eforge-plan/session-plan-actions.ts`, `packages/engine/src/queue/control.ts`, `packages/monitor/src/routes/queue-control.ts`, and recovery skill/docs references. Validation should assert stable plan identity, stable source refs/provenance, no duplicate plan rows, and resubmission success after terminal failed/removed evidence.

## Fragment: Fresh lifecycle record on resubmission

Implement core resubmission semantics for queue/build lifecycle records. Inspect localized paths such as `eforge/extensions/eforge-plan/canonical/lifecycle-records.ts`, `eforge/extensions/eforge-plan/canonical/queue-removal-cleanup.ts`, `eforge/extensions/eforge-plan/sqlite/repositories/queue-build.ts`, `eforge/extensions/eforge-plan/planning-state-policy.ts`, and `packages/engine/src/queue/build-single-prd.ts`. The resubmitted handoff path must create fresh queue/build lifecycle evidence and readiness checks must not be driven by older submitted-status evidence. Validate with a stale submitted record followed by resubmission.

## Fragment: Queue/build surface propagation

Propagate corrected state through queue/recovery surfaces. Inspect `packages/engine/src/queue/control.ts`, shared client queue APIs and browser helpers, queue projections, build event/auto-build types, `packages/monitor/src/routes/queue-control.ts`, and `web/public/reference/events.md` if wire/event docs change. Keep route constants and daemon wire shapes owned by `@eforge-build/client`.

## Fragment: Recovery resubmit handoff regression

Author regression coverage for the AC-009 recovery flow: start from a failed build or removed queue cleanup state, resubmit, then perform/observe handoff. Assertions should verify the new handoff/session-plan projection retains canonical provenance such as source item/epic/recommendation references and is not contaminated by removed/failed prior state. Reuse existing queue cleanup, lifecycle, canonical store, and session-plan projection test infrastructure identified in the source evidence.