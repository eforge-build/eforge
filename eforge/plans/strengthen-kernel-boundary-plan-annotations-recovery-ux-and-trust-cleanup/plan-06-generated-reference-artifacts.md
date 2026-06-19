---
id: plan-06-generated-reference-artifacts
name: Regenerate and verify public docs mirrors, reference docs, JSON schemas,
  and LLM artifacts after source docs, client contracts, and config schema
  changes land.
branch: strengthen-kernel-boundary-plan-annotations-recovery-ux-and-trust-cleanup/generated-reference-artifacts
---

# Generated Reference Artifacts

## Architecture Reference

This module implements the **generated-reference-artifacts** section from the architecture.

Key constraints from architecture:
- Run after `docs-boundary-and-eforge-plan-docs`, `eforge-plan-annotation-revisions`, `recovery-contracts-and-engine`, `recovery-daemon-console`, and `trust-cleanup` have landed.
- Refresh generated public docs mirrors, reference Markdown, JSON schemas, and LLM bundles from source-owned docs, client contracts, and engine config schemas.
- Generated outputs are downstream artifacts only; source docs, generator source, client contracts, engine config, daemon code, Console code, and eforge-plan runtime code are owned by dependency modules.
- `packages/docs-gen/src/generators/llms.ts` must run after the CLI/API/events/config/tools generators because `llms-full.txt` reads their generated outputs.
- The generator output must preserve the kernel/extension boundary introduced by the docs-boundary module.
- The generated event schema/reference must expose the client-owned `queue:prd:dispatch-failed` event and queue `dispatchFailure` snapshot field introduced by recovery modules.
- The generated config schema/reference and public mirrors must not contain the removed `extensions.trustProjectExtensions` field.
- `pnpm docs:generate` and `pnpm docs:check` are the source-of-truth commands for generated artifact refresh and drift validation.

## Scope

### In Scope

- Run the full docs generator after all dependency modules merge.
- Commit generated raw public guide mirrors under `web/public/docs/**`, including the new optional first-party eforge-plan page mirror.
- Commit generated reference Markdown under `web/content/reference/**` and `web/public/reference/**`.
- Commit generated machine-readable schemas under `web/public/schemas/**`.
- Commit generated agent artifacts `web/public/llms.txt` and `web/public/llms-full.txt`.
- Verify generated API/tool references label playbook and session-plan surfaces as optional workflow compatibility or extension/host producer surfaces.
- Verify generated event reference and schema include `queue:prd:dispatch-failed` and queue dispatch-failure projection fields.
- Verify generated config reference and schema omit `extensions.trustProjectExtensions`.
- Verify public guide mirrors are byte-identical to `web/content/docs/**` sources.
- Verify docs drift, link checks, docs boundary tests, and generated-content tests after regeneration.

### Out of Scope

- Editing hand-authored source docs in `README.md`, `docs/**`, or `web/content/docs/**`.
- Editing docs navigation, docs manifest, or generator source under `packages/docs-gen/src/**`; dependency modules own those source changes.
- Editing client event, route, queue item, recovery, or API contracts.
- Editing engine config schemas or trust-removal code.
- Editing daemon projections/routes or Console recovery UI.
- Editing eforge-plan extension runtime, workstation, storage, or README sections.
- Regenerating compiled JavaScript bundles, workstation assets, lockfiles, or package versions.

## Implementation Approach

### Overview

This module is a final artifact sync and verification pass. Start only after dependency modules have merged and their targeted source tests have passed. Build the docs generator through the root script, run `pnpm docs:generate`, inspect the generated diff, and then run drift/link/boundary tests that read generated outputs.

The expected implementation is command-driven:

```bash
pnpm docs:generate
git diff -- web/content/reference web/public/reference web/public/docs web/public/schemas web/public/llms.txt web/public/llms-full.txt
pnpm docs:check
```

If `pnpm docs:generate` fails because a dependency module did not add a needed generator source change, stop and hand the source bug back to the owning module unless the fix is a trivial generator integration typo discovered during this final sync. Any generator source fix made here must be a bounded edit, followed by another full regeneration.

### Key Decisions

1. **Generate all surfaces, not a subset.** `llms-full.txt` concatenates guide mirrors and reference outputs, so partial generation can leave a coherent-looking but stale bundle.
2. **Do not hand-edit generated Markdown or JSON.** Every output change must come from `pnpm docs:generate`; manual edits will be overwritten and can mask source/generator defects.
3. **Treat the new eforge-plan public mirror as generated.** `web/content/docs/eforge-plan.md` is the hand-authored source from the docs-boundary module; `web/public/docs/eforge-plan.md` is created by the LLM/docs mirror generator.
4. **Use generated artifacts as contract evidence.** The events schema/reference must prove the recovery event contract is public; the config schema/reference must prove the removed trust field is absent; the API/tools references must prove optional workflow surfaces are labeled outside the kernel.
5. **Run drift and link checks after regeneration.** `pnpm docs:check` catches missing mirrors, stale references, broken internal links, and byte drift across all generated output paths.

## Files

### Create

- `web/public/docs/eforge-plan.md` — generated raw mirror of the optional first-party eforge-plan page created by `docs-boundary-and-eforge-plan-docs`.

### Modify

- `web/public/docs/getting-started.md` — regenerated raw mirror of the hand-authored first-build guide.
- `web/public/docs/concepts.md` — regenerated raw mirror of the normalized build-source boundary guide.
- `web/public/docs/configuration.md` — regenerated raw mirror reflecting core/optional config boundaries and trust-field removal.
- `web/public/docs/extensions.md` — regenerated raw mirror reflecting generic extension platform boundaries and trust-field removal.
- `web/public/docs/extensions-api.md` — regenerated raw mirror reflecting generic extension API boundaries.
- `web/public/docs/playbooks.md` — regenerated raw mirror labeling playbooks as optional workflow artifacts.
- `web/public/docs/integrations.md` — regenerated raw mirror reflecting core commands versus optional workflow/extension commands.
- `web/public/docs/profiles.md` — regenerated raw mirror; expected to remain byte-identical unless dependency docs changed links or cross-references.
- `web/public/docs/stacking.md` — regenerated raw mirror; expected to remain byte-identical unless dependency docs changed links or recovery wording.
- `web/public/docs/troubleshooting.md` — regenerated raw mirror; expected to remain byte-identical unless dependency docs changed recovery or docs-generation guidance.
- `web/public/docs/glossary.md` — regenerated raw mirror; expected to remain byte-identical unless dependency docs changed terminology.
- `web/content/reference/api.md` — regenerated API reference from `@eforge-build/client` route constants and generator guide text.
- `web/public/reference/api.md` — regenerated raw public API reference mirror.
- `web/content/reference/cli.md` — regenerated CLI reference from `@eforge-build/eforge` command metadata.
- `web/public/reference/cli.md` — regenerated raw public CLI reference mirror.
- `web/content/reference/config.md` — regenerated config reference from `packages/engine/src/config.ts` and config generator guide text.
- `web/public/reference/config.md` — regenerated raw public config reference mirror.
- `web/content/reference/events.md` — regenerated event protocol reference from `@eforge-build/client` event schemas.
- `web/public/reference/events.md` — regenerated raw public event reference mirror.
- `web/content/reference/tools.md` — regenerated tools/skills reference from Claude Code plugin and Pi extension surfaces plus generator guide text.
- `web/public/reference/tools.md` — regenerated raw public tools reference mirror.
- `web/public/schemas/config.schema.json` — regenerated JSON schema from the engine config schema after `extensions.trustProjectExtensions` removal.
- `web/public/schemas/events.schema.json` — regenerated JSON schema from the client event schema after recovery event/snapshot additions.
- `web/public/llms.txt` — regenerated curated LLM manifest from `packages/docs-gen/src/manifest.ts`.
- `web/public/llms-full.txt` — regenerated concatenated guide/reference bundle after all mirror and reference outputs are current.

### Do Not Modify

- `web/content/docs/**` — source docs are owned by dependency modules.
- `README.md` and root `docs/**` — source docs are owned by dependency modules.
- `packages/docs-gen/src/**` — generator source changes are owned by dependency modules unless this module discovers a blocking generator integration typo during final regeneration.
- `packages/client/src/**`, `packages/engine/src/**`, `packages/monitor/src/**`, `packages/console-ui/src/**`, `eforge/extensions/eforge-plan/**` — contract/runtime/source changes are owned by dependency modules.

No files in the architecture Shared File Registry are edited by this module. This module writes generated downstream copies of shared source docs only.

## Implementation Steps

1. **Confirm dependency handoff state.**
   - Verify `web/content/docs/eforge-plan.md` exists.
   - Verify `packages/docs-gen/src/output-paths.ts` and `packages/docs-gen/src/generators/llms.ts` include the eforge-plan public mirror path.
   - Verify `packages/docs-gen/src/generators/api.ts` and `packages/docs-gen/src/generators/tools.ts` include optional workflow/producer-surface guide text.
   - Verify `packages/client/src/events/queue-events.ts` or the relevant queue-event module defines `queue:prd:dispatch-failed`.
   - Verify `packages/engine/src/config.ts` no longer exposes `extensions.trustProjectExtensions`.
2. **Build and run the generator.**
   - Run `pnpm docs:generate` from the repo root.
   - Do not edit generated files by hand after this command.
3. **Inspect generated diff boundaries.**
   - Run `git diff --name-only` and confirm generated changes are limited to `web/public/docs/**`, `web/content/reference/**`, `web/public/reference/**`, `web/public/schemas/**`, `web/public/llms.txt`, and `web/public/llms-full.txt` unless a bounded generator-source bug fix was made.
   - Review `web/public/docs/eforge-plan.md` creation and public guide mirror diffs for source parity.
4. **Validate generated contract content.**
   - Check event reference/schema for `queue:prd:dispatch-failed`, `stage`, `reason`, and `dispatchFailure`.
   - Check config schema/reference and generated bundles for absence of `trustProjectExtensions`.
   - Check API/tools references for `optional workflow` text near playbook/session-plan surfaces.
   - Check `llms.txt` category wording for core/kernel, extension platform, optional workflow, and first-party extension guide entries.
5. **Run drift, link, and generated-content tests.**
   - Run `pnpm docs:check`.
   - Run the targeted vitest suites listed below.
   - Run final repository gates listed in Verification when handoff time permits.

## Testing Strategy

### Unit Tests

- `test/docs-gen-determinism.test.ts` — drift check, generator determinism, generated table descriptions, and reference artifact invariants.
- `test/docs-link-check.test.ts` — internal link validation for source docs, public mirrors, reference docs, selected root docs, and skill docs.
- `test/reference-content.test.ts` — raw mirror parity, generated reference sections, LLM manifest references, and public docs stale-path checks.
- `web/__tests__/content.test.ts` — docs nav/source/public slug parity, public guide structure, generated LLM artifact content, and reference-page rendering.
- `test/docs-kernel-boundary.test.ts` — generated mirror and manifest boundary assertions added by the docs-boundary module, if that test reads generated artifacts after this module.
- `test/eforge-plan-plan-revision-docs.test.ts` — eforge-plan optional documentation and generated `llms-full.txt` references for revision terms.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — generated schema/docs assertions around extension trust and runtime documentation.

### Integration Tests

- `pnpm docs:generate` — builds docs-gen dependencies and writes every generated artifact.
- `pnpm docs:check` — regenerates into a temp directory, compares every output path byte-for-byte, and runs the internal link checker.
- `pnpm type-check` — verifies source modules that feed the generators still compile after dependency module changes.
- `pnpm test` — final full-suite gate after generated artifacts are current.
- `pnpm maintainability:check` — file-size and region-marker balance gate after generated output changes are staged.

### Targeted Commands

```bash
pnpm docs:generate
pnpm docs:check
pnpm exec vitest run test/docs-gen-determinism.test.ts test/docs-link-check.test.ts test/reference-content.test.ts web/__tests__/content.test.ts
pnpm exec vitest run test/docs-kernel-boundary.test.ts test/eforge-plan-plan-revision-docs.test.ts test/extension-tooling-wiring-runtime-docs.test.ts
pnpm type-check
pnpm test
pnpm maintainability:check
```

## Verification

- [ ] `pnpm docs:generate` exits 0.
- [ ] `git diff --name-only` after generation contains only generated artifact paths plus any explicitly documented bounded generator-source fix.
- [ ] `web/public/docs/eforge-plan.md` exists.
- [ ] Every Markdown file in `web/content/docs/` has a byte-identical mirror in `web/public/docs/`.
- [ ] Every Markdown file in `web/content/reference/` has a byte-identical mirror in `web/public/reference/`.
- [ ] `web/public/llms.txt` contains guide entries for core/kernel, extension platform, optional workflow, and first-party extension docs.
- [ ] `web/public/llms-full.txt` contains a `guide:eforge-plan` section when `web/content/docs/eforge-plan.md` exists.
- [ ] `web/content/reference/api.md` contains text labeling playbook routes as optional workflow compatibility or producer surfaces.
- [ ] `web/content/reference/api.md` contains text labeling session-plan routes as optional workflow compatibility or producer surfaces.
- [ ] `web/content/reference/tools.md` contains text labeling playbook tools as optional workflow or host surfaces.
- [ ] `web/content/reference/tools.md` contains text labeling session-plan tools as optional workflow or host surfaces.
- [ ] `web/content/reference/events.md` contains `queue:prd:dispatch-failed`.
- [ ] `web/public/reference/events.md` contains `queue:prd:dispatch-failed`.
- [ ] `web/public/schemas/events.schema.json` contains `queue:prd:dispatch-failed`.
- [ ] `web/public/schemas/events.schema.json` contains `dispatchFailure`.
- [ ] `web/public/schemas/config.schema.json` contains no `trustProjectExtensions` string.
- [ ] `web/content/reference/config.md` contains no `trustProjectExtensions` string.
- [ ] `web/public/reference/config.md` contains no `trustProjectExtensions` string.
- [ ] `web/public/docs/**`, `web/public/reference/**`, `web/public/schemas/**`, `web/public/llms.txt`, and `web/public/llms-full.txt` contain no `trustProjectExtensions` string.
- [ ] `web/public/docs/extensions.md` contains no `planRevisionTurn`, `backlogCurationDraft`, or `Revise with AI` string.
- [ ] `web/public/docs/extensions-api.md` contains no `planRevisionTurn`, `backlogCurationDraft`, or `Revise with AI` string.
- [ ] `web/public/docs/eforge-plan.md` contains `planRevisionTurn`, `backlogCurationDraft`, and `Revise with AI`.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm exec vitest run test/docs-gen-determinism.test.ts test/docs-link-check.test.ts test/reference-content.test.ts web/__tests__/content.test.ts` exits 0.
- [ ] `pnpm exec vitest run test/docs-kernel-boundary.test.ts test/eforge-plan-plan-revision-docs.test.ts test/extension-tooling-wiring-runtime-docs.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["docs", "verify"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
