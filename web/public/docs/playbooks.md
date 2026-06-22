---
title: Playbooks
description: Create and run reusable workflow templates for recurring eforge builds.
---

# Playbooks

A playbook is an optional workflow artifact around the eforge build-engine kernel. Instead of re-describing recurring work each time, you write it once as a Markdown file and run it on demand. eforge resolves the playbook, optionally routes it to a specific agent runtime profile, and either normalizes it to build source for enqueue or routes to an investigation-first planning extension before a later handoff.

## Modes

Every playbook has a `mode` field in its YAML frontmatter:

**`mode: autonomous`** - running the playbook compiles it into normalized build source and enqueues a build, like any other producer input. The daemon picks it up and runs the full pipeline without further interaction. Use this for mechanical, predictable workflows where the build agent does not need to consult you mid-run.

**`mode: planning`** - running the playbook checks the `eforge.plan.planning-mode-playbook` capability from optional [eforge-plan](/docs/eforge-plan) and returns generic planning entry metadata when that capability is available. Continue through `eforge_extension_contribution` list/show/invoke or the eforge-plan workstation deep link; the extension owns the investigation-first flow, session-plan drafting, revision, and handoff before `/eforge:build`. The daemon does not create the session plan directly or enqueue a PRD.

When you call `eforge_playbook { action: "run" }` for a planning playbook, the daemon returns `{ kind: "requires-agent", mode: "planning", planningEntry, requiredCapability }` when eforge-plan is available, or `{ kind: "planning-unavailable", requiredCapability, diagnostics }` when the required capability is unavailable.

Planning-mode playbooks produce session plans through the eforge-plan planning entry, not by directly enqueueing a PRD. The planning workstation creates or resumes a file in `.eforge/session-plans/`, records confirmed investigation findings as context/evidence in context-oriented sections, and makes Scope, Code Impact, and Acceptance Criteria describe concrete implementation targets, actions, and validation criteria. Then `/eforge:build` submits the ready session-plan file as build source. If the playbook declares `profile`, the session plan inherits it as `agent_profile`; the profile is validated when that session plan is enqueued. If the playbook declares `postMerge`, those commands are forwarded only when an autonomous playbook is converted directly to build source.

## Scope tiers

Playbooks live at three scope directories, shadowed by higher-precedence tiers:

| Scope | Directory | Committed? |
|-------|-----------|-----------|
| User | `~/.config/eforge/playbooks/` | No |
| Project-team | `eforge/playbooks/` | Yes |
| Project-local | `.eforge/playbooks/` | No (gitignored) |

A project-local playbook with the same name shadows the project-team version, which shadows the user version. eforge always resolves the most-specific tier.

## Playbook file format

Playbooks are Markdown files with a YAML frontmatter block:

```yaml
---
name: docs-sync
description: Keep all documentation in sync with the latest code changes.
scope: project-team
mode: autonomous
# profile: docs-heavy  # Optional - omit to allow router/active-profile/default resolution
---

## Goal
Keep documentation current with code changes in every PR.

## Out of scope
Do not create new docs sections; only update existing content.

## Acceptance criteria
- All code examples in docs compile or run without errors
- API surface descriptions match the current implementation
- No stale version references

## Notes for the planner
Focus on packages/ and web/content/. Cross-check against generated reference.
```

**Required frontmatter fields:** `name`, `description`, `scope`, `mode`.

**Optional frontmatter fields:**
- `profile` - agent runtime profile name to use when the playbook runs
- `postMerge` - list of post-merge commands to forward to the build

## Use a profile with a playbook

The optional `profile` frontmatter field names an agent runtime profile to use when the playbook runs:

```yaml
---
name: ui-regression
description: Automated UI regression sweep
scope: project-team
mode: autonomous
profile: browser-ui
---
```

**Precedence:** the playbook `profile` field overrides the project's active-profile marker and any registered profile router. `eforge playbook run` does not accept a runtime profile override; edit the playbook frontmatter to change its profile.

**Validation timing:** the named profile is validated at execution time, not when the playbook is saved.

**Planning playbooks:** when a planning-mode playbook has a `profile` field and the eforge-plan planning flow creates a session plan from it, the profile is inherited into the session plan's `agent_profile` frontmatter field. When the session plan is enqueued, `agent_profile` is used as the effective profile unless an explicit override is supplied.

**Blank profile fallback:** omitting `profile` allows a registered profile router to select a profile first; if no router selects one, eforge uses the project's active-profile marker or engine defaults.

## Create a playbook

```
/eforge:playbook create
```

The skill gathers the workflow description, infers a scope (project-team, project-local, or user) from the description, asks for the mode, optionally ties it to a profile, drafts the playbook content, validates it, and saves.

From the CLI:

```bash
eforge playbook new --scope project-team --name docs-sync --description "Keep docs current"
```

The CLI scaffold is non-interactive and creates an autonomous playbook. Use `--scope user`, `--scope project-team`, or `--scope project-local`; add `--profile <name>` when the playbook should pin a runtime profile.

## Run a playbook

```
/eforge:playbook run
```

The skill lists available playbooks and lets you pick by number. For autonomous playbooks it first presents a landing selector, then checks for in-flight builds and lets you optionally wait for one to finish before enqueueing. The normal landing choices are **Use project default** (inherit `landing.action` from `eforge/config.yaml`, without sending an override), `pr`, `merge`, or `leave`. On a protected trunk branch, unsafe direct merge choices are omitted unless `build.allowLocalMergeToTrunk: true` is enabled; choose `pr`, `leave`, enable the config opt-in, or cancel instead. When `pr` is selected, a follow-up sub-selector lets you choose the GitHub PR auto-merge behavior for this run: **Use policy default** (defer to `landing.pr.autoMerge` in config), **Enable auto-merge**, or **Disable auto-merge**:

```
/eforge:playbook run docs-sync
```

From the CLI:

```bash
eforge playbook run docs-sync
eforge play docs-sync       # shorthand
```

`eforge play` is a shorthand for `eforge playbook run`.

After a successful autonomous enqueue, the daemon returns `{ kind: 'enqueued', id }` and the build appears in Console. Planning playbooks instead return eforge-plan planning entry metadata or unavailable capability diagnostics.

## List playbooks

```
/eforge:playbook list
```

From the CLI:

```bash
eforge playbook list
```

Output groups playbooks by scope tier and marks shadowed entries.

## Edit a playbook

```
/eforge:playbook edit
```

The skill loads the playbook and walks through each section (mode, profile, Goal, Out of scope, Acceptance criteria, Notes for the planner) one at a time, asking whether to update each.

From the CLI:

```bash
eforge playbook edit docs-sync
```

## Promote and demote playbooks

Move a project-local playbook to project-team scope so the whole team benefits:

```
/eforge:playbook promote release-prep
```

Or from the CLI:

```bash
eforge playbook promote release-prep
eforge playbook demote release-prep     # move back to project-local
```

After promotion, the playbook moves into the committed project-team directory. The CLI stages the promoted file with `git add`; review and commit it with the rest of your change. Demotion moves it back to project-local scope, where it shadows any team version of the same name.

## Dependency on queue items

For autonomous playbooks, you can schedule a playbook to run after an in-flight build completes. The skill offers this when active queue items exist. From the CLI:

```bash
eforge playbook run docs-sync --after <queue-id>
```

## Where to look next

- [Profiles](/docs/profiles) - agent runtime profiles that playbooks can reference
- [Configuration](/docs/configuration#playbook-profiles) - playbook profile frontmatter and precedence
- [Integrations](/docs/integrations) - how to run playbooks from the Claude Code plugin and Pi extension
- [Glossary](/docs/glossary) - short definitions for playbook, session plan, and PRD
