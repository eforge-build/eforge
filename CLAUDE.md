# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

aroh-forge is a standalone CLI tool that extracts plan-build-review workflows from the schaake-cc-marketplace Claude Code plugins into a portable TypeScript CLI built on `@anthropic-ai/claude-agent-sdk`. It runs outside Claude Code as an independent developer tool.

## Commands

```bash
pnpm run build        # Bundle with tsup → dist/cli.js
pnpm run dev          # Run directly via tsx (e.g. pnpm run dev -- plan foo.md)
pnpm run type-check   # Type check without emitting
```

No test framework is configured yet.

## Architecture

**Three-agent loop**: planner → builder → reviewer, each wrapping an SDK `query()` call.

- **Planner** — one-shot query. Explores codebase, writes plan files (YAML frontmatter format).
- **Builder** — multi-turn SDK client. Turn 1: implement plan. Turn 2: evaluate reviewer's unstaged fixes.
- **Reviewer** — one-shot query. Blind review (no builder context), leaves fixes unstaged.

Agent prompts live in `src/prompts/*.md` (self-contained, no runtime plugin dependencies). Agent implementations live in `src/agents/*.ts`.

**Orchestration**: `src/orchestrator.ts` resolves a dependency graph from `orchestration.yaml`, computes execution waves, and runs plans in parallel via git worktrees (`src/worktree.ts`). Branches merge in topological order after all plans complete.

**State**: `.forge-state.json` (gitignored) tracks build progress for resume support.

## Tech decisions

- ESM-only (`"type": "module"`), target Node.js 22+
- `@anthropic-ai/claude-agent-sdk` is a devDependency — it's the host SDK, not bundled into dist
- tsup bundles to a single `dist/cli.js` with shebang for direct execution
- Langfuse tracing is planned for all agent calls (env vars: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`)

## CLI commands

```
aroh-forge plan <source>      # PRD file or prompt → plan files
aroh-forge build <planSet>    # Execute plans (implement + review)
aroh-forge review <planSet>   # Review code against plans
aroh-forge status             # Check running builds
```

Flags: `--auto` (bypass approval gates), `--verbose` (stream output), `--dry-run` (validate only)
