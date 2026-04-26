---
id: plan-01-adaptive-planning-skills
name: Adaptive /eforge:plan workflow and /eforge:build readiness updates
branch: improve-eforge-plan-adaptive-planning-workflow/adaptive-planning-skills
---

# Adaptive /eforge:plan workflow and /eforge:build readiness updates

## Architecture Context

The `/eforge:plan` skill is a conversational planning skill that produces a session plan markdown file under `.eforge/session-plans/`. The session file accumulates frontmatter status and body sections as the conversation progresses. When the user runs `/eforge:build` with no arguments, that skill scans `.eforge/session-plans/` for active sessions (`status: planning` or `ready`) and either submits the file directly to the daemon or warns about incomplete dimensions.

Today both behaviors hard-code a fixed checklist of six dimensions: `scope`, `code-impact`, `architecture-impact`, `design-decisions`, `documentation-impact`, `risks`. The build skill's warning text walks the user through whichever of those booleans is `false`. This forces every change — including bug fixes and docs-only work — through the same shape of conversation, even when several dimensions are irrelevant.

Both integrations carry near-identical copies of these skills:

- Pi extension: `packages/pi-eforge/skills/eforge-plan/SKILL.md`, `packages/pi-eforge/skills/eforge-build/SKILL.md`
- Claude Code plugin: `eforge-plugin/skills/plan/plan.md`, `eforge-plugin/skills/build/build.md`

`scripts/check-skill-parity.mjs` (run as part of `pnpm test`) diffs these pairs after stripping frontmatter, normalizing tool-reference syntax, and removing `<!-- parity-skip-start --> ... <!-- parity-skip-end -->` blocks plus a leading `> **Note:** In Pi, ...` block on the Pi side. Any narrative outside those carve-outs must match across the pair.

The Claude Code plugin manifest (`eforge-plugin/.claude-plugin/plugin.json`) carries a `version` field that must be bumped whenever plugin files change (currently `0.9.1`).

The daemon's PRD formatter consumes the session file as opaque source material. The build skill must not rewrite session files into a different format — it just resolves the file path and hands it to `eforge_build` / `mcp__eforge__eforge_build`. So the new frontmatter shape is purely for the planning and build skills to coordinate on; the daemon does not need to understand it.

## Implementation

### Overview

Replace the fixed six-dimension workflow with an adaptive strategy:

1. After context gathering, classify `planning_type` (`bugfix` | `feature` | `refactor` | `architecture` | `docs` | `maintenance` | `unknown`) and `planning_depth` (`quick` | `focused` | `deep`). The user can override either classification.
2. Use a work-type playbook to pick the relevant required dimensions for that classification, instead of always using the same six.
3. Make `acceptance-criteria` a first-class required dimension for every non-`unknown` work type so the daemon's PRD formatter receives explicit acceptance criteria.
4. Switch the session frontmatter from a `dimensions: { name: bool, ... }` map to richer adaptive metadata while still tolerating old session files for resume and build-readiness checks.
5. Update `/eforge:build` so it distinguishes truly missing required dimensions from intentionally skipped ones in its warning when a `planning` session is enqueued.

Apply the same change to both the Pi and Claude Code plugin copies of each skill, keeping the post-normalization narrative identical. Bump `eforge-plugin/.claude-plugin/plugin.json` from `0.9.1` to `0.10.0`. Do not change `packages/pi-eforge/package.json`.

### Key Decisions

1. **Adaptive metadata replaces the boolean dimension map, but the build skill keeps a compatibility branch for old files.** New sessions emit `planning_type`, `planning_depth`, `confidence`, `required_dimensions`, `optional_dimensions`, `skipped_dimensions` (each entry: `name` + `reason`), and `open_questions` in frontmatter. Both skills must explicitly state that if a session file still uses the legacy `dimensions: { ... }` boolean shape, the build skill treats every `false` entry as a missing required dimension (preserving today's behavior) and the plan skill, on resume, migrates it to the new shape on next save. Rationale: the source PRD risk section calls out backward compatibility for active in-flight sessions. A small compatibility branch in the skills covers this without persisting a migration step in code.

2. **Acceptance criteria is a required dimension for every classified work type.** The build skill's interview already asks for acceptance criteria as one of its five PRD sections, but the planner never explicitly captures it today. Making it a required planning dimension closes that gap and removes the need for the build skill to re-ask. Rationale: the source PRD's acceptance criteria explicitly require this.

3. **`planning_depth` controls breadth, not the dimension list.** `quick` requires only the smallest set (problem statement + acceptance criteria + one or two type-specific dimensions); `focused` adds the full required set for the type; `deep` additionally encourages optional dimensions. Rationale: depth is orthogonal to type — a deep bug investigation and a quick feature both make sense. Keeping depth as a knob over the same playbook avoids combinatorial explosion.

4. **`unknown` falls back to today's six-dimension list.** When the planner cannot classify confidently and the user does not override, the playbook reverts to the legacy six dimensions plus acceptance criteria. Rationale: the source PRD calls out that classification must allow `unknown` and avoid being another rigid workflow; falling back to a known-safe checklist preserves the current behavior as the worst case.

5. **Skipped dimensions carry a reason, and readiness only checks `required_dimensions`.** A plan is ready when every entry in `required_dimensions` either has body content or appears in `skipped_dimensions` with a reason. Optional dimensions never block readiness. Rationale: directly fulfills the PRD's requirement that skipped dimensions must not be flagged as missing.

6. **Both /eforge:plan and /eforge:build skills are kept in sync via `<!-- parity-skip-start -->` blocks only where the platforms genuinely diverge** (e.g., `eforge_confirm_build` TUI overlay vs plain-text confirm in /eforge:build). The new adaptive workflow text lives outside skip blocks so the skill-parity script enforces it identically across Pi and the plugin.

## Scope

### In Scope

- Rewrite the workflow body of `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md` to use the adaptive type/depth strategy, work-type playbooks, acceptance criteria as a first-class section, and the new session frontmatter shape.
- Document the legacy-compatibility branch (boolean `dimensions` shape) in both plan skills.
- Update `packages/pi-eforge/skills/eforge-build/SKILL.md` and `eforge-plugin/skills/build/build.md` so the `planning`-session warning lists truly missing required dimensions, distinguishes intentionally skipped dimensions (with reasons), and falls back gracefully on legacy session files.
- Bump `eforge-plugin/.claude-plugin/plugin.json` `version` from `0.9.1` to `0.10.0`.
- Keep narrative outside `<!-- parity-skip-* -->` markers byte-equivalent (after the parity script's normalization) between each Pi/plugin skill pair.

### Out of Scope

- Building a Pi-native planning wizard or overlay UI.
- Changing the daemon's PRD formatter, planning agents, or workflow profile selection logic in the engine.
- Migrating or rewriting historical `.eforge/session-plans/` files on disk; only document the runtime compatibility path.
- Adding new MCP / Pi tools, CLI commands, or engine code paths.
- Bumping `packages/pi-eforge/package.json`.
- Modifying any other skill files (`init`, `config`, `status`, `restart`, `update`, `profile`, `profile-new`).

## Files

### Modify

- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — Replace the fixed six-dimension Steps 3–11 with an adaptive workflow: a strategy/classification step (planning_type, planning_depth, confidence, user override), per-work-type playbooks (bugfix, feature, refactor, architecture, docs, maintenance, unknown fallback) each enumerating their required and optional dimensions, an explicit acceptance-criteria section captured for every non-`unknown` type, an updated session-file frontmatter template using `planning_type`, `planning_depth`, `confidence`, `required_dimensions`, `optional_dimensions`, `skipped_dimensions` (with reasons), and `open_questions`, and a readiness rule that passes when every required dimension is either filled or explicitly skipped with a reason. Add a short "Legacy session files" subsection describing how a session that still has the old `dimensions: { name: bool, ... }` map is handled on resume (treated as `unknown` type with all six required, migrated to the new shape on next save).
- `eforge-plugin/skills/plan/plan.md` — Apply the exact same workflow rewrite as the Pi copy, preserving `<!-- parity-skip-start --> ... <!-- parity-skip-end -->` only where the two platforms genuinely diverge (today the file has none for /eforge:plan and likely will not need any new ones). All narrative outside skip markers must match the Pi copy after the parity script's tool-reference normalization (`mcp__eforge__eforge_<x>` ↔ `eforge_<x>`, `/eforge:<name>` ↔ `eforge_<name>`).
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — Update Step 1, Branch C's `planning`-session warning so it (a) reads `required_dimensions`, `skipped_dimensions`, and any body section names from the new frontmatter, (b) lists only required dimensions that have neither body content nor a `skipped_dimensions` entry as truly missing, (c) separately notes intentionally skipped dimensions with their reason, (d) recommends `/eforge:plan --resume` only when at least one truly required dimension is still missing, and (e) falls back to the existing "list every `false` dimension" behavior when the session file still uses the legacy boolean `dimensions` shape. No other steps in this skill change.
- `eforge-plugin/skills/build/build.md` — Apply the same Step 1 / Branch C update as the Pi copy, keeping existing `<!-- parity-skip-start --> ... <!-- parity-skip-end -->` blocks (Step 4 confirm UX, Step 6 follow) untouched and matching the Pi narrative outside those markers.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump `version` from `0.9.1` to `0.10.0` to reflect plugin-skill behavior changes (per `AGENTS.md`: plugin and npm package versions are independent; do not touch `packages/pi-eforge/package.json`).

## Verification

- [ ] `node scripts/check-skill-parity.mjs` exits 0 (all 9 skill pairs match after normalization, including the rewritten `plan` and `build` pairs).
- [ ] `pnpm test` exits 0 (parity check + vitest suite).
- [ ] `pnpm type-check` exits 0 (no TypeScript regressions; this plan touches only markdown and JSON).
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field equals `0.10.0` and parses as valid JSON.
- [ ] `packages/pi-eforge/package.json` `version` field is unchanged from its pre-plan value (verified via `git diff packages/pi-eforge/package.json` showing no version-line change).
- [ ] In `packages/pi-eforge/skills/eforge-plan/SKILL.md` and `eforge-plugin/skills/plan/plan.md`, the workflow body contains: an explicit classification step naming `planning_type` and `planning_depth`; a section header for each of the six work-type playbooks (`bugfix`, `feature`, `refactor`, `architecture`, `docs`, `maintenance`) plus an `unknown` fallback; an `acceptance-criteria` dimension named in every non-`unknown` playbook's required list; a frontmatter template that uses `required_dimensions`, `optional_dimensions`, and `skipped_dimensions` (with `reason`) instead of the old `dimensions: { scope: false, ... }` map; and a "Legacy session files" subsection describing handling of the old boolean shape.
- [ ] In `packages/pi-eforge/skills/eforge-build/SKILL.md` and `eforge-plugin/skills/build/build.md`, Branch C of Step 1 explicitly references `required_dimensions` and `skipped_dimensions`, distinguishes truly missing required dimensions from intentionally skipped ones (with reason) in its warning text, and includes a fallback paragraph for legacy `dimensions: { name: bool }` session files.
- [ ] Each Pi/plugin pair (`eforge-plan`/`plan`, `eforge-build`/`build`) produces a zero-line diff when run through the same normalization the parity script applies (verified by the parity check passing).
