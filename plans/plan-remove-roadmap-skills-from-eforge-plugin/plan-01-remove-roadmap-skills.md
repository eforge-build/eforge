---
id: plan-01-remove-roadmap-skills
name: Remove Roadmap Skills from Eforge Plugin
depends_on: []
branch: plan-remove-roadmap-skills-from-eforge-plugin/remove-roadmap-skills
---

# Remove Roadmap Skills from Eforge Plugin

## Architecture Context

The eforge plugin bundles roadmap-related skills that don't belong in a plan-build-review tool. This plan removes them to keep the plugin focused on its core purpose.

## Implementation

### Overview

Delete 4 roadmap skill directories and 1 spec file, then update plugin.json (commands, description, version), CLAUDE.md, and docs/roadmap.md to remove all roadmap skill references.

### Key Decisions

1. Bump plugin version to `1.6.0` (minor bump since we're removing features, not breaking the API)
2. Remove the "Remove roadmap skills" bullet from roadmap.md since this work will have shipped

## Scope

### In Scope
- Delete `eforge-plugin/skills/roadmap-policy/`, `eforge-plugin/skills/roadmap/`, `eforge-plugin/skills/roadmap-init/`, `eforge-plugin/skills/roadmap-prune/`
- Delete `eforge-plugin/roadmap-skills-spec.md`
- Update `eforge-plugin/.claude-plugin/plugin.json`: remove 3 roadmap commands, update description, bump version to `1.6.0`
- Update `CLAUDE.md` line 86: remove "roadmap" from the eforge-plugin comment
- Update `docs/roadmap.md` line 34: remove the "Remove roadmap skills" bullet
- Update `README.md`: remove 3 roadmap skill rows from the commands table

### Out of Scope
- Moving roadmap skills to a separate plugin (not requested)

## Files

### Delete
- `eforge-plugin/skills/roadmap-policy/` — Roadmap governance policy skill
- `eforge-plugin/skills/roadmap/` — Roadmap management skill
- `eforge-plugin/skills/roadmap-init/` — Roadmap initialization skill
- `eforge-plugin/skills/roadmap-prune/` — Roadmap pruning skill
- `eforge-plugin/roadmap-skills-spec.md` — Roadmap skills specification

### Modify
- `eforge-plugin/.claude-plugin/plugin.json` — Remove 3 roadmap commands from `commands` array, update `description` to remove "roadmap management" language, bump `version` to `1.6.0`
- `CLAUDE.md` — Change eforge-plugin comment from `(skills for enqueue, run, status, config, roadmap)` to `(skills for enqueue, run, status, config)`
- `docs/roadmap.md` — Remove the "Remove roadmap skills" bullet (line 34)
- `README.md` — Remove the 3 roadmap skill rows from the commands table (lines 102-104: `/eforge:roadmap`, `/eforge:roadmap-init`, `/eforge:roadmap-prune`)

## Verification

- [ ] `pnpm build` exits 0
- [ ] `pnpm test` exits 0
- [ ] `eforge-plugin/.claude-plugin/plugin.json` is valid JSON
- [ ] `plugin.json` contains no command paths referencing `roadmap-init`, `roadmap.md` (as a command), or `roadmap-prune`
- [ ] `plugin.json` version field is `1.6.0`
- [ ] `plugin.json` description field does not contain the string "roadmap"
- [ ] `grep -r "roadmap-policy\|roadmap-init\|roadmap-prune\|roadmap-skills-spec" eforge-plugin/` returns no results
- [ ] `CLAUDE.md` line describing `eforge-plugin/` does not contain "roadmap"
- [ ] `docs/roadmap.md` does not contain "Remove roadmap skills"
- [ ] `README.md` does not contain `/eforge:roadmap-init`, `/eforge:roadmap-prune`, or `/eforge:roadmap` command table rows
- [ ] Directories `eforge-plugin/skills/roadmap-policy/`, `eforge-plugin/skills/roadmap/`, `eforge-plugin/skills/roadmap-init/`, `eforge-plugin/skills/roadmap-prune/` do not exist
- [ ] File `eforge-plugin/roadmap-skills-spec.md` does not exist
