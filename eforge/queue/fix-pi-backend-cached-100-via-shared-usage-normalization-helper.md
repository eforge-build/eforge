---
title: Fix pi backend cached % > 100% via shared usage normalization helper
created: 2026-04-11
---

# Fix pi backend cached % > 100% via shared usage normalization helper

## Problem / Motivation

The monitor UI shows nonsensical cache percentages (e.g. `185% cached`) for pi-backend builds but not for claude-sdk builds. Root cause: the two backends disagree on what `usage.input` means, and the monitor UI's formula `cacheRead / tokensIn * 100` only works under one of the two conventions.

- **Claude SDK backend** (`packages/engine/src/backends/claude-sdk.ts:291-337`) inflates `inputTokens` to include cached tokens before emitting. Line 303: `inputTokens: usage.inputTokens + cacheRead + cacheCreation`. So `cacheRead ≤ input` always, bounded by 100%.
- **Pi backend** (`packages/engine/src/backends/pi.ts:382-498`) reads `session.getSessionStats()` from pi-coding-agent (confirmed at `dist/core/agent-session.js:2318-2358`), where `tokens.input` is *uncached input only* — `cacheRead` and `cacheWrite` live in separate fields. Pi then emits `input: totalInputTokens` without adding cache tokens. For coding agents that reuse a large cached system prompt, `cacheRead` routinely exceeds the uncached slice, so the % blows past 100.
- **Monitor UI** (`summary-cards.tsx:121`, `thread-pipeline.tsx:862`, `event-card.tsx:151`) divides `cacheRead / inputTokens`.

There is no base backend class today — only the `AgentBackend` interface (`packages/engine/src/backend.ts:75-78`), and both `ClaudeSDKBackend` and `PiBackend` implement it directly. The "input includes cache" convention lives as duplicated arithmetic inside each backend (and pi got it wrong). The fix should push the convention into a single shared helper so neither backend — nor any future backend — can diverge.

## Goal

Funnel all backend token usage through a single shared normalization helper so the canonical convention `input = uncachedInput + cacheRead + cacheCreation` is enforced in one place, eliminating pi's >100% cached rendering and preventing future backends from diverging.

## Approach

Add a pure helper that takes the raw uncached components a backend can compute and returns the canonical `usage` + `modelUsage` shapes that flow through `EforgeEvent`s. Name the inputs unambiguously (`uncachedInput`) so a caller cannot accidentally pass a pre-inflated number.

**New file:** `packages/engine/src/backends/usage.ts`

```ts
import type { AgentResultData } from '../events.js';

/**
 * Canonical usage convention used across the engine and monitor UI:
 *   input  = uncachedInput + cacheRead + cacheCreation   (total input tokens)
 *   total  = input + output
 * This means `cacheRead / input` is always in [0, 1], which is what the
 * monitor UI assumes when rendering "(% cached)".
 *
 * Every backend MUST funnel its raw counters through this helper before
 * emitting `agent:usage` or building `AgentResultData`.
 */

export interface RawUsage {
  uncachedInput: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export type NormalizedUsage = AgentResultData['usage'];
export type ModelUsageEntry = AgentResultData['modelUsage'][string];

export function normalizeUsage(raw: RawUsage): NormalizedUsage {
  const input = raw.uncachedInput + raw.cacheRead + raw.cacheCreation;
  return {
    input,
    output: raw.output,
    total: input + raw.output,
    cacheRead: raw.cacheRead,
    cacheCreation: raw.cacheCreation,
  };
}

export function toModelUsageEntry(raw: RawUsage, costUSD: number): ModelUsageEntry {
  return {
    inputTokens: raw.uncachedInput + raw.cacheRead + raw.cacheCreation,
    outputTokens: raw.output,
    cacheReadInputTokens: raw.cacheRead,
    cacheCreationInputTokens: raw.cacheCreation,
    costUSD,
  };
}
```

### Wire up in `pi.ts`

Replace the three hand-built usage literals with `normalizeUsage` / `toModelUsageEntry`:

- **Live `agent:usage` event (line ~390-405):**
  ```ts
  usage: normalizeUsage({
    uncachedInput: totalInputTokens,
    output: totalOutputTokens,
    cacheRead: totalCacheRead,
    cacheCreation: totalCacheWrite,
  }),
  ```
- **`AgentResultData.usage` (line ~481-487):** same call.
- **`AgentResultData.modelUsage` (line ~488-496):**
  ```ts
  modelUsage: {
    [model.id]: toModelUsageEntry(
      { uncachedInput: totalInputTokens, output: totalOutputTokens, cacheRead: totalCacheRead, cacheCreation: totalCacheWrite },
      totalCost,
    ),
  },
  ```

### Wire up in `claude-sdk.ts`

Rewrite `extractResultData` (line 291-337) to build raw counters first, then normalize:

```ts
function extractResultData(result: SDKResultMessage, resultText?: string): AgentResultData {
  const modelUsage: AgentResultData['modelUsage'] = {};
  let uncachedInput = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreation = 0;

  if (result.modelUsage) {
    for (const [model, usage] of Object.entries(result.modelUsage)) {
      const raw = {
        uncachedInput: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadInputTokens ?? 0,
        cacheCreation: usage.cacheCreationInputTokens ?? 0,
      };
      modelUsage[model] = toModelUsageEntry(raw, usage.costUSD);
      uncachedInput += raw.uncachedInput;
      output += raw.output;
      cacheRead += raw.cacheRead;
      cacheCreation += raw.cacheCreation;
    }
  }

  // Fall back to SDK aggregate if modelUsage was empty
  if (uncachedInput === 0 && output === 0) {
    uncachedInput = result.usage?.input_tokens ?? 0;
    output = result.usage?.output_tokens ?? 0;
  }

  return {
    durationMs: result.duration_ms ?? 0,
    durationApiMs: result.duration_api_ms ?? 0,
    numTurns: result.num_turns ?? 0,
    totalCostUsd: result.total_cost_usd ?? 0,
    usage: normalizeUsage({ uncachedInput, output, cacheRead, cacheCreation }),
    modelUsage,
    resultText,
  };
}
```

The math is identical to today (`claude-sdk.ts:303, 309`) — just routed through the shared helper, so the convention is no longer duplicated.

## Scope

### In scope

**Edit:**
- `packages/engine/src/backends/pi.ts` — three usage emission sites (~line 396, 481, 488).
- `packages/engine/src/backends/claude-sdk.ts` — `extractResultData` (line 291-337).

**Create:**
- `packages/engine/src/backends/usage.ts` — the new helper module.

**Reference — do not edit:**
- `packages/monitor-ui/src/components/common/summary-cards.tsx:111-126` — the rendering site.
- `packages/monitor-ui/src/lib/reducer.ts:145-155, 285-301, 465-480` — aggregation.
- `test/sdk-mapping.test.ts:92-175` — documents the existing claude-sdk convention; should still pass unchanged after the refactor.

### Explicitly out of scope

- `packages/engine/src/backend.ts` — the `AgentBackend` interface stays as-is. No abstract base class: there are only two backends and they share almost nothing structurally (different SDKs, different event-streaming shapes). A helper module is the right granularity.
- `packages/engine/src/events.ts` — schema unchanged; the convention is documented in the `normalizeUsage` header and enforced by the `uncachedInput` parameter name.
- `packages/monitor-ui/**` — no UI, reducer, or schema changes. The UI's formula (`summary-cards.tsx:121`) is already correct under the convention; we're just making pi comply.

## Acceptance Criteria

1. **Type check & build:** `pnpm type-check && pnpm build` in `eforge/` passes.
2. **Existing tests:** `pnpm test` passes. `test/sdk-mapping.test.ts` is the key canary — it asserts `inputTokens = uncached + cacheRead + cacheCreation` across multi-model aggregates, so the claude-sdk refactor must keep passing with zero fixture changes. `test/pi-backend.test.ts` and `test/monitor-reducer.test.ts` stay green.
3. **New unit tests** added to `test/sdk-mapping.test.ts` or a new `test/usage.test.ts`:
   - `normalizeUsage` happy path: `{uncachedInput: 100, output: 50, cacheRead: 500, cacheCreation: 10}` → `{input: 610, output: 50, total: 660, cacheRead: 500, cacheCreation: 10}`.
   - Invariant: `cacheRead ≤ input` for any non-negative raw input.
   - Pi-backend test: feed a stubbed `SessionStats` with `{ input: 1000, cacheRead: 5000, cacheWrite: 200, output: 500 }` and assert the emitted `agent:result` has `usage.input === 6200`, `usage.cacheRead === 5000`, `usage.total === 6700`.
4. **Manual end-to-end:** rebuild the daemon (`eforge-daemon-restart` skill), trigger the same openrouter pi-backend eval. The monitor UI summary card shows a cached % in `[0, 100]`. Total token count is visibly larger for pi builds (now includes cached reads) — this is the intended correction and brings pi in line with how claude-sdk already renders.
