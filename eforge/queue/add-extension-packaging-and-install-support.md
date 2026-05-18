---
title: Add extension packaging and install support
created: 2026-05-18
depends_on: ["runtime-reviewer-perspective-extension-point"]
profile: gpt-claude-combo
---

# Add extension packaging and install support

## Problem / Motivation

Native extensions can already be authored locally with `eforge extension new`, discovered across scopes, validated/tested, trusted/untrusted, and loaded at runtime. What is missing is a supported way to share, install, update, promote, and remove extension packages.

Current gaps backed by code/docs inspection:

- `docs/extensions.md` documents supported layouts and trust, but explicitly says `extension enable`, `extension disable`, `extension promote`, and `extension demote` are deferred.
- CLI/MCP/Pi tooling only accepts `list/show/validate/test/new/reload/trust/untrust`:
  - `packages/eforge/src/cli/index.ts`
  - `packages/eforge/src/cli/mcp-proxy.ts`
  - `packages/pi-eforge/extensions/eforge/index.ts`
- Discovery supports a directory with `package.json` `exports`/`main`, but there is no eforge-specific package manifest convention, no package provenance fields, and no install/update/remove routes.
- Trust hardening is now in place, so package install/update can be designed around existing project/team trust records instead of bypassing them.

Affected users:

- Teams that want reusable/shared extensions beyond ad hoc local files.
- Agents running `/eforge:extend` or extension-management tools that need explicit commands instead of guessing filesystem layout.

Why now: this is the final packaging/install phase after local/project workflows and trust model hardening have shipped.

### Context and evidence

Evidence sources reviewed:

- Schaake OS epic `779281ef-06b4-41aa-a03f-bfb84d1905ff` says EXTEND_13B is in progress, unblocked, and depends on trust hardening plus `/eforge:extend` UX.
- Dependency epic `EXTEND_13A` is done and shipped hash-based trust for project/team extensions:
  - `.eforge/extension-trust.json`
  - `trustState`
  - `currentHash`
  - `trustedHash`
  - `trustedAt`
  - `trustedBy`
- Dependency epic `EXTEND_06` is done and shipped `/eforge:extend` in Pi and Claude Code.
- `docs/prd/typescript-extensibility.md` places package/install support after trust hardening and asks for:
  - package manifest conventions
  - local/npm/git support or explicit follow-up scoping
  - provenance in list/show
  - trust-aware install/update flows
  - docs for install/promotion/removal/security
- `docs/roadmap.md` still has native TypeScript extensions as an active roadmap item, so EXTEND_13B is roadmap-aligned.
- `docs/extensions.md` documents current extension scopes, discovery, `package.json` `exports`/`main` entrypoints, trust behavior, and explicitly says `extension enable`, `extension disable`, `extension promote`, and `extension demote` are deferred.
- Current extension discovery/loader code is in `packages/engine/src/extensions/`:
  - `discovery.ts`
  - `loader.ts`
  - `hash.ts`
  - `trust-store.ts`
  - `types.ts`
- Current extension discovery/loader supports file/directory layouts and `package.json` `exports`/`main`, derives the extension name from the file/directory name, and exposes trust/provenance fields.
- Current management surfaces are routed through:
  - `@eforge-build/client`
  - `packages/client/src/types.ts`
  - `packages/client/src/api/extensions.ts`
  - `packages/client/src/routes.ts`
  - daemon: `packages/monitor/src/server.ts`
  - CLI: `packages/eforge/src/cli/index.ts`
  - Claude MCP proxy: `packages/eforge/src/cli/mcp-proxy.ts`
  - Pi native tool: `packages/pi-eforge/extensions/eforge/index.ts`
- These currently expose `list/show/validate/test/new/reload/trust/untrust` only.
- Playbooks provide useful move/copy precedent in:
  - `packages/input/src/playbook.ts`
  - `packages/eforge/src/cli/playbook.ts`
  - daemon playbook routes
- Playbook promote/demote move between project-local and project-team scopes, and promotion stages the committed path with `git add`.
- Existing tests cover extension discovery, loader, hash, trust store, scaffold, routes, CLI, MCP/Pi wiring, docs content, and authoring skill behavior:
  - `test/extension-*.test.ts`

### Classification and profile signal

Initial classification: **feature / focused** change.

This adds user-facing extension package management across existing extension-management surfaces, but it should remain a cohesive extension-management slice rather than an expedition-scale new runtime capability.

Recommended profile: **excursion**.

Rationale: this is a cohesive feature across known extension-management surfaces rather than a new runtime architecture. It touches several packages:

- `engine`
- `client`
- `monitor`
- CLI/MCP
- Pi
- docs/tests

A single planner can enumerate the file groups, route/type dependencies, and trust constraints. It does not require independently delegated subsystem planning, so Expedition would likely add overhead without improving plan quality.

## Goal

Add supported extension package management so users can share, install, update, promote, demote, remove, and inspect packaged eforge extensions while preserving existing trust hardening and extension-loading behavior.

The final result should provide manifest conventions, provenance in management outputs, safe install/update flows, consumer-surface parity across CLI/MCP/Pi, and documentation/tests for package installation, promotion, removal, and security.

## Approach

### High-level implementation

1. Define eforge extension package manifest conventions in `package.json`.
2. Extend discovery/provenance so packaged directory extensions expose package metadata in list/show/validate/test output.
3. Add install/update/remove package-management flows.
4. Add extension promote/demote flows between `.eforge/extensions/` and `eforge/extensions/`, using playbook promote/demote behavior as precedent.
5. Wire the management surface through:
   - shared client
   - daemon routes
   - CLI
   - Claude MCP proxy
   - Pi native tool
6. Make trust behavior explicit and safe.
7. Update docs and tests.

### Manifest convention

Use `package.json` as the package manifest and add an eforge-owned optional block:

```json
{
  "name": "@acme/eforge-extension-build-notifier",
  "version": "1.2.3",
  "type": "module",
  "exports": "./dist/index.js",
  "eforge": {
    "extension": {
      "name": "build-notifier",
      "entrypoint": "./dist/index.js",
      "description": "Notify the build channel when eforge builds fail",
      "eforgeVersion": ">=0.0.0"
    }
  }
}
```

Rationale:

- `package.json` already participates in directory-layout entrypoint resolution and trust hashing.
- Package authors can publish normal npm packages while providing eforge-specific metadata without a second required manifest file.
- Existing directory extensions that rely on `exports`/`main` keep working.

Validation rules:

- `eforge.extension.name`, when present, must use the existing extension-name convention:
  - kebab-case/simple safe identifier
  - matching current CLI name constraints unless a stricter common regex already exists
- `eforge.extension.entrypoint`, when present, must resolve inside the package directory and end in one of:
  - `.ts`
  - `.mts`
  - `.js`
  - `.mjs`
- Invalid eforge manifest fields should surface diagnostics rather than silently falling back when they would change identity or entrypoint.

### Install source support

Implement local package directory and npm package/tarball sources in the initial slice if feasible; explicitly document git URL support as deferred if not implemented.

Preferred behavior:

```bash
eforge extension install <source> --scope local|project|user [--name <name>] [--force] [--trust] [--trusted-by <id>]
eforge extension update <name> [--scope local|project|user] [--trust] [--trusted-by <id>]
eforge extension remove <name> [--scope local|project|user] [--force]
eforge extension promote <name> [--force]
eforge extension demote <name> [--force]
```

Source handling should favor safety over convenience:

- Install must never import the extension module or execute its factory.
- Npm acquisition should avoid lifecycle script execution where possible, for example package/tarball acquisition rather than `npm install` into the project.
- Source extraction/copy should exclude:
  - `node_modules`
  - `.git`
  - obvious temp artifacts
- Source extraction/copy should keep built `dist/` files because JavaScript packages may rely on them.

### Destination naming and collisions

Destination extension name should be:

1. explicit `--name`, if supplied
2. `eforge.extension.name`, if supplied
3. otherwise a safe derived name from npm package name or local directory name

Collisions should refuse by default and require `--force` or the explicit `update` flow.

Same-name precedence/shadowing remains the existing `project-local > project-team > user` model.

### Provenance shape

Add package provenance to `ExtensionEntry`, keeping existing fields intact.

Package manifest metadata should include:

- package name
- version
- description
- eforge extension name
- eforge entrypoint
- repository/homepage if available

Install metadata, when installed by eforge, should include:

- source kind:
  - `local`
  - `npm`
  - `tarball`
  - later `git`
- source spec
- resolved version/integrity when available
- installedAt
- target scope

List output can show a concise package column. Show/JSON output should include full provenance.

### Trust/update behavior

- Project/team installs and updates must follow EXTEND_13A: the resulting extension is untrusted or changed until the user explicitly trusts it.
- If an explicit `--trust` flag is implemented, it should call the same trust-store path after install/update and should require explicit user intent.
- Never silently preserve old trust across package updates.
- User and project-local installed extensions remain trusted by the existing trust model.
- Docs must clearly warn that all installed extensions are unsandboxed arbitrary code.

### Promote/demote/remove behavior

- Promote moves `.eforge/extensions/<name>` to `eforge/extensions/<name>`.
- Promote should stage the project/team path when git is available, following playbook promote precedent.
- Demote moves `eforge/extensions/<name>` back to `.eforge/extensions/<name>`.
- Demote should not stage by default.
- Remove should delete the selected extension directory/file from a selected scope.
- Prefer limiting normal removal to eforge-managed installs, with `--force` for handwritten extensions, to avoid accidental data loss.

### Consumer parity

Every new daemon/client operation exposed in the CLI should be exposed through both:

- Claude MCP proxy
- Pi `eforge_extension` tool

The tool may add optional fields like:

- `source`
- `scope`
- `force`
- `trust`
- `trustedBy`

Validation must reject irrelevant fields per action, following current action-specific validation style.

### Code impact

#### `packages/engine/src/extensions/`

Evidence: discovery, trust, hashing, loader, and provenance types live here.

Expected changes:

- Add package-manifest parsing helpers for `package.json`.
- Extend `resolvePackageEntrypoint`/layout resolution to recognize:
  - `eforge.extension.entrypoint`
  - optionally logical `eforge.extension.name`
- Extend the following with package/install provenance fields:
  - `NativeExtensionCandidate`
  - `LoadedNativeExtension`
  - diagnostics
  - projection
- Keep loader behavior unchanged:
  - install/discovery must still require a default-exported factory
  - install operations must not execute factories
- Consider whether trust hash should include any new eforge package manifest files.
  - `package.json` is already included for directory hashes.
  - Non-source install sidecars are currently outside the content hash by design and should be documented if used.

#### `packages/client/`

Evidence: extension wire types/routes/helpers are centralized here.

Expected changes:

- Add client wire types for package manifest/provenance and new operations:
  - `install`
  - `update`
  - `remove`
  - `promote`
  - `demote`
- Add `API_ROUTES` entries and typed `api*Extension*` helpers.
- Keep daemon wire shapes owned here.
- Avoid local interface re-declarations in monitor/CLI.

#### `packages/monitor/`

Evidence: extension management routes already live in `packages/monitor/src/server.ts`; playbook promote/demote routes provide move precedent.

Expected changes:

- Add daemon routes for:
  - install
  - update
  - remove
  - promote
  - demote
- Prefer moving large package-install helper logic into a small monitor-side helper module rather than growing `server.ts` substantially.
- Use safe path validation and scoped destination resolution through:
  - `@eforge-build/scopes`
  - existing config-dir helpers
- Package retrieval/copy must avoid lifecycle script execution and must not load extension modules.
- Return full `ExtensionEntry`/operation response from the same projection pipeline used by list/show when possible.

#### `packages/eforge/`

Evidence: CLI extension subcommands and MCP proxy currently enumerate only existing actions.

Expected changes:

- CLI: add `eforge extension install`, `update`, `remove`, `promote`, `demote` with:
  - `--json` support
  - clear non-JSON next steps
- MCP proxy: extend `eforge_extension` schema/actions with equivalent operations.
- If plugin-facing skill docs are edited under `eforge-plugin/`, bump `eforge-plugin/.claude-plugin/plugin.json` per repo policy.

#### `packages/pi-eforge/`

Evidence: Pi native tool duplicates the MCP tool surface and must stay in parity.

Expected changes:

- Extend the Pi `eforge_extension` tool schema/actions with the same package-management operations.
- Do not bump `packages/pi-eforge/package.json` version.

#### Docs, examples, and tests

Update documentation for package manifests, install/update/remove/promote/demote, trust implications, and deferred git support if applicable.

Potential docs/examples to update:

- `docs/extensions.md`
- `docs/extensions-api.md`, only if API reference needs package provenance fields
- `docs/config.md`
- `packages/extension-sdk/README.md`
- possibly `examples/extensions/README.md`

Update generated/docs manifest tests if docs references are indexed.

Add or extend tests for:

- extension discovery package manifest/provenance
- package install routes
- CLI command registration/output
- MCP/Pi tool action parity
- trust behavior after project-team install/update
- docs content
- removal/promote/demote filesystem behavior

Validation commands likely needed:

```bash
pnpm type-check
pnpm test
pnpm docs:check
```

Run `pnpm docs:check` if generated docs artifacts are touched.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---:|---:|---|---|
| The epic can be satisfied without full git URL install support if git is explicitly scoped to follow-up. | Schaake OS acceptance says local, npm, and/or git package support may be implemented or intentionally scoped. PRD also frames package/install after trust and does not require all source types in one build. | high | low | Confirm with epic owner before build if git support is desired immediately. | If wrong, implementation may underdeliver expected source support and need a follow-up build. |
| Package provenance can be filesystem-derived from `package.json` plus an eforge install sidecar, not stored in SQLite. | Current extension list/show provenance is discovery/projection based; no extension DB state exists. Trust store is a local JSON file. | medium | medium | Prototype provenance projection and confirm update/remove needs are met by sidecar metadata. | If wrong, update/remove/list semantics may need a more durable registry and broader migration design. |
| Adding `eforge.extension` inside `package.json` is the lowest-friction manifest convention. | Current discovery already reads `package.json` for directory entrypoints and hash includes `package.json` for project/team directories. | high | low | Implement parser tests for valid/invalid `package.json` shapes and verify existing packages without `eforge` still load. | If wrong, package authors may need a separate manifest and existing discovery logic needs more invasive changes. |
| Npm package/tarball acquisition can be implemented without executing extension code or lifecycle scripts. | Known npm tooling supports package/tarball acquisition flows, but this was not validated by running npm commands during planning. | medium | medium | During implementation, test chosen acquisition command with fixtures and assert install does not call extension factory. | If wrong, npm support should be deferred and local/tarball support documented instead to preserve security. |
| Promote/demote should mirror playbook behavior. | `packages/input/src/playbook.ts`, CLI playbook promote/demote, and daemon routes already establish scope-move semantics and git staging behavior for project-team promotion. | high | low | Reuse the same scoped path approach and add extension-specific collision/trust tests. | If wrong, users may find extension promotion inconsistent with extension trust/shadowing semantics. |
| New extension-management actions must be exposed in both Claude MCP proxy and Pi native tool. | Repo `AGENTS.md` explicitly requires `eforge-plugin/` and `packages/pi-eforge/` parity for consumer-facing commands/tools, and current extension tools are duplicated. | high | low | Update tests that assert tool action lists and docs parity. | If wrong, one integration can lag and agents cannot manage packages uniformly. |

No unresolved low-confidence/high-impact assumptions are blocking readiness.

The main medium-confidence item is npm acquisition safety; the plan explicitly allows deferring npm/git source types if implementation validation shows they would exceed the secure focused slice.

### Early assumptions and unknowns

- Assumption: a focused MVP can satisfy the epic by implementing manifest conventions plus local/package-directory install/update/remove/promote/demote, while explicitly deferring full npm registry and git URL installation if they would over-expand the build.
  - Evidence: epic acceptance allows local/npm/git support to be “implemented or intentionally scoped for a follow-up.”
  - Impact if wrong: user may expect npm/git in this build; the plan should make the scope explicit.
- Assumption: package provenance can be derived primarily from package metadata plus an eforge-written install sidecar rather than a database-backed package registry.
  - Evidence: current extension provenance is filesystem/discovery-based, not DB-backed.
  - Impact if wrong: update/remove semantics may need more durable state.

## Scope

### In scope

1. Define eforge extension package manifest conventions in `package.json`.

   - Add/document an `eforge.extension` manifest block for:
     - logical extension name
     - entrypoint
     - description
     - optional compatibility metadata
   - Continue accepting current `exports`/`main` entrypoints for backward compatibility.

2. Extend discovery/provenance so packaged directory extensions expose package metadata in list/show/validate/test output.

   - Include npm package name/version when present.
   - Include eforge package manifest metadata when present.
   - Include install provenance when the extension was installed by eforge.

3. Add install/update/remove package-management flows.

   - Implement local package directory and npm package/tarball install paths if practical in the first slice.
   - Explicitly defer git URL install support if it would require broader dependency/auth/ref-resolution policy.
   - Installs should copy package contents into an eforge extension scope.
   - Installs must not execute the extension factory.

4. Add extension promote/demote flows between:

   - `.eforge/extensions/`
   - `eforge/extensions/`

   Use playbook promote/demote behavior as precedent.

5. Wire the management surface through:

   - shared client
   - daemon routes
   - CLI
   - Claude MCP proxy
   - Pi native tool

   Consumer surfaces must remain in parity.

6. Make trust behavior explicit and safe.

   - Project/team package installs/updates remain untrusted or changed until explicitly trusted, unless the user passes an explicit trust flag that writes the local trust record after install.
   - User and project-local installs remain trusted by default under the existing trust model.
   - Docs must warn that this is unsandboxed arbitrary code.

7. Update docs and tests.

### Out of scope / deferred

- Extension enable/disable state management.
- Sandboxing or permission prompts beyond the existing trust model.
- Package registry browsing/search and package discovery marketplaces.
- Full git URL install support if not included in the implementation slice.
  - If deferred, document the follow-up boundary.
- Runtime API changes to extension hooks themselves.

## Acceptance Criteria

### Functional

- `package.json` manifest conventions for eforge extension packages are implemented and documented, including:
  - `eforge.extension.name`
  - `eforge.extension.entrypoint`
- Existing `package.json` `exports`/`main` directory extension support remains backward-compatible.
- `eforge extension list/show --json` includes:
  - package manifest provenance for packaged extensions
  - install provenance for eforge-installed extensions
- A user can install at least local package directories and npm package/tarball sources into:
  - user scope
  - project-team scope
  - project-local scope
- Any unsupported git URL flow is explicitly rejected with a documented follow-up message.
- A user can update an eforge-installed package from its recorded source, or receives a clear error when the source cannot be updated.
- A user can remove an installed extension safely.
- Handwritten extension deletion requires explicit force or is clearly out of scope.
- A user can promote a project-local extension to project/team scope.
- A user can demote a project/team extension to project-local scope.

### Trust and security

- Project/team package installs and updates are not silently trusted.
- Project/team package installs and updates show `untrusted` or `changed` until:
  - an explicit trust operation, or
  - an explicit trust flag records the current hash
- Trust records continue to use `.eforge/extension-trust.json` and existing hash behavior from EXTEND_13A.
- Install/update operations do not import the extension module.
- Install/update operations do not execute the extension factory.
- Docs explain that installed extensions are unsandboxed arbitrary code.
- Docs explain that npm/package acquisition itself should be treated as code supply-chain risk.

### Surface parity

- Shared client types/routes/helpers are added for all new daemon operations.
- CLI subcommands expose matching install/update/remove/promote/demote capabilities when technically feasible.
- Claude MCP proxy `eforge_extension` actions expose matching install/update/remove/promote/demote capabilities when technically feasible.
- Pi `eforge_extension` actions expose matching install/update/remove/promote/demote capabilities when technically feasible.
- Non-JSON CLI output gives clear next steps, especially for:
  - project/team trust
  - reload
  - validate

### Validation

- Tests cover manifest parsing.
- Tests cover provenance projection.
- Tests cover install/update/remove/promote/demote route behavior.
- Tests cover project/team trust behavior after package updates.
- Tests cover CLI command registration/output.
- Tests cover MCP/Pi action parity.
- Tests cover docs content.
- `pnpm type-check` passes.
- `pnpm test` passes.
- `pnpm docs:check` passes if docs generation/reference artifacts are affected.
