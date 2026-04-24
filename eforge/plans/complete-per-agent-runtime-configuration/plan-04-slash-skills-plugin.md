---
id: plan-04-slash-skills-plugin
name: Slash Command Rename + Init Skill Update + Plugin Version Bump
depends_on:
  - plan-03-profile-loader-mcp
branch: complete-per-agent-runtime-configuration/slash-skills-plugin
agents:
  builder:
    effort: high
    rationale: Cross-surface parity (Claude Code plugin + Pi skill) with the parity
      checker enforcing sync. Includes skill file rewrites to use the new
      agentRuntimes shape in init scaffolding.
---

# Slash Command Rename + Init Skill Update + Plugin Version Bump

## Architecture Context

Two consumer-facing surfaces must stay in sync: `eforge-plugin/skills/` (Claude Code) and `packages/pi-eforge/skills/` (Pi). `scripts/check-skill-parity.mjs` enforces this and runs as part of `pnpm test`. The slash commands currently named `/eforge:backend` and `/eforge:backend-new` rename to `/eforge:profile` and `/eforge:profile-new` respectively.

The init skill also needs to scaffold configs using the new `agentRuntimes:` + `defaultAgentRuntime:` shape and write profile files to `eforge/profiles/` with an `.active-profile` marker, and its success message references the new slash commands.

All changes here require a plugin version bump per project convention.

## Implementation

### Overview

1. Rename skill directories in both surfaces: `backend/` -> `profile/`, `backend-new/` -> `profile-new/`.
2. Rewrite skill markdown to reference `/eforge:profile` and `/eforge:profile-new` commands, `eforge/profiles/` directory, and `.active-profile` marker.
3. Update skill registration in `eforge-plugin/.claude-plugin/plugin.json`.
4. Rewrite the init skill (both surfaces) to scaffold the new config shape.
5. Sweep all other skill files for stale `/eforge:backend` references (config/config.md is flagged with ~18 occurrences in the original plan-05 doc) and update them.
6. Bump plugin version `0.7.1` -> `0.8.0`.

### Key Decisions

1. **Skill directory renames via git mv** so history is preserved.
2. **Parity checker must pass.** Any skill added/renamed on one side must mirror on the other. The script runs as part of `pnpm test`.
3. **Init skill scaffold uses `agentRuntimes:` + `defaultAgentRuntime:` at the top level**, writes profile files to `eforge/profiles/`, and the marker file is `.active-profile`. Success message text references `/eforge:profile` and `/eforge:profile-new`.
4. **Plugin version bump is required** per the project convention: any plugin change bumps `eforge-plugin/.claude-plugin/plugin.json`.

## Scope

### In Scope

- `eforge-plugin/skills/backend/` -> `eforge-plugin/skills/profile/` rename and content rewrite.
- `eforge-plugin/skills/backend-new/` -> `eforge-plugin/skills/profile-new/` rename and content rewrite.
- `packages/pi-eforge/skills/eforge-backend/` -> `packages/pi-eforge/skills/eforge-profile/` mirror rename.
- `packages/pi-eforge/skills/eforge-backend-new/` -> `packages/pi-eforge/skills/eforge-profile-new/` mirror rename.
- `eforge-plugin/.claude-plugin/plugin.json` skill registration updates + version bump.
- `eforge-plugin/skills/init/init.md` rewrite for new scaffold shape.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` rewrite for new scaffold shape.
- Sweep of other skill files (e.g. `eforge-plugin/skills/config/config.md`, its Pi mirror, and any other skill referencing `/eforge:backend`) and update to `/eforge:profile`.

### Out of Scope

- HTTP route rename and DAEMON_API_VERSION bump (plan-05).
- Documentation sweep in README/AGENTS.md (plan-06).
- CHANGELOG.md (release-flow-owned).
- `packages/pi-eforge/package.json` version (untouched per convention).

## Files

### Create

- `eforge-plugin/skills/profile/` (directory; rename from `backend/`).
- `eforge-plugin/skills/profile-new/` (directory; rename from `backend-new/`).
- `packages/pi-eforge/skills/eforge-profile/` (directory; rename from `eforge-backend/`).
- `packages/pi-eforge/skills/eforge-profile-new/` (directory; rename from `eforge-backend-new/`).

### Modify

- `eforge-plugin/.claude-plugin/plugin.json` - update skill registrations to `profile` and `profile-new`; bump version from `0.7.1` to `0.8.0`.
- `eforge-plugin/skills/profile/SKILL.md` (and any files inside) - rewrite command references to `/eforge:profile`, directory references to `eforge/profiles/`, marker to `.active-profile`.
- `eforge-plugin/skills/profile-new/SKILL.md` (and any files inside) - rewrite command references to `/eforge:profile-new`; config shape uses `agentRuntimes:` + `defaultAgentRuntime:`.
- `packages/pi-eforge/skills/eforge-profile/SKILL.md` (and any files inside) - mirror of the Claude Code version.
- `packages/pi-eforge/skills/eforge-profile-new/SKILL.md` (and any files inside) - mirror.
- `eforge-plugin/skills/init/init.md` - scaffold emits `agentRuntimes:` + `defaultAgentRuntime:` at the top level, writes profiles to `eforge/profiles/`, uses `.active-profile`, success message references `/eforge:profile` and `/eforge:profile-new`.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` - same updates mirrored.
- `eforge-plugin/skills/config/config.md` - sweep ~18 `/eforge:backend` references to `/eforge:profile`.
- Any other skill file in `eforge-plugin/skills/` or `packages/pi-eforge/skills/` that references `/eforge:backend`, `eforge/backends/`, or `.active-backend` - update all (discover via grep).

## Verification

- [ ] `pnpm test` exits 0 (includes `node scripts/check-skill-parity.mjs`).
- [ ] `grep -rn "/eforge:backend\\|eforge_backend\\|eforge/backends\\|\\.active-backend" eforge-plugin/skills/ packages/pi-eforge/skills/` returns zero matches.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version field equals `0.8.0`.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` skill registrations list `profile` and `profile-new`, not `backend` and `backend-new`.
- [ ] Init skill scaffold sections include `agentRuntimes:` and `defaultAgentRuntime:` as top-level config keys and reference `eforge/profiles/` as the profile directory.
- [ ] Init skill success message text includes the literal strings `/eforge:profile` and `/eforge:profile-new`.
