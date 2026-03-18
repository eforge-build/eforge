---
description: Dogfood queue watcher - rebuilds eforge between each queue cycle so self-modifications take effect. Loops at the Claude Code level with a full pnpm build before every eforge run.
disable-model-invocation: true
---

# /eforge-dogfood-watch

Watch the PRD queue and process items with a full eforge rebuild between each cycle. This is for dogfooding eforge on its own codebase - since eforge modifies its own source during builds, the running Node.js process would use stale code. This skill loops at the Claude Code level so each `eforge run --queue` invocation uses a freshly compiled binary.

**Prerequisite**: Must be run from the eforge project root with `pnpm` available.

## State

Track these across iterations:

- `consecutive_all_fail_count` - number of consecutive cycles where every PRD failed (starts at 0)

## Workflow

Loop through Steps 1-4 continuously. Each iteration rebuilds eforge, checks the queue, and processes one cycle.

### Step 1: Build

Run a full build to pick up any source changes from the previous cycle:

```bash
pnpm build
```

**On build failure**: Stop the loop immediately. Show the build error and tell the user to fix it before restarting. Do not continue to Step 2.

**On success**: Report the build succeeded and continue.

### Step 2: Check Queue

Look for pending PRDs in the queue:

1. Use the Glob tool to find files matching `docs/prd-queue/*.md`
2. For each file found, use the Read tool to check its YAML frontmatter `status` field
3. Count PRDs with `status: pending` (or no status field, which defaults to pending)

**If pending PRDs found**: Report the count (e.g., "Found 3 pending PRDs in queue") and continue to Step 3.

**If no pending PRDs found**: Report "No pending PRDs in queue. Polling again in 30 seconds." Then:

```bash
sleep 30
```

After sleeping, loop back to **Step 1** (rebuild before rechecking, since source may have changed).

### Step 3: Run Queue

Run eforge to process the queue as a single cycle (no `--watch`):

```bash
eforge run --queue --auto --verbose
```

Use `run_in_background: true` on the Bash tool call. Wait for the background task to complete before continuing.

- `--auto` bypasses approval gates
- `--verbose` streams detailed output
- Do NOT use `--watch` - this skill IS the watch loop

### Step 4: Report and Loop

When the queue run completes:

1. Report the outcome - how many PRDs succeeded, failed, or were skipped
2. Update `consecutive_all_fail_count`:
   - If every PRD in this cycle failed: increment the counter
   - If any PRD succeeded: reset the counter to 0
3. Check exit conditions (see below)
4. If no exit condition met, loop back to **Step 1**

## Exit Conditions

Stop the loop when any of these occur:

| Condition | Action |
|-----------|--------|
| Build failure (Step 1) | Stop immediately, show error |
| User says stop | Stop gracefully, report final summary |
| 3 consecutive all-fail cycles | Stop and report: "Stopping after 3 consecutive cycles where every PRD failed. This suggests a systemic issue - check build pipeline or PRD definitions." |

## Error Handling

| Error | Action |
|-------|--------|
| `pnpm build` fails | Stop the loop, show build output |
| `eforge` not found | Tell user to ensure eforge CLI is on PATH |
| No `docs/prd-queue/` directory | Tell user no queue directory exists, suggest running `/eforge:enqueue` first |
| Single PRD failure in a mixed cycle | Continue looping - only consecutive all-fail triggers exit |
