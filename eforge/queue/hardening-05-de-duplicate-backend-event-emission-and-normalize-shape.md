---
title: Hardening 05: De-duplicate Backend Event Emission and Normalize Shape
created: 2026-04-22
---

# Hardening 05: De-duplicate Backend Event Emission and Normalize Shape

## Problem / Motivation

The two production backends (`ClaudeSDKBackend` and `PiBackend`) drift in three places that should be lockstep:

1. **`agent:start` event payload is constructed via near-identical giant inline ternary expressions.** `packages/engine/src/backends/claude-sdk.ts:111` and `packages/engine/src/backends/pi.ts` (around 278, 284, 291) each build the event with duplicated optional-field logic. Adding any new metadata field (e.g., a new runtime decision like thinking budget or effort class) requires editing both backends identically.

2. **Tool-call ID field name inconsistency.** The SDK backend reads `block.id` (`claude-sdk.ts:273`); the Pi backend reads `event.toolCallId` (`pi.ts:185,202`). Both backends normalize to the union's `toolUseId` field at emission, but the mapping is undocumented, so a third backend implementer has to rediscover it.

3. **`agent:usage` emission cadence differs.** SDK emits per-turn via `task_progress` system messages (`claude-sdk.ts:365-381`). Pi accumulates and emits near session end (`pi.ts:545-575`). Consumers aggregating usage for progress displays or cost accounting get different semantics depending on backend.

## Goal

A shared helper for the duplicated event payload; a documented normalization contract for tool-call IDs; a single cadence for `agent:usage` emission that both backends honor.

## Approach

### 1. Extract `buildAgentStartEvent`

Create `packages/engine/src/backends/common.ts` (new file) with:

```ts
export function buildAgentStartEvent(opts: {
  agent: AgentConfig;
  agentId: string;
  backend: 'claude-sdk' | 'pi';
  planId?: string;
  // Plus every optional field currently in the ternary, typed explicitly.
}): Extract<EforgeEvent, { type: 'agent:start' }> {
  return {
    type: 'agent:start',
    agentId: opts.agentId,
    agent: opts.agent.name,
    backend: opts.backend,
    // Conditional fields via spread, not ternary soup.
    ...(opts.planId !== undefined && { planId: opts.planId }),
    ...(opts.agent.model !== undefined && { model: opts.agent.model }),
    // ...etc.
  };
}
```

Replace both backends' inline construction (`claude-sdk.ts:111`, `pi.ts:278/284/291`) with a single call.

Add a unit test that feeds the helper a fixture input and snapshots the event output.

### 2. Document tool-call ID normalization

Add a block comment at the top of `packages/engine/src/backend.ts`:

> All `tool_use` and `tool_result` events published on the `AgentBackend` event stream use `toolUseId` as the stable identifier. Backend implementations are responsible for mapping their provider's native field (`block.id` for the Claude SDK; `toolCallId` for Pi) onto this name before emission. Consumers and the event union should never see provider-specific names.

Extract a small helper in `backends/common.ts`:

```ts
export function normalizeToolUseId(raw: { id?: string; toolCallId?: string }): string {
  const id = raw.id ?? raw.toolCallId;
  if (!id) throw new Error('tool use event missing id/toolCallId');
  return id;
}
```

Consume from both backends. Not strictly necessary (a two-line field swap works), but it makes the normalization visible.

### 3. Align `agent:usage` emission cadence

Decide the contract explicitly. Recommended: **emit `agent:usage` after each assistant turn that reports usage, plus one final cumulative emission at session end.** Rationale: per-turn gives live progress; a final emission gives consumers a single authoritative total.

Update `PiBackend` to emit per-turn usage as each `pi-agent-core` turn resolves (the usage data is available in Pi's turn events - confirm during implementation). Keep the end-of-session emission for the cumulative total.

Update `ClaudeSDKBackend` to additionally emit a final cumulative `agent:usage` at session end if it doesn't already.

Document the contract in `packages/engine/src/events.ts` next to the `agent:usage` variant:

> Emitted after each assistant turn with that turn's usage delta, plus a final cumulative emission at session end identifiable by `final: true`. Consumers that need totals should prefer the final event; consumers that need live progress can aggregate deltas.

Add the `final?: boolean` field to the `agent:usage` event if it isn't already there.

### 4. Verify consumers still aggregate correctly

Check the monitor UI reducer (`packages/monitor-ui/src/lib/reducer.ts`) and any CLI renderer that tracks usage. If they currently assume per-backend semantics, update them to handle the unified contract. With `final: true` as a discriminator, aggregation can be simple: last-wins on `final`, sum deltas otherwise.

## Scope

### In scope

- `packages/engine/src/backends/{common,claude-sdk,pi}.ts` (new + edited)
- `packages/engine/src/{backend,events}.ts` (comment + possibly `final` field)
- `packages/monitor-ui/src/lib/reducer.ts` (usage aggregation)
- `packages/eforge/src/cli/index.ts` (usage rendering, if any)
- Tests: `test/agent-wiring.test.ts`, new `test/backend-common.test.ts`

### Out of scope

- Refactoring the other large methods in `claude-sdk.ts` / `pi.ts` (see PRD 12 for the pipeline.ts refactor; backend bodies can follow if there's appetite).
- Adding a third backend or reworking the `AgentBackend` interface.
- Retry handling inside backends (covered by PRD 06).

## Acceptance Criteria

- `pnpm test` passes - existing agent-wiring tests pass under both backends; new helper test covers `buildAgentStartEvent` and `normalizeToolUseId`.
- `pnpm build` passes.
- A shared `buildAgentStartEvent` helper exists in `packages/engine/src/backends/common.ts` and both `ClaudeSDKBackend` and `PiBackend` construct their `agent:start` event via a single call to it (replacing the inline ternary expressions at `claude-sdk.ts:111` and `pi.ts:278/284/291`).
- A `normalizeToolUseId` helper exists in `backends/common.ts` and is consumed by both backends; a block comment at the top of `packages/engine/src/backend.ts` documents that all `tool_use`/`tool_result` events emitted on the `AgentBackend` event stream use `toolUseId` as the stable identifier, with backends responsible for mapping `block.id` (Claude SDK) or `toolCallId` (Pi) onto it.
- `agent:usage` emission cadence is unified: both backends emit `agent:usage` after each assistant turn that reports usage, plus a final cumulative emission at session end. The final emission is identifiable by `final: true` (field added to the `agent:usage` event if not already present).
- The contract is documented in `packages/engine/src/events.ts` next to the `agent:usage` variant, stating that consumers needing totals should prefer the final event and consumers needing live progress can aggregate deltas.
- The monitor UI reducer (`packages/monitor-ui/src/lib/reducer.ts`) and any CLI usage renderer handle the unified contract: last-wins on `final`, sum deltas otherwise.
- End-to-end: running the same PRD through both `ClaudeSDKBackend` and `PiBackend` produces event streams where `agent:start` and `agent:usage` events have identical shapes and fire at comparable points (verified by diffing the event streams).
- Manual verification: during a build, the monitor UI shows usage ticking up each turn (not only at end) under the Pi backend.
