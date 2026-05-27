---
id: plan-01-public-docs-audit-refresh
name: Audit and Refresh Public Web Docs
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-01-public-docs-audit-refresh
agents:
  builder:
    effort: high
    rationale: Docs-only work spans many public guide pages and generated artifacts;
      the builder must cross-check implementation behavior, host skill docs,
      generated reference, and navigation without over-expanding scope.
  reviewer:
    effort: high
    rationale: Review must verify user-facing accuracy, concise task-oriented
      wording, generated artifact handling, and internal link/navigation
      consistency.
---

# Audit and Refresh Public Web Docs

## Architecture Context

The public documentation site lives under `web/`. Hand-authored guide sources are in `web/content/docs/`; generated reference outputs are in `web/content/reference/`, `web/public/reference/`, `web/public/docs/`, `web/public/schemas/`, `web/public/llms.txt`, and `web/public/llms-full.txt`. Generated files are produced by `pnpm docs:generate` and checked by `pnpm docs:check`; do not hand-edit generated files except through the generator workflow.

The current implementation is the source of truth. During planning, a concrete stale-doc gap was found: `web/content/docs/configuration.md`, `web/content/docs/stacking.md`, and `web/__tests__/content.test.ts` still describe the `stacked-pr-autosync` workflow as appending `eforge stack sync` to `build.postMergeCommands`, while the implementation and generated config reference use daemon-owned `stacking.sync.afterBuild: true`.

## Implementation

### Overview

Perform a focused public-docs audit across `web/content/docs/`, correct user-facing gaps found against current implementation and generated references, regenerate public docs artifacts, and update tests that encode outdated documentation expectations.

### Key Decisions

1. Treat `web/content/docs/` as the editable source for public guides; generated mirrors and reference files are refreshed only by `pnpm docs:generate`.
2. Use implementation-adjacent sources for fact checks: `web/content/reference/*.md`, `packages/docs-gen/src/**`, `eforge-plugin/skills/**`, `packages/pi-eforge/skills/**`, `packages/pi-eforge/extensions/eforge/**`, and relevant package READMEs.
3. Keep edits concise and task-oriented. Fix factual drift and missing user-journey coverage without marketing copy, roadmap claims, or internal implementation detail.

## Scope

### In Scope

- Audit all public guide sources under `web/content/docs/` for user-facing gaps listed in the source request: getting started, concepts, configuration/profiles, playbooks, extensions, CLI/API/reference pathways, integrations, and troubleshooting.
- Correct the known `stacked-pr-autosync` drift so the docs say it sets `stacking.sync.afterBuild: true`, not `build.postMergeCommands`.
- Update tests that assert public-doc journey coverage when those assertions encode outdated behavior.
- Run `pnpm docs:generate` to refresh generated docs artifacts after source changes.
- Run `pnpm docs:check` and record any environment-only failure with command output and next steps.

### Out of Scope

- Changes to implementation code.
- Auditing or rewriting the legacy root `docs/` directory, except reading it for repo conventions or source-behavior context.
- Marketing copy, speculative future features, or roadmap commitments.
- Hand-editing generated reference or public mirror files instead of regenerating them.
- Broad rewrites of guide pages when a targeted correction covers the gap.

## Files

### Create

- None expected.

### Modify

- `web/content/docs/getting-started.md` — Audit first-build and workflow-preset guidance against current Pi, Claude Code, CLI, and daemon behavior; apply concise fixes if the audit finds drift.
- `web/content/docs/concepts.md` — Audit core concepts, queue, artifact branch, validation, stacking, and generated artifact descriptions against current behavior; apply concise fixes if the audit finds drift.
- `web/content/docs/configuration.md` — Replace stale `stacked-pr-autosync` preset text with `stacking.sync.afterBuild: true`; audit config/profile/toolbelt/queue/landing/trunk-sync guidance for other user-facing drift.
- `web/content/docs/profiles.md` — Audit profile scopes, precedence, CLI override, routers, toolbelts, and harness guidance; apply concise fixes if the audit finds drift.
- `web/content/docs/playbooks.md` — Audit autonomous/planning playbook flows, profile inheritance, landing selectors, and CLI commands; apply concise fixes if the audit finds drift.
- `web/content/docs/stacking.md` — Replace stale workflow preset text that says autosync appends `eforge stack sync` to `build.postMergeCommands`; state that autosync writes `stacking.sync.afterBuild: true` and keep the existing warning against post-merge command autosync.
- `web/content/docs/extensions.md` — Audit extension discovery/trust/runtime capability descriptions against `packages/extension-sdk`, examples, and generated reference; apply concise fixes if the audit finds drift.
- `web/content/docs/extensions-api.md` — Audit user-facing extension API examples and runtime status notes against SDK/source; apply concise fixes if the audit finds drift.
- `web/content/docs/integrations.md` — Audit Claude Code, Pi, CLI, API, Langfuse, monitor, and input-source workflows against current host skill/tool surfaces; apply concise fixes if the audit finds drift.
- `web/content/docs/troubleshooting.md` — Audit remedies for docs drift, daemon, auto-build, stack sync, recovery, extensions, and validation failures; apply concise fixes if the audit finds drift.
- `web/content/docs/glossary.md` — Audit terminology for consistency with changed guide wording; apply concise fixes if the audit finds drift.
- `web/__tests__/content.test.ts` — Update journey-coverage assertions that still expect `stacked-pr-autosync` to use `build.postMergeCommands`; add or adjust assertions for `stacking.sync.afterBuild` where useful.
- `web/public/docs/*.md` — Refresh generated guide mirrors via `pnpm docs:generate` only.
- `web/content/reference/*.md`, `web/public/reference/*.md`, `web/public/schemas/*.json`, `web/public/llms.txt`, `web/public/llms-full.txt` — Refresh via `pnpm docs:generate` if the generator reports changes; do not edit by hand.

## Verification

- [ ] `rg -n "stacked-pr-autosync|build\.postMergeCommands|eforge stack sync" web/content/docs/configuration.md web/content/docs/stacking.md web/__tests__/content.test.ts` shows the autosync preset mapped to `stacking.sync.afterBuild: true` and retains `build.postMergeCommands` only for post-merge validation guidance or the warning against using it for automatic stack sync.
- [ ] `pnpm docs:generate` completes, or the final notes include the exact command output and the missing local dependency/tool named in the failure.
- [ ] `pnpm docs:check` exits 0, or the final notes include the exact command output and concrete follow-up command(s), such as `pnpm install --frozen-lockfile` when `tsup` is unavailable because `node_modules/` is absent.
- [ ] `pnpm test -- web/__tests__/content.test.ts` exits 0, or the final notes include the exact command output and concrete follow-up command(s).
- [ ] For every edited `web/content/docs/*.md` file, the matching `web/public/docs/*.md` mirror has byte-identical content after generation.
- [ ] All changed public guide links target existing `/docs/`, `/reference/`, or `/schemas/` slugs, as verified by `pnpm docs:check` or by a documented link-check failure report.
