---
id: plan-01-bare-config
name: Add bare mode config and backend threading
depends_on: []
branch: pass-bare-to-claude-code-backend-when-anthropic-api-key-is-set/bare-config
---

# Add bare mode config and backend threading

## Architecture Context

When `ANTHROPIC_API_KEY` is set, eforge uses direct API billing. The Claude Code subprocess auto-loads default settings/tools, but eforge already explicitly passes `mcpServers`, `plugins`, and `settingSources`. Passing `--bare` via the SDK's `extraArgs` suppresses redundant auto-loading without affecting eforge's explicit configuration.

The SDK's `query()` options support `extraArgs?: Record<string, string | null>` where `{ bare: null }` produces `--bare` on the CLI.

## Implementation

### Overview

Add a `bare` boolean to the config schema, auto-resolve it from `ANTHROPIC_API_KEY` presence, thread it to `ClaudeSDKBackend`, and conditionally pass `extraArgs: { bare: null }` to the SDK.

### Key Decisions

1. `bare` lives under `agents` config section since it controls agent subprocess behavior, consistent with `maxTurns`, `permissionMode`, and `settingSources`.
2. Auto-detection uses `!!env.ANTHROPIC_API_KEY` but explicit config (`agents.bare`) takes precedence - this follows the existing pattern where env vars override defaults but file config is checked first (similar to langfuse key handling, but inverted: here file config wins over env auto-detect).
3. Resolution formula: `fileConfig.agents?.bare ?? !!env.ANTHROPIC_API_KEY` - if the user explicitly sets `bare: false` in config, it overrides env auto-detection.

## Scope

### In Scope
- `bare` field in Zod schema, TypeScript type, defaults, and resolution
- `ClaudeSDKBackendOptions.bare` and storage in constructor
- `extraArgs: { bare: null }` in `ClaudeSDKBackend.run()` when bare is true
- Threading `config.agents.bare` to backend in `eforge.ts` constructor
- Unit tests for all 4 resolution scenarios in `test/config.test.ts`

### Out of Scope
- CLI flags for `--bare` override (not in PRD)
- Changes to other backends or the `AgentBackend` interface

## Files

### Modify
- `src/engine/config.ts` - Add `bare: z.boolean().optional()` to `eforgeConfigSchema.agents`, add `bare: boolean` to `EforgeConfig.agents`, set `bare: false` in `DEFAULT_CONFIG.agents`, resolve `bare` in `resolveConfig()` as `fileConfig.agents?.bare ?? !!env.ANTHROPIC_API_KEY`
- `src/engine/backends/claude-sdk.ts` - Add `bare?: boolean` to `ClaudeSDKBackendOptions`, store as `private readonly bare: boolean` (defaulting to `false`), spread `extraArgs: { bare: null }` into SDK query options when `this.bare` is true
- `src/engine/eforge.ts` - Pass `bare: config.agents.bare` to `ClaudeSDKBackend` constructor in the private constructor
- `test/config.test.ts` - Add 4 tests in the existing `resolveConfig` describe block: bare defaults false, bare auto-enables with ANTHROPIC_API_KEY, explicit false overrides env, explicit true forces bare

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0 with all existing and new tests passing
- [ ] `resolveConfig({}, {}).agents.bare` returns `false`
- [ ] `resolveConfig({}, { ANTHROPIC_API_KEY: 'test' }).agents.bare` returns `true`
- [ ] `resolveConfig({ agents: { bare: false } }, { ANTHROPIC_API_KEY: 'test' }).agents.bare` returns `false`
- [ ] `resolveConfig({ agents: { bare: true } }, {}).agents.bare` returns `true`
- [ ] `ClaudeSDKBackend` constructed with `bare: true` includes `extraArgs: { bare: null }` in SDK query options
- [ ] `ClaudeSDKBackend` constructed with `bare: false` (or omitted) does not include `extraArgs` in SDK query options
