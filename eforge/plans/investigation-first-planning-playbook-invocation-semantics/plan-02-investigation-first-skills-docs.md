---
id: plan-02-investigation-first-skills-docs
name: Investigation-First Skills and Documentation
branch: investigation-first-planning-playbook-invocation-semantics/plan-02-investigation-first-skills-docs
agents:
  builder:
    effort: high
    rationale: "The work is documentation-heavy but semantically important: Pi and
      Claude skill instructions must stay in parity and must prevent agents from
      falling back to static playbook seeding."
  reviewer:
    effort: high
    rationale: Review must compare Pi and Claude instructions for parity and ensure
      the new investigation-first flow is explicit enough for agent execution.
---

# Investigation-First Skills and Documentation

## Architecture Context

After plan 01, the daemon no longer executes planning playbooks. The canonical planning-playbook runner is the conversational agent skill: it loads the playbook, performs the investigation described by the playbook, creates or updates a planning session with concrete findings, then continues `/eforge:plan` interactively. The Claude Code plugin and Pi extension must remain in sync for user-facing skills and tool descriptions.

## Implementation

### Overview

Update Pi and Claude skills plus user documentation so planning-mode playbooks are described and executed as investigation-first workflows. Remove static `create-from-playbook` from first-party happy paths while retaining it as a low-level scratch/template helper if the route still exists.

### Key Decisions

1. The playbook Run branch loads/shows the playbook before deciding execution mode. Autonomous mode still calls `eforge_playbook { action: "run" }`; planning mode does not call daemon run except as a defensive fallback for stale instructions.
2. Planning-mode Run must perform the investigation in the agent conversation using ordinary read/bash/tool capabilities, then create a session plan with findings/action items via `eforge_session_plan { action: "create" }` plus `set-section` calls.
3. `/eforge:plan` path (c) changes from “Seed from a planning-mode playbook” to an investigation-first flow that loads a planning playbook, performs the recipe, and writes findings to a new session plan.
4. The retained `create-from-playbook` route is documented as static template/scratch seeding, not as running a planning playbook.
5. Bump the Claude plugin version because plugin skill files change. Do not bump the Pi package version.

## Scope

### In Scope

- Update Pi `eforge-playbook` and Claude playbook skill docs to make planning-mode Run investigation-first.
- Update Pi `eforge-plan` and Claude plan skill docs to replace static playbook seeding with investigation-first planning-playbook startup.
- Add explicit planning-playbook steps: show/load playbook, identify investigation commands/files/questions from Goal/Notes/Acceptance criteria, run the investigation, summarize evidence and findings, create a session plan, write concrete sections, and continue planning.
- Add defensive guidance for a `requires-agent` response from `eforge_playbook run`.
- Reword `create-from-playbook` mentions in skills/docs as static template/scratch-only if retained.
- Update README/docs/glossary/config text that currently says planning playbook run creates a session plan directly.
- Regenerate checked-in reference docs if tool/CLI descriptions changed in plan 01.
- Bump `eforge-plugin/.claude-plugin/plugin.json` patch version.

### Out of Scope

- Adding new playbook schema sections.
- Adding daemon-side exploration agents.
- Removing `create-from-playbook` from the daemon API.
- Changing build/session-plan readiness semantics.
- Bumping `packages/pi-eforge/package.json`.

## Files

### Create

None.

### Modify

- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — rewrite Playbook Modes and Run branch: autonomous calls daemon run; planning loads the playbook, investigates, creates/updates a session plan with findings/action items, and continues planning. Include fallback handling for `requires-agent`.
- `eforge-plugin/skills/playbook/playbook.md` — mirror the Pi playbook skill changes with MCP tool names.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — change path (c) from static `create-from-playbook` seeding to investigation-first planning-playbook startup; instruct use of `create` plus `set-section` for findings.
- `eforge-plugin/skills/plan/plan.md` — mirror the Pi plan skill changes with MCP tool names.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin patch version from `0.25.14` to `0.25.15` unless the current file has already advanced, in which case bump one patch level from the current value.
- `README.md` — update high-level playbook text so planning playbooks require interactive agent investigation before a session plan is populated.
- `docs/config.md` — update playbook command semantics and `eforge playbook run` description for `requires-agent`/interactive planning.
- `packages/input/README.md` — clarify that `playbookToPlanSeed`/`create-from-playbook` are static seed helpers and not the planning-playbook Run path.
- `web/content/docs/glossary.md` — update the `planning` playbook definition.
- `web/public/docs/glossary.md` — update the generated/public copy if this repository keeps it checked in separately.
- `web/content/reference/tools.md`, `web/public/reference/tools.md`, `web/content/reference/cli.md`, `web/public/reference/cli.md`, `web/public/llms-full.txt`, `web/public/llms.txt` — regenerate or update only the artifacts changed by `pnpm docs:generate` after source descriptions change.

## Verification

- [ ] Pi and Claude playbook skills both state that planning-mode Run does not call daemon run as the happy path.
- [ ] Pi and Claude playbook skills both instruct the agent to load/show the playbook, perform the investigation, create a session plan, write concrete findings/action items, and continue planning.
- [ ] Pi and Claude plan skills both remove `create-from-playbook` from the planning-playbook happy path.
- [ ] Retained `create-from-playbook` descriptions label it as static template/scratch seeding.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` has a patch version greater than the pre-change version.
- [ ] `pnpm docs:check-parity` passes for Pi and Claude skill parity.
- [ ] `pnpm docs:check` passes with no generated-reference drift.
