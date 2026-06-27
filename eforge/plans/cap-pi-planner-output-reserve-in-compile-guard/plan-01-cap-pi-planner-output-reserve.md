---
id: plan-01-cap-pi-planner-output-reserve
name: Cap Pi Planner Output Reserve
branch: cap-pi-planner-output-reserve-in-compile-guard/plan-01-cap-pi-planner-output-reserve
---

# Cap Pi Planner Output Reserve

## Architecture Context

Pi-backed planner-family compile stages derive live context guard limits in `packages/engine/src/harnesses/pi-model-resolution.ts` before `runPlanner` and `runModulePlanner` create their compile context guards. The derivation already records provider/model diagnostics, metadata source, context window, reserves, safety margin, fallback reason, and resolved limits for `planning:scope-context:failure` events. The remaining gap is that large `maxTokens` metadata is used as the entire planner-family output reserve, which can shrink `maxObservedInputTokens` below the legacy static `160_000` default.

## Implementation

### Overview

Add a documented 64 Ki planner-family output reserve cap in `pi-model-resolution.ts`, apply it only to valid model `maxTokens` metadata before computing `maxObservedInputTokens`, expand the guard-limit tests for capped, below-cap, fallback, and override behavior, and update troubleshooting docs so operators interpret `outputReserveTokens` as the capped effective reserve.

### Key Decisions

1. Use a named constant such as `PI_COMPILE_CONTEXT_PLANNER_OUTPUT_RESERVE_TOKEN_CAP = 65_536` in `packages/engine/src/harnesses/pi-model-resolution.ts`; `64 Ki` means `64 * 1024` tokens.
2. Keep missing output metadata on the existing conservative default reserve (`PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS = 16_384`) rather than raising missing metadata to the new cap.
3. Preserve fallback paths for missing provider/model id, synthetic metadata, missing/invalid `contextWindow`, invalid `maxTokens`, registry lookup errors, and non-positive derived input budgets.
4. Keep `finalLimits()` behavior: a user-supplied positive `limits.maxObservedInputTokens` remains an upper bound via `Math.min(explicit, modelDerived)`.

## Scope

### In Scope

- Cap valid Pi model `maxTokens` values above 65,536 before planner-family guard budget derivation.
- Keep valid `maxTokens` values below 65,536 in the formula without changing their value.
- Add test coverage in `test/pi-compile-context-guard-limits.test.ts` for the `openai-codex/gpt-5.5` scenario, below-cap metadata, fallback behavior, and explicit lower overrides.
- Add troubleshooting guidance that `outputReserveTokens` in guard diagnostics is the effective capped reserve.

### Out of Scope

- Daemon/client event schema changes.
- Generic non-Pi compile guard changes.
- Claude Code plugin or Pi extension command changes.
- Recovery workflow changes.

## Files

### Create

- None.

### Modify

- `packages/engine/src/harnesses/pi-model-resolution.ts` — add the documented planner-family output reserve cap/helper and use it when deriving `outputReserveTokens` from valid `maxTokens` metadata.
- `test/pi-compile-context-guard-limits.test.ts` — import the new cap if exported, update or add `expectedLimit` assertions, add the 272,000 context / 128,000 maxTokens capped-reserve scenario, add a live guard assertion or equivalent limit assertion for 124,543 observed input tokens, retain below-cap output metadata coverage, and strengthen fallback/override assertions.
- `web/content/docs/troubleshooting.md` — expand the guard diagnostics paragraph to state that `outputReserveTokens` is the effective reserve used in the calculation and can be capped for planner-family Pi guards.
- Generated documentation artifacts — run `pnpm docs:generate` after editing `web/content/docs/troubleshooting.md` if `pnpm docs:check` reports drift; do not hand-edit generated reference artifacts.

## Implementation Notes

- Derive the effective reserve in one small helper or inline block, for example:
  - missing `maxTokens` => `PI_COMPILE_CONTEXT_DEFAULT_OUTPUT_RESERVE_TOKENS`
  - invalid `maxTokens` => fallback with `Pi model metadata has invalid output-token metadata`
  - valid `maxTokens` => `Math.min(maxTokens, PI_COMPILE_CONTEXT_PLANNER_OUTPUT_RESERVE_TOKEN_CAP)`
- Keep diagnostics unchanged except that `guardDiagnostics.outputReserveTokens` reports the effective capped reserve.
- For the `contextWindow=272_000`, `maxTokens=128_000` test, assert `outputReserveTokens === 65_536` and `maxObservedInputTokens === Math.floor((272_000 - 65_536 - 8_192) * 0.9)`.

## Verification

- [ ] `derivePiCompileContextGuard` returns `guardDiagnostics.outputReserveTokens === 65_536` for registry metadata `{ provider: 'openai-codex', id: 'gpt-5.5', contextWindow: 272_000, maxTokens: 128_000 }`.
- [ ] The same scenario returns `limits.maxObservedInputTokens > 160_000` and `< Math.floor((272_000 - 8_192) * 0.9)`.
- [ ] A planner live usage event with `input: 124_543` and `total: 124_543` does not throw when the derived capped limits are passed to `createCompileContextGuard`.
- [ ] Registry metadata with `maxTokens: 20_000` returns `guardDiagnostics.outputReserveTokens === 20_000` and uses `20_000` in the expected-limit formula.
- [ ] Missing, synthetic, invalid, and unsafe metadata test cases return positive fallback `limits.maxObservedInputTokens` values and include `fallbackReason` when relevant.
- [ ] An explicit lower `limits.maxObservedInputTokens` value remains the returned limit and appears in `guardDiagnostics.limits.maxObservedInputTokens`.
- [ ] Guard diagnostics in updated tests include `provider`, `modelId`, `metadataSource`, `contextWindow` when known, `outputReserveTokens`, `overheadReserveTokens`, `safetyMargin`, fallback reason when relevant, and resolved `limits`.
- [ ] `pnpm test -- test/pi-compile-context-guard-limits.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `pnpm docs:check` exits 0 after documentation generation if generated docs drift.
