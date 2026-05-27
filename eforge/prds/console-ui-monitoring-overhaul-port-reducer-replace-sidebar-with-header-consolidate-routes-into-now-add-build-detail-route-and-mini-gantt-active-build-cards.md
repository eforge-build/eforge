---
title: Console UI monitoring overhaul: port reducer, replace sidebar with header, consolidate routes into Now, add build detail route and mini-Gantt active build cards
created: 2026-05-27
profile: ui
---

# Console UI monitoring overhaul: port reducer, replace sidebar with header, consolidate routes into Now, add build detail route and mini-Gantt active build cards

## Problem / Motivation

The current `packages/console-ui/` monitoring dashboard has several gaps relative to the legacy `packages/monitor-ui/` and relative to where the project is heading:

- **No per-session reducer.** `use-active-session-streams.ts` subscribes per-session to `/api/events/:runId` but retains only the snapshot events plus a capped rolling window of the last 50 live events, with no reduction. As a result, per-session `agentThreads`, `planStatuses`, `tokens`, `cost`, `cache stats`, `fileChanges`, `decisions`, and `validationCommands` are unavailable to console-ui.
- **Active build cards are text-only.** `ActiveBuildCard` shows session/run/profile/phase/agent and a "View runs" link, with no per-plan stage visualization.
- **Route surface is over-fragmented.** `now`, `queue`, `runs`, `system`, and `activity` exist as separate routes; the shell renders a left sidebar + main + bottom status strip. The list-style routes (`queue`, `runs`, `activity`) duplicate context that belongs on the Now page.
- **No build detail route.** There is no shareable, full-viewport view for a single build.
- **The legacy monitor-ui has UI primitives (`ThreadPipeline`, `SummaryCards`, bottom-panel tabs, `FailureBanner`, build search, PRD/plan-body preview) and a working session-level reducer that console-ui lacks.**

This PRD lands the visual and data-flow overhaul needed to bring console-ui to parity with monitor-ui's monitoring depth while consolidating IA around the Now page and a new build detail route, so that monitor-ui can eventually be deleted.

## Goal

Port the legacy monitor-ui session reducer into console-ui, replace the left sidebar with a top header, fold the `queue`/`runs`/`activity` list routes into the Now page, add a `/console/runs/:detailId` build detail route, and give active build cards a mini-Gantt pipeline strip — all contained to `packages/console-ui/` with no daemon HTTP API changes.

## Approach

### High-level technical decisions

- **Reduce client-side, not daemon-side (D1).** Port the legacy reducer into console-ui and reduce SSE events into `RunState` on the client. Daemon HTTP API stays unchanged. If first-paint of historical detail views is too slow, daemon-side snapshots become a follow-up PRD.
- **Reducer lives inside `packages/console-ui/`, not a shared workspace package (D2).** Port reducer code and tests directly into `src/lib/run-state/`. Monitor-ui keeps its own copy until it dies. Trade-off accepted: during the dual-ship window, a new daemon event type means two reducers to update.
- **Hook signature replacement, not addition (D3).** Replace `useActiveSessionStreams`'s return shape with `{ runState }` rather than adding a sibling hook. The 50-event rolling buffer is removed. Consumers (`ActiveBuildCard`, selectors in `src/lib/selectors/now.ts`) update to read from `runState`.
- **Route shape: `/console/runs/:detailId` (keep `/runs/` prefix) (D4).** Existing user habit / shareability — the `?session=` query param on `/console/runs` already navigates to this conceptual surface today.
- **Activity = right-side drawer; Run history = inline expand (D5).** Activity is a debugging surface (drawer is right for "overlay context" UI); run history is browsed in sequence (inline expansion keeps user on the same page). Drawer URL state via `?activity=open`.
- **Queue = display-only on Now (D6).** Daemon has no mutation endpoints; ship the visual shape here, wire actions in a follow-up PRD.
- **Bottom tab panel on detail route = parity with legacy (Log / Changes / Graph / Plan) (D7).** Use `react-resizable-panels` for resizable upper/lower split. Stub-ship option: ship initially with `Log` working and others as "Loading..." stubs.
- **Mini Gantt shape = row-per-plan with stage-colored segments (D8).** Each active build card shows one row per plan plus a PRD row when planning events exist:
  ```
  PRD   [planner ▓▓▓▓▓░] reviewer
  P01   [impl▓▓ test▓▓ rev ✓]
  P02   [impl▓░ test░░ rev░░]
  P03   ── pending
  ```
- **Header replaces sidebar; status strip removed (D9).** Top header (h-12 or so) carries logo, project repo basename, connection dot, auto-build toggle, last-update timestamp, queue-count chip, active-count chip, and right-side slot for future control-surface links. Truncation order: timestamp first, then queue/active chips.
- **Naming: `RunState` (keep monitor-ui term) (D10).** Caveat: the daemon `RunState` wire type and the console-ui reduced `RunState` have different shapes. Console-ui type lives under a different module path so import-site disambiguation works. Convention: alias the wire type at consumer sites.
- **Build detail data source: hybrid live + historical (D11).** Detail route checks whether the session ID is in `activeSessionIds`; if yes, subscribe via the live stream hook; if no, fetch `/api/run-state/:id` once and reduce. Either path yields the same `RunState`.
- **Routing approach: keep the existing minimal router (D12).** Extend `parseConsoleRoute(pathname)` / `toConsolePath(routeId)` in `src/lib/navigation.ts`. Do NOT introduce `react-router`. `ConsoleRouteId` becomes a discriminated union: `'now' | 'system' | { id: 'runDetail'; detailId: string }`.
- **shadcn/ui + Tailwind, no custom primitives (D13).** Every new component uses shadcn primitives; Tailwind classes for layout/spacing; tokens via existing `globals.css` CSS variables. Shadcn `Sheet` is the natural fit for the activity drawer.
- **Active build card click target = whole card with affordance (D14).** Clicking anywhere on the card navigates to the detail route; card includes a visible "Inspect →" affordance.
- **Heavy ported components added with their full dependency stack (D15).** Install `react-resizable-panels`, `@xyflow/react`, `@dagrejs/dagre`, `shiki`, and the missing Radix peer deps. Tabs ship in priority order: `Log` first, then `Changes`, `Graph`, `Plan`. Trade-off: bundle weight increases; mitigation is code-split the detail route via dynamic import (follow-up).
- **Animation: subtle, accessibility-respecting (D16).** Card hover lifts, drawer slide-in (200ms), inline expand (200ms), Gantt segment color transitions on stage change. All respect `prefers-reduced-motion`.

### Architecture impact

**New internal module boundary: `src/lib/run-state/`**

```
packages/console-ui/src/lib/run-state/
  index.ts                  # public exports (reducer, types, selectors)
  types.ts                  # RunState, AgentThread, DecisionPoint, etc.
  reducer.ts                # top-level reduce(state, event) dispatch
  handlers/
    handle-agent.ts
    handle-daemon.ts
    handle-decisions.ts
    handle-enqueue.ts
    handle-expedition.ts
    handle-misc.ts
    handle-plan-build.ts
    handle-plan-lifecycle.ts
    handle-planning.ts
    handle-session.ts
    handle-validation.ts
  selectors/
    summary-stats.ts        # tokens/cost/cache aggregates for SummaryCards
    plan-progress.ts        # plan status counts, current stage per plan
    stack-layers.ts         # selectStackLayersForRun port
  __tests__/
    handle-*.test.ts        # one per handler, ported from monitor-ui
    reducer.test.ts
    selectors.test.ts
```

This subsystem is **pure** (no React, no DOM, no fetch). Depends only on `@eforge-build/client` (for `EforgeEvent` types).

**`useActiveSessionStreams` hook signature changes.**

Before:
```ts
interface ActiveSessionDetail {
  sessionId: string;
  connectionStatus: ConnectionStatus;
  status: ...;
  snapshotEvents: SessionStreamSnapshot['events'];
  liveEvents: EforgeEvent[];                   // capped at 50
  liveEventCount: number;
  lastEventAt: number | null;
  error: string | null;
}
```

After:
```ts
interface ActiveSessionDetail {
  sessionId: string;
  connectionStatus: ConnectionStatus;
  status: ...;
  runState: RunState;                          // fully reduced from snapshot + live
  lastEventAt: number | null;
  error: string | null;
}
```

**`NowActiveBuildCard` selector type changes** in `src/lib/selectors/now.ts`:

```ts
interface NowActiveBuildCard {
  // existing: sessionId, runId, profile, durationMs, currentPhase, latestAgent, ...
  planProgress: Array<{
    planId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    currentStage?: PipelineStage;
    stages: Array<{ stage: PipelineStage; status: 'pending' | 'running' | 'done' }>;
  }>;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  cost: number;
  cachePercent: number;
}
```

**Data flow change.** Before: daemon SSE → `use-active-session-streams` rolling buffer → `NowActiveBuildCard` text fields (phase/agent only). After: daemon SSE → `use-active-session-streams` → reducer → `RunState` → selectors → view models → `BuildPipelineStrip` + `SummaryCards` + `ThreadPipeline`.

**Route table:**

| Before | After |
|--------|-------|
| `now` → `/console/` | `now` → `/console/` |
| `queue` → `/console/queue` | **removed** |
| `runs` → `/console/runs` | **removed (list)** |
| (none) | `runDetail` → `/console/runs/:detailId` |
| `system` → `/console/system` | `system` → `/console/system` |
| `activity` → `/console/activity` | **removed** |

**Now page IA (top-to-bottom):**

```
Header     | eforge · project repo · connection · auto-build · timestamp · [System →]
Attention  | only when failures/paused/disconnected (existing AttentionPanel)
Active     | mini-gantt cards in grid (1-3 cards)
Queue      | full-width table with display-only chips
Stack | Activity  | two-column row (stack layers left, recent activity drawer-launcher right)
Run history | top 4 collapsed, Show all ▼ expands inline with filter/search
```

**Component hierarchy diff (Now page):**

```
Before                               After
─────────────────────────────────    ─────────────────────────────────────
AttentionPanel                       AttentionPanel
ActiveBuildsGrid                     ActiveBuildsGrid
  ActiveBuildCard (text only)          ActiveBuildCard (mini Gantt strip)
QueueSnapshotCard (read-only)        QueueCard (display-only, future actions)
RecentRunsCard (top 4)               RunHistoryCard (top 4 + Show all ▼ expand)
StackSummaryCard                     [grid row] StackSummaryCard | ActivityDrawerLauncher
RecentActivityCard
```

**Shell diff:**

```
Before                                          After
─────────────────────────────────               ─────────────────────────────────────
<Sidebar /> + <main /> + <StatusStrip />        <Header /> + <main />
```

**Cross-package boundaries (unchanged):** `@eforge-build/client` (no public API changes), `packages/monitor-ui/` (no changes — ships alongside), `packages/monitor/` daemon HTTP server (no changes), `packages/engine/` (no changes), `eforge-plugin/` and `packages/pi-eforge/` (no changes). No deployment / operational changes.

### Files created

```
packages/console-ui/
  README.md                                          # new
  src/
    components/
      header/
        header.tsx                                   # replaces sidebar + status-strip
        connection-indicator.tsx
        auto-build-toggle.tsx
        project-name-chip.tsx
        control-surface-links.tsx                    # slot for future
      now/
        build-pipeline-strip.tsx                     # mini Gantt
        queue-card.tsx                               # display-only
        run-history-card.tsx                         # expanding
        activity-drawer.tsx
        activity-drawer-launcher.tsx
      run-detail/
        build-detail-view.tsx
        summary-chips.tsx
        pipeline-section.tsx
        bottom-tab-panel.tsx
      ui/
        dialog.tsx                                   # shadcn
        dropdown-menu.tsx                            # shadcn
        table.tsx                                    # shadcn
        select.tsx                                   # shadcn
        tooltip.tsx                                  # shadcn
        switch.tsx                                   # shadcn
        scroll-area.tsx                              # shadcn
        collapsible.tsx                              # shadcn
        alert-dialog.tsx                             # shadcn
        checkbox.tsx                                 # shadcn
    lib/
      run-state/
        index.ts
        types.ts
        reducer.ts                                   # ported
        format.ts                                    # ported helper
        handlers/
          handle-agent.ts                            # ported
          handle-daemon.ts                           # ported
          handle-decisions.ts                        # ported
          handle-enqueue.ts                          # ported
          handle-expedition.ts                       # ported
          handle-misc.ts                             # ported
          handle-plan-build.ts                       # ported
          handle-plan-lifecycle.ts                   # ported
          handle-planning.ts                         # ported
          handle-session.ts                          # ported
          handle-validation.ts                       # ported
          handler-types.ts                           # ported
          index.ts                                   # registry
        selectors/
          summary-stats.ts                           # ported
          plan-progress.ts
          stack-layers.ts                            # ported
        __tests__/
          handle-*.test.ts                           # × 11 (ported)
          reducer.test.ts                            # ported
          selectors.test.ts
    views/
      run-detail/
        index.ts
        run-detail-view.tsx
```

Plus ported component subdirectories pulled from monitor-ui into `packages/console-ui/src/components/`:
- `pipeline/` (thread-pipeline, plan-row, agent-detail-sheet, decision-timeline, stage-overview, activity-overlay, pipeline-colors, agent-stage-map, compute-depth-map)
- `timeline/` (timeline, event-card, timeline-controls)
- `heatmap/` (file-heatmap and sub-components)
- `graph/` (dependency-graph, dag-node, dag-edge, use-graph-layout)
- `preview/` (plan-preview-context, plan-preview-panel, plan-body-highlight, plan-metadata)
- `common/` (summary-cards, failure-banner)
- `console/` (console-panel, plan-tab)

### Files modified

```
packages/console-ui/
  package.json                                       # add deps
  src/
    app.tsx                                          # rewire routes, drop sidebar wiring
    main.tsx                                         # confirm no shell-specific bootstrap changes needed
    components/
      shell/
        console-shell.tsx                            # swap sidebar for header, drop status-strip
      now/
        active-build-card.tsx                        # add BuildPipelineStrip, whole-card click, Inspect affordance
        active-builds-grid.tsx                       # minor: pass click handler
      ui/
        index.ts                                     # export new shadcn components
    hooks/
      use-active-session-streams.ts                  # replace return shape with { runState }
    lib/
      navigation.ts                                  # remove queue/runs/activity IDs, add runDetail
      selectors/
        now.ts                                       # extend NowActiveBuildCard with planProgress/tokens/cost/cachePercent
      project-state.ts                               # unchanged, but verify
    views/
      now-dashboard.tsx                              # reorder sections; swap card components
```

### Files deleted

```
packages/console-ui/src/
  components/shell/sidebar.tsx
  components/shell/status-strip.tsx
  components/now/queue-snapshot-card.tsx
  components/now/recent-activity-card.tsx
  components/now/recent-runs-card.tsx
  components/now/metric-card.tsx                     # verify unused
  components/now/now-state-banner.tsx                # verify unused
  views/queue/                                       # entire directory
    dependency-chips.tsx
    index.ts
    queue-item-row.tsx
    queue-state-panels.tsx
    queue-status-filter.tsx
    queue-status-group.tsx
    queue-summary-cards.tsx
    queue-view.tsx
    recovery-verdict-chip.tsx
  views/activity/                                    # entire directory
    activity-event-list.tsx
    activity-event-row.tsx
    activity-toolbar.tsx
    activity-view.tsx
    index.ts
    raw-event-panel.tsx
  views/runs/                                        # bulk deletion
    runs-view.tsx
    runs-filter-bar.tsx
    runs-day-groups.tsx
    run-history-table.tsx
    active-runs-panel.tsx
  __tests__/
    queue-view.test.tsx                              # 516L
    queue-selectors.test.ts
    activity-view.test.tsx
    activity-selectors.test.ts                       # 493L
    runs-view.test.tsx
    runs-selectors.test.ts                           # if only covers list-view selectors
```

Note: activity views and selectors are partially preserved — the event-list/toolbar/raw-event-panel files get **moved** into `src/components/now/activity-drawer/` rather than deleted outright. Selectors like `classifyFamily` move to `src/components/now/activity-drawer/selectors.ts`. Test files move correspondingly.

### Files kept (from `views/runs/`) and repurposed

```
packages/console-ui/src/views/runs/                  # rename to src/views/run-detail/ or shrink
  run-detail-panel.tsx                               # may be deleted if BuildDetailView subsumes it
  run-events-preview.tsx                             # used inside Log tab fallback
  run-plans-preview.tsx                              # used inside Plan tab
  status-pill.tsx                                    # general-purpose, keep
  time-format.ts                                     # general-purpose, keep
```

### Dependency manifest changes (`packages/console-ui/package.json`)

Add:
```
"@dagrejs/dagre": "^3.0.0"
"@xyflow/react": "^12.10.2"
"react-resizable-panels": "^4.11.1"
"shiki": "^4.1.0"
"@radix-ui/react-alert-dialog": "^1.1.15"
"@radix-ui/react-checkbox": "^1.3.3"
"@radix-ui/react-collapsible": "^1.1.12"
"@radix-ui/react-dropdown-menu": "^2.x"
"@radix-ui/react-scroll-area": "^1.2.10"
"@radix-ui/react-select": "^2.x"
"@radix-ui/react-switch": "^1.2.6"
"@radix-ui/react-tooltip": "^1.2.8"
```

(Exact semver matched to monitor-ui where applicable.)

### Patterns to reuse

- Shadcn component scaffolding via `pnpm dlx shadcn@latest add <component>`.
- Region annotations (`// --- eforge:region <name> ---` / `--- eforge:endregion <name> ---`).
- `API_ROUTES` + `buildPath` from `@eforge-build/client/browser` for any new HTTP path references.
- `EforgeEvent` type imports from `@eforge-build/client/browser` — never re-define event shapes.

### Order of execution (suggested PRs / commits)

1. **Reducer port** — `src/lib/run-state/` complete with tests. Standalone PR.
2. **Hook signature change** — `use-active-session-streams.ts` returns `{ runState }`. Existing consumers updated minimally.
3. **Shell restructure** — sidebar/status-strip deletion + header.
4. **Route table reduction** — delete queue/activity views and tests; trim navigation.ts; update app.tsx.
5. **Now page rewrite** — new QueueCard (display-only), RunHistoryCard, ActivityDrawerLauncher + ActivityDrawer, BuildPipelineStrip in ActiveBuildCard.
6. **Build detail route, base** — add `runDetail` route; mount BuildDetailView with summary chips + ThreadPipeline; Log tab only.
7. **Build detail route, Changes tab** — port FileHeatmap.
8. **Build detail route, Graph tab** — port DependencyGraph + xyflow/dagre deps.
9. **Build detail route, Plan tab** — port PlanTab + PlanPreviewPanel + shiki dep.
10. **README + docs sweep** — write console-ui/README.md, update AGENTS.md mentions.

### Documentation updates

| File | What to update |
|------|----------------|
| `AGENTS.md` | Add: "The console UI (`packages/console-ui/`) is the active monitoring dashboard and uses shadcn/ui components. `packages/monitor-ui/` is the legacy implementation, retained until the console-ui port is fully baked." |
| `packages/console-ui/README.md` | Create. Sections: brief purpose, route table (`/console/`, `/console/runs/:detailId`, `/console/system`), top-level data flow (daemon SSE → reducer → views), how to add a new control surface, how to run dev (`pnpm dev:console`). |
| `docs/roadmap.md` (line 7) | No change required during this PRD; follow-up PRD that adds daemon endpoints + UI actions updates this line. |

Files that do NOT need updates: `README.md` (repo root), `CLAUDE.md`, `docs/extensions.md`, `docs/extensions-api.md`, `web/` public docs site (verify with a search before merging).

Verification step before marking PR complete: grep for `console/queue`, `console/runs`, `console/activity` across the repo to catch stale references; grep for `monitor-ui` mentions to confirm "monitor is the legacy UI" framing is consistent.

Drift-prevention: route table is defined in one place (`src/lib/navigation.ts`); console-ui README should link to `AGENTS.md` rather than duplicate convention statements; README should describe the **shape** of the IA, not the **content**.

### Assumptions and validation

**Validated (high confidence):** reducer is pure with no React/DOM imports (A1); daemon has no queue mutation endpoints (A5); shadcn primitives needed are not all installed today (A6); heavy ported components depend on libraries not in console-ui today (A7); existing console-ui test files for removed views total >1500 lines (A8).

**Medium confidence:** client-side reduction over `/api/run-state/:id` events is fast enough for acceptable first paint (A2); `subscribeWithSnapshot` reconnect pattern correctly drives the new reducer (A4); no shared `RunState` consumers outside monitor-ui (A3).

**Resolved with user:** queue mutations out of scope (B1); activity drawer state persists via `?activity=open` (B2); whole-card click with visible "Inspect →" affordance (B3); bottom `StatusStrip` removed, content absorbed into header (B4); `react-resizable-panels` adopted for detail route's bottom tab panel (B5).

**Defer-to-build validation:** bundle size after adding `@xyflow/react` + `shiki` + Radix peer deps (C1); visual hierarchy on 13" laptop (C2); `prefers-reduced-motion` respected by all new animations (C3).

### Risks

- **R1. Reducer divergence during dual-ship window** (likelihood: low; impact: medium). Mitigation: document the dual-reducer constraint in `packages/console-ui/README.md` and a comment block at the top of `src/lib/run-state/reducer.ts`. Risk evaporates when monitor-ui is killed.
- **R2. First-paint cost on detail route for long terminal sessions** (likelihood: medium; impact: low-medium). Mitigation in scope: render summary chip row as soon as `/api/run-summary/:id` resolves; render pipeline + tabs after reduction; show loading state. Mitigation deferred: daemon-side snapshot endpoint.
- **R3. SSE reconnect causing double-counted aggregates** (likelihood: low; impact: high). Mitigation: AC requires the snapshot-replay test before merge. Hook dispatches `reset → replay` on snapshot frames.
- **R4. Bundle size regression** (likelihood: high; impact: medium). Mitigation: code-split the build detail route via dynamic import so heavy deps don't load until a user opens a detail page.
- **R5. Test rewrite scope underestimate** (likelihood: medium; impact: medium). Mitigation: audit tests rather than deleting outright; move tests for selectors that move (e.g., `classifyFamily` to the activity drawer); rewrite `now-dashboard.test.tsx` and `now-selectors.test.ts` for new sections.
- **R6. Partial-apply on incremental commits** (likelihood: medium; impact: high). Mitigation: each commit in the execution order is independently `pnpm type-check` + `pnpm build` clean; hook signature change (step 2) is the boundary; plan ordering ensures consumers update in the same commit as the hook change.
- **R7. Activity drawer scroll-state lost on reload despite URL persistence** (likelihood: low; impact: low). Mitigation deferred.
- **R8. Build detail data fetch race condition (active → terminal transition)** (likelihood: low; impact: low). Mitigation: live hook preserves terminal state for one render; detail view prefers live-source `runState` while connected, falls back to fetched `runState` only when not connected.
- **R9. Header overflow on narrow viewports** (likelihood: medium; impact: low-medium). Mitigation: truncation order (timestamp first, then queue/active chips); `flex` with `min-w-0` and `truncate` on text elements; validate during dev by resizing.
- **R10. Premature deletion of monitor-ui referenced elsewhere** (out of scope; flagged for future PRD).

### Profile signal

**Recommendation: Excursion.** Broad-but-cohesive UI replatforming (~50 file changes) across reducer port, shell, routes, Now sections, and a new build detail route. Cross-plan dependencies are linear (1 → 2 → 5–9) with parallel branches (3, 4, 10 can run independently after the reducer). No subsystem requires its own planner. Not Expedition because no architectural delegation is needed; not Errand because 50+ files, multiple new subsystems, 5 user-facing surface changes, significant test rewrites.

## Scope

### In scope

All work is contained to `packages/console-ui/`. No daemon HTTP API changes. No `@eforge-build/client` changes (existing wire shapes suffice).

1. **New per-session reducer subsystem in `packages/console-ui/src/lib/run-state/`**
   - Port `packages/monitor-ui/src/lib/reducer.ts` and `src/lib/reducer/handle-*.ts` (11 handlers: agent, daemon, decisions, enqueue, expedition, misc, plan-build, plan-lifecycle, planning, session, validation).
   - Port co-located tests from `packages/monitor-ui/src/lib/reducer/__tests__/`.
   - Reshape `RunState` if appropriate — drop legacy-only fields only if confirmed unused by the new console viz; otherwise keep parity.
   - Wire reduction into `use-active-session-streams.ts` (or a sibling hook) so every active session has a fully reduced state available client-side, not just a rolling 50-event window.

2. **Console shell restructure**
   - Delete `packages/console-ui/src/components/shell/sidebar.tsx`.
   - Replace `console-shell.tsx` layout with a top `Header` (eforge logo, project repo name, connection dot, auto-build toggle, last-update timestamp, slot for future control-surface links).
   - Delete `packages/console-ui/src/components/shell/status-strip.tsx`; absorb its content (connection / queue count / active count / auto-build / last-update) into the header.

3. **Route table reduction**
   - Update `packages/console-ui/src/lib/navigation.ts`: remove route IDs `queue`, `runs` (list), `activity`; keep `now`, `system`; add `runDetail` for `/console/runs/:detailId`.
   - Update `app.tsx` router switch accordingly.
   - Delete `src/views/queue/`, `src/views/activity/`, and the list-side of `src/views/runs/` (`runs-view.tsx`, `runs-filter-bar.tsx`, `runs-day-groups.tsx`, `run-history-table.tsx`, `active-runs-panel.tsx`). Keep `run-detail-panel.tsx`, `run-events-preview.tsx`, `run-plans-preview.tsx`, `status-pill.tsx`, `time-format.ts` for the new detail route.

4. **Now page restructure** (in `src/views/now-dashboard.tsx`)
   - Layout in order: Attention → Active builds grid → read-only Queue section → Stack | Activity (two-column) → Run history (top 4 + Show all ▼ expand).
   - Replace text-only `ActiveBuildCard` with a mini-Gantt card using a new `<BuildPipelineStrip>` component (also reused by the build detail summary).
   - Replace `QueueSnapshotCard` with a richer **display-only** `QueueCard`: shows id, title, status, priority chip (non-interactive), dependency chips (non-interactive). No reorder, no priority editing, no cancel button, no `⋯` menu, no dep-editing modal.
   - Replace `RecentRunsCard` with an expanding `RunHistoryCard` that grows in place into a filterable/searchable list when `Show all ▼` is clicked.
   - Replace `RecentActivityCard` preview with a launcher that opens a right-side `ActivityDrawer`. Drawer renders the existing activity event list and toolbar from `src/views/activity/`. URL state via `?activity=open`.
   - `StackSummaryCard` and `AttentionPanel` carry over as-is.

5. **Build detail route at `/console/runs/:detailId`**
   - New `src/views/run-detail/` directory.
   - Full-viewport layout: header strip with summary chips (status, profile, tokens, cost, cache %, plan progress, duration), main pipeline Gantt (`ThreadPipeline` ported), bottom tab panel (`Log` / `Changes` / `Graph` / `Plan`) using `react-resizable-panels`.
   - Port `ThreadPipeline`, `PlanRow`, `AgentDetailSheet`, `DecisionTimeline`, `StageOverview`, `ActivityOverlay`, `pipeline-colors`, `agent-stage-map`, `compute-depth-map` from `monitor-ui/src/components/pipeline/`.
   - Port `Timeline` from `monitor-ui/src/components/timeline/`.
   - Port `FileHeatmap` from `monitor-ui/src/components/heatmap/`.
   - Port `DependencyGraph` from `monitor-ui/src/components/graph/`.
   - Port `PlanTab` and `ConsolePanel` from `monitor-ui/src/components/console/`.
   - Port `PlanPreviewPanel` from `monitor-ui/src/components/preview/`.
   - Port `SummaryCards` and `FailureBanner` from `monitor-ui/src/components/common/`.
   - Wire existing `RunDetailPanel` as the fallback for runs that have no live stream — or, if the reducer cleanly covers terminal sessions via `/api/run-state/:id`, delete `RunDetailPanel` entirely and use the same `<BuildDetailView>` for both live and terminal.

6. **Mini Gantt component (`<BuildPipelineStrip>`)**
   - New shared component in `src/components/now/build-pipeline-strip.tsx` (or `src/components/run-detail/`).
   - Reads from reduced `RunState` (`planStatuses`, `agentThreads`, `orchestration`).
   - Renders one row per plan with stage-colored segments. Compact (fits in card width); the full `ThreadPipeline` is the expanded version used on the detail route.

7. **shadcn / dependency additions to console-ui**
   - Add shadcn primitives missing today: `dialog`, `dropdown-menu`, `table`, `select`, `tooltip`, `switch`, `scroll-area`, `collapsible`, `alert-dialog`, `checkbox`.
   - Add Radix peer deps for each.
   - Add `react-resizable-panels` (for bottom tab panel).
   - Add `@xyflow/react` + `@dagrejs/dagre` (for DependencyGraph).
   - Add `shiki` (for syntax highlighting in PlanPreview / PlanTab).

### Out of scope

- **All queue mutations** (reorder, set-priority, edit-dependencies, cancel non-active items). No daemon endpoints exist; covered by `docs/roadmap.md:7`. The Now queue section ships display-only.
- **Killing `packages/monitor-ui/`.** Stays alive in parallel; deletion is a future cleanup.
- **Changes to the daemon HTTP API surface.** The reducer derives tokens/cost/cache/etc. from the existing `/api/events/:runId` SSE stream client-side.
- **Daemon-side persisted aggregates for completed sessions.** Same reasoning; client-side reduction over `/api/run-state/:id` events is the v1 approach.
- **Search across builds beyond what fits in the inline `Show all ▼` expansion.** No fuzzy/full-text search infra. Simple status / command / substring filter.
- **System route content.** The route stays as a placeholder; its content is unchanged.
- **Recovery workflow UI, planning UI, model/profile editors.** Header gets a slot but no entries land in this PRD.
- **Keyboard shortcut overhaul.** May add Esc to close drawer; no shortcut system.
- **Mobile responsive design.** Legacy monitor isn't responsive either; deferring.
- **Theming / branding refresh beyond logo placement.** Existing globals.css colors carry over.

### Natural boundaries

- The reducer port is self-contained: pure functions over events → state. Can be merged and tested without any UI changes consuming it.
- The shell restructure (sidebar removal, header, status-strip absorption) is decoupled from the reducer.
- Each route deletion can be its own commit; folding the destination card onto Now is the paired commit.
- The build detail route can ship initially with placeholder bottom tabs and gain Log/Changes/Graph/Plan progressively.

### Roadmap alignment

- `docs/roadmap.md:7` — "Queue reordering & priority - MCP tool and web UI controls for changing priority on queued PRDs at runtime" — **this PRD does not satisfy that item**. It lands the visual shape that a follow-up PRD will wire to new daemon endpoints.
- Other roadmap items (overseer, cross-project analytics, extension policy gates) are unrelated.

## Acceptance Criteria

### Reducer subsystem

- The directory `packages/console-ui/src/lib/run-state/` exists with `reducer.ts`, `types.ts`, a `handlers/` subdirectory containing 11 handler files, and a `selectors/` subdirectory.
- `pnpm --filter @eforge-build/console-ui test` exits 0 with at least one passing test per ported handler file.
- A unit test asserts that reducing a sequence of `agent:start` + `agent:result` events produces an `AgentThread` with populated `startedAt`, `durationMs`, `inputTokens`, `outputTokens`, `costUsd`, `numTurns`, and `model` fields.
- A unit test asserts that reducing a sequence of plan lifecycle events transitions `planStatuses[planId]` through `pending` → `running` → `completed` in order.
- A unit test asserts that reducing two `agent:result` events accumulates `tokensIn`, `tokensOut`, `cacheRead`, `cacheCreation`, and `totalCost` to the sum of both event payloads.
- A unit test asserts that reducing a sequence ending in `session:end` with `result.status === 'failed'` produces `RunState.resultStatus === 'failed'`.
- A unit test asserts that re-receiving a `stream:hello` snapshot frame resets `RunState` and replays the snapshot events without double-counting tokens or cost.

### Console shell restructure

- The file `packages/console-ui/src/components/shell/sidebar.tsx` does not exist on disk.
- The file `packages/console-ui/src/components/shell/status-strip.tsx` does not exist on disk.
- Rendering `<ConsoleShell />` produces a DOM tree whose first child is a top header element (not a left sidebar element).
- The rendered header contains the eforge logo SVG.
- The rendered header contains the project repo basename.
- The rendered header contains a connection-status indicator.
- The rendered header contains an auto-build toggle control.
- The rendered header contains a last-update timestamp string.
- The rendered header contains a queue-count chip.
- The rendered header contains an active-count chip.
- No DOM element with `role="navigation"` and a vertical orientation appears in the rendered shell.
- No footer or bottom status strip is rendered in the shell.
- All tests in `packages/console-ui/src/__tests__/` that previously asserted sidebar or status-strip contents pass after being updated to assert header contents, or are deleted if no longer relevant.

### Route table changes

- The exported `consoleRouteOrder` array in `packages/console-ui/src/lib/navigation.ts` contains exactly the IDs `now`, `runDetail`, `system` in that order.
- Calling `parseConsoleRoute('/console/queue')` returns `now`.
- Calling `parseConsoleRoute('/console/runs')` returns `now`.
- Calling `parseConsoleRoute('/console/runs/abc123')` returns an object whose `id === 'runDetail'` and whose `detailId === 'abc123'`.
- Calling `parseConsoleRoute('/console/activity')` returns `now`.
- Calling `parseConsoleRoute('/console/system')` returns `system`.
- Visiting `/console/runs/abc123` in the rendered app mounts a `BuildDetailView` component instead of the runs list.

### Now page sections and order

- The Now page renders, in this top-to-bottom order: `AttentionPanel` (when `attentionItems.length > 0`), `ActiveBuildsGrid`, `QueueCard` (display-only), a two-column row containing `StackSummaryCard` and `ActivityDrawerLauncher`, and `RunHistoryCard`.
- The source file `packages/console-ui/src/components/now/recent-activity-card.tsx` does not exist on disk.
- The source file `packages/console-ui/src/components/now/queue-snapshot-card.tsx` does not exist on disk.
- The previous text-only `ActiveBuildCard` source file no longer exists in its previous form (it is either deleted or rewritten to include the mini-Gantt strip).
- The Now page contains zero references to the removed components in its imports.

### Mini Gantt active build card

- Each rendered `ActiveBuildCard` contains a `BuildPipelineStrip` element with one row per plan in the reduced `RunState.orchestration.plans` array, plus a PRD row when planning events exist.
- Each `BuildPipelineStrip` row renders stage segments whose colors are driven by `planStatuses[planId]` and `agentThreads` for that plan.
- Clicking anywhere on the `ActiveBuildCard` invokes the navigation handler with the path `/console/runs/{sessionId}`.
- Hovering an `ActiveBuildCard` shows the cursor as `pointer`.
- Each `ActiveBuildCard` renders a visible "Inspect →" affordance.

### Queue card (display-only)

- The Now `QueueCard` renders each queue item as a row containing id, title, status, a non-interactive priority chip, and non-interactive dependency chips.
- The `QueueCard` contains zero buttons, dropdowns, dialogs, or drag handles.
- The `QueueCard` does not import any daemon mutation endpoints.
- The `QueueCard` issues zero `fetch` or `POST` requests during render or any user interaction.

### Activity drawer

- The Now `ActivityDrawerLauncher` renders a button labeled "Open activity drawer" (or equivalent) plus the most recent 3 activity entries as a preview.
- Clicking the launcher opens a shadcn `Sheet` from the right side of the viewport.
- Opening the drawer sets the URL query parameter to include `activity=open`.
- Pressing Escape closes the drawer and removes the `activity` query parameter from the URL.
- Reloading the page while `?activity=open` is present re-opens the drawer to its open state.
- The opened drawer renders the same event list and toolbar previously shown by the `/console/activity` route.

### Run history inline expansion

- The Now `RunHistoryCard` initially renders at most 4 rows of run history.
- The card contains a `Show all ▼` button.
- Clicking `Show all ▼` expands the card in place and reveals a filter bar with `status`, `command`, and `search` controls plus a scrollable list of all runs.
- Clicking `Hide ▲` (or equivalent collapse control) collapses back to 4 rows.
- Each row is clickable and navigates to `/console/runs/{detailId}` on click.

### Build detail route

- Visiting `/console/runs/{detailId}` for an active session renders, in top-to-bottom order: a summary chip row, a `ThreadPipeline` pipeline visualization, a resizable bottom tab panel.
- The summary chip row displays six chips: `status`, `profile`, `tokens` (input/output with cache %), `cost`, `plan progress`, and `duration`.
- The bottom tab panel uses `react-resizable-panels` for the upper/lower split.
- The bottom tab panel exposes four tabs labeled `Log`, `Changes`, `Graph`, `Plan`.
- The `Log` tab renders the ported `Timeline` component with the session's events.
- The `Changes` tab renders the ported `FileHeatmap` when `runState.fileChanges.size > 0`, otherwise renders an empty-state message.
- The `Graph` tab is disabled when `runState.earlyOrchestration` has no dependency edges, otherwise renders the ported `DependencyGraph`.
- The `Plan` tab is disabled when `runState.earlyOrchestration` is null, otherwise renders the ported `PlanTab`.
- The browser back button on the detail route returns to `/console/` and restores the Now page state.
- Visiting `/console/runs/{detailId}` for a terminal session fetches `/api/run-state/:id` once, reduces the events through the new reducer, and renders the same surfaces with `isComplete === true`.

### Hook signature change

- `useActiveSessionStreams` returns sessions whose detail shape includes a `runState` field of the new reduced type.
- The returned session detail shape no longer includes `snapshotEvents`, `liveEvents`, or `liveEventCount` fields.
- The source file for `ActiveBuildCard` no longer contains references to `liveEvents` or `snapshotEvents`.
- The source file for the `selectNowActiveBuildCards` selector no longer contains references to `liveEvents` or `snapshotEvents`.

### Dependency additions

- `packages/console-ui/package.json` declares a dependency on `react-resizable-panels`.
- `packages/console-ui/package.json` declares a dependency on `@xyflow/react`.
- `packages/console-ui/package.json` declares a dependency on `@dagrejs/dagre`.
- `packages/console-ui/package.json` declares a dependency on `shiki`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-dropdown-menu`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-select`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-tooltip`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-switch`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-scroll-area`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-collapsible`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-alert-dialog`.
- `packages/console-ui/package.json` declares a dependency on `@radix-ui/react-checkbox`.
- `packages/console-ui/src/components/ui/dialog.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/dropdown-menu.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/table.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/select.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/tooltip.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/switch.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/scroll-area.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/collapsible.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/alert-dialog.tsx` exists as a shadcn wrapper.
- `packages/console-ui/src/components/ui/checkbox.tsx` exists as a shadcn wrapper.

### Non-regression

- `pnpm type-check` exits 0 in the workspace root.
- `pnpm build` exits 0 in the workspace root.
- `pnpm test` exits 0 in the workspace root.
- The legacy `/monitor/` URL continues to render the monitor-ui dashboard with no visible regressions in its sidebar, header, pipeline view, or bottom tabs.
- The daemon HTTP API endpoints listed in `packages/client/src/routes.ts` are unchanged with no additions, removals, or wire-shape changes.

### Documentation

- `AGENTS.md` is updated to reflect the new console-ui route table (`now`, `runDetail`, `system`) if it previously referenced the removed routes.
- `packages/console-ui/README.md` is created with a brief overview of the new IA: top header, Now monitoring page, build detail route, future control surfaces under `System`.
- The console-ui region annotations (`// --- eforge:region ... ---` comments) for deleted routes are removed from `app.tsx`.
