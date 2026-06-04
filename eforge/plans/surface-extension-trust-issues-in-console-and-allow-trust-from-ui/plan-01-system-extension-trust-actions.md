---
id: plan-01-system-extension-trust-actions
name: System Extension Trust Actions
branch: surface-extension-trust-issues-in-console-and-allow-trust-from-ui/plan-01-system-extension-trust-actions
---

# System Extension Trust Actions

## Architecture Context

Console already receives extension trust fields from the daemon and the daemon already exposes `API_ROUTES.extensionTrust`. This plan adds the shared Console-side trust selector, POST helper, mutation state, and System route controls. It keeps trust semantics in the daemon and targets extensions by path to avoid ambiguous name conflicts.

## Implementation

### Overview

Add pure selection for project-team extensions needing trust, add a typed Console POST helper that sends `{ path, trustedBy: 'console-ui' }` to `API_ROUTES.extensionTrust`, and wire Trust/Re-trust controls into the System Extensions rows with per-path pending, success, and error state. A successful trust mutation triggers a System data refresh.

### Key Decisions

1. Use `path` rather than `name` for mutation targets because the daemon accepts path targets and name targets can return 409 for ambiguous project-team candidates.
2. Use `trustedBy: 'console-ui'` as stable provenance for trust-store records.
3. Keep selectors pure and place mutation state in a React hook so System and Now can share the same trust action behavior.
4. Re-export missing browser-safe extension trust types from `@eforge-build/client/browser` only if the Console code needs them; do not duplicate wire response interfaces in Console.

## Scope

### In Scope

- Select project-team extensions needing trust when `trustState` is `untrusted` or `changed`.
- Treat project-team entries with absent `trustState` and `trust === 'untrusted'` as needing trust for legacy payloads.
- Add a browser-safe typed trust POST helper that uses `API_ROUTES.extensionTrust`.
- Add a reusable Console extension trust mutation hook with per-path pending/error/success state.
- Add Trust and Re-trust controls in the System Extensions section.
- Refresh System extension data after a trust mutation succeeds.
- Add selector, fetch helper, hook, and System UI tests.

### Out of Scope

- Daemon route changes or trust-store semantic changes.
- Extension reload or validation after trust.
- Untrust, install, update, promote, or demote controls.
- Trust controls for user, project-local, external, or `not-required` extensions.

## Files

### Create

- `packages/console-ui/src/hooks/use-extension-trust-mutation.ts` — shared hook that calls the trust helper, tracks pending path, errors, success messages, and invokes a caller-supplied refresh callback after success.

### Modify

- `packages/client/src/browser.ts` — export `ExtensionTrustState`, `ExtensionTrustRequest`, and `ExtensionTrustResponse` as browser-safe types if they are not already exported.
- `packages/console-ui/src/views/system/system-fetches.ts` — add `CONSOLE_EXTENSION_TRUSTED_BY = 'console-ui'` and `trustSystemExtension(path, signal?)`; send a POST to `API_ROUTES.extensionTrust` with JSON headers/body, parse daemon `{ error }` responses into thrown `Error` messages, and return the typed trust response.
- `packages/console-ui/src/lib/selectors/system.ts` — add `extensionNeedsTrust`, `selectExtensionsNeedingTrust`, and an action-label helper that maps `changed` to `Re-trust` and untrusted/legacy-untrusted to `Trust`.
- `packages/console-ui/src/views/system/extensions-section.tsx` — accept trust action props, render Trust/Re-trust buttons only for selected project-team rows, disable the active row while pending, and render per-row `role="alert"` errors plus success/status copy without removing existing trust chips.
- `packages/console-ui/src/views/system/system-view-content.tsx` — thread trust action props into `ExtensionsSection`.
- `packages/console-ui/src/views/system/system-configuration-view.tsx` — instantiate the shared trust mutation hook and refresh System data after success.
- `packages/console-ui/src/views/system/__tests__/system-fetches.test.ts` — cover URL, method, headers, JSON body, `trustedBy`, typed response, and daemon error-message handling for trust POST.
- `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts` — cover untrusted, changed, trusted, not-required, legacy coarse trust, and non-project-team entries.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` or a new `packages/console-ui/src/views/system/__tests__/extensions-section.test.tsx` — cover Trust/Re-trust labels, click dispatch by selected path, pending disabled state, failed mutation error rendering, success message rendering, and refresh invocation after success.

## Database Migration

None.

## Verification

- [ ] `selectExtensionsNeedingTrust` returns only project-team untrusted, changed, and legacy `trust: 'untrusted'` entries.
- [ ] `selectExtensionsNeedingTrust` excludes trusted, not-required, project-local, user, and external entries.
- [ ] `trustSystemExtension('/repo/eforge/extensions/policy.ts')` calls `fetch` with `API_ROUTES.extensionTrust`, method `POST`, `Content-Type: application/json`, and body `{"path":"/repo/eforge/extensions/policy.ts","trustedBy":"console-ui"}`.
- [ ] A non-2xx trust response with JSON `{ "error": "Ambiguous" }` rejects with an `Error` whose message contains `Ambiguous`.
- [ ] System renders `Trust` for an untrusted project-team extension and `Re-trust` for a changed project-team extension.
- [ ] A failed System trust action leaves the Trust/Re-trust control visible and renders the failure text in a `role="alert"` element.
- [ ] A successful System trust action calls the System refresh callback once and renders the returned success/next-step message until refreshed data replaces the row state.
- [ ] `packages/console-ui/src` contains no new raw `'/api/extensions/trust'` literal outside client route constants.