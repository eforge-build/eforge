---
id: console-direct-base-sync-selectors
name: Console selector labels for direct base-sync recovery
branch: direct-pr-base-sync-recovery-ux/console-direct-base-sync-selectors
---

# Console selector labels for direct base-sync recovery

Extend console selectors so activity, run-state, and now rows classify direct base-sync and related merge-resolver work with explicit labels/identifiers, including feature-branch planId values, while preserving existing normalization.

## Traceability

Criteria: ac-008
Aspects: ac-008:subsystem:selectors

## Validation

Author selector tests covering direct base-sync, merge-resolver association, and feature-branch planId display; keep existing selector tests green.

## Fragment: Selector labeling for direct base-sync

Update console selector logic to recognize direct base-sync recovery activity and associated merge-resolver activity. Preserve existing selector behavior shown by `packages/console-ui/src/__tests__/activity-selectors.test.ts`: heartbeat exclusion, registry/fallback summaries, raw JSON preservation, and normalization of slug-like `prdId`/`planSet` values. Add cases for feature-branch `planId` so labels remain clear when the event is not tied to a normal PRD display name. Candidate tests include `activity-selectors.test.ts` and focused `now-*`/run-state selector tests listed in the evidence paths.
## Fragment: Pipeline lane display for recovery activity

Update the pipeline lane/thread presentation so direct base-sync and merge-resolver spans use the selector-derived labels. Keep `packIntoLanes` semantics intact: the existing `pack-lanes.test.ts` confirms empty input, non-overlap collapsing, overlap fan-out, earliest-free reuse, sorting, and boundary behavior. Add/extend rendering tests in the pipeline lane test area for direct base-sync, merge-resolver association, and feature-branch `planId` labels.