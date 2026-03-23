---
title: Fix Diff Viewer Syntax Highlighting
created: 2026-03-23
status: pending
---



# Fix Diff Viewer Syntax Highlighting

## Problem / Motivation

The Changes tab in the eforge monitor UI lost diff syntax highlighting after switching from Linux to Mac. Diffs render as plain monochrome text (the fallback `<pre>` path) instead of Shiki-highlighted output with colored additions/deletions.

**Root cause**: Shiki initialization fails silently. The `catch` at `diff-viewer.tsx:132` logs to `console.error` but leaves `highlightedHtmls` empty, so the fallback renders. The Linux→Mac switch likely caused this via a stale build, different Shiki version resolution, or platform-specific WASM bundling differences.

**Secondary issue**: `git diff-tree -p` prepends a bare commit SHA line that isn't valid diff syntax and adds noise.

Additionally, there is a bug where the `cancelled` parameter in `highlightEntries` is passed by value (always `false`), making the cancellation check on line 113 useless during async initialization.

## Goal

Restore robust Shiki-based diff syntax highlighting in the monitor's Changes tab by sharing a single cached highlighter instance across components, cleaning up git diff output, and improving error visibility when highlighting fails.

## Approach

Keep Shiki as the diff renderer (same approach used by `plan-body-highlight.tsx`) but make it robust:

### 1. `src/monitor/server.ts` — Strip commit SHA from diff output

Add `--no-commit-id` to the two `git diff-tree -p` calls that serve patch output. The SHA is already returned as a separate JSON field.

- **Line 645** (single-file): add `'--no-commit-id'` before `'-p'`
- **Line 680** (bulk per-file): add `'--no-commit-id'` before `'-p'`

### 2. `src/monitor/ui/src/components/heatmap/diff-viewer.tsx` — Make Shiki initialization robust

**a) Share the highlighter pattern from `plan-body-highlight.tsx`**: Instead of creating a separate Shiki instance with only `['diff']`, include `'diff'` in the same language set and share a cached highlighter. Both components already cache at module level — unify them.

**b) Add `'diff'` to the `CODE_LANGS` array in `plan-body-highlight.tsx`** (line 6) so a shared highlighter supports it.

**c) Extract a shared `getHighlighter()` utility** into a new file `src/monitor/ui/src/lib/shiki.ts` that:
- Caches a single Shiki `Highlighter` instance
- Loads all needed languages (the `CODE_LANGS` list + `'diff'`)
- Returns a Promise that resolves to the cached highlighter
- Both `diff-viewer.tsx` and `plan-body-highlight.tsx` import from this shared module

**d) Improve error visibility**: If highlighting fails, show a subtle indicator (e.g., a small warning icon or dimmed "highlighting unavailable" text) rather than silently falling back. This makes debugging easier.

**e) Fix the `cancelled` parameter bug**: `highlightEntries` receives `cancelled` by value (always `false`), making the cancellation check on line 113 useless. Pass a ref or closure instead so the cancel actually works during async initialization.

### 3. `src/monitor/server.ts` — Add `.wasm` MIME type (defensive)

Add `'.wasm': 'application/wasm'` to the `MIME_TYPES` map at line 20. While Shiki currently inlines its WASM, this prevents future breakage if Shiki changes its bundling strategy.

### Files to modify

| File | Change |
|---|---|
| `src/monitor/server.ts` | Add `--no-commit-id` to 2 git diff-tree calls; add `.wasm` MIME type |
| `src/monitor/ui/src/lib/shiki.ts` | **New file**: shared `getHighlighter()` with all languages + `diff` |
| `src/monitor/ui/src/components/heatmap/diff-viewer.tsx` | Use shared highlighter; fix cancelled-by-value bug; improve error visibility |
| `src/monitor/ui/src/components/preview/plan-body-highlight.tsx` | Use shared highlighter instead of inline creation |

## Scope

**In scope:**
- Fixing Shiki initialization to be robust and shared across components
- Stripping commit SHA prefix from `git diff-tree` output
- Adding `.wasm` MIME type defensively
- Fixing the `cancelled` parameter by-value bug
- Adding visible error indicator when highlighting fails

**Out of scope:**
- Changing the `shiki` package version in `package.json` (stays the same)
- Modifying the DiffViewer props interface
- Changing the API contract
- Replacing Shiki with an alternative renderer

## Acceptance Criteria

1. `pnpm build` completes with no type or build errors.
2. Opening the browser devtools console, reloading the monitor, and clicking a file in the Changes tab produces no Shiki errors in the console.
3. Diffs display green additions, red deletions, and cyan hunk headers (syntax highlighting is restored).
4. `plan-body-highlight` continues to work correctly (Plans tab syntax highlighting is unaffected).
5. Horizontal scroll works for long diff lines (no wrapping).
6. The commit SHA prefix line no longer appears in diff output.
7. When highlighting fails, a visible indicator (e.g., warning icon or dimmed "highlighting unavailable" text) is shown rather than a silent fallback.
8. The cancellation mechanism in `highlightEntries` correctly cancels during async initialization (no longer passed by value).
