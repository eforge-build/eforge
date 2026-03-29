---
title: Add Pi Mono Backend for eforge
created: 2026-03-29
status: pending
---

# Add Pi Mono Backend for eforge

## Problem / Motivation

eforge currently has a single `AgentBackend` implementation (`ClaudeSDKBackend`) that uses the Claude Agent SDK. This limits users to a single LLM provider and creates a hard dependency on Claude Code's SDK. The roadmap calls for a multi-provider backend via pi-mono to give users provider flexibility (OpenRouter, Anthropic direct, Google, Mistral, Groq, xAI, Bedrock, Azure, and 20+ other providers) without depending on Claude Code's SDK. This opens eforge to users who prefer different LLM providers, want to control costs via OpenRouter, or already use Pi and want their extensions available in eforge builds.

## Goal

Implement a `PiBackend` class that integrates `@mariozechner/pi-coding-agent` as a second `AgentBackend` implementation, giving eforge users provider flexibility, extension support, and cost control through OpenRouter and other providers - all selectable via a single `backend: pi` config flag.

## Approach

### Package choice

Depend on `@mariozechner/pi-coding-agent` directly. This gets the extension system, tool factories, and session management for free. The transitive deps on `@mariozechner/pi-ai` (unified multi-provider LLM API) and `@mariozechner/pi-agent-core` (agent loop with tool calling, message types) come along.

**Key differences from Claude SDK that must be bridged:**

- Pi uses an **EventBus pub/sub** pattern, not AsyncGenerator - bridge to eforge's generator pattern via an async queue
- Pi has **no MCP support** - bridge MCP tools as Pi `AgentTool` instances
- Pi uses **TypeBox** schemas for tools (vs JSON Schema / Zod) - recursive JSON Schema to TypeBox conversion needed
- Pi has its own **extension system** (TypeScript modules that register tools, commands, event handlers) instead of Claude Code plugins
- Pi thinking levels are `off | medium | high` vs eforge's `adaptive | enabled | disabled`

### A. Config schema changes (`src/engine/config.ts`)

Add a top-level `backend` field and a `pi` section:

```yaml
# eforge/config.yaml
backend: pi  # 'claude-sdk' (default) | 'pi'

pi:
  provider: openrouter           # default LLM provider
  apiKey: ${OPENROUTER_API_KEY}  # env var interpolation
  model: anthropic/claude-sonnet-4  # default model (provider-qualified)
  thinkingLevel: medium          # off | medium | high

  extensions:
    paths:                       # explicit extension paths
      - ~/.pi/extensions/my-ext
      - .pi/extensions/project-ext
    autoDiscover: true           # scan ~/.pi/extensions/ and .pi/extensions/

  compaction:
    enabled: true
    maxContextTokens: 100000

  retry:
    maxRetries: 3
    initialDelayMs: 1000
```

**Model resolution chain** (highest to lowest priority):

1. `agents.roles.<role>.model` (per-role override - works for both backends)
2. `agents.model` (global agent model - works for both backends)
3. `pi.model` (Pi-specific default)
4. Pi's own model resolution (settings, first available)

This means users configure per-role models the same way regardless of backend:

```yaml
backend: pi
pi:
  provider: openrouter
  apiKey: ${OPENROUTER_API_KEY}
agents:
  roles:
    builder:
      model: anthropic/claude-sonnet-4
    reviewer:
      model: google/gemini-2.5-pro
    planner:
      model: anthropic/claude-opus-4
```

**Auth flow**: Dual-source with eforge priority. `eforge/config.yaml` `pi.apiKey` and env vars (e.g. `OPENROUTER_API_KEY`) take priority. Falls back to Pi's `~/.pi/agent/auth.json` so existing Pi users get seamless auth without reconfiguring.

### B. New files

All Pi-specific code in `src/engine/backends/` (following the existing SDK isolation pattern):

| File | Purpose |
|------|---------|
| `src/engine/backends/pi.ts` | `PiBackend` class implementing `AgentBackend`, event translation, thinking mapping |
| `src/engine/backends/pi-mcp-bridge.ts` | MCP server tools -> Pi `AgentTool` adapter, JSON Schema -> TypeBox conversion |
| `src/engine/backends/pi-extensions.ts` | Extension discovery from config paths + auto-discovery |

### C. PiBackend class (`src/engine/backends/pi.ts`)

Implements `AgentBackend.run()` by:

1. Creating a fresh Pi `AgentSession` per `run()` call (no shared session state)
2. Configuring tools based on `options.tools` preset:
   - `'coding'` -> `createCodingTools(cwd)` + MCP-bridged tools + extension tools
   - `'none'` -> `createReadOnlyTools(cwd)` only
3. Applying tool filtering from `allowedTools` / `disallowedTools`
4. Subscribing to Pi's EventBus events and pushing translated `EforgeEvent`s into an async queue
5. Yielding from the queue (bridges EventBus pub/sub -> AsyncGenerator)
6. Wrapping with `agent:start` / `agent:stop` lifecycle events
7. Extracting token/cost stats from Pi session stats for `agent:result`

**Event translation mapping:**

| Pi Event | eforge Event |
|----------|-------------|
| `message-chunk` | `agent:message` (streaming text) |
| `before-tool-call` | `agent:tool_use` |
| `after-tool-call` | `agent:tool_result` |
| Session completion stats | `agent:result` (cost, tokens, turns) |
| `thinking-chunk` | Silently consumed (no eforge equivalent yet) |
| `turn-start/end` | Not mapped (turn count tracked in stats) |

**ThinkingConfig mapping:**

- `disabled` -> `off`
- `adaptive` -> `medium`
- `enabled` -> `high`
- EffortLevel fallback: `low` -> `off`, `medium` -> `medium`, `high/max` -> `high`

### D. MCP bridge (`src/engine/backends/pi-mcp-bridge.ts`)

Bridges `.mcp.json` MCP servers to Pi tools:

1. Spawn MCP server processes via `@modelcontextprotocol/sdk` `StdioClientTransport`
2. Connect MCP clients, call `listTools()` to discover available tools
3. Convert each MCP tool's JSON Schema `inputSchema` to TypeBox via a recursive converter
4. Wrap each as a Pi `AgentTool` with `execute()` that calls `client.callTool()`
5. Namespace tool names as `mcp_{serverName}_{toolName}` to avoid collisions

The bridge exposes a `close()` method for cleanup. `EforgeEngine` manages the lifecycle.

### E. Extension support (`src/engine/backends/pi-extensions.ts`)

Discovery order (project overrides global):

1. Explicit `pi.extensions.paths` from config
2. `.pi/extensions/` in project root (if `autoDiscover: true`)
3. `~/.pi/extensions/` global (if `autoDiscover: true`)

Extensions are loaded by Pi's session factory. Discovered paths are passed as config. This means Pi users who already have extensions at `~/.pi/extensions/` get them automatically in eforge - same UX as Claude Code plugins being auto-discovered.

Extension tool visibility: extensions only available to `tools: 'coding'` agents, matching current MCP/plugin behavior. Read-only agents get only Pi's built-in read-only tools.

### F. Changes to existing files

| File | Change |
|------|--------|
| `src/engine/config.ts` | Add `backend` enum, `pi` config section with Zod schemas, update `EforgeConfig` interface and `DEFAULT_CONFIG` |
| `src/engine/eforge.ts` | Update `EforgeEngine.create()` to branch on `config.backend`, instantiate `PiBackend` with MCP bridge and extensions when `'pi'` |
| `src/engine/index.ts` | Export `PiBackend` and types from barrel |
| `package.json` | Add `@mariozechner/pi-coding-agent`, `@sinclair/typebox` to dependencies |
| `tsup.config.ts` | Add pi packages to `external` array |

### G. Edge cases

- **Tool filtering**: Pi doesn't have built-in tool filtering. `PiBackend.run()` filters the tool array before passing to session based on `allowedTools` / `disallowedTools`.
- **Budget enforcement**: If Pi lacks built-in cost caps, track cost per turn and abort when `maxBudgetUsd` exceeded.
- **Fallback model**: Catch model errors, retry with `fallbackModel` if set.
- **AbortSignal**: Wire `options.abortSignal` to `session.abort()`.
- **Concurrent sessions**: Each `run()` creates an independent session. MCP bridge clients handle concurrent `callTool()` via MCP protocol's request/response correlation.
- **`bare` mode**: When `config.agents.bare` is true, skip extension auto-discovery and Pi settings files.

### Implementation sequence

1. Add dependencies to `package.json` and `tsup.config.ts`
2. Add config schema (`backend`, `pi` section) to `config.ts`
3. Create `pi-extensions.ts` (extension discovery - pure filesystem, no SDK imports)
4. Create `pi-mcp-bridge.ts` (JSON Schema -> TypeBox, MCP tool wrapping)
5. Create `pi.ts` (PiBackend class, event translation, thinking mapping)
6. Wire into `EforgeEngine.create()` in `eforge.ts`
7. Add barrel exports in `index.ts`

### Remaining investigation needed

- Verify how `pi-coding-agent` exposes `AgentSession` for programmatic (non-CLI, headless) use. Need to confirm the exact factory function and whether it supports non-interactive/library mode.

## Scope

### In scope

- New `PiBackend` class implementing the existing `AgentBackend` interface
- Config schema additions for `backend` selection and `pi` configuration section
- MCP tool bridge (JSON Schema -> TypeBox conversion, MCP tool wrapping as Pi `AgentTool` instances)
- Pi extension discovery and loading from explicit paths and auto-discovery locations
- Event translation from Pi's EventBus pub/sub pattern to eforge's AsyncGenerator event stream
- Thinking level mapping between eforge and Pi conventions
- Model resolution chain supporting both per-role and global model configuration
- Dual-source auth flow (eforge config priority, Pi auth fallback)
- Tool filtering, budget enforcement, abort signal wiring, fallback model support
- `bare` mode support (skip extension auto-discovery and Pi settings files)
- Dependencies: `@mariozechner/pi-coding-agent`, `@sinclair/typebox`

### Out of scope

- N/A (not explicitly stated in input)

## Acceptance Criteria

1. `pnpm type-check` passes - all new types integrate correctly with existing codebase
2. `pnpm test` passes - existing tests have no regressions
3. New unit test `test/pi-event-mapping.test.ts` validates Pi event -> EforgeEvent translation for all mapped event types
4. New unit test `test/pi-mcp-bridge.test.ts` validates JSON Schema -> TypeBox conversion
5. New unit test `test/pi-thinking-mapping.test.ts` validates ThinkingConfig -> Pi thinking level mapping (`disabled` -> `off`, `adaptive` -> `medium`, `enabled` -> `high`, plus EffortLevel fallbacks)
6. New unit test `test/pi-config.test.ts` validates config parsing and validation for `backend` and `pi` sections
7. Manual integration test: configure `eforge/config.yaml` with `backend: pi` and an OpenRouter key, run `eforge build` on a small PRD, verify the full pipeline works end-to-end
8. Setting `backend: pi` in config causes `EforgeEngine.create()` to instantiate `PiBackend` instead of `ClaudeSDKBackend`
9. Setting `backend: claude-sdk` (or omitting `backend`) preserves existing behavior with no changes
10. Per-role model overrides (e.g., different models for builder, reviewer, planner) work correctly with the Pi backend
11. MCP tools from `.mcp.json` are available to Pi coding agents with `mcp_{serverName}_{toolName}` namespacing
12. Pi extensions are discovered from explicit paths and auto-discovery locations, and are only available to `tools: 'coding'` agents
13. `bare` mode skips extension auto-discovery and Pi settings files
