---
id: plan-01-opus-4-7-config
name: Opus 4.7 Per-Role Effort Defaults, Capability Split, and Thinking Coercion
depends_on: []
branch: configure-eforge-for-claude-opus-4-7/opus-4-7-config
agents:
  builder:
    effort: high
    rationale: Multi-file change across engine types, resolver, capabilities,
      backend, and tests - needs careful coordination to keep types consistent
---

# Opus 4.7 Per-Role Effort Defaults, Capability Split, and Thinking Coercion

## Architecture Context

eforge drives Claude agents across multiple roles (planner, builder, reviewer, etc.). Currently all roles share implicit defaults with no per-role effort differentiation, Opus 4.6 and 4.7 share one capability entry, and the SDK adapter passes `thinking: { type: 'enabled', budgetTokens: N }` verbatim to models that don't support fixed-budget thinking.

This plan adds three capabilities:
1. Per-role effort defaults in `AGENT_ROLE_DEFAULTS` so different role tiers get appropriate effort levels
2. Split capability entries so Opus 4.7 carries its own `thinkingMode: 'adaptive-only'` flag
3. Thinking coercion in `resolveAgentConfig` that downgrades `enabled` thinking to `adaptive` when the model doesn't support fixed budgets

All changes follow the existing effort-clamping pattern in `resolveAgentConfig` (pipeline.ts:645-656). Provenance fields (`thinkingCoerced`, `thinkingOriginal`) mirror the existing `effortClamped`/`effortOriginal` pattern.

## Implementation

### Overview

Extend the engine's config resolution layer with per-role effort defaults, a new `thinkingMode` capability field, and thinking coercion logic. Update types across `config.ts`, `backend.ts`, `events.ts`, and `model-capabilities.ts`. Update the planner's Zod schema description to document the effort escalation lever.

### Key Decisions

1. **Thinking coercion happens in `resolveAgentConfig`, not in the SDK adapter.** This parallels effort clamping (pipeline.ts:645-656) and keeps the SDK adapter as a thin pass-through. The resolver already has access to the resolved model ID and is the single place where model-aware adjustments are applied.
2. **`thinkingMode` is a capability field, not a standalone config.** Adding it to `ModelCapabilities` lets the coercion logic use `lookupCapabilities()` - the same function effort clamping uses. No new lookup infrastructure needed.
3. **Per-role effort defaults use existing `AGENT_ROLE_DEFAULTS` mechanism.** The resolver already checks `builtinRoleDefaults[field]` at priority level 4 (below plan override, user per-role, user global). Adding `effort` to existing entries and creating new entries is a mechanical extension.
4. **New provenance fields follow the `effortClamped`/`effortOriginal` pattern exactly.** `thinkingCoerced: boolean` and `thinkingOriginal: ThinkingConfig` are added to `ResolvedAgentConfig`, `AgentRunOptions`, `agent:start` event, and `NON_SDK_KEYS`.

## Scope

### In Scope
- Per-role effort defaults in `AGENT_ROLE_DEFAULTS` for all role tiers (inner planning: `high`, heavyweight execution: `high`, scoped fixes: `medium`, mechanical/supportive: `medium`)
- Split Opus 4.6 and 4.7 into separate capability entries with distinct labels
- `thinkingMode?: 'budgeted' | 'adaptive-only'` field on `ModelCapabilities`
- Thinking coercion in `resolveAgentConfig`: when model has `thinkingMode: 'adaptive-only'` and resolved thinking is `{ type: 'enabled' }`, coerce to `{ type: 'adaptive' }`
- Provenance tracking: `thinkingCoerced`, `thinkingOriginal` fields on `ResolvedAgentConfig`, `AgentRunOptions`, `agent:start` event
- Planner Zod schema description update for effort escalation guidance
- Planner prompt update with explicit `xhigh` usage guidance
- Tests for all new behavior

### Out of Scope
- Fixing provenance field propagation from agent runners to backend (peppy-sunbeam scope - agent runners currently strip provenance via `pickSdkOptions`)
- Per-role prompt nudges keyed by model (deferred per PRD step 5)
- Changing `MODEL_CLASS_DEFAULTS['claude-sdk'].max` (already points to `claude-opus-4-7`; no change needed)
- Monitor UI tooltip changes (peppy-sunbeam scope)

## Files

### Modify
- `packages/engine/src/model-capabilities.ts` - Add `thinkingMode?: 'budgeted' | 'adaptive-only'` to `ModelCapabilities` interface (line 20). Split the combined Opus 4.6/4.7 entry (line 53-60) into two separate entries: Opus 4.7 first (with `thinkingMode: 'adaptive-only'`) then Opus 4.6 (without). Order matters because first regex match wins.
- `packages/engine/src/config.ts` - Add `thinkingCoerced?: boolean` and `thinkingOriginal?: import('./backend.js').ThinkingConfig` to `ResolvedAgentConfig` interface (after line 255, parallel to existing `effortClamped`/`effortOriginal`).
- `packages/engine/src/backend.ts` - Add `thinkingCoerced?: boolean` and `thinkingOriginal?: import('./backend.js').ThinkingConfig` to `AgentRunOptions` (after line 101). Add `'thinkingCoerced'` and `'thinkingOriginal'` to `NON_SDK_KEYS` set (line 39).
- `packages/engine/src/events.ts` - Add `thinkingCoerced?: boolean; thinkingOriginal?: object` to the `agent:start` event type (line 231).
- `packages/engine/src/pipeline.ts` - (a) Add `effort` field to existing `AGENT_ROLE_DEFAULTS` entries and add new entries for roles not currently listed (lines 412-419). Full table: `planner: { effort: 'high' }`, `builder: { maxTurns: 50, effort: 'high' }`, `module-planner: { maxTurns: 20, effort: 'high' }`, `architecture-reviewer: { effort: 'high' }`, `architecture-evaluator: { effort: 'high' }`, `cohesion-reviewer: { effort: 'high' }`, `cohesion-evaluator: { effort: 'high' }`, `plan-reviewer: { effort: 'high' }`, `plan-evaluator: { effort: 'high' }`, `reviewer: { effort: 'high' }`, `evaluator: { effort: 'high' }`, `review-fixer: { effort: 'medium' }`, `validation-fixer: { effort: 'medium' }`, `merge-conflict-resolver: { effort: 'medium' }`, `doc-updater: { maxTurns: 20, effort: 'medium' }`, `test-writer: { maxTurns: 30, effort: 'medium' }`, `tester: { maxTurns: 40, effort: 'medium' }`, `gap-closer: { maxTurns: 20, effort: 'medium' }`. (b) Add import of `lookupCapabilities` from `./model-capabilities.js` (existing import of `clampEffort` is on same line). (c) After the effort clamping block (line 656), add thinking coercion block: if `result.thinking?.type === 'enabled'`, look up capabilities for the resolved model, and if `caps?.thinkingMode === 'adaptive-only'`, set `result.thinkingOriginal = result.thinking`, `result.thinking = { type: 'adaptive' }`, `result.thinkingCoerced = true`.
- `packages/engine/src/backends/claude-sdk.ts` - Add `thinkingCoerced` and `thinkingOriginal` conditional spreads to the `agent:start` event yield (line 48), following the existing pattern for `effortClamped`/`effortOriginal`.
- `packages/engine/src/schemas.ts` - Update the `effortLevelForTuningSchema` description (line 157-158) from `'Effort level for controlling thinking depth'` to `'Effort level for thinking depth. Set xhigh only for modules with significant ambiguity, novel API design, or large refactors. Omit to use the role default.'`.
- `packages/engine/src/prompts/planner.md` - In the "Per-Plan Agent Tuning" section (around line 357-361), add a bullet to the Guidelines: `- Use \`xhigh\` sparingly - only for plans with significant ambiguity, novel API design, complex multi-system refactors, or genuinely hard decomposition problems. The engine sets sensible per-role defaults; most plans should not override effort.`
- `test/model-capabilities.test.ts` - Add tests: (a) Opus 4.6 and 4.7 return separate capability entries with distinct labels. (b) Opus 4.7 entry has `thinkingMode: 'adaptive-only'`. (c) Opus 4.6 entry does NOT have `thinkingMode: 'adaptive-only'`. (d) Both entries support the full effort range including `xhigh` and `max`.
- `test/agent-wiring.test.ts` - Add tests: (a) For each role in the effort table, when no user config or plan override sets effort, `resolveAgentConfig` returns the expected default effort from `AGENT_ROLE_DEFAULTS` and `effortSource: 'default'`. (b) When `thinking: { type: 'enabled', budgetTokens: 10000 }` is configured and model is `claude-opus-4-7`, the resolved thinking is `{ type: 'adaptive' }`, `thinkingCoerced` is `true`, and `thinkingOriginal` is `{ type: 'enabled', budgetTokens: 10000 }`. (c) When `thinking: { type: 'enabled' }` is configured and model is `claude-opus-4-6`, thinking passes through unchanged and `thinkingCoerced` is undefined. (d) When `thinking: { type: 'adaptive' }` is configured and model is `claude-opus-4-7`, thinking passes through unchanged (adaptive is already the target). (e) When thinking is undefined, no coercion occurs regardless of model.

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing tests plus new tests
- [ ] `lookupCapabilities('claude-opus-4-7')` returns an entry with `label: 'Opus 4.7'` and `thinkingMode: 'adaptive-only'`
- [ ] `lookupCapabilities('claude-opus-4-6')` returns an entry with `label: 'Opus 4.6'` and no `thinkingMode` (or `undefined`)
- [ ] `resolveAgentConfig('builder', defaultConfig, 'claude-sdk')` returns `effort: 'high'` and `effortSource: 'default'` when no user config sets effort
- [ ] `resolveAgentConfig('doc-updater', defaultConfig, 'claude-sdk')` returns `effort: 'medium'` and `effortSource: 'default'` when no user config sets effort
- [ ] `resolveAgentConfig('review-fixer', defaultConfig, 'claude-sdk')` returns `effort: 'medium'` and `effortSource: 'default'` when no user config sets effort
- [ ] When config has `thinking: { type: 'enabled', budgetTokens: 10000 }` and model is `claude-opus-4-7`, `resolveAgentConfig` returns `thinking: { type: 'adaptive' }`, `thinkingCoerced: true`, `thinkingOriginal: { type: 'enabled', budgetTokens: 10000 }`
- [ ] When config has `thinking: { type: 'enabled' }` and model is `claude-opus-4-6`, `resolveAgentConfig` returns `thinking: { type: 'enabled' }` with `thinkingCoerced` undefined
- [ ] User per-role effort config (`agents.roles.builder.effort: 'xhigh'`) overrides the built-in default and sets `effortSource: 'role-config'`
- [ ] Plan override effort (`planEntry.agents.builder.effort: 'max'`) overrides both user config and built-in default