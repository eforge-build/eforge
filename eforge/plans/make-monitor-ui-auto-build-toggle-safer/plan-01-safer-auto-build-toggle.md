---
id: plan-01-safer-auto-build-toggle
name: Safer Monitor UI Auto-build Toggle
branch: make-monitor-ui-auto-build-toggle-safer/plan-01-safer-auto-build-toggle
---

# Safer Monitor UI Auto-build Toggle

## Architecture Context

The monitor UI reads daemon-wide auto-build state from `useDaemonEvents()` and writes changes through `useAutoBuild()`, which calls the shared daemon HTTP helper `setAutoBuild(enabled)`. The header currently renders the auto-build copy and switch inside a native `<label>`, so clicking the status text toggles the switch. This plan keeps the read path unchanged, changes the write path to an explicit setter, and adds a confirmation dialog only for enabling auto-build.

## Implementation

### Overview

Update the header auto-build control so the status text is a non-label sibling of the switch, the switch has its own accessible name, and attempts to enable auto-build open a shadcn/Radix alert dialog. The dialog warning text must state that queued builds may start immediately if auto-build is enabled. Confirming the dialog invokes the explicit setter with `true`; canceling or closing the dialog does not mutate auto-build. Disabling auto-build invokes the setter with `false` immediately.

### Key Decisions

1. Replace the wrapping `<label>` in `Header` with a non-label container (`div` or equivalent) so the visible status copy is not an activation target.
2. Give the Radix `Switch` an `aria-label` containing “auto-build” so keyboard and screen-reader users can operate it without relying on a native label.
3. Make `useAutoBuild` return `setEnabled(enabled: boolean)` instead of `toggle()` so confirmation code can call `setEnabled(true)` without depending on a possibly stale toggle calculation.
4. Keep the confirmation dialog local to `Header`, because only this component defines the user interaction that distinguishes enable from disable.
5. Use `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, and `AlertDialogAction` from `packages/monitor-ui/src/components/ui/alert-dialog.tsx`; do not add a new dialog primitive.

## Scope

### In Scope

- Remove click-to-toggle behavior from the auto-build status text in `Header`.
- Add a confirmation dialog before enabling auto-build from the header switch.
- Keep disabling auto-build as one direct switch interaction.
- Change the `useAutoBuild` hook API from `toggle()` to an explicit `setEnabled(enabled: boolean)` function.
- Update `AppContent` to pass the explicit setter to `Header`.
- Add focused `Header` component tests for text clicks, enable confirmation, cancel behavior, and immediate disable behavior.
- Update `useAutoBuild` hook tests for the explicit setter API.
- Sync nearby hook documentation that names the old `toggle()` API.

### Out of Scope

- Daemon API changes.
- Changes to auto-build scheduling semantics.
- Changes to queue behavior when auto-build is enabled.
- Redesigning the header layout beyond the auto-build control semantics.

## Files

### Create

- `packages/monitor-ui/src/components/layout/__tests__/header.test.tsx` — jsdom component tests for the safer header auto-build control. Use `@testing-library/react` APIs already present in this package; no new test dependency is needed.

### Modify

- `packages/monitor-ui/src/components/layout/header.tsx` — replace the native label wrapper, add local alert-dialog open state, wire switch changes through enable-confirmation/disable-immediate logic, add an `aria-label` to the switch, and rename the prop to an explicit setter such as `onSetAutoBuildEnabled(enabled: boolean)`.
- `packages/monitor-ui/src/hooks/use-auto-build.ts` — expose `setEnabled(enabled: boolean)`, call `setAutoBuild(enabled)` with the provided value, preserve the `toggling` guard, invoke `onUpdate(newState)` after a non-null response, and remove the old `toggle()` return field.
- `packages/monitor-ui/src/hooks/__tests__/use-auto-build.test.ts` — update tests to call `result.current.setEnabled(...)` and assert the HTTP helper receives the explicit boolean argument.
- `packages/monitor-ui/src/app.tsx` — destructure `setEnabled` from `useAutoBuild` and pass it to `Header` using the renamed prop.
- `packages/monitor-ui/src/hooks/README.md` — replace references to the old toggle-only API with the explicit setter API.

## Testing Guidance

- Build header tests around `initialDaemonState` from `packages/monitor-ui/src/lib/daemon-reducer.ts` and a local `makeAutoBuildState` fixture with `enabled`, `mode`, and related fields set for enabled and disabled cases.
- The disabled-state switch test must click the switch and assert the confirmation dialog text appears before the mutation handler is called.
- The confirm test must click the dialog action and assert the handler receives `true` exactly once.
- The cancel test must click the dialog cancel control and assert the handler call count remains 0.
- The enabled-state switch test must click the switch and assert the handler receives `false` exactly once, with no enable-warning dialog visible.
- Include a query such as `getByRole('switch', { name: /auto-build/i })` to cover the accessible switch name.

## Verification

- [ ] `packages/monitor-ui/src/components/layout/header.tsx` contains no native `<label>` around the auto-build status text and switch.
- [ ] Header component tests assert clicking `Auto-build: disabled` or `Auto-build: running` leaves the auto-build mutation handler call count at 0.
- [ ] Header component tests assert clicking the disabled-state switch renders a warning that queued builds may start immediately, cancel leaves the handler call count at 0, and confirm calls the handler with `true`.
- [ ] Header component tests assert clicking the enabled-state switch calls the handler with `false` without rendering the enable-warning dialog.
- [ ] Hook tests assert `useAutoBuild().setEnabled(true)` calls `setAutoBuild(true)` and `useAutoBuild().setEnabled(false)` calls `setAutoBuild(false)`.
- [ ] `pnpm --filter @eforge-build/monitor-ui test` exits 0.
- [ ] `pnpm type-check` exits 0.
