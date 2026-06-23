---
title: Add Console Command Palette Foundation
created: 2026-06-22
depends_on: ["agent-first-backlog-discovery-and-session-plan-auto-creation"]
stack_parent: agent-first-backlog-discovery-and-session-plan-auto-creation
---

# Add Console Command Palette Foundation

## Problem / Motivation

Console has typed extension contribution metadata, workstation manifests, integration commands, and daemon-client invocation routes, but it does not yet provide a host-owned keyboard-first command palette. Users must discover top-level routes, extension workstations, eforge-plan Roadmap/Backlog/Plans focuses, and safe/defaulted extension commands through existing UI surfaces rather than a single Cmd/Ctrl+K flow.

This should improve keyboard navigation and action discoverability without allowing extensions to render palette UI, register global shortcuts, or receive iframe-forwarded palette events.

## Goal

Add a Console-owned command palette opened from the parent Console document by Cmd/Ctrl+K / Ctrl+K. The palette should expose first-party navigation, workstation navigation, declared workstation subviews, and safe/defaulted extension integration commands while preserving host ownership of shortcuts, rendering, routing, and confirmation.

## Approach

- Build internal `ConsoleCommand` descriptors in Console from first-party route metadata and extension contribution manifest entries.
- Keep extension input declarative only; extensions contribute typed metadata but do not render palette UI.
- Add shadcn Command support using `cmdk` and `packages/console-ui/src/components/ui/command.tsx`.
- Add a host-owned command palette module, likely under `packages/console-ui/src/components/command-palette/`.
- Mount the palette from `App` or `ConsoleShell` so it can navigate through the existing `handleNavigate` path.
- Add a tiny host shortcut registry or hook for Console-owned shortcuts, starting with Cmd/Ctrl+K only.
- Do not accept extension shortcut contributions in this item.
- Use shadcn Command inside Dialog.
- Group palette entries for Navigation, Workstations, Workstation subviews, and Extension commands.
- Use a nested selector/page for Open Workstation when multiple workstations exist.
- Reuse or extract the extension contribution manifest fetching currently used by Workstations.
- Derive palette commands from `consoleWorkstations`, `integrationCommands`, and `actions` without duplicating route constants.
- Derive runnable extension integration commands from `integrationCommands`.
- Resolve the bound action from `actions`.
- Merge `action.inputDefaults` before deciding whether required input fields are satisfied.
- Consider an integration command runnable only when required schema fields are absent or satisfied by defaults.
- Let the daemon remain the final validator for extension action invocation.
- Invoke extension commands with `invokeExtensionAction` from `@eforge-build/client/browser`.
- Send `requestedBy: { host: 'console', surface: 'command-palette', commandId }` when invoking extension commands.
- Treat non-read side effects as side-effectful, including `local-write`, `network`, `daemon-state`, and `build-queue`.
- Treat missing side-effect metadata conservatively as requiring confirmation.
- Gate side-effectful or unknown-side-effect extension commands with Console-owned shadcn AlertDialog confirmation.
- Confirmation copy should show the command label, extension name, and side-effect classes.
- Extend `@eforge-build/client` contribution schemas/types with optional workstation `subviews`.
- Mirror the declarative workstation subview type in `packages/extension-sdk`.
- Validate and project workstation subviews through `packages/engine/src/extensions/contribution-validation.ts`, `packages/engine/src/extensions/types.ts`, and `packages/engine/src/extensions/manifest.ts`.
- Keep the daemon manifest route unchanged.
- Use a minimal workstation subview shape with stable `id`, `label`, optional `description`, and a host-routable `path`/`subPath` string.
- Add optional subview metadata to workstation manifests instead of adding a new deep-link family.
- Turn subview paths into existing `/console/workstations/:id` detail routes via `toConsolePath`.
- Update `eforge/extensions/eforge-plan/index.ts` to declare Roadmap, Backlog, and Plans subviews on the existing planning workstation.
- Use `?focus=roadmap` for Roadmap.
- Use the default focus path or `?focus=board` for Backlog.
- Use `?focus=plans` for Plans.
- Keep route/API usage on existing typed client/navigation helpers.
- Do not inline `/api/...` route literals.
- Use `fetchExtensionContributionManifest`, `invokeExtensionAction`, typed contribution schemas, and existing Console navigation helpers.
- Assume eforge-plan already routes Roadmap, Backlog, and Plans through its internal query-driven focus state.
- Assume the first slice can show compact invocation status/errors without building a general action-form flow inside the palette.
- Assume parent-document shortcuts are sufficient.

## Scope

In scope:

- Implement a Console-owned command palette opened by Cmd/Ctrl+K / Ctrl+K from the parent Console document.
- Include first-party navigation commands for Now, Workstations, and System.
- Add an Open Workstation command.
- Navigate directly from Open Workstation when exactly one workstation exists.
- Open a keyboard-navigable workstation selector from Open Workstation when multiple workstations exist.
- Derive extension workstation commands from the existing contribution manifest.
- Derive workstation subview commands from the existing contribution manifest.
- Derive extension integration commands from the existing contribution manifest.
- Add optional workstation subview metadata so eforge-plan can declare Roadmap, Backlog, and Plans entries.
- Route eforge-plan Roadmap, Backlog, and Plans entries to existing internal focus query paths.
- Invoke only integration commands whose input schema requires no input or whose required fields are satisfied by declared defaults.
- Require Console-owned shadcn AlertDialog confirmation for side-effectful or unknown-side-effect extension command invocation.
- Add Console UI tests for command palette rendering and keyboard invocation.
- Unit-test command derivation helpers separately from React.
- Extend workstation/navigation tests for subview URLs.
- Extend client/engine/extension registration tests for subview schema projection.
- Update eforge-plan registration tests to assert Roadmap, Backlog, and Plans manifest entries.
- Validate with `pnpm --filter @eforge-build/console-ui test`.
- Validate with relevant eforge-plan extension tests.
- Validate with `pnpm type-check`.
- Validate with `pnpm maintainability:check`.

Out of scope:

- Extension-defined global shortcuts.
- Iframe command-palette forwarding.
- Forwarding Cmd/Ctrl+K when focus is inside a sandboxed workstation iframe.
- Arbitrary command input forms.
- Extension-owned palette rendering.
- Extension components rendering inside the palette.
- A general action-form flow inside the palette.

## Acceptance Criteria

- Pressing Cmd+K in the Console parent document opens a shadcn-styled command palette.
- Pressing Ctrl+K in the Console parent document opens a shadcn-styled command palette.
- The palette includes a first-party navigation command for Now.
- The palette includes a first-party navigation command for Workstations.
- The palette includes a first-party navigation command for System.
- The Open Workstation command navigates directly when exactly one workstation is available.
- The Open Workstation command opens a keyboard-navigable workstation selector when multiple workstations are available.
- The palette exposes extension workstation entries derived from `consoleWorkstations` in the contribution manifest.
- The palette exposes declared workstation subview entries from the contribution manifest.
- The eforge-plan planning workstation manifest declares a Roadmap subview with `?focus=roadmap`.
- The eforge-plan planning workstation manifest declares a Backlog subview using the default focus path or `?focus=board`.
- The eforge-plan planning workstation manifest declares a Plans subview with `?focus=plans`.
- The palette includes an extension integration command when the command input schema has no required input.
- The palette includes an extension integration command when all required input fields are supplied by declared defaults.
- The palette excludes an extension integration command when required input fields are not supplied by declared defaults.
- Extension command derivation resolves the bound action from `actions`.
- Extension command derivation merges `action.inputDefaults` before required-field filtering.
- Invoking a palette extension command uses `invokeExtensionAction` from `@eforge-build/client/browser` with `requestedBy: { host: 'console', surface: 'command-palette', commandId }`.
- Extension commands with `local-write` side effects require Console-owned AlertDialog confirmation before invocation.
- Extension commands with `network` side effects require Console-owned AlertDialog confirmation before invocation.
- Extension commands with `daemon-state` side effects require Console-owned AlertDialog confirmation before invocation.
- Extension commands with `build-queue` side effects require Console-owned AlertDialog confirmation before invocation.
- Extension commands with missing side-effect metadata require Console-owned AlertDialog confirmation before invocation.
- Confirmation copy shows the command label, extension name, and side-effect classes.
- Extension input remains declarative metadata only.
- No extension component renders inside the palette.
- No extension-defined global shortcuts are implemented.
- No iframe command-palette forwarding is implemented.
- No arbitrary command input forms are implemented.
- No extension-owned palette rendering is implemented.
- Route/API usage stays on existing typed client/navigation helpers rather than inlined daemon route literals.
- `@eforge-build/client` contribution schemas/types support optional workstation `subviews`.
- `packages/extension-sdk` mirrors the declarative workstation subview type.
- `packages/engine/src/extensions/contribution-validation.ts` validates workstation subviews.
- `packages/engine/src/extensions/types.ts` includes workstation subviews.
- `packages/engine/src/extensions/manifest.ts` projects workstation subviews into the contribution manifest.
- The daemon manifest route remains unchanged.
- Workstation subview metadata includes stable `id`, `label`, optional `description`, and a host-routable `path` or `subPath` string.
- The host turns workstation subview paths into existing `/console/workstations/:id` detail routes via `toConsolePath`.
- Console UI tests assert command palette rendering.
- Console UI tests assert keyboard invocation opens the palette.
- Console UI tests assert first-party navigation commands call `onNavigate`.
- Console UI tests assert single-workstation Open Workstation behavior.
- Console UI tests assert multiple-workstation Open Workstation selector behavior.
- Console UI tests assert side-effectful extension commands require AlertDialog confirmation.
- Unit tests assert command derivation helper behavior separately from React.
- Unit tests assert required-default filtering for extension integration commands.
- Workstation/navigation tests assert generated subview URLs.
- Client, engine, and extension registration tests assert subview schema projection.
- eforge-plan registration tests assert Roadmap, Backlog, and Plans subview manifest entries.
- `pnpm --filter @eforge-build/console-ui test` exits 0.
- The relevant eforge-plan extension tests exit 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.