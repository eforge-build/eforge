---
id: plan-01-shared-extension-dispatch
name: Shared eforge_extension Dispatcher
branch: reduce-extension-tool-dispatch-complexity/plan-01-shared-extension-dispatch
---

# Shared eforge_extension Dispatcher

## Architecture Context

`@eforge-build/client` owns daemon route constants, wire request/response types, and daemon API helpers. The MCP proxy (`packages/eforge/src/cli/mcp-proxy.ts`) and Pi extension (`packages/pi-eforge/extensions/eforge/index.ts`) currently duplicate the same `eforge_extension` action validation, request-body construction, and client-helper dispatch ladder. This plan moves that duplicated action logic into a shared client module and leaves the two integrations as thin adapters around result handling.

## Current State / Delta

- `packages/client/src/api/extensions.ts` contains typed endpoint helpers such as `apiListExtensions`, `apiTestExtension`, and `apiInstallExtension`, plus `IfRunning` variants.
- `packages/eforge/src/cli/mcp-proxy.ts` contains a long inline `if (action === ...)` ladder inside the `eforge_extension` handler.
- `packages/pi-eforge/extensions/eforge/index.ts` contains the corresponding long inline `if (params.action === ...)` ladder inside the Pi tool `execute` function.
- `test/extension-tooling-wiring.test.ts` currently asserts the inline ladders; those assertions need to target the shared dispatcher plus the MCP/Pi helper tables.

## Implementation

### Overview

Create a table-driven shared dispatcher under `packages/client/src/api/` and export it from `packages/client/src/index.ts`. Replace the MCP and Pi inline action ladders with calls to the shared dispatcher. MCP passes the normal extension API helper table and returns `result.data`. Pi passes the `IfRunning` helper table, throws `DAEMON_NOT_RUNNING_GUIDANCE` when the dispatcher returns `null`, and returns `jsonResult(result.data)`.

### Key Decisions

1. Create a sibling module such as `packages/client/src/api/extension-tool-dispatch.ts` rather than growing `packages/client/src/api/extensions.ts`. The source permits a sibling module, and this keeps endpoint helpers separated from tool-action dispatch while keeping the new implementation file under the project size limit.
2. The shared dispatcher must accept an injected helper table. This lets MCP use `api*Extension` helpers and Pi use `api*ExtensionIfRunning` helpers without duplicating validation or body construction.
3. The dispatcher must return the helper result object, not just data. This preserves MCP raw-data return handling and lets Pi detect `null` from `IfRunning` helpers in its adapter.
4. Do not export the new dispatcher from `packages/client/src/browser.ts`. Browser exports are out of scope and endpoint helpers are Node-facing.

### Shared Dispatcher Contract

In the new client module, define and export:

- `EFORGE_EXTENSION_ACTIONS` with the existing action literals: `list`, `show`, `validate`, `test`, `new`, `reload`, `trust`, `untrust`, `install`, `update`, `remove`, `promote`, `demote`.
- `EforgeExtensionAction` from that action array.
- `EforgeExtensionActionParams` with the existing optional parameter names: `name`, `path`, `fixture`, `run`, `event`, `scope`, `template`, `force`, `trustedBy`, `source`, and `trust`.
- `EforgeExtensionActionHelpers` mapping every action to its existing helper signature.
- `dispatchEforgeExtensionAction({ cwd, params, helpers })`.

The dispatcher must:

- Compute `hasTestOnlyParams` from `fixture`, `run`, and `event`.
- Compute `hasPackageOnlyParams` from `source` and `trust`.
- Validate accepted, rejected, required, and mutually-exclusive fields for each action using the current string literals verbatim.
- Construct typed request bodies using existing request types from `packages/client/src/types.ts`.
- Select the action-specific helper from the injected table and call it with the same `{ cwd, ... }` shapes used today.
- Avoid `/api/...` literals; it must not route directly through `daemonRequest`.

Prefer small action validator/body-builder functions and an action-spec table over one long `switch` or `if` chain. Keep each new or moved function below Cognitive Complexity 30.

## Scope

### In Scope

- Create `packages/client/src/api/extension-tool-dispatch.ts` or an equivalently named sibling under `packages/client/src/api/`.
- Export the new dispatcher function and public types from `packages/client/src/index.ts`.
- Modify `packages/eforge/src/cli/mcp-proxy.ts` to import the dispatcher/types, define a normal extension helper table, and replace the `eforge_extension` action ladder with a small adapter.
- Modify `packages/pi-eforge/extensions/eforge/index.ts` to import the dispatcher/types, define an `IfRunning` extension helper table, and replace the `eforge_extension` action ladder with a small adapter.
- Update `test/extension-tooling-wiring.test.ts` to assert shared-dispatcher usage, validation-message coverage, route-literal absence, and action-helper table routing.

### Out of Scope

- Do not change `eforge_extension` public schema text, action enum, action names, or parameter names.
- Do not change daemon routes, route constants, wire request/response shapes, or browser exports.
- Do not modify `eforge-plugin/` or bump plugin/package versions.
- Do not refactor unrelated complexity hotspots.
- Do not add database migrations.

## Files

### Create

- `packages/client/src/api/extension-tool-dispatch.ts` — shared table-driven action validation, request construction, injected-helper dispatch, and exported dispatcher types.

### Modify

- `packages/client/src/index.ts` — export `dispatchEforgeExtensionAction`, `EFORGE_EXTENSION_ACTIONS`, and related dispatcher types from the new client module.
- `packages/eforge/src/cli/mcp-proxy.ts` — add the normal helper table (`list: apiListExtensions`, `show: apiShowExtension`, etc.) and replace the `eforge_extension` handler body with the dispatcher call and `return result.data`.
- `packages/pi-eforge/extensions/eforge/index.ts` — add the `IfRunning` helper table (`list: apiListExtensionsIfRunning`, etc.) and replace the `eforge_extension` execute body with the dispatcher call, `null` guard using `DAEMON_NOT_RUNNING_GUIDANCE`, and `jsonResult(result.data)`.
- `test/extension-tooling-wiring.test.ts` — update static tests to read the shared dispatcher module, assert both integrations delegate to it, assert all validation message literals exist in the shared dispatcher, assert MCP/Pi helper tables contain the expected action-specific helpers, and assert no new inline `/api/...` literals appear.

## Test Updates

Update the MCP/Pi parity block in `test/extension-tooling-wiring.test.ts` as follows:

- Add a helper that reads the shared dispatcher source.
- Change validation-message assertions so the required message list is checked against `throw new Error(...)` literals in the shared dispatcher source.
- Treat MCP/Pi validation parity as delegation parity: both integration blocks must import/use `dispatchEforgeExtensionAction` and must not contain the old per-action ladder strings.
- Replace old ordering assertions such as `if (action === 'test')` before `apiTestExtension` with helper-table mapping assertions for MCP and Pi.
- Keep the existing route-literal absence assertions for MCP/Pi blocks and add the new client dispatcher source to the client no-inline-route check.
- Add an index export assertion for the dispatcher function and type/source names.

## Verification

- [ ] `packages/eforge/src/cli/mcp-proxy.ts` does not contain per-action `if (action === 'test')`, `if (action === 'new')`, `if (action === 'install')`, `if (action === 'update')`, `if (action === 'remove')`, `if (action === 'promote')`, or `if (action === 'demote')` inside the `eforge_extension` block.
- [ ] `packages/pi-eforge/extensions/eforge/index.ts` does not contain per-action `if (params.action === "test")`, `if (params.action === "new")`, `if (params.action === "install")`, `if (params.action === "update")`, `if (params.action === "remove")`, `if (params.action === "promote")`, or `if (params.action === "demote")` inside the `eforge_extension` block.
- [ ] MCP helper table maps every action to the normal helper: `apiListExtensions`, `apiShowExtension`, `apiValidateExtensions`, `apiTestExtension`, `apiNewExtension`, `apiReloadExtensions`, `apiTrustExtension`, `apiUntrustExtension`, `apiInstallExtension`, `apiUpdateExtension`, `apiRemoveExtension`, `apiPromoteExtension`, and `apiDemoteExtension`.
- [ ] Pi helper table maps every action to the matching `IfRunning` helper.
- [ ] The Pi adapter throws `DAEMON_NOT_RUNNING_GUIDANCE` when the dispatcher result is `null`.
- [ ] The shared dispatcher source contains every existing validation error string literal from the current MCP/Pi ladders.
- [ ] `packages/client/src/browser.ts` has no new dispatcher exports.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- test/extension-tooling-wiring.test.ts` exits 0.
