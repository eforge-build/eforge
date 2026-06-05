---
title: Add Console Extension Management Surface
created: 2026-06-05
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Add Console Extension Management Surface

## Problem / Motivation

Backlog source: `.backlog/items/backlog-2026-06-04-design-and-implement-console-extension-management-surface.md`.

Console currently surfaces native extensions in two partial ways: a System list/validation summary and Needs attention Trust/Re-trust alerts for untrusted project-team extensions. Operators still need CLI/Pi/Claude tools for routine extension management actions such as targeted validation, reload, untrust, promote, and demote.

This gap matters because native extensions are trusted unsandboxed code. Management actions should be visible, guided, confirmed, and backed by the same daemon/client APIs as other hosts rather than hidden behind command-line workflows. A first-class Console area also aligns with the roadmap goal of making Console the local-first control surface for configuration and extensions.

Validated facts and evidence:

- `docs/roadmap.md` names Console as the canonical local-first control surface and explicitly includes managing extensions through typed daemon/client APIs under Console Observability and Control.
- `packages/console-ui/README.md` says System (`/console/system`) is the home for configuration and diagnostic surfaces that do not need top-level route prominence, and that extension-supplied arbitrary frontend bundles remain deferred.
- `packages/console-ui/src/views/system/system-view-content.tsx` renders `ExtensionsSection` and `ExtensionContributionsSection`.
- `ExtensionsSection` lists discovered extensions, registration totals, diagnostics, and Trust/Re-trust buttons only for project-team entries needing trust.
- `packages/console-ui/src/hooks/use-extension-trust-mutation.ts`, `packages/console-ui/src/components/extensions/trust-confirm-dialog.tsx`, and recovery confirmation components show the existing pattern for confirmed mutating actions, per-target pending/error/success state, and refresh-after-success.
- `packages/client/src/routes/route-map.ts`, `packages/client/src/api/extensions.ts`, `packages/client/src/types.ts`, and `packages/monitor/src/routes/extensions/*` already expose list/show/validate/test/new/reload/trust/untrust/install/update/remove/promote/demote routes and wire types.
- No new daemon route is needed for a first management UI slice.
- `packages/console-ui/src/views/system/system-fetches.ts` already uses `API_ROUTES` and client/browser wire types for System fetches.
- Browser exports include extension management response/request types.
- There are no browser-specific extension-management fetch helpers beyond contributions.
- This work can add Console-local fetch helpers while still using client-owned route constants and wire types.
- Code search found Trust/Re-trust attention and System list/validate/contribution surfaces.
- Code search found no Console workflow for untrust, reload, per-extension validate, promote, demote, install/update/remove, or guided full management with unsandboxed-code warnings.

Classification: feature / focused. This is user-facing Console functionality with limited daemon architecture impact because the daemon/client API surface already exists.

## Goal

Add a first-class native extension management area under `/console/system` that lets operators inspect discovered extensions and safely run low-input management actions through existing typed daemon/client APIs.

The first slice should cover reload, selected validation, trust/re-trust, untrust, promote, and demote while preserving current Needs attention trust behavior and deferring higher-risk package lifecycle workflows.

## Approach

### Placement and UI model

- Place the management surface under `/console/system`, not a new top-level route.
- Expand or split the existing `ExtensionsSection` rather than adding a new top-level Console route.
- Prefer a selected-row details panel or expandable details over cramming all metadata into each list row.
- Treat `ExtensionEntry` from list/show as authoritative display data.
- Use row/action eligibility logic rather than rendering every daemon action for every extension.
- Unsupported actions should be hidden or disabled with explanatory text based on extension scope, status, and trust state.
- Keep the current inventory scannable while exposing dense management metadata in selected-extension details.
- Preserve the current Needs attention Trust/Re-trust flow.

### Actions and safety

- Add a global **Reload extensions** control backed by `API_ROUTES.extensionReload`.
- Add per-extension **Validate** control backed by `API_ROUTES.extensionValidate` with `name` or `path` query as appropriate.
- Add confirmed per-extension **Trust/Re-trust** controls for project-team extensions where daemon semantics support them.
- Preserve `trustedBy: 'console-ui'` for trust.
- Add confirmed per-extension **Untrust** controls for project-team extensions where daemon semantics support them.
- Add confirmed **Promote** for project-local extensions.
- Add confirmed **Demote** for project-team extensions.
- Add overwrite/trust controls for promote/demote only if the existing daemon request supports them safely and the UI can present the consequence clearly.
- Use default no-force/no-trust promote/demote behavior first unless clear confirmation copy is implemented.
- All mutating controls use an `AlertDialog` confirmation before the fetch call.
- Confirmation copy must include unsandboxed-code or supply-chain warnings.
- Confirmation copy must name the target extension when applicable.
- Confirmation copy must include target identity, path, current scope/trust state, and action consequence.
- Trust/promote-with-trust copy must explicitly say the code may execute after reload.
- Reload copy must mention watcher restart behavior from `ExtensionReloadResponse`.
- Surface daemon errors verbatim in `role="alert"` without hiding the action row.

### Data and API usage

- Use `API_ROUTES` and client/browser request/response types only.
- Do not add raw `/api/...` literals.
- Do not create local daemon wire-shape interfaces.
- Add Console-local browser fetch helpers if needed while still using client-owned route constants and wire types.
- Refresh the extension list, global validation, and contribution manifest after successful mutations.
- Reuse the existing `useSystemSurfaces.refresh()` function after successful mutations.
- Keep selected validate results in local component state if needed.
- Keep broad management mutation state local to the management surface unless Now attention trust behavior needs to share it.
- Do not add new daemon routes or new daemon wire shapes unless source inspection during implementation proves an existing route cannot support the UI safely.
- If implementation discovers a missing browser export from `packages/client/src/browser.ts`, add only a type/export plumbing change, not a new local interface.

### Likely implementation targets

- `packages/console-ui/src/views/system/extensions-section.tsx`
  - Expand from a compact list into a management surface or split into smaller components to stay within maintainability limits.
  - Add action buttons/menus, selected row detail rendering, per-action status, and result/diagnostic displays.
  - The file is currently 189 lines, so splitting is preferred if the feature grows.
- New files under `packages/console-ui/src/views/system/`
  - Possible files include `extension-management-section.tsx`, `extension-management-actions.tsx`, or `extension-management-selectors.ts`.
- `packages/console-ui/src/views/system/system-fetches.ts`
  - Add Console browser fetch helpers for reload, untrust, validate selected extension, promote, and demote.
  - Use `API_ROUTES` and imported client/browser request/response types.
  - Preserve existing `trustSystemExtension` behavior and `CONSOLE_EXTENSION_TRUSTED_BY` constant.
- `packages/console-ui/src/views/system/system-types.ts`
  - Re-export any additional extension request/response types already exported by `@eforge-build/client/browser` if components need them.
  - Do not create local daemon wire-shape interfaces.
- `packages/console-ui/src/views/system/use-system-surfaces.ts`
  - Reuse the existing `refresh()` function after successful mutations.
  - Avoid duplicate surface fetch state unless selected validate results need local component state.
- `packages/console-ui/src/views/system/system-view-content.tsx`
  - Thread broader extension management controls/hooks if the existing trust hook becomes a generic management hook.
- `packages/console-ui/src/views/system/system-configuration-view.tsx`
  - Thread broader extension management controls/hooks if the existing trust hook becomes a generic management hook.
- `packages/console-ui/src/hooks/use-extension-trust-mutation.ts`
  - Either preserve as-is and add a separate management hook, or generalize carefully to multi-action per-target state.
  - Keep the Now attention Trust/Re-trust flow working.
- `packages/console-ui/src/components/extensions/trust-confirm-dialog.tsx`
  - Reuse or create a more generic extension action confirmation dialog that includes unsandboxed-code warnings and target metadata for trust, untrust, promote, demote, and reload.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts`
  - Extend tests for new route helpers and request bodies.
- `packages/console-ui/src/views/system/__tests__/extensions-section.test.tsx`
  - Extend or split tests for action eligibility and confirmation behavior.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx`
  - Extend tests only if section composition or order changes.
- `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts`
  - Add selector tests if action eligibility is modeled as pure selectors.
- `packages/console-ui/README.md`
  - Update System data-flow/route notes to mention the management area and any intentionally deferred actions.
- Public docs likely do not need regeneration unless user-facing reference text changes outside Console README.

### Existing daemon/client files that should mostly remain unchanged

- `packages/client/src/routes/route-map.ts`
- `packages/client/src/api/extensions.ts`
- `packages/client/src/types.ts`
- `packages/monitor/src/routes/extensions/*`

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Existing daemon/client extension routes are sufficient for the first management slice. | Read `packages/client/src/routes/route-map.ts`, `packages/client/src/api/extensions.ts`, `packages/client/src/types.ts`, and `packages/monitor/src/routes/extensions/*`; routes and wire types exist for list/show/validate/test/new/reload/trust/untrust/install/update/remove/promote/demote. | high | low | During implementation, compile against imported route constants/types and add fetch-helper tests for each used route. | New daemon route work would expand scope and require API design. |
| The System route is the correct Console location. | Read `packages/console-ui/README.md`; it says System is for configuration/diagnostic surfaces and specifically lists extensions. Roadmap says Console should manage extensions through typed APIs. | high | low | Keep implementation under `src/views/system/`; update README if section behavior changes. | A top-level route would require navigation updates and likely over-promote this surface. |
| A selected-row/detail-panel UI can expose enough metadata without a new show endpoint call for every row. | `ExtensionEntry` in `packages/client/src/types.ts` includes path, entrypoint, scope/source/status, trust metadata, shadows, registration counts/details, diagnostics, package provenance, and install provenance. | high | low | If design needs a canonical detail refresh, use existing `API_ROUTES.extensionShow` by name; do not add new wire shapes. | UI might omit useful detail or require a targeted fetch helper. |
| Install/update/remove/new/test should be deferred from this first slice. | Docs and types show these actions require extra source/package/replay/force inputs; package docs warn about unsandboxed supply-chain risk. The backlog said these are possible, not mandatory. | medium | low | Confirm with product owner if they want package lifecycle in the same PRD before build; otherwise document as deferred. | If users expect full package management immediately, this slice may feel incomplete. |
| Promote/demote can be safely represented as row-based actions. | Monitor package routes support promote/demote by name/path with optional force/trust; `ExtensionEntry.scope` distinguishes project-local and project-team candidates. | medium-high | low | Implement conservative eligibility and use default no-force/no-trust first; add force/trust controls only if clear confirmation copy is implemented. | Promote/demote might fail for shadowed or conflicting targets and need better blockers/explanations. |
| Broad management mutations should not change Now attention trust behavior. | Current Now attention trust flow uses `useExtensionTrustMutation` and `TrustConfirmDialog`; System can reuse or wrap without changing selectors. | high | low | Keep existing tests in `extensions-section.test.tsx` and Now attention tests passing; avoid changing trust hook API unless all callers update. | A regression could break Needs attention trust alerts. |
| Console-local browser fetch helpers are acceptable if they use client-owned routes and types. | Existing `system-fetches.ts` already follows this pattern for System surfaces. Project policy forbids raw route literals and local wire interfaces, not local browser `fetch` wrappers. | high | low | Add tests asserting every helper uses `API_ROUTES`; grep for raw `/api/extensions` literals after implementation. | If policy prefers moving helpers into `@eforge-build/client/browser`, implementation target changes. |
| Refreshing list, validate, and contributions after mutation is enough to restore authoritative state. | Existing `useSystemSurfaces.refresh()` fetches extension list, validation, and contribution manifest independently; README describes refresh-after-mutation as the Console pattern. | high | low | Use the existing refresh callback after success; component tests can assert refresh is called. | Some mutation-specific response details could be lost if the full refresh races or fails. |
| Low-confidence/high-impact assumptions have been resolved or scoped out. | The only medium-risk product assumption is whether to include install/update/remove/new/test; it is explicitly out of scope and listed as a follow-up design choice. | high | low | User can override before build if they want package lifecycle in scope. | Scope expansion would require revisiting acceptance criteria and likely planning depth. |

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is a cohesive Console feature spanning several UI files and tests, but it does not require delegated module planning or a new daemon/client API design. A single planner can enumerate the code impact, action eligibility, confirmation UX, and tests. It is more than an Errand because it includes multiple mutating workflows and trust/safety UX.

## Scope

In scope:

- Add a first-class native extension management area under `/console/system`.
- Show discovered extension inventory.
- Show selected-extension details using existing `ExtensionEntry` data.
- Show extension name.
- Show extension path.
- Show extension entrypoint.
- Show extension scope.
- Show extension source.
- Show extension enabled/status state.
- Show extension trust/trustState/hash metadata.
- Show extension package/install provenance.
- Show extension registration counts/details.
- Show extension shadows.
- Show extension diagnostics.
- Add global **Reload extensions** control backed by `API_ROUTES.extensionReload`.
- Show watcher restart metadata after reload.
- Refresh extension/contribution state after reload.
- Add per-extension **Validate** control backed by `API_ROUTES.extensionValidate`.
- Use `name` or `path` query for validate as appropriate.
- Display selected validation diagnostics without replacing global validation status.
- Add confirmed per-extension **Trust/Re-trust** controls for project-team extensions where daemon semantics support them.
- Preserve `trustedBy: 'console-ui'` for trust.
- Add confirmed **Untrust** controls for project-team extensions where daemon semantics support them.
- Add confirmed **Promote** for project-local extensions.
- Add confirmed **Demote** for project-team extensions.
- Add overwrite/trust controls only if the existing daemon request supports them safely and the UI can present the consequence clearly.
- Keep all mutating actions confirmation-gated.
- Include unsandboxed-code/supply-chain warnings in confirmation copy.
- Include target identity, path, and scope in confirmation copy.
- Refresh extension list, global validation, and contribution manifest after successful mutations.
- Add Console tests for fetch helpers.
- Add Console tests for action availability/eligibility.
- Add Console tests for confirmation-before-mutation.
- Add Console tests for pending/error/success rendering.
- Add Console tests for refresh-after-success.

Out of scope for this first slice:

- New daemon routes unless source inspection during implementation proves an existing route cannot support the UI safely.
- New daemon wire shapes unless source inspection during implementation proves an existing route cannot support the UI safely.
- Arbitrary extension-supplied Console JavaScript.
- Arbitrary extension-supplied React bundles.
- Frontend plugin loaders.
- Extension-owned HTTP routes.
- `extension new` forms.
- `extension install` forms.
- `extension update` forms.
- `extension remove` forms.
- `extension test` forms.
- Package/source input UX.
- Replay-source UX.
- Global extension enable/disable workflows.
- Changing Pi extension management tools.
- Changing Claude extension management tools.

## Acceptance Criteria

- `/console/system` renders a first-class native extension management area.
- The native extension management area lists discovered extensions.
- The selected-extension details render the extension name.
- The selected-extension details render the extension path.
- The selected-extension details render the extension entrypoint.
- The selected-extension details render the extension scope.
- The selected-extension details render the extension source.
- The selected-extension details render the extension status.
- The selected-extension details render the extension enabled state.
- The selected-extension details render the extension trust state.
- The selected-extension details render extension trust metadata when present.
- The selected-extension details render extension hash metadata when present.
- The selected-extension details render extension registration counts.
- The selected-extension details render extension registration details.
- The selected-extension details render extension shadows.
- The selected-extension details render extension diagnostics.
- The selected-extension details render extension package provenance when present.
- The selected-extension details render extension install provenance when present.
- The management area renders a global `Reload extensions` control.
- The `Reload extensions` control calls `API_ROUTES.extensionReload` only after confirmation.
- The reload success state displays the daemon reload message.
- The reload success state displays watcher restart metadata from `ExtensionReloadResponse`.
- Each extension row or detail panel exposes a `Validate` control.
- The `Validate` control calls `API_ROUTES.extensionValidate` with exactly one selected target identifier.
- The selected validation request uses `name` or `path` as appropriate for the selected extension.
- The selected validation result is displayed.
- The selected validation diagnostics are displayed.
- The selected validation display does not discard the global validation summary.
- Project-team extensions with `trustState: "untrusted"` render a confirmed `Trust` control.
- Project-team extensions with `trustState: "changed"` render a confirmed `Re-trust` control.
- The `Trust` control POSTs `trustedBy: "console-ui"` to `API_ROUTES.extensionTrust` only after confirmation.
- The `Re-trust` control POSTs `trustedBy: "console-ui"` to `API_ROUTES.extensionTrust` only after confirmation.
- Project-team extensions that can be untrusted render a confirmed `Untrust` control.
- The `Untrust` control POSTs to `API_ROUTES.extensionUntrust` only after confirmation.
- Project-local extensions render a confirmed `Promote` control backed by `API_ROUTES.extensionPromote`.
- Project-team extensions render a confirmed `Demote` control backed by `API_ROUTES.extensionDemote`.
- Unsupported actions are hidden or disabled with explanatory text based on extension scope, status, and trust state.
- Unsupported actions do not send requests that are predictably invalid for the selected extension.
- The reload confirmation dialog includes an action-consequence warning.
- The reload confirmation dialog mentions watcher restart behavior.
- The trust confirmation dialog includes the target extension identity.
- The trust confirmation dialog includes the target extension path.
- The trust confirmation dialog includes the target extension scope.
- The trust confirmation dialog includes the target extension trust state.
- The trust confirmation dialog warns that unsandboxed code may execute after reload.
- The re-trust confirmation dialog includes the target extension identity.
- The re-trust confirmation dialog includes the target extension path.
- The re-trust confirmation dialog includes the target extension scope.
- The re-trust confirmation dialog includes the target extension trust state.
- The re-trust confirmation dialog warns that unsandboxed code may execute after reload.
- The untrust confirmation dialog includes the target extension identity.
- The untrust confirmation dialog includes the target extension path.
- The untrust confirmation dialog includes the target extension scope.
- The untrust confirmation dialog includes an action-consequence warning.
- The promote confirmation dialog includes the target extension identity.
- The promote confirmation dialog includes the target extension path.
- The promote confirmation dialog includes the target extension scope.
- The promote confirmation dialog includes an action-consequence warning.
- The demote confirmation dialog includes the target extension identity.
- The demote confirmation dialog includes the target extension path.
- The demote confirmation dialog includes the target extension scope.
- The demote confirmation dialog includes an action-consequence warning.
- Trust/promote-with-trust confirmation copy explicitly says the code may execute after reload when trust is part of the action.
- Successful extension management mutations refresh the extension list before reporting the action as complete.
- Successful extension management mutations refresh the extension validation summary before reporting the action as complete.
- Successful extension management mutations refresh the contribution manifest before reporting the action as complete.
- Failed extension management mutations display the daemon error message in a `role="alert"` element.
- Failed extension management mutations keep the target extension row visible.
- Failed extension management mutations keep the target extension row actionable.
- Console code imports extension request/response types from `@eforge-build/client/browser`.
- Console code uses `API_ROUTES` for every extension management request.
- Console code adds zero raw `/api/extensions` path literals.
- Console code adds zero locally re-declared daemon extension response interfaces.
- Tests verify the reload fetch helper URL.
- Tests verify the reload fetch helper request body behavior.
- Tests verify the selected validate fetch helper URL.
- Tests verify the selected validate fetch helper request body behavior.
- Tests verify the untrust fetch helper URL.
- Tests verify the untrust fetch helper request body.
- Tests verify the promote fetch helper URL.
- Tests verify the promote fetch helper request body.
- Tests verify the demote fetch helper URL.
- Tests verify the demote fetch helper request body.
- Tests verify trust action eligibility using a representative project-team untrusted extension entry.
- Tests verify re-trust action eligibility using a representative project-team changed extension entry.
- Tests verify untrust action eligibility using a representative project-team trusted extension entry.
- Tests verify promote action eligibility using a representative project-local extension entry.
- Tests verify demote action eligibility using a representative project-team extension entry.
- Tests verify validate action eligibility using a representative project-local extension entry.
- Tests verify validate action eligibility using a representative project-team extension entry.
- Tests verify validate action eligibility using a representative user extension entry.
- Tests verify reload action availability.
- Tests verify unsupported management actions are hidden or disabled for representative user extension entries.
- Tests verify the reload fetch helper is not called before the confirmation dialog action is clicked.
- Tests verify the trust fetch helper is not called before the confirmation dialog action is clicked.
- Tests verify the re-trust fetch helper is not called before the confirmation dialog action is clicked.
- Tests verify the untrust fetch helper is not called before the confirmation dialog action is clicked.
- Tests verify the promote fetch helper is not called before the confirmation dialog action is clicked.
- Tests verify the demote fetch helper is not called before the confirmation dialog action is clicked.
- Tests verify pending state rendering for an extension management mutation.
- Tests verify a successful reload mutation renders daemon success feedback.
- Tests verify a successful trust or re-trust mutation renders daemon success feedback.
- Tests verify a successful untrust mutation renders daemon success feedback.
- Tests verify a successful promote mutation renders daemon success feedback.
- Tests verify a successful demote mutation renders daemon success feedback.
- Tests verify a successful reload mutation calls the System refresh callback.
- Tests verify a successful trust or re-trust mutation calls the System refresh callback.
- Tests verify a successful untrust mutation calls the System refresh callback.
- Tests verify a successful promote mutation calls the System refresh callback.
- Tests verify a successful demote mutation calls the System refresh callback.
- Tests verify a failed extension management mutation renders daemon error feedback in `role="alert"`.
- Tests verify a failed extension management mutation does not call the System refresh callback.
- `packages/console-ui/README.md` System data-flow or route notes mention the extension management area.
- `packages/console-ui/README.md` mentions intentionally deferred extension actions when the section documents management behavior.
- `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- Targeted Console extension/system tests for the changed files pass.