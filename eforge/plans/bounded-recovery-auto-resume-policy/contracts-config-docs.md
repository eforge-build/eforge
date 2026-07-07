---
id: contracts-config-docs
name: Contracts, default-off config, docs
branch: bounded-recovery-auto-resume-policy/contracts-config-docs
---

# Contracts, default-off config, docs

Add owned client recovery auto-resume event/schema variants and typed fixtures, keep applyRecovery and continueRepair route APIs compatible, and wire the config surface so auto-resume is default-off/non-mutating with a bounded attempt budget. Inspect config sources before edits, sync existing docs/reference inputs when behavior or interfaces change, update recovery skill guidance for the opt-in automation exception, and avoid re-declaring wire shapes or route literals outside the client contract.

## Traceability

Criteria: ac-001, ac-007, ac-008
Aspects: ac-001:interface:configuration, ac-007:interface:route, ac-007:interface:route-api, ac-007:interface:schema, ac-007:interface:schema-contract, ac-007:interface:test, ac-007:subsystem:event, ac-007:subsystem:route, ac-007:subsystem:schema, ac-007:subsystem:test, ac-008:interface:config, ac-008:interface:configuration, ac-008:interface:docs, ac-008:interface:test, ac-008:subsystem:config, ac-008:subsystem:docs, ac-008:subsystem:integration, ac-008:subsystem:reference, ac-008:subsystem:test, ac-008:subsystem:unit

## Validation

Schema tests accept valid fixtures and reject invalid ones; existing manual recovery route tests remain green without looser assertions; config tests cover default disabled/no-op behavior and enabled parsing; recovery docs/skills explain the opt-in automation exception; docs drift checks run when docs/reference inputs change; `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check` pass.

## Fragment: Config docs/reference validation scope

Plan a bounded implementation pass for config/docs validation. Inspect status-only config evidence before making assertions, especially `packages/engine/src/config.ts`, `eforge/config.yaml`, `docs/config.md`, `docs/config-migration.md`, `packages/docs-gen/src/generators/config.ts`, and `web/content/reference/config.md`. Sync existing docs/reference sources when config behavior changes, and regenerate generated outputs instead of hand-editing generated artifacts such as `web/public/reference/*`. Use shared config/configuration/docs interface findings from the primary shared-interface atom when available.
## Fragment: Recovery docs and skill text

Update recovery documentation and the consumer-facing recovery skills that currently imply recovery actions are never auto-applied. Cover the disabled-by-default policy, the high-confidence compiled-artifact `continue-repair` exception, bounded attempts, visible audit/stop reasons, and the fact that manual confirmation controls remain available. Keep Pi and Claude-facing guidance in sync by checking `packages/pi-eforge/skills/eforge-recover/SKILL.md` and `eforge-plugin/skills/recover/recover.md`; when changing the Claude plugin skill content, bump `eforge-plugin/.claude-plugin/plugin.json` as required by repository policy and do not bump the Pi package version.
## Fragment: Targeted validation matrix

Author or update targeted unit and integration tests for the config/docs/reference changes. Candidate existing test areas from source evidence include config schema/agent config tests, docs-gen/reference-content tests, planner/compiler integration tests, and monitor config projection/route tests. Final validation must include targeted tests plus `pnpm type-check`, `pnpm test`, `pnpm docs:check` when generated config/reference docs change, and `pnpm maintainability:check`.
## Fragment: Event/schema parity

Update the owned client event protocol for the bounded recovery auto-resume variants. Start from the referenced recovery/event schema paths under `packages/client/src/events/` plus `event-validation`/`event-registry` as needed. Keep one authoritative `EforgeEvent` schema/type surface. Add typed parity tests for valid and invalid fixtures, including the existing validation-provider event schema coverage.
## Fragment: Manual recovery route compatibility

Preserve the manual `applyRecovery` and `continueRepair` route contracts while wiring any new event behavior. Inspect the referenced monitor recovery route files, client route map, route test helper, and route tests. Prefer minimal fixture updates over assertion weakening; route literals and daemon wire shapes should remain owned by `@eforge-build/client`.
## Fragment: Default-off config contract

Add or extend the config schema/defaults/types for a disabled-by-default recovery auto-resume policy with a configurable maximum attempt budget. The default configuration must make daemon policy consumers stop before any auto-resume mutation and preserve the existing failure-pause behavior for queued builds. Keep this fragment focused on the contract/default surface and its tests; the enabled policy evaluator, durable attempt loop, and continue-and-repair queueing are owned by `policy-resume-core`.
