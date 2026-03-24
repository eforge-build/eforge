---
id: plan-01-interactive-build-skill
name: Interactive Build Skill Workflow
depends_on: []
branch: plan-interactive-eforge-build-skill/interactive-build-skill
---

# Interactive Build Skill Workflow

## Architecture Context

The eforge Claude Code plugin exposes a `/eforge:build` skill defined in `eforge-plugin/skills/build/build.md`. This is a declarative skill file (markdown with YAML frontmatter, `disable-model-invocation: true`) that instructs Claude Code how to handle the `/eforge:build` command. The skill currently has a 3-step workflow that dead-ends on no-argument invocations and passes thin prompts through to the formatter without enrichment.

The formatter (`src/engine/prompts/formatter.md`) structures input into 5 PRD sections: Problem/Motivation, Goal, Approach, Scope, Acceptance Criteria. It is instructed to never invent content — missing sections get "N/A". The skill rewrite adds a pre-formatter interview to fill gaps before the source reaches the formatter.

The `/eforge:config` skill (`eforge-plugin/skills/config/config.md`) demonstrates the interview pattern to follow: gather context, walk through sections, present draft, confirm before proceeding.

## Implementation

### Overview

Rewrite `eforge-plugin/skills/build/build.md` from a 3-step workflow to a 5-step workflow with branching logic. Also bump the plugin version in `eforge-plugin/.claude-plugin/plugin.json`.

The new workflow:
1. **Resolve Source Input** — 3 branches: file path (skip to Step 4), inline description (proceed to Step 2), no arguments (infer from conversation context or ask).
2. **Assess Completeness** — Evaluate working source against the 5 PRD sections. Short sources (<~30 words) always interview. 3+ sections covered skip to Step 4.
3. **Interview** — Ask about missing sections only, max 4 questions in a single message. Escape hatch: "just build it" skips to Step 4.
4. **Confirm Source Preview** — Show assembled source in a blockquote, ask user to confirm/edit/cancel.
5. **Enqueue & Report** — Call MCP tool, report result (unchanged from current Steps 2-3).

### Key Decisions

1. **Keep `disable-model-invocation: true`** — The skill remains a pure instruction file; Claude Code follows the workflow steps. No programmatic changes needed.
2. **Interview questions are a fixed lookup table** — Each missing PRD section maps to a specific question. Problem + Goal missing together get a combined question. This keeps the interview concise and predictable.
3. **Context inference for no-arg invocations** — When no arguments are provided and no plan file exists, the skill instructs Claude to examine conversation context (recently discussed features, edited files, errors, stated goals) to infer intent before asking open-ended.
4. **Escape hatch wording** — Accept "just build it", "skip", or similar decline-to-elaborate signals. The formatter handles N/A sections gracefully, so this is safe.

## Scope

### In Scope
- Rewriting the `build.md` skill file with 5-step branching workflow
- Adding context inference logic for no-argument invocations
- Adding completeness assessment against 5 PRD sections
- Adding conditional interview with section-specific questions
- Adding source preview/confirmation step before enqueue
- Bumping plugin version in `plugin.json`

### Out of Scope
- Engine changes
- Formatter prompt changes
- MCP tool changes
- Planner or downstream agent changes
- New files or new skills

## Files

### Modify
- `eforge-plugin/skills/build/build.md` — Complete rewrite from 3-step to 5-step workflow. Replace the current ~58-line workflow with the new ~120-line branching workflow. Keep the same YAML frontmatter structure. Preserve the Error Handling table at the bottom, updating entries to reflect new workflow steps.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump `version` from `"0.5.2"` to `"0.5.3"`.

## Verification

- [ ] `eforge-plugin/skills/build/build.md` contains exactly 5 steps labeled "Step 1" through "Step 5"
- [ ] Step 1 has three named branches: file path, inline description, and no arguments
- [ ] Step 1's no-arguments branch includes conversation context inference before falling back to open-ended question
- [ ] Step 2 lists all 5 PRD sections (Problem/Motivation, Goal, Approach, Scope, Acceptance Criteria) and defines the <~30 word and 3+ section threshold rules
- [ ] Step 3 contains a question lookup table mapping missing sections to specific questions
- [ ] Step 3 includes an escape hatch instruction for "just build it" or similar
- [ ] Step 4 presents source in a blockquote and asks for confirm/edit/cancel
- [ ] Step 5 calls `mcp__eforge__eforge_build` and reports result with session ID
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is `"0.5.3"`
- [ ] The YAML frontmatter retains `disable-model-invocation: true`
