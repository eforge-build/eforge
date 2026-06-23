---
id: plan-01-workstation-subview-contract
name: Workstation Subview Contribution Contract
branch: add-console-command-palette-foundation/plan-01-workstation-subview-contract
agents:
  builder:
    effort: high
    rationale: Extends a public contribution contract across client schemas,
      extension SDK types, engine validation/projection, and the eforge-plan
      extension registration.
---

# Workstation Subview Contribution Contract

## Architecture Context

Console extension contributions are typed in `@eforge-build/client`, authored through `@eforge-build/extension-sdk`, recorded and projected by `packages/engine/src/extensions/*`, and consumed by Console over the existing contribution manifest route. This plan adds optional workstation subview metadata to that existing manifest family so the command palette can later derive host-routable entries without introducing a new daemon route or a deep-link family.

## Implementation

### Overview

Add `subviews` as optional declarative metadata on Console workstation registrations and manifest entries. Each subview has a stable local `id`, `label`, optional `description`, and exactly one workstation-internal route string (`path` or `subPath`). Project the metadata through the engine contribution manifest, then declare the eforge-plan Roadmap, Backlog, and Plans subviews on the existing planning workstation.

### Key Decisions

1. Keep the daemon manifest route unchanged; only the manifest payload schema grows by one optional field on workstation entries.
2. Treat subview routes as workstation-internal strings that a host later feeds into `toConsolePath({ id: 'workstationDetail', workstationId, subPath })`.
3. Use `?focus=roadmap`, `?focus=board`, and `?focus=plans` for eforge-plan so Backlog remains explicit while staying compatible with the existing query-driven focus state.
4. Preserve extension input as metadata only; no subview renderer, iframe command forwarding, or extension-owned palette UI is introduced in this plan.

## Scope

### In Scope

- Add client TypeBox schemas and exported TypeScript types for workstation subviews.
- Mirror the subview authoring type in `packages/extension-sdk`.
- Validate workstation subviews during engine extension registration.
- Project workstation subviews into the contribution manifest and extension detail projections.
- Add eforge-plan planning workstation subview declarations for Roadmap, Backlog, and Plans.
- Add focused tests for schema acceptance/rejection, engine projection, SDK typing, and eforge-plan registration.

### Out of Scope

- Command palette UI, keyboard shortcuts, and invocation behavior.
- New daemon routes or API route constants.
- Extension-defined global shortcuts.
- Iframe command-palette event forwarding.
- General action forms or extension-rendered palette content.

## Files

### Create

- None.

### Modify

- `packages/client/src/extension-contributions.ts` — add `ConsoleWorkstationSubviewManifestEntrySchema` and `ConsoleWorkstationSubviewManifestEntry`, then add optional `subviews` to both srcDoc and frameBundle workstation manifest entry schemas.
- `packages/client/src/browser.ts` — export the new subview schema and type from the browser-safe entrypoint.
- `packages/extension-sdk/src/contributions.ts` — add `ConsoleWorkstationSubview` and optional `subviews` on `ConsoleWorkstationBase`.
- `packages/extension-sdk/src/index.ts` — re-export the SDK subview type.
- `packages/engine/src/extensions/types.ts` — add `ConsoleWorkstationSubviewSpec` and optional `subviews` on `ConsoleWorkstationBaseSpec`.
- `packages/engine/src/extensions/contribution-validation.ts` — validate optional `subviews`: array shape, unique local ids matching the existing local contribution id rule, non-empty labels, optional string descriptions, exactly one non-empty `path` or `subPath`, and JSON-safe data.
- `packages/engine/src/extensions/manifest.ts` — include JSON-cloned `subviews` in the base workstation manifest projection for srcDoc and frameBundle workstations.
- `eforge/extensions/eforge-plan/index.ts` — add Roadmap, Backlog, and Plans subviews to `planning-workstation`.
- `packages/client/src/__tests__/extension-contributions.test.ts` — assert valid workstation subviews parse and malformed subview shapes fail.
- `test/extension-contribution-registry-runtime.test.ts` — assert registered subviews are retained in engine state and projected into the manifest.
- `test/extension-workstation-bundles.test.ts` — assert frameBundle workstations can carry subviews through manifest projection and client parsing.
- `test/extension-sdk-example.test.ts` — exercise the new SDK subview type in the compile-time contribution stub.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert Roadmap, Backlog, and Plans subviews exist on the registered workstation and projected manifest.
- `test/eforge-plan-package-management.test.ts` — assert the loaded eforge-plan contribution manifest exposes the planning workstation subviews.

## Verification

- [ ] `safeParseExtensionContributionManifest` returns success for srcDoc and frameBundle workstation entries with `subviews` containing `?focus=roadmap`, `?focus=board`, and `?focus=plans`.
- [ ] Client schema tests reject a workstation subview missing both route fields.
- [ ] Client schema tests reject a workstation subview declaring both `path` and `subPath`.
- [ ] Engine registration tests record a diagnostic and skip a workstation when a subview id fails the existing local contribution id rule.
- [ ] Engine manifest projection tests show `subviews` on projected workstation entries and do not include handler functions.
- [ ] eforge-plan registration tests find exactly three planning workstation subviews with ids `roadmap`, `backlog`, and `plans`.
- [ ] The eforge-plan Roadmap subview route string is `?focus=roadmap`.
- [ ] The eforge-plan Backlog subview route string is `?focus=board`.
- [ ] The eforge-plan Plans subview route string is `?focus=plans`.
- [ ] No new `/api/...` route literal is added for subviews.
