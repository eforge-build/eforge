---
id: plan-01-extension-package-foundation
name: Extension Package Manifest and Provenance Foundation
branch: add-extension-packaging-and-install-support/plan-01-extension-package-foundation
agents:
  builder:
    effort: high
    rationale: This plan changes discovery identity/entrypoint resolution and shared
      wire contracts; careful compatibility work is required.
  reviewer:
    effort: high
    rationale: Review needs to verify backward compatibility, API shape consistency,
      and manifest validation edge cases.
---

# Extension Package Manifest and Provenance Foundation

## Architecture Context

Native extension discovery currently supports file extensions, directory `index.*`, and directory `package.json` `exports`/`main` entrypoints. The source requires package manifest conventions, package/install provenance in list/show JSON, and shared client route contracts for upcoming install/update/remove/promote/demote operations. This plan establishes those foundations without adding daemon mutation routes or user-facing commands yet.

Key constraints:
- Existing `exports`/`main` and `index.*` directory layouts must continue to work.
- Install/discovery must not import extension modules or execute factories.
- `package.json` already participates in directory hashing for project/team extensions.
- Daemon wire shapes and route constants are owned by `@eforge-build/client`.

## Implementation

### Overview

Add eforge package-manifest parsing for `package.json`, enrich native extension candidates and projections with package/install provenance, and add shared client types/routes/helpers for the package-management operations that later plans implement.

### Key Decisions

1. Use an optional `package.json` block at `eforge.extension` for eforge-specific metadata. This preserves normal npm package authoring and extends the current package entrypoint lookup.
2. Resolve entrypoints in this order for directory packages: `eforge.extension.entrypoint`, then `exports`, then `main`, then `index.*`. If `eforge.extension.entrypoint` is present and invalid, emit a diagnostic instead of falling back.
3. Resolve logical extension names from `eforge.extension.name` when present; otherwise keep the existing basename-derived name. Invalid manifest names emit diagnostics and leave the candidate in an error state rather than silently changing identity.
4. Store install provenance in an eforge sidecar inside installed package directories, for example `.eforge-install.json`. The sidecar is intentionally outside the existing content hash because `hashExtensionDirectory` only includes `package.json` and source files; document that in later docs.
5. Add optional `package` and `install` fields to `ExtensionEntry` so existing callers remain source-compatible. Package provenance must carry package name, version, description, eforge extension name, eforge entrypoint, repository, and homepage when present. Install provenance must carry source kind, source spec, resolved version and integrity when available, installedAt, and target scope.
6. Include package-operation request fields for `source`, `scope`, `name`, `force`, `trust`, and `trustedBy` where they apply so CLI, MCP, and Pi surfaces can expose the same trust-aware operations.

## Scope

### In Scope

- Add manifest/provenance types to `packages/engine/src/extensions/types.ts` and client wire types in `packages/client/src/types.ts`.
- Create package-manifest parsing helpers for `package.json`.
- Create install-metadata read/write types/helpers for the sidecar used by later plans.
- Extend discovery to read `eforge.extension.name`, `eforge.extension.entrypoint`, package metadata, and sidecar install metadata.
- Extend loaded-extension and registry projection plumbing so package/install provenance reaches list/show/validate/test responses.
- Add `API_ROUTES` constants and typed client helpers for `install`, `update`, `remove`, `promote`, and `demote`, including `IfRunning` variants.
- Export new helpers/types from package entrypoints that already export extension tooling APIs.
- Add tests for manifest parsing, provenance projection, route constants, and helper exports.

### Out of Scope

- Daemon mutation route implementations.
- CLI, MCP, or Pi command/tool actions for package operations.
- Documentation updates for user workflows; those land after the behavior exists.
- Git URL package acquisition.

## Files

### Create

- `packages/engine/src/extensions/package-manifest.ts` — parse and validate `package.json` package metadata and optional `eforge.extension` fields without importing extension code.
- `packages/engine/src/extensions/install-metadata.ts` — define sidecar filename/schema, read/write helpers, and tolerant parsing for eforge-managed install provenance.

### Modify

- `packages/engine/src/extensions/types.ts` — add `NativeExtensionPackageProvenance`, `NativeExtensionInstallProvenance`, and optional provenance fields on candidates, shadows if useful, and loaded extensions.
- `packages/engine/src/extensions/discovery.ts` — use the new parser during directory layout resolution; honor `eforge.extension.entrypoint` and `eforge.extension.name`; attach package/install provenance; emit diagnostics for invalid eforge manifest fields.
- `packages/engine/src/extensions/loader.ts` — carry package/install provenance from candidates into `LoadedNativeExtension` without changing factory execution behavior.
- `packages/engine/src/extensions/projector.ts` — include package/install provenance in registry projections.
- `packages/engine/src/extensions/index.ts` — export new manifest/install metadata helpers and types.
- `packages/client/src/types.ts` — add package/install provenance wire types and request/response types for install/update/remove/promote/demote operations.
- `packages/client/src/routes.ts` — add `extensionInstall`, `extensionUpdate`, `extensionRemove`, `extensionPromote`, and `extensionDemote` constants.
- `packages/client/src/api/extensions.ts` — add typed helpers and `IfRunning` variants for all new extension package-management routes.
- `packages/client/src/index.ts` — export the new helpers and request/response types.
- `packages/client/src/browser.ts` — export browser-safe extension provenance and operation wire types as types only.
- `test/extension-discovery.test.ts` — cover valid `eforge.extension` name/entrypoint, invalid eforge manifest diagnostics, and install sidecar provenance discovery.
- `test/extension-tooling-wiring.test.ts` — cover route constants and helper export/import wiring for the new operations.
- `test/extension-tooling-routes.test.ts` — add minimal type-level or helper smoke assertions only if needed for route constant coverage; full route behavior lands in plan 2.

## Verification

- [ ] A directory extension with `package.json` `eforge.extension.name` is discovered under that logical name.
- [ ] A directory extension with `package.json` `eforge.extension.entrypoint` resolves that file before `exports`, `main`, and `index.*`.
- [ ] A package with invalid `eforge.extension.entrypoint` produces an `extension:invalid-package-manifest` diagnostic and does not silently use `exports` or `main`.
- [ ] Existing package `exports`, package `main`, and `index.*` discovery tests still pass.
- [ ] `ExtensionEntry` JSON includes package provenance for packaged directory extensions and install provenance when a valid sidecar exists.
- [ ] Package provenance includes package name, version, description, eforge extension name, eforge entrypoint, repository, and homepage when present.
- [ ] Install provenance includes source kind, source spec, resolved version and integrity when available, installedAt, and target scope.
- [ ] Client route constants and helpers exist for install/update/remove/promote/demote and contain no inline `/api/extensions/...` literals in `packages/client/src/api/extensions.ts`.
- [ ] Client request types include `trust` and `trustedBy` fields for install/update operations.
- [ ] `pnpm type-check` passes after this plan merges.