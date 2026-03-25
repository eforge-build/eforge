---
id: plan-01-asset-404
name: Return 404 for missing hashed assets instead of SPA fallback
depends_on: []
branch: fix-spa-fallback-serving-html-for-missing-static-asset-requests/asset-404
---

# Return 404 for missing hashed assets instead of SPA fallback

## Architecture Context

The monitor web server (`src/monitor/server.ts`) serves a Vite-built SPA. The `serveStaticFile()` function falls back to `index.html` for any request where the file doesn't exist on disk. This is correct for client-side routes but incorrect for `/assets/` paths — Vite-hashed JS/CSS chunks that are genuinely missing should return 404, not HTML with the wrong MIME type.

## Implementation

### Overview

Add a guard in the two SPA fallback paths within `serveStaticFile()` (lines 118–125). When the URL path starts with `/assets/`, return a 404 with `Content-Type: text/plain` instead of falling back to `index.html`.

### Key Decisions

1. **Guard on `/assets/` prefix** — Vite places all hashed output under `/assets/`. This prefix check is sufficient to distinguish asset requests from client-side route paths.
2. **Apply in both fallback locations** — The `!isFile()` check (line 118) and the catch block (line 122) both need the guard to cover all missing-file scenarios.

## Scope

### In Scope
- Adding `/assets/` prefix check before SPA fallback in `serveStaticFile()`

### Out of Scope
- Changes to Vite config or asset paths
- Client-side error handling for failed chunk loads
- Cache invalidation strategies

## Files

### Modify
- `src/monitor/server.ts` — Add `/assets/` guard in the two SPA fallback paths within `serveStaticFile()` (lines 118–125). Before falling back to `index.html`, check if `urlPath.startsWith('/assets/')` and if so, respond with 404 + `Content-Type: text/plain` and return early.

## Verification

- [ ] `pnpm build` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] In `serveStaticFile()`, both the `!isFile()` branch and the catch branch check `urlPath.startsWith('/assets/')` before falling back to `index.html`
- [ ] When the URL path starts with `/assets/`, the response is HTTP 404 with `Content-Type: text/plain` body "Not Found"
- [ ] When the URL path does NOT start with `/assets/` and the file is missing, the response is `index.html` (SPA fallback preserved)
