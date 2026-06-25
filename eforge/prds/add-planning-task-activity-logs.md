---
title: Add Planning Task Activity Logs
created: 2026-06-25
---

# Add Planning Task Activity Logs

## Problem / Motivation

Long-running `eforge-plan` planning tasks currently expose only the latest `metadata.progressMessage`, optional section progress, and backlog-curation item-agent progress. In the workstation drawer, a task can sit for many minutes with only “Planner task is running,” leaving the user unable to tell whether source assembly, git-delta scanning, source-first audit, map/reduce work, validation, or completion handling is still moving.

This is especially painful for analyze-all/backlog-curation work where the task is daemon-owned and intentionally backgrounded.

## Goal

Add a bounded, sanitized, timestamped activity log to `eforge-plan` planning task records and render it in the workstation task detail drawer. The result should provide task-scoped planning activity history without becoming a general daemon event-log viewer or raw agent transcript store.

## Approach

- Add the activity log as an optional metadata field on the task record because agent tasks already persist as daemon-owned JSON records and the current UI consumes task metadata.
- Keep old task records valid and avoid introducing a new storage or indexing system.
- Use a bounded append-only recent history, for example newest 50 entries, with sanitized message lengths aligned with existing progress-message caps.
- Keep the exact activity count cap centralized in client/daemon code and tested.
- Treat existing progress fields as summary state, not history.
- Appending an activity entry must not remove `progressMessage`, `sectionProgress`, or `backlogCurationProgress`.
- Avoid duplicate noise by centralizing activity append in daemon service helpers and deduping or coalescing repeated consecutive messages where practical.
- Use daemon timestamps at append time rather than trusting extension/provider timestamps.
- Keep source-provider activity callbacks optional and best-effort.
- Preserve existing provider compatibility for the current `{ cwd, input, signal }` behavior.
- Render the rich timeline as a drawer-only detail affordance by default so the task rail/card remains scannable.
- Treat this as daemon/extension orchestration metadata, not engine stdout or a new build-event stream.
- Keep the shared client contract as the source of truth for task wire shape.
- Update any `eforge-plan` workstation docs or fixtures that show task record examples if behavior becomes user-visible.

Implementation touchpoints:

- `packages/client/src/extension-agent-tasks.ts`
  - Add `ExtensionAgentTaskActivityEntrySchema`.
  - Add an optional `activityLog` or similar field under `ExtensionAgentTaskSanitizedMetadataSchema`.
  - Export inferred types.
- `packages/monitor/src/routes/extensions/agent-task-events.ts`
  - Extend metadata sanitization with count caps.
  - Extend metadata sanitization with message caps.
  - Sanitize timestamps and messages.
  - Drop empty entries.
- `packages/monitor/src/routes/extensions/agent-task-service.ts`
  - Add a single append/update helper.
  - The helper should read the current record.
  - The helper should append a timestamped activity entry.
  - The helper should bound the log.
  - The helper should update latest progress where appropriate.
  - The helper should write once.
  - The helper should emit progress events.
  - Reuse the helper from start, progress, section progress, backlog-curation progress, completion, failure, and cancellation paths.
- `packages/monitor/src/routes/extensions/agent-task-service-helpers.ts`
  - Consider extending deferred source provider context with an optional `progress` or `activity` callback.
  - Source assembly should be able to report milestones.
  - Providers that ignore the callback should remain compatible.
- `packages/monitor/src/routes/extensions/backlog-curation-map-reduce-runner.ts`
  - Append coarse milestones around packet preparation, cache scan, item auditing, reducer run, validation, and repair attempt.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts`
  - Thread optional progress callbacks through source assembly.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts`
  - Emit source-building phase milestones.
- `eforge/extensions/eforge-plan/planning-agent-task-projection.ts`
  - Ensure list/get projections preserve bounded activity.
  - Ensure compact summaries do not reintroduce omitted large results.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`
  - Add workstation activity entry types matching the shared browser contract.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx`
  - Render latest activity or compact summary as needed.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-drawer.tsx`
  - Render the fuller activity timeline.

Assumptions:

- Optional metadata additions are wire-compatible with existing records and clients.
- The daemon JSON record size remains acceptable with a capped recent activity list.
- Sanitized milestones are safe to expose in the workstation because they describe phase progress, not raw source or model output.

Risks and mitigations:

- Log growth or noisy writes are mitigated with centralized caps, sanitization, dedupe/coalescing for repeated messages, and coarse milestones rather than per-file or per-token logs.
- Schema drift between daemon, client, and workstation is mitigated by updating shared client schemas first and using imported browser types where possible.
- UI clutter is mitigated by keeping the card compact and putting the richer timeline in the drawer.
- Source-provider compatibility is mitigated by making progress callbacks optional and preserving the existing `{ cwd, input, signal }` behavior.
- Race/cancellation edge cases are mitigated by ensuring append helpers no-op safely for missing/cancelled records and terminal transitions append final context exactly once.

Confidence is good because the affected surfaces already have schema, daemon service, projection, and React tests. Validate with targeted tests plus type-check and maintainability checks.

## Scope

In scope:

- Add an optional bounded activity log to the shared planning agent task wire contract in `packages/client/src/extension-agent-tasks.ts` and browser-consumed types.
- Persist activity entries through the daemon agent-task record path in `packages/monitor/src/routes/extensions/agent-task-store.ts`, `agent-task-service.ts`, `agent-task-events.ts`, and helper code as needed.
- Append meaningful activity milestones from existing progress update sites.
- Add missing instrumentation around deferred backlog-curation source assembly.
- Include a starting milestone.
- Include a preparing-planner-source milestone.
- Include a reading-backlog-records milestone.
- Include a scanning-git-delta milestone.
- Include a classifying-evidence milestone.
- Include a running-source-first-audit milestone.
- Include a preparing-map/reduce-packets milestone.
- Include cache hit/miss milestones.
- Include auditing-items milestones.
- Include reducing-outcomes milestones.
- Include validating-draft milestones.
- Include completed, failed, and cancelled milestones.
- Project the activity log through `eforge-plan` task list/get actions.
- Preserve compact list behavior.
- Render the timeline in the workstation slide-out task detail drawer.
- Keep existing current progress visible.
- Keep existing section progress visible.
- Keep existing backlog-curation item-agent summary visible.
- Cover running tasks.
- Cover terminal tasks.
- Ensure completion, failure, and cancellation keep enough recent context to explain what happened.

Out of scope:

- A global daemon event-log viewer.
- A cross-session observability console.
- Persisting raw model transcripts.
- Persisting raw prompts.
- Persisting full source snippets.
- Persisting unbounded logs.
- Reworking the planning task lifecycle.
- Reworking cancellation semantics.
- Reworking recommendation freshness.
- Reworking backlog curation apply policy beyond activity reporting.
- Reworking backlog curation validation policy beyond activity reporting.

## Acceptance Criteria

- `packages/client/src/extension-agent-tasks.ts` defines `ExtensionAgentTaskActivityEntrySchema`.
- `packages/client/src/extension-agent-tasks.ts` exports an inferred TypeScript type for activity entries.
- `ExtensionAgentTaskSanitizedMetadataSchema` accepts an optional bounded activity-log field.
- Shared task schema parsing accepts legacy task records without an activity-log field.
- Running planning task records expose a bounded activity log through the shared task record or task-detail projection.
- Running planning task records expose a sanitized activity log through the shared task record or task-detail projection.
- Each persisted activity entry includes a timestamp.
- Each persisted activity entry includes a readable non-empty message.
- Activity entry state/kind fields remain optional if they are implemented.
- Activity entries support chronological rendering.
- Activity entries support latest-activity display.
- The daemon generates activity timestamps at append time.
- The daemon enforces the activity entry count cap before writing task records.
- The daemon enforces activity message length caps before writing task records.
- The daemon enforces activity sanitization before emitting task records.
- The daemon drops activity entries with empty sanitized messages before writing task records.
- The daemon append/update helper appends a timestamped activity entry.
- The daemon append/update helper bounds the activity log.
- The daemon append/update helper updates latest progress where appropriate.
- The daemon append/update helper emits progress events.
- The daemon append/update helper no-ops safely for missing records.
- Terminal transitions append final activity context exactly once.
- Starting a planning task appends an activity milestone.
- Preparing planner source appends an activity milestone.
- Reading backlog records appends an activity milestone.
- Scanning git delta appends an activity milestone.
- Classifying evidence appends an activity milestone.
- Running source-first audit appends an activity milestone.
- Preparing map/reduce packets appends an activity milestone.
- Cache hits append activity milestones.
- Cache misses append activity milestones.
- Auditing items appends activity milestones.
- Reducing outcomes appends an activity milestone.
- Validating a draft appends an activity milestone.
- Completing a task appends a terminal activity milestone.
- Failing a task appends a terminal activity milestone.
- Cancelling a task appends a terminal activity milestone.
- Completed task records retain their bounded activity log after terminal update.
- Failed task records retain their bounded activity log after terminal update.
- Cancelled task records retain their bounded activity log after terminal update.
- `eforge-plan` task list projections preserve bounded activity.
- `eforge-plan` task get projections preserve bounded activity.
- Task list projections continue to omit large result payloads that were omitted before this change.
- Existing latest progress remains visible as a compact summary.
- Existing section progress remains visible as a compact summary.
- Existing backlog-curation item-agent progress remains visible as a compact summary.
- The workstation task detail drawer renders recent activity entries.
- The workstation task detail drawer renders timestamps or relative time for activity entries.
- The workstation task detail drawer renders a distinct latest activity row or label derived from the newest activity entry.
- The task card does not render the full activity timeline by default.
- Existing source providers that use only `{ cwd, input, signal }` continue to work unchanged.
- A client schema test in `packages/client/src/__tests__/extension-agent-tasks.test.ts` or an adjacent agent-task schema test verifies valid activity logs parse successfully.
- A client schema test in `packages/client/src/__tests__/extension-agent-tasks.test.ts` or an adjacent agent-task schema test verifies cap-compatible activity entries parse successfully.
- A client schema test in `packages/client/src/__tests__/extension-agent-tasks.test.ts` or an adjacent agent-task schema test verifies legacy records without activity logs parse successfully.
- A daemon/service test in `test/extension-action-agent-tasks.test.ts` or a focused monitor/service test verifies progress updates append bounded activity.
- A daemon/service test verifies terminal tasks retain recent activity entries.
- A backlog-curation test verifies source assembly emits expected milestone messages.
- A backlog-curation test verifies map/reduce emits expected milestone messages.
- Backlog-curation milestone tests do not depend on exact high-frequency item order.
- A React test in `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.test.tsx` or `planning-task-drawer.test.tsx` verifies running task activity rendering.
- A React test verifies existing progress summary preservation when activity history is present.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- `pnpm test` exits 0 for the targeted touched suites.
- `pnpm test` exits 0 for the full suite if targeted coverage reveals cross-package drift.

## Manual Verification Notes

- Review the workstation task rail/card and drawer behavior to keep the task rail/card scannable while the richer timeline remains drawer-only by default.