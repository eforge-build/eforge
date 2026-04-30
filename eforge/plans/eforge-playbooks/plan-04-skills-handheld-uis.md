---
id: plan-04-skills-handheld-uis
name: "Skills: /eforge:playbook handheld UX in Claude Code plugin and Pi extension"
branch: eforge-playbooks/skills
---

# Skills: /eforge:playbook handheld UX in Claude Code plugin and Pi extension

## Architecture Context

eforge ships two parallel skill surfaces that must stay in sync:
- Claude Code plugin: `eforge-plugin/skills/<name>/<name>.md` (e.g. `config/config.md`, `profile/profile.md`).
- Pi extension: `packages/pi-eforge/skills/eforge-<name>/SKILL.md` paired with `pi.registerCommand('eforge:<name>', ...)` in `packages/pi-eforge/extensions/eforge/index.ts`. Native command handlers live in modular files (e.g. `profile-commands.ts`, `config-command.ts`).

This plan delivers the documented user-facing surface from the PRD: a no-args `/eforge:playbook` menu with branches Create / Edit / Run / List / Promote (and Demote), with intelligent scope classification on Create, conversational wait-for-build on Run, and section-by-section walk-throughs on Edit. Both surfaces invoke the daemon via the `eforge_playbook` MCP tool (Claude Code) or the Pi command handler (Pi), both shipped in plan-02 and this plan respectively.

## Implementation

### Overview

1. **Claude Code skill** — `eforge-plugin/skills/playbook/playbook.md` with frontmatter (`name`, `description`) and a body that documents the handheld flow:
   - **No-args menu** — list of branches gated by context: when no playbooks exist, only Create is shown; when no in-flight builds exist, the Run branch skips its wait-for-build prompt; when no `.eforge/playbooks/*.md` exists, Promote is hidden.
   - **Branch: Create** — interactive author flow. Asks the user what the recurring workflow is, applies the **Intelligent scope classification** decision flow from the PRD (project-bound vs cross-project + shared vs personal), drafts the playbook in the inferred tier, confirms before writing, and calls `eforge_playbook { action: 'save', scope, playbook }`. On entry from a mid-conversation `/eforge:plan`, accepts the in-progress plan as the draft starting point. Documents the explicit decision flow (steps 1-5 from PRD) inline so the model can follow it without prompt drift, and documents the target ≥80% no-prompt rate for the first-author case.
   - **Branch: Edit** — calls `eforge_playbook { action: 'list' }`, prints numbered list with `[source]` labels and shadow notices, awaits user numeric pick (never asks for a name), walks through `## Goal`, `## Out of scope`, `## Acceptance criteria`, `## Notes for the planner` section-by-section, confirms before save, and calls `save`. When the picked playbook is shadowed, offers a copy-and-edit at the more specific tier as an alternative path.
   - **Branch: Run** — lists playbooks (numbered), user picks; calls `eforge_status` (existing tool) to discover in-flight builds; if any are running, lists them by title and offers to wait or run now; if user picks wait and there is one match, resolves the title to the queue id internally and calls `eforge_playbook { action: 'enqueue', name, afterQueueId }`; on multi-match, asks the user to pick; if no builds are active, enqueues immediately. The user never types or sees a queue id.
   - **Branch: List** — read-only formatted listing with source labels and full shadow chains.
   - **Branch: Promote / Demote** — lists project-local playbooks (Promote) or project-team playbooks (Demote), user picks numerically, skill calls the corresponding `eforge_playbook` action and reports the destination path. Mentions the trade-off about losing automatic team-side improvements when shadowing (per the PRD storage trade-off note).
   - **Power-user shortcuts** — documents that `/eforge:playbook run docs-sync` and similar direct invocations jump into the relevant branch with the named item pre-selected, but still confirm and offer handheld follow-ons (e.g. wait-for-build).
   - **Validation** — every save path passes through `eforge_playbook { action: 'validate' }` first; failures are surfaced verbatim and the user is asked to fix.
2. **Pi skill** — `packages/pi-eforge/skills/eforge-playbook/SKILL.md` mirrors the same content adapted to Pi's overlay/menu primitives. References the Pi command `eforge:playbook` for the native menu surface.
3. **Pi command handler** — `packages/pi-eforge/extensions/eforge/playbook-commands.ts` exporting `handlePlaybookCommand(pi, ctx, args, ...)` that:
   - Renders the no-args menu via Pi's overlay helpers (mirrors `handleProfileCommand`).
   - Branches to action handlers that call the same client helpers used by the CLI in plan-03.
   - Implements the conversational wait-for-build matcher (calls `apiQueueList`, filters running entries, presents by title, resolves to queue id internally).
   - Implements the section-by-section Edit walk via Pi prompts.
4. **Pi command registration** — register `pi.registerCommand('eforge:playbook', { description: '...', handler: handlePlaybookCommand })` in `packages/pi-eforge/extensions/eforge/index.ts` next to `eforge:profile`.
5. **Cross-references** — both skills reference each other and the existing `/eforge:plan` skill for the "save in-progress plan as a playbook" entry. The `/eforge:plan` skill is updated minimally to link out to `/eforge:playbook` Create from a mid-conversation save (no behavior change beyond a hand-off note).

### Intelligent Scope Classification (encoded in the skill body)

The Create branch implements the PRD's documented decision flow verbatim:

1. **Project-bound vs cross-project signals** — explicit paths, package names, repo-specific tooling/scripts, repo's domain language ⇒ project-bound. Generic vocabulary, convention-based references, no project-specific names ⇒ cross-project.
2. **Shared vs personal signals** (only relevant if project-bound) — neutral phrasing, team conventions ⇒ shared. First-person ownership, "don't share"/"private"/"draft"/"experimental", references to sensitive content ⇒ personal.
3. **Decision matrix** — cross-project + clean ⇒ user (`~/.config/eforge/playbooks/`); project-bound + neutral ⇒ project-team (`eforge/playbooks/`); project-bound + personal ⇒ project-local (`.eforge/playbooks/`); mixed/weak signals ⇒ ask the user with the strongest evidence presented and a default offered.
4. **The skill never asks "where should I save this?" by default.** Classification is the skill's job; team-vs-local is asked only when the personal-cue dimension is unclear.

### Key Decisions

1. **Two parallel skill files, one shared MCP tool.** Both surfaces talk to the same `eforge_playbook` MCP tool / client helpers, eliminating drift risk in business logic. UX divergence is bounded to presentation.
2. **Numeric pick, never name typing.** Every branch produces a numbered menu of available items with source labels; the user picks a number. This is the per-feedback handheld convention used by the rest of the eforge skills.
3. **Conversational title-to-id resolution.** The user only ever sees build titles; queue ids are resolved internally. Prevents copy-paste errors and matches the PRD acceptance criterion explicitly.
4. **Power-user shortcuts are accepted but not documented as the primary surface.** The skill body lists them as a convenience layer per the PRD; documentation emphasizes the no-args menu.

## Scope

### In Scope
- Claude Code skill at `eforge-plugin/skills/playbook/playbook.md`.
- Pi skill at `packages/pi-eforge/skills/eforge-playbook/SKILL.md`.
- Pi command handler `handlePlaybookCommand` and `eforge:playbook` registration.
- Section-by-section Edit, scope classification on Create, conversational wait-for-build on Run, Promote/Demote with shadow notices.
- Mid-`/eforge:plan` hand-off into Create.
- Power-user shortcut acceptance (`/eforge:playbook run <name>` etc.).

### Out of Scope
- Daemon/HTTP/MCP tool implementation (plan-02).
- CLI scriptable surface (plan-03).
- Piggyback scheduling and indented queue display (plan-05; this plan's Run branch enqueues with `dependsOn` set, but upstream-completion-driven firing is plan-05).

## Files

### Create
- `eforge-plugin/skills/playbook/playbook.md` — Claude Code skill body with frontmatter, no-args menu, branches, scope classification flow, validation handling, power-user shortcut notes.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — Pi skill mirroring the Claude Code content, adapted to Pi conventions.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — `handlePlaybookCommand` and supporting branch handlers; uses `apiPlaybook*` helpers from `@eforge-build/client`.

### Modify
- `packages/pi-eforge/extensions/eforge/index.ts` — register `eforge:playbook` Pi command pointing at `handlePlaybookCommand`. Import the new handler module.
- `packages/pi-eforge/skills/eforge-plan/SKILL.md` — add a hand-off note instructing the model to invoke `/eforge:playbook` (Create branch) when the user asks to save the in-progress plan as a playbook draft.
- `eforge-plugin/skills/plan/plan.md` (if it exists at this path; otherwise the equivalent Claude Code plan skill) — same hand-off note.
- `eforge-plugin/.claude-plugin/plugin.json` — bump plugin version per AGENTS.md rule ("Always bump the plugin version when changing anything in the plugin").

## Verification

- [ ] `pnpm type-check` passes after the new Pi handler is added.
- [ ] `pnpm test` passes; if existing skill-shape tests run for `config`/`profile`, equivalents for `playbook` are added or the existing test loops over the new file.
- [ ] `/eforge:playbook` with no args lists Create / Edit / Run / List / Promote / Demote, hiding branches whose preconditions are not met (no playbooks ⇒ only Create; no project-local playbooks ⇒ no Promote).
- [ ] Create branch follows the documented scope-classification decision flow and only prompts the user when signals are mixed; the skill body documents an explicit target ≥80% no-prompt rate for first-author cases.
- [ ] Create branch can be entered from a mid-conversation `/eforge:plan` and accepts the in-progress plan as a draft starting point.
- [ ] Edit branch lists playbooks numerically with `[source]` and shadow chain labels, walks through each section, confirms before save, and offers copy-and-edit at a more specific tier when a shadowed playbook is selected.
- [ ] Run branch lists running builds by title and resolves the user's pick to a queue id internally; the user never types or sees a queue id.
- [ ] Promote branch moves a `.eforge/playbooks/<name>.md` file to `eforge/playbooks/<name>.md` (via daemon `apiPlaybookPromote`) and surfaces the staging step.
- [ ] Power-user shortcut `/eforge:playbook run docs-sync` jumps to the Run branch with `docs-sync` pre-selected and still offers wait-for-build when applicable.
- [ ] Save paths reject invalid edits with the daemon's validation errors verbatim, leaving the on-disk file unchanged.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is bumped.
- [ ] Pi `eforge:playbook` command appears in the Pi command list and opens the same handheld surface.
