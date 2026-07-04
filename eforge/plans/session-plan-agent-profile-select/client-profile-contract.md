---
id: client-profile-contract
name: Profile route/type source-of-truth contract
branch: session-plan-agent-profile-select/client-profile-contract
---

# Profile route/type source-of-truth contract

Verify or add the shared `@eforge-build/client` profile-list route helpers and wire types needed by the adapter/UI. This plan owns the kernel/client contract for profile list data; downstream eforge-plan work must consume this surface rather than hard-coding routes or duplicating response shapes.

## Implementation scope

Primary owned paths:

- `packages/client/src/api/profile.ts`
- `packages/client/src/types.ts`
- `packages/client/src/routes/route-map.ts`
- `packages/monitor/src/routes/profiles.ts` only if the daemon route projection must be factored for reuse by extension context code
- Contract/boundary tests under `test/` and/or `packages/monitor/src/__tests__/` for the shared profile-list route/types

Required behavior:

- Keep shared client profile request/response types and route helpers as the source of truth wherever a profile-list wire shape is needed.
- If the daemon route needs a reusable projection, factor it so the HTTP profile-list route and extension-context service can call the same contract-shaped projection instead of creating parallel object shapes.
- Add or update boundary checks that prevent consumers from hard-coding `/api/...` profile-list route literals, scanning profile directories, importing engine config/listing internals, or declaring local profile-list wire DTOs.
- Do not implement the eforge-plan read action or workstation UI in this plan; those consume the contract in later dependent plans.

## Traceability

Criteria: ac-003, ac-005, ac-012
Aspects: ac-003:evidence:api, ac-003:interface:api, ac-003:interface:config, ac-003:interface:configuration, ac-003:interface:route, ac-003:interface:route-api, ac-005:evidence:types-route, ac-005:interface:route, ac-005:interface:route-api, ac-005:interface:schema-contract

## Validation

Run these gates after implementation:

- `pnpm type-check`
- Targeted profile route/client contract tests added or updated in this plan, for example `pnpm test -- test/client-no-start-api-helpers.test.ts test/docs-kernel-boundary.test.ts` plus any new profile-list contract test file
- If `packages/monitor/src/routes/profiles.ts` changes, run the affected monitor route test file under `packages/monitor/src/__tests__/`
- `pnpm maintainability:check`

Observable boundary checks must show no product-code references in eforge-plan to direct profile discovery, private engine config/list profile internals, local profile-list wire-shape declarations, or hard-coded profile `/api/...` route literals.
