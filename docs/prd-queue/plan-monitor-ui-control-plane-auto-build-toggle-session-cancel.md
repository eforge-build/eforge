---
title: Plan: Monitor UI Control Plane — Auto-build Toggle + Session Cancel
created: 2026-03-23
status: pending
---

# Monitor UI Control Plane — Auto-build Toggle + Session Cancel

## Problem / Motivation

The monitor UI is currently a read-only dashboard. The daemon server already has control endpoints (`POST /api/auto-build`, `POST /api/cancel/:sessionId`) but the UI doesn't expose them. This is the first step toward the "Web UI control plane" roadmap item — adding the two simplest controls that require zero backend changes.

## Goal

Expose auto-build toggling and session cancellation in the monitor UI, leveraging existing daemon API endpoints to turn the dashboard into an interactive control plane.

## Approach

### API functions — `src/monitor/ui/src/lib/api.ts`

Add three functions and one type:

- `AutoBuildState` interface: `{ enabled: boolean; watcher: { running: boolean; pid: number | null; sessionId: string | null } }`
- `fetchAutoBuild(): Promise<AutoBuildState | null>` — GET, returns `null` on 503 (daemon not active)
- `setAutoBuild(enabled: boolean): Promise<AutoBuildState | null>` — POST, returns `null` on 503
- `cancelSession(sessionId: string): Promise<{ status: string; sessionId: string } | null>` — POST, returns `null` on 503/404

### Auto-build hook — `src/monitor/ui/src/hooks/use-auto-build.ts` (new file)

`useAutoBuild()` hook encapsulating state + polling + toggle:
- Polls `fetchAutoBuild()` every 5s (matches queue poll cadence)
- Returns `{ state: AutoBuildState | null, toggling: boolean, toggle: () => void }`
- `state === null` means daemon not active → consumers hide controls
- `toggling` disables button during POST to prevent double-clicks

### Wire into App — `src/monitor/ui/src/app.tsx`

- Call `useAutoBuild()` at component top
- Pass `autoBuildState`, `autoBuildToggling`, `onToggleAutoBuild` to `Header`
- Pass `daemonActive={autoBuildState !== null}` to `Sidebar`

### Auto-build toggle — `src/monitor/ui/src/components/layout/header.tsx`

New props: `autoBuildState`, `autoBuildToggling`, `onToggleAutoBuild`

Render (when `autoBuildState !== null`):
- Small button left of connection status
- Green dot when enabled, dim dot when disabled
- "Auto-build" label
- `disabled` while `toggling`
- Title tooltip describes current state

### Cancel button — `src/monitor/ui/src/components/layout/sidebar.tsx`

New prop on `Sidebar`: `daemonActive: boolean`

In `SessionItem`, when `group.status === 'running' && group.isSession && daemonActive`:
- Render a small `Square` icon button (stop symbol) from lucide-react
- `onClick` with `e.stopPropagation()` (parent div is clickable for session selection)
- Calls `cancelSession(group.key)` then triggers sidebar refetch
- Red hover state for visual warning
- Title tooltip: "Cancel this session"

### Error handling

| Scenario | Behavior |
|----------|----------|
| Daemon not active (503) | `state` is null → toggle hidden, cancel buttons hidden |
| Daemon stops while UI open | Next poll (5s) sets `state` to null → controls disappear |
| Daemon starts after UI load | Next poll (5s) picks up state → controls appear |
| Cancel a finished session (404) | Returns null → no-op, sidebar refreshes naturally |
| Network error on toggle | Catch resets `toggling` to false, state unchanged, user retries |

### Orthogonality note

The pending PRD `plan-add-formatter-enqueue-visibility-to-monitor.md` touches different areas (recorder, reducer, event-card) and is orthogonal — no conflicts expected.

## Scope

**In scope:**
- Auto-build toggle in the monitor header
- Session cancel button in the monitor sidebar
- API client functions for the two existing daemon endpoints
- Polling-based state synchronization (5s interval)
- Graceful handling of daemon unavailability (503)

**Out of scope:**
- Backend/daemon changes (all endpoints already exist)
- Any other control plane features beyond toggle and cancel

### Files modified

| File | Action |
|------|--------|
| `src/monitor/ui/src/lib/api.ts` | Add 3 functions + 1 type |
| `src/monitor/ui/src/hooks/use-auto-build.ts` | New file |
| `src/monitor/ui/src/components/layout/header.tsx` | Add toggle UI + new props |
| `src/monitor/ui/src/components/layout/sidebar.tsx` | Add cancel button + new prop |
| `src/monitor/ui/src/app.tsx` | Wire hook, pass props |

## Acceptance Criteria

1. `pnpm type-check` passes with no type errors.
2. `pnpm build` produces a clean build.
3. **Auto-build toggle**: Start daemon (`pnpm dev -- daemon start`), open monitor, verify toggle appears in header. Click it, verify state changes. Stop daemon, verify toggle disappears within 5s.
4. **Cancel button**: Start a build, verify cancel button appears on running session in sidebar. Click it, verify session cancels. Verify button doesn't appear on completed/failed sessions.
5. **Non-daemon mode**: Run `pnpm dev -- build --foreground`, verify neither toggle nor cancel buttons appear (503 handling).
