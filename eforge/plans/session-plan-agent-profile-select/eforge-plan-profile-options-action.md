---
id: eforge-plan-profile-options-action
name: Read-only eforge-plan profile options action
branch: session-plan-agent-profile-select/eforge-plan-profile-options-action
---

# Read-only eforge-plan profile options action

Expose profile options to the eforge-plan workstation through the standard extension-to-kernel access path. Add the eforge-plan read action only if the sandboxed workstation cannot consume an already-standardized host-data bridge directly. Any action must be a thin read-only adapter over the kernel-provided profile-list service and shared client profile response/types.

## Implementation scope

Primary owned paths when the standard context service or action is missing:

- `packages/extension-sdk/src/contributions.ts`
- `packages/engine/src/extensions/types.ts`
- Extension action invocation/runtime wiring in `packages/engine/src/extensions/` needed to provide a read-only `profiles.list(...)`-style context service
- `eforge/extensions/eforge-plan/session-plan-schemas.ts`
- `eforge/extensions/eforge-plan/session-plan-actions.ts`
- `eforge/extensions/eforge-plan/index.ts`
- eforge-plan registration/action tests such as `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts` and `eforge/extensions/eforge-plan/__tests__/registration.test.ts`
- Extension context/runtime tests under `test/` for the new read-only profile-list service, if that service is added

Required behavior:

- The context service delegates to the same kernel/client profile-list projection established by `client-profile-contract`; it must not scan profile directories, import private engine config/listing internals from eforge-plan, or define a new profile wire shape.
- Any new eforge-plan action (for example `list-agent-runtime-profiles`) declares read-only behavior, is registered, is included in workstation `allowedActions`, and simply delegates to the kernel-provided service.
- Returned option data may format kernel-owned fields for display, but preserves kernel-provided name, scope, harness, description, active, and shadowed metadata when available.
- Keep mutation, profile activation, profile creation/deletion, router behavior, enqueue precedence, and build validation out of scope.

## Traceability

Criteria: ac-002, ac-003, ac-004, ac-005, ac-012
Aspects: ac-002:evidence:scope-harness-description-active, ac-004:interface:configuration, ac-004:interface:extension, ac-004:interface:extension-surface, ac-004:interface:schema-contract, ac-004:subsystem:extension, ac-012:evidence:kernel-extension, ac-012:evidence:registration-allowed-action, ac-012:interface:extension, ac-012:interface:extension-surface

## Validation

Run these gates after implementation:

- `pnpm type-check`
- `pnpm test -- eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts`
- The targeted extension context/runtime test file added or updated in this plan under `test/`
- `pnpm maintainability:check`

Tests must prove read-only invocation, registration, workstation allowed-action wiring, context-rich profile options, and the kernel/client ownership boundary.
