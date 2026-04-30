---
name: plugin-pi-parity-audit
description: Audit eforge-plugin/ and packages/pi-eforge/ for capability drift and close gaps
scope: project-team
---

## Goal

Ensure the two consumer-facing surfaces — `eforge-plugin/` (Claude Code) and `packages/pi-eforge/` (Pi extension) — expose equivalent CLI commands, MCP tools, skills, and user-facing behaviors. Pi is allowed to lead; this audit's job is to surface each gap and decide whether to close it or record it as intentional.

## Out of scope

- Adding net-new capabilities that don't already exist in either package
- Internal refactors that don't change the consumer-facing surface
- Daemon-side (`packages/monitor/`, `packages/engine/`) changes
- Documentation in `README.md` or `docs/` (separate concern)
- Bumping the Pi package version in `packages/pi-eforge/package.json` (owned by the npm release flow)

## Acceptance criteria

- A parity matrix is produced listing every CLI command, MCP tool, and skill on each side, marking each row as `parity`, `pi-only-intentional`, `pi-only-gap`, or `plugin-only-gap`.
- Every `*-gap` row is either closed by adding the missing capability to the lagging package, or downgraded to `*-only-intentional` with a one-line justification.
- If `eforge-plugin/` was modified, `eforge-plugin/.claude-plugin/plugin.json` version is bumped.
- `pnpm test` passes.
- `pnpm type-check` passes.
- Daemon HTTP client code remains imported from `@eforge-build/client` - no inlined route literals or duplicated client logic introduced on either side.

## Notes for the planner

- Per `AGENTS.md`: "every capability exposed in one should be exposed in the other when technically feasible." Pi may legitimately have more features; the audit decides per-row whether a gap is technical or accidental.
- Do NOT modify `packages/pi-eforge/package.json` version - `AGENTS.md` reserves that for the publish flow.
- Plugin and npm package versions are independent; the plugin version bump is required only when `eforge-plugin/` files change.
- Compare these inventories explicitly:
  - **CLI commands**: `eforge-plugin/commands/` vs Pi command surface in `packages/pi-eforge/`
  - **MCP tools**: registered tool names exposed by each package
  - **Skills**: `eforge-plugin/skills/` vs equivalent Pi skill registration
- Use `git diff` against the previous parity audit commit (search recent history for "parity-audit") as a starting baseline if one exists.
- Produce the parity matrix as the planner's analysis output so reviewers can verify the decisions; the audit isn't done until each row has a disposition.
