---
description: Normalize any input and add it to the eforge queue
argument-hint: "<source>"
disable-model-invocation: true
---

# /eforge:enqueue

Normalize a source document (PRD file, inline prompt, or rough notes) and add it to the eforge queue. This skill runs the eforge CLI's `enqueue` command, which uses a formatter agent to produce a well-structured PRD with frontmatter.

**Prerequisite**: `eforge` CLI must be installed and on PATH.

## Arguments

- `source` — file path to a PRD, plan, or markdown document; or an inline description of what to build

## Workflow

### Step 1: Validate Source

Check that `$ARGUMENTS` is provided:

- **File path**: Verify the file exists with the Read tool. Show a brief summary of what it describes.
- **Inline description**: Note that eforge will use this directly as the source prompt.
- **Nothing provided**: Check the current conversation for a plan file or PRD that could be enqueued. If none found, ask the user what they want to enqueue.

**Stop here** if no source is identified.

### Step 2: Enqueue

Run the eforge enqueue command:

```bash
eforge enqueue $SOURCE
```

This will:
1. Read the source content
2. Run the formatter agent to normalize it into a well-structured PRD
3. Write the formatted PRD with YAML frontmatter to the queue directory (`docs/prd-queue/` by default)

### Step 3: Report Result

After successful enqueue, tell the user:

> Enqueued: **{title}** -> `{filePath}`
>
> Next steps:
> - `/eforge:run --queue` to process the queue
> - `/eforge:run {filePath}` to build this PRD directly
> - `/eforge:status` to check build progress

## Error Handling

| Error | Action |
|-------|--------|
| `eforge` not found | Tell user to install eforge CLI and ensure it's on PATH |
| Source file not found | Check path, suggest alternatives |
| No arguments provided | Check conversation for relevant files; if none, ask the user |
| Enqueue fails | Show error output, suggest checking the source format |
