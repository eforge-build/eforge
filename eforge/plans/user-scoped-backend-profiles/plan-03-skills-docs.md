---
id: plan-03-skills-docs
name: Skills, Documentation, and Plugin Version Bump
depends_on:
  - plan-01-core-engine
branch: user-scoped-backend-profiles/skills-docs
---

# Skills, Documentation, and Plugin Version Bump

## Architecture Context

Plans 01 and 02 implement user-scoped backend profiles in the engine, daemon, MCP proxy, and Pi extension. This plan updates all skill files, docs, and the plugin version to reflect the new capability. Per AGENTS.md, the plugin version must be bumped when anything in the plugin changes.

## Implementation

### Overview

Update 6 skill files (3 plugin + 3 Pi mirror), the backend profiles section of `docs/config.md`, and bump the plugin version. All changes are documentation/content - no code logic changes.

### Key Decisions

1. **Skills document scope as first-class** - The `backend` skill list output gains a Scope column. The `backend-new` skill gains Step 0: Ask Scope before collecting backend kind and models.
2. **5-step precedence is documented in both skills and docs** - Users and agents both need to understand resolution order.
3. **Init skills get a one-liner** - Just a mention of `~/.config/eforge/backends/` as an alternative, not a full explanation.

## Scope

### In Scope
- Plugin backend skill: scope column in list, precedence docs
- Plugin backend-new skill: Step 0 scope prompt
- Pi backend skill: mirror plugin changes
- Pi backend-new skill: mirror plugin changes
- Plugin init skill: one-liner about user-scope alternative
- Pi init skill: mirror
- `docs/config.md`: backend profiles subsection with precedence
- Plugin version bump in `plugin.json`

### Out of Scope
- Engine, daemon, MCP, Pi code changes (plans 01-02)
- Test changes (plans 01-02)

## Files

### Modify
- `eforge-plugin/skills/backend/backend.md` - Add a Scope column (`project` / `user`) to the list output format. Add a section documenting the 5-step resolution precedence: (1) project marker `eforge/.active-backend`, (2) project config `backend:` field, (3) user marker `~/.config/eforge/.active-backend`, (4) user config `~/.config/eforge/config.yaml` `backend:` field, (5) none. Note that `scope` parameter is available on `list`, `use`, `create`, `delete` actions. Mention that user entries shadowed by project profiles of the same name show `shadowedBy: project`.
- `eforge-plugin/skills/backend-new/backend-new.md` - Add **Step 0: Ask Scope** before the existing Step 1. This step prompts: "Where should this profile live? Project scope (`eforge/backends/`) or user scope (`~/.config/eforge/backends/`)?" Default: project. Pass the chosen scope to the `create` action.
- `packages/pi-eforge/skills/eforge-backend/SKILL.md` - Mirror the plugin backend skill changes: scope column in list output, precedence documentation, scope parameter notes. Use bare tool names (not `mcp__eforge__` prefix) per Pi convention.
- `packages/pi-eforge/skills/eforge-backend-new/SKILL.md` - Mirror the plugin backend-new skill changes: Step 0 scope prompt before existing steps.
- `eforge-plugin/skills/init/init.md` - Add a one-liner in the backend profile setup section noting that profiles can also be created at user scope (`~/.config/eforge/backends/`) for reuse across projects, and pointing at `/eforge:backend:new` which prompts for scope.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` - Mirror the init skill one-liner about user-scope profiles.
- `docs/config.md` - Add a new `## Backend Profiles` section after the existing `## Pi Backend` section (there is no existing backend-profiles section; `## Profiles` at line 228 covers workflow profiles, not backend profiles). Title the subsection "User-Scoped Profiles" and explain: user profiles live at `~/.config/eforge/backends/*.yaml`, the user marker lives at `~/.config/eforge/.active-backend`, the 5-step resolution precedence, and that project profiles shadow user profiles of the same name. Include the `scope` parameter on `create`, `use`, `delete` operations.
- `eforge-plugin/.claude-plugin/plugin.json` - Bump version from `0.5.27` to `0.5.28`.

## Verification

- [ ] `eforge-plugin/skills/backend/backend.md` contains the word "Scope" in the list output section and documents all 5 precedence steps
- [ ] `eforge-plugin/skills/backend-new/backend-new.md` contains "Step 0" or equivalent scope prompt before the existing name/kind steps
- [ ] `packages/pi-eforge/skills/eforge-backend/SKILL.md` contains the same scope column and precedence docs as the plugin skill
- [ ] `packages/pi-eforge/skills/eforge-backend-new/SKILL.md` contains the same scope prompt as the plugin skill
- [ ] `eforge-plugin/skills/init/init.md` contains `~/.config/eforge/backends/`
- [ ] `packages/pi-eforge/skills/eforge-init/SKILL.md` contains `~/.config/eforge/backends/`
- [ ] `docs/config.md` contains a "User-Scoped Profiles" subsection with the 5-step precedence list
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is `0.5.28`
- [ ] `pnpm type-check` passes (no code changes, but confirms nothing broke)
- [ ] `pnpm test` passes (wiring tests verify skill files exist and have expected frontmatter)