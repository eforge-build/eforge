---
id: plan-01-config-and-deps
name: Config Schema and Dependencies
depends_on: []
branch: add-pi-mono-backend-for-eforge/config-and-deps
---

# Config Schema and Dependencies

## Architecture Context

eforge uses a layered config system with Zod schemas as the single source of truth. The `EforgeConfig` type, `DEFAULT_CONFIG`, `eforgeConfigSchema`, and `resolveConfig()` all live in `src/engine/config.ts`. This plan adds the `backend` selector and `pi` config section to the schema, updates the resolved config interface, and adds npm dependencies. All downstream plans depend on these types being in place.

## Implementation

### Overview

Add a top-level `backend` enum field (`'claude-sdk' | 'pi'`, defaulting to `'claude-sdk'`) and a `pi` config section to the Zod schema, `EforgeConfig` interface, `DEFAULT_CONFIG`, and `resolveConfig()`. Also add `@mariozechner/pi-coding-agent` and `@sinclair/typebox` to `package.json` dependencies and externalize them in `tsup.config.ts`.

### Key Decisions

1. `backend` defaults to `'claude-sdk'` so existing users have zero config changes - the Pi backend is opt-in only.
2. The `pi` section is always present in `EforgeConfig` (with defaults) even when `backend: 'claude-sdk'`, avoiding optional chaining everywhere downstream. This matches how `langfuse` config works - always present, just `enabled: false` equivalent when unused.
3. `pi.thinkingLevel` uses Pi's native enum (`'off' | 'medium' | 'high'`) rather than eforge's `ThinkingConfig` type. The mapping from eforge's `ThinkingConfig` to Pi's thinking level happens in the backend, not config. This keeps config clean - users set Pi-native values in the `pi` section.
4. `@mariozechner/pi-coding-agent` is externalized in tsup (like `@anthropic-ai/claude-agent-sdk`) because it spawns subprocesses that need `import.meta.url` resolution.

## Scope

### In Scope
- Zod schema additions: `backend` enum, `pi` config object with `provider`, `apiKey`, `model`, `thinkingLevel`, `extensions`, `compaction`, `retry` sub-schemas
- `EforgeConfig` interface update with `backend` and `pi` fields
- `DEFAULT_CONFIG` update with defaults for new fields
- `resolveConfig()` update to merge `pi` section and `backend` field
- `eforgeConfigSchema` update for validation
- `parseRawConfigFallback()` update to include new sections
- `stripUndefinedSections()` update for new sections
- `package.json`: add `@mariozechner/pi-coding-agent`, `@sinclair/typebox` dependencies
- `tsup.config.ts`: externalize Pi packages

### Out of Scope
- PiBackend implementation (plan-02)
- MCP bridge (plan-02)
- Extension discovery (plan-02)
- Engine wiring (plan-03)

## Files

### Modify
- `src/engine/config.ts` - Add `backend` enum schema, `piConfigSchema` object schema, update `EforgeConfig` interface to include `backend` and `pi` fields, update `DEFAULT_CONFIG`, update `resolveConfig()`, update `eforgeConfigSchema`, update `parseRawConfigFallback()`, update `stripUndefinedSections()`
- `package.json` - Add `@mariozechner/pi-coding-agent` and `@sinclair/typebox` to dependencies
- `tsup.config.ts` - Add `@mariozechner/pi-coding-agent`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@sinclair/typebox` to external arrays for both CLI and engine library build targets

## Verification

- [ ] `pnpm type-check` passes with the new config types
- [ ] `pnpm test` passes with no regressions
- [ ] `eforgeConfigSchema` accepts `{ backend: 'pi', pi: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' } }` without validation errors
- [ ] `eforgeConfigSchema` accepts `{ backend: 'claude-sdk' }` without validation errors
- [ ] `eforgeConfigSchema` accepts `{}` (empty config) and defaults `backend` to `'claude-sdk'`
- [ ] `eforgeConfigSchema` rejects `{ backend: 'invalid' }` with a validation error
- [ ] `resolveConfig({})` returns an `EforgeConfig` with `backend: 'claude-sdk'` and `pi` section populated with defaults
- [ ] `resolveConfig({ backend: 'pi', pi: { provider: 'openrouter', apiKey: 'sk-test', model: 'anthropic/claude-sonnet-4' } })` returns config with those values preserved
- [ ] `DEFAULT_CONFIG.pi` has sensible defaults: `thinkingLevel: 'medium'`, `extensions.autoDiscover: true`, `compaction.enabled: true`
