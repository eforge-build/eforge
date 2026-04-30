---
title: Revise tmp/playbooks.md to describe /eforge:playbook as a handheld conversational skill
created: 2026-04-30
---

# Revise tmp/playbooks.md to describe /eforge:playbook as a handheld conversational skill

## Problem / Motivation

The current playbooks PRD describes `/eforge:playbook` as a flag-driven slash command (`--new`, `--edit`, `--list`, `--run <name>`, `--run <name> --after <queue-id>`). This is off-style relative to existing eforge skills (plan, profile, config, profile-new) which use handheld conversational interviews. More importantly, it asks users to remember names and queue ids they don't keep in their heads. The PRD must be revised before implementation begins.

## Goal

After this build, `tmp/playbooks.md` describes `/eforge:playbook` as a handheld skill: invoking with no arguments presents a menu of branches (create / edit / run / list / promote-demote); every branch lists available items by name (with source labels for shadow tracking) so the user picks from a list rather than typing names or ids. Piggyback identifies the upstream build by its human-readable title — never by queue id.

## Approach

Edit `tmp/playbooks.md` in place. Keep the daemon contract intact (`dependsOn` at the wire format level remains the mechanism); only the user-facing skill UX prose changes. The CLI primitive `eforge playbook run <name> --after <queue-id>` is preserved as a non-skill scripting surface, mentioned in passing.

### Specific edits

**1. Goals section (around lines 22-29).**

- Tighten goal 3: change "A playbook can be queued to run after another build completes successfully, without cluttering that build's plan." to "A playbook can be queued to fire after another build completes successfully, with the upstream build identified conversationally by title — never by queue id — without cluttering that build's plan."
- Rewrite goal 4. Replace "Skill-driven authoring." (and its current sentence about creating/editing/listing/invoking) with: "Handheld skill UX. The slash command with no arguments presents a menu of branches (create / edit / run / list / promote). Every branch lists available items by name with source labels so the user picks from a list rather than typing names or ids."

**2. Skills section (around lines 159-200).**

- Drop the entire markdown table of invocations at lines 166-177 (the `--new` / `--edit` / `--list` / `--run` / `--run --after` rows).
- Replace the table with subsections describing each branch:
  - **No-args menu.** Show that `/eforge:playbook` with no arguments presents a numbered menu of branches. Branch availability is context-aware (no playbooks → only Create offered; no in-flight builds → run branch skips the wait-for-build prompt).
  - **Branch: Create.** Keep the existing Intelligent scope classification flow (currently lines 179-200 — relocate it under Create as the mechanics of this branch). Add a sentence: if the user is mid-conversation in `/eforge:plan` and asks to save the in-progress plan as a playbook, the Create branch enters with that plan as a draft starting point.
  - **Branch: Edit.** Skill calls the resolver, lists every playbook with source labels, user picks by number. Show an example listing: `1. tech-debt-sweep [project-local] (shadows project-team)` etc. After selection, walk through edits section-by-section, confirm before writing. If the user picks a tier-shadowed playbook, the skill notes which copy is being edited and offers to copy-and-edit at a more specific tier instead.
  - **Branch: Run.** List playbooks (same shape as Edit's list). User picks by number. Then check the daemon's queue for in-flight builds. Show an example dialog: "Found 1 active build: 'add project-local config tier' (running, started 4m ago). Run docs-sync now, or wait for that build to finish?" If "wait," enqueue with `dependsOn` of the matched build's queue id (matched by title; user never sees the id). If multiple builds, list them by title for the user to pick. If no builds active, enqueue immediately and never ask.
  - **Branch: List.** Read-only. Same merged listing the resolver produces, formatted for humans with source labels and shadow notices.
  - **Branch: Promote / Demote.** List candidates (project-local for promote; project-team for demote), user picks by number. Skill moves the file and stages for commit.
- After the branch descriptions, add a one-line note: "Power-user shortcuts (`/eforge:playbook run docs-sync`) are accepted and jump into the relevant branch with the named item pre-selected. Even with a shortcut, the branch still confirms and offers any handheld follow-on (e.g., wait-for-build)."
- Keep the existing sentence about validation going through the eforge daemon (same pattern as `/eforge:config` and `/eforge:profile`).

**3. Piggyback Semantics section (around lines 215-224).**

Keep the On upstream success / failure / cancellation subsections, the Visibility subsection, and the Approval gate subsection — those describe daemon behavior and remain accurate.

Revise only the lead and the Trigger bullet. New Trigger wording: "A playbook is enqueued with a `dependsOn: [<queue-id>]` field on its PRD frontmatter. The queue id is captured by the skill from the daemon's queue listing (matched by title to the user's pick); the user never sees or types it. The handheld run branch (see Skills) is the documented surface; the CLI primitive `eforge playbook run <name> --after <queue-id>` remains available for scripted use only."

Add an example dialog block right after the Trigger bullet:

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

**4. Implementation Phases section (around lines 228-249).**

- In Phase 1, replace the "/eforge:playbook skill in eforge-plugin and packages/pi-eforge" bullet with: "Handheld `/eforge:playbook` skill in eforge-plugin and packages/pi-eforge — no-args menu, branch-per-action (create / edit / run / list / promote), each branch lists available items by title; never asks for a name."
- Add a Phase 1 bullet: "CLI primitive `eforge playbook run <name>` (and the eventual `--after <queue-id>` flag in Phase 2) ships for scripting. Slash command does not document flags."
- In Phase 2, replace "`--after <queue-id>` flag in CLI + skill" with: "Piggyback wired into the handheld run branch (lists in-flight builds by title; resolves to queue id internally). CLI primitive gains `--after <queue-id>` for scripts."

**5. Open Questions section (around lines 251-258).**

Drop question 6 ("Authoring-skill UX when user is mid-feature"). It is folded into the Create branch description (mid-feature plan can seed a draft playbook).

## Scope

### In scope

- All five edits to `tmp/playbooks.md` described above.

### Out of scope

- Any code changes (no engine, CLI, skill markdown, or test edits in this build).
- Edits to `tmp/three-tier-config-resolver.md` or any other `tmp/*.md` file.
- The in-flight project-local config tier work (`eforge/queue/add-project-local-config-tier-to-eforge.md`). That build proceeds independently.
- `README.md`, `AGENTS.md`, plugin version bumps. Those are downstream of the eventual playbooks implementation, not this PRD revision.
- CHANGELOG edits (release flow owns CHANGELOG).

## Acceptance Criteria

1. Reading `tmp/playbooks.md` end-to-end shows no flag-driven `/eforge:playbook` invocation in user-facing prose. The flag table at lines 166-177 of the original is gone, replaced with handheld branch subsections.
2. Piggyback is described conversationally: the skill identifies the upstream build by title, never by queue id, in user-facing prose. The example dialog is present in the Piggyback Semantics section.
3. The daemon-contract mechanism is preserved: `dependsOn` is still named where the wire format is described. The CLI primitive `eforge playbook run <name> --after <queue-id>` is mentioned only in the "for scripts" sense.
4. The Goals list reflects the handheld principle: goal 3 mentions "by title — never by queue id" and goal 4 reads "Handheld skill UX" with the no-args-menu description.
5. The Implementation Phases section reflects the change: Phase 1 names the handheld skill explicitly; Phase 2's piggyback bullet is conversational, not flag-based.
6. Open Question 6 is removed; its concern is folded into the Create branch description.
7. No other files in the repository are modified by this build.
