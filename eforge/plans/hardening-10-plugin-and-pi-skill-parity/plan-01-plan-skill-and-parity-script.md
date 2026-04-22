---
id: plan-01-plan-skill-and-parity-script
name: Port plan skill to plugin and add parity-check script
depends_on: []
branch: hardening-10-plugin-and-pi-skill-parity/plan-skill-and-parity-script
---

# Port plan skill to plugin and add parity-check script

## Architecture Context

The Claude Code plugin (`eforge-plugin/`) and the Pi extension (`packages/pi-eforge/`) are the two consumer-facing integration surfaces for eforge. `AGENTS.md` mandates that every capability in one be exposed in the other when technically feasible. Today the Pi extension has a `eforge-plan` skill that the plugin lacks, so Claude Code users cannot invoke a structured planning workflow before calling `/eforge:build`.

Skill files in each location follow different conventions:

- Plugin skills live at `eforge-plugin/skills/<name>/<name>.md` and use Claude Code frontmatter: `description`, `argument-hint`, `disable-model-invocation`. They reference MCP tools as `mcp__eforge__eforge_<tool>` and related skills as `/eforge:<name>`.
- Pi skills live at `packages/pi-eforge/skills/eforge-<name>/SKILL.md` and use Pi frontmatter: `name`, `description`, `disable-model-invocation`. They reference tools as `eforge_<tool>` and related skills the same way.

The plugin manifest `eforge-plugin/.claude-plugin/plugin.json` enumerates every command file explicitly; adding a new skill requires registering it there and bumping the plugin `version`. The top-level `README.md` currently states the Claude Code plugin "doesn't need a separate planning skill" — this is the claim the source overturns.

## Implementation

### Overview

Port `packages/pi-eforge/skills/eforge-plan/SKILL.md` into `eforge-plugin/skills/plan/plan.md`, transforming tool references and frontmatter to plugin conventions. Add `scripts/check-skill-parity.mjs` as a Node script (no external deps) that enumerates the 9 skill pairs, strips frontmatter, normalizes tool-reference syntax in both directions, and diffs the remaining narrative. Register the new skill in `plugin.json`, bump the plugin version, add a `docs:check-parity` npm script, and update the README paragraph that previously said no plan skill was needed.

### Key Decisions

1. **Option A (parity script) not Option B (shared fragments)** — The source explicitly picks Option A. A ~50-line Node script is lighter than a build step that concatenates fragments, and it catches drift during review rather than hiding it behind an indirection layer.
2. **Skill pair mapping table lives inside the script** — Hard-code the 9 pairs (`{plugin: 'backend', pi: 'eforge-backend'}`, etc.) as an array. No glob-based discovery — the set is small and explicit.
3. **Normalization rules** — Before diffing, the script (a) strips YAML frontmatter from both files, (b) rewrites `mcp__eforge__eforge_<x>` to `eforge_<x>` on the plugin side, and (c) rewrites plugin-style related-skill references `/eforge:<name>` to match Pi's `eforge_<name>` form where Pi uses that form. Everything else is expected to match byte-for-byte after these substitutions.
4. **Plugin frontmatter for the plan skill** — Use `description` matching the Pi skill's description string; add `argument-hint: "[topic] [--resume]"` following the pattern in `eforge-plugin/skills/build/build.md`. Do NOT include `disable-model-invocation` unless existing plugin plan-style skills use it — check `build.md` convention and match.
5. **Version bump strategy** — Bump the minor segment of `version` (`0.5.33` → `0.6.0`) because a new user-visible command is added. Patch would be acceptable but minor better signals the new capability.
6. **Script wiring** — Expose as `pnpm docs:check-parity` in root `package.json` scripts. Do NOT wire into `pnpm test` yet — the first run is expected to fail until plan-02 aligns narrative; adding it to `test` now would break CI.
7. **README update** — Replace the sentence in README.md line 102 that says the Claude Code plugin doesn't need a planning skill. The new text should state that both Pi and Claude Code expose `/eforge:plan` as a structured planning conversation before handoff.

## Scope

### In Scope
- Create `eforge-plugin/skills/plan/plan.md` by porting `packages/pi-eforge/skills/eforge-plan/SKILL.md`, transforming tool references from `eforge_*` to `mcp__eforge__eforge_*` and frontmatter to plugin conventions.
- Register the new skill's path in `eforge-plugin/.claude-plugin/plugin.json` under `commands`.
- Bump `version` in `eforge-plugin/.claude-plugin/plugin.json` from `0.5.33` to `0.6.0`.
- Create `scripts/check-skill-parity.mjs` — a Node ESM script that enumerates skill pairs, normalizes frontmatter + tool references, diffs the rest, and exits non-zero on divergence.
- Add `docs:check-parity` to the root `package.json` `scripts` block invoking the script.
- Update `README.md` line 102 (the paragraph explaining the Pi extension has `/eforge:plan` but the plugin doesn't) to reflect that both surfaces now expose `/eforge:plan`.

### Out of Scope
- Aligning narrative across the other 8 skill pairs — that's plan-02's job.
- Wiring the parity script into `pnpm test` — will happen in plan-02 after narrative drift is resolved.
- New MCP tool surface (the ported skill must work with what MCP already exposes).
- Refactoring plugin packaging or Pi extension layout.

## Files

### Create
- `eforge-plugin/skills/plan/plan.md` — new Claude Code plugin skill, ported from Pi's `eforge-plan/SKILL.md`. Frontmatter: `description` matching Pi's, `argument-hint: "[topic] [--resume]"`. Body mirrors Pi's workflow (Step 1 Session Setup through Step 11 Readiness) with all tool references rewritten to plugin form. Related Skills table uses plugin-style `/eforge:<name>` references.
- `scripts/check-skill-parity.mjs` — Node ESM script. Hard-codes 9 skill pairs, reads both files, strips YAML frontmatter (between the two leading `---` delimiters), applies tool-reference normalization in both directions, diffs the normalized bodies, prints a unified-diff-style summary for each divergent pair, exits 0 on full match, exits 1 on any divergence. No external deps — use `node:fs`, `node:path`.

### Modify
- `eforge-plugin/.claude-plugin/plugin.json` — Add `"./skills/plan/plan.md"` to the `commands` array; bump `version` from `0.5.33` to `0.6.0`.
- `package.json` (repo root) — Add `"docs:check-parity": "node scripts/check-skill-parity.mjs"` to the `scripts` block. Do not modify other scripts.
- `README.md` — Rewrite line 102. Current text: "The Pi package also provides native interactive commands for backend profile management (`/eforge:backend`, `/eforge:backend:new`) and config viewing (`/eforge:config`) with interactive overlay UX. The Pi package includes an `/eforge:plan` skill for structured planning conversations before handing off to eforge. Claude Code users get equivalent functionality through Claude Code's built-in plan mode, which eforge works with natively — so the Claude Code plugin doesn't need a separate planning skill." New text must retain the Pi-specific interactive overlay note and state that `/eforge:plan` is available in both the Claude Code plugin and the Pi extension for structured planning conversations before handoff.

## Verification

- [ ] `eforge-plugin/skills/plan/plan.md` exists and begins with a YAML frontmatter block containing a `description:` key; `argument-hint` key present.
- [ ] Every occurrence of `eforge_<tool>` (standalone, not inside `mcp__eforge__`) in the plan skill body has been rewritten to `mcp__eforge__eforge_<tool>` or to a plugin-style `/eforge:<name>` reference in the Related Skills section.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` contains `"./skills/plan/plan.md"` in the `commands` array and `"version": "0.6.0"`.
- [ ] Running `node scripts/check-skill-parity.mjs` exits with a non-zero status and prints a diff for at least one pair where real drift exists (e.g. `build` pair has different Step 4 and Step 1 content per Pi vs plugin) — this proves the script works; plan-02 will drive the exit code to 0.
- [ ] `node -c scripts/check-skill-parity.mjs` succeeds (syntax valid).
- [ ] `pnpm docs:check-parity` invokes the script (exit code irrelevant for this plan — that's a plan-02 gate).
- [ ] `grep -c '/eforge:plan' README.md` returns at least 1; the paragraph no longer contains the phrase "doesn't need a separate planning skill".
- [ ] `ls eforge-plugin/skills/ | wc -l` returns 9 (was 8).
