---
title: Pass `--bare` to Claude Code backend when `ANTHROPIC_API_KEY` is set
created: 2026-03-27
status: pending
---



# Pass `--bare` to Claude Code backend when `ANTHROPIC_API_KEY` is set

## Problem / Motivation

When `ANTHROPIC_API_KEY` is present in the environment, eforge is using direct API billing rather than a Max subscription. In this mode, the Claude Code subprocess auto-loads the user's default settings and tools, which adds unnecessary cost. eforge already explicitly passes `mcpServers`, `plugins`, and `settingSources` via SDK options, so the subprocess's own auto-loading is redundant and wasteful.

## Goal

Automatically pass `--bare` to the Claude Code subprocess when direct API billing is detected (via `ANTHROPIC_API_KEY`), while allowing explicit user override in config. This suppresses the subprocess's auto-loading of default settings/tools without affecting eforge's own explicit configuration.

## Approach

- Add a `bare` boolean option to the eforge config schema under `agents`, defaulting to `false`.
- During config resolution, auto-detect `bare` based on the presence of `ANTHROPIC_API_KEY` in the environment, allowing explicit config to override.
- Thread the resolved `bare` value through to the `ClaudeSDKBackend`, which conditionally passes `extraArgs: { bare: null }` (producing `--bare` on the CLI) into the SDK query options.
- The SDK's `extraArgs` option supports `{ bare: null }` to produce `--bare` on the CLI.
- `--bare` only suppresses the subprocess's own auto-loading; eforge's explicit config (mcpServers, plugins, settingSources) still applies.

## Scope

**In scope:**

- Config schema, type, default, and resolution changes in `src/engine/config.ts`
- Backend options and `extraArgs` pass-through in `src/engine/backends/claude-sdk.ts`
- Threading config to backend in `src/engine/eforge.ts`
- Unit tests for config resolution in `test/config.test.ts`

**Out of scope:**

- N/A

## Acceptance Criteria

- `bare` field added to `eforgeConfigSchema.agents` as `z.boolean().optional()`
- `bare: boolean` added to `EforgeConfig.agents` type
- `bare: false` set in `DEFAULT_CONFIG.agents`
- `resolveConfig()` resolves `bare` as: `fileConfig.agents?.bare ?? !!env.ANTHROPIC_API_KEY`
- `ClaudeSDKBackendOptions` includes `bare?: boolean`, stored as `private readonly bare: boolean` in the constructor
- `ClaudeSDKBackend.run()` spreads `extraArgs: { bare: null }` into `sdkQuery` options when `this.bare` is true
- eforge private constructor passes `bare: config.agents.bare` to `ClaudeSDKBackend`
- Tests added to `test/config.test.ts` in the existing `resolveConfig` describe block:
  - `bare` defaults to `false` when no env var is set
  - `bare` auto-enables when `ANTHROPIC_API_KEY` is present
  - Explicit `agents.bare: false` overrides env auto-detection
  - Explicit `agents.bare: true` forces bare mode without env var
- `pnpm test` passes (all existing + new tests)
- `pnpm type-check` passes with no type errors
- Manual verification: `ANTHROPIC_API_KEY=test pnpm dev -- config show` outputs `agents.bare: true`

### Files changed

| File | Change |
|------|--------|
| `src/engine/config.ts` | Schema, type, defaults, resolution |
| `src/engine/backends/claude-sdk.ts` | Options, storage, `extraArgs` pass-through |
| `src/engine/eforge.ts` | Thread `config.agents.bare` to backend |
| `test/config.test.ts` | Resolution tests |
