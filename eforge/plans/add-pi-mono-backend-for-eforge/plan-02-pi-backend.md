---
id: plan-02-pi-backend
name: PiBackend Implementation
depends_on: [plan-01-config-and-deps]
branch: add-pi-mono-backend-for-eforge/pi-backend
---

# PiBackend Implementation

## Architecture Context

eforge isolates all SDK imports behind the `AgentBackend` interface (`src/engine/backend.ts`). The sole existing implementation, `ClaudeSDKBackend`, lives in `src/engine/backends/claude-sdk.ts`. This plan creates the second implementation - `PiBackend` - along with its MCP bridge and extension discovery modules, all within the `src/engine/backends/` directory following the established SDK isolation pattern.

The core challenge is bridging Pi's EventBus pub/sub pattern to eforge's `AsyncGenerator<EforgeEvent>` pattern. This is done via an async queue: Pi events push into the queue, and the generator yields from it.

## Implementation

### Overview

Create three new files in `src/engine/backends/`:
1. `pi.ts` - `PiBackend` class implementing `AgentBackend`
2. `pi-mcp-bridge.ts` - Bridges MCP server tools to Pi `AgentTool` instances
3. `pi-extensions.ts` - Discovers and loads Pi extensions from config paths and auto-discovery locations

### Key Decisions

1. **Fresh session per `run()` call** - Each `AgentBackend.run()` invocation creates an independent Pi `AgentSession`. No shared session state between agent invocations. This matches how `ClaudeSDKBackend` works (each SDK query is independent).

2. **Async queue bridge** - Pi uses EventBus pub/sub. We subscribe to Pi events, translate them to `EforgeEvent`s, and push into an `AsyncEventQueue` (already exists in `src/engine/concurrency.ts`). The generator yields from this queue. Queue is closed when the Pi session completes or errors.

3. **MCP bridge spawns clients lazily** - `PiMcpBridge` connects to MCP servers on first use and caches clients. Each MCP tool becomes a Pi `AgentTool` with name `mcp_{serverName}_{toolName}`. The bridge has a `close()` method for cleanup.

4. **JSON Schema to TypeBox conversion** - Recursive converter handles `string`, `number`, `integer`, `boolean`, `object`, `array`, `enum`, `anyOf`/`oneOf`, `$ref` (within the same schema), and nullable types. Falls back to `Type.Any()` for unsupported schemas. This is intentionally conservative - better to accept any input than to crash on an exotic MCP tool schema.

5. **Tool filtering** - Pi doesn't have built-in tool filtering. `PiBackend.run()` filters the tool array based on `allowedTools` / `disallowedTools` before passing to the session. This happens after MCP tools and extension tools are collected.

6. **Thinking level mapping** - `ThinkingConfig` maps to Pi's thinking levels: `disabled` -> `off`, `adaptive` -> `medium`, `enabled` -> `high`. `EffortLevel` fallback: `low` -> `off`, `medium` -> `medium`, `high`/`max` -> `high`.

7. **Budget enforcement** - Track cumulative cost from Pi session stats after each turn. If `maxBudgetUsd` is set and exceeded, abort the session.

8. **Extension visibility** - Extensions are only loaded for `tools: 'coding'` agents. Read-only agents (`tools: 'none'`) get Pi's built-in read-only tools only. When `config.agents.bare` is true, skip extension auto-discovery and Pi settings files entirely.

9. **Auth flow** - Dual-source: `config.pi.apiKey` and provider-specific env vars (e.g., `OPENROUTER_API_KEY`) take priority. Falls back to Pi's `~/.pi/agent/auth.json` for existing Pi users.

10. **Model resolution** - Follows eforge's existing chain: per-role `agents.roles.<role>.model` > global `agents.model` > `pi.model` > Pi's own default. The `PiBackend` receives the already-resolved model from `resolveAgentConfig()` via `options.model`.

## Scope

### In Scope
- `PiBackend` class implementing `AgentBackend.run()` with full event translation
- `PiMcpBridge` class for MCP server tool bridging with JSON Schema -> TypeBox conversion
- `discoverPiExtensions()` function for extension path discovery
- Event translation: Pi EventBus events -> EforgeEvents (message, tool_use, tool_result, result)
- `agent:start` / `agent:stop` lifecycle event wrapping
- Thinking level mapping (eforge ThinkingConfig -> Pi thinking levels)
- Tool preset handling (`coding` vs `none`)
- Tool filtering via `allowedTools` / `disallowedTools`
- Budget enforcement via cumulative cost tracking
- Fallback model retry on model errors
- AbortSignal wiring to `session.abort()`
- `bare` mode support (skip extension auto-discovery, skip Pi settings files)
- Barrel exports in `src/engine/index.ts`

### Out of Scope
- Config schema changes (plan-01)
- Engine wiring in `EforgeEngine.create()` (plan-03)
- Tests (plan-03)

## Files

### Create
- `src/engine/backends/pi.ts` - `PiBackend` class implementing `AgentBackend`, `PiBackendOptions` interface, event translation, thinking mapping, tool filtering, budget enforcement, abort wiring
- `src/engine/backends/pi-mcp-bridge.ts` - `PiMcpBridge` class for MCP tool bridging, `jsonSchemaToTypeBox()` recursive converter, `McpToolWrapper` Pi AgentTool implementation
- `src/engine/backends/pi-extensions.ts` - `discoverPiExtensions()` function, `PiExtensionConfig` type

### Modify
- `src/engine/index.ts` - Add barrel exports for `PiBackend`, `PiBackendOptions`, `PiMcpBridge`, `discoverPiExtensions`

## Verification

- [ ] `pnpm type-check` passes with all new files
- [ ] `PiBackend` implements `AgentBackend` interface (i.e., has `async *run()` method with correct signature)
- [ ] `PiBackendOptions` includes `mcpServers`, `extensions`, `bare`, and `piConfig` fields
- [ ] `jsonSchemaToTypeBox()` handles all JSON Schema primitive types: `string`, `number`, `integer`, `boolean`
- [ ] `jsonSchemaToTypeBox()` handles `object` with `properties` and `required`
- [ ] `jsonSchemaToTypeBox()` handles `array` with `items`
- [ ] `jsonSchemaToTypeBox()` handles `enum` arrays
- [ ] `jsonSchemaToTypeBox()` returns `Type.Any()` for unrecognized schemas
- [ ] MCP tools are namespaced as `mcp_{serverName}_{toolName}`
- [ ] `discoverPiExtensions()` resolves paths from explicit `paths` config, `.pi/extensions/` in project root, and `~/.pi/extensions/` global directory
- [ ] `discoverPiExtensions()` skips auto-discovery when `autoDiscover: false`
- [ ] Thinking mapping: `{ type: 'disabled' }` -> `'off'`, `{ type: 'adaptive' }` -> `'medium'`, `{ type: 'enabled' }` -> `'high'`
- [ ] Tool filtering: when `allowedTools: ['Read', 'Write']` is set, only tools named `Read` and `Write` are passed to the Pi session
- [ ] `bare` mode: when `bare: true`, extension auto-discovery is skipped
