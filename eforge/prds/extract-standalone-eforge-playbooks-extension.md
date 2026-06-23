---
title: Extract standalone eforge-playbooks extension
created: 2026-06-22
---

# Extract standalone eforge-playbooks extension

## Problem / Motivation

Playbook workflow ownership is currently spread across kernel-adjacent surfaces instead of being owned by a standalone extension.

Current playbook ownership appears in:
- Client route constants and helpers: `packages/client/src/routes/route-map.ts`, `packages/client/src/api/playbook.ts`
- Monitor routes and services: `packages/monitor/src/routes/playbooks.ts`, `packages/monitor/src/routes/playbook-service.ts`
- Input workflow adapter: `packages/input/src/playbook-workflow.ts`
- CLI and MCP: `packages/eforge/src/cli/playbook.ts`, `packages/eforge/src/cli/mcp-proxy.ts`
- Pi commands and tools: `packages/pi-eforge/extensions/eforge/playbook-commands.ts`, `packages/pi-eforge/extensions/eforge/index.ts`
- Claude and Pi skills
- Console UI: `packages/console-ui/src/views/system/playbooks-section.tsx`
- Documentation

This work moves playbook workflow behavior out of daemon/client/host-owned surfaces and into a standalone first-party native extension while preserving existing user-facing behavior through extension-owned capabilities.

## Goal

Create a standalone first-party `eforge-playbooks` native extension that owns playbook management, autonomous playbook runs, and planning-mode playbook trigger behavior.

After migration, the daemon/client/kernel surfaces must no longer expose direct playbook-specific routes, client helpers, or core Console Playbooks ownership.

## Approach

- Add `eforge/extensions/eforge-playbooks/` with package manifest, extension `index.ts`, action modules, tests, README, and optional workstation assets.
- Update `pnpm-workspace.yaml` so the standalone `eforge-playbooks` extension package is registered in the workspace.
- Keep the build engine unchanged.
- Keep the build engine responsible only for consuming normalized build source and emitting events.
- Do not make the build engine own playbook authoring, listing, or UI behavior.
- Keep monitor ownership limited to generic extension hosting, contribution dispatch, and build queue handoff.
- Remove playbook-specific daemon routes once extension parity is in place.
- Remove playbook-specific route constants, direct API helpers, and wire types from `@eforge-build/client`.
- Do not mark direct playbook daemon/client APIs as long-lived compatibility APIs.
- Make consumers use generic extension contribution helpers for playbook behavior.
- Declare extension-owned playbook management and run capabilities.
- Declare an optional dependency or capability requirement on `eforge.plan.planning-mode-playbook` for planning-mode continuation.
- Move Console playbook management from the core System Playbooks section to extension-registered console contribution or workstation entries, similar to eforge-plan contribution patterns.
- Move shared playbook artifact logic from `packages/input/src/playbook-workflow.ts` into the extension, or keep it in `packages/input/src/playbook.ts` only as pure parser, compiler, and storage utilities.
- Remove or rename any `builtin:playbooks` workflow-adapter ownership language so behavior is extension-owned.
- Use a boundary-first migration by building the extension-owned action and workstation surface, migrating callers, and removing direct daemon/client playbook routes before accepting the session.
- Define extension-local actions for `list-playbooks`, `show-playbook`, `save-playbook`, `validate-playbook`, `copy-playbook`, `promote-playbook`, `demote-playbook`, and `run-playbook`.
- Keep stable action semantics even if action IDs are renamed through the manifest.
- Implement autonomous `run-playbook` by calling `ctx.buildQueue.enqueue(...)` with normalized build source.
- Do not import queue internals from monitor playbook services for autonomous `run-playbook`.
- Implement planning-mode `run-playbook` so it does not create a session plan.
- Implement planning-mode `run-playbook` so it does not enqueue PRDs.
- Implement planning-mode `run-playbook` so it returns eforge-plan contribution or deep-link metadata when the dependency is available.
- Implement planning-mode `run-playbook` so it returns actionable diagnostics when the dependency is unavailable.
- Update `packages/eforge/src/cli/playbook.ts` to call extension-owned contributions or generic extension invocation paths.
- Update `packages/eforge/src/cli/mcp-proxy.ts` to call extension-owned contributions or generic extension invocation paths.
- Update `packages/pi-eforge/extensions/eforge/playbook-commands.ts` to call extension-owned contributions or generic extension invocation paths.
- Update `packages/pi-eforge/extensions/eforge/index.ts` to call extension-owned contributions or generic extension invocation paths.
- Update `eforge-plugin/skills/playbook/playbook.md` to call extension-owned contributions or generic extension invocation paths.
- Update `packages/pi-eforge/skills/eforge-playbook/SKILL.md` to call extension-owned contributions or generic extension invocation paths.
- Keep `eforge-plugin/` and `packages/pi-eforge/` behavior in sync.
- Bump `eforge-plugin/.claude-plugin/plugin.json` when changing plugin skills or commands.
- Do not bump `packages/pi-eforge/package.json`.
- If CLI, MCP, Pi, or Claude compatibility commands remain for users, make them call extension-owned generic contribution APIs rather than playbook-specific daemon/client routes.
- If a short-lived adapter is needed while refactoring callers, delete it in the same session before acceptance.
- Start with a grep/source audit for `playbook`, `/api/playbook`, `eforge_playbook`, `PlaybooksSection`, `createPlaybookWorkflowAdapter`, `builtin:playbooks`, and `apiPlaybook` to prevent missed ownership surfaces.
- Update existing playbook tests rather than deleting coverage.
- Update tests that previously targeted direct daemon/client routes to assert removal or migration to extension-owned generic contribution APIs.
- Update docs that currently present playbooks as bundled, internal, or kernel-adjacent.
- Update playbooks docs.
- Update extensions docs.
- Update extensions API docs.
- Update configuration docs.
- Update integrations docs.
- Update getting started docs.
- Update concepts docs.
- Update profiles docs.
- Update glossary docs.
- Update Pi skill docs.
- Update Claude skill docs.
- Guard against compatibility-route regression.
- Guard against extension-unavailable states.
- Guard against planning dependency drift.
- Guard against cross-host drift.
- Guard against boundary regressions.
- Guard against large-file churn.
- Avoid new route literals outside `@eforge-build/client`.
- Avoid duplicated wire shapes outside `@eforge-build/client`.
- Use bounded edits in large files.
- Add a final boundary audit that fails or documents blockers if any direct `/api/playbook/*` daemon route, playbook-specific client helper, or kernel-owned Console Playbooks section remains.

## Scope

### In scope

- Add a standalone extension package and surface for playbook management.
- Add extension actions for list, show, save, validate, copy, promote, demote, and run.
- Make the extension own autonomous playbook runs by compiling the playbook to normalized build source and handing it to generic build intake or queue APIs.
- Make the extension own planning-mode playbook trigger behavior by checking the `eforge.plan.planning-mode-playbook` capability.
- Make planning-mode playbook behavior return generic eforge-plan planning entry metadata or actionable diagnostics.
- Move Claude Code host playbook commands, skills, and tools behind extension-owned capabilities.
- Move Pi host playbook commands, skills, and tools behind extension-owned capabilities.
- Keep `eforge-plugin/` and `packages/pi-eforge/` behavior in sync.
- Replace the core Console Playbooks system section with an extension contribution or workstation UX for playbook inventory and management.
- Remove direct daemon/client playbook-specific entrypoints after extension parity in this session.
- Do not retain `/api/playbook/*` routes as compatibility shims.
- Do not retain playbook-specific client API helpers as compatibility shims.
- Make any remaining CLI, MCP, Pi, or Claude compatibility commands call extension-owned generic contribution APIs rather than playbook-specific daemon/client routes.

### Out of scope

- Changing eforge-plan session-plan ownership beyond the planning-mode handoff contract.
- Adding arbitrary third-party custom playbook extraction APIs beyond what the extension contribution model supports.
- Expanding the build engine into scheduling, approvals, or richer workflow orchestration.

## Acceptance Criteria

- A standalone `eforge-playbooks` extension package is registered in the workspace.
- The standalone `eforge-playbooks` extension package builds successfully.
- The standalone `eforge-playbooks` extension package publishes like other first-party extensions.
- The standalone `eforge-playbooks` extension declares playbook management capabilities.
- The extension exposes an action for listing playbooks.
- The extension exposes an action for showing a playbook.
- The extension exposes an action for saving a playbook.
- The extension exposes an action for validating a playbook.
- The extension exposes an action for copying a playbook.
- The extension exposes an action for promoting a playbook.
- The extension exposes an action for demoting a playbook.
- The extension exposes an action for running a playbook.
- Extension actions preserve current mode behavior.
- Extension actions preserve current scope behavior.
- Extension actions preserve current shadow-chain behavior.
- Extension actions preserve current profile behavior.
- Extension actions preserve current landing behavior.
- Extension actions preserve current acceptance-criteria validation behavior.
- Autonomous playbook runs enqueue through generic extension build-queue handoff.
- Autonomous playbook runs preserve existing profile behavior.
- Autonomous playbook runs preserve existing landing behavior.
- Autonomous playbook runs preserve existing `afterQueueId` behavior.
- Planning-mode playbooks check the `eforge.plan.planning-mode-playbook` capability.
- Planning-mode playbooks return generic eforge-plan planning-entry metadata when the dependency is available.
- Planning-mode playbooks return unavailable diagnostics when the dependency is unavailable.
- Planning-mode playbooks do not directly create session plans.
- Planning-mode playbooks do not enqueue PRDs.
- Claude Code playbook commands invoke extension-owned capabilities or generic extension invocation paths.
- Claude Code playbook skills invoke extension-owned capabilities or generic extension invocation paths.
- Claude Code playbook tools invoke extension-owned capabilities or generic extension invocation paths.
- Pi playbook commands invoke extension-owned capabilities or generic extension invocation paths.
- Pi playbook skills invoke extension-owned capabilities or generic extension invocation paths.
- Pi playbook tools invoke extension-owned capabilities or generic extension invocation paths.
- `eforge-plugin/` and `packages/pi-eforge/` expose consistent user-facing playbook capabilities.
- `eforge-plugin/.claude-plugin/plugin.json` version is bumped when plugin skills or commands are changed.
- `packages/pi-eforge/package.json` version is not bumped.
- Console playbook management is available through extension contribution or workstation UX.
- Console playbook management is not owned by a core Console Playbooks system section.
- Direct daemon playbook routes are removed after extension parity.
- `/api/playbook/*` routes are not retained as compatibility shims.
- Playbook-specific client API helpers are removed after extension parity.
- `apiPlaybook*` client helpers are not retained as compatibility shims.
- Tests assert direct playbook route removal.
- Tests assert playbook-specific client API helper removal.
- Tests assert extension-owned action coverage.
- Tests assert user-facing command behavior through extension-owned paths.
- Tests assert extension package registration.
- Tests assert action schemas.
- Tests assert capability and dependency diagnostics.
- Tests assert autonomous enqueue handoff.
- Tests assert planning-mode eforge-plan handoff.
- Updated `test/playbook-*.test.ts` coverage passes.
- Updated `test/cli-playbook.test.ts` coverage passes.
- Updated `test/pi-playbook-commands.test.ts` coverage passes.
- Updated `test/eforge-playbook-planning-contract.test.ts` coverage passes.
- Updated `packages/monitor/src/__tests__/routes-playbooks.test.ts` coverage passes.
- Updated session-plan-from-playbook coverage passes.
- Docs describe playbooks as extension-owned workflow behavior.
- Docs do not document direct daemon/client playbook routes as supported entrypoints.
- A final boundary audit finds no direct `/api/playbook/*` daemon routes.
- A final boundary audit finds no playbook-specific client helper.
- A final boundary audit finds no kernel-owned Console Playbooks section.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm docs:check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Run targeted tests before running the full validation commands.
- Manually verify extension discovery, trust, and reload behavior.
- Manually verify extension contribution invocation.
- Manually verify Pi `/eforge:playbook` behavior.
- Manually verify Claude `/eforge:playbook` behavior.
- Manually verify CLI behavior through extension-owned paths.
- Manually verify MCP behavior through extension-owned paths.
- Manually verify Console workstation or contribution visibility.
- Manually verify behavior when `eforge-playbooks` is unavailable.
- Manually verify behavior when `eforge-plan` is unavailable.