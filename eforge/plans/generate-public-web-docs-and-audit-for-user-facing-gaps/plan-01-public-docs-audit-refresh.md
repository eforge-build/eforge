---
id: plan-01-public-docs-audit-refresh
name: Audit and Refresh Public Web Docs
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-01-public-docs-audit-refresh
agents:
  builder:
    effort: high
    rationale: Docs-heavy audit requires cross-checking public guides, generated
      references, and current integration/CLI skill surfaces before editing.
  reviewer:
    effort: high
    rationale: Review needs to catch stale or misleading user-facing documentation
      and generated-artifact drift.
---

# Audit and Refresh Public Web Docs

## Architecture Context

The public documentation site uses hand-authored guide sources in `web/content/docs/` and generated reference artifacts produced by `packages/docs-gen`. The docs generation workflow writes generated reference pages under `web/content/reference/`, static mirrors under `web/public/docs/` and `web/public/reference/`, schemas under `web/public/schemas/`, and agent-readable bundles such as `web/public/llms.txt` and `web/public/llms-full.txt`.

The current public guides are broad, but the audit found a user-facing gap around the workflow preset and stack-sync surfaces: `eforge-plugin/skills/workflow`, `packages/pi-eforge/skills/eforge-workflow`, `eforge-plugin/skills/stack`, and `packages/pi-eforge/skills/eforge-stack` exist, while the public integrations guide and generated tools skill table do not expose those skills. Stacked PR docs mention `eforge stack sync`, but they do not give users a concise host-surface map for `/eforge:workflow`, `/eforge:stack`, Pi `/eforge:workflow:*`, Pi `/eforge:stack:sync`, and the CLI. Troubleshooting also lacks stack-sync failure/conflict recovery coverage.

## Implementation

### Overview

Audit `web/content/docs/` against the current user-facing implementation, fill the workflow/stack documentation gaps, update the tools reference generator so generated public reference output lists the complete skill surface, then regenerate all docs artifacts with `pnpm docs:generate`.

### Key Decisions

1. Treat current CLI commands, Claude Code skills, Pi skills, MCP/Pi tool registrations, and docs-gen generator sources as the source of truth for public docs.
2. Do not hand-edit generated reference or static mirror outputs. Update hand-authored docs and generator code, then run `pnpm docs:generate`.
3. Keep new public guide text concise and task-oriented: what command to run, what config is changed, and where to recover from failures.
4. Prefer updating existing pages over adding new guide pages because workflow and stack sync fit the existing configuration, integrations, stacking, and troubleshooting journeys.

## Scope

### In Scope

- Audit hand-authored public docs in `web/content/docs/` for gaps against current user-facing behavior.
- Document workflow presets and stack sync where users already look for setup, integrations, stacking, and troubleshooting guidance.
- Update the tools reference generator so generated skill-surface output includes both `stack` and `workflow` skills for Claude Code and Pi.
- Regenerate all generated docs artifacts through the repo docs workflow.
- Add or update tests that prevent the workflow/stack skill-surface coverage from disappearing.

### Out of Scope

- Legacy root `docs/` content, except as read-only background for behavior or conventions.
- Runtime behavior changes to the engine, daemon, CLI, Claude Code plugin, or Pi extension.
- Marketing copy, speculative roadmap promises, or internal implementation details that are not user-facing.
- Manual edits to generated reference outputs that are meant to come from `pnpm docs:generate`.

## Files

### Create

- None expected.

### Modify

- `packages/docs-gen/src/generators/tools.ts` — replace or extend the hard-coded skill pair list so generated `tools.md` includes `stack`/`eforge-stack` and `workflow`/`eforge-workflow`; update the generated prose if it no longer uses `scripts/check-skill-parity.mjs` as the complete source of skill-surface rows.
- `web/content/docs/getting-started.md` — add a short pointer after initialization to `/eforge:workflow` for choosing landing action, PR auto-merge policy, and stacking setup.
- `web/content/docs/configuration.md` — add concise workflow-preset guidance that maps `solo-merge`, `solo-pr`, `team-pr`, `stacked-pr`, and `stacked-pr-autosync` to the config keys already documented on the page.
- `web/content/docs/integrations.md` — update the Claude Code and Pi skill tables/sections to include workflow and stack sync commands; include the exact command names for Claude Code (`/eforge:workflow`, `/eforge:stack`) and Pi (`/eforge:workflow`, `/eforge:workflow:init`, `/eforge:workflow:reconfigure`, `/eforge:stack:sync`).
- `web/content/docs/stacking.md` — add a task-oriented section for configuring stacking through `/eforge:workflow`, running manual sync through host commands and `eforge stack sync`, using `--dry-run`, and understanding auto-sync via `build.postMergeCommands`.
- `web/content/docs/troubleshooting.md` — add stack-sync remedies for skipped sync, git-spice missing/uninitialized, local trunk not fast-forwardable, active-build skips, and conflict recovery.
- `web/__tests__/content.test.ts` — add assertions that public docs mention workflow presets, host-specific stack-sync commands, `eforge stack sync`, and that generated tools/reference content exposes `stack` and `workflow` skill rows.
- `web/content/reference/tools.md` — regenerated output from `pnpm docs:generate`; do not edit by hand.
- `web/public/reference/tools.md` — regenerated output from `pnpm docs:generate`; do not edit by hand.
- `web/public/docs/*.md` for changed guide mirrors — regenerated output from `pnpm docs:generate`; do not edit by hand.
- `web/public/llms.txt` and `web/public/llms-full.txt` — regenerated output from `pnpm docs:generate`; do not edit by hand.

## Verification

- [ ] `web/content/docs/integrations.md` lists workflow and stack sync in the Claude Code and Pi user-facing command surfaces.
- [ ] `web/content/docs/stacking.md` contains the exact strings `/eforge:workflow`, `/eforge:stack`, `/eforge:stack:sync`, `eforge stack sync`, and `--dry-run` outside generated files.
- [ ] `web/content/docs/troubleshooting.md` contains concrete recovery steps for stack-sync conflict and skipped-sync outcomes.
- [ ] `web/content/reference/tools.md` and `web/public/reference/tools.md` contain skill rows for `workflow`/`eforge-workflow` and `stack`/`eforge-stack` after generation.
- [ ] Every changed `web/public/docs/*.md` mirror is byte-for-byte identical to its matching `web/content/docs/*.md` source after generation.
- [ ] `pnpm docs:check` exits 0 in an environment with workspace dependencies installed.
- [ ] `pnpm test` exits 0 in an environment with workspace dependencies installed.