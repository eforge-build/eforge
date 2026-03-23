---
description: Enqueue a source for the eforge daemon to build via MCP tool
argument-hint: "<source>"
disable-model-invocation: true
---

# /eforge:build

Enqueue a PRD file or description for the eforge daemon to build. Uses the eforge MCP server which communicates with the daemon for orchestration, agent execution, and state management.

## Arguments

- `source` - PRD file path or inline description of what to build (required)

## Workflow

### Step 1: Validate Source

Check that `$ARGUMENTS` is provided:

- **File path**: Verify the file exists with the Read tool. Show a brief summary of what it describes.
- **Inline description**: Note that eforge will use this directly as the source prompt.

If no arguments provided:
1. Check if a **plan file** exists for the current conversation (e.g., under `~/.claude/plans/`). The plan file is the ideal source — it already has a title heading and structured content that the formatter and planner can work with cleanly. Pass its **file path** to the MCP tool.
2. If a plan file is found, read it with the Read tool and show a brief summary
3. Ask the user to confirm before proceeding
4. If no plan file is found, check the conversation for a PRD file path from a prior session
5. If no file is found at all, suggest creating a PRD file first
- **Stop here** if the user declines or no source is identified

### Step 2: Enqueue for Build

Call the `mcp__eforge__eforge_build` tool with `{ source: "<source>" }`.

The tool returns a JSON response with a `sessionId` and `autoBuild` status.

### Step 3: Report Result

After successful enqueue, tell the user:

> PRD enqueued (session: `{sessionId}`). The daemon will auto-build.
>
> The daemon formats your source into a PRD, selects a workflow profile, then compiles and builds. The pipeline varies by profile — errands skip straight to building, while excursions and expeditions go through planning and plan review first. Every profile gets blind code review (a separate agent with no builder context), merge, and post-merge validation.
>
> Use `/eforge:status` for a quick inline status check.

If the monitor is running, also include the monitor URL.

## Error Handling

| Error | Action |
|-------|--------|
| Source file not found | Check path, suggest alternatives |
| No arguments provided | Check conversation for relevant files; if none, ask the user |
| MCP tool returns error | Show the error message from the daemon response |
| Daemon connection failure | The MCP proxy auto-starts the daemon; if it still fails, suggest running `eforge daemon start` manually |
