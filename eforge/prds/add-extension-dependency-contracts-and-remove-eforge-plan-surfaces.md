---
title: Add Extension Dependency Contracts and Remove `/eforge:plan` Surfaces
created: 2026-06-15
depends_on: ["compact-eforge-plan-workstation-loading-and-oversized-output-safeguards"]
stack_parent: compact-eforge-plan-workstation-loading-and-oversized-output-safeguards
---

# Add Extension Dependency Contracts and Remove `/eforge:plan` Surfaces

## Problem / Motivation

This session plan covers recommendation `group-kernel-playbook-migration`, combining:

- Add first-class extension dependency and capability contracts.
- Remove hardcoded `/eforge:plan`-style host surfaces.

Native extensions need first-class dependency and capability contracts so extensions can safely depend on each other without hardcoded host-specific handoffs. Planning entry should move away from Pi and Claude Code owning `/eforge:plan` commands or skills, and instead route through generic extension contribution discovery/invocation plus `eforge-plan` workstation and deep-link surfaces.

This adds a kernel/platform-level extension contract without moving product workflow ownership back into the kernel.

## Goal

Implement first-class extension dependency/capability contracts for native extensions, then use them so `eforge-playbook` planning-mode behavior can depend on `eforge-plan` while autonomous playbooks remain available without `eforge-plan`.

Delete the hardcoded `/eforge:plan` host surfaces from Pi and Claude Code, with planning entry routed through generic extension contribution discovery/invocation and `eforge-plan` workstation/deep-link surfaces.

## Approach

- Model dependency declarations as required vs optional, with version and capability constraints where needed.
- Prefer named capabilities for stable contracts such as planning workstations or planning-mode playbook support.
- Avoid depending on private implementation details of another extension.
- Make extension manifests the source of truth for declared dependencies and capabilities.
- Resolve dependencies after extension discovery/trust evaluation and before enabling contributions that depend on them.
- Have the extension loader/discovery layer own resolution, compatibility checks, trust checks, and diagnostics.
- Compute contribution availability from dependency/capability state so optional dependencies can leave the extension loaded while disabling or explaining unavailable features.
- Required dependency failure should skip or disable the dependent extension with clear diagnostics.
- Optional dependency failure should keep the extension loaded and make affected actions report unavailable functionality.
- Runtime action contexts need a stable, audited way to inspect dependency/capability availability.
- If cross-extension invocation is included, expose it only through a platform API with provenance, timeout, audit events, and loop detection.
- Any cross-extension invocation must preserve provenance and avoid direct host-specific handoffs.
- Treat `/eforge:plan` removal as deletion, not deprecation.
- No Pi or Claude compatibility shim should remain for `/eforge:plan`.
- Host integrations should become generic contribution/workstation launchers rather than owners of `eforge-plan`-specific commands.
- Keep daemon/client/input APIs that intentionally support build enqueue and session-plan compatibility.
- Avoid adding new host-specific `/eforge:plan` routes or command shims.
- Keep Pi and Claude consumer-facing behavior in sync.
- Bump the Claude plugin version when plugin files change.
- Do not bump the Pi package version.
- Sequence the work as platform contracts first, first-party contract adoption second, then host-surface deletion and documentation cleanup.
- Likely implementation areas include extension runtime/SDK metadata and loader code, contribution action context APIs, typed diagnostics if exposed over client/daemon boundaries, Pi integration, Claude plugin surfaces, and related docs/tests.

Assumptions:

- The selected two backlog items are unblocked and can be planned together.
- Implementation should still sequence capability contracts before host-surface deletion that relies on generic contribution routing.
- Deletion of `/eforge:plan` shims is acceptable because the backlog item explicitly targets deletion rather than deprecation.
- `eforge-playbook` extraction and trigger-contract work are related follow-ups, not required to finish this session.

Primary risks to validate:

- Extension loader regressions.
- Unclear optional-dependency UX.
- Accidental host-specific compatibility shims.
- Pi/Claude drift.
- Cross-extension invocation security hazards.
- Cross-extension invocation loop hazards.
- Stale docs, prompts, or generated references.

## Scope

In scope:

- Plan and implement first-class extension dependency/capability contracts for native extensions.
- Support required extension dependencies.
- Support optional extension dependencies.
- Support stable named capabilities in extension metadata.
- Add load/discovery diagnostics for missing dependencies.
- Add load/discovery diagnostics for shadowed dependencies.
- Add load/discovery diagnostics for untrusted dependencies.
- Add load/discovery diagnostics for changed dependencies.
- Add load/discovery diagnostics for errored dependencies.
- Add load/discovery diagnostics for version-incompatible dependencies.
- Add load/discovery diagnostics for capability-incompatible dependencies.
- Provide a supported runtime dependency/capability lookup path.
- Provide cross-extension action invocation only if it can meet the safety constraints.
- Use the new contract so `eforge-playbook` planning-mode behavior can depend on `eforge-plan`.
- Keep autonomous playbooks available without `eforge-plan`.
- Remove hardcoded `/eforge:plan` host surfaces from Pi.
- Delete the Pi native `eforge:plan` command registration/handler.
- Delete the packaged `eforge-plan` skill from Pi.
- Remove matching Claude plan command/skill surfaces.
- Route planning entry through generic extension contribution discovery/invocation.
- Route planning entry through `eforge-plan` workstation/deep-link surfaces.

Out of scope:

- Full `eforge-playbooks` extraction.
- Final deprecation of every built-in session-plan/playbook surface.
- Broad workflow orchestration changes outside the extension/kernel boundary.

## Acceptance Criteria

- Extension metadata can declare required extension dependencies.
- Extension metadata can declare optional extension dependencies.
- Extension metadata can declare named capabilities.
- Extension metadata can express version constraints where needed.
- Extension metadata can express capability constraints where needed.
- Discovery/load diagnostics identify missing dependencies.
- Discovery/load diagnostics identify shadowed dependencies.
- Discovery/load diagnostics identify untrusted dependencies.
- Discovery/load diagnostics identify changed dependencies.
- Discovery/load diagnostics identify errored dependencies.
- Discovery/load diagnostics identify version-incompatible dependencies.
- Discovery/load diagnostics identify capability-incompatible dependencies.
- Required dependency failures skip or disable the dependent extension with dependency diagnostics.
- Optional dependency failures keep the dependent extension loaded.
- Optional dependency failures allow affected contributions/actions to report unavailable functionality.
- Contribution availability is computed from dependency/capability state.
- Runtime dependency/capability lookup exists.
- Runtime action contexts can inspect dependency/capability availability through the supported lookup path.
- If cross-extension action invocation is implemented, it preserves provenance.
- If cross-extension action invocation is implemented, it enforces a timeout.
- If cross-extension action invocation is implemented, it emits audit events.
- If cross-extension action invocation is implemented, it detects invocation loops.
- If cross-extension action invocation is implemented, it avoids direct host-specific handoffs.
- `eforge-playbook` planning-mode behavior can depend on `eforge-plan` through the new contract.
- `eforge-playbook` autonomous playbook behavior remains available without `eforge-plan`.
- Pi no longer registers a native `eforge:plan` command.
- Pi no longer handles a native `eforge:plan` command.
- Pi no longer packages the `eforge-plan` skill directory.
- Claude Code no longer advertises a hardcoded `/eforge:plan` skill surface.
- Claude Code no longer advertises a hardcoded `/eforge:plan` command surface.
- Pi contains no retained `/eforge:plan` compatibility shim.
- Claude Code contains no retained `/eforge:plan` compatibility shim.
- Generic extension contribution discovery remains available for planning entry.
- Generic extension contribution invocation remains available for planning entry.
- `eforge-plan` workstation routing remains available.
- `eforge-plan` deep-link routing remains available.
- Docs describe planning entry through extension contributions/workstation surfaces.
- Docs do not describe planning entry through host-specific `/eforge:plan` commands.
- Existing build enqueue compatibility continues through intentionally retained generic daemon/client/input APIs.
- Existing session-plan compatibility continues through intentionally retained generic daemon/client/input APIs.
- Automated tests cover removed command/skill registration.
- Automated tests cover absent packaged skill files.
- Automated tests cover dependency/capability contract behavior.
- Automated tests cover extension contribution routing.
- Automated tests cover manifest parsing.
- Automated tests cover dependency graph resolution.
- Automated tests cover trust incompatibility diagnostics.
- Automated tests cover version incompatibility diagnostics.
- Automated tests cover capability incompatibility diagnostics.
- Automated tests cover required dependency behavior.
- Automated tests cover optional dependency behavior.
- Automated tests cover runtime dependency/capability lookup.
- If cross-extension action invocation is implemented, automated tests cover invocation safety.
- A test or grep gate proves Pi no longer registers, packages, or advertises `/eforge:plan`.
- A test or grep gate proves Claude Code no longer registers, packages, or advertises `/eforge:plan`.
- Generic contribution routing tests continue to pass.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm docs:check` exits 0 when docs or generated references change.
- `pnpm maintainability:check` exits 0 before handoff.
- The Claude plugin version is bumped when Claude plugin files change.
- The Pi package version is not bumped.

## Manual Verification Notes

- Manually smoke-test `eforge-plan` entry through generic extension contribution discovery.
- Manually smoke-test `eforge-plan` entry through workstation surfaces.
- Manually smoke-test `eforge-plan` entry through deep-link surfaces.