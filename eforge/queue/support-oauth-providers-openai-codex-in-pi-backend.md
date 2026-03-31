---
title: Support OAuth Providers (openai-codex) in Pi Backend
created: 2026-03-31
status: pending
---



# Support OAuth Providers (openai-codex) in Pi Backend

## Problem / Motivation

eforge's Pi backend currently uses `AuthStorage.inMemory()` which only supports explicit API keys. Subscription-based providers like `openai-codex` (ChatGPT Plus/Pro) use OAuth tokens stored in `~/.pi/agent/auth.json` after `pi /login`. The in-memory storage can't read these tokens, so OAuth providers are non-functional. Additionally, eforge's manual `resolveApiKey` function is redundant - Pi's file-backed AuthStorage already handles the full priority chain (runtime overrides > auth.json > env vars) natively.

## Goal

Switch to `AuthStorage.create()` (file-backed) so that OAuth providers like `openai-codex` and `github-copilot` work automatically, while simplifying auth resolution by removing redundant code.

## Approach

Replace the custom `resolveApiKey` function and `AuthStorage.inMemory()` usage with Pi's native `AuthStorage.create()` (file-backed), which reads `~/.pi/agent/auth.json` and handles the full priority chain natively. Preserve the `piConfig.apiKey` override (highest priority) via `setRuntimeApiKey`.

### 1. Simplify auth in `src/engine/backends/pi.ts`

- Delete the `resolveApiKey` function (lines 265-285) - Pi's file-backed AuthStorage already checks env vars and auth.json
- Replace auth storage construction (lines 333-339):
  ```typescript
  // Before:
  const apiKey = resolveApiKey(model.provider, this.piConfig);
  const authStorage = apiKey
    ? AuthStorage.inMemory({ [model.provider]: { type: 'api_key', key: apiKey } })
    : AuthStorage.inMemory();

  // After:
  const authStorage = AuthStorage.create();
  if (this.piConfig?.apiKey) {
    authStorage.setRuntimeApiKey(model.provider, this.piConfig.apiKey);
  }
  ```
- This preserves the `piConfig.apiKey` override (highest priority) via `setRuntimeApiKey`, while letting Pi handle env vars and OAuth tokens from auth.json natively

### 2. Update `PiConfig` doc comment in `src/engine/config.ts`

No type changes needed. Update the comment on the `apiKey` field to clarify it's an optional override - OAuth and env vars are handled automatically.

### 3. Update `docs/config.md`

- Note that OAuth providers (`openai-codex`, `github-copilot`, etc.) are supported
- Add setup instructions: authenticate via `pi` CLI first, then configure `pi.provider: openai-codex`
- Document that `pi.apiKey` is an optional override for API-key providers; OAuth providers use `~/.pi/agent/auth.json` automatically

## Scope

**In scope:**
- `src/engine/backends/pi.ts` - auth resolution (primary change)
- `docs/config.md` - document OAuth provider support

**Out of scope:**
- N/A

## Acceptance Criteria

1. `pnpm type-check` passes with no type errors
2. `pnpm test` - existing tests pass (engine-wiring test mocks PiBackend, unaffected)
3. `pnpm build` - clean build
4. Manual verification: configure `backend: pi` + `pi.provider: openai-codex` in `eforge/config.yaml`, verify the engine creates a file-backed AuthStorage (observable via a test build attempt - should fail with "not logged in" rather than silently passing empty auth)
5. The `resolveApiKey` function is removed from `src/engine/backends/pi.ts`
6. `AuthStorage.create()` is used instead of `AuthStorage.inMemory()`
7. `piConfig.apiKey` override still works via `setRuntimeApiKey` for API-key providers
8. `docs/config.md` documents OAuth provider support, setup instructions, and the optional nature of `pi.apiKey`
