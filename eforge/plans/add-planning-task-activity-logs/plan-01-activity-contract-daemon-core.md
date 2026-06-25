---
id: plan-01-activity-contract-daemon-core
name: Activity Log Contract and Daemon Append Flow
branch: add-planning-task-activity-logs/plan-01-activity-contract-daemon-core
agents:
  builder:
    effort: high
    rationale: Touches the shared wire contract plus daemon task lifecycle code with
      bounded persistence, event emission, and terminal race behavior.
  reviewer:
    effort: high
    rationale: The review must check API compatibility, sanitizer bounds, and
      terminal transition idempotency.
  tester:
    effort: high
    rationale: Lifecycle and cap tests span client schemas, daemon sanitizer
      helpers, and async task service paths.
---

# Activity Log Contract and Daemon Append Flow

## Architecture Context

Planning agent tasks are daemon-owned JSON records projected through the shared `@eforge-build/client` contract. The activity log belongs in optional task metadata so legacy records remain parseable, no database migration is needed, and the workstation can consume the same task shape it already polls. The engine event stream remains unchanged; this is task-scoped daemon/extension orchestration metadata.

## Implementation

### Overview

Add the shared activity entry schema and client constants, then route daemon task metadata updates through a single bounded append/update helper. The helper must read the current record, append one daemon-timestamped activity entry when an activity message is supplied, preserve existing progress fields, enforce metadata sanitization and count caps before write, write once, and emit the same lifecycle/progress events that callers emit today.

### Key Decisions

1. Store `metadata.activityLog` as oldest-to-newest entries and bound it to the newest 50 entries by taking the last `EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES` entries before persistence.
2. Export `EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES` and `EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH` from the shared client package and import those constants in daemon sanitizer code so the schema and daemon bounds cannot drift silently.
3. Keep activity entry fields minimal: required daemon timestamp, required non-empty message, and optional `kind`/state fields only if the implementation uses them. Do not store prompt text, source snippets, transcripts, item packet bodies, or extension-supplied timestamps.
4. Coalesce consecutive duplicate activity messages in the append helper by replacing the latest entry timestamp rather than appending another entry. This keeps repeated `Planner task is running` updates from consuming the bounded history.
5. Terminal transitions append terminal context only from the code path that wins the status transition. Later completion/failure/cancellation attempts must no-op after seeing a terminal or missing record.

## Scope

### In Scope

- Shared client schema and type exports for activity entries.
- Daemon metadata sanitizer support for activity entry count, message, timestamp, and empty-message dropping.
- A single daemon service helper that preserves `progressMessage`, `sectionProgress`, and `backlogCurationProgress` while appending bounded activity.
- Starting, generic progress, section progress, backlog-curation progress, completion, failure, and cancellation paths routed through the helper or through the same sanitization path.
- Optional deferred source provider `progress`/`activity` callback plumbing in daemon helper code, with backward compatibility for providers that only accept `{ cwd, input, signal }`.
- Client and monitor tests covering schema compatibility, caps, sanitization, progress appends, terminal retention, and provider callback compatibility.

### Out of Scope

- Workstation rendering of the timeline.
- Backlog curation source and map/reduce milestone content beyond generic deferred-source callback plumbing.
- Global daemon event-log viewing or transcript persistence.
- Database migrations or indexing changes.

## Files

### Create

- None.

### Modify

- `packages/client/src/extension-agent-tasks.ts` — add exported activity cap constants, `ExtensionAgentTaskActivityEntrySchema`, optional `activityLog` on `ExtensionAgentTaskSanitizedMetadataSchema`, and inferred `ExtensionAgentTaskActivityEntry` type.
- `packages/client/src/routes.ts` — re-export the activity entry type and cap constants with the other extension agent task contract types/constants.
- `packages/client/src/browser.ts` — re-export the activity entry type and cap constants for the workstation browser bundle.
- `packages/client/src/__tests__/extension-agent-tasks.test.ts` — add schema tests for valid activity logs, cap-bound activity logs, 51-entry rejection, and legacy records without `activityLog`.
- `packages/monitor/src/routes/extensions/agent-task-events.ts` — import the client caps, sanitize `activityLog`, bound entries to newest N, truncate messages, normalize/drop invalid timestamps, and drop empty sanitized messages before events or record writes see metadata.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — add a private append/update helper and use it from start metadata creation, progress, section progress, backlog-curation progress, completion, failure, explicit cancellation, and abort cancellation paths. Ensure each helper call writes at most once and emits the matching daemon event.
- `packages/monitor/src/routes/extensions/agent-task-service-helpers.ts` — extend deferred source provider context with optional best-effort `progress` and `activity` callbacks while preserving existing `{ cwd, input, signal }` behavior.
- `packages/monitor/src/__tests__/agent-task-events.test.ts` — cover activity sanitizer caps, empty-message dropping, timestamp normalization/drop behavior, and shared schema compatibility.
- `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` — cover progress appends, bounded newest entries, field preservation, terminal retention, cancellation idempotency, and deferred source provider progress callbacks.

## Verification

- [ ] `safeParseExtensionAgentTaskRecord` accepts running and completed records with `metadata.activityLog`.
- [ ] `safeParseExtensionAgentTaskRecord` accepts legacy task records that omit `metadata.activityLog`.
- [ ] A 50-entry activity log parses and a 51-entry activity log fails schema parsing.
- [ ] `sanitizeMetadata` truncates activity messages to `EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH` and returns no empty activity messages.
- [ ] A task that emits more than 50 progress messages persists exactly `EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES` newest activity entries.
- [ ] Progress updates preserve existing `progressMessage`, `sectionProgress`, and `backlogCurationProgress` fields that are not being replaced by that update.
- [ ] Completed, failed, and cancelled task records retain recent activity entries after the terminal write.
- [ ] Repeated cancellation or an abort-after-cancel path does not append a second cancelled terminal activity entry.
- [ ] A deferred source provider that ignores the new callbacks still runs with `{ cwd, input, signal }`.
- [ ] A deferred source provider that calls `progress('Provider milestone')` causes the daemon record and progress event metadata to include that activity message.
- [ ] `pnpm vitest run packages/client/src/__tests__/extension-agent-tasks.test.ts packages/monitor/src/__tests__/agent-task-events.test.ts packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts --silent` exits 0.
