---
id: plan-01-docs-boundary-and-eforge-plan-docs
name: Refocus public docs/nav/manifest on the kernel boundary, move eforge-plan
  product semantics into optional first-party extension docs, and add
  allowlist-based docs boundary tests without regenerating artifacts.
branch: strengthen-kernel-boundary-plan-annotations-recovery-ux-and-trust-cleanup/docs-boundary-and-eforge-plan-docs
---

# Docs Boundary and eforge-plan Docs

## Architecture Reference

This module implements the **docs-boundary-and-eforge-plan-docs** section from the architecture.

Key constraints from architecture:
- Core eforge is documented as a build-engine kernel: normalized build source in, reviewed/validated code out.
- Playbooks, session plans, `/eforge:plan`-style planning entry points, backlog workflows, workstations, authoring UX, and revision UX are producer, extension, or host surfaces around the kernel.
- eforge-plan product semantics move to extension-owned documentation, not generic core or extension-platform guides.
- Public docs may link to optional first-party extension pages, but core pages must not embed eforge-plan product behavior.
- `web/lib/nav.ts` and `packages/docs-gen/src/manifest.ts` must separate core/kernel pages, extension-platform pages, optional workflow pages, and optional first-party extension pages.
- Generator-source changes are allowed here; generated outputs under `web/public/**`, `web/content/reference/**`, and schema/reference artifacts are refreshed only by `generated-reference-artifacts`.
- Trust cleanup for `extensions.trustProjectExtensions` belongs to `trust-cleanup`; this module avoids that region except where exact neighboring prose must be rearranged.

## Scope

### In Scope

- Rewrite public source docs so the first-build path starts from a direct prompt, PRD, or file build.
- Reframe playbooks, session plans, planning workflows, backlog workflows, workstations, and authoring UX as optional producer/extension/host surfaces.
- Create a public optional first-party eforge-plan documentation page or summary page and keep the full extension-owned eforge-plan README as the canonical product surface.
- Move eforge-plan details such as backlog curation, recommendations, Revise with AI, `planRevisionTurn`, and `backlogCurationDraft` out of generic core and extension-platform docs.
- Update docs navigation and the LLM manifest to categorize core/kernel, extension-platform, optional workflow, and optional first-party extension docs separately.
- Add source-level docs boundary tests with an allowlist for link-only references to optional extension docs.
- Update affected docs tests whose old expectations required eforge-plan product terms in generic extension docs.
- Add generator-source notes so generated API/tool references label playbook and session-plan routes/tools as optional workflow compatibility or extension/host surfaces.

### Out of Scope

- Runtime eforge-plan annotation, workstation, storage, or action changes.
- Recovery contracts, engine recovery behavior, daemon recovery projections, or Console recovery UI.
- Removing `extensions.trustProjectExtensions` from schemas, config types, config docs, loader options, or tests.
- Regenerating `web/public/**`, `web/content/reference/**`, `web/public/reference/**`, `web/public/schemas/**`, `web/public/llms.txt`, or `web/public/llms-full.txt`.
- Changing Claude Code plugin or Pi package skills; changing plugin files would require a plugin version bump and belongs outside this docs-boundary module.

## Implementation Approach

### Overview

Start with bounded searches for eforge-plan product terms in core docs, extension-platform docs, generated-doc source, and docs tests. Apply source-doc changes first, then nav/manifest/generator-source changes, then tests. Keep generated artifacts untouched so the final `generated-reference-artifacts` module can refresh them in one place.

The documentation structure after this module:

- **Core/kernel docs** explain normalized build-source intake, queue/build/landing, profiles, configuration, and daemon behavior.
- **Optional workflow docs** explain playbooks and session-plan compatibility surfaces as producers around the kernel.
- **Extension platform docs** explain generic native extension APIs, boundaries, trust, and host contributions without eforge-plan product semantics.
- **Optional first-party extension docs** contain eforge-plan-specific planning, backlog, recommendation, workstation, and revision behavior.

### Key Decisions

1. **Add a concise public eforge-plan page and keep the extension README canonical.**
   - `web/content/docs/eforge-plan.md` gives the public site and nav an optional first-party extension page.
   - `eforge/extensions/eforge-plan/README.md` remains the detailed extension-owned product document.
   - Public core docs link to the public eforge-plan page as optional first-party extension documentation.

2. **Use category metadata rather than prose-only grouping.**
   - `web/lib/nav.ts` groups docs into distinct user-facing sections.
   - `packages/docs-gen/src/manifest.ts` carries guide categories so `/llms.txt` generation can preserve the boundary for agents.

3. **Keep boundary tests source-focused in this module.**
   - Tests read `README.md`, `web/content/docs/**`, nav, manifest, and the eforge-plan README.
   - Tests do not assert generated public mirrors until the final generated-artifacts module runs.

4. **Use line-level allowlists for optional extension links.**
   - Core docs may contain link-only references such as `eforge-plan`, `@eforge-build/eforge-plan`, or `/docs/eforge-plan` when the line labels the target as optional first-party extension documentation.
   - Core docs may not contain product terms such as `Revise with AI`, `planRevisionTurn`, `backlogCurationDraft`, backlog curation workflow descriptions, recommendation workflow details, or annotation revision semantics.

5. **Keep playbook/session-plan compatibility visible but not kernel-owned.**
   - Direct prompt/PRD/file builds are the primary path.
   - Playbooks and session plans are documented as optional workflow artifacts that compile or normalize into build source before the engine sees them.

## Files

### Create

- `web/content/docs/eforge-plan.md` — public optional first-party extension page. It introduces eforge-plan as an optional package around the kernel, links to `eforge/extensions/eforge-plan/README.md`, and summarizes planning/backlog/revision behavior with explicit non-kernel boundaries.
- `test/docs-kernel-boundary.test.ts` — source-level boundary test suite with allowlisted optional-extension links and forbidden eforge-plan product terms in core and generic extension-platform docs.

### Modify

- `README.md` — keep the kernel framing prominent; ensure any mentions of playbooks, session plans, planning workflows, backlog workflows, workstations, or authoring UX label them as optional producer/extension/host surfaces rather than core capabilities.
- `web/content/docs/getting-started.md` — make direct `/eforge:build <prompt>`, `eforge build "..."`, and PRD/file builds the primary first-build path; move eforge-plan, playbook, and session-plan flows into an optional section that links to the eforge-plan and playbook docs.
- `web/content/docs/concepts.md` — rename the session-plan-centered build source section to a normalized build-source boundary section; remove session plans and playbooks as core concepts; add concise producer-model text for optional hosts/extensions.
- `web/content/docs/configuration.md` — separate core daemon/build/profile configuration from optional workflow and extension configuration `[region: docs-boundary-and-eforge-plan-docs, headings/prose that frame core versus optional workflow configuration; avoid trustProjectExtensions removal text owned by trust-cleanup]`.
- `web/content/docs/integrations.md` — separate core host build/status/config commands from optional workflow commands; describe extension contribution discovery for eforge-plan as optional first-party extension routing rather than a kernel planning command.
- `web/content/docs/playbooks.md` — label playbooks as optional workflow artifacts around the kernel; state autonomous playbooks normalize to build source and planning-mode playbooks route to eforge-plan when available.
- `web/content/docs/extensions.md` — keep native extension API and boundary content generic; replace detailed eforge-plan product descriptions with a short optional first-party package link `[region: docs-boundary-and-eforge-plan-docs, generic extension API/boundary text plus first-party eforge-plan link; trust field prose remains trust-cleanup-owned]`.
- `web/content/docs/extensions-api.md` — keep SDK/API reference generic; remove product-specific `planRevisionTurn`, `backlogCurationDraft`, Revise with AI, backlog curation, recommendation workflow, and annotation semantics; link to optional eforge-plan docs for first-party task usage `[region: docs-boundary-and-eforge-plan-docs, generic API/boundary text and product-semantics cleanup; trust-model wording remains trust-cleanup-owned]`.
- `eforge/extensions/eforge-plan/README.md` — ensure the introduction/package/usage/storage/workstation sections own the planning-specific details removed from public core/platform docs, including backlog curation, recommendations, daemon-owned task boundaries, plan revision turns, and Revise with AI boundaries `[region: docs-boundary-and-eforge-plan-docs, introduction, install/package, usage/action overview, storage, workstation, and migrated-product-semantics sections outside ## Annotation revision workflow]`.
- `web/lib/nav.ts` — add the eforge-plan doc page and group pages distinctly, for example `Core kernel`, `Optional workflows`, `Extension platform`, `First-party extensions`, `Integrations`, `Operations`, and `Reference`.
- `packages/docs-gen/src/manifest.ts` — revise summary/overview to kernel wording; add guide category metadata or split guide arrays so core/kernel, extension platform, optional workflow, and optional first-party extension links are emitted distinctly.
- `packages/docs-gen/src/output-paths.ts` — add the public mirror path for `eforge-plan.md` if the new page is mirrored by the LLM generator.
- `packages/docs-gen/src/generators/llms.ts` — mirror `web/content/docs/eforge-plan.md` during generation and include it in category-aware `/llms.txt` and `/llms-full.txt` behavior without writing generated artifacts in this module.
- `packages/docs-gen/src/generators/api.ts` — add static guide text near the route table stating that `playbook*`, `sessionPlan*`, and `sessionPlanSet*` routes are optional workflow compatibility/producer surfaces, not kernel capabilities.
- `packages/docs-gen/src/generators/tools.ts` — add static guide text near the tool/skill tables stating that playbook and session-plan host tools prepare or manage optional workflow artifacts around normalized build source, not kernel planning ownership.
- `web/__tests__/content.test.ts` — include the new `eforge-plan` slug, update journey snippets to keep direct builds primary, and assert the nav group split.
- `test/eforge-plan-plan-revision-docs.test.ts` — move plan-revision documentation expectations to `eforge/extensions/eforge-plan/README.md` and the new optional eforge-plan doc page; remove expectations that generic extension docs contain `planRevisionTurn` or Revise with AI.
- `test/extension-platform-docs-examples.test.ts` — update extension-platform expectations so generic docs still cover `ctx.agentTasks`, workstations, and unsupported multi-turn/raw-template boundaries without requiring eforge-plan product terms.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — update docs assertions that currently require `planRevisionTurn` or deprecated first-party revision prose in generic extension docs.
- `test/reference-content.test.ts` — update mirror/source slug lists only if they are hard-coded; keep generated-output drift checks for the generated-artifacts module to satisfy after regeneration.
- `docs/config.md` — keep root configuration docs aligned with the core-versus-optional workflow framing when root docs remain active in tests `[region: docs-boundary-and-eforge-plan-docs, playbook/session-plan/kernel-boundary paragraphs only; trust field prose remains trust-cleanup-owned]`.
- `docs/extensions.md` — keep root extension docs aligned with generic extension boundary text and eforge-plan product-semantics removal when root docs remain active in tests `[region: docs-boundary-and-eforge-plan-docs, generic extension API/boundary text plus first-party eforge-plan link; trust field prose remains trust-cleanup-owned]`.
- `docs/extensions-api.md` — keep root API docs aligned with generic task-boundary text and eforge-plan product-semantics removal when root docs remain active in tests `[region: docs-boundary-and-eforge-plan-docs, generic API/task-boundary text; trust-model wording remains trust-cleanup-owned]`.

### Shared File Issue Discovered

The architecture shared-file registry covers `web/content/docs/configuration.md`, `web/content/docs/extensions.md`, `web/content/docs/extensions-api.md`, and `eforge/extensions/eforge-plan/README.md`. Exploration also found active tests reading root docs:

- `docs/config.md`
- `docs/extensions.md`
- `docs/extensions-api.md`

If builders keep these root docs in sync with public source docs, treat them as additional shared files with `trust-cleanup`:

- `docs/config.md` — docs-boundary owns playbook/session-plan/kernel-boundary paragraphs; trust-cleanup owns `extensions.trustProjectExtensions` removal and local-hash-trust wording.
- `docs/extensions.md` — docs-boundary owns generic extension boundary text, eforge-plan product-semantics removal, and optional eforge-plan links; trust-cleanup owns trust-field removal and trust-model wording.
- `docs/extensions-api.md` — docs-boundary owns generic API/task-boundary text and eforge-plan product-semantics removal; trust-cleanup owns trust-model wording if present.

If implementation decides root docs are no longer active public sources, update tests to stop treating them as required public docs instead of editing them.

### Do Not Modify

- `web/public/docs/**`
- `web/public/reference/**`
- `web/content/reference/**`
- `web/public/schemas/**`
- `web/public/llms.txt`
- `web/public/llms-full.txt`
- `packages/engine/src/config.ts` and config schemas/types for `extensions.trustProjectExtensions`
- `eforge-plugin/**` and `packages/pi-eforge/**`

## Testing Strategy

### Unit Tests

- Add `test/docs-kernel-boundary.test.ts` with these assertions:
  - Core docs contain kernel phrases such as `build-engine kernel` and `normalized build source`.
  - `web/content/docs/getting-started.md` presents a direct prompt/PRD/file build before optional eforge-plan/playbook/session-plan sections.
  - Core docs reject forbidden product terms after line-level optional-link allowlists are removed.
  - `web/content/docs/extensions.md` and `web/content/docs/extensions-api.md` reject `Revise with AI`, `planRevisionTurn`, `backlogCurationDraft`, backlog curation prose, recommendation workflow prose, and annotation revision semantics.
  - Optional eforge-plan docs contain the migrated product terms and the extension-owned storage boundary.
  - Nav groups include separate core/kernel, extension-platform, optional workflow, and first-party extension groups.
  - The LLM manifest categories include at least one entry in each required category.

- Update existing docs tests:
  - `test/eforge-plan-plan-revision-docs.test.ts` verifies eforge-plan README and optional eforge-plan page content, not generic extension docs.
  - `test/extension-platform-docs-examples.test.ts` verifies generic extension API coverage and unsupported boundaries without product-specific output-section names.
  - `test/extension-tooling-wiring-runtime-docs.test.ts` verifies `ctx.agentTasks` generic boundaries without requiring eforge-plan revision text.
  - `web/__tests__/content.test.ts` verifies the new slug and group split.

### Integration Tests

- Run targeted docs/source tests that do not require regenerated public artifacts:
  - `pnpm vitest run test/docs-kernel-boundary.test.ts test/eforge-plan-plan-revision-docs.test.ts test/extension-platform-docs-examples.test.ts test/extension-tooling-wiring-runtime-docs.test.ts web/__tests__/content.test.ts`
- Do not run `pnpm docs:check` as a module-local gate after source changes; generated mirror drift remains until `generated-reference-artifacts` runs.

## Verification

- [ ] `README.md` contains `build-engine kernel` and `normalized build source`.
- [ ] `web/content/docs/getting-started.md` contains a direct prompt build example before the first eforge-plan, playbook, or session-plan optional section.
- [ ] `web/content/docs/concepts.md` contains a normalized build-source boundary section.
- [ ] `web/content/docs/concepts.md` contains no heading named `Build Sources and Session Plans`.
- [ ] `web/content/docs/extensions.md` contains no `planRevisionTurn`.
- [ ] `web/content/docs/extensions.md` contains no `backlogCurationDraft`.
- [ ] `web/content/docs/extensions.md` contains no `Revise with AI`.
- [ ] `web/content/docs/extensions-api.md` contains no `planRevisionTurn`.
- [ ] `web/content/docs/extensions-api.md` contains no `backlogCurationDraft`.
- [ ] `web/content/docs/extensions-api.md` contains no `Revise with AI`.
- [ ] `web/content/docs/eforge-plan.md` contains `Revise with AI`, `planRevisionTurn`, `backlogCurationDraft`, and `.eforge/storage/extensions/eforge-plan/`.
- [ ] `eforge/extensions/eforge-plan/README.md` contains the migrated planning, backlog, recommendation, and revision details.
- [ ] `web/lib/nav.ts` has separate groups for core/kernel pages, extension-platform pages, optional workflow pages, and first-party extension pages.
- [ ] `packages/docs-gen/src/manifest.ts` has separate categories or sections for core/kernel pages, extension-platform pages, optional workflow pages, and first-party extension pages.
- [ ] `test/docs-kernel-boundary.test.ts` fails when `Revise with AI` is inserted into `web/content/docs/concepts.md` outside an allowlisted optional-doc link line.
- [ ] `test/docs-kernel-boundary.test.ts` fails when `backlogCurationDraft` is inserted into `web/content/docs/extensions-api.md`.
- [ ] `packages/docs-gen/src/generators/api.ts` labels playbook and session-plan routes as optional workflow compatibility or producer surfaces.
- [ ] `packages/docs-gen/src/generators/tools.ts` labels playbook and session-plan tools as optional workflow compatibility or host surfaces.
- [ ] `git diff --name-only` for this module contains no `web/public/` paths.
- [ ] Targeted docs/source vitest suites listed in the testing strategy exit 0, excluding known generated-artifact drift.

<build-config>
{
  "build": [["implement", "doc-author"], "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["docs", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
