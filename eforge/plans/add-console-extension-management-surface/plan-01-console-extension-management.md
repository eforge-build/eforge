---
id: plan-01-console-extension-management
name: Console Extension Management Surface
branch: add-console-extension-management-surface/plan-01-console-extension-management
agents:
  builder:
    effort: high
    rationale: The plan spans Console UI state, browser fetch helpers, action
      eligibility, and unsandboxed-code confirmation UX.
  reviewer:
    effort: high
    rationale: The UI controls extension trust and promotion/demotion actions for
      unsandboxed native code, so review needs extra attention to safety copy,
      eligibility, and API usage.
  tester:
    effort: high
    rationale: The acceptance criteria require confirmation gating, request body
      assertions, mutation state, refresh callbacks, and selected validation
      behavior across several UI paths.
---

# Console Extension Management Surface

## Architecture Context

Console's System route already loads extension inventory, global validation, and contribution manifest state through `useSystemSurfaces()` and `packages/console-ui/src/views/system/system-fetches.ts`. The daemon/client API surface for native extensions already exists in `@eforge-build/client`; Console code must consume `API_ROUTES` and browser-exported wire types instead of adding route literals or local daemon response shapes.

The current System extension section is a compact inventory with project-team Trust/Re-trust buttons. This plan turns that section into a first-class management area under `/console/system` while preserving the Now dashboard's existing Needs attention trust flow.

No database migration and no daemon route changes are in scope.

## Implementation

### Overview

Implement a selected-extension management surface inside the existing System Extensions section. Keep the inventory scannable, add a details panel for the selected extension, and wire low-input actions to existing daemon APIs with confirmation dialogs for every mutating action.

The first slice covers:

- Global Reload extensions.
- Per-extension selected Validate.
- Project-team Trust/Re-trust.
- Project-team Untrust.
- Project-local Promote.
- Project-team Demote.

Package lifecycle forms (`new`, `install`, `update`, `remove`, `test`) remain deferred.

### Key Decisions

1. **Console-local fetch wrappers, client-owned contracts.** Add browser fetch helpers in `system-fetches.ts` using `API_ROUTES` and request/response types from `@eforge-build/client/browser`. If a needed type such as `ExtensionUntrustRequest` or `ExtensionUntrustResponse` is missing from `packages/client/src/browser.ts`, add only that export plumbing.
2. **Conservative promote/demote.** Send default no-force/no-trust promote and demote bodies first. Do not add force overwrite or promote-with-trust controls in this slice unless the implementation also adds explicit consequence copy and tests for those options.
3. **Unambiguous targeting.** Use exactly one target identifier for every request. Use `path` for trust, untrust, promote, and demote so duplicate extension names do not select the wrong extension. For selected validation, use `path` for project-local and project-team entries and `name` for user/external entries whose paths can sit outside the project-root validation guard.
4. **System management state stays local to System.** Keep `useExtensionTrustMutation` and `TrustConfirmDialog` usable by the Now attention strip. Add a System-focused management hook/component state for reload, validate, untrust, promote, demote, and System trust actions.
5. **Refresh after successful mutations.** After every successful mutating action, invoke the System refresh callback before setting success feedback. If the callback returns a Promise in tests or future code, await it; with the current `useSystemSurfaces.refresh()` implementation, call it before recording success.
6. **Selected validation is separate from global validation.** Store selected validate result/error/pending state locally and render it alongside the existing global validation summary without replacing `state.extensions.validate`.

## Scope

### In Scope

- Render a native extension management area under `/console/system` inside the existing Extensions section.
- List discovered extensions and keep the existing list, validation, diagnostic, and Trust/Re-trust inventory behavior visible.
- Add selected-extension state and a details panel with fields from `ExtensionEntry`: name, path, entrypoint, scope, source, status, enabled, trust/trustState, current/trusted hash metadata, trust metadata, package provenance, install provenance, registration counts, registration details, shadows, and diagnostics.
- Add action eligibility selectors for validate, trust, re-trust, untrust, promote, and demote.
- Add confirmation-gated mutating actions for reload, trust/re-trust, untrust, promote, and demote.
- Include unsandboxed-code and supply-chain warnings in confirmation copy.
- Include target extension identity, path, scope, and current trust state when the action targets a row.
- Display reload daemon message and watcher restart metadata from `ExtensionReloadResponse`.
- Display selected validation result and diagnostics in the management area.
- Show daemon error messages verbatim in `role="alert"` elements.
- Keep rows visible and actionable after failed mutations.
- Update Console tests for fetch helpers, action eligibility, confirmation gating, pending/error/success state, and refresh-after-success.
- Update `packages/console-ui/README.md` System data-flow notes and deferred-action notes.

### Out of Scope

- New daemon routes.
- New daemon wire shapes.
- Arbitrary extension-supplied frontend bundles, React components, or browser JavaScript.
- Extension-owned HTTP routes.
- Forms for extension `new`, `install`, `update`, `remove`, or `test`.
- Package/source input UX and replay-source UX.
- Global extension enable/disable workflows.
- Pi extension management changes.
- Claude extension management changes.

## Files

### Create

- `packages/console-ui/src/views/system/extension-management-selectors.ts` — Pure UI selectors for extension keys, selected validate target, action eligibility, button labels, disabled reasons, and action consequence text. Import `ExtensionEntry` and related types from `@eforge-build/client/browser` or `./system-types`; do not declare daemon response interfaces.
- `packages/console-ui/src/views/system/use-extension-management-mutations.ts` — System-only hook for reload, selected validate, trust/re-trust, untrust, promote, and demote state. Track pending action, per-target errors, per-target success messages, reload result, and selected validation result. Call the fetch helpers and refresh callback from here.
- `packages/console-ui/src/views/system/extension-management-confirm-dialog.tsx` — Generic `AlertDialog` wrapper for reload/trust/re-trust/untrust/promote/demote. Render action-specific title, consequence text, unsandboxed-code/supply-chain warning, target metadata, and confirm/cancel controls.
- `packages/console-ui/src/views/system/extension-management-details.tsx` — Presentational details panel for the selected `ExtensionEntry`, including registration detail lists, trust/hash metadata, package/install provenance, shadows, diagnostics, selected validation output, and action controls. Keep this component focused so `extensions-section.tsx` remains under maintainability limits.
- `packages/console-ui/src/views/system/__tests__/extension-management-selectors.test.ts` — Selector tests for eligibility, target selection, labels, and representative unsupported action reasons.

### Modify

- `packages/client/src/browser.ts` — Export any missing extension management request/response types already defined in `packages/client/src/types.ts`, at minimum `ExtensionUntrustRequest` and `ExtensionUntrustResponse` if still absent. Do not add new types.
- `packages/console-ui/src/views/system/system-types.ts` — Re-export additional browser wire types used by the System extension management components, such as `ExtensionEntry`, `ExtensionReloadResponse`, `ExtensionUntrustRequest`, `ExtensionUntrustResponse`, `ExtensionPromoteRequest`, `ExtensionPromoteResponse`, `ExtensionDemoteRequest`, and `ExtensionDemoteResponse`.
- `packages/console-ui/src/views/system/system-fetches.ts` — Add fetch helpers for `reloadSystemExtensions`, `validateSelectedSystemExtension`, `untrustSystemExtension`, `promoteSystemExtension`, and `demoteSystemExtension`. Keep `trustSystemExtension` with `trustedBy: CONSOLE_EXTENSION_TRUSTED_BY`. Use a shared helper for non-2xx `{ error }` body parsing so mutating actions surface daemon messages verbatim.
- `packages/console-ui/src/views/system/extensions-section.tsx` — Replace the compact-only list with the management surface. Preserve section title/order, global validation summary, registration totals, diagnostics, and Trust/Re-trust behavior. Add reload control, selected row state, selected details, action buttons, selected validation state, and per-action feedback through the new hook/components.
- `packages/console-ui/src/views/system/system-view-content.tsx` — Thread System extension management controls or refresh callback changes into `ExtensionsSection` while keeping Extension Contributions immediately after Extensions.
- `packages/console-ui/src/views/system/system-configuration-view.tsx` — Use the new System management hook if it is instantiated at the route wrapper level. Keep `useExtensionTrustMutation` for Now; remove it from System only if the new hook covers System trust actions.
- `packages/console-ui/src/components/extensions/trust-confirm-dialog.tsx` — Keep backward compatibility for Now. Add optional scope metadata and update copy to mention unsandboxed native code execution after reload. Existing Now callers may omit scope; System callers must pass scope for trust/re-trust dialogs if this dialog is reused.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` — Add route, method, body, query, and daemon-error tests for reload, selected validate, untrust, promote, and demote helpers.
- `packages/console-ui/src/views/system/__tests__/extensions-section.test.tsx` — Expand tests for rendering details, action visibility, confirmation-before-mutation, pending/error/success feedback, selected validation display, reload watcher feedback, and refresh-after-success.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` — Update composition/order tests if prop names or heading text change.
- `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts` — Keep existing trust selector tests passing. Move new management selector tests into the new selector test file unless shared selectors are placed in `lib/selectors/system.ts`.
- `packages/console-ui/README.md` — Document System native extension management data flow, route constants used by the management area, refresh-after-mutation behavior, and explicitly deferred `new/install/update/remove/test` workflows.

## Implementation Notes

### Fetch helper behavior

- `reloadSystemExtensions()` posts to `API_ROUTES.extensionReload`, uses method `POST`, sends a JSON `{}` body for parity with the Node client helper, and returns `ExtensionReloadResponse`.
- `validateSelectedSystemExtension(target)` builds `API_ROUTES.extensionValidate` with `URLSearchParams` and exactly one `name` or `path` query parameter. It does not send a request body.
- `trustSystemExtension(path)` continues to post `{ path, trustedBy: CONSOLE_EXTENSION_TRUSTED_BY }` to `API_ROUTES.extensionTrust`.
- `untrustSystemExtension(path)` posts `{ path }` to `API_ROUTES.extensionUntrust`.
- `promoteSystemExtension(path)` posts `{ path }` to `API_ROUTES.extensionPromote` in the default no-force/no-trust mode.
- `demoteSystemExtension(path)` posts `{ path }` to `API_ROUTES.extensionDemote` in the default no-force mode.
- All POST helpers parse non-2xx JSON `{ error }` bodies and throw `Error(error)` when present.

### Action eligibility baseline

Implement eligibility in pure selectors so component tests can focus on rendering and confirmation:

- Reload is always available when the section renders.
- Validate is available for project-local, project-team, and user entries. It can also be available for external entries when a name exists, but the request must contain one target identifier.
- Trust is available for `scope === 'project-team'` with `trustState === 'untrusted'` or legacy `trust === 'untrusted'`.
- Re-trust is available for `scope === 'project-team'` with `trustState === 'changed'`.
- Untrust is available for `scope === 'project-team'` with `trustState === 'trusted'` or legacy `trust === 'trusted'`.
- Promote is available for `scope === 'project-local'`.
- Demote is available for `scope === 'project-team'`.
- User entries do not render trust, untrust, promote, or demote controls; render a disabled explanation or an "unavailable" note in the details panel.

### Confirmation copy requirements

- Reload dialog: mention extension discovery refresh and runtime watcher restart/replacement behavior.
- Trust/Re-trust dialog: name the extension, path, scope, trust state, and state that unsandboxed native code may execute after reload.
- Untrust dialog: name the extension, path, scope, trust state, and state that future reloads block the project-team extension until it is trusted again.
- Promote dialog: name the extension, path, scope, and state that project-local code moves into project-team scope where teammates may discover it. Do not say it is trusted unless a trust option is implemented.
- Demote dialog: name the extension, path, scope, and state that the project-team extension moves to project-local scope and its project-team trust record is removed by the daemon.
- All dialogs include a supply-chain or unsandboxed-code warning.

## Verification

- [ ] `/console/system` renders an Extensions section with a visible native extension management area and a global `Reload extensions` control.
- [ ] Selecting an extension row renders details for name, path, entrypoint, scope, source, status, enabled state, trust state, trust metadata, hash metadata, registration counts, registration details, shadows, diagnostics, package provenance, and install provenance when those fields exist on the `ExtensionEntry` fixture.
- [ ] Fetch helper tests assert reload uses `API_ROUTES.extensionReload`, method `POST`, JSON headers, and JSON `{}` body.
- [ ] Fetch helper tests assert selected validate uses `API_ROUTES.extensionValidate` with exactly one `name` or `path` query parameter and no body.
- [ ] Fetch helper tests assert untrust, promote, and demote use their `API_ROUTES` constants, method `POST`, JSON headers, and expected JSON bodies.
- [ ] Selector tests cover trust, re-trust, untrust, promote, demote, validate, reload availability, and unsupported user-entry actions with representative `ExtensionEntry` fixtures.
- [ ] Component tests assert reload, trust, re-trust, untrust, promote, and demote helpers are not called before the dialog confirm action is clicked.
- [ ] Component tests assert each mutating action can display pending, success, and daemon-error states while the target row remains rendered.
- [ ] Component tests assert successful reload, trust/re-trust, untrust, promote, and demote actions call the System refresh callback before success feedback is recorded.
- [ ] Component tests assert failed mutations render the daemon error in an element with `role="alert"` and do not call the System refresh callback.
- [ ] Component tests assert selected validation result and diagnostics render without removing the global validation summary.
- [ ] Component tests assert reload success feedback includes the daemon message and watcher metadata from `ExtensionReloadResponse`.
- [ ] `packages/console-ui/README.md` mentions the System extension management area and deferred `new/install/update/remove/test` workflows.
- [ ] `rg -n "['\"]/api/extensions" packages/console-ui/src` returns no matches added by this plan.
- [ ] No Console file declares a local daemon extension response interface; response types come from `@eforge-build/client/browser`.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] Targeted Console System tests for the changed files exit 0.
- [ ] `pnpm maintainability:check` exits 0.
