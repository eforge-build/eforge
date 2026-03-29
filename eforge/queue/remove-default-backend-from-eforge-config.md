---
title: Remove default backend from eforge config
created: 2026-03-29
status: pending
---



# Remove default backend from eforge config

## Problem / Motivation

Following the pattern of removing opinionated defaults from Pi config (default model, default provider), the `backend` field currently defaults to `'claude-sdk'`. Users should explicitly choose their backend rather than having one silently selected for them. This aligns with the broader effort to remove opinionated defaults and guide users through explicit configuration via the `/eforge:config` flow.

## Goal

Make `backend` a required, explicit configuration choice with no default value, so users are guided to consciously select their backend.

## Approach

Make the `backend` field optional in the config interface, remove its default value, and add early validation that throws a clear error when no backend is configured. Update the config skill documentation to reflect that backend selection is required. Callers that pass `config.backend` explicitly continue to work; the model class default lookup is skipped when backend is undefined.

### Detailed Changes

#### `src/engine/config.ts`

1. **Make `backend` optional in `EforgeConfig` interface** (line 316): `backend: 'claude-sdk' | 'pi'` → `backend?: 'claude-sdk' | 'pi'`
2. **Remove default backend from `DEFAULT_CONFIG`** (line 386): Delete `backend: 'claude-sdk' as const,`
3. **Update `resolveConfig`** (line 459): Change `backend: fileConfig.backend ?? DEFAULT_CONFIG.backend` to `backend: fileConfig.backend`

#### `src/engine/eforge.ts`

4. **Add early validation** (around line 172) - before the Pi backend check, throw if no backend is configured:

```typescript
if (!options.backend && !config.backend) {
  throw new Error('No backend configured. Set backend in eforge/config.yaml (claude-sdk or pi). Run /eforge:config to set up.');
}
```

The existing `config.backend === 'pi'` check at line 172 continues to work - it just won't match when `config.backend` is undefined.

#### `src/engine/pipeline.ts`

5. **Update `resolveAgentConfig` default parameter** (line 312): Change `backend: 'claude-sdk' | 'pi' = 'claude-sdk'` to `backend?: 'claude-sdk' | 'pi'`. Callers already pass `ctx.config.backend` explicitly. The `MODEL_CLASS_DEFAULTS` lookup and validation (lines 365-372) need to handle undefined backend - if backend is undefined, skip the model class default lookup (no defaults available).

#### `eforge-plugin/skills/config/config.md`

6. **Update config skill** (line 42): Remove "(default, uses Claude Code's built-in SDK)" wording. Make it clear this is a required choice:

> 1. **Backend selection** (required) - Which LLM backend: `claude-sdk` (Claude Code's built-in SDK, zero API cost with Max subscription) or `pi` (multi-provider via Pi SDK supporting OpenRouter, Anthropic, OpenAI, Google, etc.).

7. **Update Pi backend section** (line 53): Remove `model` reference from the Pi config section (already removed from Pi config). Remove mention of `provider/model` format.

#### `eforge-plugin/.claude-plugin/plugin.json`

8. **Bump plugin version** from `0.5.11` to `0.5.12` (config skill changed).

## Scope

**In scope:**
- Removing the default `backend` value from config
- Making `backend` optional in the type interface
- Adding validation for missing backend with a clear error message
- Updating config skill documentation to reflect required backend selection
- Handling undefined backend in `resolveAgentConfig` model class default lookup
- Plugin version bump

**Out of scope:**
- Changes to other default values
- Changes to the `/eforge:config` flow itself
- Any changes to Pi config defaults (already handled separately)

## Acceptance Criteria

- `pnpm type-check` passes
- `pnpm test` passes
- Running `eforge config validate` with no `backend` field reports missing backend
- Running `eforge config validate` with `backend: claude-sdk` passes
- `EforgeConfig.backend` is typed as optional (`backend?: 'claude-sdk' | 'pi'`)
- `DEFAULT_CONFIG` does not contain a `backend` field
- `resolveAgentConfig` handles undefined backend by skipping model class default lookup
- Config skill documentation describes backend selection as required, with no default indicated
- Plugin version is `0.5.12`
