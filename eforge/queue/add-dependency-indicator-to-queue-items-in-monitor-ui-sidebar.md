---
title: Add dependency indicator to queue items in monitor UI sidebar
created: 2026-04-01
---



# Add dependency indicator to queue items in monitor UI sidebar

## Problem / Motivation

When a PRD in the queue has a dependency on another in-flight build, there is no visual indication in the UI. Users see a pending item and wonder why it hasn't started building yet. The dependency relationship is only visible via the MCP queue list tool.

## Goal

Queue items with unresolved dependencies should show what they're waiting on, so users understand why a build hasn't started yet.

## Approach

- Add a "blocked by" subtitle line under pending queue items that have dependencies.
- Use the same dimmed text style as the existing metadata (duration, profile, plan count) on build cards.
- Show the dependency PRD name/id.
- If the dependency is also visible in the sidebar (running or in queue), the text should help the user correlate the two items.

## Scope

**In scope:**
- Only the queue sidebar in the monitor UI (`src/monitor/ui/`)
- The dependency data is already available in the queue API response (`dependsOn` field in PRD frontmatter)

**Out of scope:**
- No backend changes needed - this is purely a frontend display change

## Acceptance Criteria

- Pending queue items with dependencies show a "blocked by: {dependency-name}" line beneath the title
- The text uses the existing dimmed/muted style consistent with other metadata in the sidebar
- Items without dependencies show no extra indicator
- Once a dependency completes and the item starts building, the indicator naturally disappears (item moves from pending to running)
