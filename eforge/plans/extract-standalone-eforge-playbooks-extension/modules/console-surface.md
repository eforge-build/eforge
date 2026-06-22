# Console Surface

## Architecture Reference

This module implements the Console portions of the architecture, especially:

- **Vision and goals** item 6: Console playbook inventory/management appears through extension Console contributions or workstation entries, not a core System `PlaybooksSection`.
- **Core architectural principles > Generic client APIs only**: Console must use generic extension contribution/action surfaces and must not import playbook-specific daemon helpers or wire contracts.
- **Integration contracts by subsystem > Console**: remove core System playbook fetch/state/selectors/rendering and keep `ExtensionContributionsSection` as the core rendering path for extension-owned playbook UI.
- **Quality attributes > Boundary safety**: guard against a kernel-owned Console Playbooks section returning.

Key constraints from architecture:
- Do not call `/api/playbook/*`, `API_ROUTES.playbook*`, or `apiPlaybook*` from Console.
- Do not import `PlaybookListResponse`, `PlaybookListEntry`, or other playbook-specific client wire types in Console.
- Do not add a playbook-specific Console renderer; use existing generic Console contribution and workstation manifest rendering.
- Do not edit `eforge/extensions/eforge-playbooks/**`; the dependency module owns the extension contribution registration.
- Do not update public docs in this module; `docs-and-regression-guards` owns docs.

Dependency/order note:
- The architecture graph places `console-surface` before `boundary-removal`, but this plan set lists `boundary-removal` as a dependency. This plan treats the boundary-removal result as present: direct playbook client route keys and types are unavailable. If implementation runs before boundary removal, these edits still unblock boundary-removal's preflight by removing the Console direct caller first.

## Scope

### In Scope
- Delete the core System `PlaybooksSection` component.
- Remove System view playbook list state, fetches, load lifecycle handling, and surface keys.
- Remove Console selectors and tests that depend on playbook-specific client wire types.
- Keep playbook management visible through `ExtensionContributionsSection` when `eforge-playbooks` registers Console contribution blocks.
- Keep optional workstation visibility through the existing generic Workstations route if an extension registers a workstation.
- Add Console boundary tests that assert eforge-playbooks contributions render through generic contribution manifests and that core Playbooks ownership tokens are absent.
- Update affected System view tests so they no longer mock or expect `API_ROUTES.playbookList`.

### Out of Scope
- Creating or modifying the `eforge-playbooks` extension contribution manifest.
- Adding a playbook-specific Console workstation or renderer.
- Migrating CLI, MCP/Claude, Pi commands/tools, or skills.
- Removing daemon/client playbook routes and helpers outside Console.
- Updating public docs or generated reference artifacts.
- Adding compatibility routes, compatibility client helpers, or playbook-specific Console fetch adapters.

## Implementation Approach

### Overview

Remove the direct playbook data path from the System view and leave Console playbook UX to the generic extension contribution pipeline:

1. Delete the `PlaybooksSection` component and remove it from `SystemViewContent`.
2. Remove `PlaybookListResponse`/`PlaybookListEntry` imports and all `playbooks` state from System types, fetches, and hooks.
3. Remove `selectPlaybookModeCounts` because its only consumer is the deleted core section and it depends on a playbook-specific client type removed by boundary-removal.
4. Keep `ExtensionContributionsSection` directly after `ExtensionsSection`; it already renders action buttons/forms from generic extension manifests and invokes actions through `invokeExtensionAction`.
5. Update System tests to use a `SystemSurfacesState` without `playbooks`, stop mocking `API_ROUTES.playbookList`, and assert eforge-playbooks inventory/run controls appear only as generic extension contribution blocks.
6. Add a source-audit test for Console-owned files so `PlaybooksSection`, `fetchSystemPlaybookList`, `API_ROUTES.playbook*`, `PlaybookListResponse`, and `selectPlaybookModeCounts` cannot return without a failing test.

### Key Decisions

1. **Remove rather than hide the core section.**
   - Rationale: retaining a disabled or empty `PlaybooksSection` would still make System own playbook inventory and would preserve dead playbook-specific types after boundary-removal.

2. **Use existing generic contribution rendering without playbook-specific branching.**
   - Rationale: `eforge-playbooks` registers Console contribution blocks that reference `eforge-playbooks:*` actions. `ExtensionContributionCard` already invokes those through generic `invokeExtensionAction` with Console provenance.

3. **Delete playbook-specific selectors from Console.**
   - Rationale: after direct client wire types are removed, keeping `selectPlaybookModeCounts` would require redeclaring playbook wire shapes in Console, which the architecture forbids.

4. **Do not add extension-unavailable playbook UI.**
   - Rationale: extension availability belongs to generic extension list/validation/contribution diagnostics. When `eforge-playbooks` is not loaded, the System view displays no playbook management panel instead of falling back to a core-owned route.

5. **Source-audit Console boundaries in package-local tests.**
   - Rationale: compile failures catch removed client types, while source-audit tests catch future reintroduction of direct playbook System ownership even if a developer re-adds local types.

## Files

### Create
- `packages/console-ui/src/views/system/__tests__/playbook-console-boundary.test.tsx` — render `SystemViewContent` with an `eforge-playbooks` contribution manifest, assert no core `Playbooks` section heading exists, click a contribution action bound to `eforge-playbooks:list-playbooks`, assert `invokeExtensionAction` receives the generic action id/provenance, and source-audit Console files for removed direct playbook ownership tokens.

### Modify
- `packages/console-ui/src/views/system/system-view-content.tsx` — remove `PlaybooksSection` import/rendering and change header copy from "extensions, playbooks, and model catalog" to extension-owned contribution wording `[region: console-surface, System content section list and header copy]`.
- `packages/console-ui/src/views/system/system-types.ts` — remove `PlaybookListResponse` import/re-export, remove `SystemSurfacesState.playbooks`, and remove `playbooks.list` from `SystemSurfaceKey` `[region: console-surface, System surface type cleanup]`.
- `packages/console-ui/src/views/system/system-fetches.ts` — remove `PlaybookListResponse` import and delete `fetchSystemPlaybookList`; retain generic `fetchSystemExtensionContributionManifest` `[region: console-surface, System fetch helper cleanup]`.
- `packages/console-ui/src/views/system/use-system-surfaces.ts` — remove `fetchSystemPlaybookList` import, initial `playbooks` state, loading transition, success/error update handlers, and stale playbook data handling `[region: console-surface, System load lifecycle cleanup]`.
- `packages/console-ui/src/lib/selectors/system.ts` — remove `PlaybookListEntry` import, `PlaybookModeCounts`, and `selectPlaybookModeCounts`; keep profile, extension, config, and model selectors.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` — remove `playbooks` from `makeState`, update the section-order test to assert Extension Contributions renders after Extensions and before Models, and add an assertion that the core `Playbooks` heading is absent when extension contributions are empty `[region: console-surface, System content fixture and order assertions]`.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` — remove `fetchSystemPlaybookList` import and the `API_ROUTES.playbookList` successful GET case; add an assertion that the GET helper matrix contains no helper name matching `Playbook` `[region: console-surface, System fetch test cleanup]`.
- `packages/console-ui/src/views/system/__tests__/use-system-surfaces.test.tsx` — remove the `API_ROUTES.playbookList` mock response and add an assertion that recorded fetch URLs contain no `play` + `book` fragment during initial load `[region: console-surface, System hook test cleanup]`.
- `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts` — remove `selectPlaybookModeCounts` import, `PlaybookListEntry` import, and the playbook mode selector test block `[region: console-surface, System selector test cleanup]`.

### Delete
- `packages/console-ui/src/views/system/playbooks-section.tsx` — delete the core Console Playbooks section component `[region: console-surface, delete core Playbooks section]`.

## Testing Strategy

### Unit Tests
- Update System type/fetch/hook tests so a `SystemSurfacesState` instance contains `daemon`, `config`, `profiles`, `extensions`, and `models`, with no `playbooks` member.
- Verify `fetchSystemHealth`, config/profile/extension/model helpers still use `API_ROUTES` route keys and that no System fetch helper references `API_ROUTES.playbookList`.
- Verify `useSystemSurfaces()` still marks extension contribution manifests as `success`, `empty`, or `error` and does not issue a playbook-list fetch.
- Verify `SystemViewContent` renders daemon/config/profile/extensions/contributions/models/stack sections and does not render a core `Playbooks` heading.
- Verify `ExtensionContributionsSection` renders an `eforge-playbooks` contribution and invokes `eforge-playbooks:list-playbooks` via `invokeExtensionAction({ actionId, input, requestedBy })`.
- Verify source-audit test fixtures contain no direct ownership tokens in the Console files changed by this module.

### Integration Tests
- Run Console package tests for System views and generic extension contribution rendering after `boundary-removal` has removed playbook client route/type exports.
- Run `pnpm --filter @eforge-build/console-ui type-check` to prove Console compiles without playbook-specific client wire types.
- Run the dependency module's `eforge-playbooks` registration test to prove the extension still contributes Console blocks that this module renders generically.

## Verification

- [ ] `packages/console-ui/src/views/system/playbooks-section.tsx` is absent.
- [ ] `rg -n "PlaybooksSection|fetchSystemPlaybookList|API_ROUTES\.playbook|PlaybookListResponse|PlaybookListEntry|selectPlaybookModeCounts|playbooks\.list|state\.playbooks" packages/console-ui/src --glob '!**/__tests__/**' --glob '!node_modules/**' --glob '!dist/**'` returns zero matches.
- [ ] `SystemSurfacesState` contains no `playbooks` property and `SystemSurfaceKey` contains no `playbooks.list` member.
- [ ] `SystemViewContent` contains no import from `./playbooks-section` and renders no heading named `Playbooks` when supplied an empty contribution manifest.
- [ ] `ExtensionContributionsSection` renders a manifest entry with action id `eforge-playbooks:list-playbooks` and clicking its action button calls `invokeExtensionAction` with `requestedBy.host` equal to `console` and `requestedBy.surface` equal to `contribution:<manifest id>`.
- [ ] `useSystemSurfaces()` initial refresh records no fetch URL containing the fragment `play` + `book`.
- [ ] Targeted tests pass: `pnpm vitest run packages/console-ui/src/views/system/__tests__/playbook-console-boundary.test.tsx packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx packages/console-ui/src/views/system/__tests__/system-fetches.test.ts packages/console-ui/src/views/system/__tests__/use-system-surfaces.test.tsx packages/console-ui/src/views/system/__tests__/system-selectors.test.ts packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx`.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] Dependency smoke test passes: `pnpm vitest run eforge/extensions/eforge-playbooks/__tests__/registration.test.ts`.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "api"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
