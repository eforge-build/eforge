---
title: Fix: Use actual monitor URL from lockfile in run skill
created: 2026-03-19
status: pending
---

## Problem / Motivation

The `/eforge:run` skill hardcodes `http://localhost:4567` as the monitor URL in three places (normal, queue, and watch mode). When port 4567 is already in use, the monitor server starts on a different port (e.g. 4568), but the skill still reports the hardcoded URL - giving users a broken link. The actual port is written to `.eforge/monitor.lock` (a JSON file with `pid`, `port`, `startedAt` fields) by the server subprocess, but the skill never reads it.

## Goal

The run skill should read the monitor lockfile after launch and report the actual monitor URL instead of a hardcoded one, so users always get a working link regardless of which port the monitor bound to.

## Approach

- **File**: `eforge-plugin/skills/run/run.md` - Add a new step between the current Step 2 (Launch) and Step 3 (Monitor) that reads the lockfile:
  - After launching the background task, wait briefly (~3 seconds) for the monitor server to start.
  - Read `.eforge/monitor.lock` from the project root's `.eforge/` directory.
  - Parse the JSON and construct the URL as `http://localhost:{port}`.
  - If the lockfile doesn't exist or can't be read, fall back to `http://localhost:4567`.
- **Update Step 4 (formerly Step 3): Monitor** - Replace all three hardcoded `http://localhost:4567` references with the URL obtained from the lockfile.
- **File**: `eforge-plugin/.claude-plugin/plugin.json` - Bump the plugin version per project conventions.

## Scope

**In scope:**
- Adding lockfile read step to `eforge-plugin/skills/run/run.md`
- Replacing all three hardcoded `http://localhost:4567` URLs (normal, queue, and watch mode) with the dynamically read URL
- Handling timing (brief wait for server startup) and missing-file fallback
- Bumping plugin version in `eforge-plugin/.claude-plugin/plugin.json`

**Out of scope:**
- Changes to the monitor server itself or how it writes the lockfile
- Changes to the engine or CLI code

## Acceptance Criteria

- The run skill reads `.eforge/monitor.lock` after launching the background task and extracts the `port` field to construct the monitor URL.
- A ~3 second wait is included before reading the lockfile to allow the monitor server time to start.
- If the lockfile is missing or unreadable, the skill falls back to `http://localhost:4567`.
- All three hardcoded `http://localhost:4567` references (normal, queue, and watch mode) are replaced with the dynamically determined URL.
- Running eforge with port 4567 already in use results in the skill reporting the correct fallback port (e.g. `http://localhost:4568`).
- The plugin version in `eforge-plugin/.claude-plugin/plugin.json` is bumped.
