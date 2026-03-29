---
id: plan-03-engine-wiring-and-tests
name: Engine Wiring and Tests
depends_on: [plan-02-pi-backend]
branch: add-pi-mono-backend-for-eforge/engine-wiring-and-tests
---

# Engine Wiring and Tests

## Architecture Context

`EforgeEngine.create()` is the async factory that instantiates the backend. Currently it always creates a `ClaudeSDKBackend` when no custom backend is provided. This plan wires the `PiBackend` as an alternative based on `config.backend`, and adds unit tests for the new Pi-specific logic.

The testing approach follows eforge's conventions: no mocks, hand-crafted data objects, `StubBackend` for agent wiring, and fixtures only for I/O tests.

## Implementation

### Overview

1. Update `EforgeEngine.create()` to branch on `config.backend`:
   - `'claude-sdk'` (default): existing behavior - load MCP servers, plugins, create `ClaudeSDKBackend`
   - `'pi'`: load MCP servers (for bridge), discover Pi extensions, create `PiBackend`

2. Add 4 new test files covering the Pi-specific logic that can be unit tested without the actual Pi SDK:
   - Config parsing/validation for `backend` and `pi` sections
   - JSON Schema -> TypeBox conversion
   - Thinking level mapping
   - Event translation mapping (using hand-crafted Pi-like event objects)

### Key Decisions

1. **MCP loading shared, plugin loading diverges** - Both backends need MCP servers from `.mcp.json`. But Claude SDK gets Claude Code plugins while Pi gets Pi extensions. The `EforgeEngine.create()` branching handles this divergence.

2. **Tests avoid importing Pi SDK** - Pi event mapping tests construct plain objects that match Pi's event shapes (cast through `unknown`). This follows the existing `StubBackend` pattern where SDK types aren't imported in tests.

3. **Extension discovery is pure filesystem** - `discoverPiExtensions()` just returns paths. The actual extension loading happens inside `PiBackend` when it creates the session. This means extension discovery can be tested independently with temp directories.

4. **Config test validates the full round-trip** - Parse YAML string -> Zod validation -> `resolveConfig()` -> verify output. This catches schema/resolver mismatches.

## Scope

### In Scope
- `EforgeEngine.create()` branching on `config.backend`
- `EforgeEngineOptions` type update for Pi-specific options
- MCP bridge lifecycle management (create on engine init, close on engine disposal)
- Unit tests for config parsing (`test/pi-config.test.ts`)
- Unit tests for JSON Schema -> TypeBox conversion (`test/pi-mcp-bridge.test.ts`)
- Unit tests for thinking level mapping (`test/pi-thinking-mapping.test.ts`)
- Unit tests for event translation mapping (`test/pi-event-mapping.test.ts`)

### Out of Scope
- Integration tests with actual Pi SDK (manual testing, per acceptance criteria)
- End-to-end pipeline tests with PiBackend

## Files

### Create
- `test/pi-config.test.ts` - Config parsing: validates `backend` and `pi` sections, default values, env var interpolation, invalid config rejection
- `test/pi-mcp-bridge.test.ts` - JSON Schema -> TypeBox conversion: primitive types, objects with required/optional props, arrays, enums, nested objects, unknown schemas -> Type.Any()
- `test/pi-thinking-mapping.test.ts` - ThinkingConfig -> Pi thinking level: disabled/adaptive/enabled mapping, EffortLevel fallbacks
- `test/pi-event-mapping.test.ts` - Pi event -> EforgeEvent translation: message chunks, tool calls, tool results, session completion stats, lifecycle wrapping

### Modify
- `src/engine/eforge.ts` - Update `EforgeEngine.create()` to branch on `config.backend`, import `PiBackend` and `PiMcpBridge` and `discoverPiExtensions`, manage MCP bridge lifecycle. Update `EforgeEngineOptions` to accept Pi-specific config.

## Verification

- [ ] `pnpm type-check` passes
- [ ] `pnpm test` passes - all existing tests have no regressions and all 4 new test files pass
- [ ] `test/pi-config.test.ts` has at least 5 test cases covering: valid pi config, default backend, invalid backend rejection, pi section defaults, env var override
- [ ] `test/pi-mcp-bridge.test.ts` has at least 6 test cases covering: string/number/integer/boolean primitives, object with required props, array with items, enum, nested object, unknown schema fallback
- [ ] `test/pi-thinking-mapping.test.ts` has at least 5 test cases covering: disabled->off, adaptive->medium, enabled->high, effort low->off, effort high->high
- [ ] `test/pi-event-mapping.test.ts` has at least 4 test cases covering: message chunk, tool call, tool result, session completion stats
- [ ] When `config.backend` is `'claude-sdk'` (or omitted), `EforgeEngine.create()` creates `ClaudeSDKBackend` - existing behavior unchanged
- [ ] When `config.backend` is `'pi'`, `EforgeEngine.create()` creates `PiBackend` with MCP bridge and discovered extensions
- [ ] MCP bridge `close()` is called during engine cleanup/disposal
