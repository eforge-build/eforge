---
id: plan-02-consumer-surfaces-and-docs
name: Consumer Surfaces and Documentation
branch: add-profile-support-to-playbook-frontmatter/plan-02-consumer-surfaces-and-docs
---

# Consumer Surfaces and Documentation

## Architecture Context

`AGENTS.md` requires Claude plugin and Pi integration parity for consumer-facing behavior. After the core layer accepts and propagates playbook/session-plan profile metadata, the CLI playbook UX, MCP proxy, Pi extension, skills, and docs must expose the field consistently and avoid the stale `agentRuntime` playbook key.

## Implementation

### Overview

Update structured playbook save/edit/new/list surfaces to preserve and display optional `profile`, replace stale `agentRuntime` playbook schema entries with `profile`, and document precedence and planning inheritance. Update both Pi and Claude skills so create/edit flows ask about optional runtime profile and planning-mode playbook runs pass `agent_profile` into session-plan creation.

### Key Decisions

1. Do not add a run-time playbook profile override; the persisted playbook field is the new user-facing capability.
2. Structured save schemas accept `profile?: string`; `agentRuntime` is removed from playbook schemas unless a compatibility alias is needed during implementation.
3. Skills present an explicit blank/default option: leaving playbook `profile` empty uses existing profile-router, active-profile, and default resolution.
4. Documentation describes execution-time validation and explicit override precedence for session-plan builds.

## Scope

### In Scope

- CLI `eforge playbook new/edit/list/show` preservation and display of playbook `profile`.
- Optional `--profile <name>` for `eforge playbook new` to create profiled playbooks non-interactively.
- MCP proxy and Pi native tool playbook schemas using `profile?: string` rather than `agentRuntime`.
- Pi native playbook overlays displaying profile where a natural listing/detail line already exists.
- Pi and Claude playbook skills asking for optional runtime profile during create/edit.
- Pi and Claude planning skills carrying a selected planning-mode playbook's `profile` into `eforge_session_plan create` / `mcp__eforge__eforge_session_plan` as `agent_profile`.
- Project and public docs/reference artifacts for playbook `profile`, session-plan `agent_profile`, precedence, and validation timing.
- Plugin version bump.

### Out of Scope

- No profile picker for `eforge playbook run`.
- No changes to profile creation flows except explanatory cross-links if needed.
- No new scheduling or router mechanism.

## Files

### Create

- None expected.

### Modify

- `packages/eforge/src/cli/playbook.ts` — include both required `mode` and optional `profile` in `playbookDataToRaw()`; preserve parsed or existing `mode` and `profile` during edit-save; add `--profile <name>` to `playbook new` and include it in structured save frontmatter when non-empty; keep run command request shape unchanged.
- `packages/eforge/src/cli/display.ts` — include a compact profile indicator in playbook list output when `pb.profile` exists, without hiding source or description.
- `packages/eforge/src/cli/mcp-proxy.ts` — replace playbook `frontmatter.agentRuntime` with `frontmatter.profile`; add `agent_profile` to session-plan create tool schema/handler if plan 01 adds the route field; update tool descriptions to mention playbook profile and session-plan inheritance.
- `packages/pi-eforge/extensions/eforge/index.ts` — mirror MCP proxy schema changes for `eforge_playbook` and `eforge_session_plan`; update native result/list rendering to include `profile` when returned.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — include profile in overlay labels/descriptions/details where playbook entries are shown; when delegating planning-mode run to the skill, no run profile override is added.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — document optional `profile` frontmatter; update create/edit flow to ask for it; update save payload examples; update planning-mode run flow to pass `agent_profile` when creating the session plan; explain blank profile fallback and precedence.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — when starting from a planning-mode playbook, propagate the playbook `profile` into session-plan `agent_profile` and mention it in the session summary.
- `eforge-plugin/skills/playbook/playbook.md` — mirror the Pi playbook skill changes with MCP tool names.
- `eforge-plugin/skills/plan/plan.md` — mirror the Pi planning skill changes with MCP tool names.
- `eforge-plugin/.claude-plugin/plugin.json` — bump patch version because plugin skill files change.
- `docs/config.md` — document playbook `profile`, session-plan `agent_profile`, precedence, and validation timing in the playbook configuration section.
- `web/content/docs/glossary.md` and/or `web/content/docs/configuration.md` — add public-facing explanation for playbook profiles and planning inheritance.
- `web/content/reference/cli.md`, `web/content/reference/tools.md`, `web/content/reference/api.md`, `web/content/reference/config.md` — regenerate or update reference artifacts so CLI options and tool descriptions match implementation.
- `packages/docs-gen/src/generators/*` or docs manifest files — update only if generated references are sourced from generator code rather than direct markdown edits.
- `test/cli-playbook.test.ts` — add `new --profile`, edit round-trip preserving `mode` and `profile`, and list rendering assertions.
- `test/pi-playbook-commands.test.ts` or a new nearby test — assert Pi playbook labels/details include profile and planning-mode delegation remains a skill handoff.
- Skill parity tests covered by `pnpm test` — update expected text only if the parity script snapshots wording.

## Verification

- [ ] `eforge playbook new --scope project-team --name docs-sync --description "Docs sync" --profile docs-heavy` calls `apiPlaybookSave()` with `frontmatter.profile === 'docs-heavy'` and a non-empty required `frontmatter.mode`.
- [ ] `eforge playbook edit my-pb` writes a temporary raw file containing both `mode:` and `profile: docs-heavy` when the loaded playbook has that field.
- [ ] Editing a profiled playbook and saving without changing the frontmatter sends the existing `frontmatter.mode` and `frontmatter.profile === 'docs-heavy'` to `apiPlaybookSave()`.
- [ ] `eforge_playbook` schemas in both `packages/eforge/src/cli/mcp-proxy.ts` and `packages/pi-eforge/extensions/eforge/index.ts` contain `profile` and do not contain playbook `agentRuntime`.
- [ ] Pi and Claude playbook skill files both instruct Create/Edit flows to ask for optional profile and to leave it blank for router/active-profile defaults.
- [ ] Pi and Claude planning/playbook skill files both pass `agent_profile` when a planning-mode playbook with `profile` creates a session plan.
- [ ] Plugin version in `eforge-plugin/.claude-plugin/plugin.json` changes from `0.25.15` to the next patch value.
- [ ] `docs/config.md` and public docs mention playbook `profile`, session-plan `agent_profile`, explicit override precedence, and execution-time validation.
- [ ] `pnpm docs:check` reports no generated reference drift.
