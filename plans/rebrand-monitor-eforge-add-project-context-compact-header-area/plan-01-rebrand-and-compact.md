---
id: plan-01-rebrand-and-compact
name: Rebrand monitor to eforge, add project context, compact header area
depends_on: []
branch: rebrand-monitor-eforge-add-project-context-compact-header-area/rebrand-and-compact
---

# Rebrand monitor to eforge, add project context, compact header area

## Architecture Context

The monitor web UI (`src/monitor/`) serves a single-page dashboard over SSE. The server (`server.ts`) already uses `execAsync` (promisified `execFile`) and has an established pattern for API endpoints (function per route, registered in the main request handler switch). The UI uses React with shadcn/ui components, Tailwind CSS, and a dark theme with custom color tokens (`text-text-bright`, `text-text-dim`, `bg-card`, etc.).

## Implementation

### Overview

This plan covers all 8 files in a single pass: rename "eforge monitor" → "eforge", add a `/api/project-context` endpoint to the server, fetch and display project/repo context in the header, rewrite summary cards as a compact inline stats bar, strip card chrome from the activity heatstrip, and tighten layout spacing in app.tsx.

### Key Decisions

1. **Git remote resolution at server startup** — resolve once via `execAsync('git', ['remote', 'get-url', 'origin'], { cwd })` and cache the result, following the same pattern as `src/engine/hooks.ts:12-18`. No per-request overhead.
2. **Owner/repo extraction with regex** — handle both `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git` formats via a single regex. Fall back to `cwd` basename if no remote or unparseable.
3. **SummaryCardsProps interface unchanged** — the rewrite from card grid to inline bar preserves the existing props interface so `app.tsx` doesn't need prop changes.
4. **Stats bar uses separator dots** — compact inline layout with `·` separators between stat groups, status icon + color accent preserved at smaller size, `AnimatedCounter` retained for tokens and cost.
5. **Activity heatstrip keeps its visualization** — only the card wrapper (`bg-card border rounded-lg px-4 py-2 shadow-sm shadow-black/20`) and "ACTIVITY" heading are removed. The `flex gap-px` cell layout and tooltips remain intact.

## Scope

### In Scope
- Rename "eforge monitor" → "eforge" in HTML title, header h1, and README alt text
- New `/api/project-context` GET endpoint returning `{ cwd: string, gitRemote: string | null }`
- `fetchProjectContext()` client function in `api.ts`
- Header component accepts and displays project context (owner/repo or directory basename)
- Rewrite `SummaryCards` from card grid to compact inline stats bar
- Strip card chrome and heading from `ActivityHeatstrip`
- Adjust `app.tsx` layout so stats bar and heatstrip sit tight below the header with minimal padding

### Out of Scope
- Changes to the sidebar, console panel, or tab content areas
- Any functional changes to SSE event streaming or session management

## Files

### Modify
- `src/monitor/ui/index.html` — change `<title>eforge monitor</title>` to `<title>eforge</title>`
- `src/monitor/server.ts` — add `resolveGitRemote()` helper (called once at startup), add `/api/project-context` GET route returning `{ cwd, gitRemote }`
- `src/monitor/ui/src/lib/api.ts` — add `fetchProjectContext()` function returning `{ cwd: string, gitRemote: string | null }`
- `src/monitor/ui/src/components/layout/header.tsx` — rename h1 to "eforge", accept new `projectContext` prop, display owner/repo or directory basename as secondary text, add git remote URL parsing logic
- `src/monitor/ui/src/components/common/summary-cards.tsx` — rewrite `SummaryCards` component from 5 padded cards to a single-row inline stats bar; keep `SummaryCardsProps` interface unchanged; keep `AnimatedCounter` for tokens/cost; keep status icon/color accent
- `src/monitor/ui/src/components/common/activity-heatstrip.tsx` — remove `bg-card border border-border rounded-lg px-4 py-2 shadow-sm shadow-black/20` wrapper div and "ACTIVITY" h3 heading; keep the heatstrip visualization (flex gap-px cells with tooltips)
- `src/monitor/ui/src/app.tsx` — fetch project context on mount via `fetchProjectContext()`, pass to `Header`; reduce padding/gap around `SummaryCards` and `ActivityHeatstrip` so they sit compact at top of main area (change `py-5` to `py-3`, `gap-4` to `gap-2` for the stats/heatstrip area)
- `README.md` — change "eforge monitor" in image alt text (lines 9 and 99) to "eforge dashboard"

## Verification

- [ ] `pnpm build` completes with zero type errors and zero build errors
- [ ] `pnpm test` — all existing tests pass with no failures
- [ ] `src/monitor/ui/index.html` contains `<title>eforge</title>` (not "eforge monitor")
- [ ] `src/monitor/ui/src/components/layout/header.tsx` renders h1 text "eforge" (not "eforge monitor")
- [ ] `header.tsx` accepts a `projectContext` prop with `{ cwd: string, gitRemote: string | null }` shape
- [ ] Header displays extracted `owner/repo` from git remote URL when available; displays `basename(cwd)` as fallback when `gitRemote` is null
- [ ] `owner/repo` extraction handles `git@github.com:owner/repo.git` → `owner/repo` and `https://github.com/owner/repo.git` → `owner/repo`
- [ ] `/api/project-context` endpoint exists in `server.ts` and returns JSON `{ cwd: string, gitRemote: string | null }`
- [ ] `api.ts` exports a `fetchProjectContext()` function
- [ ] `app.tsx` calls `fetchProjectContext()` on mount and passes result to `Header`
- [ ] `SummaryCards` renders as a single flex row (no card borders, backgrounds, shadows, or `rounded-lg` wrappers); status icon and color accent are present; `AnimatedCounter` is used for tokens and cost values
- [ ] `SummaryCardsProps` interface is unchanged (same fields as before the rewrite)
- [ ] `ActivityHeatstrip` has no `bg-card`, `border`, `rounded-lg`, `shadow-sm`, or `shadow-black/20` classes; no "ACTIVITY" or "Activity" heading text
- [ ] `ActivityHeatstrip` still renders tooltip cells with the `flex gap-px` layout
- [ ] `README.md` lines 9 and 99 contain "eforge dashboard" in alt text (not "eforge monitor")
- [ ] Main content area padding is reduced (no `py-5` on the main element when events are present)
