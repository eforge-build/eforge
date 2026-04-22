---
title: Hardening 10: plugin and Pi skill parity
created: 2026-04-22
---

# Hardening 10: plugin and Pi skill parity

## Problem / Motivation

`AGENTS.md` requires: "Keep `eforge-plugin/` (Claude Code) and `packages/pi-eforge/` (Pi) in sync... every capability exposed in one should be exposed in the other when technically feasible."

Today the counts are 8 vs 9:

- `eforge-plugin/skills/`: backend, backend-new, build, config, init, restart, status, update
- `packages/pi-eforge/skills/`: eforge-backend, eforge-backend-new, eforge-build, eforge-config, eforge-init, eforge-plan, eforge-restart, eforge-status, eforge-update

The Pi extension has an `eforge-plan` skill that the Claude Code plugin lacks. Users in Claude Code cannot invoke a structured planning workflow before building - they have to inline all planning into the build description.

Separately, paired skills use different MCP tool reference syntax (`mcp__eforge__eforge_config` in the plugin, `eforge_config` in Pi). Shared narrative text gets out of sync over time because each update has to be made twice.

## Goal

- The Claude Code plugin gains a `plan` skill equivalent to Pi's `eforge-plan`.
- A lightweight mechanism (shared fragment includes OR a lint check) keeps paired skills' narrative in sync going forward.
- Plugin version bumps per the project convention.

## Approach

### 1. Port the `plan` skill

Read `packages/pi-eforge/skills/eforge-plan/SKILL.md` end to end. Identify:

- Tool invocations (`eforge_*` in Pi form)
- Narrative prose
- Any Pi-specific integration points

Create `eforge-plugin/skills/plan/plan.md` mirroring the structure. Transform each tool reference to the plugin form (`mcp__eforge__eforge_<tool>`). If the Pi skill references capabilities not available via MCP today, flag them and either (a) add the MCP surface to unblock parity (out of scope here - list in a follow-up) or (b) adjust the plugin skill to work within current MCP capabilities.

The plugin skill file needs the standard Claude Code skill frontmatter (`name`, `description` - match Pi's description). Follow the pattern in existing plugin skills (e.g., `eforge-plugin/skills/build/build.md`).

### 2. Align paired-skill narrative

For each pair - `build`, `config`, `init`, `status`, `update`, `restart`, `backend`, `backend-new`, and the newly added `plan` - compare the plugin and Pi versions side-by-side. Where narrative has drifted, pick the better version and bring the other up to match. Tool-reference syntax legitimately differs; everything else (when to invoke, what to do first, how to interpret results) should be identical.

### 3. Establish a sync mechanism

Pick one lightweight option:

- **Option A (preferred):** Add a CI check (or a script callable via `pnpm docs:check-parity`) that, for each skill pair, normalizes the MCP tool references (`eforge_foo` ↔ `mcp__eforge__eforge_foo`) and diffs the rest. Fail on diff. Place the script in `scripts/check-skill-parity.mjs`. Wire into `pnpm test` if fast, or into a lint script.

- **Option B:** Extract truly shared narrative into markdown fragments under `shared/skills/<name>.md` and build each skill file by concatenating the fragment with a thin frontmatter and a tool-reference block. Overkill for now; prefer A.

Go with Option A. The script can be ~50 lines of node.

### 4. Bump the plugin version

Per `AGENTS.md`: "Always bump the plugin version in `eforge-plugin/.claude-plugin/plugin.json` when changing anything in the plugin."

Bump the patch (or minor, reflecting the new skill) and note the `plan` skill addition in the changelog if one exists in the plugin.

### 5. Cross-reference

If the plugin's top-level README mentions available skills or commands, add `/eforge:plan` there. Same for any MCP-tool registry documentation.

## Scope

### In scope

- New `eforge-plugin/skills/plan/plan.md` skill, ported from `packages/pi-eforge/skills/eforge-plan/SKILL.md`.
- Narrative alignment across paired skill files in `eforge-plugin/skills/` and `packages/pi-eforge/skills/`.
- New `scripts/check-skill-parity.mjs` parity-check script (Option A), optionally wired via `pnpm docs:check-parity` and/or `pnpm test` or a lint script.
- Version bump in `eforge-plugin/.claude-plugin/plugin.json` (patch or minor) and changelog note for the `plan` skill addition, if a plugin changelog exists.
- Updates to the plugin's top-level README or MCP-tool registry documentation to list `/eforge:plan`, if those currently enumerate skills/commands.

### Out of scope

- Adding new skills beyond `plan`.
- Refactoring the Pi extension or plugin packaging.
- Extending MCP tool capabilities (unless blocking `plan` parity - flag a follow-up instead).

## Acceptance Criteria

- `node scripts/check-skill-parity.mjs` exits 0 with all pairs in sync.
- In a Claude Code harness with the eforge plugin loaded, `/eforge:plan` appears and runs, producing planning output similar to the Pi extension's `eforge-plan`.
- `ls eforge-plugin/skills/ | wc -l` and `ls packages/pi-eforge/skills/ | wc -l` both report the same count.
- `eforge-plugin/.claude-plugin/plugin.json` version is bumped.

## Files touched

- `eforge-plugin/skills/plan/plan.md` (new)
- Paired skill files across `eforge-plugin/skills/` and `packages/pi-eforge/skills/` (diff cleanup)
- `scripts/check-skill-parity.mjs` (new)
- `eforge-plugin/.claude-plugin/plugin.json` (version bump)
- Plugin README or top-level docs, if they enumerate skills
