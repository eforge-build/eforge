---
id: plan-01-build-guard
name: Add Active Build Guard to Update Skill
depends_on: []
branch: add-active-build-guard-to-eforge-update-skill/build-guard
---

# Add Active Build Guard to Update Skill

## Architecture Context

The `/eforge:update` skill (`eforge-plugin/skills/update/update.md`) is a `disable-model-invocation` skill that walks users through updating the eforge CLI, restarting the daemon, and updating the plugin. Step 5 stops and restarts the daemon without checking whether builds are in progress. The `eforge_status` MCP tool returns a JSON object with a `status` field (`'running'`, `'completed'`, `'failed'`, `'idle'`, `'unknown'`) that can be used to detect active builds.

## Implementation

### Overview

Insert a new sub-step at the beginning of Step 5 that calls `mcp__eforge__eforge_status` to check for active builds. If the status is `'running'`, abort the update and inform the user. Otherwise, proceed with the existing daemon stop/start logic.

### Key Decisions

1. Check `status` field from `eforge_status` response for `'running'` value - this is the canonical indicator of an active build session.
2. Abort immediately with no force/override option - the PRD explicitly excludes bypass mechanisms.
3. Place the guard at the top of Step 5, before `eforge daemon stop` - this is the last safe point before the daemon is interrupted.

## Scope

### In Scope
- Adding a build status check using `mcp__eforge__eforge_status` at the start of Step 5
- Abort message when active builds are detected
- Adding an error handling row for the active build case

### Out of Scope
- Force/override flag
- Auto-waiting or polling for build completion
- Changes to the `eforge_status` MCP tool itself
- Changes to any other skill files

## Files

### Modify
- `eforge-plugin/skills/update/update.md` - Add a pre-stop guard in Step 5 that calls `mcp__eforge__eforge_status`, checks for `status: 'running'`, and aborts the update if active builds are detected. Also add a row to the Error Handling table for this case.

## Verification

- [ ] Step 5 in `eforge-plugin/skills/update/update.md` begins with a sub-step that calls `mcp__eforge__eforge_status`
- [ ] When the status response contains `status: 'running'`, the skill instructs to abort the update and not proceed to `eforge daemon stop`
- [ ] The abort message tells the user to wait until all builds complete before retrying
- [ ] No force or override option is mentioned anywhere in the skill
- [ ] When no builds are running (status is not `'running'`), the skill proceeds with `eforge daemon stop` and `eforge daemon start` as before
- [ ] The Error Handling table includes a row for the active-build-detected case
