---
title: Plan: npm package distribution
created: 2026-03-20
status: pending
---

# npm Package Distribution

## Problem / Motivation

eforge is ready for public distribution - the repo is public, the unscoped `eforge` name is available on npm, and the library API surface (`src/engine/index.ts`) is already comprehensive. Today the build only produces a CLI binary. There's no way to `import { EforgeEngine } from 'eforge'`, no type declarations ship, and `npm pack` would exclude `dist/` because `.gitignore` blocks it and no `files` field overrides that.

## Goal

Add a library entry point to the tsup build, generate `.d.ts` files via tsc, and configure package.json exports/files/publishConfig so the package works as both a global CLI and an importable library.

## Approach

### 1. Create `tsconfig.build.json`

Declaration-only emit config extending the base tsconfig:

- `emitDeclarationOnly: true`, `declaration: true`
- `declarationDir: "dist/types"`
- `noEmit: false` (override base)
- Exclude `test/`, `src/monitor/ui/`

### 2. Update `tsup.config.ts`

Add a second build entry for the library alongside the existing CLI and monitor-server entries:

```
// Library entry - code-split, no shebang, all deps external
{
  entry: { index: "src/engine/index.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: false,
  splitting: true,
  external: [all dependencies from package.json],
}
```

Key differences from the CLI entry:
- No shebang banner
- `splitting: true` to preserve module graph for tree-shaking
- All `dependencies` externalized (not just the SDK) since library consumers manage their own `node_modules`
- Produces `dist/index.js` + chunk files

Move the `restoreNodePrefixes()` and prompt copy to the LAST config entry's `onSuccess` so they run after all builds complete.

### 3. Update `package.json`

Add these fields:

- **`exports`**: `{ ".": { "types": "./dist/types/engine/index.d.ts", "import": "./dist/index.js" } }`
- **`types`**: `"./dist/types/engine/index.d.ts"` (fallback for older tools)
- **`files`**: `["dist/", "LICENSE", "README.md"]`
- **`engines`**: `{ "node": ">=22" }`
- **`publishConfig`**: `{ "access": "public" }`
- **`repository`**: `{ "type": "git", "url": "git+https://github.com/eforge-run/eforge.git" }`
- **`homepage`**: `"https://eforge.run"`

Update scripts:
- **`build`**: append `&& tsc -p tsconfig.build.json` to generate declarations after tsup
- **`prepublishOnly`**: `"pnpm build && pnpm test"` - safety net before every publish

### 4. Update CI (`.github/workflows/ci.yml`)

Add `pnpm build` step before type-check and test to catch build regressions (tsup config, declaration gen, monitor-ui).

### Design notes

- **No `.npmignore`** - the `files` allowlist is sufficient and avoids confusing interactions between the two mechanisms.
- **No `src/` in package** - skipping `declarationMap` keeps the tarball smaller. Can add later if "go to source" DX matters.
- **`import.meta.url` in `prompts.ts`** resolves correctly because all output files and `dist/prompts/` are siblings in `dist/`.
- **Monitor server resolution** (`resolve(__dirname, 'server-main.js')`) works because all built files land in `dist/`.
- **No CJS output** - ESM-only, Node 22+. No backwards compat needed.
- **`tsc --emitDeclarationOnly`** over tsup's `dts` option - more reliable with complex barrel re-exports.

## Scope

**In scope:**
- New `tsconfig.build.json` for declaration-only emit
- Library entry point in tsup config (`src/engine/index.ts` → `dist/index.js`)
- package.json fields: exports, types, files, engines, publishConfig, repository, homepage
- Build script updates (declaration generation, prepublishOnly safety net)
- CI build step addition

**Out of scope:**
- `.npmignore` (the `files` allowlist is sufficient)
- `declarationMap` / shipping `src/` in the package
- CJS output
- Backwards compatibility shims

## Acceptance Criteria

1. `pnpm build` succeeds (tsup + monitor-ui + tsc declarations)
2. `npm pack --dry-run` shows expected tarball contents (`dist/`, LICENSE, README, package.json)
3. `npm pack` then install from tarball in a temp project:
   - `npx eforge --help` works (CLI binary)
   - `import { EforgeEngine } from 'eforge'` resolves (library)
   - TypeScript types resolve (`dist/types/` present)
4. `pnpm test` passes
5. CI build job passes

## Files to modify

| File | Action |
|------|--------|
| `tsconfig.build.json` | Create |
| `tsup.config.ts` | Add library entry |
| `package.json` | Add exports, types, files, engines, publishConfig, repository, homepage; update build + add prepublishOnly |
| `.github/workflows/ci.yml` | Add build step |
