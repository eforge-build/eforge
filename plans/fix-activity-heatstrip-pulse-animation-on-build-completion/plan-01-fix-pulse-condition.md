---
id: plan-01-fix-pulse-condition
name: Fix pulse animation condition to respect session end
dependsOn: []
branch: fix-activity-heatstrip-pulse-animation-on-build-completion/fix-pulse-condition
---

# Fix pulse animation condition to respect session end

## Architecture Context

The activity heatstrip component (`ActivityHeatstrip`) already receives `endTime` as a prop (populated from the `session:end` event). The pulse animation on line 77 only checks `bucket.isLast` but ignores whether the session has ended, causing the animation to persist after build completion.

## Implementation

### Overview

Update the animation condition on line 77 of `activity-heatstrip.tsx` from `bucket.isLast` to `bucket.isLast && !endTime`. This ensures the pulse animation only renders while the session is still active.

### Key Decisions

1. Use `!endTime` rather than a separate "isActive" flag — `endTime` is already the canonical signal for session completion and is available in scope.

## Scope

### In Scope
- Updating the pulse animation condition in `activity-heatstrip.tsx`

### Out of Scope
- Changes to `endTime` propagation or `session:end` event handling
- Any other heatstrip styling or behavior

## Files

### Modify
- `src/monitor/ui/src/components/common/activity-heatstrip.tsx` — Change line 77 condition from `bucket.isLast` to `bucket.isLast && !endTime`

## Verification

- [ ] With `endTime` unset (active session), the last heatstrip bucket has `animation: 'pulse-opacity 2s ease-in-out infinite'`
- [ ] With `endTime` set (completed session), the last heatstrip bucket has `animation: undefined`
- [ ] No other bucket (non-last) is affected by the change
