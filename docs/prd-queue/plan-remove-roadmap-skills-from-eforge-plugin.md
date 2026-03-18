---
title: Plan: Remove roadmap skills from eforge plugin
created: 2026-03-18
status: running
---

## Problem / Motivation

The eforge plugin currently bundles 4 roadmap-related skills (`roadmap-policy`, `roadmap`, `roadmap-init`, `roadmap-prune`) plus a spec file (`roadmap-skills-spec.md`). These don't belong in the eforge plugin - eforge is about plan-build-review workflows, not roadmap governance. Removing them keeps the plugin focused on its core purpose.

## Goal

Remove all roadmap-related skills and references from the eforge plugin to maintain a clean separation of concerns.

## Approach

1. **Delete skill directories** - remove 4 directories entirely:
   - `eforge-plugin/skills/roadmap-policy/`
   - `eforge-plugin/skills/roadmap/`
   - `eforge-plugin/skills/roadmap-init/`
   - `eforge-plugin/skills/roadmap-prune/`

2. **Delete spec file** - remove `eforge-plugin/roadmap-skills-spec.md`

3. **Update `eforge-plugin/.claude-plugin/plugin.json`**:
   - Remove 3 commands from the `commands` array:
     - `./skills/roadmap-init/roadmap-init.md`
     - `./skills/roadmap/roadmap.md`
     - `./skills/roadmap-prune/roadmap-prune.md`
   - Update `description` to remove "roadmap management" language
   - Bump version from `1.5.1` to `1.6.0`

4. **Update `CLAUDE.md`** (line 86) - change the `eforge-plugin/` comment from `# Claude Code plugin (skills for enqueue, run, status, config, roadmap)` to `# Claude Code plugin (skills for enqueue, run, status, config)`

5. **Update `docs/roadmap.md`** (line 34) - remove the "Remove roadmap skills" bullet since it will have shipped

## Scope

**In scope:**
- Deleting the 4 roadmap skill directories and the spec file
- Updating `plugin.json` (commands, description, version bump)
- Updating `CLAUDE.md` and `docs/roadmap.md` references

**Out of scope:**
- N/A

## Acceptance Criteria

- `pnpm build` passes
- `pnpm test` passes
- `plugin.json` is valid JSON with correct command paths (no references to deleted skills)
- No remaining references to removed skills: `grep -r "roadmap-policy\|roadmap-init\|roadmap-prune\|roadmap-skills-spec" eforge-plugin/` returns no results
- `plugin.json` version is `1.6.0`
- `plugin.json` description does not mention "roadmap management"
- `CLAUDE.md` project structure comment for `eforge-plugin/` no longer mentions "roadmap"
- `docs/roadmap.md` no longer contains the "Remove roadmap skills" bullet
