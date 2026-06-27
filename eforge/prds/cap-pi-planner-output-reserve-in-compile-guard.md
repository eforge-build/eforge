---
title: Cap Pi Planner Output Reserve in Compile Guard
created: 2026-06-27
---

# Cap Pi Planner Output Reserve in Compile Guard

## Problem / Motivation

The Pi compile context guard currently reserves the model’s full `maxTokens` value when deriving the planner-family input-token budget. For very large-output models, this can make the live guard stricter than the old static `160,000`-token limit and reject otherwise acceptable compile prompts.

A recorded retry failed with:

- `contextWindow=272000`
- `outputReserveTokens=128000`
- `overheadReserveTokens=8192`
- `safetyMargin=0.9`
- Derived `maxObservedInputTokens=122227`
- Observed per-turn input tokens: `124,543`

Reproduction arithmetic:

```text
floor((272000 - 128000 - 8192) * 0.9) = 122227
```

The live context guard fails solely because `124,543` exceeds `122,227`, even though the prior static guard was `160,000` and a capped `64 Ki` output reserve would derive roughly `178k` input tokens.

Root cause: `derivePiCompileContextGuard` in `packages/engine/src/harnesses/pi-model-resolution.ts` treats valid model `maxTokens` metadata as the full compile output reserve. That is reasonable for normal output limits, but for planner-family compile stages a `128k` output allowance is overly conservative because the planner prompt needs a large input budget and does not need to reserve the entire model output maximum.

## Goal

Change the Pi model-aware compile context guard so planner-family output reserves are capped before deriving `maxObservedInputTokens`.

The fix should let large-output planner models retain a useful large-context input budget without removing safety margin or fallback protections.

## Approach

- Localize the implementation to `packages/engine/src/harnesses/pi-model-resolution.ts`.
- Introduce a named documented cap or helper for the planner-family output reserve.
- Assume a `64 Ki` token cap is the intended planner-family reserve unless implementation review uncovers an existing project constant or documented policy.
- Cap large model `maxTokens` values before computing `maxObservedInputTokens`.
- Keep models with normal `maxTokens` below the cap using their actual output metadata in the formula.
- Preserve conservative fallback behavior for missing, synthetic, invalid, or unsafe metadata.
- Update `test/pi-compile-context-guard-limits.test.ts` for large cap, below-cap, fallback, and override cases.
- Document diagnostic interpretation in troubleshooting docs, including that `outputReserveTokens` reflects the capped effective reserve.

## Scope

In scope:

- `packages/engine/src/harnesses/pi-model-resolution.ts`
- Pi compile context guard-limit tests
- Documentation for diagnostics and reserve interpretation
- The `openai-codex/gpt-5.5`-style scenario with `contextWindow=272000` and `maxTokens=128000`
- Small/unknown model behavior
- Explicit lower override behavior

Out of scope:

- Daemon/client event shape changes
- Generic non-Pi guard behavior changes
- Plugin command changes
- Recovery workflow changes

## Acceptance Criteria

- `derivePiCompileContextGuard` caps large planner-family model `maxTokens` values before computing `maxObservedInputTokens`.
- The planner-family output reserve cap is represented by a named documented constant or helper in `packages/engine/src/harnesses/pi-model-resolution.ts`.
- For metadata equivalent to `provider=openai-codex`, `modelId=gpt-5.5`, `contextWindow=272000`, and `maxTokens=128000`, the derived `maxObservedInputTokens` is greater than `160000`.
- For metadata equivalent to `provider=openai-codex`, `modelId=gpt-5.5`, `contextWindow=272000`, and `maxTokens=128000`, the derived `maxObservedInputTokens` is below the full context window after overhead reserve and safety margin.
- A planner turn with `124543` observed input tokens does not fail solely because `128000` model output tokens were treated as the effective reserve.
- Models with valid `maxTokens` values below the planner-family reserve cap use their actual output metadata in the formula.
- Missing model metadata falls back conservatively and does not derive a non-positive limit.
- Synthetic model metadata falls back conservatively and does not derive a non-positive limit.
- Invalid model metadata falls back conservatively and does not derive a non-positive limit.
- Unsafe model metadata falls back conservatively and does not derive a non-positive limit.
- Guard diagnostics include `provider`.
- Guard diagnostics include `modelId`.
- Guard diagnostics include `metadataSource`.
- Guard diagnostics include `contextWindow` when known.
- Guard diagnostics include `outputReserveTokens`.
- Guard diagnostics include `overheadReserveTokens`.
- Guard diagnostics include `safetyMargin`.
- Guard diagnostics include `fallbackReason` when relevant.
- Guard diagnostics include resolved limits.
- Guard diagnostic `outputReserveTokens` reflects the capped effective reserve.
- Explicit user-supplied lower `maxObservedInputTokens` overrides remain honored.
- `test/pi-compile-context-guard-limits.test.ts` covers the large capped-reserve case.
- `test/pi-compile-context-guard-limits.test.ts` covers the below-cap metadata case.
- `test/pi-compile-context-guard-limits.test.ts` covers fallback behavior.
- `test/pi-compile-context-guard-limits.test.ts` covers explicit lower override behavior.
- `pnpm test -- test/pi-compile-context-guard-limits.test.ts` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.
- If documentation is edited, `pnpm docs:check` exits 0.
- If the full test suite is run, `pnpm test` exits 0.

## Manual Verification Notes

N/A