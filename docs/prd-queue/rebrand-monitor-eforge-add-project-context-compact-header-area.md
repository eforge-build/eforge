---
title: Rebrand monitor → eforge, add project context, compact header area
created: 2026-03-25
status: pending
---



# Rebrand monitor → eforge, add project context, compact header area

## Problem / Motivation

The web UI has evolved beyond a read-only monitor into a control plane (auto-build toggle, future build cancellation). The "eforge monitor" branding is misleading. Additionally, there is no project/repo context displayed in the UI, leaving users without orientation. The summary cards and activity strip consume excessive vertical space (~80px+ for cards, plus a chrome-wrapped heatstrip) before users reach the actual pipeline and content, wasting valuable screen real estate.

## Goal

Rebrand the UI from "eforge monitor" to "eforge," surface project/repo context in the header, and collapse the summary cards and activity heatstrip into a compact info area so pipeline content starts much higher on the page.

## Approach

### 1. Rename "eforge monitor" → "eforge"

- `src/monitor/ui/index.html:6` — `<title>eforge</title>`
- `src/monitor/ui/src/components/layout/header.tsx:16` — h1 text → `eforge`
- `README.md:9,99` — Update image alt text to "eforge dashboard"

### 2. Add project context to the header

- **`src/monitor/server.ts`** — New `/api/project-context` endpoint:
  - Resolve git remote at server startup using `execAsync('git', ['remote', 'get-url', 'origin'], { cwd })` (same pattern as `hooks.ts:12-18`)
  - Return `{ cwd: string, gitRemote: string | null }`
  - One-shot resolution at startup, no per-request overhead
- **`src/monitor/ui/src/lib/api.ts`** — Add `fetchProjectContext()` function
- **`src/monitor/ui/src/app.tsx`** — Fetch on mount, pass to Header
- **`src/monitor/ui/src/components/layout/header.tsx`** — Display after "eforge" title:
  - If git remote available: extract `owner/repo` from the URL (handles both `git@` and `https://` formats)
  - Fallback: directory basename from `cwd`
  - Styled as `text-text-dim text-xs` — secondary to the bold title

### 3. Collapse summary cards into a compact stats bar

Replace the current `SummaryCards` grid (5 padded cards with borders, icons, large text) with an inline stats bar. Target: ~80px → ~28px vertical space.

- **`src/monitor/ui/src/components/common/summary-cards.tsx`** — Rewrite:
  - Single `flex` row with separator dots/pipes between items
  - Each stat: small label + value inline (e.g., `Completed · 3m 10s · 2/2 plans · 441.7k tokens · $0.83`)
  - Status gets color accent (green/red/blue), everything else is `text-text-dim` / `text-text-bright`
  - Keep the status icon (checkmark/x/spinner) but at a smaller size
  - Keep `AnimatedCounter` for tokens and cost
  - Remove card borders, backgrounds, shadows, padding — it's just a bar
  - Keep the same `SummaryCardsProps` interface so `app.tsx` doesn't change

### 4. Strip activity heatstrip chrome

- **`src/monitor/ui/src/components/common/activity-heatstrip.tsx`** — Remove card wrapper:
  - Remove `bg-card border border-border rounded-lg px-4 py-2 shadow-sm shadow-black/20` container
  - Remove the "ACTIVITY" heading
  - Keep the heatstrip visualization itself (`flex gap-px` with tooltip cells)
  - Bare heatstrip sits inline, taking only cell height (~16px + label)

### 5. Layout integration

- **`src/monitor/ui/src/app.tsx`** (lines 246-254):
  - Stats bar and activity strip are no longer padded cards in the main content area — they sit at the top of the main area as a compact info row, visually attached to the header
  - Consider putting the stats bar and heatstrip on the same line if there's room, or stacked tightly with minimal gap

## Scope

**In scope:**
- Renaming "eforge monitor" → "eforge" across title, header, and README
- New `/api/project-context` server endpoint with git remote resolution
- Client-side fetch and display of project context in the header
- Rewriting summary cards as a compact inline stats bar
- Stripping card chrome from the activity heatstrip
- Adjusting layout spacing in `app.tsx` so the stats bar and heatstrip are compact and visually attached to the header

**Files to modify:**
1. `src/monitor/ui/index.html` — title
2. `src/monitor/ui/src/components/layout/header.tsx` — rename + project context
3. `src/monitor/ui/src/components/common/summary-cards.tsx` — rewrite as compact bar
4. `src/monitor/ui/src/components/common/activity-heatstrip.tsx` — strip card chrome
5. `src/monitor/ui/src/app.tsx` — fetch project context, pass to header, adjust layout spacing
6. `src/monitor/ui/src/lib/api.ts` — add `fetchProjectContext()`
7. `src/monitor/server.ts` — add `/api/project-context` endpoint
8. `README.md` — update image alt text

**Out of scope:**
- N/A

## Acceptance Criteria

1. `pnpm build` completes with no type or build errors.
2. `pnpm test` — all existing tests pass.
3. Browser tab title says "eforge" (not "eforge monitor").
4. Header displays "eforge" followed by a repo identifier (e.g., `eforge-build/eforge`) styled as secondary text; falls back to directory basename if no git remote is available.
5. `/api/project-context` endpoint returns `{ cwd: string, gitRemote: string | null }` and handles both `git@` and `https://` remote URL formats.
6. Summary stats render as a single compact inline bar (~28px height), not 5 large padded cards; status icon and color accent are preserved; `AnimatedCounter` still animates tokens and cost; `SummaryCardsProps` interface is unchanged.
7. Activity heatstrip renders without card wrapper, border, shadow, or "ACTIVITY" heading — just the visualization cells.
8. Pipeline content starts visibly higher on the page compared to the current layout.
