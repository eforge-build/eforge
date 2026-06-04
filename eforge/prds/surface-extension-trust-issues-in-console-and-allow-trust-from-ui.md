---
title: Surface Extension Trust Issues in Console and Allow Trust from UI
created: 2026-06-04
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Surface Extension Trust Issues in Console and Allow Trust from UI

## Problem / Motivation

The Console currently displays extension trust state in the System page, but it does not escalate untrusted or changed project-team extensions into the Now dashboard's Needs attention strip, and it does not provide a Console UI mutation to trust/re-trust the extension.

Why this matters: untrusted project-team extensions are skipped by the extension loader, including guardrails/policy surfaces that the user may assume are active. The current remediation path is outside Console, via `eforge extension trust <name>` or a Pi/MCP tool, so the Now dashboard can look healthy while extension guardrails are disabled.

Backlog source `.eforge/backlog/items/backlog-2026-06-04-surface-untrusted-extensions-in-console-needs-attention-and-.md` says Console should alert when discovered extensions are `untrusted` or `changed`, and should provide a UI path to mark/re-mark trust. The item was rechecked on 2026-06-04 and remains valid.

Roadmap alignment: `docs/roadmap.md` explicitly calls out Console Observability and Control, including managing extensions through typed daemon/client APIs, and Extension Platform trust mechanisms. This is aligned with those goals and keeps the engine headless.

Validated codebase facts:

- Extension trust data is already on the client wire model: `ExtensionTrustState = 'not-required' | 'untrusted' | 'trusted' | 'changed'` and `ExtensionEntry` has `trust`, `trustState`, `currentHash`, `trustedHash`, `trustedAt`, `trustedBy`, and `trustStorePath` in `packages/client/src/types.ts`.
- Typed route constants and client helpers already exist for extension trust: `API_ROUTES.extensionTrust`, `API_ROUTES.extensionUntrust`, `apiTrustExtension`, and `apiUntrustExtension` in `packages/client/src/routes/route-map.ts` and `packages/client/src/api/extensions.ts`.
- The daemon already exposes POST `/api/extensions/trust` and `/api/extensions/untrust` via `packages/monitor/src/routes/extensions/trust.ts`; the trust route accepts either `name` or `path`, and an optional string `trustedBy`.
- Trust mutation writes the local trust store and returns an updated `ExtensionEntry` in `packages/monitor/src/routes/extensions/trust-service.ts`. The service message currently says reload or validate is needed to apply the newly trusted extension to runtime loading.
- `packages/console-ui/src/views/system/extensions-section.tsx` already displays extension rows with trust chips, but has no trust/re-trust button or mutation flow.
- `packages/console-ui/src/lib/selectors/now.ts` currently derives Needs attention only from stream/session/queue conditions. It does not take extension list data and does not inspect `trustState`.
- `packages/console-ui/src/views/now-dashboard.tsx` renders `AttentionPanel` and already has `onNavigate` for routing to System. It also already performs REST-backed auxiliary reads for spend; not all Now data comes only from the SSE snapshot.
- `packages/console-ui/src/components/now/attention-panel.tsx` supports recovery-specific action rows and generic health rows. It will need a new extension-trust action shape or a separate row type for extension trust alerts.

Evidence:

- The backlog item reports the user screenshot/request and says current behavior requires CLI/tool trust.
- `extensions-section.tsx` renders trust chips only; no trust button or POST mutation was found.
- `selectNowAttentionItems` in `now.ts` has no extension input and no trust-state attention candidates.
- Existing daemon/client trust APIs mean the gap is Console surfacing and mutation wiring, not backend trust support.

Classification: this is a **feature / focused** change with high confidence. It adds a user-facing Console capability, uses existing daemon/client APIs, and is limited to Console UI plus tests/docs.

## Goal

Console should surface discovered extensions with `trustState: 'untrusted'` or `trustState: 'changed'` in the Now dashboard Needs attention strip and provide a UI path to trust or re-trust them. The implementation should use the existing daemon/client trust APIs, refresh Console extension data after success, and avoid adding backend trust semantics.

## Approach

Add pure Console selection logic for extensions needing trust, wire extension-list data into Now attention, and add trust/re-trust mutation controls in both Now/System as appropriate. Use existing typed route constants and trust APIs, target trust mutations by extension `path`, and annotate requests with `trustedBy: 'console-ui'` or equivalent stable Console provenance.

Expected implementation targets:

- `packages/console-ui/src/lib/selectors/system.ts` or a new focused selector module: add a pure helper such as `selectExtensionsNeedingTrust(responseOrExtensions)` that returns only entries with `trustState: 'untrusted' | 'changed'`, plus fallback `trust === 'untrusted'` when `trustState` is missing. Include unit tests in `packages/console-ui/src/views/system/__tests__/system-selectors.test.ts` or a new selector test.
- `packages/console-ui/src/views/system/system-fetches.ts` or a new small Console API helper: add `trustSystemExtension`/`trustExtensionFromConsole` that POSTs to `API_ROUTES.extensionTrust` with JSON body `{ path, trustedBy: 'console-ui' }` or equivalent stable annotation. Existing `fetchJson` only supports GET, so either extend it carefully for method/body/headers or use a small dedicated fetch helper that preserves typed responses.
- `packages/console-ui/src/views/system/extensions-section.tsx`: add Trust/Re-trust buttons for rows needing trust, pending/error/success state per extension, and invoke the mutation callback passed from the parent. Keep trust chips intact.
- `packages/console-ui/src/views/system/system-view-content.tsx` and `packages/console-ui/src/views/system/system-configuration-view.tsx`: thread the mutation callback and refresh behavior from the data hook into `ExtensionsSection`.
- `packages/console-ui/src/views/now-dashboard.tsx`: load extension list data for trust attention using an existing or new hook/helper, merge extension trust warning items into the Needs attention strip, and provide an action path. The action may trust/re-trust directly from the strip, or navigate to System while System provides the trust button. Prefer direct trust from the strip if it can be implemented without bloating `AttentionPanel`.
- `packages/console-ui/src/components/now/attention-panel.tsx`: extend `NowAttentionItem` rendering with an extension-trust action row if Now supports direct trust; otherwise add a generic management action/link row that navigates to System.
- `packages/console-ui/src/__tests__/now-selectors.test.ts`, `packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx`, `packages/console-ui/src/__tests__/now-dashboard.test.tsx`, and `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx`: add coverage for the new attention and trust UI behavior.
- `packages/console-ui/README.md`: update the Needs attention/System route notes if the implementation changes the documented surfaces.

Design decisions:

- Treat `trustState === 'untrusted'` and `trustState === 'changed'` as the primary attention conditions.
- Use backward-compatible fallback behavior where entries with absent `trustState` and `trust === 'untrusted'` are treated as needing trust.
- Target trust mutations by extension `path`, not `name`, because the daemon route supports either field and `trust.ts` can return 409 for ambiguous names.
- Annotate trust requests with `trustedBy: 'console-ui'` because `ExtensionTrustRequest` supports this metadata and it makes trust-store provenance visible without requiring a user identity system.
- Keep System as the detailed extension-management surface, but make Now actionable.
- Do not require auto-reload as a side effect of trust because existing daemon response says trust changes may require reload/validate to apply.
- Keep selectors pure and route constants centralized.

Confirmed dependencies and constraints:

- Route constants are already in `@eforge-build/client`; use `API_ROUTES.extensionTrust` rather than raw route strings.
- Trust route accepts `path`, which is safer for row-specific UI than `name` because `name` can be ambiguous for project-team candidates.
- `trust-service.ts` returns an updated extension and notes reload/validate may be needed to apply; UI copy should not imply the extension is loaded immediately after trust.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Extension entries returned to Console include enough data to identify trust-needed rows. | Validated in `packages/client/src/types.ts`: `ExtensionEntry` has `trustState`, `trust`, `name`, and `path`; `ExtensionListResponse` contains `extensions`. | high | low | Add selector tests with untrusted, changed, trusted, not-required, and legacy coarse-trust entries. | Low; selector can be adjusted if actual fixtures differ. |
| POST `/api/extensions/trust` can be called from Console with an extension path. | Validated in `packages/monitor/src/routes/extensions/trust.ts` and `trust-service.ts`: request accepts `path`, checks project-team path, writes trust record, and returns updated extension. | high | low | Add a Console fetch-helper test that asserts URL, method, JSON body, and error handling. Existing monitor route tests cover backend behavior. | Medium; if path targeting fails in a real browser flow, UI can fall back to name with ambiguity handling. |
| Needs attention can incorporate extension-list data without changing daemon stream contracts. | Validated that Now already uses REST for spend, and extension list has a typed REST fetch. This is an implementation choice, not a backend requirement. | medium | low | During implementation, either fetch extension list in Now with a small hook or thread existing System extension state if available; cover loading/error behavior in tests. | Medium; if REST-on-Now is rejected for UX/performance, the plan can still surface alert after extending project state/snapshot, but that is broader. |
| Trusting marks/re-marks the extension trusted but does not necessarily load it immediately. | Validated in `trust-service.ts` response message: reload or validate is needed to apply. | high | low | UI copy should say "Trusted"/"Re-trusted" and optionally mention reload may be needed; tests should not assert loaded status changes. | Low; avoids overstating behavior. |
| No Pi/Claude plugin update is required. | This change is Console UI behavior using existing daemon/client APIs; no CLI/MCP/tool surface is being added or changed. | high | low | Search consumer packages before implementation if any shared command copy is touched. | Low; if shared API changes become necessary, update both integrations per `AGENTS.md`. |

Assumption review: no low-confidence/high-impact assumption remains. The only medium assumption is the preferred Now data source; it has a low-cost implementation-time validation path and a bounded fallback.

Recommended profile: **Excursion**.

Rationale: this is a cohesive Console feature touching several UI modules and tests, with existing daemon/client APIs already in place. A single planner can cover the selector, fetch/mutation helper, Now alert, System row controls, and validation without delegated subsystem planning. It is larger than an Errand because it crosses multiple UI surfaces and requires state/error handling; it is not an Expedition because it does not require new backend contracts or independently planned modules.

## Scope

In scope:

- Add Console logic that identifies discovered extensions needing trust when `trustState === 'untrusted'` or `trustState === 'changed'`.
- Include a backward-compatible fallback for entries where `trustState` is absent but `trust === 'untrusted'`.
- Surface extensions needing trust in the Now dashboard Needs attention strip with warning severity.
- Use clear copy that the extension is untrusted or changed.
- Provide an action path for remediation from the Needs attention strip.
- Add a Console trust/re-trust UI mutation for the affected extension.
- Prefer targeting trust mutations by `path` rather than `name` so the route cannot hit an ambiguous project-team name.
- Add the same trust/re-trust control to the System Extensions row for untrusted/changed project-team extensions, because System is the detailed extension-management surface.
- Refresh extension list data after trust succeeds so chips and attention state update.
- Use `API_ROUTES.extensionTrust`; do not inline `/api/...` route literals.
- Add component/selector tests for alert surfacing, button labels, mutation request shape, error handling, and post-trust disappearance from attention.
- Update Console docs if the Needs attention description or extension-management behavior in `packages/console-ui/README.md` becomes stale.

Out of scope:

- Do not implement new daemon routes or change trust-store semantics.
- Do not auto-reload extensions after trust unless the implementation can do so safely with existing APIs and clear user feedback.
- Do not expose untrust/demote/install/update controls as part of this item.
- Do not change extension trust requirements for user/project-local/external extensions with `trustState: 'not-required'`.

## Acceptance Criteria

- A discovered extension with `trustState: 'untrusted'` appears in the Now dashboard Needs attention strip with warning severity.
- A discovered extension with `trustState: 'changed'` appears in the Now dashboard Needs attention strip with warning severity.
- A discovered extension with `trustState: 'trusted'` does not create a trust-related Needs attention item.
- A discovered extension with `trustState: 'not-required'` does not create a trust-related Needs attention item.
- A discovered extension with no `trustState` and `trust: 'untrusted'` creates a trust-related Needs attention item.
- The Needs attention UI provides an actionable path for each trust-needed extension to trust or re-trust it from Console.
- The System Extensions section renders a Trust button for an untrusted project-team extension.
- The System Extensions section renders a Re-trust button for a changed project-team extension.
- Clicking a Trust button sends a POST request to `API_ROUTES.extensionTrust` with a JSON body containing the selected extension path.
- Clicking a Re-trust button sends a POST request to `API_ROUTES.extensionTrust` with a JSON body containing the selected extension path.
- The trust POST request includes a stable Console provenance annotation in `trustedBy`.
- A successful trust response refreshes or updates Console extension data so the trusted extension no longer appears as trust-needed.
- A failed trust response leaves the extension visible as trust-needed.
- A failed trust response renders the error message in Console.
- Console code uses `API_ROUTES.extensionTrust` and does not inline the `/api/extensions/trust` path literal.
- `pnpm --filter @eforge-build/console-ui test` exits 0.
- `pnpm type-check` exits 0.