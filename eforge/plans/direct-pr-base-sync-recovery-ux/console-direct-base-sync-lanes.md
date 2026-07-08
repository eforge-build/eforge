---
id: console-direct-base-sync-lanes
name: Pipeline lane labels for base-sync and merge-resolver activity
branch: direct-pr-base-sync-recovery-ux/console-direct-base-sync-lanes
---

# Pipeline lane labels for base-sync and merge-resolver activity

Update pipeline lane/thread presentation to display selector-derived labels for direct base-sync and associated merge-resolver spans while preserving lane packing semantics.

## Traceability

Criteria: ac-008
Aspects: ac-008:subsystem:lanes

## Validation

Author or extend lane rendering tests for direct base-sync, merge-resolver association, and feature-branch planId labels; existing pack-lanes tests should remain unchanged and green.

## Fragment: Selector labeling for direct base-sync

Update console selector logic to recognize direct base-sync recovery activity and associated merge-resolver activity. Preserve existing selector behavior shown by `packages/console-ui/src/__tests__/activity-selectors.test.ts`: heartbeat exclusion, registry/fallback summaries, raw JSON preservation, and normalization of slug-like `prdId`/`planSet` values. Add cases for feature-branch `planId` so labels remain clear when the event is not tied to a normal PRD display name. Candidate tests include `activity-selectors.test.ts` and focused `now-*`/run-state selector tests listed in the evidence paths.
## Fragment: Pipeline lane display for recovery activity

Update the pipeline lane/thread presentation so direct base-sync and merge-resolver spans use the selector-derived labels. Keep `packIntoLanes` semantics intact: the existing `pack-lanes.test.ts` confirms empty input, non-overlap collapsing, overlap fan-out, earliest-free reuse, sorting, and boundary behavior. Add/extend rendering tests in the pipeline lane test area for direct base-sync, merge-resolver association, and feature-branch `planId` labels.