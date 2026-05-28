---
id: plan-03-consumer-surfaces-docs
name: Consumer Surfaces and Documentation
branch: add-first-class-dependency-handoff-for-builds/plan-03-consumer-surfaces-docs
agents:
  builder:
    effort: high
    rationale: Keeps Pi and Claude Code plugin surfaces in parity while updating
      skill docs and bounded sections of large extension files.
  reviewer:
    effort: high
    rationale: Consumer-facing schema, skill, plugin-version, and documentation
      changes need parity review.
  tester:
    effort: high
    rationale: Needs source-wiring tests plus Pi native-command behavior tests.
  doc-syncer:
    effort: medium
    rationale: Several user-facing docs and skill files must describe the new flag
      and deterministic handoff behavior consistently.
---

# Consumer Surfaces and Documentation

## Architecture Context

After plans 01 and 02 add the API and placement semantics, user-facing integrations need to expose the same deterministic handoff. Repo policy requires `packages/pi-eforge/` and `eforge-plugin/` to stay in sync for consumer-facing behavior, and the Claude plugin version must be bumped when plugin files change.

## Implementation

### Overview

Add optional `afterQueueId` to the `eforge_build` MCP/Pi tool schemas and forwarding bodies. Extend the native Pi `/eforge:build` command with a wait-or-run-now selection for active queue items, modeled on `playbook-commands.ts`. Update Pi and Claude build skill docs to parse `--after <queue-id>` and pass `afterQueueId` to the build tool. Update user docs to explain explicit deterministic handoff, active vs completed placement, and single-dependency stack inference.

### Key Decisions

1. Keep Pi native UI user-friendly: show active build titles/statuses, send the resolved queue id internally.
2. Keep non-interactive and script paths deterministic via `--after <queue-id>` and direct tool `afterQueueId`.
3. Bump `eforge-plugin/.claude-plugin/plugin.json` because plugin-visible behavior changes.
4. Prefer shared Pi UI helper extraction only if it avoids duplicating the playbook active-build selector without creating circular imports.

## Scope

### In Scope

- Add optional `afterQueueId` to `eforge_build` schema and request body forwarding in `packages/pi-eforge/extensions/eforge/index.ts`.
- Add optional `afterQueueId` to `eforge_build` schema and request body forwarding in `packages/eforge/src/cli/mcp-proxy.ts` for Claude Code plugin parity.
- Extend `packages/pi-eforge/extensions/eforge/build-command.ts` so UI mode lists active queue items, offers “Run now”, and appends `--after <queue-id>` when the user chooses an upstream.
- Reuse or extract the active-build fetch/filter/select pattern from `packages/pi-eforge/extensions/eforge/playbook-commands.ts` where that keeps file ownership simple.
- Update `packages/pi-eforge/skills/eforge-build/SKILL.md` to document `--after <queue-id>` and to pass `afterQueueId` in `eforge_build` calls.
- Update `eforge-plugin/skills/build/build.md` with the same `--after <queue-id>` behavior and `mcp__eforge__eforge_build` payload guidance.
- Bump `eforge-plugin/.claude-plugin/plugin.json` patch version.
- Update `README.md`, `docs/architecture.md`, `docs/config.md`, and `docs/stacking.md` only where the new behavior changes existing build/dependency/stack wording.
- Add/update tests for Pi tool forwarding, MCP tool schema/forwarding, Pi native build wait selection, skill parity, and docs route/type references.

### Out of Scope

- New monitor UI state.
- Multi-dependency selection UI.
- Manual stack-parent UI.
- Pi package version bump in `packages/pi-eforge/package.json`.

## Files

### Create

- Optional: `packages/pi-eforge/extensions/eforge/build-dependency-selection.ts` — shared Pi helper for active-build fetching and wait-option formatting if the implementation would otherwise duplicate more than a small helper block.

### Modify

- `packages/pi-eforge/extensions/eforge/index.ts` — add `afterQueueId` to `eforge_build` tool schema and enqueue body.
- `packages/eforge/src/cli/mcp-proxy.ts` — add `afterQueueId` to `eforge_build` schema and enqueue body.
- `packages/pi-eforge/extensions/eforge/build-command.ts` — add active-build wait selection and append `--after <id>` to the skill args.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — export or reuse active-build helper only if shared extraction is chosen.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — document `--after <queue-id>` and tool payload behavior.
- `eforge-plugin/skills/build/build.md` — mirror Pi build skill documentation with MCP tool naming.
- `eforge-plugin/.claude-plugin/plugin.json` — bump plugin patch version.
- `README.md` — add CLI/user-facing example for `eforge build --after <queue-id>` or `eforge enqueue --after <queue-id>`.
- `docs/architecture.md` — clarify build handoff writes active dependencies to `waiting/` and completed-artifact dependencies to queue root.
- `docs/config.md` — update PRD queue/dependency text for explicit `--after` handoff.
- `docs/stacking.md` — state that a single explicit dependency from `afterQueueId` participates in existing stack-parent inference when stacking is enabled.
- `test/profile-wiring.test.ts` or a focused MCP/Pi wiring test — assert both `eforge_build` schemas include `afterQueueId` and both handlers forward it.
- `test/pi-build-command.test.ts` — assert native `/eforge:build` appends `--after <id>` when the active-build wait option is selected and preserves landing/profile args.
- `test/build-profile-selection-skill.test.ts` or a new skill-doc test — assert Pi and Claude build skill docs mention `--after <queue-id>` and include `afterQueueId` in build tool calls.

## Verification

- [ ] Pi `eforge_build` schema accepts optional `afterQueueId`.
- [ ] Pi `eforge_build` request body includes `afterQueueId` when supplied.
- [ ] MCP `eforge_build` schema accepts optional `afterQueueId`.
- [ ] MCP `eforge_build` request body includes `afterQueueId` when supplied.
- [ ] Native Pi `/eforge:build` UI mode offers “Run now” plus active build wait options when queue items are active.
- [ ] Native Pi `/eforge:build` appends `--after <queue-id>` to `/skill:eforge-build` args when a wait option is selected.
- [ ] Native Pi `/eforge:build` omits `--after` when “Run now” is selected.
- [ ] Pi and Claude build skill docs both document `--after <queue-id>`.
- [ ] Pi and Claude build skill docs both instruct tool callers to send `afterQueueId` when `--after` is present.
- [ ] Claude plugin version in `eforge-plugin/.claude-plugin/plugin.json` increases by one patch version.
- [ ] Documentation states explicit handoff is deterministic and dependency detector inference remains best effort.
- [ ] Documentation states a single explicit dependency becomes the stack parent when stacking is enabled.
- [ ] Documentation states active upstream dependencies wait and completed-artifact upstream dependencies enqueue as eligible dependents.
