---
id: plan-02-consumers
name: MCP Tool, Pi Extension, and Wiring Tests
depends_on:
  - plan-01-core-engine
branch: user-scoped-backend-profiles/consumers
---

# MCP Tool, Pi Extension, and Wiring Tests

## Architecture Context

Plan-01 adds user-scope support to the core engine functions and daemon HTTP routes. The MCP proxy (`eforge_backend` tool) and Pi extension mirror each other and call the daemon HTTP API. Both need a `scope` parameter added to their Zod/TypeBox input schemas so consumers (Claude Code plugin, Pi) can specify scope when listing, creating, using, or deleting backend profiles.

Per AGENTS.md convention, both packages must stay in sync - every capability exposed in one must be exposed in the other.

## Implementation

### Overview

Add a `scope` parameter to the `eforge_backend` Zod schema in the MCP proxy and the matching TypeBox schema in the Pi extension. Thread the parameter into daemon HTTP dispatch calls. Extend wiring tests to verify schema parity.

### Key Decisions

1. **Scope is optional for all actions** - Omitting scope preserves backward compatibility. For `list`, default is `'all'`. For `use`/`create`/`delete`, default is `'project'`.
2. **Scope enum varies by action** - `list` accepts `'project' | 'user' | 'all'`. `use`/`create`/`delete` accept `'project' | 'user'`. `show` does not need scope (it resolves via precedence).
3. **Threading is mechanical** - Both MCP proxy and Pi extension already dispatch to `POST /api/backend/use`, etc. Adding `scope` to the request body or query string is additive.

## Scope

### In Scope
- MCP proxy `eforge_backend` Zod schema extension with `scope` field
- Pi extension `eforge_backend` TypeBox schema extension with `scope` field
- Threading scope into daemon HTTP request bodies/query params
- Wiring test assertions for scope enum presence

### Out of Scope
- Core engine changes (plan-01)
- Skill documentation (plan-03)

## Files

### Modify
- `packages/eforge/src/cli/mcp-proxy.ts` - In the `eforge_backend` tool's Zod input schema (lines ~551-621), add `scope: z.enum(['project', 'user']).optional()` for `use`, `create`, `delete` actions. Add `scope: z.enum(['project', 'user', 'all']).optional()` for `list` action. In the dispatch logic for each action, include `scope` in the request body (for `use`/`create`/`delete`) or as a query parameter (for `list`). The schema should use a single `scope` field with `z.enum(['project', 'user', 'all']).optional()` and the description should note which values apply to which actions.
- `packages/pi-eforge/extensions/eforge/index.ts` - Mirror the MCP proxy changes using TypeBox. In the `eforge_backend` tool schema (lines ~334-501), add `scope: Type.Optional(Type.Union([Type.Literal('project'), Type.Literal('user'), Type.Literal('all')]))`. Thread `scope` into the daemon dispatch for each action, matching the MCP proxy logic.
- `test/backend-profile-wiring.test.ts` - Add assertions that: (1) the MCP proxy's `eforge_backend` tool schema includes a `scope` property, (2) the Pi extension's `eforge_backend` tool schema includes a `scope` property, (3) both schemas accept `'project'`, `'user'`, and `'all'` as valid scope values. Verify parity between MCP and Pi schemas for the scope field.

## Verification

- [ ] `pnpm type-check` passes with zero errors across all packages
- [ ] `pnpm test` passes - all existing wiring tests still green
- [ ] New wiring test: MCP proxy `eforge_backend` schema includes `scope` field accepting `'project'`, `'user'`, `'all'`
- [ ] New wiring test: Pi extension `eforge_backend` schema includes `scope` field accepting `'project'`, `'user'`, `'all'`
- [ ] MCP proxy `list` action passes `scope` as query parameter to `GET /api/backend/list?scope=...`
- [ ] MCP proxy `use`/`create`/`delete` actions pass `scope` in request body to daemon HTTP endpoints