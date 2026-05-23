---
id: plan-04-consumer-surfaces
name: Reconcile CLI MCP Pi and Claude Consumer Surfaces
branch: complete-first-class-stacked-pr-and-git-spice-support/plan-04-consumer-surfaces
agents:
  builder:
    effort: high
    rationale: This plan touches both consumer integration packages and must keep Pi
      and Claude plugin capabilities in sync.
  reviewer:
    effort: high
    rationale: Review must verify plugin/Pi parity, compatibility aliases, and
      plugin version bump.
---

# Reconcile CLI MCP Pi and Claude Consumer Surfaces

## Architecture Context

User-facing surfaces still teach `build.onSuccess` and old aggregation semantics. The runtime keeps legacy `onSuccess` as a transitional wire field, but new docs and tool descriptions must prefer `landing.action` vocabulary (`pr|merge|leave`) and expose stack configuration choices. `AGENTS.md` requires `eforge-plugin/` and `packages/pi-eforge/` to stay in sync.

## Implementation

### Overview

Add user-facing `landing.action` vocabulary and stack setup options to CLI/MCP/Pi/Claude surfaces while preserving existing `onSuccess` values as compatibility aliases. Update skills/tool descriptions to explain direct PR landing and git-spice-backed stacking. Bump the Claude plugin version when plugin files change.

### Key Decisions

1. Keep daemon HTTP requests using `onSuccess` for compatibility unless plan-03/plan-02 has already added a shared `landingAction` wire field; map any new user-facing `landingAction` alias to the existing legacy value before enqueue/run.
2. Prefer config writes to `landing.action` and `stacking.*`; write `build.onSuccess` only when a caller explicitly uses the legacy alias.
3. Expose `stacking.enabled`, `stacking.gitSpice.command`, and `landing.action` guidance in both Pi and Claude plugin skills with matching wording.
4. Bump `eforge-plugin/.claude-plugin/plugin.json` from the current patch version to the next patch version.

## Scope

### In Scope

- CLI flags/descriptions for landing vocabulary and stack config where existing commands support config/init/build options.
- MCP proxy schemas/descriptions for landing vocabulary and stack config.
- Pi extension tool schemas and command flows matching MCP capabilities.
- Pi and Claude skill text updates for build/config/init/playbook flows.
- Plugin version bump.
- Parity tests/scripts updated when schemas or skills change.

### Out of Scope

- Engine runtime changes.
- Monitor UI stack rendering.
- Public web documentation and generated reference artifacts.

## Files

### Create

- None unless a small shared mapper is needed (for example `packages/eforge/src/cli/landing-options.ts`) to convert `landingAction: pr|merge|leave` to legacy `onSuccess` values without duplicating maps.

### Modify

- `packages/eforge/src/cli/index.ts` — add/describe `--landing-action <pr|merge|leave>` or equivalent while retaining `--on-success`; reject simultaneous conflicting values; map to runtime `onSuccess`.
- `packages/eforge/src/cli/run-or-delegate.ts` — carry the mapped landing action through local and daemon enqueue paths.
- `packages/eforge/src/cli/mcp-proxy.ts` — add `landingAction` aliases and stack config fields to build/init/config/playbook tool schemas where feasible; update descriptions to direct PR and git-spice semantics.
- `packages/eforge/src/cli/display.ts` — render stack provider/landing events and PR URLs if the CLI does not already use `eventRegistry` summaries for them.
- `packages/pi-eforge/extensions/eforge/index.ts` — mirror MCP tool schema aliases and stack config fields; update descriptions.
- `packages/pi-eforge/extensions/eforge/landing-gate.ts` and `packages/pi-eforge/extensions/eforge/trunk-landing.ts` — update copy to `landing.action` vocabulary while retaining `onSuccess` compatibility behavior.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — pass mapped landing action through playbook run flows.
- `packages/pi-eforge/skills/eforge-build/SKILL.md` — replace old feature-branch aggregation text with direct `artifact branch -> resolved base branch` PR behavior and stacked `parent artifact branch` targeting.
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — prefer `landing.action`, document legacy `build.onSuccess`, and add stack/git-spice settings.
- `packages/pi-eforge/skills/eforge-init/SKILL.md` — ask for landing action using `pr|merge|leave`; include optional stack setup and git-spice command guidance.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — update autonomous landing action vocabulary and behavior.
- `eforge-plugin/skills/build/build.md` — mirror Pi build skill updates with MCP tool names.
- `eforge-plugin/skills/config/config.md` — mirror Pi config skill updates.
- `eforge-plugin/skills/init/init.md` — mirror Pi init skill updates.
- `eforge-plugin/skills/playbook/playbook.md` — mirror Pi playbook skill updates.
- `eforge-plugin/.claude-plugin/plugin.json` — bump patch version because plugin files change.
- `scripts/check-skill-parity.mjs` or related snapshots — update only if the parity script requires new mirrored text markers.
- Tests under `test/` or package-local tests covering CLI/MCP/Pi schema parsing — add/update cases for landing alias mapping and conflict rejection.

## Verification

- [ ] CLI accepts one new landing vocabulary entry such as `--landing-action pr` and sends legacy `issue-pr` to the existing runtime path.
- [ ] CLI rejects a command containing conflicting `--landing-action pr` and `--on-success merge-to-base-branch` values.
- [ ] MCP and Pi build/playbook tool schemas expose matching landing alias descriptions and retain `onSuccess` compatibility.
- [ ] Pi and Claude build/config/init/playbook skills contain no statement that `issue-pr` merges the eforge branch into a feature branch before opening a trunk PR.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is incremented by one patch version.
- [ ] `pnpm docs:check-parity` passes.
- [ ] `pnpm vitest run` passes for updated CLI/MCP/Pi schema tests.