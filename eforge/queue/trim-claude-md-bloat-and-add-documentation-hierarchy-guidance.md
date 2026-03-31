---
title: Trim CLAUDE.md bloat and add documentation hierarchy guidance
created: 2026-03-31
status: pending
---

# Trim CLAUDE.md bloat and add documentation hierarchy guidance

## Problem / Motivation

Two problems exist with the current CLAUDE.md:

1. **Missing guidance causes agents to miss README.md.** File searches scan `node_modules/`, hit result limits on third-party READMEs, and never reach the project root. Agents then treat CLAUDE.md as project docs, but it is agent guidance, not human-facing documentation.

2. **CLAUDE.md restates implementation details derivable from code.** At 217 lines, roughly 40-50% is redundant with what reading the source would tell you (full agent descriptions, backend internals, orchestration merge strategy, monitor state machine, CLI flag lists, hook env vars, model class resolution). This bloat wastes context window and drifts stale.

## Goal

Reduce CLAUDE.md from ~217 lines to ~120-140 lines by removing implementation details derivable from source code, and add explicit guidance so agents know where human-facing documentation lives and how to search without polluting results with third-party files.

## Approach

All changes are to a single file: `CLAUDE.md`.

### 1. Add `## Documentation` section (after "What is this?")

```markdown
## Documentation

- `README.md` is the primary human-facing documentation. Always check it when considering doc updates.
- `CLAUDE.md` (this file) is agent guidance - consumed by AI agents, not humans. Do not treat it as project documentation.
- `docs/` contains supplementary docs (architecture, config, hooks).
- When searching for documentation or project files, **exclude `node_modules/` and `dist/`** from searches. These contain thousands of third-party files that pollute results and cause project files to be missed.
```

### 2. Trim Architecture section

**Keep** (as brief guidance):
- Design principle ("engine emits, consumers render")
- Pipeline is stage-driven, not linear - pointer to `pipeline.ts`
- Workflow profiles concept - pointer to `config.ts` `BUILTIN_PROFILES`
- Backend abstraction rule: agent runners use `AgentBackend`, never import SDKs directly - pointer to `backend.ts`
- Agent list as a compact bullet list (name + one-phrase role), not full paragraphs
- MCP/plugin propagation: one sentence each with pointer to source file
- Orchestration: one sentence concept + pointer to `orchestrator.ts`

**Remove**:
- SdkPassthroughConfig / pickSdkOptions / resolveAgentConfig details
- MCP server propagation implementation (PiMcpBridge, JSON Schema to TypeBox, namespacing)
- Plugin propagation implementation (installed_plugins.json discovery, settingSources)
- Monitor internals (countdown state machine, hasSeenActivity, signalMonitorShutdown)
- Orchestration merge strategy details (squash-merge, force-delete, two-level merge, validation fixer retries)
- State file details
- Pipeline stage enumeration (compile stages list, build stages list, composite stage expansions)
- Built-in profile compile stage lists

### 3. Trim Configuration section

**Keep**:
- Two-level config (global + project) with pointers
- Priority chain one-liner
- Profile concept (one sentence)

**Remove**:
- Model class system details (resolution order, AGENT_MODEL_CLASSES, MODEL_CLASS_DEFAULTS)
- Merge strategy details (shallow merge per-field, array concatenation rules)
- prdQueue/daemon field-level documentation
- Hook env var table
- Profiles merge/extends details

### 4. Trim CLI commands section

Replace the full command listing + flags paragraph with a pointer:

```markdown
Run `eforge --help` for the full command reference. Key commands: `build`, `enqueue`, `status`, `queue`, `monitor`, `config`, `daemon`.
```

### 5. Trim Tech decisions section

**Keep**: The *why* for key decisions (ESM-only, claude-agent-sdk choice, Pi backend choice, AsyncGenerator pattern).

**Remove**: Implementation details (tsup external config, env var names, EFORGE_MONITOR_PORT/DB, settingSources default).

### 6. Add search exclusion to Conventions section

Add bullet:

```markdown
- When searching for files (documentation, READMEs, configs), exclude `node_modules/` and `dist/`. These directories pollute search results and cause project-root files to be missed.
```

## Scope

**In scope:**
- All edits to `CLAUDE.md` described above (documentation section, architecture trim, configuration trim, CLI trim, tech decisions trim, conventions addition)

**Out of scope:**
- Changes to `README.md`, `docs/`, or any source code
- Adding new documentation content beyond what is specified
- Restructuring sections beyond trimming and the new Documentation section

## Acceptance Criteria

- Updated CLAUDE.md contains a `## Documentation` section with README.md guidance and `node_modules/`/`dist/` search exclusion
- Architecture section is shorter, retaining only brief guidance with pointers to source files; all listed implementation details are removed
- Configuration section is shorter, retaining only two-level config, priority chain, and profile concept; all listed detail items are removed
- CLI commands section is replaced with a single `--help` pointer and key command list
- Tech decisions section retains only the *why* for key decisions; listed implementation details are removed
- Conventions section includes a bullet about excluding `node_modules/` and `dist/` from file searches
- No useful guidance is lost (conventions, testing philosophy, roadmap governance, project structure remain intact)
- Final line count is approximately 120-140 lines (down from 217)
- Full end-to-end read of the updated file confirms coherence and completeness
