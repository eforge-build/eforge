---
id: plan-01-public-docs-audit-and-generate
name: Audit Public Web Docs and Refresh Generated Artifacts
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-01-public-docs-audit-and-generate
agents:
  builder:
    effort: high
    rationale: The work is documentation-only but requires cross-checking multiple
      user-facing surfaces against implementation sources and generated
      artifacts.
  reviewer:
    effort: high
    rationale: Review must verify docs accuracy against implementation behavior,
      generated artifact discipline, and user-journey coverage.
---

# Audit Public Web Docs and Refresh Generated Artifacts

## Architecture Context

The public documentation site lives in `web/`. Hand-authored public guide sources are under `web/content/docs/`; generated reference artifacts are produced by `@eforge-build/docs-gen` into `web/content/reference/`, `web/public/reference/`, `web/public/docs/`, `web/public/schemas/`, `web/public/llms.txt`, and `web/public/llms-full.txt`. Generated outputs must be refreshed with the repo docs workflow rather than edited as primary sources.

The current implementation source of truth for this audit includes:
- `packages/engine/src/config.ts` and `packages/engine/src/prd-queue.ts` for config, queue, validation, priority, and dependency behavior.
- `packages/input/src/session-plan.ts` and `packages/input/src/playbook.ts` for session-plan and playbook behavior.
- `packages/eforge/src/cli/index.ts` plus `packages/eforge/src/cli/playbook.ts` for CLI behavior.
- `packages/client/src/routes.ts`, `packages/client/src/events.schemas.ts`, and generated reference docs for HTTP API and event behavior.
- `eforge-plugin/skills/` and `packages/pi-eforge/` for Claude Code and Pi integration behavior.
- `packages/extension-sdk/` and first-party extension examples or manifests for public extension behavior.
- `packages/docs-gen/src/*` for generated artifact conventions.

## Implementation

### Overview

Audit the public docs from the main user journeys requested in the source document, patch concise user-facing gaps in `web/content/docs/`, regenerate all public docs artifacts with `pnpm docs:generate`, and verify drift/link checks with `pnpm docs:check`.

Concrete gaps identified during planning:
1. Structured planning/session-plan behavior is only lightly covered in the public guides. Add concise guide coverage explaining that `/eforge:plan` creates `.eforge/session-plans/`, records planning dimensions/readiness, and `/eforge:build` submits ready session plans as build source.
2. Queue and daemon configuration coverage omits several user-facing options visible in implementation and first-party config skills: `prdQueue.autoBuild`, `prdQueue.watchPollIntervalMs`, queue `priority` / `depends_on` behavior, and `build.postMergeCommandTimeoutMs`. Add task-oriented coverage without duplicating the full generated schema.
3. Extension coverage must be audited against the current extension SDK and first-party integration behavior so the public docs cover the extensions user journey requested by the source document.
4. Generated public artifacts need to be refreshed from source and checked for drift after any guide edits.

### Key Decisions

1. Keep this as one docs-focused plan because the work is cohesive, has no implementation-code dependency, and all affected files are in the public docs/generator output area.
2. Update hand-authored guides first, then run `pnpm docs:generate` so public mirrors, reference docs, schemas, and LLM artifacts stay generator-owned.
3. Prefer additions to existing pages over new navigation pages unless the audit finds a navigation gap that cannot fit concisely into the existing guide set.

## Scope

### In Scope
- Audit `web/content/docs/` against current user-facing behavior in the implementation sources listed above.
- Update concise guide coverage for getting started, core concepts, configuration/profiles, playbooks/session plans, extensions, integrations, troubleshooting, and glossary terminology where gaps are confirmed.
- Refresh generated documentation artifacts with `pnpm docs:generate`.
- Update `packages/docs-gen/src/manifest.ts` or docs-gen output path wiring only if the audit adds/removes public guide pages or LLM manifest entries.
- Update `web/__tests__/content.test.ts` only if guide coverage, navigation, or required snippets change.

### Out of Scope
- Legacy root `docs/` edits except reading them for implementation/history context.
- Marketing copy, roadmap promises, or speculative future behavior.
- Implementation-code changes unrelated to docs generation correctness.
- Hand-editing generated files as primary sources.
- Internal-only engine details not needed by users.

## Files

### Create
- None expected. Create a new `web/content/docs/*.md` page only if the audit shows the existing guide pages cannot cover a required user journey concisely; if created, also update `web/lib/nav.ts`, `packages/docs-gen/src/output-paths.ts`, `packages/docs-gen/src/generators/llms.ts`, `packages/docs-gen/src/manifest.ts`, and `web/__tests__/content.test.ts`.

### Modify
- `web/content/docs/getting-started.md` — clarify the first-build path through `/eforge:plan`, session plans, and `/eforge:build` if the audit confirms current coverage is too thin.
- `web/content/docs/concepts.md` — add concise concepts for session plans/build source conversion and queue auto-build/priority behavior where user-facing.
- `web/content/docs/configuration.md` — document task-oriented queue and validation settings: `prdQueue.autoBuild`, `prdQueue.watchPollIntervalMs`, `maxConcurrentBuilds`, `build.postMergeCommands`, `build.postMergeCommandTimeoutMs`, and `build.maxValidationRetries`.
- `web/content/docs/playbooks.md` — cross-link planning-mode playbooks to session-plan behavior and clarify profile/postMerge inheritance if needed after audit.
- `web/content/docs/extensions.md` — audit extension installation, configuration, and authoring coverage against the current extension SDK and first-party extension behavior.
- `web/content/docs/integrations.md` — ensure Claude Code, Pi, CLI, monitor, HTTP/API, and input-source integration coverage matches current commands/tools.
- `web/content/docs/troubleshooting.md` — add remedies for auto-build paused/disabled states, docs generation prerequisites, or queue/profile/session-plan failure modes if missing after audit.
- `web/content/docs/glossary.md` — update terms such as session plan, build source, auto-build, queue priority, or post-merge validation if new guide text introduces them.
- `web/lib/nav.ts` — update only if a new guide page is added or navigation order needs to expose an existing user journey.
- `web/__tests__/content.test.ts` — update only for new guide pages, required snippets, or nav assertions introduced by the docs changes.
- `packages/docs-gen/src/manifest.ts` — update only if guide coverage/LLM artifact indexing changes.
- Generated outputs from `pnpm docs:generate`: `web/content/reference/*.md`, `web/public/reference/*.md`, `web/public/docs/*.md`, `web/public/schemas/*.json`, `web/public/llms.txt`, and `web/public/llms-full.txt`.

## Verification

- [ ] `pnpm docs:generate` has been run after all `web/content/docs/` edits.
- [ ] `pnpm docs:check` exits with status 0, or the final implementation notes include the exact failing command output and the concrete setup step needed to rerun it.
- [ ] `web/content/docs/configuration.md` mentions `prdQueue.autoBuild`, `prdQueue.watchPollIntervalMs`, `maxConcurrentBuilds`, `build.postMergeCommands`, `build.postMergeCommandTimeoutMs`, and `build.maxValidationRetries`.
- [ ] `web/content/docs/getting-started.md` or `web/content/docs/concepts.md` states that `/eforge:plan` writes session plans under `.eforge/session-plans/` and `/eforge:build` enqueues ready session-plan files as build source.
- [ ] `web/content/docs/extensions.md` or another public guide page explicitly covers extension installation, configuration, authoring, and runtime use from a user perspective.
- [ ] Public docs links added or changed in this plan target existing `/docs/`, `/reference/`, or `/schemas/` paths.
- [ ] Generated public guide mirrors under `web/public/docs/` match their corresponding `web/content/docs/` sources after generation.
- [ ] No root `docs/` files are modified unless the implementation notes name the repo-convention reason.