---
id: plan-03-host-output-safeguards-docs
name: Host Output Safeguards and Documentation
branch: compact-eforge-plan-workstation-loading-and-oversized-output-safeguards/plan-03-host-output-safeguards-docs
agents:
  builder:
    effort: high
    rationale: The same formatter must work across client, CLI, MCP, Pi, and Console
      surfaces without route or wire-shape drift.
  reviewer:
    effort: high
    rationale: Host behavior changes affect coding-agent context safety and
      documentation/plugin parity.
---

# Host Output Safeguards and Documentation

## Architecture Context

Host integrations currently dump contribution invocation outputs as pretty JSON in several coding-agent surfaces. Pi already special-cases `{ markdown }`, but CLI, MCP, and Console previews still render JSON payloads directly and none of the coding-agent hosts has a shared oversized-output summarizer.

The client package owns contribution wire types and shared host dispatch helpers, so budget-aware formatting belongs in a browser-safe client utility consumed by CLI/MCP/Pi/Console rather than reimplemented per host.

## Implementation

### Overview

Create a shared contribution output formatter in `@eforge-build/client`. Use it in CLI, MCP, Pi, and Console contribution invocation surfaces. The formatter detects oversized outputs, emits clear warnings, renders `{ markdown }` as markdown text, and produces semantic JSON summaries that preserve structure, IDs, titles, statuses, counts, omitted counts, and continuation hints.

### Key Decisions

1. Keep raw action invocation responses unchanged. Formatting is a host concern and uses the shared client utility.
2. Preserve deliberate raw modes where safe: CLI `--json` continues to print the raw invocation result; non-JSON and coding-agent tool paths use the safe formatter.
3. Summarize JSON semantically before any final character cap. Arrays keep counts and representative entries with identity fields (`id`, `itemId`, `epicId`, `title`, `name`, `status`, `state`, `kind`, `lane`) plus omitted counts.
4. Surface profile warnings for `ui-rich` and `debug-rich` actions in coding-agent hosts, even when the output fits the current budget.

## Scope

### In Scope

- Add a browser-safe formatter utility exported by `@eforge-build/client` and `@eforge-build/client/browser`.
- Render common `{ markdown: string }` action outputs as markdown/plain text rather than escaped JSON in CLI, MCP, Pi, and Console previews.
- Summarize/truncate oversized JSON outputs with warnings and follow-up hints.
- Preserve top-level shape, IDs, titles, status fields, array counts, omitted counts, and pagination/continuation hints in summaries.
- Add profile-aware warnings for rich/debug outputs.
- Update host tests for CLI, MCP, Pi, Console, and shared formatter behavior.
- Update docs and skills for compact reads, output profiles, host truncation/summarization behavior, and raw/rich invocation guidance.
- Bump the Claude plugin patch version because plugin skills change.

### Out of Scope

- New action invocation response fields.
- New daemon routes.
- Removing rich/UI-only contributions.
- Adding raw output modes to MCP/Pi coding-agent tools.

## Files

### Create

- `packages/client/src/extension-contribution-output-formatting.ts` — shared formatter with `{ markdown }` detection, output profile warnings, semantic JSON summarization, array/object identity preservation, omitted counts, continuation hints, and final budget enforcement.
- `packages/client/src/__tests__/extension-contribution-output-formatting.test.ts` — tests for oversized JSON, arrays with IDs/titles, continuation hints, markdown output, and rich profile warnings.

### Modify

- `packages/client/src/index.ts` — export formatter APIs from the main client entrypoint.
- `packages/client/src/browser.ts` — export formatter APIs from the browser-safe entrypoint.
- `packages/eforge/src/cli/extension-contributions.ts` — use the shared formatter for non-JSON invoke output; keep `--json` raw; render markdown output without JSON fences.
- `packages/eforge/src/cli/mcp-extension-contributions.ts` — use `createDaemonTool` `formatResponse` or equivalent logic so invoke results return formatted text instead of full raw payloads; keep list responses compact enough for discovery.
- `packages/pi-eforge/extensions/eforge/extension-contribution-ux.ts` — replace local markdown/JSON output formatting with shared formatter and expose profile warnings in the panel.
- `packages/pi-eforge/extensions/eforge/extension-contributions.ts` — format invoke tool responses with the shared formatter; keep daemon-not-running handling and JSON input validation intact.
- `packages/console-ui/src/views/system/extension-contribution-rendering.ts` — use the shared formatter for output previews and expose structured state needed by the renderer.
- `packages/console-ui/src/views/system/extension-action-form.tsx` — render markdown outputs through `SafeMarkdown` and summarized JSON in bounded previews.
- `packages/console-ui/src/views/system/extension-contribution-card.tsx` — pass action output profile metadata into preview rendering.
- `packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx` — cover markdown output rendering and oversized-output summary previews.
- `test/extension-contribution-host-surfaces.test.ts` — assert CLI/MCP/Pi surfaces use the shared formatter, avoid `/api/` literals, and document raw `--json` behavior.
- `test/browser-extension-contributions-helpers.test.ts` — assert browser entrypoint exports formatter APIs without Node-only imports.
- `docs/extensions.md` — document host formatter behavior, oversized-output warnings, summary preservation rules, and raw/rich guidance.
- `eforge/extensions/eforge-plan/README.md` — document compact agent-safe reads vs rich compatibility/debug reads and host output handling for rich board actions.
- `eforge-plugin/skills/extend/extend.md` — document contribution output profiles and host summarization behavior for Claude/MCP users.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — keep Pi extension-authoring guidance in parity with the Claude skill.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin patch version.

## Verification

- [ ] Shared formatter tests show oversized JSON output emits a warning and does not include the full raw payload.
- [ ] Shared formatter tests preserve top-level object keys, IDs, titles, statuses, counts, omitted counts, and `nextOffset` or cursor hints.
- [ ] Shared formatter tests render `{ markdown }` output as markdown text without escaped JSON braces.
- [ ] CLI tests show non-JSON invoke uses formatted output and `--json` prints the raw invocation result.
- [ ] MCP tests show invoke output uses formatted text and no raw oversized payload is returned to the tool caller.
- [ ] Pi tests show tool and panel invocation paths use the shared formatter and retain daemon-not-running guidance.
- [ ] Console tests show markdown invocation output renders through `SafeMarkdown` and oversized JSON previews display a warning plus summary.
- [ ] Skill parity tests pass after updating Claude and Pi extension-authoring docs.
- [ ] Plugin version test shows the Claude plugin patch version increased.
- [ ] `pnpm exec vitest run packages/client/src/__tests__/extension-contribution-output-formatting.test.ts test/extension-contribution-host-surfaces.test.ts test/browser-extension-contributions-helpers.test.ts packages/console-ui/src/views/system/__tests__/extension-contributions-section.test.tsx` exits 0.
