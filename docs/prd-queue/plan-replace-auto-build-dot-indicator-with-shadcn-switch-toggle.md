---
title: Plan: Replace Auto-build dot indicator with shadcn Switch toggle
created: 2026-03-23
status: pending
---

# Replace Auto-build Dot Indicator with shadcn Switch Toggle

## Problem / Motivation

The auto-build toggle in the monitor header currently uses a green dot + text pattern identical to the connection status indicator. This makes it look like a read-only status indicator rather than an interactive toggle. Users cannot immediately tell that the element is clickable and controls a setting.

## Goal

Replace the auto-build dot indicator with a shadcn Switch component so the toggle affordance is immediately obvious, following standard UI conventions for binary on/off controls.

## Approach

1. **Install `@radix-ui/react-switch`** as a dependency in `src/monitor/ui/package.json`.

2. **Create a standard shadcn Switch component** at `src/monitor/ui/src/components/ui/switch.tsx`, wrapping `@radix-ui/react-switch` and following the same pattern as the existing `checkbox.tsx`.

3. **Update the header component** at `src/monitor/ui/src/components/layout/header.tsx`. Replace the current button with dot indicator:

   ```tsx
   {/* Before: button with dot */}
   <button onClick={...}>
     <div className="w-2 h-2 rounded-full bg-green-500" />
     <span>Auto-build</span>
   </button>
   ```

   With a labeled Switch:

   ```tsx
   <label className="flex items-center gap-1.5 text-xs text-text-dim cursor-pointer">
     <span>Auto-build</span>
     <Switch
       checked={autoBuildState.enabled}
       onCheckedChange={onToggleAutoBuild}
       disabled={autoBuildToggling}
     />
   </label>
   ```

   The Switch's built-in checked/unchecked visual states (sliding thumb, color change) make the toggle affordance immediately obvious.

### Files to modify

- `src/monitor/ui/package.json` — add `@radix-ui/react-switch` dependency
- `src/monitor/ui/src/components/ui/switch.tsx` — new shadcn Switch component
- `src/monitor/ui/src/components/layout/header.tsx` — replace dot+button with Switch

## Scope

**In scope:**
- Adding the `@radix-ui/react-switch` dependency
- Creating the shadcn Switch component
- Replacing the auto-build dot+button pattern with the Switch in the header

**Out of scope:**
- N/A

## Acceptance Criteria

- `cd src/monitor/ui && pnpm install && pnpm build` compiles successfully.
- The Switch renders in the monitor header in place of the previous dot+button indicator.
- The Switch toggles on click, reflecting the current auto-build enabled/disabled state.
- The Switch shows a disabled state while the toggle operation is in progress (`autoBuildToggling`).
