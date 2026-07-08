---
id: direct-base-sync-budget-flow
name: Direct base-sync fixed budget flow
branch: direct-pr-base-sync-recovery-ux/direct-base-sync-budget-flow
---

# Direct base-sync fixed budget flow

Wire the resolved budget into direct PR base sync execution and keep that budget fixed for the operation; do not introduce dynamic scaling or automatic worker-count changes.

## Traceability

Criteria: ac-002, ac-004
Aspects: ac-002:general:general, ac-004:general:general

## Validation

Author flow tests proving direct PR base sync uses the resolved budget from config and does not auto-scale under load or progress changes.

## Fragment: Resolve and pass direct PR base-sync conflict budget

Implement the direct non-stacked PR base-sync budget path. Consume the already validated/clamped `landing.directPrBaseSync.conflictAttempts` value when present, preserve the existing default when absent, and pass the resolved numeric budget into `syncDirectPrBase`. Keep the budget deterministic: do not derive or scale attempts from branch size. Validation should cover override, default/unset behavior, direct non-stacked scope, and the absence of branch-size auto-scaling.