---
id: plan-08-docs-sweep
name: Console UI README and AGENTS.md sweep
branch: console-ui-monitoring-overhaul-port-reducer-replace-sidebar-with-header-consolidate-routes-into-now-add-build-detail-route-and-mini-gantt-active-build-cards/plan-08-docs-sweep
agents:
  doc-author:
    effort: medium
    rationale: Authoring a new README and updating AGENTS.md to reflect the
      consolidated IA.
---

---
id: plan-08-docs-sweep
name: Console UI README and AGENTS.md sweep
depends_on: [plan-05-now-page-rewrite, plan-07-build-detail-tabs]
---

# Console UI README and AGENTS.md sweep

## Architecture Context

With the console-ui rewrite landed (reducer, header shell, consolidated routes, build detail route), the documentation needs a single authoritative description of the new IA. AGENTS.md must reflect that monitor-ui is now the legacy implementation. A fresh `packages/console-ui/README.md` describes the route table, data flow, and how to add new control surfaces under `System`.

The documentation must describe the **shape** of the IA, not the **content** (drift-prevention principle from the PRD). The route table is defined in `src/lib/navigation.ts`; the README links there rather than duplicating route names.

## Implementation

### Overview

1. **Create `packages/console-ui/README.md`** with sections:
   - Purpose: console-ui is the active monitoring dashboard for eforge.
   - Route table: `/console/` (Now), `/console/runs/:detailId` (build detail), `/console/system` (placeholder). Reference `src/lib/navigation.ts` as the source of truth.
   - Data flow: daemon SSE → `useActiveSessionStreams` → reducer at `src/lib/run-state/` → selectors → views. Note the dual-reducer constraint with monitor-ui.
   - How to add a new control surface: scaffold under `src/components/header/control-surface-links.tsx` for header entries or `src/views/system/` for system-route entries.
   - How to run dev: `pnpm dev:console`.
2. **Update `AGENTS.md`** to:
   - Add a sentence noting that `packages/console-ui/` is the active monitoring dashboard, uses shadcn/ui components, and that `packages/monitor-ui/` is retained as the legacy implementation until the console-ui port is fully baked.
   - Remove or rewrite any references to the removed routes (`/console/queue`, `/console/runs` list, `/console/activity`) if present.
3. **Cross-repo sweep.** Run a `grep` across the repo for `console/queue`, `console/runs` (as a list path, not the new detail path), and `console/activity`. Update any stale references. The PRD permits skipping `README.md` (root), `CLAUDE.md`, `docs/extensions.md`, `docs/extensions-api.md`, and `web/` if they contain no matches.
4. **Confirm no stale region annotations** in `packages/console-ui/src/app.tsx` for deleted routes — plan-04 should have removed them; this plan grep-confirms.

### Key Decisions

1. **README links to `src/lib/navigation.ts`** for the canonical route list (drift prevention).
2. **No new docs in `web/`** — the public docs site already covers user-facing features; console-ui is a developer surface.
3. **AGENTS.md sentence is short** and points at `packages/console-ui/README.md` for details.

## Scope

### In Scope
- Create `packages/console-ui/README.md`.
- Update `AGENTS.md`.
- Repo-wide grep + fix-up for stale route references.
- Confirm region-annotation cleanup in `app.tsx`.

### Out of Scope
- Public docs site (`web/`) updates.
- `docs/roadmap.md` queue-mutation line update (covered by a follow-up PRD per the source).
- Per-component docstrings (covered during component porting in earlier plans).

## Files

### Create
- `packages/console-ui/README.md`

### Modify
- `AGENTS.md` — add console-ui-vs-monitor-ui sentence; remove stale route references if any.
- Any file surfaced by the grep sweep that references `console/queue`, `console/runs` (list), or `console/activity`.

## Verification

- [ ] `packages/console-ui/README.md` exists on disk.
- [ ] `packages/console-ui/README.md` documents the route table with entries `/console/`, `/console/runs/:detailId`, and `/console/system`.
- [ ] `packages/console-ui/README.md` describes the data flow chain: daemon SSE → `useActiveSessionStreams` → reducer at `src/lib/run-state/` → selectors → views.
- [ ] `packages/console-ui/README.md` contains a line referencing `src/lib/navigation.ts` as the canonical route source.
- [ ] `packages/console-ui/README.md` contains the command `pnpm dev:console`.
- [ ] `AGENTS.md` contains the phrase identifying `packages/monitor-ui/` as legacy and `packages/console-ui/` as the active monitoring dashboard.
- [ ] `grep -rn "console/queue\|console/activity" packages/ AGENTS.md README.md CLAUDE.md docs/ 2>/dev/null` returns zero matches (excluding this PRD's own copies in `eforge/`).
- [ ] `grep -n "eforge:region" packages/console-ui/src/app.tsx` does not include region IDs for `queue`, `activity`, or the removed `runs` list view.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui build` exits 0.
- [ ] `pnpm type-check` exits 0 at the workspace root.
- [ ] `pnpm test` exits 0 at the workspace root.
- [ ] `pnpm build` exits 0 at the workspace root.
