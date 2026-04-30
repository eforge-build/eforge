---
title: Add welcome text to `/eforge:init`
created: 2026-04-30
---

# Add welcome text to `/eforge:init`

## Problem / Motivation

The `/eforge:init` skill currently jumps straight into project analysis (Step 1: postMergeCommands detection) without orienting the user. First-time users invoking the skill see no explanation of what eforge is or what the setup will do — they're dropped into a tool call with no framing.

## Goal

Add a short welcome banner shown before Step 1 so the user knows what they're configuring and why. The wording is sourced from the README tagline ("agentic build system... stay close to the code without writing or reviewing it").

## Approach

- Insert a new `## Welcome` section **between** the existing skill description block and `## Workflow` in both consumer-facing init skill markdown files.
- The skill markdown frames this as an instruction to the agent: *before doing anything else, print the welcome message above to the user, then begin Step 1.*
- The welcome text is identical between the two files (the elevator pitch is harness-agnostic) and goes **outside** the existing `<!-- parity-skip-start -->` markers, since it's shared content.
- The welcome is shown **unconditionally** — every invocation, including `--force` re-inits and `--migrate` runs. No conditional branching.
- Per the AGENTS.md sync convention, both consumer-facing init skills must be updated together.
- No code changes, no tests to update — this is a pure prompt-content change to two markdown skill files.

### Welcome copy (user-visible message)

> Welcome to eforge — an agentic build system that turns plans into code. You stay close to the code (planning, decisions) while eforge implements, blind-reviews, and validates in the background.
>
> This setup configures your agent runtime profile and post-merge validation commands.

### Section to insert into both files

```markdown
## Welcome

Before starting Step 1, print this welcome message to the user verbatim:

> Welcome to eforge — an agentic build system that turns plans into code. You stay close to the code (planning, decisions) while eforge implements, blind-reviews, and validates in the background.
>
> This setup configures your agent runtime profile and post-merge validation commands.

Then proceed to Step 1.
```

## Scope

### In scope

1. **`eforge-plugin/skills/init/init.md`** (Claude Code plugin)
   - Insert the `## Welcome` section after line 10 (the closing `<!-- parity-skip-end -->` of the description block) and before `## Workflow` on line 12.

2. **`packages/pi-eforge/skills/eforge-init/SKILL.md`** (Pi extension)
   - Insert the same `## Welcome` section after line 11 (closing `<!-- parity-skip-end -->`) and before `## Workflow` on line 13. Same copy, no Pi-specific changes — the welcome is harness-agnostic.

### Out of scope

- Code changes
- Test updates
- Conditional branching (e.g., suppressing the welcome on `--force` or `--migrate`)
- Harness-specific wording variations

## Acceptance Criteria

1. **Visual diff check**: confirm the two skill files have identical `## Welcome` blocks (the only place where parity matters here).
2. **Manual smoke test (Claude Code plugin)**: in a scratch project, run `/eforge:init` and verify the welcome message prints before any tool calls or analysis output.
3. **Manual smoke test (Pi extension)**: same in a Pi session — `/eforge:init` should print the welcome before fetching providers/models.
4. **Re-init behavior**: run `/eforge:init --force` in a project that already has `eforge/config.yaml`. Welcome should still print (always-show behavior).
5. **Migrate behavior**: run `/eforge:init --migrate` against a legacy config. Welcome should print before the migrate path branches at Step 6.
6. The welcome section is placed outside the existing `<!-- parity-skip-start -->` / `<!-- parity-skip-end -->` markers in both files.
