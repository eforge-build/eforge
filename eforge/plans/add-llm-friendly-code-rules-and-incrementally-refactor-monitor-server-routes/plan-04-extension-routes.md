---
id: plan-04-extension-routes
name: Extract Extension Route Group
branch: add-llm-friendly-code-rules-and-incrementally-refactor-monitor-server-routes/plan-04-extension-routes
agents:
  builder:
    effort: high
    rationale: Extension routes include local-origin safety checks and package
      operations; extraction must preserve security-sensitive guards.
---

# Extract Extension Route Group

## Architecture Context

After Plan 03, the main callback still contains the extension tooling and package-management routes. These routes have strong safety requirements: mutation routes must keep local-origin checks and route constants must remain sourced from `@eforge-build/client`.

Full-file replacement of `packages/monitor/src/server.ts` is forbidden. Move the existing extension route chunk in bounded contiguous sections and keep helper functions under the new policy caps where feasible.

## Implementation

### Overview

Extract extension routes into an ordered extension dispatcher helper and smaller subhelpers when a single helper would exceed the new function-complexity policy. Keep the public dispatcher call in the same route order location: after profile routes and before playbook/session-plan routes.

### Key Decisions

1. Keep `rejectUnsafeExtensionMutationRequest(req, res)` on every current extension mutation route.
2. Keep extension route matching against `API_ROUTES.extension*` constants only.
3. Use subhelpers for management, replay/test, read/list/show/validate, trust/untrust, and package operations if needed to keep cognitive complexity under 30.
4. Keep helper return semantics consistent: `false` for no match, `true` after a response write or delegated response write.

## Scope

### In Scope

- Extract extension new/reload routes.
- Extract extension test/replay route.
- Extract extension list/show/validate routes.
- Extract extension trust/untrust routes.
- Extract extension install/update/remove/promote/demote routes.
- Preserve existing marker comments where they carry feature provenance and add group-level monitor route markers around the new helper seams.

### Out of Scope

- Changing extension package-management implementation in `packages/monitor/src/extension-package-management.ts`.
- Changing extension loader or engine extension APIs.
- Changing extension HTTP request/response shapes.
- Moving extension routes to a new module.

## Files

### Modify

- `packages/monitor/src/server.ts` — Move extension route blocks into handled-return helpers and update the dispatcher.

## Verification

- [ ] `pnpm vitest run test/extension-tooling-routes.test.ts test/extension-tooling-wiring.test.ts` exits 0.
- [ ] Mutation routes `extensionNew`, `extensionReload`, `extensionTest`, `extensionTrust`, `extensionUntrust`, `extensionInstall`, `extensionUpdate`, `extensionRemove`, `extensionPromote`, and `extensionDemote` still call `rejectUnsafeExtensionMutationRequest` before mutating state or files.
- [ ] Cross-origin extension mutation requests in the existing tests still return 403.
- [ ] Extension routes still reference `API_ROUTES.extension*` constants rather than literal `/api/extensions/...` strings.
- [ ] The top-level extension route helper returns `false` when no extension route matches.