---
id: plan-01-engine-contract
name: Model-Aware Pi Compile Guard and Event Contract
branch: make-pi-compile-context-guard-limits-model-aware/plan-01-engine-contract
agents:
  builder:
    effort: high
    rationale: Touches Pi harness model resolution, compile-stage guard wiring, and
      client-owned wire schemas; requires careful type coordination without
      adding Claude SDK integration.
  reviewer:
    effort: high
    rationale: Client event schema and engine guard behavior changes need close
      review for backwards-compatible optional fields.
---

# Model-Aware Pi Compile Guard and Event Contract

## Architecture Context

Compile planner-family agents (`pipeline-composer`, `planner`, and `module-planner`) currently receive `compileContextGuardOptions(...)` with only static guard limits from `ctx.compileContextGuardLimits`. The Pi harness already resolves a provider/model from the same resolved agent config that compile stages compute via `resolveAgentConfig(...)`. This plan centralizes Pi model metadata lookup near the Pi harness, derives a safe per-turn input-token budget from Pi model metadata, and adds optional client-owned diagnostic fields to `planning:scope-context:failure` evidence.

The engine continues to emit typed events; renderers consume the optional diagnostics in plan 02. Claude Agent SDK model-aware limits remain out of scope.

## Implementation

### Overview

Add a Pi model-resolution helper under `packages/engine/src/harnesses/`, use it from both `PiHarness` and compile guard derivation, extend compile context guard failures with optional structured diagnostics, and update the client event schema/public exports/tests.

### Key Decisions

1. Keep all Pi SDK imports under `packages/engine/src/harnesses/` by creating a helper such as `pi-model-resolution.ts` or `pi-compile-context-guard.ts` in that directory.
2. Use `ModelRegistry` lookup as the metadata authority for built-in and custom Pi models; keep the harness fallback behavior centralized in the same helper so compile guard lookup and runtime model resolution do not drift.
3. Compute `maxObservedInputTokens` from `contextWindow - outputReserve - overheadReserve`, then apply a safety margin. Use `maxTokens`/similar output metadata when present, otherwise use a conservative default output reserve. Never use the full context window as the input limit.
4. Preserve existing prompt byte defaults; the model-aware derivation changes only the live per-turn input-token guard unless an existing explicit limit field is already being merged for other guard dimensions.
5. Add an explicit non-Pi/Claude SDK branch comment stating that Claude Agent SDK model-aware guard integration is intentionally not implemented because that harness is expected to be deprecated and because of Anthropic policies around third-party harnesses.

## Scope

### In Scope

- Derive Pi planner-family `maxObservedInputTokens` from resolved Pi provider/model metadata.
- Apply derivation to `pipeline-composer`, `planner`, and `module-planner` after each role's `resolveAgentConfig(...)` call and before the agent run starts.
- Emit optional structured diagnostics on `CompileScopeContextFailure` containing resolved provider, model id, metadata source/fallback reason, context window, output reserve, overhead reserve, safety margin, and final guard limits.
- Keep provider/context-window failure conversion able to attach the same guard diagnostics when the failure is not thrown by the live guard itself.
- Keep older `planning:scope-context:failure` events valid when the optional diagnostics are absent.
- Add focused unit/contract tests for built-in metadata, custom override-style metadata, missing metadata, invalid metadata, fallback reason text, and per-turn accounting.

### Out of Scope

- Claude Agent SDK model-aware guard implementation.
- Compile preflight scoring changes.
- Retry-as-expedition policy changes.
- Recovery sidecar action semantics changes.
- Renderer and docs updates; plan 02 owns those consumers.

## Files

### Create

- `packages/engine/src/harnesses/pi-model-resolution.ts` — Shared Pi runtime model and model metadata resolution using `AuthStorage`, `ModelRegistry`, and existing built-in/synthetic fallback logic.
- `test/pi-compile-context-guard-limits.test.ts` — Focused tests for deriving guard limits from Pi metadata and fallback paths.

### Modify

- `packages/engine/src/harnesses/pi.ts` — Replace inline runtime model lookup with the shared Pi model-resolution helper so runtime and guard metadata lookup share one implementation path.
- `packages/engine/src/compile-resilience/context-guard.ts` — Extend `CompileContextGuardOptions` and failure construction with optional guard diagnostics while preserving per-turn input accounting.
- `packages/engine/src/compile-resilience/context-recovery.ts` — Carry guard diagnostics through `CompileScopeContextFailureInput`, `toCompileScopeContextError(...)`, and `buildCompileScopeContextFailure(...)` for live-guard and provider failures.
- `packages/engine/src/pipeline/stages/compile-stages.ts` — Resolve model-aware guard options after `resolveAgentConfig(...)` for `pipeline-composer`, `planner`, and `module-planner`; pass diagnostics into provider-error conversion; add the required Claude SDK exclusion comment in the non-Pi branch/helper.
- `packages/client/src/events/shared/compile-resilience.ts` — Add client-owned TypeBox schemas and exported types for optional guard diagnostics and resolved guard limits.
- `packages/client/src/events/root.ts` — Export any new compile guard diagnostic schema-derived types needed by public barrels.
- `packages/client/src/events.schemas.ts` — Re-export new schemas/types through the compatibility facade.
- `packages/client/src/events.ts` — Re-export new schemas/types through the public events barrel.
- `packages/client/src/index.ts` — Re-export new schemas/types through the package root barrel.
- `packages/client/src/browser.ts` — Re-export new schemas/types through the browser barrel.
- `test/planner-context-guard.test.ts` — Assert failure diagnostics include model/limit fields and retain existing per-turn non-cumulative accounting tests.
- `packages/client/src/__tests__/compile-resilience-contracts.test.ts` — Validate optional guard diagnostics fields and legacy events without those fields.

## Formula Requirements

The helper must expose constants or code comments for the derivation:

- `contextWindow`: positive integer from Pi model metadata.
- `outputReserveTokens`: derived from `maxTokens`/output metadata when available; otherwise a conservative default reserve.
- `overheadReserveTokens`: fixed tool/transport overhead reserve.
- `safetyMargin`: multiplicative margin applied after subtracting reserves.
- `limits.maxObservedInputTokens`: floored positive integer result; invalid, missing, or non-positive results use `DEFAULT_COMPILE_CONTEXT_GUARD_LIMITS.maxObservedInputTokens` and a non-empty fallback reason.

## Verification

- [ ] Built-in Pi metadata with `contextWindow` produces `limits.maxObservedInputTokens` lower than `contextWindow` and higher than the static fallback for a large-context model.
- [ ] A custom Pi model fixture with `contextWindow` and output-token metadata produces the expected formula result from that fixture.
- [ ] Missing provider, missing model id, missing `contextWindow`, registry lookup error, and invalid numeric metadata return the static fallback input-token limit with a non-empty fallback reason.
- [ ] Derived diagnostics include provider, model id, metadata source, context window when available, output reserve, overhead reserve, safety margin, and final limits.
- [ ] `pipeline-composer`, `planner`, and `module-planner` build context guard options from the resolved agent config for that same role before the agent run starts.
- [ ] `planning:scope-context:failure` schema validation accepts events with guard diagnostics and events without guard diagnostics.
- [ ] Existing compile context recovery behavior accepts legacy `planning:scope-context:failure` inputs without guard diagnostics and produces the same recovery classification/action fields as the existing no-diagnostics fixture.
- [ ] Planner context guard tests still pass for two non-final input deltas of 6 and 5 under a limit of 10, and fail for one non-final input delta of 11 under that limit.
- [ ] The non-Pi/Claude SDK branch contains the explicit intentional-non-implementation comment required by the source.
