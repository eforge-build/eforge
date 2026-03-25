---
title: Fix activity heatstrip pulse animation on build completion
created: 2026-03-25
status: pending
---



# Fix activity heatstrip pulse animation on build completion

## Problem / Motivation

In the monitor build view, the activity heatstrip's last cell displays a pulse animation (`pulse-opacity 2s ease-in-out infinite`) indefinitely. The animation continues even after the build/session has completed, giving the false impression that the build is still active. The current logic only checks `bucket.isLast` without considering whether the session has ended.

## Goal

Stop the pulse animation on the last heatstrip bucket when the build completes (i.e., when `endTime` is set from the `session:end` event).

## Approach

- In `src/monitor/ui/src/components/common/activity-heatstrip.tsx`, update the condition on **line 77** that controls the pulse animation.
- Change the condition from `bucket.isLast` to `bucket.isLast && !endTime`.
- When `endTime` is set (populated from the `session:end` event), the animation will no longer be applied to the last bucket.
- This is a one-line change.

## Scope

**In scope:**
- Fixing the pulse animation condition in `activity-heatstrip.tsx` (line 77)

**Out of scope:**
- Any other heatstrip behavior or styling changes
- Changes to how `endTime` or `session:end` events are handled

## Acceptance Criteria

- [ ] When a build/session is still active (`endTime` is not set), the last bucket in the heatstrip displays the `pulse-opacity 2s ease-in-out infinite` animation.
- [ ] When a build/session has completed (`endTime` is set via `session:end` event), the last bucket no longer displays the pulse animation.
- [ ] The condition on line 77 of `src/monitor/ui/src/components/common/activity-heatstrip.tsx` reads `bucket.isLast && !endTime` instead of `bucket.isLast`.
