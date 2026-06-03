---
id: plan-03-resume-docs-and-reference
name: Queued Resume Documentation and Reference
branch: model-compiled-build-resume-as-a-queued-prd-mode/plan-03-resume-docs-and-reference
agents:
  builder:
    effort: medium
    rationale: Documentation-only follow-up that must keep Claude plugin, Pi skills,
      and generated public reference artifacts in sync.
  reviewer:
    effort: medium
    rationale: Docs need parity checks across Claude, Pi, Console, and public web content.
---

# Queued Resume Documentation and Reference

## Architecture Context

Plans 1 and 2 change compiled-build resume from an immediate background worker to a scheduler-owned queue mutation. This plan updates human-facing instructions and generated reference artifacts after the API/tool behavior changes are in place.

`AGENTS.md` requires Pi and Claude Code consumer-facing behavior to stay in sync, requires a Claude plugin version bump when plugin content changes, and forbids bumping the Pi package version.

## Implementation

### Overview

Update recovery skill guidance, Console README text, troubleshooting docs, and generated tool reference docs so every user-facing surface says compiled-build resume queues the failed PRD and waits for scheduler dispatch. Remove stale promises that the call returns `{ sessionId, pid }` or starts a background resume worker immediately.

### Key Decisions

1. Use the same behavior language in Pi and Claude skills: the tool queues a compiled resume request, preserves queue controls, and returns queued metadata.
2. Keep the CLI mentioned as a queueing command, not as a local direct resume runner.
3. Run the docs generator after source docs/tool descriptions change and commit generated `web/public` artifacts.
4. Bump only `eforge-plugin/.claude-plugin/plugin.json`; do not bump `packages/pi-eforge/package.json`.

## Scope

### In Scope

- Update Claude Code recovery skill guidance for `mcp__eforge__eforge_resume_build`.
- Update Pi recovery skill guidance for `eforge_resume_build`.
- Update Console UI README and public troubleshooting docs.
- Regenerate reference docs that include MCP/Pi tool descriptions.
- Bump the Claude plugin version.

### Out of Scope

- Additional UI redesign.
- Additional API fields beyond plan 2.
- Pi package version changes.

## Files

### Modify

- `eforge-plugin/skills/recover/recover.md` — describe queued resume behavior and queued response metadata.
- `eforge-plugin/.claude-plugin/plugin.json` — bump version from `0.25.43` to the next patch version.
- `packages/pi-eforge/skills/eforge-recover/SKILL.md` — mirror the Claude recovery skill wording with Pi tool names.
- `packages/console-ui/README.md` — change recovery dialog description from session/PID to queued resume status.
- `web/content/docs/troubleshooting.md` — describe resume as queue-native and subject to queue parallelism/pause/profile routing.
- `web/content/reference/tools.md` — update generated/source tool reference rows if the docs generator does not rewrite them automatically.
- `web/public/docs/troubleshooting.md` — regenerated public copy.
- `web/public/reference/tools.md` — regenerated public reference copy.
- `web/public/llms-full.txt` — regenerated LLM bundle.

## Implementation Notes

- Run `pnpm docs:generate` after editing source docs and tool descriptions.
- If `pnpm docs:generate` rewrites additional generated files, include them when they contain queued-resume wording changes.
- Search the docs and plugin trees for `sessionId`, `pid`, `spawns`, `spawned`, and `background build agent` near resume references and replace stale compiled-resume wording only.
- Keep recovery-worker wording for `eforge_recover`; this change is limited to compiled-build resume.

## Verification

- [ ] Claude recovery skill says compiled-build resume queues the failed PRD and returns queued metadata.
- [ ] Pi recovery skill says compiled-build resume queues the failed PRD and returns queued metadata.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` version is `0.25.44`.
- [ ] `packages/pi-eforge/package.json` is unchanged.
- [ ] Console README no longer says compiled-build resume shows session id and PID.
- [ ] Troubleshooting docs mention scheduler-owned queue controls for compiled-build resume.
- [ ] `web/content/reference/tools.md`, `web/public/reference/tools.md`, and `web/public/llms-full.txt` contain queued-resume wording for `eforge_resume_build`.
- [ ] A repository search for resume-specific `{ sessionId, pid }` wording returns zero hits outside historical API version comments and recovery-worker docs.
