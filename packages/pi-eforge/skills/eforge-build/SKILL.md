---
name: eforge-build
description: Enqueue a source for the eforge daemon to build — PRD file, inline description, or conversation context. Use when the user wants to hand work off to eforge.
disable-model-invocation: true
---

# /eforge:build

Enqueue a PRD file or description for the eforge daemon to build. Uses the eforge tools which communicate with the daemon for orchestration, agent execution, and state management.

## Arguments

- `source` (optional) - PRD file path, session-plan path, or inline description of what to build
- `--infer` (optional) - Skip session-plan discovery and infer the source from conversation context. Used by Pi's native `/eforge:build` source selector.
- `--profile <name>` (optional) - Use this eforge agent runtime profile for the build instead of the active profile.
- `onSuccess` (optional) - Override the landing action for this build. One of `merge-to-base-branch`, `issue-pr`, or `leave-branch`. Precedence: this argument > PRD frontmatter > `build.onSuccess` in `eforge/config.yaml` > engine default (`merge-to-base-branch`). If omitted, the project config default applies. Note: `merge-to-base-branch` on the trunk branch requires `build.allowLocalMergeToTrunk: true` in `eforge/config.yaml`.

## Workflow

### Step 1: Resolve Source Input

Parse and remember any `--profile <name>` override before resolving the source. Determine the working source from one of four branches:

**Branch A — File path**: If `$ARGUMENTS` is a file path (ends in `.md`, `.txt`, `.yaml`, or contains `/`):
1. Verify the file exists with the Read tool
2. Show a brief summary of what it describes
3. Use the **file path** as the source — skip directly to **Step 4**

**Branch B — Inline description**: If `$ARGUMENTS` is provided but is not a file path:
1. Note the inline description as the working source
2. Proceed to **Step 2**

**Branch C — Infer from context**: If `$ARGUMENTS` includes `--infer`, skip session-plan discovery and go directly to Branch D step 2 (conversation-context inference). Remove the `--infer` flag from the working source; it is a control flag, not build content.

**Branch D — No source arguments**: If `$ARGUMENTS` is empty, not provided, or contains only control flags like `--profile`:

1. **Check for active session plan** — Call `eforge_session_plan { action: 'list-active' }` to discover active plans. If found:
   - If one plan exists, present a summary: "I found a planning session: _{topic}_. Status: {status}."
   - If multiple exist, list them by topic, most recent first, and ask which to use
   - If the session status is `ready`, use the **session plan file path** (`plan.path` from the response) as the source — skip directly to **Step 4**. **Do not read the file and rewrite, summarize, or convert it into a different format.** The eforge daemon handles PRD formatting; the session plan file is the source material it needs.
   - If the session status is `planning`, warn: "This session is still in planning — some dimensions are still missing." Then:
     - Call `eforge_session_plan { action: 'readiness', session }` to get the readiness report. Use `missingDimensions` to list what's truly missing and `skippedDimensions` to list what was intentionally skipped with reasons.
     - Recommend `/eforge:plan --resume` only if at least one dimension appears in `missingDimensions`.
     - Ask the user whether to submit as-is or continue planning (suggest `/eforge:plan --resume`)
   - If the user confirms a `planning` session, use the **session plan file path** as the source and proceed to **Step 4**

2. **Fall back to conversation context** — If `--infer` was provided, no session plans are found, or the user declines to use one:
   - Examine conversation context for intent signals:
     - Recently discussed features or requirements
     - Files the user has been editing or asking about
     - Errors or issues the user has been troubleshooting
     - Goals or tasks the user has stated
   - If context yields a reasonable description, present it: "Based on our conversation, it sounds like you want to build: _{inferred description}_. Is that right?"
     - If the user confirms, use that description as the working source and proceed to **Step 2**
     - If the user corrects, use their correction as the working source and proceed to **Step 2**

3. If no session plans and no context available, ask: "What would you like to build? You can provide a description or a path to a PRD file."
   - **Stop here** if the user declines or no source is identified

### Step 2: Assess Completeness

Evaluate the working source against the 5 PRD sections the formatter expects:

| Section | What to look for |
|---------|-----------------|
| **Problem/Motivation** | Why this needs to be built — pain point, gap, or opportunity |
| **Goal** | What the end result should be — the desired outcome |
| **Approach** | How to accomplish it — strategy, patterns, or technical approach |
| **Scope** | Boundaries — what's in and out of scope |
| **Acceptance Criteria** | How to verify it's done — testable conditions |

**Threshold rules:**
- If the working source is **short (~30 words or fewer)**, always proceed to **Step 3** (interview) — short sources benefit from enrichment regardless of apparent coverage
- If the working source covers **3 or more** of the 5 sections, skip to **Step 4** (confirm) — the formatter can handle the remaining gaps
- Otherwise, proceed to **Step 3** (interview) for the missing sections

### Step 3: Interview

Ask about **missing sections only**. Use the question lookup table below to formulate questions. Combine all questions into a **single message** (max 4 questions).

**Question lookup table:**

| Missing section(s) | Question |
|--------------------|----------|
| Problem/Motivation + Goal (both missing) | "What problem are you trying to solve, and what should the end result look like?" |
| Problem/Motivation (alone) | "What's the pain point or gap that motivates this change?" |
| Goal (alone) | "What should the end result look like when this is done?" |
| Approach | "Do you have a preferred approach or technical strategy in mind?" |
| Scope | "Is there anything explicitly out of scope or any boundaries to be aware of?" |
| Acceptance Criteria | "How will you know this is done? Any specific conditions to verify?" |

**Escape hatch**: If the user responds with "just build it", "skip", "go ahead", or any similar signal to decline elaboration, accept the working source as-is and proceed to **Step 4**. The formatter handles missing sections gracefully (fills them with "N/A").

After the user responds, incorporate their answers into the working source and proceed to **Step 4**.

### Step 4: Confirm Source Preview

#### Branch-aware landing behavior

When the current branch is the **trunk branch** (e.g. `main`) and the effective `onSuccess` is `merge-to-base-branch`:

- Trunk is protected from direct local merges unless `build.allowLocalMergeToTrunk: true` is set in `eforge/config.yaml`.
- Do **not** ask the user to create a feature branch in this flow. Prompt the user to choose one of the two valid resolutions before enqueueing: pass `onSuccess: "issue-pr"` for this build, or update `eforge/config.yaml` to set `build.allowLocalMergeToTrunk: true`.

When the current branch is a **feature branch**:

- `merge-to-base-branch` merges the artifact branch into the feature branch locally (no PR required for this step).
- `issue-pr` opens a PR from the artifact branch targeting the feature branch directly.
- `leave-branch` commits to the artifact branch and exits without merging or opening a PR.

<!-- parity-skip-start -->
Call the `eforge_confirm_build` tool with `{ source: "<the complete working source text>" }`. This opens an editor-first review flow where the user can revise the source directly, then choose confirm, revise again, or cancel from a compact keyboard-navigable selector.

For **file path sources** (Branch A from Step 1), pass a brief summary of the file contents as the source text (not the full file), and note the file path in the summary. Preserve the original file path as the working source unless the user explicitly asks to replace it with inline build text.

The tool returns a JSON object with a `choice` field and, on confirmation, may include the edited `source`. Handle each value:

- **`"confirm"`** - If the result includes `source` and the working source is not a file path, replace the working source with that returned edited source. For file path sources, keep the original file path unless the user explicitly chose to replace it with inline build text. Then proceed to **Step 5**.
- **`"edit"`** - Legacy resumed-session handling: ask the user what they'd like to revise, incorporate their changes, then call `eforge_confirm_build` again with the updated source
- **`"cancel"`** - Acknowledge the cancellation and stop
<!-- parity-skip-end -->

### Step 5: Enqueue & Report

First, validate the project config by calling the `eforge_config` tool with `{ action: "validate" }`.

- If `configFound` is `false`, stop and tell the user:
  > **No eforge config found.** Run `/eforge:init` to initialize eforge in this project.

  **Do not proceed to enqueue.**

- If `valid` is `false`, display the errors and stop:
  > **Config validation failed:**
  >
  > _{list each error}_
  >
  > Fix your config with `/eforge:config` and try again.

  **Do not proceed to enqueue.**

- If `valid` is `true`, continue silently.

Call the `eforge_build` tool with `{ source: "<source>" }`, using the latest working source (including the edited `source` returned by `eforge_confirm_build` on confirmation for non-file-path sources). If the user explicitly specified a profile override, include `profile: "<name>"` in the call. If the user explicitly specified an `onSuccess` override for this build, include `onSuccess: "<value>"` in the call.

<!-- parity-skip-start -->
If the user asks to choose a per-build landing action, use the native select UI with the three options (`merge-to-base-branch`, `issue-pr`, `leave-branch`) before calling the tool.
<!-- parity-skip-end -->

The tool returns a JSON response with a `sessionId` and `autoBuild` status.

After successful enqueue:

1. If the source came from a session plan file (Branch A path input, or Branch D session-plan selection), the daemon automatically updates the session file's status to `submitted` and records the session ID — no manual frontmatter edit is needed.

2. Tell the user:

> PRD enqueued (session: `{sessionId}`). The daemon will auto-build.
>
> Watch live in the monitor dashboard, or run `/eforge:status` later for a prompt status refresh.
>
> The daemon formats your source into a PRD, selects a workflow profile, then compiles and builds. The pipeline varies by profile — errands skip straight to building, while excursions and expeditions go through planning and plan review first. Every profile gets blind code review (a separate agent with no builder context), merge, and post-merge validation.

If the monitor is running, also include the monitor URL.

## Error Handling

| Error | Action |
|-------|--------|
| Source file not found | Check path, suggest alternatives |
| No arguments and no context available | Ask the user what they want to build |
| User cancels at confirmation | Acknowledge and stop |
| Tool returns error | Show the error message from the daemon response |
| Config validation fails | Show errors, suggest fixing config, do not enqueue |
| No config found | Tell the user to run `/eforge:init` to initialize eforge |

<!-- parity-skip-start -->
| Daemon connection failure | The daemon is not running. Tell the user to start it with `eforge_daemon { action: "start" }`, `/eforge:restart`, or `eforge daemon start`. |
<!-- parity-skip-end -->

## Related Skills

| Skill | When to suggest |
|-------|----------------|
| `/eforge:init` | No eforge config found in the project |
| `/eforge:build` | User wants to enqueue work for the daemon |
| `/eforge:config` | Config validation fails or user wants to view/edit config |
| `/eforge:status` | After enqueue, to check build progress |
