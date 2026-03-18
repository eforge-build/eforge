---
title: Plan: Add `/eforge-dogfood-watch` project-specific skill
created: 2026-03-18
status: pending
---

## Problem / Motivation

Watch mode (`eforge run --queue --watch`) keeps a single Node.js process polling for new PRDs. When dogfooding eforge in its own repo, eforge modifies its own source code during queue runs. The running process uses the already-loaded `dist/cli.js` — rebuilding mid-watch doesn't help. Each cycle needs a fresh process with the latest build.

## Goal

Create a project-specific Claude Code skill (`/eforge-dogfood-watch`) that loops at the Claude Code level — stop eforge, rebuild, restart — so each invocation of `eforge run --queue` gets the freshly compiled binary.

## Approach

### Skill location

Create `.claude/skills/eforge-dogfood-watch/SKILL.md`. Project-specific skills are auto-discovered from `.claude/skills/{name}/SKILL.md` — no registration needed.

### Frontmatter

- `description` — explains dogfood queue watching with rebuild between cycles
- `disable-model-invocation: true` — procedural, no LLM routing

### Workflow (cycle loop)

1. **Build** — `pnpm build`. Stop loop on failure (source changes broke something, user must fix).
2. **Check queue** — Glob `docs/prd-queue/*.md`, read frontmatter, count `pending` PRDs. If none, poll every 30 seconds until new ones appear.
3. **Run queue** — `eforge run --queue --auto --verbose` with `run_in_background: true` (runs can exceed bash timeout). Wait for completion notification.
4. **Report & loop** — Report outcome, go back to step 1 to rebuild with source changes from this cycle.

### Key design choices

- No `--watch` flag — the skill IS the watch loop, with rebuild in between
- 30s poll interval for empty queue (longer than eforge's 5s since each cycle includes a full build)
- `run_in_background: true` matches the existing `/eforge:run` skill pattern
- Step-by-step Claude iteration (not a bash while loop) so Claude can read queue state, report results, and handle errors with judgment

### Exit conditions

- Build failure (user must intervene)
- User says stop
- 3 consecutive all-fail cycles (systemic issue)

## Scope

**In scope:**
- Single skill file (`.claude/skills/eforge-dogfood-watch/SKILL.md`)

**Out of scope:**
- N/A

## Acceptance Criteria

1. `.claude/skills/eforge-dogfood-watch/SKILL.md` exists with valid frontmatter (`description`, `disable-model-invocation: true`)
2. `/eforge-dogfood-watch` appears as an available skill when invoked in Claude Code
3. The workflow executes correctly: builds first, checks queue, runs eforge, rebuilds after completion
