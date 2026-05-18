---
title: Make Monitor UI Auto-build Toggle Safer
created: 2026-05-18
profile: gpt-claude-combo
---

# Make Monitor UI Auto-build Toggle Safer

## Problem / Motivation

In `packages/monitor-ui/src/components/layout/header.tsx`, the auto-build status text and switch are wrapped in a native `<label>`. This makes the text label clickable, so clicking `Auto-build: running` or `Auto-build: disabled` toggles auto-build.

This is undesirable because disabling or enabling auto-build can have significant side effects. Enabling auto-build is especially risky because currently queued builds may immediately start. The UI should require explicit confirmation before enabling it.

## Goal

Fix the monitor UI auto-build control so the status label is not clickable and enabling auto-build requires confirmation.

## Approach

- Replace the native wrapping `<label>` with a non-label container such as `<div>`.
- Keep the switch accessible with an explicit `aria-label` or equivalent.
- Ensure only direct interaction with the switch initiates the state change.
- Use existing shadcn/Radix alert dialog components from `packages/monitor-ui/src/components/ui/alert-dialog.tsx`.
- When the user attempts to turn auto-build on, show a modal warning that queued builds may start immediately.
- Confirm action should enable auto-build.
- Cancel/close should leave state unchanged.
- Disabling Auto-build can remain immediate.
- Prefer changing `useAutoBuild` in `packages/monitor-ui/src/hooks/use-auto-build.ts` to expose an explicit setter, e.g. `setEnabled(enabled: boolean)`, rather than only a `toggle()` function.
- Ensure confirming the dialog calls `setEnabled(true)`, not a potentially stale toggle.
- Update callers accordingly:
  - `packages/monitor-ui/src/app.tsx` should pass the explicit setter to `Header`.
  - `Header` props/types should reflect the explicit handler, e.g. `onSetAutoBuildEnabled(enabled: boolean)`.

## Scope

### In scope

- Updating the auto-build control in `packages/monitor-ui/src/components/layout/header.tsx`.
- Making the status text visually unchanged but not clickable/toggling.
- Preserving switch keyboard and screen-reader accessibility.
- Adding confirmation before enabling auto-build.
- Keeping disabling auto-build immediate.
- Updating `useAutoBuild` in `packages/monitor-ui/src/hooks/use-auto-build.ts` to expose an explicit setter API.
- Updating callers such as `packages/monitor-ui/src/app.tsx`.
- Adding or adjusting tests:
  - Focused component tests for `Header`, likely under `packages/monitor-ui/src/components/layout/__tests__/header.test.tsx`.
  - Updating `packages/monitor-ui/src/hooks/__tests__/use-auto-build.test.ts` for the new explicit setter API.

### Out of scope

N/A

## Acceptance Criteria

- Auto-build text label is visually unchanged but not clickable/toggling.
- Switch remains keyboard/screen-reader accessible.
- Enabling auto-build requires an explicit confirmation.
- Disabling auto-build remains one direct switch action.
- Tests pass for monitor UI and the repo type-check remains clean.
- Header component tests cover:
  - Clicking the status text does not call the auto-build mutation handler.
  - Clicking the switch while auto-build is disabled opens the confirmation dialog.
  - Confirming calls the handler with `true`.
  - Canceling does not call the handler.
  - Clicking the switch while auto-build is enabled calls the handler with `false` immediately.
- Validation commands run successfully, at minimum:

```bash
pnpm --filter @eforge-build/monitor-ui test
pnpm type-check
```
