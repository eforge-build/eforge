---
title: Surface and Persist Selected Build Profile in Monitor UI
created: 2026-05-19
profile: gpt-claude-combo
---

# Surface and Persist Selected Build Profile in Monitor UI

## Problem / Motivation

The monitor UI should make the selected build/runtime profile visible for every build session. Today the UI often shows no profile badge for queued/auto-build sessions even though the scheduler selected an effective profile.

This affects users trying to confirm whether a build ran under the expected profile, especially after opening or refreshing the monitor after the session has already started.

Roadmap alignment: `docs/roadmap.md` has no specific item for profile visibility. This is a maturity/UX correctness bug in the monitor/daemon event pipeline rather than a new roadmap feature.

### Affected Surface

- Top monitor summary row (`SummaryCards`) where a `ProfileBadge` is already rendered when `runState.profile.profileName` exists.
- Sidebar session metadata badge where `metadata.baseProfile` is already rendered when available.
- Bottom console **Plan** tab (`PlanTab`), which currently shows planning classification/pipeline/review details but not the selected build/runtime profile.

The selected profile badge should be visible in the Plan tab too, so users can confirm profile selection while inspecting the planning/build configuration.

### Evidence From Code Inspection

- `packages/monitor-ui/src/components/common/summary-cards.tsx` already renders `<ProfileBadge profile={profile} />` next to the status label when `runState.profile?.profileName` exists.
- `packages/monitor-ui/src/lib/reducer/handle-session.ts` already populates `runState.profile` from `session:profile` events.
- `packages/monitor-ui/src/components/layout/sidebar.tsx` already has sidebar metadata badge rendering for `metadata.baseProfile`, and `packages/monitor/src/db.ts` builds that metadata from persisted `session:profile` events.
- `packages/monitor-ui/src/components/console/plan-tab.tsx` currently shows the planning classification badge (`orchestration.mode`, e.g. errand/excursion/expedition) and pipeline/review details, but it does not receive or render the selected build/runtime `SessionProfile`.
- `packages/monitor-ui/src/app.tsx` calls `<PlanTab orchestration={effectiveOrchestration} pipelineEvent={latestPipelineEvent} />`; it can pass `runState.profile` so the Plan tab can render the same selected profile badge as the summary row.
- `packages/engine/src/queue/scheduler.ts` emits `session:start` and then `session:profile` before spawning the PRD child, after profile routing has selected or persisted the effective profile.
- `packages/monitor/src/recorder.ts` buffers `session:start` until `phase:start` or `enqueue:start` creates a run, but it does not buffer `session:profile`. A no-`runId` `session:profile` emitted before the child run's `phase:start` therefore has no `activeRunId` and is not inserted.
- `packages/client/src/event-registry.ts` currently registers `session:profile` with `scope: 'session'` and `persist: false`; persistence in the recorder is nevertheless run-correlation driven for active-run events, so the immediate defect is the missing run correlation/buffering for queued child sessions.
- Local DB inspection of the active example run found no `*profile*` events in `.eforge/monitor.db`, which explains why the UI lacks the badge after reconnect/refresh.

### Reproduction Steps

1. Start or let auto-build dispatch a queued PRD that has an effective profile selected by explicit frontmatter, active config profile, or profile router.
2. Open `http://localhost:4567/` or refresh the monitor after the build has started.
3. Select the active session in the sidebar.
4. Observe the top summary row shows status/duration/plans/tokens/cost/files but no profile badge.
5. Inspect `.eforge/monitor.db` for the selected run/session; profile events are absent, e.g. querying `events` for `type like '%profile%'` for the active run returned no rows.

### Expected Behavior

- The selected profile appears consistently in the monitor summary row and sidebar metadata after initial load, reconnect, and refresh.
- The profile value is backed by persisted/replayed session data, not only by a live transient event.

### Actual Behavior

- The UI has rendering paths for profile data, but the relevant `session:profile` event is missing from the run-correlated event stream for queued child builds, so profile state remains `null`.

### Root Cause

The defect has two parts:

1. Missing durable/correlated profile event data for the monitor to replay.
2. Missing Plan-tab rendering of the selected build/runtime profile once that data is available.

Data/root cause:

- In queued PRD dispatch, `packages/engine/src/queue/scheduler.ts` emits `session:start` followed immediately by `session:profile` before it spawns the PRD child.
- The child build later emits `phase:start` with a `runId` and the same `sessionId`; that is when `packages/monitor/src/recorder.ts` creates the run row and flushes buffered session lifecycle data.
- `packages/monitor/src/recorder.ts` buffers only `session:start` in `bufferedSessionStarts`. It does not buffer no-`runId` `session:profile` events by `sessionId`.
- Because `session:profile` has no `runId` and arrives before `phase:start`, `activeRunId` is undefined. Since `session:profile` is not a persisted daemon event type either, the recorder drops it instead of inserting it into `events`.
- Downstream DB queries for session events (`getEventsBySession*` and `getSessionMetadataEvents` in `packages/monitor/src/db.ts`) join events through `runs.session_id`, so an uncorrelated/dropped `session:profile` cannot be replayed into the UI or sidebar metadata.

UI/root cause for Plan tab:

- `packages/monitor-ui/src/components/console/plan-tab.tsx` does not accept a `SessionProfile` prop and does not render `ProfileBadge`.
- `packages/monitor-ui/src/app.tsx` invokes `PlanTab` with only `orchestration` and `pipelineEvent`. `runState.profile` is available at this level and can be passed down.
- The badge currently shown in Plan tab classification is based on `orchestration.mode` and represents eforge planning mode/scope, not necessarily the selected build/runtime profile. The new profile display should be clearly labeled to avoid conflating these two concepts.

Related but separate design point:

- `packages/client/src/event-registry.ts` currently marks `session:profile` as `persist: false`.
- For the queued child case, changing only this flag would not be sufficient unless the event is also correlated to the session/run.
- The safer primary fix is recorder buffering/flushing.
- A secondary decision is whether the registry metadata should also become `persist: true` for semantic consistency.

## Goal

Persist and replay the selected build/runtime profile for queued/auto-build child sessions so the monitor summary row and sidebar metadata show the correct profile after initial load, reconnect, and refresh.

Also render the selected build/runtime profile in the bottom console **Plan** tab with a clear label distinct from the existing planning classification badge.

## Approach

### Recommended Profile Signal

Recommended profile: **excursion**.

Rationale: This is a focused bugfix with a confirmed root cause, but it crosses the engine/monitor/client/UI event pipeline and needs careful regression tests around recorder correlation, SSE/session replay, metadata projection, and a small Plan-tab UI addition.

A single cohesive planner can enumerate the required changes and dependencies; it does not require delegated module planning, so expedition would be overkill. It is more than a trivial errand because a naive registry or UI-only fix could leave replay/refresh behavior broken.

### Implementation Shape

- Add a `bufferedSessionProfiles` map keyed by `sessionId` in `withRecording()`.
- When a `session:profile` arrives without an active run, buffer it by `sessionId`.
- When `phase:start` or `enqueue:start` establishes a run/session correlation, flush both `session:start` and `session:profile` into that run row in event order.
- Preserve existing behavior for already-correlated `session:profile` events.
- Pass `runState.profile` from `app.tsx` into `PlanTab`.
- In `PlanTab`, render a labeled selected profile badge using existing `ProfileBadge` if suitable.
- Place the badge near the top of the tab, ideally under Classification or in a small `Build profile` row.
- Do not replace the existing planning classification badge.
- Add regression tests covering queued build event order, session metadata replay, and Plan-tab profile rendering.

### Early Assumptions / Unknowns

- Assumption: the best fix is to buffer `session:profile` by `sessionId` alongside `session:start`, then flush it into the first correlated run for that session when `phase:start` or `enqueue:start` creates the run.
  - Confidence: high.
  - Evidence: recorder flow and DB query shape.
  - Validation path: add recorder tests and SSE/session metadata tests.
- Unknown: whether `session:profile` should remain `persist: false` in the registry while being recorded as a run-correlated event, or should be changed to `persist: true`.
  - Changing registry persistence may affect daemon-events replay/allowlists, so this needs explicit design choice.

### Assumptions And Validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The summary/sidebar UI rendering paths already exist; the missing summary/sidebar profile is caused by absent replayed data. | Read `SummaryCards`, `handle-session`, sidebar metadata rendering, and DB metadata projection. | high | low | Add replay/metadata tests and verify UI manually after implementation. | If wrong, additional React UI work would be required. |
| Queued child event ordering drops `session:profile` because it arrives before `phase:start` creates the run. | Read scheduler and recorder; local DB query found no profile event for the observed active run. | high | low | Add synthetic recorder test with exact event order. | If wrong, fix may need engine emission ordering instead of recorder buffering. |
| Buffering `session:profile` by `sessionId` in the recorder is the least invasive fix. | Recorder already buffers `session:start` by `sessionId`; DB session queries require run correlation. | high | low | Implement as regression test first; compare persisted row/run correlation. | If wrong, could create duplicate or mis-associated profile events under concurrent sessions. |
| `session:profile` should likely remain `persist: false` in `eventRegistry` while still being stored when run-correlated by recorder. | `persist:true` drives daemon-event allowlist/replay; daemon-owned profile events would not satisfy session replay joins. | medium | low | Builder should validate event-registry semantics and existing tests before deciding. | If wrong, daemon-events snapshot may omit profile changes where consumers expect them. |
| Existing metadata projection will populate sidebar `baseProfile` once the row exists. | `getSessionMetadataEvents` includes `session:profile` and stream-hello parity test seeds profile rows to expect `baseProfile`. | high | low | Update/add metadata test using buffered ordering. | If wrong, metadata projection also needs changes. |
| Plan tab can render the selected build/runtime profile by accepting `runState.profile` from `app.tsx`. | Read `app.tsx` call site and `PlanTab` props; `runState.profile` is already passed to `SummaryCards` in the same component. | high | low | Add or update PlanTab test and manually verify bottom tab after replay. | If wrong, state may need to be provided via context or another prop path. |
| Existing `ProfileBadge` is suitable for Plan tab display. | It is already used for the summary profile badge and opens profile detail sheet. | medium | low | Check layout/interaction in Plan tab; if unsuitable, render a simpler badge with same profile name and styling. | If wrong, small UI adaptation required; data-flow fix remains valid. |

No low-confidence/high-impact assumptions remain unresolved. The medium-confidence choices have low validation cost and should be checked during implementation.

## Scope

### In Scope

- Persisting/correlating `session:profile` events for queued/auto-build child sessions where `session:profile` is emitted before child `phase:start`.
- Buffering no-`runId` `session:profile` events by `sessionId` in the monitor recorder.
- Flushing buffered `session:start` and `session:profile` events into the created run row in event order when `phase:start` or `enqueue:start` establishes correlation.
- Preserving existing behavior for already-correlated `session:profile` events.
- Ensuring session replay and metadata include the selected profile after refresh/reconnect.
- Passing `runState.profile` from `packages/monitor-ui/src/app.tsx` into `PlanTab`.
- Rendering a clearly labeled selected build/runtime profile badge in `packages/monitor-ui/src/components/console/plan-tab.tsx`.
- Adding or updating targeted regression tests for recorder correlation, SSE/session metadata replay, and Plan-tab rendering.
- Making an explicit design choice about whether `session:profile` remains `persist: false` or changes to `persist: true`.

### Out of Scope

- Adding a new roadmap feature; this is a maturity/UX correctness bug in the monitor/daemon event pipeline.
- Replacing the existing planning classification badge (`errand`/`excursion`/`expedition`) in the Plan tab.
- Conflating the selected build/runtime profile with the planning classification badge.
- Relying on a UI-only fix that leaves replay/refresh behavior broken.
- Delegated module planning or expedition-level decomposition.

## Acceptance Criteria

### Functional Acceptance

1. For queued/auto-build child sessions where event order is `session:start` → `session:profile` → child `phase:start`, the monitor DB persists exactly one run-correlated `session:profile` event for the child session.
2. `GET /api/events/:sessionId` / session SSE `stream:hello` replays the `session:profile` event after refresh/reconnect, allowing the existing reducer to populate `runState.profile`.
3. `/api/session-metadata` and daemon `stream:hello.sessionMetadata` include `baseProfile` for sessions whose profile was emitted before run creation.
4. The monitor UI top summary row displays the existing `ProfileBadge` for reloaded sessions once replayed data is available.
5. The sidebar profile badge appears for affected sessions via existing metadata projection.
6. The bottom console **Plan** tab displays the selected build/runtime profile badge when `runState.profile.profileName` exists. This should be labeled distinctly, for example `Build profile`, so it is not confused with the existing planning classification badge (`errand`/`excursion`/`expedition`).
7. The Plan tab profile badge is visible after refresh/reconnect based on replayed `session:profile` data, not only during live event streaming.
8. Already-correlated `session:profile` events continue to persist/replay as before; enqueue-only sessions do not gain duplicate profile rows.
9. No daemon-owned orphan `session:profile` rows are created when the event can be associated with a session/run.

### Test Acceptance

- Add a recorder regression test in `packages/monitor/src/__tests__/recorder-run-upsert.test.ts` or a focused recorder test that drives `session:start`, `session:profile`, then `phase:start` and asserts the profile row is persisted under the created run.
- Add or update a session SSE/metadata test to assert `session:profile` appears in replay and `baseProfile` appears in session metadata for the queued child ordering.
- Add/adjust monitor UI tests for `PlanTab` or an appropriate source-level/component test to assert a `SessionProfile` prop is accepted/rendered as a selected build/runtime profile badge.
- Existing monitor UI reducer/ProfileBadge tests should continue to pass.
- Run the targeted monitor/client/UI tests and type-check as practical, at minimum the affected vitest files plus `pnpm type-check` if time allows.
