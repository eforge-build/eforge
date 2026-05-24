---
id: plan-01-public-web-docs-audit-refresh
name: Audit and Refresh Public Web Docs
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-01-public-web-docs-audit-refresh
agents:
  builder:
    effort: high
    rationale: The task is documentation-only, but it requires cross-checking public
      guides against CLI, daemon API, config, extension, profile, playbook, and
      integration implementation surfaces.
  reviewer:
    effort: high
    rationale: Docs review must catch stale user-facing claims, broken journey
      coverage, and generated-artifact drift across multiple public
      documentation surfaces.
---

# Audit and Refresh Public Web Docs

## Architecture Context

The public documentation site lives in `web/`. Hand-authored user-facing guides are under `web/content/docs/`. Generated reference Markdown and schemas are produced by `packages/docs-gen` into `web/content/reference/`, `web/public/reference/`, `web/public/schemas/`, and `web/public/llms*.txt`. Raw guide mirrors under `web/public/docs/` are generated outputs and must stay byte-identical to the editable guide sources.

The source of truth for public behavior is the current implementation, especially the CLI, daemon client routes and event schemas, config schema, extension SDK/runtime, input artifact packages, and the Claude Code/Pi integration packages.

## Implementation

### Overview

Perform a user-journey audit of the public docs, update concise task-oriented guide content where it is stale or incomplete, then regenerate all docs-gen artifacts. Keep generated reference outputs in sync by running the generator rather than hand-editing generated files.

### Key Decisions

1. Treat `web/content/docs/` as the only editable guide source and mirror guide changes into `web/public/docs/` through `pnpm docs:generate`.
2. Treat `web/content/reference/`, `web/public/reference/`, `web/public/schemas/`, `web/public/llms.txt`, and `web/public/llms-full.txt` as generated artifacts from `packages/docs-gen`.
3. Keep documentation user-facing: describe commands, files, workflows, and integration contracts users interact with; omit private engine implementation detail unless a user must know it to operate eforge.
4. Preserve existing concise guide structure and navigation unless the audit finds a concrete missing journey or broken link that requires a new page or nav item.

## Scope

### In Scope

- Audit all editable public guide sources in `web/content/docs/` against current behavior.
- Refresh generated reference artifacts with `pnpm docs:generate`.
- Update public docs for the key journeys named in the source: getting started, core concepts, configuration/profiles, playbooks, extensions, CLI/API/reference, integrations, and troubleshooting.
- Fix stale command names, option names, path names, scope precedence descriptions, config field descriptions, API/reference links, and terminology drift found during the audit.
- Update `web/lib/nav.ts`, `packages/docs-gen/src/manifest.ts`, and docs tests only if a guide is added, removed, renamed, or needs new generated-public path coverage.
- Record any `pnpm docs:check` failure in the implementation summary with the exact command, stderr excerpt, and next action.

### Out of Scope

- Do not audit or rewrite the legacy root `docs/` tree except as a source for current repo conventions.
- Do not add roadmap promises, marketing copy, speculative future behavior, or internal-only implementation detail.
- Do not change product implementation code unless a docs generator bug prevents artifact regeneration or validation.
- Do not hand-edit generated reference outputs in place.

## Files

### Create

- None expected. Create a new `web/content/docs/*.md` page only if the audit finds a named user journey that cannot be covered in an existing guide without hurting navigation.

### Modify

- `web/content/docs/getting-started.md` — verify install/init/first-build steps for Pi, Claude Code, and CLI against current commands and integration packages.
- `web/content/docs/concepts.md` — verify terminology for build sources, workflow profiles, agent runtime profiles, daemon/queue behavior, artifact branches, validation, and agent-readable artifacts.
- `web/content/docs/configuration.md` — verify config tiers, agent tiers, harness setup, profiles, toolbelts, playbook profiles, queue/auto-build, landing, stacking, trunk branch policy, per-role tuning, prompts, and hooks against `packages/engine/src/config.ts` and generated config reference.
- `web/content/docs/profiles.md` — verify profile file shape, scope precedence, activation, one-off CLI override, router precedence, harness options, and toolbelt behavior.
- `web/content/docs/playbooks.md` — verify playbook modes, scope tiers, file format, host commands, CLI commands, promote/demote behavior, queue dependency options, and planning-mode limitations.
- `web/content/docs/extensions.md` — verify extension discovery, package management, trust model, loader behavior, runtime support, input sources/enrichers, event patterns, and security guidance against extension runtime/SDK code and examples.
- `web/content/docs/extensions-api.md` — verify public extension SDK APIs, context types, hook result types, event pattern semantics, TypeBox tool examples, and runtime support status.
- `web/content/docs/integrations.md` — verify Claude Code plugin, Pi extension, standalone CLI, daemon HTTP API, shell hooks, input adapters, Langfuse, and monitor UI coverage.
- `web/content/docs/stacking.md` — verify git-spice setup, stack frontmatter, dependency inference, landing compatibility, and PR targeting behavior.
- `web/content/docs/troubleshooting.md` — verify concrete remedies for daemon startup, docs drift, auto-build, recovery, untrusted extensions, invalid profiles, queue locks, validation retries, and policy-gate decisions.
- `web/content/docs/glossary.md` — align definitions with guide terminology after edits.
- `web/lib/nav.ts` — update only if guide slug set changes.
- `packages/docs-gen/src/manifest.ts` — update `llms.txt` guide entries only if guide slug set or descriptions change.
- `packages/docs-gen/src/output-paths.ts` — update only if new generated guide mirrors are added.
- `web/__tests__/content.test.ts` — update only if guide slug set or required content assertions change.
- `test/docs-gen-determinism.test.ts`, `test/docs-link-check.test.ts`, `test/extension-docs-content.test.ts`, `test/reference-content.test.ts`, `test/skills-docs-wiring.test.ts` — update only when audited docs coverage assertions need to track changed public pages or generated artifacts.
- `web/public/docs/*.md` — regenerate mirrors from `web/content/docs/`.
- `web/content/reference/*.md` — regenerate reference Markdown from implementation sources.
- `web/public/reference/*.md` — regenerate public raw reference Markdown.
- `web/public/schemas/*.json` — regenerate public schemas.
- `web/public/llms.txt`, `web/public/llms-full.txt` — regenerate agent-readable documentation indexes/bundles.

## Source-of-Truth Audit Map

Use these implementation areas while auditing, excluding `node_modules/` and `dist/` from searches:

- CLI commands/options: `packages/eforge/src/cli/index.ts`, `packages/eforge/src/cli/playbook.ts`, `packages/eforge/src/cli/mcp-tool-factory.ts`.
- Daemon API/reference: `packages/client/src/routes.ts`, `packages/client/src/api/*.ts`, `packages/monitor/src/server.ts`.
- Events/reference: `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`.
- Config/reference: `packages/engine/src/config.ts`, `packages/engine/src/schemas.ts`.
- Profiles and harnesses: `packages/engine/src/profile-usage.ts`, `packages/engine/src/pipeline/agent-config.ts`, `packages/engine/src/harnesses/`, `packages/client/src/profile-utils.ts`.
- Playbooks/session plans: `packages/input/src/playbook.ts`, `packages/input/src/session-plan.ts`, `packages/eforge/src/cli/playbook.ts`.
- Scopes: `packages/scopes/src/`.
- Extensions: `packages/extension-sdk/src/`, `packages/engine/src/extensions/`, `examples/extensions/`.
- Integrations: `eforge-plugin/skills/`, `eforge-plugin/.mcp.json`, `packages/pi-eforge/skills/`, `packages/pi-eforge/extensions/eforge/`.
- Docs generation: `packages/docs-gen/src/`.

## Verification

- [ ] `pnpm docs:generate` updates generated artifacts, and no generated reference file is edited without the generator in the command history.
- [ ] `cmp web/content/docs/<slug>.md web/public/docs/<slug>.md` succeeds for every guide slug listed in `web/lib/nav.ts`.
- [ ] Every guide in `web/content/docs/` contains frontmatter with `title` and `description`, exactly one `#` heading, and at least one `##` heading.
- [ ] The public docs contain concrete coverage for all named journeys from the source: getting started, concepts, configuration/profiles, playbooks, extensions, CLI/API/reference, integrations, and troubleshooting.
- [ ] Cross-links introduced or changed by the audit target existing `web/app` routes, `web/content` pages, generated reference pages, or external URLs.
- [ ] `pnpm --filter @eforge-build/web type-check` exits 0.
- [ ] `pnpm test -- web/__tests__/content.test.ts test/docs-gen-determinism.test.ts test/docs-link-check.test.ts test/extension-docs-content.test.ts test/reference-content.test.ts test/skills-docs-wiring.test.ts` exits 0.
- [ ] `pnpm docs:check` exits 0, or the implementation summary includes the exact environmental or drift failure plus follow-up command.
