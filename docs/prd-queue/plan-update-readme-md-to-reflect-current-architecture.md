---
title: Plan: Update README.md to reflect current architecture
created: 2026-03-24
status: pending
---

## Problem / Motivation

The eforge README.md is mostly current but doesn't reflect the daemon-first, queue-centric architecture that eforge now uses. The daemon is the default execution path — `eforge build` delegates to the daemon which owns the queue, watches for new PRDs, and spawns worker processes. This is a core architectural shift that the README should make clear. Specifically:

- The Mermaid diagram shows a linear flow (PRD → Formatter → Queue → Planner → ...) without the daemon
- The CLI Usage section is missing commands (`eforge daemon start|stop|status`) and flags (`--cleanup/--no-cleanup`)
- The Architecture section has no mention of the daemon, MCP proxy, or SQLite coordination
- The "How It Works" intro text doesn't mention the daemon as the default path

## Goal

Update README.md to accurately reflect the current daemon-first, queue-centric architecture so that readers understand the daemon is the default execution path and how the system components relate.

## Approach

All changes are confined to a single file: `/Users/markschaake/projects/eforge/README.md`. The updates span five areas:

### 1. Update Mermaid diagram

Replace the current linear flow diagram with one that shows:

- **Source → Formatter → Queue** (existing flow, kept as-is)
- **Daemon** as the orchestrator that watches the queue and spawns workers
- Compile/Build/Validate subgraphs shown as what the daemon worker executes
- Two paths: daemon (default) vs foreground (`--foreground`)

Target flow:
```
Source → Formatter → Queue
                       ↓
              Daemon (watches queue)
                       ↓
              Worker (per PRD)
                       ↓
              Compile → Build → Validate
```

### 2. Update "Claude Code Plugin" table

Verify current table mentions these skills (already correct):
- `/eforge:build` — Enqueue PRD; daemon auto-builds
- `/eforge:status` — Check build progress
- `/eforge:config` — Initialize or edit `eforge.yaml`

MCP tools (`eforge_build`, `eforge_enqueue`, `eforge_auto_build`, `eforge_status`, `eforge_queue_list`, `eforge_config`) are implementation details behind the skills, so the table is fine as-is.

### 3. Update CLI Usage section

Add missing commands:
- `eforge daemon start|stop|status` — Manage the persistent daemon

Add missing flags:
- `--cleanup/--no-cleanup` — Keep/remove plan files after successful build

(`eforge queue list` and `eforge queue run [name]` are already present.)

### 4. Update Architecture section

Add a paragraph covering:
- Daemon is a persistent HTTP server (port 4567) that watches the queue and auto-builds PRDs
- Spawns worker processes for each build (same `eforge` binary, same engine)
- MCP proxy bridges Claude Code plugin to daemon via HTTP
- CLI auto-starts daemon on first use, falls back to foreground if unavailable
- SQLite DB is the coordination point across sessions

### 5. Minor text updates

- "How It Works" bullets — mention daemon as default path in the intro text above the diagram
- Verify all referenced images still exist

## Scope

**In scope:**
- All changes to `/Users/markschaake/projects/eforge/README.md`
- Mermaid diagram update
- CLI Usage section updates (missing commands and flags)
- Architecture section daemon paragraph
- Claude Code Plugin table verification
- "How It Works" intro text update

**Out of scope:**
- Changes to any file other than README.md
- Modifying the Claude Code Plugin table beyond verification (it's already correct)
- MCP tool documentation (implementation details behind skills)

## Acceptance Criteria

1. The Mermaid diagram renders correctly in a markdown previewer and shows: Source → Formatter → Queue → Daemon → Worker → Compile/Build/Validate pipeline, with both daemon (default) and foreground paths visible
2. The CLI Usage section includes `eforge daemon start|stop|status` and the `--cleanup/--no-cleanup` flag
3. The Architecture section contains a paragraph explaining the daemon as a persistent HTTP server (port 4567), worker spawning, MCP proxy, CLI auto-start behavior, and SQLite coordination
4. The "How It Works" intro text mentions the daemon as the default execution path
5. All referenced image paths exist: `docs/images/claude-code-handoff.png`, `docs/images/monitor-full-pipeline.png`, `docs/images/monitor-timeline.png`, `docs/images/eval-results.png`
6. All referenced doc links exist: `docs/config.md`, `docs/hooks.md`
7. The final README reads coherently end-to-end
