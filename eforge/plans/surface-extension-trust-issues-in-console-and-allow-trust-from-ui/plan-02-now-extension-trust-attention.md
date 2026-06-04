---
id: plan-02-now-extension-trust-attention
name: Now Extension Trust Attention
branch: surface-extension-trust-issues-in-console-and-allow-trust-from-ui/plan-02-now-extension-trust-attention
---

# Now Extension Trust Attention

## Architecture Context

The Now dashboard currently derives Needs attention from daemon stream, queue, and session state. This plan reuses the shared System trust selector and mutation helper from plan 01, adds a REST-backed extension-list read for Now, and extends the existing AttentionPanel with an extension trust action row. The engine and daemon contracts remain unchanged.

## Implementation

### Overview

Load extension list data on the Now route, pass the extensions into the Now attention selector, render untrusted/changed extension warnings in the Needs attention strip, and allow Trust/Re-trust directly from the strip. After a successful trust mutation, refresh the extension list so the item disappears when the daemon returns trusted state; failed mutations keep the warning visible and show the error text.

### Key Decisions

1. Keep Now attention derivation pure by passing extension entries into selector functions rather than reading inside selectors.
2. Reuse `selectExtensionsNeedingTrust` so System rows and Now alerts use the same trust-needed definition.
3. Add an `extensionTrust` payload to `NowAttentionItem` for action rows instead of overloading recovery payloads.
4. Keep Now actionable by invoking the same trust mutation helper from the strip; System remains the detailed extension-management surface.
5. Update Console README data-flow notes because Needs attention will include REST-backed extension trust data in addition to stream-derived health and queue state.

## Scope

### In Scope

- Add extension trust attention items with warning severity for untrusted and changed project-team extensions.
- Include legacy coarse-trust fallback items for project-team entries with absent `trustState` and `trust === 'untrusted'`.
- Add a Now-side extension-list hook or small data loader that fetches extension list data with existing route constants/helpers and preserves stale data across transient errors.
- Add Trust/Re-trust action rendering in `AttentionPanel` for extension trust items.
- Wire Now trust actions to the shared mutation hook and refresh Now extension data after success.
- Render trust action errors in the Needs attention row and keep failed items visible.
- Update Console README text for REST-backed extension trust attention and Console trust mutation flow.
- Add selector, component, dashboard, and docs-adjacent tests.

### Out of Scope

- SSE snapshot or daemon event contract changes.
- Extension auto-reload after trust.
- System navigation-only remediation in place of direct Now trust actions.
- New extension management controls beyond trust/re-trust.

## Files

### Create

- `packages/console-ui/src/hooks/use-extension-trust-list.ts` — Now-focused hook that fetches extension list data, exposes current extensions, error/loading state if needed by tests, and a refresh function for post-trust updates.

### Modify

- `packages/console-ui/src/lib/selectors/now.ts` — add an optional extension list input to `selectNowAttentionItems` and `selectNowDashboardModel`, add `NowAttentionItem.extensionTrust`, derive warning items from `selectExtensionsNeedingTrust`, use stable IDs/dedup keys from extension paths, and include extension items in `hiddenCount`.
- `packages/console-ui/src/views/now-dashboard.tsx` — call the extension trust list hook, pass extensions into the dashboard selector, wire the shared trust mutation hook, and pass pending/error maps plus the trust handler to `AttentionPanel`.
- `packages/console-ui/src/components/now/attention-panel.tsx` — render extension trust action rows with trust state detail, Trust/Re-trust buttons, pending disabled state, and per-path error text while preserving recovery and health rows.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — cover untrusted, changed, trusted, not-required, legacy coarse trust, warning severity, action labels, path payloads, and hidden-count inclusion.
- `packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx` — cover extension Trust/Re-trust rows, handler payloads, pending disabled state, and error rendering.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — mock extension list and trust fetches; cover warning display, POST body with path and `trustedBy`, disappearance after refreshed trusted data, and failed POST error rendering with the warning still present.
- `packages/console-ui/README.md` — update Now data-flow and Needs attention notes to mention REST-backed extension trust alerts and Console trust/re-trust mutations via route constants.

## Database Migration

None.

## Verification

- [ ] A project-team extension with `trustState: 'untrusted'` creates a warning `NowAttentionItem` with an `extensionTrust` payload containing its path and a `Trust` action label.
- [ ] A project-team extension with `trustState: 'changed'` creates a warning `NowAttentionItem` with an `extensionTrust` payload containing its path and a `Re-trust` action label.
- [ ] Project-team extensions with `trustState: 'trusted'` or `trustState: 'not-required'` create zero extension trust attention items.
- [ ] A project-team extension with no `trustState` and `trust: 'untrusted'` creates a warning extension trust attention item.
- [ ] `AttentionPanel` invokes the extension trust handler with `{ name, path, trustState, actionLabel }` from the selected row.
- [ ] Now dashboard sends trust POST requests to `API_ROUTES.extensionTrust` with the selected extension path and `trustedBy: 'console-ui'`.
- [ ] After a successful trust POST and refreshed extension list returning trusted state, the extension trust item is absent from Needs attention.
- [ ] After a failed trust POST, the extension trust item remains in Needs attention and its row contains the daemon error message.
- [ ] `packages/console-ui/README.md` no longer states that the entire Needs attention strip is fetch-free without mentioning extension trust data.
- [ ] No Console source file introduces a raw `/api/extensions/trust` route literal.