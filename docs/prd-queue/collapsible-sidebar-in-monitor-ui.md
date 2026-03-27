---
title: Collapsible Sidebar in Monitor UI
created: 2026-03-27
status: pending
---

# Collapsible Sidebar in Monitor UI

## Problem / Motivation

The monitor web UI has a fixed 280px left sidebar that always consumes space from the build detail view. When monitoring a single active build, this permanently visible sidebar wastes valuable screen real estate that could be used for the build output.

## Goal

Allow users to collapse and expand the sidebar via a toggle button in the header, giving the build detail view the full viewport width when the sidebar is not needed.

## Approach

Add a `sidebarCollapsed` boolean state in `app.tsx` and thread it through to `AppLayout` and `Header`. The sidebar collapse is achieved by toggling the CSS grid column definition between `280px` and `0px`, with a smooth CSS transition on the change. A toggle button using lucide icons (`PanelLeftClose` / `PanelLeft`) is placed in the header next to the "eforge" logo so it remains accessible regardless of sidebar state.

### File changes

1. **`src/monitor/ui/src/app.tsx`**
   - New state: `const [sidebarCollapsed, setSidebarCollapsed] = useState(false)`
   - Pass `sidebarCollapsed` and `onToggleSidebar` to `AppLayout`
   - Pass `sidebarCollapsed` and `onToggleSidebar` to `Header`

2. **`src/monitor/ui/src/components/layout/app-layout.tsx`**
   - Accept new props: `sidebarCollapsed: boolean`
   - Change grid from static `grid-cols-[280px_1fr]` to dynamic via `style` prop:
     ```
     gridTemplateColumns: sidebarCollapsed ? '0px 1fr' : '280px 1fr'
     ```
   - Add `transition-[grid-template-columns] duration-200` for smooth animation
   - Add `overflow-hidden` on the sidebar slot so content doesn't leak when width is 0

3. **`src/monitor/ui/src/components/layout/header.tsx`**
   - Accept `sidebarCollapsed` and `onToggleSidebar` props
   - Add a button before the "eforge" text using `PanelLeftClose` (when expanded) / `PanelLeft` (when collapsed) from `lucide-react`
   - Minimal styling: ghost button, `size-5` icon

## Scope

**In scope:**
- Toggle button in the header to collapse/expand the sidebar
- Smooth CSS transition animation on collapse/expand
- Sidebar content hidden (overflow clipped) when collapsed
- Content area fills full viewport width when sidebar is collapsed

**Out of scope:**
- Persisting sidebar state across sessions
- Changes to the existing vertical console panel resize behavior

## Acceptance Criteria

- `pnpm --filter @eforge/monitor-ui build` completes with no build errors
- Opening `http://localhost:4567` during an active build shows the toggle button in the header
- Clicking the toggle button smoothly collapses the sidebar and the content area fills the full viewport width
- Clicking the toggle button again smoothly expands the sidebar back to 280px
- The sidebar toggle does not interfere with the existing vertical console panel resize functionality
