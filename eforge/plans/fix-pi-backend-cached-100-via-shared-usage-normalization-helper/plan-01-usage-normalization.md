---
id: plan-01-usage-normalization
name: Shared usage normalization helper
depends_on: []
branch: fix-pi-backend-cached-100-via-shared-usage-normalization-helper/usage-normalization
---

# Shared usage normalization helper

## Architecture Context

Two backends (`ClaudeSDKBackend` and `PiBackend`) implement `AgentBackend` directly — there is no shared base class. Both need to emit `EforgeEvent`s containing a `usage` object with the canonical convention `input = uncachedInput + cacheRead + cacheCreation`, so the monitor UI's formula `cacheRead / input` is bounded to `[0, 1]`.

Today claude-sdk inflates `inputTokens` inline (`claude-sdk.ts:303`) while pi reads `session.getSessionStats()` and emits `input: totalInputTokens` without adding cache (`pi.ts:~396, 481, 488`). Pi's `tokens.input` from pi-coding-agent is *uncached input only*, so large cached system prompts drive `cacheRead / input` above 100%.

This plan pushes the convention into a single pure helper module that both backends funnel their raw counters through. The `uncachedInput` parameter name makes it impossible for a caller to accidentally pass a pre-inflated number.

## Implementation

### Overview

1. Create `packages/engine/src/backends/usage.ts` exporting `normalizeUsage(raw)` and `toModelUsageEntry(raw, costUSD)` that take a `RawUsage` shape `{ uncachedInput, output, cacheRead, cacheCreation }`.
2. Rewrite `pi.ts` usage emission sites (live `agent:usage` event, `AgentResultData.usage`, `AgentResultData.modelUsage`) to build `RawUsage` from the pi `SessionStats` counters and route through the helper.
3. Rewrite `claude-sdk.ts` `extractResultData` to collect raw counters per-model, call `toModelUsageEntry` for each model, accumulate raw totals, then call `normalizeUsage` once for the aggregate. Math is numerically identical to today.
4. Add unit tests covering the helper and a pi-backend end-to-end test with stubbed `SessionStats`.

### Key Decisions

1. **Helper module, not abstract base class.** Only two backends share almost nothing structurally (different SDKs, different event shapes). A pure helper is the right granularity; an abstract base class would force unrelated coupling. Out of scope per source.
2. **`uncachedInput` parameter name.** Prevents a caller from accidentally passing a pre-inflated number — the convention is enforced by the parameter name, not just documented.
3. **Types reuse `AgentResultData` shape.** `NormalizedUsage = AgentResultData['usage']` and `ModelUsageEntry = AgentResultData['modelUsage'][string]`, so the helper output is guaranteed to fit the event schema without a parallel type definition.
4. **No changes to `events.ts`, `backend.ts`, or monitor UI.** The UI formula is already correct under the convention; this plan just makes pi comply.

## Scope

### In Scope

- New `packages/engine/src/backends/usage.ts` helper module.
- Refactor of `pi.ts` three usage emission sites to use the helper.
- Refactor of `claude-sdk.ts` `extractResultData` to use the helper.
- Unit tests for `normalizeUsage` / `toModelUsageEntry`.
- Pi-backend test asserting stubbed session stats produce `usage.input` including `cacheRead + cacheWrite`.

### Out of Scope

- `packages/engine/src/backend.ts` — `AgentBackend` interface unchanged.
- `packages/engine/src/events.ts` — schema unchanged.
- `packages/monitor-ui/**` — no UI, reducer, or schema changes.
- Any abstract base class for backends.

## Files

### Create

- `packages/engine/src/backends/usage.ts` — `RawUsage`, `NormalizedUsage`, `ModelUsageEntry` types plus `normalizeUsage` and `toModelUsageEntry` pure functions. Header comment documents the convention `input = uncachedInput + cacheRead + cacheCreation` and states that every backend MUST funnel raw counters through this helper before emitting `agent:usage` or building `AgentResultData`.
- `test/usage.test.ts` — unit tests for the helper:
  - `normalizeUsage({ uncachedInput: 100, output: 50, cacheRead: 500, cacheCreation: 10 })` returns `{ input: 610, output: 50, total: 660, cacheRead: 500, cacheCreation: 10 }`.
  - Invariant: for any non-negative raw inputs, the returned `cacheRead` is `<=` returned `input`.
  - `toModelUsageEntry` maps `uncachedInput/output/cacheRead/cacheCreation` to `inputTokens/outputTokens/cacheReadInputTokens/cacheCreationInputTokens` with `inputTokens` inflated, and passes `costUSD` through unchanged.

### Modify

- `packages/engine/src/backends/pi.ts` — import `normalizeUsage` and `toModelUsageEntry` from `./usage.js`. Replace the three hand-built usage literals:
  - Live `agent:usage` event (around line 396): build `usage` via `normalizeUsage({ uncachedInput: totalInputTokens, output: totalOutputTokens, cacheRead: totalCacheRead, cacheCreation: totalCacheWrite })`.
  - `AgentResultData.usage` (around line 481): same call.
  - `AgentResultData.modelUsage` (around line 488): `toModelUsageEntry({ uncachedInput: totalInputTokens, output: totalOutputTokens, cacheRead: totalCacheRead, cacheCreation: totalCacheWrite }, totalCost)`.
- `packages/engine/src/backends/claude-sdk.ts` — rewrite `extractResultData` (line 291-337) to accumulate raw counters per model, call `toModelUsageEntry` per entry, and call `normalizeUsage` once on the aggregate. Fall back to `result.usage.input_tokens / output_tokens` only when `modelUsage` produced zero totals. Math must be numerically identical to today so existing fixtures still pass.
- `test/pi-backend.test.ts` — add a test that feeds a stubbed `SessionStats` (via the existing pi test scaffolding) with `{ input: 1000, cacheRead: 5000, cacheWrite: 200, output: 500 }` and asserts the emitted `agent:result` has `usage.input === 6200`, `usage.cacheRead === 5000`, `usage.cacheCreation === 200`, `usage.total === 6700`.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm build` exits 0.
- [ ] `pnpm test` exits 0 with `test/sdk-mapping.test.ts` passing unchanged (no fixture edits).
- [ ] `test/usage.test.ts` runs and all cases pass, including `normalizeUsage({uncachedInput:100, output:50, cacheRead:500, cacheCreation:10})` returning `{input:610, output:50, total:660, cacheRead:500, cacheCreation:10}`.
- [ ] New pi-backend test asserts `usage.input === 6200`, `usage.cacheRead === 5000`, `usage.cacheCreation === 200`, `usage.total === 6700` given stubbed stats `{input:1000, cacheRead:5000, cacheWrite:200, output:500}`.
- [ ] `grep -n "inputTokens + cacheRead" packages/engine/src/backends/claude-sdk.ts` returns zero hits (inline inflation arithmetic removed from claude-sdk).
- [ ] `grep -n "input: totalInputTokens" packages/engine/src/backends/pi.ts` returns zero hits (pi no longer emits bare uncached input as the event's `input` field).
- [ ] Both `pi.ts` and `claude-sdk.ts` import from `./usage.js` and each of the three pi call sites plus the single claude-sdk call site route through `normalizeUsage` / `toModelUsageEntry`.
