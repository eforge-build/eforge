---
id: plan-03-docs-llm-authoring
name: Documentation, LLM Artifacts, and Migration Guidance
branch: add-sandboxed-console-workstations-for-extensions/plan-03-docs-llm-authoring
agents:
  builder:
    effort: medium
    rationale: Documentation-heavy plan with small docs-generation code changes and
      generated artifact updates.
  reviewer:
    effort: high
    rationale: Docs must preserve the new sandbox boundary, deferred bundle scope,
      and LLM artifact discoverability.
---

# Documentation, LLM Artifacts, and Migration Guidance

## Architecture Context

Plans 01 and 02 add the V1 workstation contract and Console route. This plan updates author-facing docs, dogfood extension docs, Console route docs, README positioning, and generated LLM artifacts so humans and coding agents can discover the supported V1 path and the deferred boundaries.

The web docs source lives under `web/content/docs/`; `pnpm docs:generate` mirrors those pages to `web/public/docs/` and refreshes `/llms.txt` and `/llms-full.txt`. Root `docs/*.md` files also need bounded edits because repository readers and tests inspect them directly.

## Implementation

### Overview

Document sandboxed iframe `srcDoc` workstations, `registerConsoleWorkstation`, `ConsoleWorkstation`, `defineConsoleWorkstation`, `window.eforge.invokeAction`, action allowlisting/defaults, and the deferred asset-bundle/React/raw-route boundaries. Add LLM-first authoring guidance and a canonical SDK stability/migration section. Update docs-gen so `/llms.txt` links directly to the authoring and migration guidance and `/llms-full.txt` includes guide content, not only generated reference surfaces.

### Key Decisions

1. Put the LLM-first authoring checklist in the existing Extensions guide instead of adding a separate nav page; this preserves the current public docs nav shape while making the guidance discoverable from `/llms.txt`.
2. Put canonical SDK migration guidance in the Extensions API reference and link to it from the Extensions guide and SDK README.
3. Keep V1 language explicit: workstations are trusted extension UI isolated by iframe sandbox; workstation HTML is not sanitized declarative content.
4. Preserve the deferred status of separately served asset bundles, React renderer injection, raw extension-owned HTTP routes, and extension-owned AI planning/chat APIs.

## Scope

### In Scope

- Root docs and web docs updates for Console workstations.
- Extension SDK README quick authoring example and migration/stability section.
- Console UI README route table/data flow/control-surface guidance update.
- eforge-plan README deferred-platform-gap update.
- Project README short mention of Console workstations.
- Docs generator/manifest update so LLM artifacts reference and contain the new guidance.
- Generated `web/public/docs/*.md`, `web/public/llms.txt`, and `web/public/llms-full.txt` updates from `pnpm docs:generate`.
- Docs/tests updates that assert workstation docs, LLM authoring guidance, migration guidance, and generated artifact coverage.

### Out of Scope

- New SDK runtime features beyond those implemented in plans 01 and 02.
- New public documentation route if the existing Extensions/Extensions API pages can host the required guidance.
- A full natural-language extension builder.
- SDK-provided chat widgets or host-rendered slot APIs.

## Files

### Create

None expected. If the builder determines a separate short docs page is necessary, also update `web/lib/nav.ts`, `web/__tests__/content.test.ts`, `packages/docs-gen/src/output-paths.ts`, `packages/docs-gen/src/generators/llms.ts`, and public mirrors in the same change.

### Modify

- `docs/extensions.md` — add a Console workstations section, V1 iframe/srcDoc/action-bridge model, sandbox/trust notes, deferred boundaries, and an LLM-first extension authoring checklist with scaffold/validate/test/trust/reload commands.
- `web/content/docs/extensions.md` — same content adapted to web-doc links/frontmatter style.
- `docs/extensions-api.md` — add `registerConsoleWorkstation`, `ConsoleWorkstation`, `defineConsoleWorkstation`, bridge protocol/helper, allowed-action behavior, runtime status table row, and canonical SDK stability/migration guidance. Use bounded edits because the file is over 1,000 lines.
- `web/content/docs/extensions-api.md` — same content adapted to web-doc links/frontmatter style. Use bounded edits because the file is over 1,000 lines.
- `packages/extension-sdk/README.md` — add a minimal workstation example, clarify V1 uses iframe `srcDoc` rather than shared React, document `window.eforge.invokeAction`, and add stability/versioning/migration guidance linking to the docs page.
- `examples/extensions/README.md` — add a short note pointing agents to the workstation docs/example if docs tests require all authoring docs to mention the shipped family.
- `packages/console-ui/README.md` — add `/console/workstations` to the route table/data flow and update “Adding a new control surface” to distinguish source-owned routes, declarative System contributions, and extension-registered workstations.
- `eforge/extensions/eforge-plan/README.md` — replace the statement that workstation APIs are absent with language that V1 iframe workstations exist while full eforge-plan workstation UX, asset bundles, AI planning/chat APIs, and raw routes remain follow-ups.
- `README.md` — add one short mention that native extensions can register sandboxed Console workstations in addition to declarative System contributions.
- `packages/docs-gen/src/manifest.ts` — add direct `/llms.txt` links or descriptions for the extension authoring checklist and SDK migration guidance.
- `packages/docs-gen/src/generators/llms.ts` — include mirrored guide markdown in `llms-full.txt` so agent-facing bundles contain the authoring checklist and migration guidance text.
- `web/public/docs/extensions.md`, `web/public/docs/extensions-api.md`, `web/public/llms.txt`, `web/public/llms-full.txt`, and any generated reference files changed by `pnpm docs:generate` — refresh and commit generated outputs.
- `test/extension-platform-docs-examples.test.ts` — assert docs preserve workstation support and deferred boundaries.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — assert runtime status rows include `registerConsoleWorkstation` with wired support.
- `web/__tests__/content.test.ts` — assert Extensions docs mention LLM authoring, workstation helper, and SDK migration guidance; assert `llms.txt`/`llms-full.txt` contain those strings.

## Verification

- [ ] Extensions docs describe V1 as sandboxed iframe `srcDoc` with a parent-owned action bridge.
- [ ] Extensions docs state workstation HTML is trusted extension UI isolated by iframe sandbox, not sanitized declarative content.
- [ ] Extensions docs state separately served frontend asset bundles remain deferred.
- [ ] Extensions docs state direct React component loading remains deferred.
- [ ] Extensions docs state extension-owned HTTP routes remain deferred.
- [ ] Extensions docs state extension-owned AI planning/chat APIs remain deferred.
- [ ] Extension API docs include a `registerConsoleWorkstation` method section with signature and runtime status.
- [ ] Extension API docs include `ConsoleWorkstation` and `defineConsoleWorkstation` examples.
- [ ] Extension API docs describe `window.eforge.invokeAction(actionId, input)` and the parent bridge response behavior.
- [ ] Extension API docs describe explicit `allowedActions` and omitted-allowlist same-extension default behavior.
- [ ] Extension authoring docs include an LLM-oriented checklist with `eforge extension new`, `eforge extension validate`, `eforge extension test`, `eforge extension trust`, and `eforge extension reload`.
- [ ] Extension authoring docs include a minimal workstation example that calls `window.eforge.invokeAction`.
- [ ] Extension SDK docs include a stability/versioning section and a canonical migration-guidance location.
- [ ] Workstation docs state reusable SDK-provided widgets use the versioned workstation browser SDK or host-rendered slots, not private Console React imports.
- [ ] `packages/console-ui/README.md` lists `/console/workstations` and describes extension-registered workstations separately from source-owned routes and declarative System contributions.
- [ ] `eforge/extensions/eforge-plan/README.md` no longer states that workstation APIs are entirely absent.
- [ ] `web/public/llms.txt` contains links or entries for the extension authoring checklist and SDK migration guidance.
- [ ] `web/public/llms-full.txt` contains the extension authoring checklist text.
- [ ] `web/public/llms-full.txt` contains the SDK migration guidance text.
- [ ] `pnpm docs:generate` exits 0 and generated public docs/LLM artifacts are committed.
- [ ] `pnpm docs:check` exits 0.
