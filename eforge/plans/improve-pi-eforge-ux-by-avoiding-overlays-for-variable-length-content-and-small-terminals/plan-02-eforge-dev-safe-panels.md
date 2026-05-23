---
id: plan-02-eforge-dev-safe-panels
name: Project-local eforge-dev safe panels
branch: improve-pi-eforge-ux-by-avoiding-overlays-for-variable-length-content-and-small-terminals/plan-02-eforge-dev-safe-panels
---

# Project-local eforge-dev Safe Panels

## Architecture Context

The project-local `.pi/extensions/eforge-dev` extension is maintainer-only, but it dogfoods Pi TUI patterns used by published `pi-eforge`. After Plan 01 lands, migrate this local extension away from unbounded floating overlays as a separate step so published user-facing changes and local maintainer changes do not contend for the same files.

## Implementation

### Overview

Replace the `/dev` cockpit, info panels, and progress panels with non-overlay custom components that bound their rendered height using `tui.terminal.rows`. Preserve command names and maintainer workflow behavior.

### Key Decisions

1. Use local equivalents instead of importing published helpers, because `.pi/extensions/eforge-dev/index.ts` is a project-local maintainer extension and already has local TUI components.
2. Bound each custom component's output so footer/help/action lines are visible in short terminals.
3. Keep progress output concise: step status lines remain visible, failed step detail is one line, and cancellation remains bound to Escape/Ctrl-C.

## Scope

### In Scope

- `.pi/extensions/eforge-dev/index.ts` cockpit/info/progress UI.
- `.pi/extensions/eforge-dev/README.md` command wording.
- Static guardrail coverage for the project-local extension.

### Out of Scope

- Published `packages/pi-eforge` files already covered by Plan 01.
- Changes to maintainer workflow commands, git policy, release steps, or daemon behavior.

## Files

### Create

- `test/pi-eforge-dev-overlay-guard.test.ts` — Static guard that scans `.pi/extensions/eforge-dev/index.ts` and fails on `overlay: true` or `overlayOptions`.

### Modify

- `.pi/extensions/eforge-dev/index.ts` — Remove overlay options from `showInfo`, `runSteps`, and `showCockpit`. Add terminal-row-aware rendering to `InfoPanel`, `ProgressPanel`, and cockpit selection so content is clipped only by each component's own viewport and scroll/selection state, not by Pi overlay slicing.
- `.pi/extensions/eforge-dev/README.md` — Rename “cockpit overlay” wording to maintainer cockpit panel/TUI wording.

## Verification

- [ ] `rg -n "overlay: true|overlayOptions" .pi/extensions/eforge-dev --glob '!node_modules/**' --glob '!dist/**'` returns no matches.
- [ ] `/dev` cockpit component creates `SelectList` with a terminal-height-derived visible count instead of a fixed `10` rows.
- [ ] `InfoPanel` handles Up, Down, PageUp, PageDown, Home, End, Escape, and Enter keys, and keeps its close/help line outside the scrolled content slice.
- [ ] `ProgressPanel` renders at most its terminal-row budget while keeping the cancel hint visible.
- [ ] Targeted test passes: `pnpm exec vitest run test/pi-eforge-dev-overlay-guard.test.ts`.
