---
id: plan-01-shorten-path
name: Smart file path shortening in Changes heatmap
depends_on: []
branch: smart-file-path-shortening-in-changes-heatmap/shorten-path
---

# Smart file path shortening in Changes heatmap

## Architecture Context

The monitor UI's Changes tab shows a file heatmap where each row displays a file path alongside risk-level cells per plan. Currently, paths are truncated from the right via CSS `text-ellipsis`, hiding the filename — the most important segment. The column is also narrow at 216px, worsening truncation.

This plan adds a pure `shortenPath()` utility that truncates from the left (preserving the filename and trailing directories) and widens the column.

## Implementation

### Overview

1. Add `shortenPath(path, maxChars?)` to `src/monitor/ui/src/lib/format.ts`
2. Update `file-heatmap.tsx` to use it and widen the file column
3. Add unit tests for `shortenPath()`

### Key Decisions

1. **Left-truncation with `…/` prefix** — always preserves the filename. Greedily includes parent directories from right to left until `maxChars` is exceeded.
2. **Default `maxChars=50`** — fits comfortably in the widened 320px column at 10px font size.
3. **Never truncate the filename** — if `…/<filename>` exceeds `maxChars`, return it anyway. Filenames are sacrosanct.

## Scope

### In Scope
- New `shortenPath()` utility function in `format.ts`
- Widen heatmap file column from `w-[216px]` to `w-[320px]`
- Update header padding from `218px` to `322px`
- Replace raw `{file.path}` with `{shortenPath(file.path)}` in heatmap rendering
- Retain `title={file.path}` for full-path hover tooltip
- Unit tests covering: short paths unchanged, deep path truncation, greedy trailing dir inclusion, very long filenames, empty/single-segment paths, custom `maxChars`

### Out of Scope
- Changes to other monitor UI components
- Dynamic column sizing or responsive behavior

## Files

### Modify
- `src/monitor/ui/src/lib/format.ts` — Add `shortenPath(path: string, maxChars?: number): string` utility function at the end of the file. Algorithm: if path fits, return unchanged; split on `/`; always keep last segment (filename); greedily prepend parent dirs from right to left; prepend `…/` when dirs are truncated; if even `…/<filename>` exceeds `maxChars`, return `…/<filename>` anyway.
- `src/monitor/ui/src/components/heatmap/file-heatmap.tsx` — Three changes: (1) line 96: change `paddingLeft: '218px'` to `paddingLeft: '322px'`; (2) line 117: change `w-[216px]` to `w-[320px]`; (3) line 121: change `{file.path}` to `{shortenPath(file.path)}`. Add import for `shortenPath` from `@/lib/format`.

### Create
- `test/shorten-path.test.ts` — Unit tests for `shortenPath()`. Import directly from the source file (`../src/monitor/ui/src/lib/format`). Test cases: short path returned unchanged (`src/a.ts` with `maxChars=50`), deep path truncated preserving filename (`src/monitor/ui/src/components/preview/plan-preview-context.tsx` → `…/preview/plan-preview-context.tsx`), trailing dirs greedily included, very long filename where `…/<filename>` exceeds `maxChars` still returns `…/<filename>`, empty string returns empty string, single-segment path (`file.ts`) returned unchanged, custom `maxChars` parameter respected.

## Verification

- [ ] `shortenPath('src/a.ts', 50)` returns `'src/a.ts'` (fits within limit)
- [ ] `shortenPath('src/monitor/ui/src/components/preview/plan-preview-context.tsx', 50)` returns `'…/preview/plan-preview-context.tsx'`
- [ ] `shortenPath('a/b/c/d/e/file.ts', 20)` includes as many trailing dirs as fit, prefixed with `…/`
- [ ] `shortenPath('very-long-filename-that-exceeds-max-chars.tsx', 10)` returns the full filename (never truncated)
- [ ] `shortenPath('')` returns `''`
- [ ] `shortenPath('file.ts')` returns `'file.ts'`
- [ ] File heatmap column width is `w-[320px]` and header padding is `322px`
- [ ] `{shortenPath(file.path)}` is rendered in the heatmap; `title={file.path}` is preserved for tooltip
- [ ] `pnpm type-check` passes with no errors
- [ ] `pnpm test` passes including new `shorten-path.test.ts`
- [ ] `pnpm build` completes with exit code 0
