---
id: plan-01-public-docs-audit-and-fill-gaps
name: Audit public docs and fill user-facing gaps
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-01-public-docs-audit-and-fill-gaps
agents:
  builder:
    effort: high
    rationale: The work is documentation-first, but it requires cross-checking
      current behavior across CLI commands, skills, profiles, playbooks,
      extensions, daemon events, recovery, and docs generation before editing
      the public guide pages.
  reviewer:
    effort: high
    rationale: Public docs require careful review for implementation accuracy,
      generated artifact drift, navigation consistency, and concise
      task-oriented coverage.
---

# Audit Public Docs and Fill User-Facing Gaps

## Architecture Context

The public documentation site lives in `web/`. Hand-authored guide sources live under `web/content/docs/*.md` and are listed by `web/lib/nav.ts`. Generated reference and raw-agent artifacts are produced by `@eforge-build/docs-gen` via `pnpm docs:generate` and checked by `pnpm docs:check`.

Treat current implementation as the source of truth. Do not edit the legacy root `docs/` directory except for reference during the audit. Do not hand-edit generated reference outputs; regenerate them from source. Implementation code is out of scope except narrowly scoped docs-generator changes required to mirror newly added public guide pages or keep generated artifacts in sync.

## Implementation

### Overview

Audit existing public guide pages against current behavior, fill missing user-journey coverage, wire new pages into navigation and content tests, regenerate public docs artifacts, and verify the drift/link gate.

The key missing public journeys to cover are profiles, playbooks, integrations, and troubleshooting. Existing pages must remain concise and task-oriented while gaining cross-links to the new pages.

### Key Decisions

1. Keep the work in one plan so guide sources, navigation, tests, docs-generator mirror configuration, and generated outputs land together.
2. Use source files and generated reference docs as evidence before changing prose; do not copy stale legacy docs unverified.
3. Add dedicated guide pages for profiles, playbooks, integrations, and troubleshooting because these are first-class user journeys in the request.
4. Regenerate `web/content/reference/`, `web/public/reference/`, `web/public/docs/`, schemas, and `llms*.txt` through `pnpm docs:generate`.
5. Permit minimal changes in `packages/docs-gen/src/output-paths.ts` and `packages/docs-gen/src/generators/llms.ts` only if new guide pages need raw public mirrors.

## Scope

### In Scope

- Audit and edit existing public guide sources under `web/content/docs/`.
- Add guide pages for profiles, playbooks, integrations, and troubleshooting.
- Update `web/lib/nav.ts` so new pages appear in the public docs navigation.
- Update `web/__tests__/content.test.ts` so the content loader exercises all guide slugs.
- If needed, update docs-gen guide mirror wiring for the new guide pages.
- Run `pnpm docs:generate` and commit generated artifacts.
- Run `pnpm docs:check`, plus project validation commands listed in orchestration.

### Out of Scope

- Editing legacy root `docs/` content.
- Marketing copy, roadmap promises, or speculative behavior.
- Public docs layout/CSS redesigns.
- Engine, daemon, CLI, plugin, Pi extension, or SDK behavior changes.
- New generated reference surfaces beyond the existing CLI, API, events, config, and tools references.

## Files

### Create

- `web/content/docs/profiles.md` — Guide for agent runtime profiles, scope precedence, active profile resolution, profile creation/switching, tier recipes, toolbelts in profiles, profile router behavior, playbook profile inheritance, and build/enqueue profile overrides.
- `web/content/docs/playbooks.md` — Guide for reusable playbooks, `autonomous` vs `planning` modes, scope precedence/shadowing, optional `profile` frontmatter, CLI and skill usage, and MCP tool result shapes.
- `web/content/docs/integrations.md` — Guide for Claude Code plugin, Pi extension, standalone CLI, MCP proxy, shell hooks, Langfuse, input-source extensions, issue tracker URI examples, and monitor UI.
- `web/content/docs/troubleshooting.md` — Task-oriented remedies for daemon startup/ports, docs drift, failed builds/recovery, untrusted extensions, invalid profile-router selections, queue locks, validation retry exhaustion, and extension policy gates.

### Modify

- `web/content/docs/getting-started.md` — Confirm install/init/current first-build flow and add links to profiles, playbooks, integrations, and troubleshooting.
- `web/content/docs/concepts.md` — Confirm pipeline, harness, workflow-profile, and agent-readable artifact descriptions; link to playbooks where reusable workflows are introduced.
- `web/content/docs/configuration.md` — Keep configuration guidance concise, link long-form profile/playbook/troubleshooting coverage, and verify profile, toolbelt, hook, validation, and extension config claims against generated reference/source.
- `web/content/docs/extensions.md` — Verify runtime support tables, extension manifest examples, trust model, CLI flags, and add an integrations cross-link where input sources are discussed.
- `web/content/docs/extensions-api.md` — Verify SDK signatures and runtime status for validation providers, reviewer perspectives, PRD enrichers, and profile routers; link to the profiles guide where profile routers affect users.
- `web/content/docs/glossary.md` — Convert long entries for profiles/playbooks into short definitions with links; add short entries for hooks, recovery verdicts, toolbelts, monitor, and input sources.
- `web/lib/nav.ts` — Add `profiles`, `playbooks`, `integrations`, and `troubleshooting` entries to `DOCS_NAV` with existing `{ slug, title, group }` shape.
- `web/__tests__/content.test.ts` — Add the four new doc slugs to the known docs list.
- `packages/docs-gen/src/output-paths.ts` — Add public docs mirror output paths for the four new guide pages if docs-gen requires explicit mirror paths.
- `packages/docs-gen/src/generators/llms.ts` — Mirror the four new guide pages into `web/public/docs/` if docs-gen requires explicit mirror entries.

### Regenerate

Run `pnpm docs:generate` after guide edits and docs-gen wiring. Commit generated changes under:

- `web/content/reference/*.md`
- `web/public/reference/*.md`
- `web/public/docs/*.md`
- `web/public/schemas/*.json`
- `web/public/llms.txt`
- `web/public/llms-full.txt`

## Source-of-Truth Checklist

Use these sources while auditing claims:

- `package.json` and `web/package.json` for commands and Node/runtime expectations.
- `packages/eforge/src/cli/` for CLI command names and flags.
- `packages/client/src/api/` and `packages/client/src/events.schemas.ts` for daemon routes and event names.
- `packages/engine/src/config.ts` and generated `web/content/reference/config.md` for configuration fields.
- `eforge-plugin/skills/*` and `packages/pi-eforge/skills/*` for plugin/Pi user flows.
- `packages/extension-sdk/src/*`, `examples/extensions/*`, and generated reference pages for extension capabilities.
- `packages/input/src/*` for playbook/session-plan input behavior.
- `packages/docs-gen/src/*` for generated artifact conventions.

## Verification

- [ ] `web/content/docs/profiles.md`, `playbooks.md`, `integrations.md`, and `troubleshooting.md` exist with `title` and `description` frontmatter and at least one `##` heading.
- [ ] `web/lib/nav.ts` contains exactly the original guide slugs plus `profiles`, `playbooks`, `integrations`, and `troubleshooting`.
- [ ] `web/__tests__/content.test.ts` includes all guide slugs and still includes the five reference slugs: `cli`, `api`, `events`, `config`, `tools`.
- [ ] Generated files are updated by running `pnpm docs:generate`, not by manual edits.
- [ ] `pnpm docs:check` exits 0, or the final report quotes the exact failure and gives a concrete follow-up command or dependency needed to rerun it.
- [ ] `pnpm type-check` exits 0, or the final report quotes the exact failure and gives a concrete follow-up command or dependency needed to rerun it.
- [ ] `pnpm test` exits 0, or the final report quotes the exact failure and gives a concrete follow-up command or dependency needed to rerun it.
- [ ] Internal links added or changed in `web/content/docs/*.md` resolve to existing `/docs/`, `/reference/`, or `/schemas/` targets under the docs link checker.
- [ ] No files outside the listed guide sources, docs nav/test files, narrowly scoped docs-gen mirror wiring, and generated docs outputs are modified.
- [ ] Existing pinned heading IDs remain present: `event-patterns` and `trust-and-security` in the extensions guide, and `toolbelts` and `hooks` in generated config reference.
- [ ] The new troubleshooting page includes command-level remedies for daemon status/stop/kill, docs drift regeneration, recovery, extension trust, profile-router invalid selection, queue locks, validation retries, and policy-gate approval blocking.
- [ ] The new profiles and playbooks pages include scope precedence and user commands for creation, listing, switching/running, and promotion/demotion where those commands exist in current source.
