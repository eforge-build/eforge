---
id: plan-05-system-activity-progressive-disclosure-and-guards
name: System and Activity Progressive Disclosure with Theme Guards
branch: polish-console-ui-state-branding-density-naming-and-theme-tokens/plan-05-system-activity-progressive-disclosure-and-guards
agents:
  builder:
    effort: high
    rationale: This plan finishes remaining dense views, adds a shadcn Sheet
      primitive, and introduces source-grep guard tests that require all earlier
      UI cleanups to hold.
  reviewer:
    effort: high
    rationale: The final guard plan must verify no typography or token violations
      remain across the Console source tree.
---

# System and Activity Progressive Disclosure with Theme Guards

## Architecture Context

System and Activity are the densest Console routes. This plan adds progressive disclosure without changing daemon APIs and installs final source-grep tests after all planned class-name violations have been removed.

## Implementation

### Overview

Collapse System model lists by provider, add model search, move Activity raw JSON into a side panel, simplify Activity filters, replace palette literals with tokens, and add tests that enforce token and typography discipline.

### Key Decisions

1. Render one controlled `<details>` per provider and mount `<li>` model rows only for expanded providers so the initial DOM contains zero model list items.
2. Use a shadcn-style `Sheet` component backed by Radix Dialog for Activity raw JSON, unless an existing equivalent is present in the package.
3. Replace Activity family badges with a token-colored dot and an `aria-label` including the family name; no visible `family:` or `scope:` labels remain.
4. Add source-grep tests only in the final plan so the full plan set can remove all existing `text-[10px]` and hex utility violations before enforcement.

## Scope

### In Scope

- Add Radix Dialog dependency if implementing a shadcn Sheet primitive requires it.
- Create `components/ui/sheet.tsx` and export it if no Sheet primitive exists.
- Collapse System models into provider `<details>` blocks closed by default.
- Add a model search input above provider details with an accessible name indicating model search.
- Render zero `<li>` descendants inside the Models section before any provider is expanded.
- Simplify Activity filter state to one family-chip row and one search input; remove the `Attention only` checkbox.
- Move Activity row raw JSON from inline `<details>` to a slide-over panel or modal.
- Make Activity rows selectable/clickable and render pretty-printed JSON for the selected event in the panel.
- Hide Activity `family:` and `scope:` visible labels by default.
- Render a colored family dot with `aria-label` including the family name.
- Replace Activity family palette classes with CSS variables declared in `globals.css`.
- Replace remaining `text-[10px]` usages in Activity or any missed Console source file with `text-xs`.
- Add `theme-token-discipline.test.ts` scanning `.ts`/`.tsx` files under `packages/console-ui/src/`, excluding tests, for hex color utilities and `text-[Npx]` classes.
- Ensure the existing guard against `@eforge-build/engine` imports and `/api/` literals remains green.

### Out of Scope

- Re-skinning shadcn `Badge`, `Button`, or `Card` primitives.
- New daemon routes, new client wire types, or System data fetching changes beyond local rendering.
- Internationalization and full accessibility audits.

## Files

### Create

- `packages/console-ui/src/components/ui/sheet.tsx` — shadcn-style Sheet wrapper for Activity raw event panel if absent.
- `packages/console-ui/src/views/activity/raw-event-panel.tsx` — slide-over/modal content for selected event JSON.
- `packages/console-ui/src/__tests__/theme-token-discipline.test.ts` — source-grep guard for hex color utilities and arbitrary pixel text classes.
- `packages/console-ui/src/__tests__/system-view.test.tsx` — top-level System view assertions if existing nested System tests cannot host the new Models-section cases.

### Modify

- `packages/console-ui/package.json` — add `@radix-ui/react-dialog` only if the Sheet implementation uses it.
- `pnpm-lock.yaml` — record Radix Dialog dependency if added.
- `packages/console-ui/src/components/ui/index.ts` — export Sheet primitives if the UI barrel pattern is used.
- `packages/console-ui/src/globals.css` — verify event-family variables exist and add any missing token aliases used by Activity/System.
- `packages/console-ui/src/views/system/models-section.tsx` — add search and controlled provider details with lazy-mounted model rows.
- `packages/console-ui/src/lib/selectors/system.ts` — add provider grouping/filter helpers for models if component-local logic would duplicate tests.
- `packages/console-ui/src/views/activity/activity-view.tsx` — manage selected row state, pass selection handlers, render `RawEventPanel`, remove density labels, and replace `text-[10px]`.
- `packages/console-ui/src/views/activity/activity-toolbar.tsx` — remove attention checkbox and second input; render family chips plus one search input.
- `packages/console-ui/src/views/activity/activity-event-list.tsx` — pass row click/select handlers and selected row id.
- `packages/console-ui/src/views/activity/activity-event-row.tsx` — remove inline raw JSON details, hide visible `family:`/`scope:`, use token-colored dot, and replace palette/text-size literals.
- `packages/console-ui/src/lib/selectors/activity.ts` — update filter state to one query field and adjust filtering tests.
- `packages/console-ui/src/__tests__/activity-view.test.tsx` — assert no inline raw JSON details, clicking a row opens panel JSON, no `family:`/`scope:`, family dot aria-label, no Attention-only checkbox, and exactly one toolbar input.
- `packages/console-ui/src/__tests__/activity-selectors.test.ts` — update filter-state expectations for the single search query.
- `packages/console-ui/src/views/system/__tests__/system-view-content.test.tsx` — add or update Models-section provider disclosure/search cases.
- `packages/console-ui/src/__tests__/guards.test.ts` — keep existing daemon-boundary guard expectations passing if file traversal helpers are shared with the new guard.

## Verification

- [ ] System Models section renders one `<details>` element per provider.
- [ ] Every provider `<details>` is closed on initial render.
- [ ] Initial Models section DOM contains zero `<li>` descendants while all provider details are closed.
- [ ] Models section renders a text input with an accessible name indicating model search.
- [ ] Activity rows contain no inline `<details>` element labeled `Raw event JSON`.
- [ ] Clicking an Activity event row opens a panel containing pretty-printed JSON for that event.
- [ ] Activity event rows do not render visible text `family:` or `scope:`.
- [ ] Activity event rows render a colored dot whose `aria-label` includes the row family name.
- [ ] Activity toolbar renders no checkbox labeled `Attention only`.
- [ ] Activity toolbar renders exactly one text input.
- [ ] `packages/console-ui/src/views/activity/activity-event-row.tsx` contains none of the palette substrings listed in the source acceptance criteria.
- [ ] No `.ts` or `.tsx` source file under `packages/console-ui/src/`, excluding tests, contains `text-[10px]`.
- [ ] `theme-token-discipline.test.ts` fails on class strings matching the source regex for `bg|text|border-[#...]` utilities.
- [ ] `theme-token-discipline.test.ts` fails on class strings matching the source regex for `text-[Npx]` utilities.
- [ ] With a running daemon, initial loads of `/console/`, `/console/queue`, `/console/runs`, `/console/system`, and `/console/activity` produce no browser console errors and no unhandled promise rejections.
- [ ] `/console/` and `/console/index.html` return Console SPA HTML, `/` returns legacy monitor SPA HTML, and the legacy monitor header includes the `Console` link to `/console/`.
- [ ] `pnpm --filter @eforge-build/console-ui test activity-view system theme-token-discipline guards` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.