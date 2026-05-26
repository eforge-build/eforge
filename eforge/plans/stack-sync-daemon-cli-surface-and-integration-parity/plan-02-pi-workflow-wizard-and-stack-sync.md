---
id: plan-02-pi-workflow-wizard-and-stack-sync
name: Pi Workflow Wizard and Stack Sync Entry Point
branch: stack-sync-daemon-cli-surface-and-integration-parity/plan-02-pi-workflow-wizard-and-stack-sync
agents:
  builder:
    effort: high
    rationale: Native Pi command flow spans config mutation, overlay UX, shared
      workflow preset logic, and dry-run stack sync reporting.
---

# Pi Workflow Wizard and Stack Sync Entry Point

## Architecture Context

`packages/pi-eforge` is the native Pi integration. It must stay in sync with the Claude plugin and use shared daemon/client APIs instead of inlining HTTP helpers. Current Pi code registers native commands for build, status, restart, plan, profile, config, and playbook, but no workflow wizard or stack sync entry point exists.

Workflow preset config changes must come from the shared recipe logic in `packages/engine/src/workflow-presets.ts` or typed daemon workflow APIs if those are available on the predecessor branch. The Pi wizard may orchestrate questions and confirmation, but it must not duplicate preset mutation rules.

## Implementation

### Overview

Add native Pi workflow setup/reconfiguration commands backed by pure helper functions and shared preset recipe logic. Add a Pi stack sync tool/command that calls the stack sync client helper from plan 01 and renders the same structured report, including dry-run mode.

### Key Decisions

1. Put pure wizard decision, preset-selection, summary, and config-diff helpers in a Pi-local helper module so tests can run without Pi SDK imports.
2. Use `showSelectOverlay` or `showSearchableSelectOverlay` for every fixed-choice question: solo/team, direct merge/PR, stacked PRs, automatic stack sync, git-spice remediation, and final confirmation.
3. Make initial setup and reconfiguration separate command entry points (`/eforge:workflow:init` and `/eforge:workflow:reconfigure`) and also expose a menu command (`/eforge:workflow`) for discoverability.
4. Keep Pi daemon access no-start by using `apiStackSyncIfRunning`/`piDaemonRequest` style helpers; show the existing daemon-not-running guidance when sync is requested without a live daemon.

## Scope

### In Scope

- Native Pi workflow wizard command for initial config.
- Native Pi workflow wizard command for reconfiguration.
- User-oriented wizard questions covering solo vs team, direct merge vs PR, stacked PRs, and automatic stack sync.
- Plain-language workflow summary and config-change summary/diff before write.
- Explicit confirmation before writing `eforge/config.yaml` or calling a daemon workflow API.
- git-spice availability remediation choices: continue with stacking disabled, cancel, or configure git-spice command path.
- Native Pi stack sync tool/command with dry-run mode.
- Pure helper tests for wizard decision mapping and config diff/summary behavior.

### Out of Scope

- New workflow preset recipes.
- New daemon workflow preset APIs unless the predecessor branch already exposes them.
- Periodic stack sync polling.
- Changing Pi package version in `packages/pi-eforge/package.json`.

## Files

### Create

- `packages/pi-eforge/extensions/eforge/workflow-wizard.ts` — native wizard command handler and config write orchestration.
- `packages/pi-eforge/extensions/eforge/workflow-wizard-helpers.ts` — Pi-free helper functions for answer-to-preset mapping, summaries, git-spice remediation decisions, and config diff/change summaries.
- `packages/pi-eforge/extensions/eforge/stack-sync-command.ts` — native command/tool handler and report formatting for stack sync.
- `test/pi-workflow-wizard-helpers.test.ts` — pure helper tests with no Pi SDK imports.

### Modify

- `packages/pi-eforge/extensions/eforge/index.ts` — register `eforge_stack_sync` tool, `/eforge:stack:sync`, `/eforge:workflow`, `/eforge:workflow:init`, and `/eforge:workflow:reconfigure` commands; import only `*IfRunning` client helpers for daemon calls.
- `packages/pi-eforge/extensions/eforge/ui-helpers.ts` — add a confirm/select helper only if existing `showSelectOverlay` cannot express confirmation with two choices.
- `packages/pi-eforge/extensions/eforge/config-command.ts` — optionally link to the workflow wizard from the config panel.
- `packages/pi-eforge/README.md` and/or Pi skills only if native command discovery docs need an update before the docs parity plan.
- `test/pi-no-start-policy.test.ts` — include new Pi imports in the no-start policy check if the test has an allowlist.

## Verification

- [ ] Pure helper tests map the four wizard answer dimensions to each of the five shared workflow presets.
- [ ] Pure helper tests produce a config-change summary containing every key changed by a selected preset and no keys outside that preset output.
- [ ] Wizard command code uses `showSelectOverlay` or `showSearchableSelectOverlay` for preset-affecting choices and contains no prompt asking the user to type a preset identifier.
- [ ] Selecting a stacking preset with git-spice unavailable can produce each of these outcomes in helper tests: stacking disabled, cancelled, configured command path.
- [ ] The final write path calls the shared workflow preset recipe or typed workflow client helper exactly once per confirmed write.
- [ ] `eforge_stack_sync` accepts `dryRun: true` and calls `apiStackSyncIfRunning` or `requireDaemon` with `{ dryRun: true }`.
- [ ] `pnpm type-check` reports no Pi extension import of non-`IfRunning` daemon helpers for new ambient command paths.
