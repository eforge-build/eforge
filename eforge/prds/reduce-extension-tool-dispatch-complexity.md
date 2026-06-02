---
title: Reduce Extension Tool Dispatch Complexity
created: 2026-06-02
landing: pr
landing_auto_merge: true
---

# Reduce Extension Tool Dispatch Complexity

## Problem / Motivation

The Pi extension and Claude/MCP proxy both contain duplicated, high-complexity `eforge_extension` action validation and dispatch logic. `pnpm complexity:scan` reported `packages/pi-eforge/extensions/eforge/index.ts:860` at CC 236 with churn 72 and `packages/eforge/src/cli/mcp-proxy.ts:432` at CC 211 with churn 63. These are the top two ranked hotspots by churn × CC.

Reading both hotspot regions showed they implement the same `eforge_extension` action validation and dispatch pattern: compute test/package parameter flags, validate each action's accepted and rejected parameters, build typed request bodies, call an action-specific client helper, and return the daemon response.

`test/extension-tooling-wiring.test.ts` already contains static parity checks for MCP/Pi `eforge_extension` registration, validation messages, absence of inline `/api/...` literals, and action-specific client helper routing. These tests are the right regression harness to update and preserve.

Project guidance requires `eforge-plugin/` and `packages/pi-eforge/` consumer-facing integrations to stay in sync, and route constants/daemon wire shapes must remain owned by `@eforge-build/client`.

## Goal

Refactor the duplicated `eforge_extension` tool action validation and dispatch logic in the Pi extension and Claude/MCP proxy into shared, table-driven helpers while preserving existing public behavior, schemas, validation messages, routes, and helper usage.

## Approach

- Create shared helper code in `packages/client/src/api/extensions.ts`, or a small sibling module under `packages/client/src/api/` if cleaner.
- The shared helper should normalize `eforge_extension` action parameters.
- The shared helper should validate action-specific allowed and required fields.
- The shared helper should construct typed request payloads.
- The shared helper should choose the action-specific client API helper.
- Keep all daemon route usage through `API_ROUTES` and existing typed client helpers.
- Do not inline `/api/...` literals.
- Export the helper or helpers from the client package so both MCP and Pi integrations can import them.
- Export the new shared helper types/functions from `packages/client/src/index.ts`.
- Replace the long `eforge_extension` action branch in `packages/eforge/src/cli/mcp-proxy.ts` with a small dispatcher call that passes MCP params and the normal `api*Extension` helper set.
- Preserve MCP behavior by returning raw `data`.
- Preserve MCP behavior by using normal helpers such as `apiListExtensions`, `apiShowExtension`, and related action-specific helpers.
- Preserve the existing MCP schema text and action enum.
- Replace the long `eforge_extension` action branch in `packages/pi-eforge/extensions/eforge/index.ts` with a small dispatcher call that passes Pi params and the `api*ExtensionIfRunning` helper set.
- Preserve Pi behavior by using `api*IfRunning` helpers.
- Preserve Pi behavior by throwing `DAEMON_NOT_RUNNING_GUIDANCE` when a helper returns `null`.
- Preserve Pi behavior by wrapping the final data with `jsonResult(...)`.
- Update `test/extension-tooling-wiring.test.ts` so the static tests assert the two consumer surfaces route through the shared helper.
- Update `test/extension-tooling-wiring.test.ts` while preserving validation message parity and route/client-helper coverage.
- If exported request or parameter helper types cannot live cleanly in `packages/client/src/api/extensions.ts` without clutter, add them to `packages/client/src/types.ts`.
- Validate that a new shared dispatcher in `@eforge-build/client` can be imported by both `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` without creating dependency cycles.
- If a dependency cycle appears, place the helper in the lowest safe client submodule and export it from `packages/client/src/index.ts`.
- Validate that the shared dispatcher can accept an injected table of client helper functions so MCP can use normal helpers and Pi can use `IfRunning` helpers while sharing validation and body construction logic.
- Validate that the existing static tests can be adjusted to validate shared-dispatcher usage without weakening validation-message parity coverage.

## Scope

### In Scope

- Add shared `eforge_extension` dispatch and validation utilities in `packages/client/src/api/extensions.ts`.
- Export the shared helper types/functions from `packages/client/src/index.ts`.
- Import the shared helper or helpers in `packages/eforge/src/cli/mcp-proxy.ts`.
- Replace the current action-specific `if` ladder for the `eforge_extension` handler in `packages/eforge/src/cli/mcp-proxy.ts` with a small call into the shared dispatcher.
- Import the shared helper or helpers in `packages/pi-eforge/extensions/eforge/index.ts`.
- Replace the current action-specific `if` ladder for the `eforge_extension` tool `execute` function in `packages/pi-eforge/extensions/eforge/index.ts` with a small call into the shared dispatcher.
- Adjust `test/extension-tooling-wiring.test.ts` static tests that currently expect the long inline branch bodies.
- Continue verifying MCP/Pi validation messages remain identical.
- Add or assert evidence that both integrations import and use the shared dispatcher.

### Out of Scope

- Do not change the public `eforge_extension` tool schema.
- Do not change `eforge_extension` action names.
- Do not change `eforge_extension` parameter names.
- Do not change validation error messages.
- Do not alter extension daemon routes.
- Do not alter route constants.
- Do not alter wire response shapes.
- Do not alter browser exports.
- Do not modify unrelated complexity hotspots such as `packages/engine/src/eforge.ts` in this session.
- Do not change plugin/Pi package versions unless the implementation changes plugin user-facing code.
- This plan only changes MCP proxy/Pi extension/shared client code.

## Acceptance Criteria

- `packages/eforge/src/cli/mcp-proxy.ts` no longer contains a large inline `if (action === ...)` ladder for `eforge_extension`.
- The `eforge_extension` handler in `packages/eforge/src/cli/mcp-proxy.ts` delegates to a shared table-driven dispatcher.
- The `eforge_extension` handler in `packages/eforge/src/cli/mcp-proxy.ts` is reduced to a small adapter around MCP-specific result handling.
- `packages/pi-eforge/extensions/eforge/index.ts` no longer contains a large inline `if (params.action === ...)` ladder for `eforge_extension`.
- The `eforge_extension` tool in `packages/pi-eforge/extensions/eforge/index.ts` delegates to the same shared dispatcher as the MCP proxy.
- The `eforge_extension` tool in `packages/pi-eforge/extensions/eforge/index.ts` is reduced to a small adapter around Pi-specific result handling.
- The shared dispatcher preserves all current validation error messages verbatim.
- The shared dispatcher preserves action-specific required-field validation messages covered by `test/extension-tooling-wiring.test.ts`.
- The shared dispatcher preserves action-specific disallowed-field validation messages covered by `test/extension-tooling-wiring.test.ts`.
- MCP `eforge_extension` list action routes through `apiListExtensions`.
- MCP `eforge_extension` show action routes through `apiShowExtension`.
- MCP `eforge_extension` validate action routes through `apiValidateExtensions`.
- MCP `eforge_extension` test action routes through `apiTestExtension`.
- MCP `eforge_extension` new action routes through `apiNewExtension`.
- MCP `eforge_extension` reload action routes through `apiReloadExtensions`.
- MCP `eforge_extension` trust action routes through `apiTrustExtension`.
- MCP `eforge_extension` untrust action routes through `apiUntrustExtension`.
- MCP `eforge_extension` install action routes through `apiInstallExtension`.
- MCP `eforge_extension` update action routes through `apiUpdateExtension`.
- MCP `eforge_extension` remove action routes through `apiRemoveExtension`.
- MCP `eforge_extension` promote action routes through `apiPromoteExtension`.
- MCP `eforge_extension` demote action routes through `apiDemoteExtension`.
- Pi `eforge_extension` actions route through the corresponding `IfRunning` helpers.
- Pi `eforge_extension` actions throw `DAEMON_NOT_RUNNING_GUIDANCE` when a corresponding `IfRunning` helper returns `null`.
- No inline `/api/...` literals are introduced in MCP helper code.
- No inline `/api/...` literals are introduced in Pi helper code.
- No inline `/api/...` literals are introduced in client helper code.
- `test/extension-tooling-wiring.test.ts` asserts that both MCP and Pi integrations import or use the shared dispatcher.
- `test/extension-tooling-wiring.test.ts` continues to verify MCP/Pi validation messages remain identical.
- `test/extension-tooling-wiring.test.ts` continues to verify action-specific client helper routing.
- `pnpm test -- test/extension-tooling-wiring.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
