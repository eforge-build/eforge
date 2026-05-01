---
id: plan-01-cancel-confirm-and-cursor
name: Cancel button confirmation + global pointer cursor
branch: cancel-build-button-clickability-confirmation-and-daemon-shutdown-clarification/cancel-confirm-and-cursor
---

# Cancel button confirmation + global pointer cursor

## Architecture Context

The monitor UI (`packages/monitor-ui/`) uses shadcn/ui components built on Radix primitives. Sibling Radix packages already in `package.json` are pinned at `^1.x` (`@radix-ui/react-checkbox` `^1.3.3`, `@radix-ui/react-collapsible` `^1.1.12`, `@radix-ui/react-scroll-area` `^1.2.10`, `@radix-ui/react-slot` `^1.2.4`, `@radix-ui/react-switch` `^1.2.6`, `@radix-ui/react-tooltip` `^1.2.8`). The new `@radix-ui/react-alert-dialog` dep must follow the same `^1.x` pattern.

The button cva lives in `packages/monitor-ui/src/components/ui/button.tsx`. Tailwind preflight resets `<button>` to `cursor: default`, so the base cva must add `cursor-pointer` for every Button to render as interactive on hover. `disabled:pointer-events-none` (already in the base) prevents hover interaction on disabled buttons; the disabled visual is handled by `disabled:opacity-50`. The standard shadcn pattern is to put `cursor-pointer` in the base — that is what this plan does.

The sidebar cancel button at `packages/monitor-ui/src/components/layout/sidebar.tsx:71-85` currently calls `cancelSession(group.key)` directly inside a click handler that already does `e.stopPropagation()` to keep the surrounding `SessionItem` `onClick={onSelect}` (line 59) from firing. After this plan, the trigger no longer calls `cancelSession`; the `AlertDialogAction`'s `onClick` does. Both the trigger and the dialog content keep `e.stopPropagation()` so clicks on the trigger or anywhere inside the dialog do not bubble to `SessionItem`.

No daemon code changes. The existing idle-shutdown countdown in `packages/monitor/src/server-main.ts:527-603` already broadcasts `monitor:shutdown-pending` and the UI's `use-eforge-events.ts:112-119` already renders a visible countdown. The verification step confirms this remains true after cancel.

## Implementation

### Overview

Four edits in one package:

1. Add `cursor-pointer` to the base class string of `buttonVariants` in `button.tsx`.
2. Add `@radix-ui/react-alert-dialog` (^1.x, matching sibling Radix packages) to `packages/monitor-ui/package.json`.
3. Create `packages/monitor-ui/src/components/ui/alert-dialog.tsx` as the standard shadcn AlertDialog component file.
4. In `sidebar.tsx`, wrap the existing cancel `<Button>` in `<AlertDialog>` so clicking the stop icon opens a confirmation dialog before `cancelSession(group.key)` runs.

### Key Decisions

1. **Add `cursor-pointer` to the cva base, not a per-button override.** Affects every Button in the app. Aligns with shadcn's typical defaults and removes the need for per-call className tweaks. Verification criterion 9 covers smoke-testing other buttons.
2. **Use the standard shadcn AlertDialog file shape.** Export `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogCancel`, `AlertDialogAction`. Use `cn(buttonVariants({...}))` from `@/lib/utils` and `@/components/ui/button` for `AlertDialogCancel` (outline variant) and `AlertDialogAction` (default variant) so the buttons inherit the new `cursor-pointer` automatically. The destructive styling on the confirm button is applied via `className="bg-destructive text-destructive-foreground hover:bg-destructive/90"` on the `AlertDialogAction` callsite in `sidebar.tsx`, matching the source's example.
3. **Keep `e.stopPropagation()` on trigger and content.** The trigger button handler stops propagation so clicking the icon does not also select the session. The `AlertDialogContent` element handler stops propagation so clicks anywhere inside the dialog (overlay buttons, etc.) cannot bubble to the underlying `SessionItem` even if the dialog renders inside the same React tree.
4. **Pin `@radix-ui/react-alert-dialog` to `^1.1.x`.** Match the sibling Radix packages already in `dependencies` (most are `^1.1.x` or higher). `^1.1.16` is the latest 1.x line. Use `^1.1.16` so `pnpm install` resolves the same major as the rest of the Radix surface.
5. **No daemon-shutdown code change.** The plan only verifies (criterion 8) that the daemon stays alive immediately post-cancel and that any subsequent shutdown is preceded by the existing visible countdown banner. If verification surfaces a real bug it is captured as a separate follow-up; this plan does not touch `packages/monitor/`.

## Scope

### In Scope
- 1-line change to `buttonVariants` base class in `packages/monitor-ui/src/components/ui/button.tsx` adding `cursor-pointer`.
- Add `@radix-ui/react-alert-dialog` `^1.1.16` (or the latest `^1.x` resolved by `pnpm install`) under `dependencies` in `packages/monitor-ui/package.json`.
- New `packages/monitor-ui/src/components/ui/alert-dialog.tsx` exporting the standard shadcn AlertDialog primitives.
- Update `packages/monitor-ui/src/components/layout/sidebar.tsx` to import the AlertDialog primitives and wrap the existing cancel `<Button>` (lines 71-85) in `<AlertDialog>` so clicking the stop icon opens a dialog with title "Cancel this build?", a "Keep running" cancel option, and a "Cancel build" destructive confirm action that calls `cancelSession(group.key)`.
- Both the trigger button and `AlertDialogContent` element keep `onClick={(e) => e.stopPropagation()}` to prevent the surrounding `SessionItem` `onClick={onSelect}` (line 59) from firing during dialog interaction.
- Manual verification (acceptance criterion 8) that the daemon stays alive after cancel and any subsequent shutdown is preceded by the existing visible countdown banner.

### Out of Scope
- Any change to the daemon idle-shutdown state machine in `packages/monitor/src/server-main.ts`.
- Any change to `cancelSession`'s API contract or worker termination semantics (still SIGTERM to the worker subprocess only).
- Backporting AlertDialog usage to other destructive actions in the UI.
- Code changes resulting from the daemon-shutdown verification — if a real bug is found (e.g. countdown not visible, daemon exits without countdown), it must be captured as a separate follow-up.
- Adding tests — the change is a small UI wiring with manual verification covered by acceptance criteria; no automated UI test harness exists for this surface.

## Files

### Create
- `packages/monitor-ui/src/components/ui/alert-dialog.tsx` — standard shadcn AlertDialog component. Wrap `@radix-ui/react-alert-dialog` primitives. Exports: `AlertDialog`, `AlertDialogPortal`, `AlertDialogOverlay`, `AlertDialogTrigger` (`= AlertDialogPrimitive.Trigger`), `AlertDialogContent` (with overlay + portal + animation classes), `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction` (uses `buttonVariants()` default), `AlertDialogCancel` (uses `buttonVariants({ variant: 'outline' })` and `mt-2 sm:mt-0`). Use `cn` from `@/lib/utils` and `buttonVariants` from `@/components/ui/button`. Match the structure of the existing shadcn-style files in the same directory (e.g. `sheet.tsx`, `tooltip.tsx`).

### Modify
- `packages/monitor-ui/src/components/ui/button.tsx` — add `cursor-pointer` to the base class string in `buttonVariants` cva at line 7. Insert it adjacent to the other base utilities (e.g. right after `inline-flex` or before `disabled:pointer-events-none`). Single token addition; no other changes to this file.
- `packages/monitor-ui/package.json` — add `"@radix-ui/react-alert-dialog": "^1.1.16"` to `dependencies`, alphabetically between `@radix-ui/react-checkbox` predecessor and `@radix-ui/react-checkbox` (it sorts before `react-checkbox`). Bump nothing else.
- `packages/monitor-ui/src/components/layout/sidebar.tsx` — add an import for the AlertDialog primitives from `@/components/ui/alert-dialog`. Replace the cancel `<Button>` block at lines 71-85 with the structure below. Keep all other `SessionItem` markup (`relative` text, badges, planCount span) unchanged.

  ```tsx
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Cancel this session"
        className="h-auto w-auto p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <CircleStop size={14} />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel this build?</AlertDialogTitle>
        <AlertDialogDescription>
          The running worker will be terminated and any in-progress work will be lost.
          Files staged in the worktree may remain.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep running</AlertDialogCancel>
        <AlertDialogAction
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={() => cancelSession(group.key)}
        >
          Cancel build
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
  ```

## Verification

- [ ] `pnpm install` resolves `@radix-ui/react-alert-dialog` at the new `^1.1.x` version with no peer-dep warnings beyond the existing baseline.
- [ ] `pnpm type-check` exits 0 (no new TypeScript errors anywhere in the workspace).
- [ ] `pnpm build` exits 0; `packages/monitor-ui/dist/` is produced.
- [ ] `packages/monitor-ui/src/components/ui/button.tsx` line 7 base cva string contains the literal token `cursor-pointer`.
- [ ] `packages/monitor-ui/src/components/ui/alert-dialog.tsx` exists and exports `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogCancel`, `AlertDialogAction` (verified via grep for each named export).
- [ ] `packages/monitor-ui/src/components/layout/sidebar.tsx` imports `AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogCancel`, `AlertDialogAction` from `@/components/ui/alert-dialog`.
- [ ] In `sidebar.tsx`, the only call to `cancelSession(group.key)` is inside the `AlertDialogAction` `onClick`; the `AlertDialogTrigger`'s child `Button` `onClick` only calls `e.stopPropagation()` and does not call `cancelSession`.
- [ ] In `sidebar.tsx`, both `AlertDialogTrigger`'s child `Button` and the `AlertDialogContent` element have `onClick={(e) => e.stopPropagation()}` handlers.
- [ ] Manual UI check (executed by the verifier with the daemon running and at least one running build): hovering the stop icon next to a running session shows a pointer cursor.
- [ ] Manual UI check: clicking the stop icon opens a dialog whose title text is exactly `Cancel this build?` with two action buttons whose visible text is `Keep running` and `Cancel build`.
- [ ] Manual UI check: clicking `Keep running` closes the dialog; the running session remains in the sidebar with status `running` and the session list does not change selection.
- [ ] Manual UI check: clicking the stop icon, then `Cancel build` closes the dialog and transitions the session to status `failed` with label `Cancelled` (or the codebase's existing cancelled label) in the sidebar.
- [ ] Manual UI check: clicking the stop icon and clicking inside the dialog (on either button or anywhere on the dialog content background) does not change the currently selected session in the sidebar (the surrounding `SessionItem` `onClick={onSelect}` does not fire).
- [ ] Manual daemon check: immediately after a cancel, `eforge_status` reports the daemon is alive. If the cancelled run was the only running run, any subsequent daemon shutdown is preceded by a visible countdown banner in the UI; the daemon does not exit without first showing the countdown.
- [ ] Manual UI smoke check: at least three other Buttons in the UI (e.g. the enqueue submit button in `enqueue-section.tsx`, a queue-action button in `queue-section.tsx`, and the sidebar `Show N more` pagination button) display a pointer cursor on hover.
