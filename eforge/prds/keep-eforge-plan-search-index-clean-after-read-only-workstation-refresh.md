---
title: Keep eforge-plan Search Index Clean After Read-Only Workstation Refresh
created: 2026-07-13
landing: pr
landing_auto_merge: true
---

# Keep eforge-plan Search Index Clean After Read-Only Workstation Refresh

## Problem / Motivation

Refreshing the eforge-plan workstation synchronizes unchanged session-plan artifacts and marks session plans plus linked backlog items and epics dirty. As a result, a freshly rebuilt FTS index immediately returns to `dirty index` even though no meaningful canonical planning data changed.

Evidence:

- A search-index rebuild at `2026-07-12T23:46:04Z` refreshed 302 documents and cleared 128 dirty records.
- A workstation refresh then produced 116 dirty records at `2026-07-12T23:46:25Z` with reason `canonical-session-plan-sync`.
- The workstation refresh loads `list-planning-artifacts`.
- `eforge/extensions/eforge-plan/canonical/session-plan-records.ts` function `syncSessionPlanArtifactRecord` currently updates synchronization metadata and unconditionally calls `markCanonicalSearchDirty` for the session plan and linked backlog items/epics.
- Backlog item: `keep-eforge-plan-search-index-clean-after-read-only-workstation-refresh`.

## Goal

Make canonical session-plan synchronization idempotent for search indexing. Read-only loading or synchronization of unchanged artifacts must not dirty the FTS index, while meaningful search-relevant changes must continue to mark exactly the affected documents dirty.

## Approach

- Update canonical session-plan synchronization so read-only loading or synchronization of unchanged artifacts does not dirty the FTS index.
- Ensure `syncSessionPlanArtifactRecord` does not unconditionally call `markCanonicalSearchDirty` for the session plan and linked backlog items/epics.
- Mark the session plan and linked backlog items or epics dirty only when search-relevant canonical content or relationships change.
- Preserve canonical SQLite session-plan status and lifecycle behavior.
- Keep search dirtiness explicit for genuine canonical writes.
- Follow the repository LLM-friendly code and test policies.

## Scope

In scope:

- Canonical session-plan synchronization behavior for search indexing.
- Read-only workstation refresh behavior when loading `list-planning-artifacts`.
- Search dirtiness for session plans and linked backlog items/epics.
- Regression coverage for unchanged synchronization, meaningful synchronization changes, and the workstation refresh sequence.

Out of scope:

- Making read paths silently rebuild the search index.
- Changing canonical SQLite session-plan status and lifecycle behavior.

## Acceptance Criteria

- A read-only workstation refresh that encounters unchanged session-plan artifacts does not mark search documents dirty.
- Session-plan synchronization marks the session plan and linked backlog items or epics dirty only when search-relevant canonical content or relationships change.
- A rebuilt search index remains `ready` after refreshing the workstation when no canonical planning data changed.
- Genuine session-plan, backlog-item, epic, or relationship changes still mark the affected search documents dirty.
- Regression tests cover unchanged synchronization, meaningful synchronization changes, and the workstation refresh sequence.