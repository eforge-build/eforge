---
id: plan-02-console-resolved-status
name: Console Accepted-Success Resolved Status Display
branch: fix-accept-as-complete-recovery-landing-and-resolved-status-reconciliation/plan-02-console-resolved-status
agents:
  builder:
    effort: medium
    rationale: Focused selector and presentation changes after monitor/client
      contracts land.
---

# Console Accepted-Success Resolved Status Display

## Architecture Context

Plan 01 makes monitor REST and `stream:hello` project accepted-success-complete queue files as resolved and reconciles run rows to completed. Console still needs defensive selector behavior for stale snapshots or mixed-version daemons, plus presentation of accepted-success auto-merge audit metadata in the recovery completion UI.

The active dashboard selectors are pure functions in `packages/console-ui/src/lib/selectors/`. `packages/console-ui/src/lib/selectors/now.ts` is a baseline oversized implementation file with a no-growth ceiling of 1031 lines, so edit it with bounded replacements and keep its final line count at or below that ceiling.

## Implementation

### Overview

Update Console selectors so accepted-success-complete queue items are never listed as unresolved attention items even if an older monitor snapshot still marks the queue row as failed. Keep accepted-success landing failures visible with the landing failure reason. Surface accepted-success auto-merge audit status in recovery completion UI and include preview auto-merge intent in the accept-success confirmation copy.

### Key Decisions

1. Treat `recoveryApplied.action === "accepted-success"` plus `landing.status === "complete"` as resolved in the Now attention selector, independent of raw queue status.
2. Treat accepted-success landing failures as actionable attention; include `landing.reason` when present so the operator sees the PR/auto-merge/landing blocker.
3. Do not add UI-only Build health overrides. Build health and Build history consume canonical run status from monitor; selector tests only verify that accepted-success-like success statuses classify as completed.
4. Preserve the existing Console wire type imports from `@eforge-build/client/browser`; do not redeclare queue or recovery-applied shapes.

## Scope

### In Scope

- Defensive Now attention suppression for accepted-success-complete recovery markers.
- Now attention detail text for accepted-success landing failures.
- Recovery completion panel display of `landing.autoMerge` status and reason.
- Accept-success confirmation copy that reports preview `landingAutoMerge` when present.
- Console selector tests for attention suppression, landing-failure attention, Build health classification, and Build history classification.

### Out of Scope

- Monitor projection changes; those are owned by Plan 01.
- New recovery actions or new Console recovery flows.
- Changing active build lifecycle selectors.

## Files

### Create

- `packages/console-ui/src/__tests__/now-accepted-success-selectors.test.ts` — focused Now attention tests for accepted-success-complete and landing-failed markers without growing `now-selectors.test.ts` past the test cap.
- `packages/console-ui/src/__tests__/build-history-accepted-success.test.ts` — focused Build history classification test for accepted-success-like completed statuses.

### Modify

- `packages/console-ui/src/lib/selectors/now.ts` — add bounded accepted-success resolution/failure detail logic while keeping the file at or below 1031 lines.
- `packages/console-ui/src/lib/selectors/metrics.ts` — only edit if the existing `success` substring classification does not cover the accepted-success status vocabulary chosen by Plan 01.
- `packages/console-ui/src/lib/selectors/build-history.ts` — only edit if the existing `success` substring classification does not cover the accepted-success status vocabulary chosen by Plan 01.
- `packages/console-ui/src/components/recovery/recovery-completion-panel.tsx` — include `landing.autoMerge` status and reason in accepted-success landing summaries.
- `packages/console-ui/src/components/recovery/accept-success-action.tsx` — include preview `landingAutoMerge` true/false in the confirmation description and omit the line when undefined.
- `packages/console-ui/src/__tests__/metrics-selectors.test.ts` — add Build health coverage for accepted-success-like resolved status.

## Implementation Notes

### Now attention selector

- Add a small helper that returns true for `accepted-success` markers with `landing.status === "complete"`.
- Exclude those items from both failed-with-verdict and failed-without-verdict candidate lists.
- Add or adjust the applied-marker detail formatter so accepted-success landing failures produce detail text containing the landing status and the non-empty `landing.reason`.
- Keep split applied detail as `split → <successorPrdId>`.
- Because `now.ts` has a no-growth ceiling, reduce nearby comment lines or replace existing inline detail logic without increasing the final line count.

### Recovery completion display

- Extend `landingSummary(...)` to append auto-merge status for PR landing when `landing.autoMerge` is present:
  - `auto-merge complete`
  - `auto-merge skipped — <reason>`
  - `auto-merge failed — <reason>`
- Preserve existing action/status/PR URL/merge SHA/branch/reason output.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0, with `packages/console-ui/src/lib/selectors/now.ts` at 1031 lines or fewer.
- [ ] Now attention tests verify a queue item with `status: "failed"`, accepted-success marker, and `landing.status: "complete"` is absent from Needs attention.
- [ ] Now attention tests verify a queue item with `status: "failed"`, accepted-success marker, `landing.status: "failed"`, and `landing.reason: "PR creation failed"` remains in Needs attention and the detail includes `PR creation failed`.
- [ ] Metrics selector tests verify an accepted-success-like resolved build contributes to `landed` and not `failed`.
- [ ] Build history tests verify an accepted-success-like resolved build is classified as `completed`.
- [ ] Recovery completion component tests or existing render coverage verify auto-merge failed/skipped reason text appears when `landing.autoMerge.reason` is present.
- [ ] `pnpm test -- packages/console-ui/src/__tests__/now-accepted-success-selectors.test.ts packages/console-ui/src/__tests__/metrics-selectors.test.ts packages/console-ui/src/__tests__/build-history-accepted-success.test.ts` exits 0.
