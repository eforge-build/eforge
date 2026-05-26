---
id: plan-03-shell-now-queue-system-status
name: Shell, Now, Queue, and System Status Consolidation
branch: polish-console-ui-state-branding-density-naming-and-theme-tokens/plan-03-shell-now-queue-system-status
---

# Shell, Now, Queue, and System Status Consolidation

## Architecture Context

The footer status strip is the single always-visible daemon status surface. Now and Queue pages consume selector output and avoid duplicating the same status facts in page cards. System owns daemon telemetry details such as subscribers, uptime, and scheduler limit.

## Implementation

### Overview

Remove redundant Now status cards, make the footer status strip canonical, reduce Queue density, and move daemon telemetry to the System Daemon section.

### Key Decisions

1. `StatusStrip` imports and consumes `selectNowStatusSummary` so footer status and Now model math share one selector.
2. `Sidebar` keeps the connection dot always visible but hides the `Connected` word only for the connected state; disconnected/connecting labels remain visible.
3. `ActiveBuildsGrid` returns `null` when there are no active cards, eliminating an empty `Active builds` section and heading.
4. Queue keeps status grouping as the primary organization and removes the duplicate attention section.
5. System receives `ConsoleProjectState` from the route wrapper so Daemon telemetry can render from existing heartbeat/liveness state without new daemon routes.

## Scope

### In Scope

- Delete `components/now/now-status-overview.tsx` and remove `NowStatusOverview` imports/usages.
- Remove the Now dashboard metric row and use `space-y-4` vertical rhythm at the page root.
- Make `ActiveBuildsGrid` return `null` for an empty `cards` prop.
- Update `StatusStrip` to use `selectNowStatusSummary`, tokenized status colors, and last-update relative time plus absolute timestamp.
- Update `Sidebar` to use tokenized colors and hide visible `Connected` text when `connectionStatus === 'connected'`.
- Remove Queue's `Needs Attention`/`Attention` section and keep status groups.
- Reduce Queue summary cards to Total, Running, Pending, and Failed.
- Remove the Queue header chip text `read-only view` while retaining the read-only boundary alert sentence.
- Render `RecoveryVerdictChip` inline for failed queue rows with a recovery verdict.
- Remove all `text-[10px]` usages in touched shell, Now, and Queue files.
- Pass `projectState` into the System view content and render Subscribers, Uptime, and Scheduler limit rows in the Daemon section when present.

### Out of Scope

- Runs filters/day grouping; implemented in plan 04.
- System model provider disclosure; implemented in plan 05.
- Activity raw JSON panel; implemented in plan 05.
- Source-grep theme guard; implemented in plan 05 after all source violations are removed.

## Files

### Delete

- `packages/console-ui/src/components/now/now-status-overview.tsx` — redundant 9-card status surface.

### Modify

- `packages/console-ui/src/views/now-dashboard.tsx` — remove status overview import/render and normalize spacing.
- `packages/console-ui/src/components/now/active-builds-grid.tsx` — return `null` when `cards.length === 0` and remove empty heading/section.
- `packages/console-ui/src/components/now/attention-panel.tsx` — consume deduplicated labels and remove child margin patterns if needed.
- `packages/console-ui/src/components/now/queue-snapshot-card.tsx` — consume normalized queue labels and avoid duplicating failed PRD wording.
- `packages/console-ui/src/components/now/recent-runs-card.tsx` — consume normalized run labels.
- `packages/console-ui/src/components/now/stack-summary-card.tsx` — consume normalized PRD labels if plan 02 exposes them.
- `packages/console-ui/src/components/shell/status-strip.tsx` — use `selectNowStatusSummary`, token classes, relative and absolute last-update text.
- `packages/console-ui/src/components/shell/sidebar.tsx` — use token classes and hide connected label text.
- `packages/console-ui/src/views/queue/queue-view.tsx` — remove attention section and header chip.
- `packages/console-ui/src/views/queue/queue-summary-cards.tsx` — render exactly four summary cards and use `text-xs`.
- `packages/console-ui/src/views/queue/queue-item-row.tsx` — inline `RecoveryVerdictChip`, use normalized labels, and replace `text-[10px]` with `text-xs`.
- `packages/console-ui/src/views/queue/recovery-verdict-chip.tsx` — replace `text-[10px]` with `text-xs`.
- `packages/console-ui/src/views/queue/dependency-chips.tsx` — replace `text-[10px]` with `text-xs`.
- `packages/console-ui/src/views/queue/queue-status-group.tsx` — replace `text-[10px]` with `text-xs` and use parent spacing.
- `packages/console-ui/src/views/system/system-configuration-view.tsx` — pass `projectState` to content.
- `packages/console-ui/src/views/system/system-view-content.tsx` — pass `projectState` to `DaemonSection`.
- `packages/console-ui/src/views/system/daemon-section.tsx` — render Subscribers, Uptime, and Scheduler limit rows from `selectNowStatusSummary`.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — assert empty `ActiveBuildsGrid` renders nothing.
- `packages/console-ui/src/__tests__/console-shell.test.tsx` — assert connected sidebar lacks visible `Connected` and disconnected sidebar shows `Disconnected`.
- `packages/console-ui/src/__tests__/queue-view.test.tsx` — assert no attention heading, four summary cards, and retained read-only alert text.
- `packages/console-ui/src/__tests__/system-view.test.tsx` or existing System tests — assert Daemon telemetry rows render when state has those values.

## Verification

- [ ] `packages/console-ui/src/components/now/now-status-overview.tsx` no longer exists.
- [ ] `packages/console-ui/src/views/now-dashboard.tsx` does not import `NowStatusOverview`.
- [ ] `<ActiveBuildsGrid cards={[]} />` renders no section, no heading, and no text content.
- [ ] `Sidebar` with `connectionStatus="connected"` does not contain visible text `Connected`.
- [ ] `Sidebar` with `connectionStatus="disconnected"` contains visible text `Disconnected`.
- [ ] `StatusStrip` imports and consumes `selectNowStatusSummary`.
- [ ] `StatusStrip` renders a relative last-update label and an absolute timestamp when an update timestamp is present.
- [ ] The System Daemon section renders Subscribers, Uptime, and Scheduler limit rows when project state provides those values.
- [ ] Queue view renders no section heading `Needs Attention` or `Attention`.
- [ ] Queue view renders exactly four summary cards labeled Total, Running, Pending, and Failed.
- [ ] Queue view renders no Waiting, With deps, Recovery verdict, or Recovery pending summary card.
- [ ] Queue view retains the text `This is a read-only view. Queue operations are not available in the Console.`.
- [ ] `packages/console-ui/src/components/shell/sidebar.tsx` and `status-strip.tsx` contain no `#67f553` string.
- [ ] `pnpm --filter @eforge-build/console-ui test now-dashboard console-shell queue-view system` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.