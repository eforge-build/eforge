---
id: plan-06-docs-and-examples
name: Update extension, SDK, Console, and generated public docs for srcDoc
  versus frameBundle workstation authoring boundaries.
branch: implement-iframe-bundled-console-workstation-sdk/docs-and-examples
---

# Docs and Examples

## Architecture Reference

This module implements the `docs-and-examples` implementation guide plus the architecture sections `Docs -> generated web docs`, `Source registration shape`, `Frame shell and bridge contract`, `Browser SDK contract`, and `Monitor serving -> Console rendering`.

Key constraints from architecture:
- Documentation must describe both workstation source modes: existing iframe `srcDoc` and new iframe-scoped `frameBundle` assets.
- Existing `srcDoc` authoring remains source-compatible and remains documented as a supported path.
- `frameBundle` documentation must state that bundle JavaScript executes inside the workstation iframe boundary, not in the parent Console realm.
- Browser bundle authors use `@eforge-build/extension-sdk/browser`; they do not import private Console React/components/CSS or parent Console context.
- Bundle assets are declared static files under `workstation-assets/`, served from eforge-owned daemon frame/asset routes, and covered by project/team trust hashing.
- Direct parent-Console React loading, private Console imports, parent-Console plugins, Module Federation, arbitrary frontend plugins, raw extension-owned HTTP routes, extension-owned AI planning/chat APIs, and frontend install/build pipelines remain unsupported or deferred.
- Public guide sources under `web/content/docs/` and generated outputs under `web/public/` / `web/content/reference/` must be regenerated and drift-checked with `pnpm docs:generate` and `pnpm docs:check`.
- Claude Code plugin and Pi extension authoring skills must stay in sync when extension authoring guidance changes. If the Claude plugin skill changes, bump `eforge-plugin/.claude-plugin/plugin.json`; do not bump `packages/pi-eforge/package.json`.

## Scope

### In Scope
- Update root extension docs for `srcDoc` versus `frameBundle` workstation authoring, trust hashing, iframe/CSP/asset boundaries, and browser SDK usage.
- Update public web guide sources for the same content with public-site link conventions.
- Update `@eforge-build/extension-sdk` README with concise `frameBundle` registration and browser SDK snippets.
- Update Console README route/data-flow/control-surface guidance for dual-mode workstation rendering and daemon frame/asset serving.
- Update extension authoring skills for Claude Code and Pi with `frameBundle` guidance and unchanged unsupported parent-Console boundaries.
- Bump the Claude plugin patch version because this module edits a plugin skill.
- Update examples/eforge-plan prose only; do not add a new runnable extension example or convert the eforge-plan workstation.
- Regenerate public docs and references after dependency modules add route/schema/API symbols.
- Update documentation tests so they assert the new supported `frameBundle` path and the still-unsupported parent-Console plugin paths.

### Out of Scope
- Client schemas, route constants, browser exports, or daemon API version changes.
- Extension SDK source types or `@eforge-build/extension-sdk/browser` implementation.
- Engine validation, manifest projection, asset id generation, or trust hashing implementation.
- Monitor frame-shell generation, CSP/cache headers, asset serving, or route handlers.
- Console React rendering changes or bridge tests.
- A new package install/build/watch pipeline for frontend bundle assets.
- A new `examples/extensions/*.ts` bundle example, because that would require additional static asset fixtures and smoke-test import wiring.
- A full eforge-plan bundle workstation UX.
- Pi package version changes.

## Implementation Approach

### Overview

Update the hand-authored documentation after the dependency modules land so symbol names, route keys, and SDK helper names match the implementation. Treat `docs/extensions.md` and `docs/extensions-api.md` as the repository-local reference, and mirror the same content into `web/content/docs/extensions.md` and `web/content/docs/extensions-api.md` with public-site frontmatter and link formats.

The docs will describe four distinct Console/control-surface categories:

1. First-party Console routes owned by `packages/console-ui`.
2. Declarative System contributions rendered under `/console/system` with closed renderer IDs.
3. `srcDoc` workstations rendered as sandboxed iframe `srcDoc` with the injected `window.eforge.invokeAction` bridge.
4. `frameBundle` workstations rendered as sandboxed iframe `src` pointing at an eforge-owned frame shell that loads declared assets and exposes the versioned browser SDK bridge.

The documentation will use small inline examples instead of adding a new runnable extension example. The inline examples will show the native extension registration shape and a separate browser-bundle module importing `invokeAction` from `@eforge-build/extension-sdk/browser`. They will state that eforge serves already-present declared assets; extension authors own any bundling step that produces `workstation-assets/.../index.js`.

Finally, run `pnpm docs:generate` so generated API route references include `extensionWorkstationFrame` and `extensionWorkstationAsset`, public guide mirrors include the new workstation docs, and `llms-full.txt` contains the updated extension guidance. Update docs tests to reflect that eforge-owned iframe bundle workstations are supported while parent-Console frontend plugins and raw extension-owned routes remain unavailable.

### Key Decisions

1. **Do not add a runnable bundle example in `examples/extensions/`.** Inline docs examples cover the authoring contract without creating static asset fixtures, import-smoke-test edits, or a false impression that eforge builds browser source.
2. **Keep `srcDoc` and `frameBundle` examples side by side.** Authors can copy the existing `srcDoc` pattern for small HTML workstations and choose `frameBundle` only when they already have browser assets to serve.
3. **Use precise unsupported-boundary language.** Say that eforge-owned declared `frameBundle` assets are supported; raw extension-owned HTTP routes, parent-Console plugins, direct React component loading into Console, private Console React/CSS imports, and arbitrary independently loaded frontend plugins remain unsupported.
4. **Document trust hashing as source plus `workstation-assets/`.** Replace stale “source files only” wording with the new rule: project/team extension hashes include the supported source files and files under `workstation-assets/`, while broad `dist/`, package sidecars, lock records, and files outside the extension unit remain outside the trust hash.
5. **Update both consumer skill surfaces.** The Claude Code and Pi extension authoring skills will carry matching guidance after parity normalization; the Claude plugin patch version will advance by one.
6. **Regenerate generated docs, do not edit them by hand.** Hand-edit `web/content/docs/*` and route/source docs only; let `pnpm docs:generate` update `web/public/docs/*`, `web/content/reference/*`, `web/public/reference/*`, and LLM bundles.
7. **Avoid hardcoded generated route counts in new tests.** Assert route key presence for workstation frame/assets instead of relying on a route total that can shift with concurrent API additions.

## Files

### Create
- None.

### Modify
- `docs/extensions.md` — update extension authoring checklist, trust/hash sections, `Actions, Console contributions, commands, and deep links`, `Console workstations`, deferred-boundary prose, and runtime support row for bundle-aware workstation docs `[region: docs-and-examples, extension guide workstation and trust docs]`.
  - Describe `srcDoc` mode with existing `window.eforge.invokeAction` usage.
  - Add a `frameBundle` subsection with `root`, `entrypoint`, `styles`, `assets`, and `browserSdkVersion` fields.
  - State `frameBundle.root` must be `workstation-assets` or a child directory.
  - State omitted `browserSdkVersion` means v1.
  - State bundle frames use daemon-owned frame/asset routes, a URL-fragment bridge token, CSP on the frame shell, no-cache frame responses, and immutable declared asset URLs.
  - State authors may bundle React or another framework inside the iframe, but must not import private Console modules, parent Console context, or private Console CSS.
- `docs/extensions-api.md` — update `registerConsoleWorkstation(workstation)`, exported types, bridge protocol, runtime status, SDK stability/migration guidance, and runtime support rows `[region: docs-and-examples, extension API workstation and browser SDK reference]`.
  - Replace the single `ConsoleWorkstation` interface with the `srcDoc`/`frameBundle` union.
  - Add `ConsoleWorkstationFrameBundle` field descriptions and validation notes.
  - Add a browser SDK subpath reference for `@eforge-build/extension-sdk/browser`, including `EFORGE_WORKSTATION_BROWSER_SDK_VERSION`, `getEforgeConsoleBridge()`, `assertEforgeConsoleBridgeVersion()`, and `invokeAction()`.
  - Add migration guidance for daemon API version gating and browser SDK versioning.
- `web/content/docs/extensions.md` — mirror the root extension guide updates using public-site frontmatter and public/GitHub link conventions `[region: docs-and-examples, public extension guide workstation and trust docs]`.
- `web/content/docs/extensions-api.md` — mirror the root API reference updates using public-site frontmatter and public/GitHub link conventions `[region: docs-and-examples, public extension API workstation and browser SDK reference]`.
- `packages/extension-sdk/README.md` — add bundle-backed workstation authoring examples and update runtime/deferred-boundary language `[region: docs-and-examples, extension SDK README workstation browser SDK docs]`.
  - Keep the existing `srcDoc` sample.
  - Add a native extension `frameBundle` registration sample.
  - Add a browser-bundle code sample importing from `@eforge-build/extension-sdk/browser`.
  - State eforge does not build browser source; declared files must already exist under `workstation-assets/`.
  - State React/framework code may be bundled inside the iframe only.
- `packages/console-ui/README.md` — update Workstations route descriptions, Workstations data flow, and `Adding a new control surface` guidance `[region: docs-and-examples, Console README workstation data flow and control surfaces]`.
  - Describe `srcDoc` iframe rendering and `frameBundle.frameUrl` iframe `src` rendering.
  - Include the daemon contribution manifest, frame shell route, asset route, bridge token fragment, and parent bridge invocation flow.
  - Split the workstation control-surface bullet into `srcDoc` workstation and bundle workstation cases.
- `examples/extensions/README.md` — update the action/contribution and workstation references so examples point to `srcDoc` and `frameBundle` docs without adding a new `.ts` example.
  - Keep `action-contribution.ts` described as browser-code-free.
  - Add a short note that bundle workstation examples live in the docs/SDK README snippets, not as a runnable examples directory entry.
- `eforge/extensions/eforge-plan/README.md` — update the deferred platform gap note.
  - State that the dogfood workstation remains a small `srcDoc` proof of concept.
  - State the full eforge-plan bundle workstation UX remains follow-up work.
  - Distinguish supported `frameBundle` iframe assets from unsupported parent-Console plugins, direct React loading, private routes, and extension-owned AI planning/chat APIs.
- `eforge-plugin/skills/extend/extend.md` — update extension authoring skill classification for workstation `srcDoc`/`frameBundle` support and unsupported parent-Console boundaries.
  - Mention `registerConsoleWorkstation`, `srcDoc`, `frameBundle`, `workstation-assets/`, `@eforge-build/extension-sdk/browser`, and the iframe/action bridge boundary.
  - Keep plugin-specific tool names (`mcp__eforge__...`) unchanged.
- `packages/pi-eforge/skills/eforge-extend/SKILL.md` — make the same narrative update as the Claude skill after frontmatter/tool-name normalization.
  - Keep Pi-specific tool names (`eforge_extension`, `eforge_extension_contribution`) unchanged.
- `eforge-plugin/.claude-plugin/plugin.json` — increment the patch version by one because this module edits a plugin skill. Do not edit `packages/pi-eforge/package.json`.
- `packages/docs-gen/src/manifest.ts` — update the Extensions guide/API reference descriptions so `web/public/llms.txt` advertises `srcDoc`/`frameBundle` workstations and the browser SDK `[region: docs-and-examples, llms manifest extension guide descriptions]`.
- `test/extension-platform-docs-examples.test.ts` — update docs assertions for supported bundle workstations and refined unsupported boundaries.
  - Add required snippets for `frameBundle`, `workstation-assets`, `@eforge-build/extension-sdk/browser`, `browserSdkVersion`, `Content-Security-Policy`, and `allowedActions`.
  - Replace the old “separately served frontend asset bundles are deferred” assertion with assertions that eforge-owned declared `frameBundle` assets are supported and raw extension-owned routes/parent-Console plugins are unsupported.
  - Update generated API reference assertions to include `extensionWorkstationFrame` and `extensionWorkstationAsset`.
- `test/extension-tooling-wiring-runtime-docs.test.ts` — update rich-UI boundary assertions.
  - Keep assertions for raw extension-owned HTTP routes and arbitrary Console JavaScript outside registered workstations.
  - Replace broad `React bundles` unsupported checks with direct parent-Console React/private Console import unsupported checks plus iframe-bundled React allowed wording.
- `test/extension-contribution-host-surfaces.test.ts` — update skill guidance assertions.
  - Require `registerConsoleWorkstation`, `frameBundle`, `workstation-assets`, and `@eforge-build/extension-sdk/browser` in both skills.
  - Keep host-specific contribution tool-name assertions.
- `test/extension-authoring-skill.test.ts` — add required extension-authoring skill terms for the new workstation path.
  - Include `registerConsoleWorkstation`, `frameBundle`, `srcDoc`, `workstation-assets`, `@eforge-build/extension-sdk/browser`, and `parent Console`.
  - Keep parity and plugin-version assertions.
- Generated by `pnpm docs:generate` — update checked-in generated artifacts rather than editing these files manually.
  - `web/public/docs/extensions.md`
  - `web/public/docs/extensions-api.md`
  - `web/content/reference/api.md`
  - `web/public/reference/api.md`
  - `web/public/llms.txt`
  - `web/public/llms-full.txt`
  - Any additional generated reference/schema files changed by dependency modules during generation.

## Shared Files and Edit Region Markers

The architecture registry assigns these files to `docs-and-examples`: `docs/extensions.md`, `docs/extensions-api.md`, `packages/extension-sdk/README.md`, `packages/console-ui/README.md`, and generated/public docs. The `Files > Modify` entries above include `[region: docs-and-examples, ...]` annotations for these shared files.

No file in this plan is split with another module after the dependency modules complete. No temporary `plan-\d{2}-...` source markers are required. If a later split assigns another module to one of these docs files, use non-overlapping cleanup-targeted markers with the compiled plan id, for example:

```md
<!-- --- eforge:region plan-06-docs-and-examples --- -->
Bundle workstations execute inside sandboxed iframes and use @eforge-build/extension-sdk/browser.
<!-- --- eforge:endregion plan-06-docs-and-examples --- -->
```

Generated files under `web/public/` and generated references under `web/content/reference/` must not receive region markers; they are overwritten by `pnpm docs:generate`.

The Claude and Pi skill files are intentionally edited together. The parity script normalizes frontmatter and platform-specific tool names, so keep narrative changes byte-aligned outside existing parity skip blocks.

## Testing Strategy

### Unit Tests
- `test/extension-platform-docs-examples.test.ts`
  - Assert root docs, web docs, and SDK README contain `srcDoc`, `frameBundle`, `workstation-assets`, `@eforge-build/extension-sdk/browser`, `browserSdkVersion`, `window.eforge.invokeAction`, and `allowedActions`.
  - Assert docs state React/other frameworks may be bundled inside iframe workstations.
  - Assert docs state private Console React/components/CSS, parent Console context, parent-Console plugins, raw extension-owned HTTP routes, and extension-owned AI planning/chat APIs remain unavailable.
  - Assert generated API reference contains `extensionWorkstationFrame` and `extensionWorkstationAsset`.
- `test/extension-tooling-wiring-runtime-docs.test.ts`
  - Assert runtime support rows still mark `registerConsoleWorkstation` as shipped.
  - Assert rich-UI unsupported-boundary text no longer contradicts supported `frameBundle` assets.
- `test/extension-contribution-host-surfaces.test.ts` and `test/extension-authoring-skill.test.ts`
  - Assert Claude and Pi extension-authoring skills include `frameBundle` guidance and remain host-name aligned.
  - Assert the Claude plugin version exceeds the prior patch version.

### Integration Tests
- `node scripts/check-skill-parity.mjs` verifies Claude/Pi skill parity after normalized platform tool names.
- `pnpm docs:generate` writes public guide mirrors, API route references, and LLM bundles from the updated sources and dependency-module route constants.
- `pnpm docs:check` verifies generated docs drift and internal links.
- `web/__tests__/content.test.ts` verifies public guide mirrors equal `web/content/docs/*`, navigation remains valid, and rendered docs pages remain structurally valid.
- `pnpm test` or the targeted docs/skill/web tests verify the documentation assertions.
- `pnpm type-check` verifies the docs generator source edit in `packages/docs-gen/src/manifest.ts`.

## Verification

- [ ] `docs/extensions.md` contains `srcDoc`, `frameBundle`, `workstation-assets`, `@eforge-build/extension-sdk/browser`, `window.eforge.invokeAction`, and `allowedActions`.
- [ ] `web/content/docs/extensions.md` contains `srcDoc`, `frameBundle`, `workstation-assets`, `@eforge-build/extension-sdk/browser`, `window.eforge.invokeAction`, and `allowedActions`.
- [ ] `docs/extensions-api.md` contains a `ConsoleWorkstation` union with `srcDoc` and `frameBundle` variants.
- [ ] `web/content/docs/extensions-api.md` contains `ConsoleWorkstationFrameBundle`, `browserSdkVersion?: 1`, `root`, `entrypoint`, `styles`, and `assets`.
- [ ] `packages/extension-sdk/README.md` contains one native extension snippet using `frameBundle: { root: 'workstation-assets/` and one browser snippet importing from `@eforge-build/extension-sdk/browser`.
- [ ] Docs state that omitted `frameBundle.browserSdkVersion` means browser SDK v1.
- [ ] Docs state that bundle JavaScript executes inside a sandboxed workstation iframe.
- [ ] Docs state that frame routes use no-cache semantics and asset routes use immutable cache semantics.
- [ ] Docs state that the bundle frame shell uses a `Content-Security-Policy` header.
- [ ] Docs state that the bridge token is carried in the iframe URL fragment, not in the daemon route query string.
- [ ] Docs state that project/team trust hashing includes files under `workstation-assets/`.
- [ ] Docs state that broad `dist/` output remains outside the trust hash.
- [ ] Docs state that authors may bundle React or another browser framework inside the iframe.
- [ ] Docs state that direct React component loading into parent Console remains unsupported.
- [ ] Docs state that private Console React/components/CSS imports remain unsupported.
- [ ] Docs state that parent Console context imports remain unsupported.
- [ ] Docs state that raw extension-owned HTTP routes remain unsupported.
- [ ] `packages/console-ui/README.md` contains `frameBundle.frameUrl`, `extensionWorkstationFrame`, `extensionWorkstationAsset`, and `bridgeToken`.
- [ ] `examples/extensions/README.md` references bundle workstation docs without adding a new `examples/extensions/*.ts` file.
- [ ] `eforge/extensions/eforge-plan/README.md` states that the eforge-plan workstation remains a `srcDoc` proof of concept.
- [ ] `eforge-plugin/skills/extend/extend.md` contains `frameBundle`, `workstation-assets`, and `@eforge-build/extension-sdk/browser`.
- [ ] `packages/pi-eforge/skills/eforge-extend/SKILL.md` contains `frameBundle`, `workstation-assets`, and `@eforge-build/extension-sdk/browser`.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` has a patch version greater than `0.25.51`.
- [ ] `packages/pi-eforge/package.json` version remains unchanged.
- [ ] `web/content/reference/api.md` contains `extensionWorkstationFrame` and `extensionWorkstationAsset`.
- [ ] `web/public/reference/api.md` contains `extensionWorkstationFrame` and `extensionWorkstationAsset`.
- [ ] `web/public/docs/extensions.md` equals `web/content/docs/extensions.md` byte-for-byte after `pnpm docs:generate`.
- [ ] `web/public/docs/extensions-api.md` equals `web/content/docs/extensions-api.md` byte-for-byte after `pnpm docs:generate`.
- [ ] `web/public/llms.txt` contains `frameBundle`.
- [ ] `web/public/llms-full.txt` contains `@eforge-build/extension-sdk/browser`.
- [ ] `node scripts/check-skill-parity.mjs` exits 0.
- [ ] `pnpm docs:generate` exits 0.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm test -- test/extension-platform-docs-examples.test.ts test/extension-tooling-wiring-runtime-docs.test.ts test/extension-contribution-host-surfaces.test.ts test/extension-authoring-skill.test.ts web/__tests__/content.test.ts` exits 0, or `pnpm test` exits 0 when targeted Vitest paths are not supported.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": [["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["docs"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
