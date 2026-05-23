---
id: plan-01-published-pi-safe-panels
name: Published Pi eforge safe panels and build review
branch: improve-pi-eforge-ux-by-avoiding-overlays-for-variable-length-content-and-small-terminals/plan-01-published-pi-safe-panels
agents:
  builder:
    effort: high
    rationale: Shared Pi TUI helpers, a custom tool contract, skills, docs, and
      static guardrails must be coordinated in one change.
  reviewer:
    effort: high
    rationale: Review must verify no published Pi variable-length content remains in
      floating overlays and that the confirm-build tool/skill contract is
      coherent.
---

# Published Pi eforge Safe Panels and Build Review

## Architecture Context

This is follow-on work for `add-shared-landing-gate-ux-for-autonomous-playbook-runs`. Do not start implementation until that queue item has landed or been abandoned. Before editing, re-run:

```bash
rg -n "overlay: true|overlayOptions|showInfoOverlay|showSelectOverlay|showSearchableSelectOverlay|ctx\.ui\.custom|ctx\.ui\.editor" packages/pi-eforge/extensions/eforge packages/pi-eforge/skills packages/pi-eforge/README.md docs/architecture.md test --glob '!node_modules/**' --glob '!dist/**'
```

Pi overlay `maxHeight` truncates rendered lines, so published Pi eforge must not place Markdown, status dashboards, config/profile previews, playbook listings, or build-source previews in floating overlays. Keep command names, daemon API calls, skill fallbacks, and shared `@eforge-build/client` usage stable. Do not change the Claude Code plugin and do not bump `packages/pi-eforge/package.json`.

## Implementation

### Overview

Rework published Pi eforge helpers so variable-length read-only content uses full-width non-overlay custom panels with an internal scroll viewport. Compact select/search flows still use keyboard-driven `SelectList`, but visible item counts derive from terminal height. Change `eforge_confirm_build` to review/edit arbitrary source in `ctx.ui.editor()` before a compact confirmation selector, and update the skill to enqueue the returned edited source.

### Key Decisions

1. Keep compatibility export names (`showInfoOverlay`, `showSelectOverlay`, `showSearchableSelectOverlay`) but make them delegate to non-overlay panel implementations.
2. Add preferred helper names (`showInfoPanel`, `showSelectPanel`, `showSearchableSelectPanel`) and document that published Pi eforge panels are non-overlay by default.
3. Use `tui.terminal.rows` when available, with a small fallback row budget, so title/help/action rows remain visible in short terminals.
4. Return `{ choice: "confirm", source }` from `eforge_confirm_build` so edited text is not lost.

## Scope

### In Scope

- `packages/pi-eforge/extensions/eforge/**` published Pi integration.
- Pi skills/docs that describe native Pi eforge UX.
- Tests/static guardrails for published Pi overlay usage.
- Compatibility aliases for existing helper export names.

### Out of Scope

- Pi core overlay implementation changes.
- Claude Code plugin UX or plugin version changes.
- Daemon HTTP API or monitor UI changes.
- Broad command behavior redesign beyond presentation, review, and confirmation ergonomics.

## Files

### Create

- `test/pi-eforge-overlay-guard.test.ts` — Recursively scan `packages/pi-eforge/extensions/eforge/**/*.ts` and fail on `overlay: true` or `overlayOptions`; include a focused assertion that `eforge_confirm_build` uses `ctx.ui.editor` and does not render `Markdown(params.source)`.

### Modify

- `packages/pi-eforge/extensions/eforge/ui-helpers.ts` — Replace overlay helpers with non-overlay, viewport-bounded panel helpers. Add scroll handling for Markdown/info panels and terminal-height-aware visible counts for select/search panels. Preserve old export names as aliases.
- `packages/pi-eforge/extensions/eforge/index.ts` — Replace the `eforge_confirm_build` Markdown overlay with an editor-first review loop and compact non-overlay confirmation selector. Return edited source on confirmation and include source in the non-UI auto-confirm path.
- `packages/pi-eforge/extensions/eforge/status-command.ts` — Update overlay dashboard wording to scrollable panel wording.
- `packages/pi-eforge/extensions/eforge/config-command.ts` — Update overlay viewer wording to panel viewer wording.
- `packages/pi-eforge/extensions/eforge/profile-commands.ts` — Update overlay browsing/wizard wording to interactive selectors/panels; keep metadata/YAML previews on the non-overlay info helper.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — Update overlay-based UX wording to interactive selectors/panels; keep list/promote/demote/run feedback on the non-overlay info helper.
- `packages/pi-eforge/extensions/eforge/build-command.ts` — Ensure source/profile selectors use the non-overlay selector aliases and update comments if needed.
- `packages/pi-eforge/extensions/eforge/plan-command.ts` — Ensure initial selectors use the non-overlay selector aliases and update comments if needed.
- `packages/pi-eforge/extensions/eforge/restart-command.ts` — Update confirmation overlay wording to selector/panel wording.
- `packages/pi-eforge/extensions/eforge/landing-gate.ts` — Update landing-gate overlay wording to selector panel wording.
- `packages/pi-eforge/extensions/eforge/daemon-requests.ts` — Replace daemon-not-running overlay wording in comments with panel/interactive feedback wording.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — Describe editor-first review. On `choice: "confirm"`, set the working source to returned `source` when present before calling `eforge_build`. Keep legacy `edit` handling for resumed older sessions.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — Replace config overlay wording with interactive TUI panel wording.
- `packages/pi-eforge/skills/eforge-profile/SKILL.md` — Replace overlay-based profile browsing wording with interactive TUI selector/panel wording.
- `packages/pi-eforge/skills/eforge-profile-new/SKILL.md` — Replace guided overlay wizard wording with guided TUI wizard/panel wording.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — Replace overlay-based playbook wording with interactive TUI selector/panel wording.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` — Replace `showSelectOverlay`-as-overlay prose with native select UI wording where applicable.
- `packages/pi-eforge/README.md` — Describe native commands as interactive Pi TUI panels/selectors rather than interactive overlay UX.
- `docs/architecture.md` — Update the Pi Package section so native command UX is described as panels/selectors and current native status/restart/playbook/build surfaces are not described as overlay-only.
- `test/profile-wiring.test.ts` — Update assertions/test names that expect overlay wording; keep old helper export checks and add checks for new panel helper exports if added.
- `test/extension-tooling-wiring.test.ts` — Rename `/eforge:config Pi overlay...` test wording to panel/TUI wording while preserving the extensions config assertion.
- `test/pi-playbook-commands.test.ts` — Update helper mocks if command files import new panel helper names directly.

## Verification

- [ ] `rg -n "overlay: true|overlayOptions" packages/pi-eforge/extensions/eforge --glob '!node_modules/**' --glob '!dist/**'` returns no matches.
- [ ] `ui-helpers.ts` exports `showInfoPanel`, `showSelectPanel`, and `showSearchableSelectPanel`, and compatibility exports call panel implementations without passing `{ overlay: true }`.
- [ ] The `eforge_confirm_build` block calls `ctx.ui.editor`, contains no `Markdown(params.source)` call, and returns JSON with `source` when `choice` is `"confirm"`.
- [ ] `packages/pi-eforge/skills/eforge-build/SKILL.md` tells the agent to enqueue the returned edited source on confirmed results.
- [ ] Pi-facing README, skill docs, and `docs/architecture.md` no longer describe variable-content Pi eforge flows as overlay-based.
- [ ] Targeted tests pass: `pnpm exec vitest run test/pi-eforge-overlay-guard.test.ts test/profile-wiring.test.ts test/pi-playbook-commands.test.ts test/extension-tooling-wiring.test.ts`.
- [ ] `pnpm type-check` passes.
