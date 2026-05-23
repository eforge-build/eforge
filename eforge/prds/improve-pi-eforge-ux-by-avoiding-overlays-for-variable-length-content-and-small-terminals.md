---
title: Improve Pi eforge UX by avoiding overlays for variable-length content and small terminals
created: 2026-05-23
depends_on: ["add-shared-landing-gate-ux-for-autonomous-playbook-runs"]
profile: pi-codex-5-5
---

# Improve Pi eforge UX by avoiding overlays for variable-length content and small terminals

## Problem / Motivation

User request: investigate the current Pi UX for `pi-eforge` and project-local `.pi/extensions/` overlay usage, then plan a safer follow-on change because overlays can clip when terminal windows are small or content is longer than available screen space.

Current daemon state checked on 2026-05-23: one build is running in queue item `add-shared-landing-gate-ux-for-autonomous-playbook-runs` (`sessionId=f776c850-ff70-4bd8-95c0-71c4f406fa8f`, running run `bea5302d-3bae-4ec6-a70a-cce4ef9ed27e`). This plan should be treated as a follow-on to that active build, not as concurrent work that edits the same Pi command surfaces mid-build.

Pi eforge currently uses floating overlays for both compact choices and variable-length content. In small terminal windows, overlays with `maxHeight` can clip because Pi truncates overlay lines rather than providing scrolling. For variable content, this can hide important content or even action controls, for example Confirm/Edit/Cancel after a long build source preview. A clipped overlay is worse than a less fancy full-screen/editor experience because the user may be unable to complete or confidently understand the flow.

Affected users: Pi users running eforge native commands in short/narrow terminal windows, split panes, SSH/tmux sessions, or any environment with limited terminal height.

Why now: the current running build is adding shared landing-gate UX for autonomous playbook runs. This follow-on should harden the broader Pi UX pattern before more command surfaces adopt overlay-heavy flows.

Roadmap alignment: this is not currently an explicit roadmap item. It fits Integration & Maturity by improving Pi integration quality and avoiding fragile UX; it does not conflict with daemon/orchestration boundaries.

Evidence gathered:

- Pi TUI docs (`docs/tui.md`) describe overlays as floating components via `ctx.ui.custom(..., { overlay: true })`. They support `maxHeight`, positioning, and responsive `visible`, but the overlay component itself is still responsible for bounded rendering and line widths.
- Pi TUI implementation (`@earendil-works/pi-tui/dist/tui.js`) applies `maxHeight` by slicing rendered overlay lines (`overlayLines = overlayLines.slice(0, maxHeight)`). This means overflow is not scrollable; bottom controls/help/action rows can disappear.
- Published Pi eforge shared overlay helpers live in `packages/pi-eforge/extensions/eforge/ui-helpers.ts`:
  - `showSelectOverlay`
  - `showSearchableSelectOverlay`
  - `showInfoOverlay`
  - fixed overlay option presets use centered overlays with 70–80% width and 80–85% maxHeight.
- Variable-length content is currently rendered through overlays in several user-facing commands:
  - `/eforge:status` via `packages/pi-eforge/extensions/eforge/status-command.ts`
  - `/eforge:config` via `packages/pi-eforge/extensions/eforge/config-command.ts`
  - `/eforge:profile` and `/eforge:profile:new` via `packages/pi-eforge/extensions/eforge/profile-commands.ts`
  - `/eforge:playbook` list/promote/demote/run feedback via `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
  - `eforge_confirm_build` in `packages/pi-eforge/extensions/eforge/index.ts`, which renders arbitrary PRD/source Markdown before the Confirm/Edit/Cancel selector.
- Project-local maintainer UX in `.pi/extensions/eforge-dev/index.ts` also uses overlays for `/dev` cockpit, info panels, and progress panels.
- `rg` found overlay/custom UI usage concentrated in shared helpers plus `eforge_confirm_build` and local `.pi/extensions/eforge-dev`.
- Pi TUI implementation confirms overlay maxHeight truncation rather than scrolling.

Early conclusion: overlays are safe only for compact bounded choices. They are risky for variable-height Markdown, status dashboards, config dumps, generated source previews, profile YAML previews, and progress/log-like panels unless the component implements its own viewport and scrolling.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Pi overlay `maxHeight` truncates rendered lines rather than providing scrolling. | Read Pi TUI docs and implementation: `compositeOverlays` slices `overlayLines` to `maxHeight`. | high | low | Reproduce with a small terminal and `/eforge:status` or an overlay QA command. | Core premise weakens if Pi overlays now scroll; still acceptable to prefer editor/full-panel for long editable content. |
| `eforge_confirm_build` can place actions below arbitrary source preview and therefore can clip actions. | Read implementation in `packages/pi-eforge/extensions/eforge/index.ts`; source Markdown is added before `SelectList`. | high | low | Run `/eforge:build` with long source in a short terminal after current build completes. | If Pi layout happens to keep controls visible, risk is lower, but arbitrary preview remains poor fit for overlay. |
| Native Pi eforge variable-content views use shared `showInfoOverlay`. | Read `ui-helpers.ts` and callers in status/config/profile/playbook modules. | high | low | Grep after current build lands to account for changed files. | File list may drift due to running build; builder should re-run search before editing. |
| `ctx.ui.custom()` non-overlay plus `tui.terminal.rows` is available enough to implement viewport-aware panels. | Read Pi TUI typings showing `TUI.terminal.rows`; docs show `ctx.ui.custom()` non-overlay custom components. | medium-high | low | Compile a small helper and run type-check. | If extension callback type does not expose terminal in published types, helper may need structural typing or a fallback row budget. |
| Changing `eforge_confirm_build` return shape may require skill/tool coordination. | Current skill expects `choice` from `eforge_confirm_build`; tool currently returns only choice. | high | low | Inspect `packages/pi-eforge/skills/eforge-build/SKILL.md` during implementation. | If not coordinated, edited source may be ignored or the skill may repeat an awkward edit loop. |
| Current running build may edit some of the same Pi command files. | `eforge_status` shows active build for shared landing gate UX in Pi playbook surfaces. | medium | low | Wait for build completion or inspect its final diff before starting implementation. | Concurrent edits could conflict; treat this as follow-on work. |

## Goal

Improve Pi eforge UX by ensuring variable-length content is not rendered in floating overlays that can clip in small terminals. The desired outcome is an interactive Pi TUI experience where long read-only content is viewport-bounded/scrollable and long editable content uses an editor/review-first flow.

## Approach

Recommended profile: **Excursion**.

Rationale: this is a cohesive Pi UX hardening change across several related command modules and shared helpers. It likely touches multiple files and requires careful sequencing after the current active build, but it does not need delegated module planning or an Expedition-level architecture process. A single cohesive plan can cover helper design, command migrations, docs wording, and guardrails.

Follow-on sequencing:

- Treat this as a follow-on to the currently running queue item `add-shared-landing-gate-ux-for-autonomous-playbook-runs`.
- Avoid concurrent edits to the same Pi command files until that build lands or is abandoned.

### Design decisions

1. Default away from overlays for variable content.
   - Rationale: Pi overlays are floating and `maxHeight` truncates lines; unbounded content must not be placed above required actions in such a container.

2. Use full-width/non-overlay custom components for rich read-only views.
   - Rationale: `ctx.ui.custom()` without `overlay: true` replaces the editor area instead of floating over existing content, reducing clipping risk and allowing a controlled scroll viewport.
   - Expected behavior: title and footer/help remain fixed; content scrolls within available rows.

3. Use `ctx.ui.editor()` for review/edit flows, especially build source confirmation.
   - Rationale: build source can be arbitrarily long and editable. Editor UX is a better fit than Markdown preview plus a selector.

4. Keep compact choice UI, but make it bounded and terminal-aware.
   - Rationale: overlays or select components are still good for small choices, but visible item count should be based on available terminal height instead of fixed 15 rows.

5. Preserve existing command semantics where possible.
   - Rationale: this should be a UX hardening follow-on, not a broad behavioral rewrite. Command names, skill fallbacks, daemon APIs, and shared client usage should remain stable unless needed for edited-source return handling.

6. Published Pi integration should be stricter than project-local maintainer UX, but migrate both.
   - Rationale: `packages/pi-eforge` affects users; `.pi/extensions/eforge-dev` affects maintainers and can dogfood the new pattern.

Open design choice for builder:

- Whether to keep `showInfoOverlay` as a compatibility name that now renders non-overlay, or rename to `showInfoPanel` and update all callers. Prefer compatibility if it reduces churn, but update docs/comments so future code does not assume overlay behavior.

### Code impact

Likely files/modules to change:

- `packages/pi-eforge/extensions/eforge/ui-helpers.ts`
  - Add new non-overlay helpers, for example:
    - `showScrollablePanel`
    - `showMarkdownPanel`
    - `showSelectPanel`
    - `showSearchableSelectPanel`
  - Rework existing helper exports so callers can migrate with minimal churn.
  - Use `tui.terminal.rows` and rendered line budgets to keep title/footer/actions visible.

- `packages/pi-eforge/extensions/eforge/index.ts`
  - Update `eforge_confirm_build` to avoid rendering arbitrary source in an overlay.
  - Preferred direction: use `ctx.ui.editor()` for source review/editing, then a compact bounded confirm/cancel/revise choice.
  - If tool return shape must change to include edited source, update the build skill accordingly.

- `packages/pi-eforge/extensions/eforge/status-command.ts`
- `packages/pi-eforge/extensions/eforge/config-command.ts`
- `packages/pi-eforge/extensions/eforge/profile-commands.ts`
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts`
- `packages/pi-eforge/extensions/eforge/plan-command.ts`
- `packages/pi-eforge/extensions/eforge/build-command.ts`
- `packages/pi-eforge/extensions/eforge/restart-command.ts`
  - Replace `showInfoOverlay` calls with scrollable/full-panel display.
  - Replace select overlay calls with viewport-aware non-overlay selection where needed.

- `.pi/extensions/eforge-dev/index.ts`
  - Migrate local maintainer cockpit/info/progress overlays to the same safer patterns or local equivalents.

- Pi-facing docs/skills:
  - `packages/pi-eforge/README.md`
  - `packages/pi-eforge/skills/eforge-build/SKILL.md`
  - `packages/pi-eforge/skills/eforge-config/SKILL.md`
  - `packages/pi-eforge/skills/eforge-profile*.md`
  - `packages/pi-eforge/skills/eforge-playbook/SKILL.md`
  - Update wording from “overlay-based” to “interactive Pi TUI” where overlays are no longer the design goal.

- Tests:
  - Existing tests mock `ui-helpers` in `test/pi-playbook-commands.test.ts` and have wiring assertions in `test/profile-wiring.test.ts`.
  - Add/adjust grep-style guardrails so `overlay: true` in published Pi eforge is either absent or explicitly allowlisted for tiny bounded interactions.
  - Add unit tests for viewport helper behavior with small height assumptions if practical.

## Scope

In scope:

- Published Pi integration only (`packages/pi-eforge/extensions/eforge/**`) plus the project-local maintainer extension (`.pi/extensions/eforge-dev/**`) where it uses the same risky pattern.
- Replace or wrap overlay-based variable-content panels with non-overlay/full-width custom UI that manages its own viewport and scrolling.
- Change `eforge_confirm_build` from overlay Markdown preview to an editor/review-first flow so arbitrary PRD/source text is not rendered above critical controls in a clipped overlay.
- Keep small bounded choice interactions available, but make them viewport-aware and non-overlay by default.
- Update Pi-facing skill/docs wording that currently promises “overlay-based” UX where the desired behavior becomes “interactive Pi TUI”.
- Add guardrails/tests to prevent reintroducing large unbounded overlays in Pi eforge.

Out of scope:

- Claude Code plugin UX; this is explicitly Pi-context only.
- Pi core overlay implementation changes; this repo should adapt usage patterns rather than changing Pi itself.
- Major command behavior redesign beyond presentation and review/confirmation ergonomics.
- Web monitor UI changes.

## Acceptance Criteria

- Published Pi eforge no longer renders variable-length Markdown/status/config/profile/playbook/build-source content in floating overlays.
- `eforge_confirm_build` provides a safe review path for long PRD/source text where Confirm/Edit/Cancel or equivalent actions cannot be clipped below the preview.
- Read-only status/config/profile/playbook views are scrollable or otherwise viewport-bounded in small terminal heights.
- Select/search menus used by native Pi eforge commands remain keyboard-navigable and have visible help/action affordances in short terminals.
- Project-local `.pi/extensions/eforge-dev` no longer uses risky unbounded overlays for cockpit/info/progress panels, or it adopts the same safe helper pattern.
- Pi-facing docs/skill notes no longer advertise overlay-based UX as the desired implementation for variable content.
- Tests or static guardrails prevent accidental reintroduction of unbounded `overlay: true` usage in `packages/pi-eforge/extensions/eforge` except explicit small bounded allowlist cases.
- Existing command fallbacks to skills/non-interactive behavior continue to work.
- Validation passes: `pnpm type-check` and relevant tests; ideally full `pnpm test` if runtime allows.
