---
title: Add active build guard to /eforge:update skill
created: 2026-03-26
status: pending
---

# Add active build guard to /eforge:update skill

## Problem / Motivation

The `/eforge:update` skill currently stops the daemon (Step 5) without checking whether any builds are actively running. This risks interrupting in-progress builds, potentially leaving artifacts in a broken or incomplete state.

## Goal

Prevent the `/eforge:update` skill from stopping the daemon while builds are actively running, ensuring all builds complete cleanly before any update proceeds.

## Approach

- Before stopping the daemon in Step 5 of the `/eforge:update` skill, call the `eforge_status` MCP tool to check for running builds.
- If any builds are actively running, abort the update immediately and inform the user they must wait until all builds have completed before updating.
- Do not offer a force or override option.

## Scope

**In scope:**
- Adding a pre-stop build status check to the `/eforge:update` skill at Step 5
- Calling the `eforge_status` MCP tool to detect active builds
- Aborting the update and displaying a user-facing message when active builds are detected

**Out of scope:**
- Adding a force/override flag or option to bypass the guard
- Waiting/polling for builds to complete automatically
- Changes to the `eforge_status` MCP tool itself

## Acceptance Criteria

- Before stopping the daemon in Step 5, the `/eforge:update` skill calls `eforge_status` to check for active builds.
- If one or more builds are actively running, the update is aborted and does not proceed to stop the daemon.
- The user is informed that they must wait until all builds have completed before updating.
- No force or override option is presented to the user.
- If no builds are running, the update proceeds normally through Step 5.
