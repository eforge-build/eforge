---
description: Read eforge state file and render inline status with plan progress and monitor link
disable-model-invocation: true
---

# /eforge:status

Quick inline status check - reads `.eforge/state.json` directly without invoking the eforge CLI.

## Workflow

### Step 1: Read State

Read the state file:

```bash
cat .eforge/state.json
```

If the file doesn't exist, report:

> No active eforge builds. Start a planning conversation to create a plan, then use `/eforge:enqueue` to queue it or `/eforge:run` to execute immediately.

**Stop here** if no state file exists.

### Step 2: Render Status

Parse the JSON and display:

**Plan Set**: `{setName}`
**Status**: `{status}` (running / completed / failed)
**Started**: `{startedAt}`
**Duration**: Calculate from `startedAt` to now if status is `running`

#### Plan Progress

Render a table of per-plan statuses:

| Plan | Branch | Status | Dependencies |
|------|--------|--------|-------------|
| `{planId}` | `{branch}` | `{status}` | `{dependsOn}` |

Status values: `pending`, `running`, `completed`, `failed`, `blocked`, `merged`

Completed plans count: `{completedPlans.length}` / `{total plans}`

### Step 3: Queue State

Check for pending PRDs in the queue directory. Use the Glob tool to find PRD files:

```
docs/prd-queue/*.md
```

If PRD files are found, read each file and parse the YAML frontmatter. Display a summary:

**Queue**: `{pendingCount}` pending PRD(s)

For each pending PRD, show the title. If there are more than 5, show the first 5 and a count of remaining.

### Step 4: Monitor Link

If the overall status is `running`, show:

> **Monitor**: http://localhost:4567
>
> The monitor dashboard shows real-time progress: event timeline, per-plan status, token/cost tracking, and run history.

If the status is `completed` or `failed`, omit the monitor link and show a summary instead:
- **Completed**: "All plans completed successfully. Post-merge validation was included in the run."
- **Failed**: Show which plans failed and suggest checking logs.

## Error Handling

| Condition | Action |
|-----------|--------|
| `.eforge/state.json` missing | Report no active builds, suggest starting a planning conversation |
| State file is malformed JSON | Report parse error, suggest running `eforge status` CLI directly |
| State file exists but empty | Treat as missing state |
