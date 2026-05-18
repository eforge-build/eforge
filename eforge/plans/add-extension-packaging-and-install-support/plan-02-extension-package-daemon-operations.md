---
id: plan-02-extension-package-daemon-operations
name: Daemon Extension Package Operations
branch: add-extension-packaging-and-install-support/plan-02-extension-package-daemon-operations
agents:
  builder:
    effort: high
    rationale: Package acquisition and filesystem mutation are security-sensitive
      and require collision, trust, and path-safety handling.
  reviewer:
    effort: high
    rationale: Review must inspect supply-chain safeguards, path traversal defenses,
      and trust-record semantics.
  tester:
    effort: high
    rationale: Route tests need real filesystem and git behavior for install,
      update, removal, promote, demote, and trust-state transitions.
---

# Daemon Extension Package Operations

## Architecture Context

Plan 1 adds package manifest/provenance contracts. This plan implements the daemon-side package-management operations behind those shared client routes. The daemon already owns extension management mutation routes for scaffold, reload, trust, and untrust, and it already enforces loopback/cross-origin protections for extension mutations. Playbook promote/demote routes provide scope-move precedent.

Key constraints:
- Install/update must never import extension modules or execute factories.
- Project/team installs, updates, and promotions must not silently preserve trust.
- Source copying/extraction must exclude `node_modules/`, `.git/`, and temp artifacts while preserving `dist/`.
- Route handlers must use shared `API_ROUTES` and client request/response types.

## Implementation

### Overview

Add monitor-side helper logic for safe package acquisition/copy/move/remove, then wire daemon routes for `install`, `update`, `remove`, `promote`, and `demote`. Return responses built from the same extension discovery/list projection path used by existing list/show routes.

### Key Decisions

1. Keep package-management orchestration in `packages/monitor/src/extension-package-management.ts` rather than expanding `server.ts` with large helper functions.
2. Support local package directories, local `.tgz` tarballs, and npm package specs via `npm pack --ignore-scripts --json --pack-destination <tmp>`. Reject git URL-like sources with a clear unsupported message.
3. Treat update as reinstall from the recorded sidecar source into the same scope/name. Refuse update when no valid eforge install sidecar exists.
4. Remove project/team trust records for install/update/promote unless the request includes explicit `trust: true`. If trust is requested for a project/team result, write the trust record through the same hash/trust-store helpers used by `extension trust`, using `trustedBy` when the request supplies it.
5. Allow remove to delete eforge-managed installs by default. Require `force: true` to remove handwritten extensions that lack the eforge install sidecar.
6. Promote moves from project-local `.eforge/extensions/<name>` or matching file to project/team `eforge/extensions/<name>` and stages the project/team path with `git add` when git is available. Demote moves in the reverse direction and does not stage.

## Scope

### In Scope

- Implement daemon mutation routes for extension package install/update/remove/promote/demote.
- Implement local directory, local tarball, and npm package spec acquisition.
- Reject git URL sources with a 400 response that mentions git support is deferred.
- Resolve target names by request `name`, then `eforge.extension.name`, then package/local-directory-derived safe name.
- Enforce collision refusal by default and `force` overwrite for install/update/promote/demote target collisions.
- Write install sidecar metadata for eforge-managed installs, including source kind/spec, resolved version/integrity when available, installedAt, and target scope.
- Remove trust records on project/team install/update/promote unless `trust: true` is present.
- Reuse discovery/list projection to return `ExtensionEntry` data after mutations when an extension remains.
- Add route tests for filesystem, trust, update, removal, promote, demote, npm/tarball source handling, and unsupported git source behavior.

### Out of Scope

- CLI/MCP/Pi user-facing command registration.
- Documentation changes.
- Remote git install support.
- Extension enable/disable state.
- Sandboxing or permission prompts beyond current trust records.

## Files

### Create

- `packages/monitor/src/extension-package-management.ts` — safe package acquisition, extraction/copy, sidecar writing, collision handling, remove, promote/demote, trust-record coordination, and response selection helpers.

### Modify

- `packages/monitor/src/server.ts` — import shared request/response types, call helper functions from new route blocks, keep loopback/cross-origin mutation guard on all new extension mutations, and avoid duplicating large package-management logic inline.
- `packages/monitor/package.json` — add no new dependency unless implementation proves unavoidable; prefer `npm pack` and system `tar` through `execFile`.
- `test/extension-tooling-routes.test.ts` — add in-process daemon tests for install/update/remove/promote/demote using real temp repos and HTTP/client helpers.
- `test/extension-trust-store.test.ts` or `test/extension-tooling-routes.test.ts` — assert update clears prior project/team trust unless `trust: true` is explicitly set.
- `test/extension-hash.test.ts` — add coverage only if helper changes affect hash inclusion/exclusion.

## Verification

- [ ] `POST /api/extensions/install` installs a local package directory into user, project, and local request scopes and returns an `ExtensionEntry` with install provenance.
- [ ] `POST /api/extensions/install` installs a local `.tgz` tarball and returns an `ExtensionEntry` with package and install provenance.
- [ ] `POST /api/extensions/install` installs an npm package spec via `npm pack --ignore-scripts` and records resolved version/integrity when npm reports them.
- [ ] `POST /api/extensions/install` rejects an existing target without `force: true` and replaces the target with `force: true`.
- [ ] `POST /api/extensions/install` for a project/team target leaves `trustState: "untrusted"` unless `trust: true` is supplied.
- [ ] `POST /api/extensions/update` reinstalls from recorded sidecar source and removes any previous project/team trust record unless `trust: true` is supplied.
- [ ] `POST /api/extensions/update` returns 409 or 400 when the target has no eforge install sidecar.
- [ ] `POST /api/extensions/remove` deletes an eforge-managed installed extension and refuses a handwritten extension without `force: true`.
- [ ] `POST /api/extensions/promote` moves a project-local extension to project/team scope, clears any same-name trust record, stages the project/team path when git is available, and refuses target collisions without `force: true`.
- [ ] `POST /api/extensions/demote` moves a project/team extension to project-local scope and refuses target collisions without `force: true`.
- [ ] Git URL-like install sources return a 400 response containing a documented follow-up message.
- [ ] Install/update tests assert the extension factory is not imported or executed during package acquisition.
- [ ] `pnpm type-check` passes after this plan merges.
