---
id: plan-06-packaging-docs-validation
name: Finalize package artifact contents, install/update/trust/reload tests,
  release wiring, asset serving checks, and documentation.
branch: mature-eforge-plan-with-annotation-revisions-local-roadmaps-and-installable-packaging/packaging-docs-validation
---

# Packaging Docs Validation

## Architecture Reference

This module implements the **Package flow**, final package-validation portion of **Packaging design**, and `packaging-docs-validation` module guidance from the architecture for **Mature eforge-plan: annotation revisions, local roadmaps, installable package**.

Key constraints from architecture:
- Run after `package-foundation`, `annotation-workstation`, and `roadmap-workstation`; do not redesign package build mechanics, annotation behavior, or roadmap behavior except to fix validation regressions.
- Validate the existing `eforge/extensions/eforge-plan/` package root as the publishable first-party package `@eforge-build/eforge-plan` with `eforge.extension.name: "eforge-plan"` and compiled entrypoint `./dist/index.js`.
- Validate that packed artifacts include compiled runtime files and workstation assets, and exclude source-only workstation/dev/test files from the npm artifact.
- Validate install, update, trust, reload, removal, contribution registration, input-source registration, and workstation asset serving through existing extension package-management routes and helpers. Do not add daemon routes.
- Keep eforge-plan runtime code on public package APIs and packaged runtime files self-contained enough to load in a fresh non-eforge project.
- Keep release wiring in lockstep unless implementation proves and documents independent release semantics; this plan chooses lockstep inclusion.
- Document annotation revisions, local-first roadmap steering, shared roadmap context, install/update/trust/reload/scope/removal, storage, privacy, and trust implications.
- Preserve route and daemon wire-shape ownership in `@eforge-build/client`; tests must use client helpers or manifest-projected URLs rather than inline daemon route strings.

## Scope

### In Scope
- Final package artifact validation for `@eforge-build/eforge-plan`:
  - package metadata and manifest fields,
  - lockstep release inclusion,
  - npm pack file list,
  - generated workstation assets,
  - compiled runtime import safety.
- End-to-end package-management regression tests using a locally packed eforge-plan package in a fresh fixture project.
- Install/update/trust/reload/remove regression coverage through existing `apiInstallExtension`, `apiUpdateExtension`, `apiTrustExtension`, `apiReloadExtensions`, `apiValidateExtensions`, `apiRemoveExtension`, and contribution manifest helpers from `@eforge-build/client`.
- Workstation frame and asset-serving smoke coverage for the installed eforge-plan package.
- CLI/documentation support for version-pinned update specifiers where the existing update request type supports them.
- README updates for annotation revisions, roadmap management, install/update/trust/reload/scope/removal, package artifact contents, storage, privacy, and trust.
- Central extension docs updates for the first-party installable eforge-plan package and version-pinned update semantics.
- Documentation tests that assert the user-facing docs mention the new workflows and trust/storage boundaries.

### Out of Scope
- Implementing annotation backend schemas/actions, annotation UI, or apply-time resolution semantics.
- Implementing roadmap backend source projection/fingerprints or roadmap UI editing/refresh behavior.
- Moving eforge-plan into `packages/eforge-plan`; `package-foundation` already chose the existing extension directory as package root.
- Changing extension package acquisition semantics, npm registry support, or install sidecar format beyond tests and CLI option forwarding.
- Adding raw extension-owned HTTP routes or daemon scheduling/orchestration features.
- Rewriting shared project roadmap files.
- Bumping the Pi package version or changing Claude/Pi integration behavior.

## Implementation Approach

### Overview

Treat this module as a final acceptance and documentation layer over the completed package, annotation, and roadmap modules. First, add artifact-level tests around the eforge-plan package root: ensure `pnpm --filter @eforge-build/eforge-plan build` has generated the compiled runtime and workstation assets, run `npm pack --dry-run --json`, and assert the tarball contents are limited to the intended package files.

Next, add an end-to-end package-management test that packs eforge-plan, installs the tarball into a fresh temp project, validates the installed extension, reloads extensions, inspects the loaded registration counts and contribution manifest, and fetches the workstation frame plus declared JS/CSS assets from the daemon-owned frame/asset URLs. A second e2e path installs from an npm-style `file:` source directory, updates through `apiUpdateExtension`, and verifies project-team trust clearing/retrust semantics with the existing trust and reload APIs. Keep these tests in a new focused file so existing package-management tests do not grow into a broad acceptance suite.

Finally, update user documentation. The eforge-plan README becomes the authoritative package README and must describe the mature annotation and roadmap workflows plus install/update/remove operational guidance. Central extension docs get a short first-party eforge-plan subsection and update command examples for `eforge extension update --version` when updating npm-installed packages to a version or dist-tag. Regenerate public docs after source docs change.

### Key Decisions

1. **Use real package-manager routes, not handcrafted loader calls, for e2e checks.** The install/update/trust/reload tests should exercise the same daemon API helpers used by the CLI and hosts, including sidecar provenance and trust transitions.
2. **Pack once per test file.** Build and pack eforge-plan in a `beforeAll` helper, reuse the tarball path across tests, and keep individual assertions focused on management behavior.
3. **Use a copied source package for update tests.** The update test installs from `file:./eforge-plan-source`, edits only the copied package version/content marker, and calls `apiUpdateExtension`; it never mutates the repository package root.
4. **Assert registrations from loaded extensions and contribution manifests.** The package install is accepted only when reload shows action, input source, deep link, integration command, and workstation registrations, and the contribution manifest contains the annotation and roadmap actions added by dependent modules.
5. **Fetch assets through manifest URLs.** The asset-serving test reads `frameBundle.frameUrl`, `entrypoint.url`, and style URLs from the manifest and fetches those paths from the test server. It must not hard-code `/api/...` route literals.
6. **Document local and project/team trust separately.** Default local installs under `.eforge/extensions/` load without a trust record; project/team installs under `eforge/extensions/` require `eforge extension trust eforge-plan` or `--trust` before loading.
7. **Version-pinned update support is npm-source only.** Document and test request forwarding for `eforge extension update eforge-plan --version <specifier>`; state that local directory and tarball installs update from their recorded sidecar source rather than a registry version specifier.
8. **Keep docs source and generated mirrors in sync.** Edit `docs/extensions.md`, `web/content/docs/extensions.md`, and eforge-plan README source; run `pnpm docs:generate` so `web/public/docs/*`, reference mirrors, and `llms` outputs update.

## Files

### Create
- `eforge/extensions/eforge-plan/__tests__/package-publication.test.ts` — package-root artifact tests: metadata, lockstep path, workspace inclusion, build output presence, `npm pack --dry-run --json` file list, source/dev/test exclusions, workstation asset inclusion, and compiled runtime import audit.
- `eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts` — README contract tests for annotation revision flow, roadmap model/storage, install/update/trust/reload/scope/removal commands, package trust/privacy language, and no-canonical-`docs/roadmap.md` wording.
- `test/eforge-plan-package-management.test.ts` — fresh-project package-management integration tests for local tarball install, validation, reload, contribution registration, workstation asset serving, npm-style file-source update, trust clearing/retrust, and removal.
- `test/eforge-plan-release-wiring.test.ts` — focused release wiring tests that assert the eforge-plan package is a non-private workspace package, appears in lockstep version propagation, and is publishable by `pnpm -r publish` through the workspace rather than an ad hoc script path.

### Modify
- `eforge/extensions/eforge-plan/README.md` — add first-party package install/update/remove docs, annotation-driven revision docs, local/shared roadmap docs, storage/privacy/trust notes, version-pinned update notes, and regenerated artifact guidance `[region: packaging-docs-validation, final user-facing eforge-plan package/workflow documentation]`.
- `eforge/extensions/eforge-plan/package.json` — verify or add final publish-facing metadata only if package-foundation left a gap: `files` includes `dist/`, `workstation-assets/`, `README.md`, and `LICENSE`; `private` is absent; `publishConfig.access` is public; package scripts can build before packing `[region: packaging-docs-validation, final package artifact metadata]`.
- `scripts/lib/lockstep-version.mjs` — verify or add `eforge/extensions/eforge-plan/package.json` in `LOCKSTEP_PACKAGE_PATHS` so release propagation and publish verification include eforge-plan `[region: packaging-docs-validation, final lockstep release inclusion]`.
- `docs/releasing.md` — mention that `@eforge-build/eforge-plan` is part of the lockstep public npm release and must pass package install smoke checks before tagging.
- `docs/extensions.md` — add a first-party eforge-plan install example, `eforge extension update --version` documentation for npm-installed packages, and trust/removal wording for installed first-party packages.
- `web/content/docs/extensions.md` — mirror the central extension docs updates so the public site source contains the same first-party package and version-pinned update guidance.
- `packages/eforge/src/cli/index.ts` — add bounded CLI forwarding for `eforge extension update <name> --version <specifier>` into `ExtensionUpdateRequest.version`; edit only the existing update command block.
- `test/extension-tooling-wiring-cli.test.ts` — update CLI option/source wiring assertions to include `--version <specifier>` and `body.version = options.version` for the update command.
- `test/extension-tooling-routes-package-management.test.ts` — add a small regression assertion that the daemon update path applies `body.version` only to npm-source sidecars; keep the existing file below 1,200 lines.
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — update existing README assertions from legacy `roadmap evidence` wording to `roadmapContext`/local steering/shared context wording, and keep existing planning boundary assertions intact.
- `test/eforge-plan-workstation.test.ts` — update package/asset assertions only if dependent modules have not already covered annotation and roadmap action allowlists; keep this module's edits limited to package entrypoint/import path and generated asset expectations `[region: packaging-docs-validation, package artifact and workstation asset assertions]`.
- `web/public/docs/extensions.md`, `web/public/llms.txt`, `web/public/llms-full.txt`, and any generated reference files changed by `pnpm docs:generate` — update via docs generator, not by hand.

Shared-file note: `docs/extensions.md`, `web/content/docs/extensions.md`, `docs/releasing.md`, `packages/eforge/src/cli/index.ts`, and the new integration tests are not listed in the architecture Shared File Registry. This module owns the first-party package documentation/update-option slices in those files. If temporary source coordination markers are needed in TypeScript shared files, use the compiled plan slug `plan-06-packaging-docs-validation`.

## Implementation Details

### Package artifact tests

`package-publication.test.ts` should build on the package-foundation helpers rather than duplicating build logic in every test. Use one helper that runs `pnpm --filter @eforge-build/eforge-plan build` when any of these files is absent:

- `eforge/extensions/eforge-plan/dist/index.js`
- `eforge/extensions/eforge-plan/dist/backlog-curation-source-provider.js`
- `eforge/extensions/eforge-plan/workstation-assets/plans/index.js`
- `eforge/extensions/eforge-plan/workstation-assets/plans/style.css`

Then assert:

- `package.json.name === "@eforge-build/eforge-plan"`.
- `package.json.eforge.extension.name === "eforge-plan"`.
- `package.json.eforge.extension.entrypoint === "./dist/index.js"`.
- `package.json.files` contains `dist/`, `workstation-assets/`, `README.md`, and `LICENSE`.
- `package.json.private` is not `true`.
- `package.json.publishConfig.access === "public"`.
- `pnpm-workspace.yaml` contains `eforge/extensions/eforge-plan`.
- `scripts/lib/lockstep-version.mjs` contains `eforge/extensions/eforge-plan/package.json`.
- `npm pack --ignore-scripts --dry-run --json` lists `dist/index.js`, `dist/backlog-curation-source-provider.js`, `workstation-assets/plans/index.js`, `workstation-assets/plans/style.css`, `README.md`, `LICENSE`, and `package.json`.
- The dry-run pack list does not include `workstation-src/`, `__tests__/`, `tsup.config.ts`, `tsconfig.json`, raw `*.ts` runtime source files, or `node_modules/`.
- Built runtime JS contains no `../../../packages`, `../../../../packages`, `packages/*/src`, or static bare `from "@eforge-build/` imports. Dynamic or static imports left in `dist/` must be limited to `node:` built-ins or local relative files.

### Fresh-project package-management tests

`test/eforge-plan-package-management.test.ts` should create a temp project with:

- a git repository,
- `eforge/config.yaml` with extensions enabled and project-team trust disabled,
- empty `.eforge/extensions/` and `eforge/extensions/` directories,
- an isolated `XDG_CONFIG_HOME`,
- a running monitor server and `writeLockfile` pointing at it.

Use these checks:

1. **Packed tarball install/load/assets**
   - Install the packed tarball with `apiInstallExtension({ source: tarballPath })`.
   - Assert install provenance has `sourceKind: "url"` and extension package provenance has `packageName: "@eforge-build/eforge-plan"`.
   - Call `apiValidateExtensions({ name: "eforge-plan" })` and assert `valid === true`.
   - Call `apiReloadExtensions` and assert the loaded `eforge-plan` entry has registration counts greater than zero for actions, input sources, deep links, integration commands, and console workstations.
   - Call `apiGetExtensionContributionManifest` and assert it contains `eforge-plan:planning-workstation`, `eforge-plan:open-planning-entry`, annotation actions, roadmap actions, and integration/deep-link entries.
   - Fetch the workstation frame URL and declared entrypoint/style asset URLs from the manifest; assert HTTP 200, frame `content-type` contains `text/html`, JS contains a known workstation string such as `Revise with AI`, and CSS `content-type` contains `text/css`.
   - Call `apiRemoveExtension({ name: "eforge-plan" })` and assert `.eforge/extensions/eforge-plan` no longer exists.

2. **Npm-style file-source update and trust semantics**
   - Copy the built package root into a temp `eforge-plan-source` directory and set its version to `0.0.1-test.0`.
   - Install with `source: "file:./eforge-plan-source"`, `scope: "project"`, and `trust: true`; assert `trustState === "trusted"` and install provenance `sourceKind === "npm"`.
   - Change the copied package version to `0.0.2-test.0` and add a harmless marker file that is included by the package `files` list only if the implementation chooses to test content replacement.
   - Call `apiUpdateExtension({ name: "eforge-plan" })`; assert `previousVersion === "0.0.1-test.0"`, updated package provenance version is `0.0.2-test.0`, and project-team `trustState === "untrusted"`.
   - Call `apiUpdateExtension({ name: "eforge-plan", trust: true, trustedBy: "package-test" })`; assert `trustState === "trusted"` and `trustedBy === "package-test"`.

Keep the e2e tests independent from npm registry network access. Version-pinned registry updates are covered by CLI/request forwarding and source-level route assertions because live registry resolution is not deterministic in repository tests.

### CLI version option

Add the update option in the existing command block only:

```ts
// --- eforge:region plan-06-packaging-docs-validation ---
.option('--version <specifier>', 'Version specifier or dist-tag for npm-installed extensions')
// ...
if (options.version !== undefined) body.version = options.version;
// --- eforge:endregion plan-06-packaging-docs-validation ---
```

The marker is a temporary build-coordination marker; remove it during cleanup if the final codebase does not retain plan markers.

### Documentation content

README updates must include concrete sections or paragraphs for:

- install from npm: `eforge extension install @eforge-build/eforge-plan`;
- install from a local package directory or `.tgz` after building;
- default `local` scope, `project` scope with trust, and `user` scope behavior;
- validate, trust, reload, update, version-pinned update for npm-installed packages, and remove commands;
- package artifact contents (`dist/` runtime plus `workstation-assets/plans/` bundle);
- extension unsandboxed trust model and workstation asset hash coverage;
- annotation capture from selected text, fallback controls, unresolved annotation management, annotation snapshots on revision turns, and auto-resolution only after successful patch-bearing apply;
- local focus roadmap storage path, config path, configured shared sources, discovered conventional sources such as `docs/roadmap.md` as non-canonical context, and no silent shared-file rewrites;
- recommendation freshness changing when local focus or configured roadmap context changes;
- privacy implications of private storage under `.eforge/storage/extensions/eforge-plan/`.

Central extension docs should add a short subsection under package-managed extensions named `First-party eforge-plan package` or equivalent, with install/update/remove examples and the same trust distinction between local and project-team installs.

## Testing Strategy

### Unit Tests
- `package-publication.test.ts`
  - Package metadata and manifest assertions.
  - Workspace and lockstep release path assertions.
  - `npm pack --dry-run --json` artifact allowlist/denylist assertions.
  - Built runtime import audit assertions.
- `readme-mature-workflows.test.ts`
  - README contains install/update/trust/reload/remove commands for `@eforge-build/eforge-plan`/`eforge-plan`.
  - README contains annotation target/snapshot/auto-resolve semantics and the five annotation action names.
  - README contains local focus roadmap storage/config paths, configured shared context, discovered conventional context, and non-canonical `docs/roadmap.md` language.
  - README contains privacy/trust language for unsandboxed extension code and workstation assets.
- `eforge-plan-release-wiring.test.ts`
  - eforge-plan package is non-private and publishable.
  - lockstep version propagation includes the package path.
  - publish-all remains workspace-driven (`pnpm -r publish`) rather than excluding the extension package through a custom package list.
- `extension-tooling-wiring-cli.test.ts`
  - `eforge extension update` declares `--version <specifier>`.
  - CLI update action copies `options.version` into `ExtensionUpdateRequest.version`.

### Integration Tests
- `eforge-plan-package-management.test.ts`
  - Locally packed tarball install into a fresh fixture project.
  - Existing validation path accepts the installed extension.
  - Existing reload path loads the installed extension.
  - Loaded extension registration counts include actions, input source, deep links, integration commands, and workstation bundle.
  - Contribution manifest includes annotation and roadmap action IDs from dependent modules.
  - Workstation frame, entrypoint JS, and CSS asset URLs from the manifest return HTTP 200.
  - Existing update path updates an npm-style `file:` installed package from its sidecar source.
  - Project-team update without `trust` clears trust; update with `trust` restores trust and records `trustedBy`.
  - Existing removal path deletes the installed package directory.
- `extension-tooling-routes-package-management.test.ts`
  - Version override logic is exercised or source-audited for npm sidecars without adding network-dependent registry tests.

### Documentation Checks
- `readme-contract.test.ts` and `readme-mature-workflows.test.ts` validate README wording for mature workflows.
- `docs:generate` updates public doc mirrors and `llms` artifacts after source docs change.
- `docs:check` validates generated docs are in sync.

## Verification

- [ ] `pnpm --filter @eforge-build/eforge-plan build` exits 0 and creates `dist/index.js`, `dist/backlog-curation-source-provider.js`, `workstation-assets/plans/index.js`, and `workstation-assets/plans/style.css`.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/package-publication.test.ts eforge/extensions/eforge-plan/__tests__/readme-mature-workflows.test.ts eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts test/eforge-plan-release-wiring.test.ts` exits 0.
- [ ] `pnpm test -- test/eforge-plan-package-management.test.ts test/extension-tooling-wiring-cli.test.ts test/extension-tooling-routes-package-management.test.ts` exits 0.
- [ ] `npm pack --ignore-scripts --dry-run --json` from `eforge/extensions/eforge-plan` lists `dist/index.js`, `dist/backlog-curation-source-provider.js`, `workstation-assets/plans/index.js`, `workstation-assets/plans/style.css`, `README.md`, `LICENSE`, and `package.json`.
- [ ] The package dry-run file list contains no paths beginning with `workstation-src/`, `__tests__/`, `node_modules/`, or raw runtime `*.ts` source files.
- [ ] A fresh-project package-management test observes `apiValidateExtensions({ name: "eforge-plan" }).data.valid === true` after install.
- [ ] A fresh-project package-management test observes `apiReloadExtensions` returning `eforge-plan` with action, input source, deep link, integration command, and console workstation registration counts greater than zero.
- [ ] A fresh-project package-management test fetches the manifest-projected workstation frame URL, entrypoint JS URL, and CSS URL and receives HTTP 200 for each.
- [ ] A project-team update test observes `trustState: "untrusted"` after update without `trust` and `trustState: "trusted"` with `trustedBy: "package-test"` after update with `trust: true`.
- [ ] `eforge extension update` help includes `--version <specifier>`, and the CLI wiring test observes `body.version = options.version` in the update command block.
- [ ] `rg "roadmap evidence|canonical docs/roadmap" eforge/extensions/eforge-plan/README.md docs/extensions.md web/content/docs/extensions.md` returns no matches.
- [ ] `rg "@eforge-build/eforge-plan" eforge/extensions/eforge-plan/README.md docs/extensions.md web/content/docs/extensions.md docs/releasing.md` returns matches in each file.
- [ ] `pnpm docs:generate` exits 0 when docs are changed.
- [ ] `pnpm docs:check` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] No new implementation file exceeds 600 lines.
- [ ] No new test file exceeds 1,200 lines.
- [ ] `rg "/api/" test/eforge-plan-package-management.test.ts eforge/extensions/eforge-plan/__tests__/package-publication.test.ts` returns no matches.

<build-config>
{
  "build": [["implement", "doc-author"], "doc-sync", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["security", "docs"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
