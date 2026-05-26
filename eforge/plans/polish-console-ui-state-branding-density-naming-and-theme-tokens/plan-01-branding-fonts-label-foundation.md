---
id: plan-01-branding-fonts-label-foundation
name: Branding, Fonts, Tokens, and Label Foundation
branch: polish-console-ui-state-branding-density-naming-and-theme-tokens/plan-01-branding-fonts-label-foundation
---

# Branding, Fonts, Tokens, and Label Foundation

## Architecture Context

Console lives entirely under `packages/console-ui/` and consumes daemon data through `@eforge-build/client/browser`. This plan establishes local assets and selector utilities that later Console plans consume. It does not change daemon routes, client wire types, or the legacy `/` monitor.

## Implementation

### Overview

Replace the remote GitHub avatar with a bundled Console asset, self-host the two configured font families, add CSS token primitives needed by later UI polish, and introduce selector-local label and pluralization helpers.

### Key Decisions

1. Use `packages/console-ui/public/eforge-logo.svg` and set `EFORGE_LOGO_URL` to `/console/eforge-logo.svg` so Vite's `/console/` base resolves the asset without an external avatar request.
2. Import selected `@fontsource/inter` and JetBrains Mono CSS files in `src/main.tsx` so `globals.css` font-family declarations resolve to bundled `woff2` assets.
3. Keep PRD naming logic in `src/lib/selectors/labels.ts`; UI components receive already-normalized display strings from selectors.
4. Keep generic count text in `src/lib/format.ts` via `pluralize(n, singular, plural?)` so Runs and System pluralization share one helper.

## Scope

### In Scope

- Add a local eforge logo asset for Console.
- Add fontsource dependencies for Inter and JetBrains Mono and import used weights.
- Update Console brand constants to reference the local logo path and remove avatar URLs from `brand.ts`.
- Add event-family CSS variables and Console semantic token aliases used by later plans.
- Add `selectPrdDisplayLabel` with markdown-shaped title rejection, slug title-casing, and acronym preservation for `PRD`, `UI`, `MCP`, `CLI`, and `API`.
- Add unit tests for label selection and slug normalization.
- Export selector helpers through the existing selector barrel when needed by later plans.

### Out of Scope

- Selector deduplication and Runs coalescing; those are implemented in plan 02.
- Shell, Now, Queue, Runs, System, and Activity layout changes; those are implemented in later plans.
- Theme-token source-grep guard; it lands after all planned source violations are removed.

## Files

### Create

- `packages/console-ui/public/eforge-logo.svg` — bundled Console logo asset served from `/console/eforge-logo.svg`.
- `packages/console-ui/src/lib/selectors/labels.ts` — PRD display-label normalization and supporting slug helpers.
- `packages/console-ui/src/__tests__/labels.test.ts` — tests for explicit titles, slug title-casing, markdown-title rejection, and acronym preservation.

### Modify

- `packages/console-ui/package.json` — add `@fontsource/inter` and a JetBrains Mono fontsource package dependency.
- `pnpm-lock.yaml` — record the new fontsource dependencies.
- `packages/console-ui/src/main.tsx` — import selected Inter and JetBrains Mono CSS weights before `globals.css`.
- `packages/console-ui/src/globals.css` — keep the existing font-family declarations and add Console/event family token variables.
- `packages/console-ui/src/lib/brand.ts` — point `EFORGE_LOGO_URL` at `/console/eforge-logo.svg`, remove `avatars.githubusercontent.com`, and replace/remove unused raw color constants.
- `packages/console-ui/src/lib/format.ts` — add `pluralize(n, singular, plural?)`.
- `packages/console-ui/src/lib/selectors/index.ts` — export label helpers if other selectors import from the barrel.

## Verification

- [ ] `packages/console-ui/public/eforge-logo.svg` exists.
- [ ] `packages/console-ui/src/lib/brand.ts` sets `EFORGE_LOGO_URL` to `/console/eforge-logo.svg` and contains no `avatars.githubusercontent.com` string.
- [ ] `packages/console-ui/package.json` declares `@fontsource/inter` and one JetBrains Mono fontsource package.
- [ ] `packages/console-ui/src/main.tsx` imports Inter and JetBrains Mono CSS from fontsource packages.
- [ ] `packages/console-ui/src/lib/selectors/labels.ts` exports `selectPrdDisplayLabel` returning a string.
- [ ] `packages/console-ui/src/__tests__/labels.test.ts` covers explicit title, slug title-casing, markdown-shaped title fallback, and `CLI` acronym preservation.
- [ ] `packages/console-ui/src/globals.css` declares all eight `--color-event-family-*` variables named in the source.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
- [ ] `packages/console-ui/dist/` contains self-hosted Inter `.woff2` files emitted by Vite after the Console build.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui test labels` exits 0.