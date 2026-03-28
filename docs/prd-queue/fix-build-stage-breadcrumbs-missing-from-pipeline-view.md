---
title: Fix Build Stage Breadcrumbs Missing from Pipeline View
created: 2026-03-28
status: pending
---



# Fix Build Stage Breadcrumbs Missing from Pipeline View

## Problem / Motivation

Commit `c36fe33` added `BuildStageProgress` to `thread-pipeline.tsx` - a breadcrumb row showing each plan's build stages (implement -> review-cycle -> validate, etc.) with status indicators. The component works correctly but never receives data because the `/api/orchestration` server endpoint strips the `build` field.

`serveOrchestration()` in `src/monitor/server.ts:276-284` reconstructs orchestration from the `plan:complete` event, but only maps `id`, `name`, `dependsOn`, `branch`. The `PlanFile` type in the event doesn't carry `build`/`review` fields - those live in `orchestration.yaml`.

## Goal

Enrich the `/api/orchestration` endpoint with `build` and `review` fields so that `BuildStageProgress` breadcrumbs render correctly in the pipeline view.

## Approach

The server already has `readBuildConfigFromOrchestration()` (line 357-387) that reads build/review from `orchestration.yaml` and enriches the `/api/plans` endpoint. The same enrichment needs to be applied to `/api/orchestration`.

**File: `src/monitor/server.ts` - `serveOrchestration()` (line 261)**

1. Make the function `async`
2. After building the base orchestration object, call `readBuildConfigFromOrchestration(sessionId)` to get the build/review data
3. Enrich each plan entry with `build` and `review` fields from the map

The change is ~5 lines - reuse the existing `readBuildConfigFromOrchestration` helper that already does the orchestration.yaml parsing.

## Scope

**In scope:**
- Enriching the `/api/orchestration` endpoint response with `build` and `review` fields by reusing `readBuildConfigFromOrchestration()`

**Out of scope:**
- N/A

## Acceptance Criteria

1. `pnpm build` completes with no type errors
2. Running a build with the monitor open (`eforge build --foreground --verbose`), once compile completes, the pipeline view shows build stage breadcrumbs above each plan's agent timeline bars
3. Breadcrumbs show correct stages and update status as build progresses
