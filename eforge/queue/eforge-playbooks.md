---
title: eforge Playbooks
created: 2026-04-30
depends_on: ["revise-tmp-playbooks-md-to-describe-eforge-playbook-as-a-handheld-conversational-skill"]
---

# eforge Playbooks

## Problem / Motivation

Some categories of work that get sent to eforge are not feature work, but they share a recurring shape: similar prompting, similar scope hints, similar acceptance criteria. Examples:

- Tech debt cleanup (unused exports, dead code, stale TODOs)
- Documentation deep-dive / sync (regenerate API docs, audit README accuracy, refresh changelogs)
- Marketing-site updates after a feature ships (eforge's own marketing site is the motivating case)
- Dependency bumps + smoke validation
- Internal observability / instrumentation passes

Today, kicking off any of these requires re-articulating the same prompt and scope to `/eforge:plan`, even though the *change shape* is essentially identical run-to-run. That ad-hoc prompting:

1. **Wastes time on repeated articulation.** The friction is small per-instance but compounds; users avoid recurring hygiene work because spinning it up costs as much as the work itself.
2. **Clutters feature work.** When the user wants a feature build to also trigger doc sync or a marketing-site update, the temptation is to bolt those into the feature's plan, which dilutes scope and makes review harder.
3. **Resists scheduling.** Without a named, addressable workflow, there is nothing to point a scheduler or post-merge hook at.

A playbook is a **named, reusable, templatized session plan** for a recurring workflow. It lives alongside eforge config (user-level for cross-project patterns, project-level for project-specific recurring work) and is invokable as a one-line command. Playbooks live in eforge's **human-driven planning layer** (Layer 1 in the driver-tui PRD's terminology); the planner | builder | reviewer execution layer downstream is unchanged.

## Goal

Codify recurring change shapes once and fire them in one command, with three first-class storage scopes (user, project-team, project-local), intelligent scope classification, a handheld skill UX, and a piggyback primitive that lets a playbook fire after another build completes — all as a planning shortcut on top of the existing build pipeline, with no new execution layer.

## Approach

### Goals (design intents)

1. **Codify recurring change shapes once, fire them in one command.** A playbook's prompt + scope hints + acceptance criteria are written once and reused.
2. **Three scopes, all first-class.** User-level (cross-project, personal) lives in `~/.config/eforge/playbooks/`. Project-team (project-specific, shared with team) lives in `eforge/playbooks/` (checked in). Project-local (project-specific, personal to this user on this repo) lives in `.eforge/playbooks/` (gitignored). Precedence is most-specific wins: project-local → project-team → user.
3. **Piggyback as a primitive.** A playbook can be queued to fire after another build completes successfully, with the upstream build identified conversationally by title — never by queue id — without cluttering that build's plan. This is the workflow that other tools don't have and that earns the feature its keep.
4. **Handheld skill UX.** The slash command with no arguments presents a menu of branches (create / edit / run / list / promote). Every branch lists available items by name with source labels so the user picks from a list rather than typing names or ids. Implemented as a Claude Code plugin skill (`/eforge:playbook`) and pi-eforge extension equivalent.
5. **Intelligent scope classification.** When authoring a new playbook, the skill infers whether the proposed playbook is generic enough to be user-level or specific enough to be project-level, and only asks the user for guidance when the classification is ambiguous.
6. **No new execution layer.** A playbook is a planning shortcut. Once invoked, it produces a session plan and hands off to the existing build pipeline (planner | builder | reviewer). No changes to the execution layer.
7. **Build on the shared three-tier config resolver.** Playbooks plug into the generalized resolver defined in [three-tier-config-resolver.md](./three-tier-config-resolver.md) as a new `set` artifact kind. That PRD is a prerequisite — it generalizes the user / project-team / project-local pattern across all eforge config artifacts (config.yaml, profiles, playbooks, future additions) and is what makes `.eforge/playbooks/` a first-class location alongside `.eforge/config.yaml` and `.eforge/profiles/`.

### Storage

Playbooks live in three tiers, mirroring eforge's existing `eforge/` (checked in) vs `.eforge/` (gitignored) convention:

| Scope | Path | Visibility | Notes |
|---|---|---|---|
| User | `~/.config/eforge/playbooks/<name>.md` | Personal, cross-project | Travels with the user across every repo. |
| Project-team | `eforge/playbooks/<name>.md` | Shared, checked in | The team-canonical playbook set for this repo. |
| Project-local | `.eforge/playbooks/<name>.md` | Personal, this repo only, gitignored | Personal overrides, in-progress drafts, sensitive content. |

#### User-level
Patterns that span every project the user touches.
- "My personal tech debt sweep" — refined for the user's coding style, reused across all repos.
- "Update CHANGELOG.md from recent commits" — pattern-based, reads any repo's git history.
- "Audit README freshness" — works wherever a `README.md` exists.

#### Project-team (checked in)
Project-specific patterns the team agrees on.
- "Update marketing site after eforge feature" — references `apps/site/` paths specific to this repo.
- "Regenerate API docs from `packages/engine/src/`" — bound to this repo's structure.
- Anything that mentions specific filenames, package names, or repo-shape assumptions, and that the team should share.

#### Project-local (gitignored)
Project-specific but personal — useful when the user wants this playbook to apply to *this* repo without committing it for teammates.

Use cases:
- **Iterating before promoting.** Author here, refine through use, then `mv` to `eforge/playbooks/` when the playbook earns its keep on the team.
- **Personal style overrides.** Team has `tech-debt-sweep.md` with their conventions; I drop my own `.eforge/playbooks/tech-debt-sweep.md` — mine wins for me, theirs stays canonical for everyone else.
- **OSS contributor without commit rights.** Can still author and run personal playbooks against the project.
- **Sensitive prompts.** References to internal-only tooling, customer names, or anything that shouldn't land in the repo.

#### Resolution / precedence

**Most specific wins:** project-local → project-team → user.

- `eforge playbook list` shows the merged set with source labeled, e.g.:
  ```
  tech-debt-sweep      [project-local]  shadows project-team
  marketing-site-sync  [project-team]
  changelog-update     [user]
  ```
- Same pattern eforge already uses for profiles (`eforge/profiles/` shadows `~/.config/eforge/profiles/`); this PRD adds the project-local tier on top.

**Trade-off the user must accept:** a project-local playbook that shadows a project-team one will *not* automatically pick up team-side improvements. The shadow notice in `playbook list` makes this visible. Acceptable cost of explicit personal override; same trade-off as any local config layer.

### Playbook File Shape

A playbook is a Markdown file with YAML frontmatter:

```markdown
---
name: tech-debt-sweep
description: Hunt unused exports, dead branches, and stale TODOs across the active package.
scope: user            # 'user' | 'project-team' | 'project-local' — informational, must match storage location
agentRuntime: ~        # optional override; defaults to the project's defaultAgentRuntime
postMerge: ~           # optional override of post-merge commands for this playbook only
---

## Goal

Surface and remove dead code that has accumulated since the last sweep.

## Out of scope

Anything that requires a behavioral change. Refactors that touch tests are out of scope; defer those to a feature plan.

## Acceptance criteria

- [ ] All `// TODO(@me, <date>)` markers older than 30 days are either resolved or have a refreshed date.
- [ ] No unused exports detected by `tsc --noUnusedLocals` (or equivalent).
- [ ] Test suite still passes.

## Notes for the planner

Bias toward small, atomic commits per category (one for TODOs, one for unused exports). Do not introduce new dependencies. Do not modify public API surfaces.
```

The body is the **prompt template** that gets fed to the planning step. The frontmatter is metadata.

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  storage tiers (precedence: local > team > user)         │
│   ~/.config/eforge/playbooks/<name>.md   (user)          │
│   eforge/playbooks/<name>.md             (project-team)  │
│   .eforge/playbooks/<name>.md            (project-local) │
└──────────────────┬───────────────────────────────────────┘
                   │ read/write
                   ▼
┌──────────────────────────────────────────────────────────┐
│  @eforge-build/engine  — playbook resolver               │
│   • list(): merged set with shadow tracking              │
│   • load(name): returns playbook from highest-precedence │
│     tier; reports shadowed-by relationships              │
│   • toSessionPlan(playbook): templatized plan ready to   │
│     hand to the existing planner agent                   │
└──────────────────┬───────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
┌────────────────┐   ┌────────────────────┐
│  CLI           │   │  Daemon HTTP       │
│  eforge play   │   │  POST /playbook/   │
│  eforge        │   │       enqueue      │
│   playbook     │   │                    │
│   list         │   │  (also: piggyback  │
│                │   │   relation tracked │
│                │   │   in queue state)  │
└────────┬───────┘   └─────────┬──────────┘
         │                     │
         ▼                     ▼
┌──────────────────────────────────────────────────────────┐
│  Authoring skills (read/write playbooks)                 │
│  • eforge-plugin/skills/playbook/  (Claude Code)         │
│  • packages/pi-eforge/skills/eforge-playbook/  (Pi)      │
└──────────────────────────────────────────────────────────┘
```

### Skills

Two new skills, parallel structure to the existing `config` / `eforge-config` pair:

- `eforge-plugin/skills/playbook/playbook.md` (Claude Code plugin)
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` (Pi extension)

Each skill exposes the slash command `/eforge:playbook`. Invoking it with no arguments presents a context-aware menu of branches; the user picks one and is walked through it. Every branch lists available items by name (with source labels for shadow tracking) so the user never has to type a playbook name or remember a queue id.

#### No-args menu

```
> /eforge:playbook
< What would you like to do with playbooks?
  1. Create a new playbook
  2. Edit an existing playbook (3 available)
  3. Run a playbook (3 available, 1 in-flight build to chain to)
  4. List all playbooks
  5. Promote a project-local playbook to project-team (1 candidate)
```

Branch availability is context-aware: if no playbooks exist, only **Create** is offered; if no in-flight builds are present, the **Run** branch skips its wait-for-build prompt.

#### Branch: Create

Interactive author mode. The skill asks the user what the recurring workflow is, classifies its scope (see **Intelligent scope classification** below), drafts the playbook file at the inferred tier, and confirms before writing. If the user is mid-conversation in `/eforge:plan` and asks to save the in-progress plan as a playbook, the Create branch enters with that plan as a draft starting point.

##### Intelligent scope classification

When the user describes a new playbook, the skill classifies it across two dimensions and only prompts when ambiguous.

**Dimension 1 — project-bound vs cross-project:**
- *Project-bound signals:* mentions specific paths (`apps/site/`, `packages/engine/src/`); package names from `package.json`/`Cargo.toml`; repo-specific tooling or scripts; this repo's domain language ("regenerate the eforge marketing CTAs").
- *Cross-project signals:* generic vocabulary ("update CHANGELOG.md", "audit README freshness", "sweep unused exports"); patterns that read by convention rather than path (anywhere a `tsconfig.json` exists, anywhere a `git log` exists); no project-specific names.

**Dimension 2 — shared vs personal (only relevant if project-bound):**
- *Shared signals (default for project-bound):* neutral phrasing, no first-person ownership, references to team conventions.
- *Personal signals:* first-person ownership cues ("my flow", "for me", "I want to"); mentions of "don't share" / "private" / "draft" / "experimental"; references to sensitive content (customer names, internal-only tooling, credentials-adjacent paths).

**Decision flow:**
1. **Cross-project + clean signals** → write to `~/.config/eforge/playbooks/`, tell the user the choice and why.
2. **Project-bound + neutral phrasing** → write to `eforge/playbooks/` (team default). Mention this is the team-shared location.
3. **Project-bound + personal cues** → write to `.eforge/playbooks/` (gitignored), tell the user it's kept local and that the **Promote** branch can move it to the team tier later.
4. **Mixed or weak signals** → ask the user, presenting the strongest evidence either direction. Default offered choice = team if project-bound, user if cross-project.
5. **User describes a generic workflow that names a specific project** → interpret as project-team; offer to also save a generic version to user-level.

The skill explicitly does **not** ask the user "where should I save this?" by default. The classification is the skill's job; team-vs-local is asked only when the personal-cue dimension is unclear.

#### Branch: Edit

The skill calls the resolver, lists every playbook with source labels, and the user picks by number:

```
< Pick a playbook to edit:
  1. tech-debt-sweep      [project-local]  shadows project-team
  2. marketing-site-sync  [project-team]
  3. changelog-update     [user]
```

After selection, the skill walks through edits section-by-section (goal, out-of-scope, acceptance criteria, planner notes), confirming before writing. If the user picks a tier-shadowed playbook, the skill notes which copy is being edited and offers to copy-and-edit at a more specific tier instead.

#### Branch: Run

The skill lists playbooks (same shape as **Edit**), the user picks by number, and the skill checks the daemon's queue for in-flight builds. If any are running, the skill offers to wait:

```
< Found 1 active build: "add project-local config tier" (running, started 4m ago).
  Run docs-sync now, or wait for that build to finish?
```

If the user chooses **wait**, the skill enqueues the playbook with `dependsOn` pointing at the matched build's queue id (matched by title — the user never sees the id). If multiple builds are active, the skill lists them by title for the user to pick. If no builds are active, the skill enqueues immediately and never asks.

#### Branch: List

Read-only. Same merged listing the resolver produces, formatted for humans with source labels and shadow notices.

#### Branch: Promote / Demote

Project-local playbooks are intended to be promoted to project-team once they earn their keep. The **Promote** branch lists project-local playbooks, the user picks one, and the skill moves the file from `.eforge/playbooks/` to `eforge/playbooks/` and stages it for commit. **Demote** is the reverse (project-team → project-local) for the rare case of pulling a team playbook back to personal.

#### Power-user shortcuts

Direct invocations like `/eforge:playbook run docs-sync` are accepted and jump into the relevant branch with the named item pre-selected. Even with a shortcut, the branch still confirms and offers any handheld follow-on (e.g., wait-for-build). The documented user-facing surface is the no-args menu; shortcuts are a convenience layer, not the documented interface.

#### Validation

Validation goes through the eforge daemon (same pattern as `/eforge:config` and `/eforge:profile`).

### Dependency: Three-Tier Config Resolver

This PRD assumes the generalized three-tier config resolver from [three-tier-config-resolver.md](./three-tier-config-resolver.md) is in place. That resolver:

- Knows how to look in `~/.config/eforge/`, `eforge/`, and `.eforge/` for any config artifact kind.
- Applies the correct precedence rule per shape (deep-merge for singletons, shadow-by-name for sets).
- Reports source and shadow relationships for listings.

Playbooks register with the resolver as a **set** artifact kind named `playbooks` (alongside the existing `profiles` set). Once registered, all the resolver behavior — three-tier loading, shadow reporting, source labeling in listings — is provided automatically. The playbook-specific code is just: file shape, parsing, `toSessionPlan`, and the playbook-specific CLI / skill UX.

**Sequencing implication:** the three-tier-config-resolver PRD must ship before this PRD's Phase 1.

### Piggyback Semantics

The piggyback case is the most distinctive feature — it directly addresses "don't clutter feature work with marketing/docs work." Design notes:

- **Trigger:** A playbook is enqueued with a `dependsOn: [<queue-id>]` field on its PRD frontmatter. The queue id is captured by the skill from the daemon's queue listing (matched by title to the user's pick); the user never sees or types it. The handheld **Run** branch is the documented surface; the CLI primitive `eforge playbook run <name> --after <queue-id>` remains available for scripted use only.

  Example dialog:

  ```
  > /eforge:playbook
  < What would you like to do?
    1. Create  2. Edit  3. Run  4. List  5. Promote
  > 3
  < Pick a playbook to run:
    1. tech-debt-sweep   2. marketing-site-sync   3. docs-sync
  > 3
  < Found 1 active build: "add project-local config tier" (running).
    Run docs-sync now, or wait until that finishes?
  > wait
  < Queued. docs-sync will fire when "add project-local config tier" completes.
  ```

- **On upstream success:** The playbook fires automatically when the upstream queue entry transitions to `completed` (or its post-merge equivalent).
- **On upstream failure:** Default is **skip** — the playbook does not fire. (Justification: if the feature failed, blindly running the docs sweep on a broken state is more likely to compound damage than help. Override is a follow-on.)
- **On upstream cancellation:** Same as failure — skip.
- **Visibility:** `eforge queue list` shows piggybacked playbooks indented under their parent.

**Approval gate:** v1 piggybacked playbooks **auto-enqueue** their generated plan without an interactive review. Justification: the user already approved the playbook contents at authoring time; re-asking on every fire defeats the "fire and forget" promise. Add an opt-in approval flag (`--approve`) as a follow-on if a real need surfaces.

### Implementation Phases

**Prerequisite:** [three-tier-config-resolver.md](./three-tier-config-resolver.md) ships first. Phase 1 below assumes the resolver is available and that `.eforge/` is already established as a recognized tier with `.gitignore` coverage handled by `/eforge:init`.

**Phase 1 — Playbooks: authoring + direct invocation (smallest shippable cut).**
- Register `playbooks` as a set artifact kind with the shared resolver.
- `eforge playbook list / new / edit / run / promote` CLI commands ship for scripting; the slash command does not document flags.
- Daemon HTTP surface for the same.
- Handheld `/eforge:playbook` skill in `eforge-plugin` and `packages/pi-eforge` — no-args menu, branch-per-action (create / edit / run / list / promote), each branch lists available items by title; never asks for a name.
- Intelligent scope classification in the authoring flow.
- *No piggyback yet.* Just: write a playbook, run a playbook.

**Phase 2 — Piggyback.**
- `dependsOn` already exists in PRD frontmatter schema and queue state; daemon scheduling on upstream completion is the new piece.
- Daemon scheduling logic on upstream completion.
- Piggyback wired into the handheld **Run** branch (lists in-flight builds by title; resolves to queue id internally). CLI primitive gains `--after <queue-id>` for scripts.
- Queue list UX for nested display.

**Phase 3 — Scheduling (deferred).**
- Cron-style triggers.
- Post-merge hook integration (already partially exists via `postMergeCommands`; consider whether playbooks should be invokable from there).

**Phase 4 — Parameterization (deferred, demand-driven).**
- Add only if real-world use surfaces a recurring need.

### Open Questions

1. **Playbook → plan mapping.** Does the playbook body get fed to the existing `planner` agent as the user prompt, or does it bypass planning entirely and produce a session plan directly? Trade-off: the former is more rigorous (planner negotiates scope) but slower; the latter is faster but assumes the playbook author got the scope right. **Tentative answer:** feed to `planner` as the prompt; the playbook is an articulated brief, not a pre-baked plan. Planning rigor stays intact.
2. **`agentRuntime` override per playbook.** Useful (e.g., run a docs sweep on a cheaper local Qwen runtime) but adds complexity. Defer to phase 1 unless trivially supported by the existing config layering.
3. **`postMerge` override per playbook.** Some playbooks (docs sync) might want different post-merge behavior than feature builds. Defer.
4. **Validation hooks.** Should playbook frontmatter be validated by zod schema (same as config)? Almost certainly yes — wire it into the existing config validation surface.
5. **Same-name across tiers.** With three tiers, `tech-debt-sweep` could exist at user, project-team, *and* project-local simultaneously. Resolution rule (project-local → project-team → user) handles it cleanly, but the friendly notice in `playbook list` should call out *all* shadow relationships (`shadows project-team, user`), not just the immediate one. Reduces "why isn't my edit applying?" confusion.

## Scope

### In scope

- Three-tier playbook storage: `~/.config/eforge/playbooks/` (user), `eforge/playbooks/` (project-team, checked in), `.eforge/playbooks/` (project-local, gitignored).
- Precedence resolution (project-local → project-team → user) via the shared three-tier config resolver, with shadow tracking and source labeling.
- Playbook file shape: Markdown with YAML frontmatter (`name`, `description`, `scope`, optional `agentRuntime`, optional `postMerge`) plus body sections (Goal, Out of scope, Acceptance criteria, Notes for the planner).
- Engine resolver API: `list()`, `load(name)`, `toSessionPlan(playbook)`.
- CLI commands: `eforge playbook list / new / edit / run / promote` (and `eforge play` shortcut).
- Daemon HTTP surface (e.g. `POST /playbook/enqueue`) and queue-state tracking of piggyback relations.
- Handheld `/eforge:playbook` skill in both `eforge-plugin/skills/playbook/` (Claude Code) and `packages/pi-eforge/skills/eforge-playbook/` (Pi), with no-args menu and branches: Create, Edit, Run, List, Promote / Demote.
- Intelligent scope classification (project-bound vs cross-project; shared vs personal) with the documented decision flow; only prompts when ambiguous.
- Piggyback primitive via `dependsOn: [<queue-id>]` on playbook PRD frontmatter, matched conversationally by upstream build title; auto-fires on upstream `completed`, skips on failure or cancellation; piggybacked playbooks auto-enqueue without interactive review.
- `eforge queue list` displays piggybacked playbooks indented under their parent.
- Power-user shortcuts (e.g. `/eforge:playbook run docs-sync`) supported but undocumented as the primary surface.
- Validation routed through the eforge daemon (same pattern as `/eforge:config`, `/eforge:profile`).
- Phased delivery: Phase 1 (authoring + direct invocation), Phase 2 (piggyback).

### Out of scope (v1)

- **Parameterization / templating.** No `--paths` args, no Handlebars-style template variables.
- **Scheduled invocation.** No cron-style scheduling.
- **Cross-playbook composition.** A playbook cannot itself enqueue another playbook (flat piggyback only).
- **Playbook marketplace / sharing.** No registry, no install command.
- **TUI surface.** Driver-tui's "playbook-driven planning" Phase 3 surface is not covered here.
- **GUI / web UI.**
- **Opt-in approval flag (`--approve`) on piggyback** — deferred follow-on.
- **Override of skip-on-upstream-failure** — deferred follow-on.
- **Phase 3 scheduling** (cron triggers, post-merge hook integration) and **Phase 4 parameterization** are deferred / demand-driven.

## Acceptance Criteria

- [ ] The three-tier config resolver PRD has shipped before Phase 1 begins; `.eforge/` is a recognized tier with `.gitignore` coverage handled by `/eforge:init`.
- [ ] Playbooks are registered with the shared resolver as a `set` artifact kind named `playbooks`.
- [ ] Playbooks can be stored at all three tiers (`~/.config/eforge/playbooks/<name>.md`, `eforge/playbooks/<name>.md`, `.eforge/playbooks/<name>.md`) and resolved with precedence project-local → project-team → user.
- [ ] `eforge playbook list` displays the merged set with source labels and shadow notices, including all shadow relationships when a name exists at multiple tiers (e.g. `shadows project-team, user`).
- [ ] Engine exposes `list()`, `load(name)` (highest-precedence, with shadow reporting), and `toSessionPlan(playbook)` (templatized plan handed to the existing planner agent).
- [ ] CLI commands `eforge playbook list / new / edit / run / promote` are available for scripting.
- [ ] Daemon HTTP surface supports the same operations (e.g. `POST /playbook/enqueue`) and tracks piggyback relations in queue state.
- [ ] `/eforge:playbook` slash command is implemented in `eforge-plugin/skills/playbook/playbook.md` and `packages/pi-eforge/skills/eforge-playbook/SKILL.md`.
- [ ] Invoking `/eforge:playbook` with no arguments presents a context-aware menu (Create / Edit / Run / List / Promote); branches are hidden or simplified when not applicable (e.g. only Create when no playbooks exist; Run skips wait-for-build when no in-flight builds).
- [ ] Every branch lists available items by name with source labels; the user never types a playbook name or queue id.
- [ ] Create branch runs intelligent scope classification across project-bound vs cross-project and shared vs personal dimensions, follows the documented decision flow, and only prompts the user when ambiguous; first-author no-prompt rate target ≥ 80%.
- [ ] Create branch can be entered from a mid-conversation `/eforge:plan` to save the in-progress plan as a playbook draft.
- [ ] Edit branch walks the user section-by-section (goal, out-of-scope, acceptance criteria, planner notes), confirms before writing, and offers copy-and-edit at a more specific tier when a shadowed playbook is selected.
- [ ] Run branch checks the daemon's queue for in-flight builds; if any exist, offers to wait, lists them by title for selection when multiple, and otherwise enqueues immediately without asking.
- [ ] When the user picks "wait", the skill enqueues with `dependsOn` set to the matched upstream build's queue id (resolved internally by title).
- [ ] Promote branch moves a `.eforge/playbooks/<name>.md` file to `eforge/playbooks/<name>.md` and stages it for commit; Demote performs the reverse.
- [ ] Power-user shortcuts (e.g. `/eforge:playbook run docs-sync`) are accepted, jump into the relevant branch with the item pre-selected, and still confirm and offer handheld follow-ons.
- [ ] Playbook validation is routed through the eforge daemon, mirroring `/eforge:config` and `/eforge:profile`.
- [ ] Piggybacked playbook fires automatically when its upstream queue entry transitions to `completed` (or post-merge equivalent).
- [ ] Piggybacked playbook is **skipped** when the upstream build fails or is cancelled.
- [ ] Piggybacked playbooks auto-enqueue their generated plan without an interactive review gate in v1.
- [ ] `eforge queue list` shows piggybacked playbooks indented under their parent.
- [ ] CLI primitive `eforge playbook run <name> --after <queue-id>` is available for scripted use in Phase 2.
- [ ] No new execution layer is introduced; playbooks hand off to the existing planner | builder | reviewer pipeline.
- [ ] A user can author a playbook in one short conversation and run it with one command.
- [ ] A user-scoped playbook works across the user's projects without per-project edits.
- [ ] A piggybacked playbook fires reliably after its parent build, with no manual intervention.
- [ ] Recurring hygiene work that previously got skipped because of activation cost (tech debt sweeps, docs syncs) gets done.
