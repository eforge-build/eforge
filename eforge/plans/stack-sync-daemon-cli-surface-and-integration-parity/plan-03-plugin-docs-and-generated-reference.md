---
id: plan-03-plugin-docs-and-generated-reference
name: Claude Plugin Parity, Docs, and Generated References
branch: stack-sync-daemon-cli-surface-and-integration-parity/plan-03-plugin-docs-and-generated-reference
---

# Claude Plugin Parity, Docs, and Generated References

## Architecture Context

Consumer-facing integration packages must stay in sync: `eforge-plugin/` for Claude Code and `packages/pi-eforge/` for Pi. This plan completes the documentation/parity pass after daemon/CLI/Pi surfaces exist. It also regenerates reference docs so new CLI commands, daemon routes, and tool surfaces are reflected in `web/content/reference/*` and `web/public/reference/*`.

## Implementation

### Overview

Expose Claude plugin skill/tool docs for stack sync and workflow preset configuration, bump the Claude plugin version, update stacking/config/roadmap docs, and regenerate generated references. If Claude Code cannot provide a native select-overlay wizard equivalent, document that technical limitation and provide the conversational skill flow plus MCP tool calls that match the same preset and stack sync capabilities.

### Key Decisions

1. Prefer real plugin tool parity where feasible: add `eforge_stack_sync` to the MCP proxy if plan 01 exposes the daemon route; document a skill flow for workflow presets if Claude Code lacks Pi-style overlays.
2. Keep workflow preset key lists in docs sourced from the shared recipe names/outputs; avoid inventing config keys in prose.
3. Remove the automated restack/sync roadmap item because manual stack sync and optional sync config are now documented shipped surfaces, while daemon polling remains a follow-up described only as configuration shape.

## Scope

### In Scope

- Claude plugin skill/tool documentation for stack sync and workflow preset setup/reconfiguration.
- Claude plugin version bump in `eforge-plugin/.claude-plugin/plugin.json`.
- `docs/stacking.md` updates for `eforge stack sync`, `--dry-run`, stack-sync opt-in, active-build skips, pre-landing reconciliation, conflicts/recovery, optional sync config, and protected-vs-solo trunk behavior.
- `docs/config.md` updates for all five workflow presets and exact config keys written by each preset, plus Pi workflow wizard description.
- `docs/roadmap.md` removal of the automated post-merge restack/sync roadmap bullet.
- Generated reference updates after `pnpm docs:generate`.
- Static tests for plugin/Pi docs parity where existing tests already check skill parity.

### Out of Scope

- Implementing daemon polling for `stacking.sync.mode: poll`.
- Adding new workflow presets beyond the five from the source.
- Bumping `packages/pi-eforge/package.json`.

## Files

### Create

- `eforge-plugin/skills/stack/stack.md` — Claude skill docs for manual stack sync, dry-run, report interpretation, and conflict recovery.
- `eforge-plugin/skills/workflow/workflow.md` — Claude skill docs for conversational workflow preset setup/reconfiguration, including technical note for lack of native Pi select overlays if applicable.
- `packages/pi-eforge/skills/eforge-stack/SKILL.md` and/or `packages/pi-eforge/skills/eforge-workflow/SKILL.md` — only if skill parity checks require Pi skill docs for the new native commands.
- `test/stack-sync-surface-docs.test.ts` — static checks for CLI/plugin/Pi docs mentioning stack sync dry-run, workflow presets, and plugin version bump.

### Modify

- `packages/eforge/src/cli/mcp-proxy.ts` — add `eforge_stack_sync` tool if not already present; call `API_ROUTES.stackSync` via shared daemon request helper; optionally add workflow preset tool only if shared typed workflow APIs already exist.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin version and add new skill command files to `commands`.
- `eforge-plugin/skills/init/init.md` and/or `eforge-plugin/skills/config/config.md` — link to workflow preset skill and explain when to use it.
- `packages/pi-eforge/README.md` — list the new workflow and stack sync commands/tools.
- `docs/stacking.md` — replace stale “eforge does not run restack or sync” wording with manual command and opt-in sync configuration details from the source.
- `docs/config.md` — add workflow presets section and Pi wizard description.
- `docs/roadmap.md` — remove “Automated post-merge restack/sync”.
- `packages/docs-gen/src/generators/api.ts`, `cli.ts`, `tools.ts`, or generated reference files — update generator inputs only if automatic discovery misses the new route/CLI/tool surfaces, then run `pnpm docs:generate`.
- `web/content/reference/api.md`, `web/content/reference/cli.md`, `web/content/reference/tools.md`, `web/public/reference/api.md`, `web/public/reference/cli.md`, `web/public/reference/tools.md` — regenerated artifacts when changed by docs generation.

## Verification

- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is greater than the pre-plan version and includes any new skill files.
- [ ] Claude plugin docs mention `eforge_stack_sync` or explain why a Claude-native stack sync tool is unavailable; if unavailable, the docs include the daemon/CLI workaround.
- [ ] Claude plugin workflow docs mention all four user questions: solo/team, direct merge/PR, stacked PRs, and automatic stack sync.
- [ ] `docs/stacking.md` contains `eforge stack sync --dry-run`, `stacking.sync.enabled`, active-build skip behavior, pre-landing reconciliation, conflict recovery, and fast-forward-only trunk policy.
- [ ] `docs/config.md` lists all five workflow presets and the explicit config keys each preset writes.
- [ ] `docs/roadmap.md` no longer contains “Automated post-merge restack/sync”.
- [ ] `pnpm docs:generate` followed by `pnpm docs:check` exits 0.
