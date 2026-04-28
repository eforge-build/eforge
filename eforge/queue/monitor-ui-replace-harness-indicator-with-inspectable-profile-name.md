---
title: Monitor UI: Replace harness indicator with inspectable profile name
created: 2026-04-28
---

# Monitor UI: Replace harness indicator with inspectable profile name

## Problem / Motivation

The session header in the monitor UI still renders the legacy single-backend label (`claude-sdk` / `pi`) inherited from when each build had one backend. That concept is gone: a build now uses a **profile**, and a profile may declare **multiple agent runtimes** (e.g., one role on `claude-sdk`, another on `pi`). Showing one harness name is misleading because it picks whichever ran first.

The user wants two changes:

1. The session header should show the **profile name** that produced this build.
2. That profile badge should be **inspectable** — clicking it surfaces the profile's config so you can see what runtimes/agents were configured.

This must work for live sessions and for replays of completed sessions, so the profile metadata has to travel through the event stream rather than depending on the current filesystem.

## Goal

Replace the misleading single-harness indicator in the monitor UI session header with a clickable profile badge that opens a slide-over inspector revealing the profile's full config (agent runtimes, default runtime, agent overrides, raw YAML), and propagate the profile metadata through the event stream so it works for both live sessions and historical replays.

## Approach

Emit a new `session:profile` engine event carrying `{ profileName, source, scope, config }` and let it flow through the same path as every other event. The reducer caches it on `RunState`; the SummaryCards renders a clickable badge; clicking opens a slide-over Sheet (existing shadcn pattern from `recovery/sidecar-sheet.tsx`) that pretty-prints the profile config.

Drop the dead `harness` field on `RunState`/`SummaryCards`, the dead `plan:profile` event handling in `db.ts` and the timeline card, and the dormant `ProfileHeader` in `thread-pipeline.tsx` (it consumes a different `ProfileInfo` shape from the removed `plan:profile` event and is currently always rendered against `null`). Drop `SessionMetadata.backend` — `baseProfile` replaces it.

### Files to modify

#### 1. Engine — define and emit `session:profile`

**`packages/engine/src/events.ts`** (line 146 union)
- Add: `| { type: 'session:profile'; profileName: string | null; source: 'local' | 'user-local' | 'missing' | 'none'; scope: 'project' | 'user' | null; config: unknown | null }`. The `config` is the parsed YAML (a `PartialEforgeConfig`) — typed as `unknown` so the event surface stays loose, like other config-bearing events.

**`packages/engine/src/config.ts`** (`loadConfig`, around line 912–928)
- Extend `loadConfig`'s return type with `profile: { name: string | null; source: ActiveProfileSource; scope: 'project' | 'user' | null; config: PartialEforgeConfig | null }`. Reuse the existing `resolveActiveProfileName` + `loadProfile` calls already inside `loadConfig` — just thread the data out.

**`packages/engine/src/eforge.ts`** (`EforgeEngine.create` line 165, plus each runX entry point)
- Capture the new `profile` field on the engine instance (alongside `configWarnings`).
- In every async generator entry point (`compile` line 220, the `build` runners, `runQueue` line 1250, recovery runners) emit `session:profile` *before* the existing `config:warning` loop so it lands as the first non-envelope event. For queue mode where the engine itself emits `session:start` (lines 947, 1361, 1609), emit `session:profile` immediately after that.

#### 2. Daemon DB — read the new event

**`packages/monitor/src/db.ts`**
- SQL `getSessionMetadataEvents` (line 211): replace `'plan:profile'` with `'session:profile'`.
- `getSessionMetadataBatch` (line 312–355): drop the legacy `BUILTIN_PROFILES` filtering and the `agent:start → backend` branch. New mapping: when `row.type === 'session:profile'` and `meta.baseProfile === null`, set `meta.baseProfile = data.profileName`. Remove `meta.backend` from the result shape.

#### 3. Client types — drop `backend`, bump version

**`packages/client/src/types.ts`** (line 45)
- `SessionMetadata`: keep `planCount`, `baseProfile`; remove `backend`.

**`packages/client/src/api-version.ts`** (line 17)
- Bump `DAEMON_API_VERSION` from `8` to `9` (removing a required response field is breaking).

#### 4. Monitor UI — types, reducer, components

**`packages/monitor-ui/src/lib/types.ts`** (lines 63–79)
- Replace the dormant `ProfileInfo`/`ProfileConfig` types with a single `SessionProfile` shape that mirrors the event payload: `{ profileName: string | null; source: 'local' | 'user-local' | 'missing' | 'none'; scope: 'project' | 'user' | null; config: unknown | null }`.
- `SessionMetadata`: drop `harness`, keep `baseProfile`.

**`packages/monitor-ui/src/lib/reducer.ts`**
- Drop `harness: string | null` from `RunState` (lines 83, 110, 144, 302, 439) and the `agent:start → state.harness` branch (lines 298–303). The per-thread `AgentThread.harness` stays — it is rendered in the pipeline tooltip.
- Replace `profileInfo: ProfileInfo | null` with `profile: SessionProfile | null` and add a handler: `if (event.type === 'session:profile') state.profile = { ...event };`.
- Remove the `ProfileHeader` rendering and props in `thread-pipeline.tsx` (lines 187–227, 484, 491, 597, 600, 606–608).

**`packages/monitor-ui/src/components/common/summary-cards.tsx`**
- Replace `harness?: string | null` (line 23) with `profile?: SessionProfile | null`.
- Where the harness span is rendered (line 75), render `<ProfileBadge profile={profile} />` if `profile?.profileName` is set; otherwise render nothing.

**New: `packages/monitor-ui/src/components/profile/profile-badge.tsx`**
- Click-to-open Sheet, modeled on `components/recovery/sidecar-sheet.tsx` (slide-over pattern).
- Trigger: a `Badge` component with the profile name (subtle outline styling matching existing chips).
- `SheetContent` body — **structured sections plus a collapsible raw YAML panel**:
  - Header: profile name + source/scope sub-badges (e.g., `local · project`).
  - **Agent runtimes**: list of entries from `config.agentRuntimes`, each showing name, harness, and (if present) `pi.provider` / `claudeSdk` flags.
  - **Default runtime**: `config.defaultAgentRuntime` if present.
  - **Agents**: sections for `models`, `tiers`, `roles` (whichever are present), each row showing the override (`{tier|role}: model=…, agentRuntime=…, effort=…`).
  - **Extends**: if `config.extends` is set, show it.
  - **Raw YAML** (collapsed by default): a `Collapsible` (already in `components/ui/collapsible.tsx`) wrapping a syntax-highlighted code block. Use `shiki` (already a `monitor-ui` dep) with the `yaml` grammar. Add `yaml` (the npm `yaml` parser package — already used elsewhere via the engine; if not present in `monitor-ui`'s deps, add it) to dump the config object back to YAML for display. Keeps arbitrary/unknown fields visible without the structured renderer needing to know about them.
- If `config` is null (e.g., `source === 'none'` or `'missing'`), render a one-line note instead of the sections.

**`packages/monitor-ui/src/app.tsx`** (line 336)
- Replace `harness={runState.harness}` with `profile={runState.profile}`.

#### 5. Sidebar — keep, simplify

**`packages/monitor-ui/src/components/layout/sidebar.tsx`** (lines 34–38, 100–110)
- The badge already renders `metadata.baseProfile` and falls back gracefully for arbitrary names. Leave it; the daemon change will start populating `baseProfile` for every build (not just builds that extend a builtin).
- Optional cleanup: drop the hardcoded `profileBadgeClasses` map for `errand`/`excursion`/`expedition`. Skip in this pass to keep the change focused.

#### 6. Cleanup of dead profile event surface

- **`packages/monitor-ui/src/components/timeline/event-card.tsx`** (lines 40, 53, 133–154): drop the three `plan:profile` branches — the engine no longer emits this type.
- The new event `session:profile` needs no timeline card unless we want one; skip for now (it's already surfaced in the header).

### Critical files

- `packages/engine/src/events.ts`
- `packages/engine/src/config.ts`
- `packages/engine/src/eforge.ts`
- `packages/monitor/src/db.ts`
- `packages/client/src/types.ts`
- `packages/client/src/api-version.ts`
- `packages/monitor-ui/src/lib/types.ts`
- `packages/monitor-ui/src/lib/reducer.ts`
- `packages/monitor-ui/src/components/common/summary-cards.tsx`
- `packages/monitor-ui/src/components/profile/profile-badge.tsx` (new)
- `packages/monitor-ui/src/app.tsx`
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx`
- `packages/monitor-ui/src/components/timeline/event-card.tsx`

### Reuse

- `loadProfile` / `resolveActiveProfileName` (`packages/engine/src/config.ts:1194,1262`) — already invoked inside `loadConfig`; just expose the result.
- `Sheet` / `SheetContent` (`packages/monitor-ui/src/components/ui/sheet.tsx`, used by `recovery/sidecar-sheet.tsx`) — pattern for the inspector.
- `Badge` (`packages/monitor-ui/src/components/ui/badge.tsx`) — already used in sidebar for the profile chip.

## Scope

### In scope

- New `session:profile` engine event type and its emission from every engine entry point (`compile`, build runners, `runQueue`, recovery runners).
- Extending `loadConfig` to return profile metadata (`name`, `source`, `scope`, `config`).
- Capturing profile data on the `EforgeEngine` instance.
- Daemon DB update: replace `plan:profile` with `session:profile`, drop `BUILTIN_PROFILES` filtering and the `agent:start → backend` branch, populate `baseProfile` from the new event, remove `backend` from the metadata shape.
- Removing `backend` from `SessionMetadata` in `packages/client/src/types.ts`.
- Bumping `DAEMON_API_VERSION` from `8` to `9`.
- Replacing `ProfileInfo`/`ProfileConfig` types with `SessionProfile` in monitor UI types.
- Reducer: drop `RunState.harness` and the `agent:start → state.harness` branch; replace `profileInfo` with `profile`; add `session:profile` handler.
- `SummaryCards`: swap `harness` prop for `profile`, render `<ProfileBadge>` when present.
- New `profile-badge.tsx` component (Sheet-based inspector with structured sections + collapsible raw YAML using `shiki` + `yaml`).
- `app.tsx`: pass `profile` instead of `harness`.
- Removing the dormant `ProfileHeader` rendering and props in `thread-pipeline.tsx`.
- Removing the three `plan:profile` branches from `event-card.tsx`.
- Adding the `yaml` npm package to `monitor-ui`'s deps if not already present.

### Out of scope

- Adding a timeline card for the new `session:profile` event.
- Cleaning up the hardcoded `profileBadgeClasses` map (`errand`/`excursion`/`expedition`) in `sidebar.tsx` — explicitly skipped to keep the change focused.
- Backfill or fallback derivation of profile metadata from `agent:start.harness` for historical sessions — historical sessions stored before this change will simply show no profile chip.

## Acceptance Criteria

1. `pnpm type-check` and `pnpm test` from repo root pass.
2. Running the eforge daemon and enqueueing a build under a non-builtin profile (e.g., `claude-sdk-opus-xhigh-review` from `eval/eforge/profiles/`):
   - The sidebar session row badge shows the profile name.
   - The session header shows the profile badge in place of the old harness label.
   - Clicking the badge opens a Sheet listing the agent runtimes (`default → claude-sdk`), default runtime, and agent overrides matching the YAML.
3. Repeating with `mixed-opus-kimi-evaluator.yaml`:
   - Both `default` and `pi-kimi` runtimes are listed in the inspector.
   - The per-agent harness chip in the pipeline tooltip still differentiates rows.
4. Reloading a completed historical session (one stored before this change):
   - The profile badge is absent (no `session:profile` event).
   - The sidebar row shows no profile chip.
   - The header does not crash and renders normally without the chip.
   - No fallback derivation from `agent:start.harness` occurs.
5. Restarting the daemon after the version bump: the API version mismatch error fires for any stale clients (proving the version bump took effect).
6. The `session:profile` event is emitted as the first non-envelope event in async generator entry points (or immediately after `session:start` in queue mode where the engine itself emits `session:start`), preceding the existing `config:warning` loop.
7. The `RunState.harness` field, the `agent:start → state.harness` reducer branch, the `ProfileHeader` rendering and props in `thread-pipeline.tsx`, the three `plan:profile` branches in `event-card.tsx`, the `BUILTIN_PROFILES` filtering and `agent:start → backend` branch in `db.ts`, and `SessionMetadata.backend` are all removed.
8. The per-thread `AgentThread.harness` is preserved and continues to render in the pipeline tooltip.
9. The Profile inspector Sheet renders structured sections (header with profile name + source/scope sub-badges, agent runtimes, default runtime, agents [`models`/`tiers`/`roles` as present], extends) plus a collapsible raw YAML panel (collapsed by default, syntax-highlighted via `shiki` with the `yaml` grammar, content produced by dumping the config via the `yaml` package).
10. When `config` is null (e.g., `source === 'none'` or `'missing'`), the inspector renders a one-line note instead of the structured sections.
