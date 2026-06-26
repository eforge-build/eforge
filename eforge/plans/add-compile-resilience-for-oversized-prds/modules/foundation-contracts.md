# Foundation Contracts

## Architecture Reference

This module implements the **Foundation Contracts** portion of the architecture, especially:

- **Module Responsibilities / foundation-contracts** — client-owned schemas, event variants, terminal subtypes, recovery option discriminants, and exported type names.
- **Shared Data Model** — bounded compile preflight risk, scope/context failure, artifact summary, and validation diagnostic contracts.
- **Integration Contracts Between Modules / Foundation Contracts** — engine modules consume these contracts but do not define parallel wire shapes.
- **Dependency Direction** — `@eforge-build/client` owns serializable contracts; engine and surfaces import or re-export those contracts.

Key constraints from architecture:
- Keep serializable wire shapes in `@eforge-build/client`; do not place provider classifiers, thrown error classes, or formatting functions in the client package.
- Add `planning:preflight` and `planning:scope-context:failure` as direct TypeBox event variants so `EforgeEventVariantsSchema` remains one flat union.
- Add the `error_context_window` terminal subtype through `AgentTerminalSubtypeSchema` so `build:terminal-failure.failure.terminalSubtype` can carry compile context failures.
- Bound event-facing arrays with `MAX_COMPILE_RISK_LIST_ITEMS`; count fields retain unbounded totals.
- Extend recovery sidecar option types for non-mutating guidance without changing the `RecoveryVerdict` or `ApplyRecoveryResponse` verdict enum.
- Keep helper implementations out of this module; only define serializable contracts and public exports.

## Scope

### In Scope

- Add client-owned TypeBox schemas and TypeScript types for:
  - `CompileRiskLevel`
  - `CompileRecoveryAction`
  - `CompilePreflightRisk`
  - `CompileArtifactSummary`
  - `CompileScopeContextFailure`
  - `BoundedDiagnosticOptions`
  - `BoundedValidationDiagnostic`
- Add `MAX_COMPILE_RISK_LIST_ITEMS` and use it as the `maxItems` bound for event-facing representative arrays.
- Add `planning:preflight` and `planning:scope-context:failure` event variants.
- Add event registry metadata for both new event types.
- Add `error_context_window` to `AgentTerminalSubtypeSchema`.
- Broaden `RecoverySidecarRecoveryOption` to include compile scope/context guidance actions derived from `CompileRecoveryAction`.
- Export the new schemas, constants, and types from the public client barrels: `@eforge-build/client`, `@eforge-build/client/events`, and `@eforge-build/client/browser`.
- Re-export the new public contracts through `packages/engine/src/events.ts` for engine-local imports in dependent modules.
- Add contract tests for schema validation, bounded arrays, terminal subtype acceptance, public exports, and recovery option type coverage.

### Out of Scope

- Risk scoring thresholds or preflight algorithms.
- Generated inventory detection or prompt compaction.
- Planner tool validation diagnostic formatting functions.
- Proactive context guard execution.
- Provider context-window string classification.
- `CompileScopeContextError` or retry/decomposition decision logic.
- Engine-only `CompilePreflightOptions` and `CompilePromptSourceBundle` definitions; preflight-compaction owns those helpers.
- Persisted artifact validation.
- CLI, Console, Pi, or Claude plugin rendering changes.
- `DAEMON_API_VERSION` changes; this module adds event/type variants and does not change existing route request semantics.

## Implementation Approach

### Overview

Create a focused client schema module for compile-resilience contracts and wire it into existing event and route barrels. Keep `packages/client/src/events/shared/schemas.ts` below the implementation file hard cap by adding only the terminal subtype literal there; place the larger compile-resilience schema set in a new file.

The event contracts are additive:

- `planning:preflight` carries `{ risk: CompilePreflightRisk }`.
- `planning:scope-context:failure` carries `{ failure: CompileScopeContextFailure }`.

The recovery sidecar contract remains backward compatible because the existing continue-repair option remains one union member and the new compile-resilience option is additive.

### Key Decisions

1. **Use a new `events/shared/compile-resilience.ts` schema file.**  
   `packages/client/src/events/shared/schemas.ts` is already 590 lines and is not in the oversized-file baseline. A new focused file avoids pushing it past the 600-line implementation cap while keeping client ownership.

2. **Use direct event variants, not nested event-family unions.**  
   `planning:preflight` and `planning:scope-context:failure` will be direct `Type.Object` entries in `planningEventVariants`; this preserves the existing schema-shape invariant tested by `events-schema-shape.test.ts`.

3. **Use a wrapped `failure` field for scope/context failures.**  
   The event shape mirrors `build:terminal-failure` and keeps the rich compile failure payload isolated from generic planning event fields.

4. **Make `planning:scope-context:failure` persisted and `planning:preflight` non-persisted.**  
   The failure event carries operator guidance needed after reconnect; the preflight event is an advisory live planning event like existing planning progress and pipeline events.

5. **Add `missingPlanFileCount` to `CompileArtifactSummary`.**  
   `missingPlanFiles` is bounded by `MAX_COMPILE_RISK_LIST_ITEMS`; the count retains the total number of missing files for oversized artifact sets.

6. **Keep recovery guidance non-mutating.**  
   Add a `compile-scope-context` recovery option union member with actions such as `retry-as-expedition` and `bounded-decomposition`; do not add these actions to `RecoveryVerdict` or `ApplyRecoveryResponse`.

7. **Define diagnostic data shape, not formatter logic.**  
   `BoundedValidationDiagnostic` and `BoundedDiagnosticOptions` become shared contracts. The future planner-guardrails module implements `formatPlannerToolValidationDiagnostic` in engine code.

8. **Do not duplicate action string unions in route types.**  
   `RecoverySidecarRecoveryOption` derives compile guidance actions from `CompileRecoveryAction` using `Exclude<CompileRecoveryAction, 'none'>`.

9. **Keep `event-registry.ts` at or below its no-growth ceiling.**  
   The file is in `scripts/agent-maintainability-baseline.json` with a 1912-line ceiling. Add the two registry entries with bounded exact edits and remove or compact at least the same number of lines from nearby comments or formatting.

## Files

### Create

- `packages/client/src/events/shared/compile-resilience.ts` — TypeBox schemas, constants, and `Static<>` type aliases for compile risk, scope/context failure, artifact summary, and bounded diagnostics.
- `packages/client/src/__tests__/compile-resilience-contracts.test.ts` — contract tests for the new schemas, events, terminal subtype, recovery option union, and public exports.

### Modify

- `packages/client/src/events/shared/schemas.ts` — add `error_context_window` to `AgentTerminalSubtypeSchema` `[region: foundation-contracts, inside AgentTerminalSubtypeSchema in core-classification-schemas]`.
- `packages/client/src/events/variants/session-planning.ts` — import compile-resilience schemas and add `planning:preflight` plus `planning:scope-context:failure` variants `[region: foundation-contracts, import section and Planning block immediately after planning:start / planning:error]`.
- `packages/client/src/routes/recovery.ts` — replace the single `RecoverySidecarRecoveryOption` interface with a union containing the existing continue-repair option and a compile-scope-context guidance option `[region: foundation-contracts, adjacent to the existing RecoverySidecarRecoveryOption definition]`.
  - Registry note: the architecture shared-file table lists `routes/recovery.ts` under `context-recovery` and `surfaces-docs`, but this module description assigns the recovery option union to `foundation-contracts`. Builders must treat this foundation edit as the contract-owned region; context-recovery later constructs values and surfaces-docs renders them.
- `packages/client/src/routes.ts` — export any new named recovery option helper types from `routes/recovery.ts`.
- `packages/client/src/events.schemas.ts` — export compile-resilience schemas, constants, and type aliases from `events/shared/compile-resilience.ts`.
- `packages/client/src/events.ts` — re-export compile-resilience public types and schemas from `events.schemas.ts`.
- `packages/client/src/index.ts` — re-export compile-resilience event types, schemas, constants, and route option helper types from the main client barrel.
- `packages/client/src/browser.ts` — re-export compile-resilience event types, schemas, constants, and route option helper types from the browser-safe barrel.
- `packages/client/src/event-registry.ts` — add registry entries for `planning:preflight` and `planning:scope-context:failure`; keep total line count no higher than the baseline ceiling.
- `packages/engine/src/events.ts` — re-export the new compile-resilience types, schemas, and constants from `@eforge-build/client` so dependent engine modules can import through `../events.js`.

## Contract Details

### New Client Schema Module

`packages/client/src/events/shared/compile-resilience.ts` must define:

- `MAX_COMPILE_RISK_LIST_ITEMS` with a small representative-list value such as `12`.
- `CompileRiskLevelSchema`: `normal | elevated | overflow-risk`.
- `CompileRecoveryActionSchema`: `none | retry-as-expedition | bounded-decomposition | manual-reduce-scope | repair-existing-artifacts`.
- `CompilePipelineScopeSchema`: `errand | excursion | expedition`.
- `CompilePreflightRiskSchema` with fields from the architecture:
  - byte/count fields as non-negative integers
  - `generatedInventory` with bounded `contentHashes`, `pathReferences`, and `headings`
  - `subsystemBreadth` with bounded `subsystems` and `evidence`
  - optional `selectedProfile` as string or null
  - optional `pipelineScope`
  - bounded `reasons`
  - `recommendation` with action, eligible flag, and bounded reason
- `CompileArtifactSummarySchema` with:
  - `orchestrationExists`
  - `validPlanCount`
  - `invalidPlanCount`
  - `missingPlanFileCount`
  - bounded `missingPlanFiles`
  - bounded `invalidPlanFiles`
- `CompileScopeContextFailureSchema` with:
  - `source: preflight | live-context-guard | provider`
  - `failureKind: context-budget | context-window | context-length | scope-too-broad`
  - `stage: pipeline-composer | planner | module-planner | compile-expedition | compile`
  - bounded `explanation`
  - optional `risk`
  - optional observed token/turn/prompt byte metrics
  - recovery metadata with action, eligible, attempted, attempt, maxAttempts, and reason
  - artifact summary
- `BoundedDiagnosticOptionsSchema` with positive integer `maxMessageBytes` and `maxExcerptBytes`.
- `BoundedValidationDiagnosticSchema` with schema path, expected type, received type, excerpt, payload bytes, SHA-256 hash, omitted bytes, truncated flag, and message.

Export `Static<>` type aliases for each schema that downstream modules import.

### Recovery Sidecar Option Union

Keep the existing continue-repair shape as a named member and add a compile guidance member:

- Continue-repair member:
  - `kind: 'continue-repair'`
  - `action: 'continue-repair'`
  - `recommended: boolean`
  - `reason: string`
- Compile guidance member:
  - `kind: 'compile-scope-context'`
  - `action: Exclude<CompileRecoveryAction, 'none'>`
  - `recommended: boolean`
  - `eligible: boolean`
  - `reason: string`
  - optional `attempted`, `attempt`, `maxAttempts`
  - optional `source` and `failureKind` derived from `CompileScopeContextFailure`

Do not add compile guidance actions to `RecoveryActionAppliedMetadata`, `RecoveryAppliedMetadata`, `ApplyRecoveryRequest`, or `ApplyRecoveryResponse`.

### Event Registry Entries

Add concise summaries that do not echo large arrays:

- `planning:preflight`: `scope: 'session'`, `persist: false`, summary includes risk level, source byte count, and recovery action.
- `planning:scope-context:failure`: `scope: 'session'`, `persist: true`, summary includes failure kind, source, and recovery action.

## Testing Strategy

### Unit Tests

Add `packages/client/src/__tests__/compile-resilience-contracts.test.ts` with tests that:

- Parse a valid `planning:preflight` event through `safeParseEforgeEvent`.
- Reject a `planning:preflight` event whose representative arrays contain `MAX_COMPILE_RISK_LIST_ITEMS + 1` entries.
- Parse a valid `planning:scope-context:failure` event for a provider context-length failure.
- Reject a `planning:scope-context:failure` event with a recovery action outside `CompileRecoveryActionSchema`.
- Verify `AgentTerminalSubtypeSchema` accepts `error_context_window`.
- Verify `safeParseEforgeEvent` accepts `build:terminal-failure` with `failure.terminalSubtype: 'error_context_window'` and `failure.scope: 'compile'`.
- Verify `BoundedValidationDiagnosticSchema` accepts a diagnostic with a 64-character lowercase hex `payloadSha256` and rejects an invalid hash.
- Compile a `RecoverySidecarRecoveryOption[]` containing both a continue-repair option and a compile-scope-context option.
- Assert `eventRegistry` contains both new event types with the expected `scope` and `persist` values.
- Assert `getEventSummary` for both new event types omits representative array contents.

Update existing export tests if needed:

- `packages/client/src/__tests__/client-contract-public-exports.test.ts` — add runtime checks for exported schemas/constants from `index.ts`, `events.ts`, and `browser.ts`.
- `packages/client/src/__tests__/terminal-failure-event.test.ts` — add `error_context_window` to terminal subtype coverage if the new contract test does not cover it.

### Integration Tests

No engine integration test belongs in this module. Provider classification, guard stops, retry decisions, and artifact validation are owned by downstream modules and must use these shared contracts.

## Verification

- [ ] `safeParseEforgeEvent` accepts a valid `planning:preflight` event.
- [ ] `safeParseEforgeEvent` rejects a `planning:preflight` event with `MAX_COMPILE_RISK_LIST_ITEMS + 1` representative hashes.
- [ ] `safeParseEforgeEvent` accepts a valid `planning:scope-context:failure` event.
- [ ] `safeParseEforgeEvent` rejects a scope/context failure event whose recovery action is not in `CompileRecoveryActionSchema`.
- [ ] `Value.Check(AgentTerminalSubtypeSchema, 'error_context_window')` returns `true`.
- [ ] `safeParseEforgeEvent` accepts `build:terminal-failure` with compile scope and `error_context_window` terminal subtype.
- [ ] `Value.Check(BoundedValidationDiagnosticSchema, diagnostic)` returns `true` for a diagnostic containing path, type, byte length, hash, excerpt, omitted bytes, truncated flag, and message.
- [ ] `Value.Check(BoundedValidationDiagnosticSchema, invalidHashDiagnostic)` returns `false` when `payloadSha256` is not 64 lowercase hex characters.
- [ ] `RecoverySidecarRecoveryOption[]` type-checks with continue-repair and compile-scope-context members.
- [ ] `eventRegistry['planning:preflight']` has `scope: 'session'` and `persist: false`.
- [ ] `eventRegistry['planning:scope-context:failure']` has `scope: 'session'` and `persist: true`.
- [ ] Public barrels export the new compile-resilience schemas, constants, and types from `@eforge-build/client`, `@eforge-build/client/events`, and `@eforge-build/client/browser`.
- [ ] `packages/client/src/events/shared/schemas.ts` remains at or below 600 lines.
- [ ] `packages/client/src/event-registry.ts` remains at or below its 1912-line no-growth ceiling.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- packages/client/src/__tests__/compile-resilience-contracts.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["api", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
