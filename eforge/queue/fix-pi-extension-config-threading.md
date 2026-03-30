---
title: Fix Pi Extension Config Threading
created: 2026-03-30
status: pending
---



# Fix Pi Extension Config Threading

## Problem / Motivation

`PiConfig.extensions` (`autoDiscover`, `include`, `exclude`) is parsed from `eforge/config.yaml` and validated by Zod, but never threaded to `PiBackend`. The `extensions` option is omitted in `eforge.ts:185`. Additionally, `PiExtensionConfig` (the type accepted by `discoverPiExtensions()`) lacks `include`/`exclude` fields, so even if config were threaded, filtering wouldn't happen. This means users who set `pi.extensions.autoDiscover: false`, `include`, or `exclude` in config get silently ignored.

## Goal

Ensure that `pi.extensions` config (including `autoDiscover`, `include`, and `exclude`) is fully threaded from config parsing through to extension discovery, and that include/exclude filtering is actually applied to auto-discovered extensions.

## Approach

Three changes:

### 1. Add `include`/`exclude` to `PiExtensionConfig` and apply filtering

**File:** `src/engine/backends/pi-extensions.ts`

Add `include?` and `exclude?` string arrays to `PiExtensionConfig`:

```typescript
export interface PiExtensionConfig {
  paths?: string[];
  autoDiscover?: boolean;
  include?: string[];   // NEW - only include extensions with these directory names
  exclude?: string[];   // NEW - exclude extensions with these directory names
}
```

Apply filtering at the end of `discoverPiExtensions()` before returning. Filter by the extension directory's `basename`:
- If `include` is set: keep only extensions whose basename is in the include list
- If `exclude` is set: remove extensions whose basename is in the exclude list
- Applied in order: include filter first (whitelist), then exclude (blacklist)
- Explicit `paths` are NOT filtered by include/exclude (they are intentionally specified)

Implementation approach: collect auto-discovered paths separately, apply include/exclude to just those, then combine with explicit paths.

### 2. Thread config to `PiBackend`

**File:** `src/engine/eforge.ts:185-189`

Pass `extensions` when constructing `PiBackend`:

```typescript
backend: new PiBackend({
  mcpServers: options.mcpServers,
  piConfig: config.pi,
  bare: config.agents.bare,
  extensions: {
    autoDiscover: config.pi.extensions.autoDiscover,
    include: config.pi.extensions.include,
    exclude: config.pi.extensions.exclude,
  },
}),
```

### 3. Unit tests

**File:** new `test/pi-extension-discovery.test.ts`

Uses `useTempDir()` from `test/test-tmpdir.ts`.

Test cases:
1. Discovers subdirectories under `.pi/extensions/` (auto-discover default)
2. Returns empty when `.pi/extensions/` doesn't exist
3. Returns only explicit paths when `autoDiscover: false`
4. Skips non-directory entries (files in extensions dir)
5. Combines explicit paths with auto-discovered paths (explicit first)
6. `include` filters auto-discovered extensions by directory name
7. `exclude` removes matching auto-discovered extensions
8. `include` + `exclude` together: include whitelist first, then exclude blacklist
9. `include`/`exclude` do NOT filter explicit `paths`

Does NOT test `~/.pi/extensions/` global path - same `collectExtensionDirs` logic handles both locations, and reading the real home directory is inappropriate in tests.

## Scope

**In scope:**
- Adding `include`/`exclude` fields to `PiExtensionConfig` type
- Implementing include/exclude filtering logic in `discoverPiExtensions()`
- Threading `extensions` config from `eforge.ts` to `PiBackend` constructor
- Unit tests for extension discovery and filtering

**Out of scope:**
- Changes to `src/engine/config.ts:310` (PiConfig type already has include/exclude)
- Changes to `src/engine/backends/pi.ts:32-41` (PiBackendOptions already accepts PiExtensionConfig)
- Testing `~/.pi/extensions/` global path (same `collectExtensionDirs` logic, inappropriate to read real home dir in tests)

**Critical files:**
- `src/engine/backends/pi-extensions.ts` - add include/exclude to type and filtering logic
- `src/engine/eforge.ts:185-189` - thread config to PiBackend constructor
- `src/engine/config.ts:310` - reference only
- `src/engine/backends/pi.ts:32-41` - reference only
- `test/test-tmpdir.ts` - reuse existing helper

## Acceptance Criteria

1. `pnpm test test/pi-extension-discovery.test.ts` - all nine unit tests pass
2. `pnpm type-check` - no type errors
3. `pnpm build` - builds cleanly
4. `PiExtensionConfig` includes `include?: string[]` and `exclude?: string[]` fields
5. `discoverPiExtensions()` applies include filtering (whitelist) then exclude filtering (blacklist) to auto-discovered extensions only
6. Explicit `paths` are not affected by include/exclude filters
7. `eforge.ts` threads `extensions` config (autoDiscover, include, exclude) to `PiBackend` constructor
