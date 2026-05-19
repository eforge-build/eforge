---
id: plan-01-profile-replay-and-plan-tab
name: Persist Session Profiles and Render Plan Tab Badge
branch: surface-and-persist-selected-build-profile-in-monitor-ui/plan-01-profile-replay-and-plan-tab
---

# Persist Session Profiles and Render Plan Tab Badge

## Architecture Context

Queued PRD dispatch emits `session:start` and `session:profile` before the child build emits `phase:start`. The monitor recorder creates the run row at `phase:start` or `enqueue:start`, and session replay/metadata queries join events through `runs.session_id`. A no-`runId` `session:profile` that arrives before run creation is currently neither run-correlated nor daemon-persisted, so refresh/reconnect loses the selected build/runtime profile.

The monitor UI already stores `session:profile` in `runState.profile`, and the summary row/sidebar already render profile data when replayed data exists. The bottom Plan tab lacks a selected build/runtime profile prop and display.

## Implementation

### Overview

Add recorder buffering for no-`runId` `session:profile` events keyed by runtime `sessionId`, flush the buffered profile into the first correlated run alongside buffered `session:start`, and pass/render the selected profile in the Plan tab using the existing `ProfileBadge` component.

### Key Decisions

1. Keep the primary persistence fix in `packages/monitor/src/recorder.ts` rather than changing engine event ordering. The recorder already owns run correlation and buffers `session:start` until a run exists.
2. Keep `session:profile` as `persist: false` in `packages/client/src/event-registry.ts` unless implementation-time validation finds an existing daemon-events contract that requires a change. The required replay path is per-session/run-correlated storage, not daemon-owned orphan rows.
3. Reuse `ProfileBadge` in the Plan tab so the badge label, styling, and profile detail sheet match the summary row.
4. Label the Plan tab row as `Build profile` so it remains distinct from the existing planning classification badge (`errand`, `excursion`, `expedition`).

## Scope

### In Scope

- Buffer no-`runId` `session:profile` events when they carry a `sessionId` but no active run exists.
- Flush buffered `session:start` and buffered `session:profile` into the created run row when `phase:start` establishes run correlation.
- Flush buffered `session:start` and buffered `session:profile` into the enqueue run when `enqueue:start` establishes enqueue correlation.
- Preserve run-correlated `session:profile` insertion when `event.runId` or `enqueueRunId` is already available.
- Ensure session replay and session metadata see the flushed profile row through existing DB queries.
- Pass `runState.profile` from `packages/monitor-ui/src/app.tsx` to `PlanTab`.
- Render a labeled selected build/runtime profile badge in `packages/monitor-ui/src/components/console/plan-tab.tsx`.
- Add targeted tests for recorder buffering, session replay/metadata, and Plan tab rendering.

### Out of Scope

- Database migrations or schema changes.
- Replacing or renaming the planning classification badge in the Plan tab.
- Adding new monitor API routes.
- Broad profile-router or scheduler behavior changes.
- Documentation updates; this is an internal bugfix with existing user-facing UI surfaces.

## Files

### Create

- `packages/monitor-ui/src/components/console/__tests__/plan-tab.test.tsx` — component test for the Plan tab build profile row and badge rendering, if no existing Plan tab test file is present.

### Modify

- `packages/monitor/src/recorder.ts` — add `bufferedSessionProfiles`; type-guard runtime `sessionId` on `session:profile`; buffer uncorrelated profile events; flush profile after buffered `session:start` and before the run creation upsert event is inserted; delete flushed profile entries to prevent duplicates.
- `packages/monitor/src/__tests__/recorder-run-upsert.test.ts` — add regression coverage for `session:start` → `session:profile` → `phase:start` and for enqueue correlation if not covered by the same helper.
- `packages/monitor/src/__tests__/session-sse-handshake.test.ts` or `packages/monitor/src/__tests__/stream-hello-parity.test.ts` — add replay/metadata coverage using the queued child ordering. The updated test must drive `withRecording()` over the exact ordering, assert `db.getEventsBySession(sessionId)` includes `session:profile`, assert `db.getSessionMetadataBatch()[sessionId].baseProfile` equals the emitted profile, and assert the route/snapshot projection under test (`/api/session-metadata` or `stream:hello.sessionMetadata`) exposes the same `baseProfile`.
- `packages/monitor-ui/src/app.tsx` — pass `profile={runState.profile}` into `PlanTab`.
- `packages/monitor-ui/src/components/console/plan-tab.tsx` — import `ProfileBadge` and `SessionProfile`; extend props with `profile: SessionProfile | null`; render a `Build profile` section/row when `profile.profileName` exists.
- `packages/client/src/event-registry.ts` — inspect semantics and leave `session:profile` as `{ scope: 'session', persist: false }` unless tests reveal a required daemon-events persistence contract; if changed, update the related client tests and `DAEMON_API_VERSION` only if the HTTP/SSE wire contract changes.

## Implementation Notes

- Add a small helper in `recorder.ts` to insert a buffered lifecycle event for a run to avoid duplicating the `db.insertEvent({ runId, type, planId, agent, data, timestamp })` block for start/profile.
- Because the TypeBox schema for `session:profile` does not expose `sessionId` in the static type, use a runtime guard such as `const sessionId = 'sessionId' in event && typeof event.sessionId === 'string' ? event.sessionId : undefined` instead of directly accessing `event.sessionId`.
- Buffer only uncorrelated profile events: when `event.type === 'session:profile'`, no `event.runId` exists, no `enqueueRunId` exists, and a runtime `sessionId` exists.
- Do not insert a daemon-owned `session:profile` row for the queued child case. The row must be run-correlated so `getEventsBySession*` and `getSessionMetadataBatch()` can replay it.
- For `enqueue:start`, the current code infers the session from the first buffered `session:start`. Use that same session id to flush a buffered profile for enqueue-only runs.
- If a profile arrives after `enqueue:start`, the existing `activeRunId = event.runId ?? enqueueRunId` path must insert it once.

## Verification

- [ ] A recorder test drives `session:start`, no-`runId` `session:profile` with `sessionId`, then `phase:start`; `db.getEventsByTypeForSession(sessionId, 'session:profile')` returns one row with `origin === 'run'` and `runId === phaseStart.runId`.
- [ ] The same recorder test sequence yields no daemon-owned `session:profile` rows from `db.getDaemonEventsAfter(0)`.
- [ ] An already-correlated `session:profile` event inserted while `enqueueRunId` is active produces one profile row, not two.
- [ ] A session replay/metadata test using queued child ordering sees `session:profile` in `db.getEventsBySession(sessionId)` and `db.getSessionMetadataBatch()[sessionId].baseProfile === emittedProfileName`.
- [ ] A metadata projection test verifies `/api/session-metadata` and daemon `stream:hello.sessionMetadata` include `baseProfile === emittedProfileName` for the queued child ordering.
- [ ] A session SSE test or DB-backed replay test verifies `/api/events/:sessionId` stream:hello `events` contains a serialized `session:profile` event for the session after recorder buffering.
- [ ] A Plan tab component test renders `Build profile` and the profile name when `profile.profileName` is non-null.
- [ ] A Plan tab component test renders the existing classification badge separately from the `Build profile` row when both orchestration mode and selected profile exist.
- [ ] `pnpm exec vitest run packages/monitor/src/__tests__/recorder-run-upsert.test.ts packages/monitor/src/__tests__/session-sse-handshake.test.ts packages/monitor/src/__tests__/stream-hello-parity.test.ts packages/monitor-ui/src/components/console/__tests__/plan-tab.test.tsx` exits with code 0.
- [ ] `pnpm type-check` exits with code 0.
