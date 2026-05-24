---
id: plan-03-docs-and-generated-reference
name: Docs, Skills, Generated Config Reference, and Plugin Parity
branch: add-github-pr-auto-merge-option-for-eforge-builds-and-playbooks/plan-03-docs-and-generated-reference
---

# Docs, Skills, Generated Config Reference, and Plugin Parity

## Architecture Context

The feature changes user-facing behavior across Pi native commands, Claude Code plugin skills, CLI/MCP tools, and config reference output. `AGENTS.md` requires Pi and Claude Code plugin surfaces to stay in sync for consumer-facing behavior, and plugin changes require a plugin version bump.

## Implementation

### Overview

Update generated config reference content, skill docs, config/init guidance, and plugin metadata to document the distinct GitHub PR auto-merge option. Regenerate reference artifacts after updating the docs generator and engine schema.

### Key Decisions

1. Documentation must describe GitHub PR auto-merge as a PR post-creation option, not as `landing.action: merge`.
2. Skill docs must preserve omission semantics: project default means no `landingAction` and no `landingAutoMerge` keys are sent.
3. Config docs must show `landing.pr.autoMerge: ask | always | never` and explicitly state the default is `ask`.
4. Bump only `eforge-plugin/.claude-plugin/plugin.json`; do not bump `packages/pi-eforge/package.json`.

## Scope

### In Scope

- Generated config reference generator updates and regenerated artifacts.
- Pi skill docs for build, playbook, config, and init flows.
- Claude Code plugin skill docs for build, playbook, config, and init flows.
- Plugin version bump.
- Skill parity check fixes if the parity script requires mirrored wording/sections.

### Out of Scope

- Runtime code changes beyond docs generator and plugin metadata.
- Roadmap changes unless the implementation leaves future work explicitly out of scope.

## Files

### Create

- None expected.

### Modify

- `packages/docs-gen/src/generators/config.ts` — document `landing.pr.autoMerge`, policy meanings, per-run override field names, and the distinction from local/direct `landing.action: merge`.
- `docs/config.md` — regenerated config reference output.
- `web/public/schemas/config.schema.json` — regenerated JSON schema output from `pnpm docs:generate`.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — document `--landing-auto-merge`, `--no-landing-auto-merge`, selector options, and request/body omission semantics.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — document autonomous run selector choices and preservation of `landingAutoMerge` in immediate, delayed, and fallback enqueue calls.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — document `landing.pr.autoMerge` and its enum values.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` — update initial landing configuration guidance to include optional PR auto-merge policy selection.
- `eforge-plugin/skills/build/build.md` — mirror build behavior and fields for Claude Code plugin skill usage.
- `eforge-plugin/skills/playbook/playbook.md` — mirror playbook run behavior and fields.
- `eforge-plugin/skills/config/config.md` — mirror config documentation.
- `eforge-plugin/skills/init/init.md` — mirror init guidance.
- `eforge-plugin/.claude-plugin/plugin.json` — bump plugin version by one patch version.

## Verification

- [ ] `pnpm docs:generate` updates `docs/config.md` and `web/public/schemas/config.schema.json` with `landing.pr.autoMerge`.
- [ ] `pnpm docs:check` exits 0 after generated artifacts are committed.
- [ ] `node scripts/check-skill-parity.mjs` exits 0 after Pi and Claude Code skill docs are updated.
- [ ] Plugin metadata version changes from `0.25.28` to a later patch version.
- [ ] Skill docs mention `landingAutoMerge` for tool/request bodies and `--landing-auto-merge` / `--no-landing-auto-merge` for CLI-style arguments.
