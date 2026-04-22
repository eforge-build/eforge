---
title: Hardening 09: Replace Raw Button/Input with shadcn Components in Monitor UI
created: 2026-04-22
---

# Hardening 09: Replace Raw Button/Input with shadcn Components in Monitor UI

## Problem / Motivation

`AGENTS.md` states: "The monitor UI uses shadcn/ui components rather than custom UI primitives." The codebase has drifted from that rule — raw `<button>` and `<input>` elements with inline Tailwind classes are used in at least 18 sites across the monitor UI. This is a consistency, accessibility, and theming concern:

- Custom primitives miss the shadcn accessibility defaults (focus ring, keyboard semantics).
- Dark-mode / theme tweaks have to be propagated manually to each custom site.
- The codebase inconsistently mixes both styles in the same views.

Confirmed offenders (verified by `rg "^\s*<(button|input)\b" packages/monitor-ui/src`):

- `components/layout/sidebar.tsx:69, 183, 196, 220`
- `components/layout/shutdown-banner.tsx:36`
- `components/common/failure-banner.tsx:78`
- `components/console/console-panel.tsx:53, 77, 100`
- `components/pipeline/thread-pipeline.tsx:737, 754, 775`
- `components/heatmap/file-heatmap.tsx:147`
- `components/heatmap/diff-viewer.tsx:132`
- `components/plans/plan-card.tsx:83`
- `components/preview/plan-metadata.tsx:68`
- `components/preview/plan-preview-panel.tsx:106`
- `components/timeline/event-card.tsx:286`

## Goal

Every interactive `<button>` and `<input>` in monitor UI components uses shadcn components (`Button`, `Input`, and any relevant compounds like `Toggle`, `Checkbox`, `Select`). No functional regressions; existing variants preserved via the shadcn `variant` / `size` props.

## Approach

### 1. Inventory the existing shadcn components

Check `packages/monitor-ui/src/components/ui/` (the conventional shadcn location). Confirm `button.tsx` and `input.tsx` exist. If any needed variant is missing (e.g., a "ghost" or "destructive" look currently used inline), extend the shadcn `Button` CVA definition rather than reintroducing custom styles.

### 2. Migrate each site

For each of the 18 offenders, replace the raw element with the shadcn counterpart. Map inline Tailwind classes to variants:

- Transparent / text-only buttons → `variant="ghost"`
- Destructive confirmations → `variant="destructive"`
- Primary action → default
- Small icon buttons → `size="icon"` or `size="sm"`
- Outlined → `variant="outline"`

Pass any layout-specific classes via `className` (shadcn `Button` composes with `cn()`). Do NOT re-introduce the full inline class string — only layout/positioning.

For inputs, `<input type="text">` with Tailwind styling becomes shadcn `Input`. Preserve `onChange`, `value`, `placeholder`, and accessibility attributes.

### 3. Attention items

- `components/layout/sidebar.tsx` has the densest usage (4 sites). Migrate carefully; this is the nav.
- `components/console/console-panel.tsx:77` is probably a filter/clear button — confirm click handlers still work.
- Inputs with tight pixel sizes (e.g., a small search box in sidebar) may need `size="sm"` plus className override.

Visual-check each component in both dark and light themes (the monitor UI supports both).

### 4. Lint prevention (optional)

Add an eslint rule or a CI grep check that flags `<button` and `<input type=` in `packages/monitor-ui/src/components/` (excluding the `components/ui/` shadcn directory). Prevents regression. If it's too much plumbing, skip — the verification grep below suffices.

## Scope

### In scope

- All 18 files listed above.
- Possibly `packages/monitor-ui/src/components/ui/button.tsx` (if a new variant is needed).
- Replacing raw `<button>` and `<input>` elements with shadcn components (`Button`, `Input`, and any relevant compounds like `Toggle`, `Checkbox`, `Select`).
- Extending the shadcn `Button` CVA definition if a needed variant is missing.
- Optional: adding an eslint rule or CI grep check to prevent regression.

### Out of scope

- Redesigning the UI.
- Introducing new shadcn components that weren't needed.
- Changing any component's logic or state management.

## Acceptance Criteria

- `pnpm --filter monitor-ui build` succeeds.
- `rg "^\s*<button\b" packages/monitor-ui/src/components` returns zero hits outside `components/ui/`.
- `rg "^\s*<input\b" packages/monitor-ui/src/components` returns zero hits outside `components/ui/`.
- Every interactive `<button>` and `<input>` in monitor UI components uses shadcn components.
- Existing variants preserved via the shadcn `variant` / `size` props.
- No functional regressions.
- Manual verification: run the monitor UI, exercise each migrated component (sidebar nav, failure banner dismiss, shutdown banner restart, console panel controls, pipeline thread interactions, heatmap file/diff toggles, plan card action, preview panel controls, timeline event-card toggle). Confirm no regressions, visual parity in dark + light modes.
- `onChange`, `value`, `placeholder`, and accessibility attributes preserved on migrated inputs.
