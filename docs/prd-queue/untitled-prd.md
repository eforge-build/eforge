---
title: Untitled PRD
created: 2026-03-24
status: pending
---

# Fix "Untitled PRD" Bug for Inline MCP Descriptions

## Problem / Motivation

Inline descriptions enqueued via the MCP `eforge_build` tool always get "Untitled PRD" as their title. This happens because `inferTitle()` runs on the raw source content before the formatter processes it. For multi-line inline descriptions, there's no `# ` heading and no filename fallback slug, so the inference falls through to the hardcoded "Untitled PRD" default.

## Goal

Ensure that inline descriptions enqueued via `eforge_build` receive a meaningful, content-derived title instead of the generic "Untitled PRD" fallback.

## Approach

1. **Update the formatter prompt** (`src/engine/prompts/formatter.md`) to output a concise `# Title` heading as the first line of its response, above the PRD sections.
2. **In `src/engine/eforge.ts` `enqueue()`**, move the `inferTitle()` call from line 283 (before formatting) to after line 296 (after formatting), so it operates on `formattedBody` instead of `sourceContent`. Keep `options.name` as the priority override.

No changes to `inferTitle()` itself; the existing heading regex + fallback chain remains as a safety net.

## Scope

**In scope:**
- `src/engine/prompts/formatter.md` — add title heading instruction
- `src/engine/eforge.ts` — reorder `inferTitle()` call to run on formatted output

**Out of scope:**
- Changes to `inferTitle()` logic itself
- Any other files or subsystems

## Acceptance Criteria

- Enqueue an inline description via `eforge_build` and verify the resulting PRD file contains a meaningful inferred title, not "Untitled PRD."
- Verify the git commit message for the enqueue also contains the meaningful inferred title.
- `options.name`, when provided, still takes priority over the inferred title.
