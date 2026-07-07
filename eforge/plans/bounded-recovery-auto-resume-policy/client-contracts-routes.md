---
id: client-contracts-routes
name: Client contracts, projection, routes
branch: bounded-recovery-auto-resume-policy/client-contracts-routes
---

# Client contracts, projection, routes

Define auto-resume event variants and schema changes in the shared client package, project policy status, attempts, last decision, and stop reason through shared auto-build state, and keep applyRecovery/continueRepair routes using shared contracts.

## Traceability

Criteria: ac-005, ac-007
Aspects: ac-005:evidence:queue-run-auto-build, ac-007:interface:route, ac-007:interface:route-api, ac-007:interface:schema, ac-007:interface:schema-contract, ac-007:interface:test, ac-007:subsystem:event, ac-007:subsystem:route, ac-007:subsystem:schema, ac-007:subsystem:test

## Validation

Author client schema parity and projection tests; exercise existing manual recovery route tests after contract changes.

## Fragment: Expose auto-build projection state

Add a shared client-owned auto-build projection shape/event fields for enabled/disabled policy, attempt count, last decision, and stop reason. Populate them from monitor auto-build supervisor/projection state, keeping REST/SSE/stream snapshots on the same shared projection path rather than ad-hoc object shaping.
## Fragment: Render auto-build projection state in Console

Update Console auto-build/run-detail hooks and existing UI components to consume the shared projection fields. Use the existing disabled-reason component for stop reasons and add tests for enabled, disabled, retry/attempt, last-decision, and stopped states.
## Fragment: Client event/schema parity

Add the new bounded recovery auto-resume event variants at the client-owned event schema surface. Use the focused event variant modules under `packages/client/src/events/` and keep the `EforgeEvent` discriminated union/runtime validation coherent. Add typed parity tests that prove the new variants are present, parse successfully, and reject malformed payloads; likely targets include `packages/client/src/__tests__/events-schema-shape.test.ts` and `test/validation-provider-event-schema.test.ts`.
## Fragment: Manual route regression coverage

Preserve existing manual `applyRecovery` and `continueRepair` route behavior while the new policy/event work lands. Route paths and wire shapes should flow through shared `@eforge-build/client` route helpers/contracts. Exercise the existing manual route tests such as `test/apply-recovery-route.test.ts` and `test/continue-repair-route.test.ts`; only make minimal additive changes if new typed events require assertions.