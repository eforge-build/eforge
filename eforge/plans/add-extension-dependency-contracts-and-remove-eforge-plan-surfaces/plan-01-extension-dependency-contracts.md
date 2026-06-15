---
id: plan-01-extension-dependency-contracts
name: Extension Dependency and Capability Contracts
branch: add-extension-dependency-contracts-and-remove-eforge-plan-surfaces/plan-01-extension-dependency-contracts
agents:
  builder:
    effort: xhigh
    rationale: Kernel-level API addition touching manifest parsing, loader ordering,
      registry projection, action dispatch, and public SDK/client types.
  reviewer:
    effort: high
    rationale: Review must check loader ordering, trust-boundary diagnostics, and
      public API compatibility.
  tester:
    effort: high
    rationale: Dependency graph, trust, optional availability, and action-context
      lookup require targeted regression tests.
---

# Extension Dependency and Capability Contracts

## Architecture Context

Native extension discovery currently finds candidates, applies scope precedence/trust checks, imports extension factories, records registrations, and projects contributions into client-owned manifest schemas. This plan adds a first-class dependency/capability contract at that platform layer. Extension manifests become the source of truth for declared dependencies and capabilities; host integrations consume only registry/contribution state and do not learn private extension details.

Cross-extension action invocation is out of scope for this plan set. Do not add a cross-extension invocation API, audit event family, or loop-detection mechanism unless a later plan explicitly opts into that safety work.

## Implementation

### Overview

Add typed dependency and capability metadata, parse it from extension manifests, resolve dependency graphs after discovery/trust evaluation and before enabling dependent extension contributions, expose dependency/capability state through public projections, and add runtime lookup APIs for action contexts.

### Key Decisions

1. Parse declarations from `package.json#eforge.extension.capabilities` and `package.json#eforge.extension.dependencies.required|optional` for directory-layout extensions. File-layout extensions without a package manifest have no declared capabilities or dependencies.
2. Required dependency failure skips the dependent extension with diagnostics. Optional dependency failure leaves the dependent extension loadable and feeds contribution availability plus action-context lookup state.
3. Capabilities and capability requirements use a stable `name` plus optional `version`; dependency entries can also include an optional provider version constraint.
4. Support exact semantic versions plus comparator constraints such as `>=1.0.0`, `>1.0.0`, `<=2.0.0`, `<2.0.0`, and comma-separated AND constraints. Invalid constraint syntax is a manifest diagnostic.
5. Runtime lookup returns immutable availability data only. It does not invoke another extension.

## Scope

### In Scope

- SDK and engine types for extension capabilities, required dependencies, optional dependencies, version constraints, and capability constraints.
- Manifest parsing and validation for dependency/capability declarations.
- Dependency graph resolution with diagnostics for missing, shadowed, untrusted, changed, errored, version-incompatible, and capability-incompatible dependencies.
- Loader ordering and skip behavior for required dependency failures, including cascades from errored providers.
- Optional dependency state that keeps dependent extensions loaded.
- Contribution availability metadata and action dispatch rejection for unavailable contributions.
- Runtime action-context lookup for dependency and capability availability.
- Client/daemon projection updates for typed diagnostics and availability state.
- Tests for manifest parsing, graph resolution, trust/version/capability failures, required/optional behavior, contribution availability, and action-context lookup.

### Out of Scope

- Cross-extension action invocation.
- Moving playbook/session-plan product workflow ownership into the kernel.
- Removing `/eforge:plan` host surfaces.

## Files

### Create

- `packages/extension-sdk/src/dependencies.ts` — public SDK dependency/capability declaration and lookup types.
- `packages/engine/src/extensions/dependency-resolution.ts` — manifest validation, version/capability matching, graph ordering, diagnostics, and availability projection helpers.
- `test/extension-dependency-contracts.test.ts` — focused tests for manifest parsing, graph resolution, required/optional behavior, diagnostics, and runtime lookup.

### Modify

- `packages/extension-sdk/src/api.ts` — document the new metadata contract and action-context lookup surface.
- `packages/extension-sdk/src/context.ts` — add shared dependency/capability lookup context types if non-action contexts need the same shape.
- `packages/extension-sdk/src/contributions.ts` — add contribution requirement/availability fields to action, command, deep-link, workstation, and Console contribution types.
- `packages/extension-sdk/src/index.ts` — export new dependency/capability types.
- `packages/extension-sdk/README.md` — add an authoring example for manifest capabilities and optional dependency lookup.
- `packages/engine/src/extensions/types.ts` — add manifest metadata, resolved dependency state, contribution availability, and action-context lookup shapes to native registry types.
- `packages/engine/src/extensions/package-manifest.ts` — parse and validate `eforge.extension.capabilities` and `eforge.extension.dependencies.required|optional`; emit `extension:invalid-package-manifest` diagnostics for malformed entries.
- `packages/engine/src/extensions/discovery.ts` — attach parsed metadata to candidates/provenance without importing extension code.
- `packages/engine/src/extensions/loader.ts` — resolve dependency graph after discovery/trust metadata exists, load providers before dependents, skip required-failure dependents, preserve optional-failure dependents, and record diagnostics on candidates/registry.
- `packages/engine/src/extensions/recorder.ts` — preserve contribution requirement metadata during registration validation and merging.
- `packages/engine/src/extensions/manifest.ts` — project contribution availability and dependency diagnostics into the contribution manifest.
- `packages/engine/src/extensions/action-runtime.ts` — expose dependency/capability lookup on `ExtensionActionContext` and reject unavailable actions with an unavailable failure.
- `packages/engine/src/extensions/projector.ts` — include capabilities, dependencies, and resolved dependency state in extension management projections.
- `packages/engine/src/extensions/replay.ts` — include dependency/capability state in replay/list projections used by extension tooling tests.
- `packages/engine/src/extensions/index.ts` — export new resolver helpers and types.
- `packages/client/src/extension-contributions.ts` — add schemas/types for contribution availability and the unavailable action error code.
- `packages/client/src/types.ts` — add extension management projection types for capabilities and dependency resolution state.
- `packages/client/src/index.ts` and `packages/client/src/browser.ts` — export new client-visible schema/types required by existing export conventions.
- `packages/monitor/src/routes/extensions/contribution-service.ts` — map unavailable action dispatch results to a typed failure response and HTTP status.
- `test/extension-loader.test.ts` — add loader assertions for dependency ordering and required skip behavior when colocated with existing loader fixtures.
- `test/extension-contribution-registry-runtime.test.ts` — cover contribution availability in the engine registry if this is the nearest existing registry test.
- `packages/client/src/__tests__/extension-contributions.test.ts` — cover schema acceptance/rejection for availability metadata and unavailable failure responses.
- `test/extension-action-agent-tasks.test.ts` or `test/extension-action-context-runtime.test.ts` — cover runtime action-context dependency/capability lookup.
- `docs/extensions-api.md` and `web/content/docs/extensions-api.md` — document author-facing types and runtime lookup semantics.
- `docs/extensions.md` and `web/content/docs/extensions.md` — document manifest dependency/capability contracts, diagnostics, optional dependency UX, and the absence of cross-extension invocation.

## Verification

- [ ] `test/extension-dependency-contracts.test.ts` creates manifests with required dependencies and observes dependent candidate status `skipped` plus `extension:dependency-missing` for a missing provider.
- [ ] A required dependency on an untrusted project-team provider emits `extension:dependency-untrusted` and imports neither the provider nor the dependent.
- [ ] A required dependency on a changed project-team provider emits `extension:dependency-changed` with current/trusted hashes when available.
- [ ] A required dependency on a provider whose factory throws emits `extension:dependency-error` on the dependent.
- [ ] Version and capability mismatches emit `extension:dependency-version-incompatible` and `extension:dependency-capability-incompatible` respectively.
- [ ] A shadowed provider that is the only matching capability source emits `extension:dependency-shadowed`.
- [ ] Optional dependency failure leaves the dependent extension status `loaded`.
- [ ] A contribution with unmet optional capability requirements appears in the manifest with `availability.available === false` and a diagnostic message.
- [ ] Invoking an unavailable action returns `{ ok: false, error: { code: 'unavailable' } }`.
- [ ] An action handler can read dependency/capability availability from the supported context lookup API.
- [ ] Client schemas accept manifests containing dependency/capability availability metadata and reject malformed availability shapes.
- [ ] No cross-extension invocation API, direct host-specific handoff, or invocation loop state is introduced in this plan.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- extension-dependency-contracts extension-contributions extension-loader` exits 0.
