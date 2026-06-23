---
id: plan-02-console-command-palette
name: Console Command Palette Foundation
branch: add-console-command-palette-foundation/plan-02-console-command-palette
agents:
  builder:
    effort: high
    rationale: Adds a new keyboard-first React surface, shadcn/cmdk dependency
      wiring, pure derivation helpers, shortcut handling, extension action
      invocation, and side-effect confirmation tests.
---

# Console Command Palette Foundation

## Architecture Context

The Console parent document owns navigation, keyboard shortcuts, rendering, routing, and extension action confirmation. Extensions provide only typed manifest metadata. The palette must therefore build internal command descriptors from existing first-party route metadata and the contribution manifest, route through `handleNavigate`, and invoke safe/defaulted extension integration commands through the shared browser client.

This plan depends on `plan-01-workstation-subview-contract` for the optional workstation `subviews` manifest field.

## Implementation

### Overview

Add shadcn Command support using `cmdk`, a host-owned command palette mounted from `App`, a minimal parent-document shortcut hook for Cmd/Ctrl+K, command derivation helpers, and React tests. The palette groups Navigation, Workstations, Workstation subviews, and Extension commands. It invokes only integration commands whose required input is absent or satisfied by defaults and gates side-effectful or unknown-side-effect commands with a Console-owned AlertDialog.

### Key Decisions

1. Use `buildNavItems()` and `toConsolePath()`/a small subview URL helper instead of duplicating route constants.
2. Extract the contribution manifest fetch hook so Workstations and the palette share `fetchExtensionContributionManifest` from `@eforge-build/client/browser`.
3. Keep command derivation pure and separately tested; React components receive descriptors and handle interaction state.
4. Treat side-effect metadata as read-only only for `none` and `local-read`; missing or empty metadata requires confirmation and displays `unknown` in the confirmation copy.
5. Invoke extension commands with `invokeExtensionAction` and `requestedBy: { host: 'console', surface: 'command-palette', commandId }`.

## Scope

### In Scope

- Add `cmdk` to `packages/console-ui` and add `src/components/ui/command.tsx`.
- Add a parent-document shortcut hook for Cmd+K and Ctrl+K.
- Build and render first-party Navigation commands for Now, Workstations, and System.
- Add Open Workstation behavior with direct navigation for one workstation and a nested selector for multiple workstations.
- Derive extension workstation and workstation subview navigation commands from the contribution manifest.
- Derive runnable extension integration commands from the contribution manifest and bound actions.
- Filter integration commands with unsatisfied required input fields after applying declared defaults.
- Confirm side-effectful or unknown-side-effect extension commands with AlertDialog copy that names the command label, extension name, and side-effect classes.
- Invoke extension commands through the shared browser client and show compact invocation status/errors.
- Add Console UI and pure helper tests for rendering, keyboard invocation, navigation, Open Workstation behavior, subview URLs, integration command filtering, and side-effect confirmation.

### Out of Scope

- Extension-defined global shortcuts.
- Forwarding Cmd/Ctrl+K into sandboxed workstation iframes.
- Iframe palette event forwarding.
- Arbitrary input forms inside the palette.
- Extension-owned palette rendering or extension components inside the palette.
- New daemon API routes.

## Files

### Create

- `packages/console-ui/src/components/ui/command.tsx` — shadcn Command wrappers around `cmdk` for Dialog-hosted command lists.
- `packages/console-ui/src/hooks/use-extension-contribution-manifest.ts` — shared manifest fetch hook using `fetchExtensionContributionManifest`.
- `packages/console-ui/src/hooks/use-console-shortcut.ts` — tiny parent-document shortcut hook, initially for Cmd/Ctrl+K.
- `packages/console-ui/src/components/command-palette/command-model.ts` — pure command descriptor derivation, required-default filtering, subview command creation, and side-effect classification.
- `packages/console-ui/src/components/command-palette/command-palette.tsx` — Dialog + Command UI, nested workstation selector, AlertDialog confirmation, invocation status, and routing callbacks.
- `packages/console-ui/src/components/command-palette/index.ts` — public export for the palette component.
- `packages/console-ui/src/components/command-palette/__tests__/command-model.test.ts` — pure derivation and filtering tests.
- `packages/console-ui/src/components/command-palette/__tests__/command-palette.test.tsx` — React interaction tests for rendering, shortcuts, navigation, selector behavior, and confirmation.

### Modify

- `packages/console-ui/package.json` — add the `cmdk` dependency.
- `pnpm-lock.yaml` — lock the new `cmdk` dependency.
- `packages/console-ui/src/components/ui/index.ts` — export the Command UI components.
- `packages/console-ui/src/views/workstations/use-workstation-manifest.ts` — delegate to the shared manifest hook while preserving Workstations-specific `empty` status semantics.
- `packages/console-ui/src/lib/navigation.ts` — add a helper that converts workstation subview `path`/`subPath` metadata into `toConsolePath({ id: 'workstationDetail', workstationId, subPath })` output, preserving query-only paths such as `?focus=roadmap`.
- `packages/console-ui/src/__tests__/navigation.test.ts` — assert generated subview URLs for Roadmap, Backlog, Plans, nested paths, and query-only paths.
- `packages/console-ui/src/app.tsx` — mount the command palette from the parent Console document and pass the existing `handleNavigate` callback.
- `packages/console-ui/src/__tests__/app.test.tsx` — keep routing tests isolated from palette network fetches or add a focused mount assertion if the palette host is mocked.
- `packages/console-ui/src/__tests__/setup.ts` — add jsdom shims required by `cmdk` or Radix Dialog only if tests expose missing DOM APIs.

## Implementation Details

### Command derivation

- First-party navigation commands must come from `buildNavItems()` and use the item `href` values.
- Add an `open-workstation` command descriptor regardless of workstation count; at execution time it navigates directly for one workstation, opens the selector for multiple workstations, and shows a disabled/no-op item for zero workstations.
- Sort workstations with the existing `sortWorkstations()` helper before deriving workstation commands.
- Derive workstation subview commands by iterating each workstation `subviews ?? []` and building hrefs through the new navigation helper.
- Build an action lookup from `manifest.actions` and include an integration command only when its `action.actionId` resolves.
- Use `command.inputSchema ?? boundAction.inputSchema` as the required-field source. Treat absent `required` as no required input. Merge `command.action.inputDefaults ?? {}` before filtering. Include the command only when every root required key exists in the merged defaults.
- The invocation input for palette commands is the merged defaults object; no arbitrary action-form flow is added.

### Invocation and confirmation

- `local-write`, `network`, `daemon-state`, and `build-queue` require AlertDialog confirmation.
- Missing or empty `sideEffects` metadata requires AlertDialog confirmation and displays `unknown` among the side-effect classes.
- `none` and `local-read` do not require confirmation when no non-read side-effect class is present.
- AlertDialog description must include the command label, extension name, and side-effect classes.
- Invocation must call:
  `invokeExtensionAction({ actionId, input, requestedBy: { host: 'console', surface: 'command-palette', commandId } })`.
- Keep status compact with aria-live text for running, success, and failure states.

## Verification

- [ ] Pressing Cmd+K in a Console UI test opens a Dialog containing the command input.
- [ ] Pressing Ctrl+K in a Console UI test opens a Dialog containing the command input.
- [ ] The palette renders Navigation commands labeled Now, Workstations, and System.
- [ ] Selecting Now calls `onNavigate('/console/')`.
- [ ] Selecting Workstations calls `onNavigate('/console/workstations')`.
- [ ] Selecting System calls `onNavigate('/console/system')`.
- [ ] With exactly one workstation in the manifest, selecting Open Workstation calls `onNavigate` with that workstation detail path.
- [ ] With multiple workstations in the manifest, selecting Open Workstation renders a selector page whose entries can be selected with keyboard or click.
- [ ] Workstation commands are derived from `consoleWorkstations` and use encoded workstation ids in hrefs.
- [ ] Workstation subview commands are derived from `subviews` and produce `/console/workstations/:id?focus=roadmap`, `/console/workstations/:id?focus=board`, and `/console/workstations/:id?focus=plans` paths for eforge-plan.
- [ ] Pure helper tests include an extension integration command with no required input.
- [ ] Pure helper tests include an extension integration command whose required fields are all present in `action.inputDefaults`.
- [ ] Pure helper tests exclude an extension integration command with a required field absent from defaults.
- [ ] Pure helper tests prove the integration command resolves its bound action before side-effect classification.
- [ ] Invoking an extension command calls `invokeExtensionAction` with `requestedBy.host === 'console'`, `requestedBy.surface === 'command-palette'`, and `requestedBy.commandId` equal to the manifest command id.
- [ ] Commands with `local-write`, `network`, `daemon-state`, or `build-queue` side effects open AlertDialog before invocation.
- [ ] A command with missing side-effect metadata opens AlertDialog before invocation.
- [ ] Confirmation text contains the command label, extension name, and side-effect classes.
- [ ] No test fixture or component renders an extension-supplied component inside the palette.
- [ ] No command palette code adds iframe message listeners for Cmd/Ctrl+K forwarding.
