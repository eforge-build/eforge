---
id: plan-01-public-docs-audit-and-fill-gaps
name: Audit public docs and fill user-facing gaps
branch: generate-public-web-docs-and-audit-for-user-facing-gaps/plan-01-public-docs-audit-and-fill-gaps
agents:
  builder:
    effort: xhigh
    rationale: Documentation audit and authoring require careful cross-referencing
      of implementation behavior across CLI, MCP tools, skills, extensions,
      profiles, playbooks, recovery, and toolbelts. Builder must read
      source-of-truth files for each section it edits or authors, decide what is
      stale vs. acceptable, and keep cross-links and terminology consistent
      across ~10 doc files plus nav.ts and tests.
  reviewer:
    effort: high
    rationale: Reviewer must validate that documented behavior matches current
      implementation, that the public docs site still navigates correctly, that
      no banned vague words slipped in, and that the user journeys are
      coherently covered. Docs perspective in particular must catch terminology
      drift between guide pages and reference pages.
---

# Audit Public Docs and Fill User-Facing Gaps

## Architecture Context

The public documentation site lives in `web/` and ships at `eforge.build`. Two content surfaces exist:

1. **Hand-authored guide pages** under `web/content/docs/*.md` — rendered by `web/app/docs/[slug]/page.tsx` and listed in `web/lib/nav.ts` (`DOCS_NAV`).
2. **Generated reference pages** under `web/content/reference/*.md` — produced by `pnpm docs:generate` from authoritative sources (CLI, route table, event schema, config schema, MCP tools, skill manifests). The same pipeline mirrors raw guide and reference Markdown into `web/public/{docs,reference}/`, and writes `web/public/llms.txt` / `web/public/llms-full.txt` and `web/public/schemas/*.schema.json`.

`pnpm docs:check` is the drift + internal-link gate: it runs `@eforge-build/docs-gen check`, which compares on-disk generated reference outputs against re-generated outputs and reports broken `/docs/...`, `/reference/...`, `/schemas/...`, and other internal links found in `web/content/**/*.md`. The check currently passes at HEAD against the existing generated outputs, so this plan should keep it passing.

The `loadDocPage` / `loadReferencePage` content loader is exercised by `web/__tests__/content.test.ts`, which enumerates the doc and reference slug sets explicitly. Any new doc page must be added to all three places (`DOCS_NAV`, the test's slug list, and the content directory) for the test suite and the rendered site nav to remain consistent.

## Implementation

### Overview

Audit the six existing guide pages under `web/content/docs/` against the current implementation (CLI source, skills, extension SDK, engine config, playbook/profile/queue subsystems, generated reference) and update stale or misleading content in place. Add four new guide pages that fill the user-journey gaps called out in the source PRD: **Profiles**, **Playbooks**, **Integrations**, and **Troubleshooting**. Wire the new pages into `web/lib/nav.ts` (with sensible groups), extend the content loader test's slug list, and regenerate the docs-gen outputs so the public mirrors, schemas, and `llms*.txt` stay in sync. Finish by running `pnpm docs:check` and the test/type-check gates to confirm zero drift and broken links.

This plan is doc-only by design. It does not modify engine, CLI, MCP, or extension source. The single exception is small, narrowly scoped edits to `web/lib/nav.ts` (a 50-line nav manifest used only by the docs site) and `web/__tests__/content.test.ts` (the content loader test that enumerates known slugs). Reference artifacts under `web/content/reference/*.md`, `web/public/reference/*.md`, `web/public/docs/*.md`, `web/public/schemas/*.json`, and `web/public/llms*.txt` MUST be regenerated via `pnpm docs:generate` rather than hand-edited — they carry `<!-- Generated file. Do not edit. -->` provenance headers and the drift check will fail otherwise.

### Key Decisions

1. **One plan, not multiple.** All doc edits + nav.ts + tests must land together so navigation, tests, and content stay coherent. Splitting would leave a broken intermediate state.
2. **Source-of-truth driven audit.** For each existing guide page, re-read the corresponding implementation source (listed below per file) before deciding what to change. Do not edit a page without first verifying the current behavior in code or in the generated reference.
3. **New pages, not just edits, where journeys are missing.** The PRD explicitly lists profiles, playbooks, integrations, and troubleshooting as user journeys. Profiles and playbooks are currently covered only in passing inside `configuration.md` / `glossary.md`. Integrations and troubleshooting have no coverage at all. Each warrants its own guide page so the nav reflects the journey.
4. **Regenerate, never hand-edit, reference outputs.** Use `pnpm docs:generate` to refresh `web/content/reference/*.md`, `web/public/reference/*.md`, `web/public/docs/*.md`, `web/public/schemas/*.schema.json`, `web/public/llms.txt`, and `web/public/llms-full.txt`. The generator stamps version/commit provenance; running it after content edits picks up the new public mirror entries automatically.
5. **Drift-check is the merge gate.** `pnpm docs:check` must pass at the end. Treat any drift or link error as a blocker — fix the underlying content (or regenerate) rather than silencing the check.
6. **Conservative existing-page edits.** Do not rewrite an existing page wholesale unless an entire section is wrong. Prefer surgical edits that correct stale claims, broken cross-links, or terminology drift while preserving structure that the test suite already pins (e.g. `id="event-patterns"` and `id="trust-and-security"` in `extensions.md`; `id="toolbelts"` and `id="hooks"` in `reference/config.md`, which is generated).

## Scope

### In Scope

- Audit and update existing pages under `web/content/docs/`:
  - `getting-started.md`
  - `concepts.md`
  - `configuration.md`
  - `extensions.md`
  - `extensions-api.md`
  - `glossary.md`
- Author new pages under `web/content/docs/`:
  - `profiles.md` — agent runtime profiles end-to-end (scopes, resolution, creation, switching, profile-router precedence, toolbelts inside profiles, planning playbook `agent_profile` inheritance).
  - `playbooks.md` — playbook modes (`autonomous` vs `planning`), scopes/shadowing, `profile` frontmatter inheritance, CLI/skill usage (`/eforge:playbook`, `eforge play`, `eforge playbook run`).
  - `integrations.md` — host surfaces (Claude Code plugin, Pi extension, standalone CLI), MCP proxy, shell hooks, Langfuse (if config block exists), input-source extensions (GitHub/Linear/Jira via `eforge://input/<adapter>/<id>`), monitor UI.
  - `troubleshooting.md` — common failure modes and remedies: daemon won't start / port in use, `pnpm docs:check` drift, failed builds and `/eforge:recover`, untrusted extensions, profile-router invalid selection, queue locks, validation-fixer retries exhausted.
- Update `web/lib/nav.ts` to include the four new pages in coherent groups (e.g. `Guides` for profiles + playbooks; new `Integrations` group; `Reference` or `Troubleshooting` group for troubleshooting).
- Update `web/__tests__/content.test.ts` `slugs` array to include the four new slugs so the test runs against them.
- Regenerate docs-gen outputs by running `pnpm docs:generate`. This refreshes `web/content/reference/*.md` (CLI/API/events/config/tools), `web/public/reference/*.md`, `web/public/docs/*.md` (raw guide mirror), `web/public/schemas/*.json`, `web/public/llms.txt`, and `web/public/llms-full.txt`. Commit all resulting changes.
- Verify `pnpm docs:check` passes.
- Verify `pnpm test` and `pnpm type-check` pass.

### Out of Scope

- Legacy root `docs/` directory (architecture.md, config.md, extensions.md, etc.) — only consulted as supporting source if useful; not edited as part of this plan.
- `web/app/page.tsx` (home), `web/app/why/page.tsx` (why eforge) — landing pages; not part of the audit unless an existing claim is materially stale (no evidence of that). Do not edit unless required to fix a broken cross-link.
- Visual/CSS changes, theme work, or layout tweaks under `web/app/` and `web/globals.css`.
- Implementation source changes in `packages/`, `eforge-plugin/`, or `scripts/`. The docs follow current behavior, they do not reshape it.
- Roadmap or speculative-future features. Document only what currently ships.
- Wholesale rewrites of `configuration.md` or `extensions.md`. Keep existing structure; correct in place.
- Adding new generated reference surfaces. The current surface list (`cli`, `api`, `events`, `config`, `tools`) stays the same.
- New documentation under `docs/` (legacy root) or under per-package `README.md` files.

## Files

### Create

- `web/content/docs/profiles.md` — Agent runtime profiles guide. Must cover: scope tiers (`~/.config/eforge/profiles/`, `eforge/profiles/`, `.eforge/profiles/`); precedence (project-local > project > user); the `.active-profile` marker resolution chain visible in `eforge_profile` MCP tool and `/eforge:profile` skill; tier recipe shape (harness + model + effort + optional thinking + optional toolbelt); creating profiles via `/eforge:profile-new`; switching with `/eforge:profile use <name>` or `eforge profile use`; profile metadata (`description`, `whenToUse`, `tags`) and that it is descriptive only; profile-router precedence vs. explicit PRD `profile:` frontmatter (see `web/content/docs/extensions-api.md#registerprofilerouter` for the router contract); planning playbook `profile` inheritance into the session-plan `agent_profile` field; `--profile` override on enqueue/build. Source of truth: `eforge-plugin/skills/profile/profile.md`, `eforge-plugin/skills/profile-new/`, `packages/eforge/src/cli/index.ts` (`profile` command tree if present, else through MCP tool), and the `registerProfileRouter` section already documented in `web/content/docs/extensions-api.md`.
- `web/content/docs/playbooks.md` — Playbooks guide. Must cover: what playbooks are (reusable workflow templates), the two `mode` values (`autonomous` enqueues a PRD directly, `planning` triggers investigation-first agent workflow via `/eforge:plan` and returns `requires-agent`); scope tiers (`~/.config/eforge/playbooks/`, `eforge/playbooks/`, `.eforge/playbooks/`) and shadowing; optional `profile` frontmatter field and how it flows to session plans for planning playbooks; CLI surface (`eforge playbook list/new/edit/run/promote/demote`, `eforge play`); skill surface (`/eforge:playbook` with branches create/edit/run/list/promote/demote); how `eforge_playbook` MCP tool returns `{ kind: 'enqueued' }` for autonomous and `{ kind: 'requires-agent', mode: 'planning' }` for planning playbooks. Source: `eforge-plugin/skills/playbook/playbook.md`, `packages/pi-eforge/skills/eforge-playbook/`, `packages/eforge/src/cli/index.ts` (playbook + play subcommands), and the playbook references already in `web/content/docs/configuration.md` and `web/content/docs/glossary.md`.
- `web/content/docs/integrations.md` — Integrations guide. Must cover: the three host surfaces (Claude Code plugin, Pi extension, standalone CLI) and how `/eforge:init` configures each; the MCP proxy (`eforge mcp-proxy`) used by the Claude Code plugin; shell hooks (link to `Configuration#hooks` and `/reference/config#hooks`); native input-source adapters using `eforge://input/<adapter>/<id>` URIs with GitHub/Linear/Jira examples (link to `/docs/extensions#input-sources-and-prd-enrichers`); Langfuse observability (only if a `langfuse` config block is documented in the generated `reference/config.md`); the monitor web UI (port range 4567-4667, per-project, what it shows); plugin marketplace install steps. Source: `web/content/docs/getting-started.md`, `eforge-plugin/skills/init/init.md`, `packages/pi-eforge/extensions/eforge/index.ts`, `eforge-plugin/.claude-plugin/plugin.json` (marketplace), `examples/extensions/issue-tracker.ts`, and the generated `web/content/reference/config.md` for the langfuse block presence.
- `web/content/docs/troubleshooting.md` — Troubleshooting guide. Must cover, each as a task-oriented section: (a) daemon won't start or port collision — use `eforge daemon status`, `eforge daemon stop --force` (and the active-builds safety check this respects), `eforge daemon kill` as SIGKILL of last resort; (b) `pnpm docs:check` drift — run `pnpm docs:generate` then re-check; (c) failed build recovery — `eforge_status` to confirm failure, `/eforge:recover` skill, `eforge_read_recovery_sidecar`, `eforge_apply_recovery` verdicts (`requeue`, `enqueue-successor`, `archive`); (d) untrusted project/team extension — `extension:untrusted` diagnostic, `eforge extension trust <name>`, `extension:trust-changed` after edits; (e) profile router selected an invalid profile — `queue:profile:invalid-selection` event, what to fix; (f) queue lock files — do not delete by hand, the scheduler reconciles stale locks at runtime; (g) validation-fixer retry exhausted — `build.maxValidationRetries` semantics; (h) extension policy gate `require-approval` currently blocks because no approval workflow exists yet (call this out so users are not surprised). Source: `eforge-plugin/skills/recover/recover.md`, `eforge-plugin/skills/restart/`, `packages/engine/src/...` recovery + scheduler code referenced by the recovery/restart skills, generated `reference/cli.md` and `reference/events.md` for command + event names, and the policy-gate notes already in `web/content/docs/extensions-api.md`.

### Modify

- `web/content/docs/getting-started.md` — Audit against current behavior. Confirm: Node.js 22+ matches `package.json` `engines.node: '>=22'` (currently states 22+, keep). Confirm Pi install command, Claude Code marketplace install commands, monitor port range (4567-4667). Verify the post-Anthropic-policy paragraph remains accurate or is at least caveated (the existing wording covers the Agent SDK credit/API-pricing policy). Add a 'Where to look next' link to the new Profiles, Playbooks, Integrations, and Troubleshooting pages so the new pages are discoverable from the first guide. Do not rewrite the page structure.
- `web/content/docs/concepts.md` — Audit against current behavior. Verify: profile/tier wording matches `glossary.md`; the 'Agent-Readable Artifacts' list still matches what `pnpm docs:generate` emits today (`/llms.txt`, `/llms-full.txt`, `/docs/*.md`, `/reference/*.md`, `/schemas/*.json`); harness names (`pi`, `claude-sdk`). Add a sentence in Workflow Profiles or a new short subsection clarifying that playbooks (planning vs autonomous) are an orthogonal reusable-workflow surface, with a link to the new `/docs/playbooks` page. Do not restructure existing sections.
- `web/content/docs/configuration.md` — Audit and narrow scope. The page currently re-documents profiles inline; trim that section once `/docs/profiles` exists, leaving a brief pointer and the tier-recipe example as configuration context (do NOT delete the profile resolution scopes table — keep that as configuration-level context). Verify: `agents.tiers.*` snippet still matches the schema in generated `reference/config.md`; `extensions` block fields match `web/content/docs/extensions.md` (no field drift); toolbelt preset table matches the gallery in `reference/config.md#toolbelts`; `build.postMergeCommands` + `build.maxValidationRetries` still exist with their current semantics; hooks example still matches `reference/config.md#hooks`. Add a link to the new `/docs/troubleshooting` page from the validation/hooks sections.
- `web/content/docs/extensions.md` — Audit. Verify the Runtime support table at the bottom matches the same table in `extensions-api.md` (both should list `registerValidationProvider` as `Yes (per-plan validate build stage)`, `registerReviewerPerspective` as `Yes (parallel review-cycle dispatch)`, `registerPrdEnricher` as `Yes`, etc. — they already match, confirm no drift). Confirm the `package.json` `eforge.extension` example block fields. Verify the `eforge extension test` flag set against generated `reference/cli.md#test` (`--run`, `--event`, `--fixture`, `--json`). Add a cross-link to the new `/docs/integrations` page from the 'input sources and PRD enrichers' section. Preserve the heading IDs the test asserts on (`event-patterns`, `trust-and-security`).
- `web/content/docs/extensions-api.md` — Audit. Re-verify the per-capability runtime support table (must agree with `extensions.md`). Re-verify each method signature against `@eforge-build/extension-sdk`. The page is large — focus the audit on: (a) `registerValidationProvider` runtime status now reads `Yes`; (b) `registerReviewerPerspective` events list matches `reference/events.md`; (c) `registerPrdEnricher` provenance events; (d) `registerProfileRouter` `selectBuildProfile` vs deprecated `resolve` is consistent with current SDK. Add a cross-link from the top of the page to the new `/docs/profiles` page where `registerProfileRouter` interacts with the user's active profile.
- `web/content/docs/glossary.md` — Audit. Trim the `Playbook` and `Agent runtime profile` entries to short definitions plus 'See `/docs/playbooks`' / 'See `/docs/profiles`' links, since long-form content moves to the new dedicated pages. Add new short entries: `Hooks` (one-liner — shell hooks; link to Configuration#hooks), `Recovery verdict` (one-liner; link to Troubleshooting), `Toolbelt` (one-liner; link to Configuration#toolbelts and Extensions API#toolbelt-vs-extension-boundary), `Monitor` (one-liner — web UI on port 4567-4667; link to Integrations), `Input source` (one-liner — extension adapter that resolves `eforge://input/<adapter>/<id>` URIs; link to Extensions#input-sources-and-prd-enrichers).
- `web/lib/nav.ts` — Add `profiles`, `playbooks`, `integrations`, `troubleshooting` entries to `DOCS_NAV`. Suggested groups: `Guides` for `profiles` and `playbooks` (placed right after `configuration`); a new `Integrations` group for `integrations`; a new `Troubleshooting` group (or extend `Reference`) for `troubleshooting`. Keep the entry shape exactly `{ slug, title, group }` per the existing `DocNavItem` interface. Do NOT add reference entries; the generated reference set is unchanged.
- `web/__tests__/content.test.ts` — Extend the `slugs` array in the `loadDocPage` 'returns non-empty HTML for known doc slugs' test from `['getting-started', 'concepts', 'configuration', 'extensions', 'extensions-api', 'glossary']` to also include `'profiles'`, `'playbooks'`, `'integrations'`, `'troubleshooting'`. No other test changes are required; the existing heading-ID assertions on `extensions` and `config` must keep passing — preserve those headings during audit edits. Do NOT touch the existing reference-slug test (`['cli', 'api', 'events', 'config', 'tools']`).

### Regenerate (Do Not Hand-Edit)

After all content under `web/content/docs/` is final, run `pnpm docs:generate` once. Commit the resulting changes to the following files as part of this plan, even if they look noisy — they are the public mirror and machine-readable artifacts and must stay in sync for `pnpm docs:check` to pass:

- `web/content/reference/cli.md`
- `web/content/reference/api.md`
- `web/content/reference/events.md`
- `web/content/reference/config.md`
- `web/content/reference/tools.md`
- `web/public/reference/*.md` (raw mirror)
- `web/public/docs/*.md` (raw mirror — new entries for `profiles.md`, `playbooks.md`, `integrations.md`, `troubleshooting.md` will appear here only if `packages/docs-gen/src/output-paths.ts` and `packages/docs-gen/src/generators/llms.ts` already include them; if they do NOT, do not modify docs-gen — leave the new pages discoverable through the rendered site only. Do not extend the generator as part of this plan.)
- `web/public/schemas/events.schema.json`
- `web/public/schemas/config.schema.json`
- `web/public/llms.txt`
- `web/public/llms-full.txt`

> **Note**: If `packages/docs-gen/src/output-paths.ts` only knows about the original six docs slugs (`getting-started`, `concepts`, `configuration`, `extensions`, `extensions-api`, `glossary`), the new pages will render on the site but will NOT appear in `web/public/docs/` or `llms*.txt`. Document this in the verification report — do not silently extend docs-gen in this plan; that is a follow-up if the team wants the new pages mirrored.

## Verification

- [ ] Every new doc file exists under `web/content/docs/` with valid YAML frontmatter (`title`, `description`) and at least one `## ` section.
- [ ] `web/lib/nav.ts` `DOCS_NAV` array contains exactly 10 entries: the original 6 plus `profiles`, `playbooks`, `integrations`, `troubleshooting`, in coherent groups.
- [ ] `web/__tests__/content.test.ts` `loadDocPage` slug list includes all 10 doc slugs.
- [ ] `pnpm --filter @eforge-build/web type-check` exits 0.
- [ ] `pnpm test` exits 0 (vitest passes, including the content loader test for all 10 doc slugs and all 5 reference slugs).
- [ ] `pnpm docs:check` exits 0 with the message `No drift or link issues detected. Docs are up-to-date.`
- [ ] No file under `web/content/reference/`, `web/public/reference/`, `web/public/docs/`, `web/public/schemas/`, or `web/public/llms*.txt` was hand-edited; all such changes came from `pnpm docs:generate`.
- [ ] No file outside `web/content/docs/`, `web/lib/nav.ts`, `web/__tests__/content.test.ts`, and the generated outputs listed above was modified.
- [ ] Existing heading IDs the test pins remain present: `id="event-patterns"` and `id="trust-and-security"` in `extensions.md`; `id="toolbelts"` and `id="hooks"` in generated `reference/config.md`.
- [ ] Every new internal link in the new and modified docs points to a slug that exists under `/docs/` or `/reference/` or `/schemas/`; `pnpm docs:check`'s link checker confirms zero broken internal links.
- [ ] No banned vague words (`appropriate`, `properly`, `correctly`, `should`, `good`, `clean`, `well`, `efficient`, `adequate`, `reasonable`, `robust`, `scalable`, `maintainable`, `readable`, `intuitive`, `seamless`) appear in the user-facing prose of the new and modified guides outside of unavoidable quoted contexts.
- [ ] The new pages use task-oriented headings (e.g. `## Create a profile`, `## Run a planning playbook`, `## Recover from a failed build`) rather than implementation-detail headings.
- [ ] The Glossary entries for `Playbook` and `Agent runtime profile` are short and point to the new dedicated pages.
- [ ] `getting-started.md`'s 'Where to Look Next' (or equivalent) section links to all four new pages.
