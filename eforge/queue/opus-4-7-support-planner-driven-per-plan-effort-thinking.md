---
title: Opus 4.7 support + planner-driven per-plan effort/thinking
created: 2026-04-17
---

# Opus 4.7 support + planner-driven per-plan effort/thinking

## Problem / Motivation

Anthropic released Opus 4.7 on 2026-04-16 with a new higher reasoning tier. Claude Agent SDK 0.2.112 now types `EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`, documenting `'max'` as "Opus 4.6/4.7 only". pi-ai 0.67.6 uses `ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`, where `xhigh` maps to adaptive-max on Opus 4.6+.

eforge's current state has two gaps:

1. **Schema/backend drift.** `effortLevelSchema` is `['low', 'medium', 'high', 'max']` - missing `'xhigh'`. The Pi backend collapses `'low' -> 'off'`, `'max' -> 'high'`, and ignores `'minimal'` and `'xhigh'` entirely (`packages/engine/src/backends/pi.ts:72-79`). Users can't reach Opus 4.7's top tier through either backend today.
2. **No runtime per-plan judgment.** Effort/thinking are resolved statically from `config.agents.roles[role]` once per agent invocation (`resolveAgentConfig` in `packages/engine/src/pipeline.ts:492`). A trivial rename plan and a load-bearing refactor run at the same cost. The planner has all the signal to judge complexity but doesn't emit it.

## Goal

Widen the static surface so Opus 4.7's full range is reachable via config, AND let the planner embed a per-plan complexity assessment in each plan file's frontmatter that downstream build-stage agents (builder, reviewer, review-fixer, evaluator) pick up at runtime. Model-specific nudges (e.g., clamping `'max'` to a valid value on non-Opus-4.6+ models) live in a data-driven capability map, not in prompt text. Every runtime decision must be visible in the monitor UI.

## Approach

Hybrid. Static config is the source of truth for defaults; planner output is an optional per-plan override layered on top during `resolveAgentConfig`; a model-capability map clamps invalid combinations at resolve time; the monitor UI surfaces the final resolved values next to the model on stage hover.

### Part 1 - Widen schema and fix backend mappings

**`packages/engine/src/config.ts` (line 53):**
- Extend `effortLevelSchema` to `z.enum(['low', 'medium', 'high', 'xhigh', 'max'])`.
- Keep `ThinkingConfig` shape unchanged (already aligned with SDK 0.2.112).

**`packages/engine/src/backends/backend.ts` (lines 10-28):**
- Update `EffortLevel` type to match the new enum.

**`packages/engine/src/backends/pi.ts` (lines 56-79):**
- Rewrite `mapThinkingConfig` and `mapEffortLevel` to cover pi-ai's full `ThinkingLevel` range:
  - `ThinkingConfig`: `'disabled' -> 'off'`, `'adaptive' -> 'medium'`, `'enabled' -> 'high'`.
  - `EffortLevel`: `'low' -> 'low'`, `'medium' -> 'medium'`, `'high' -> 'high'`, `'xhigh' -> 'xhigh'`, `'max' -> 'xhigh'` (pi-ai has no `'max'`; its `xhigh` is adaptive-max for Opus 4.6+, matching semantics).
- No changes needed to `packages/engine/src/backends/claude-sdk.ts`; it already passes `effort` through conditionally (lines 100-101) and SDK 0.2.112 accepts the new values natively.

**`packages/engine/src/config.ts` PiConfig section (lines 106-110):**
- Widen `pi.thinkingLevel` enum to pi-ai's full range so profile YAMLs can specify `xhigh` directly.

### Part 2 - Model capability map (data-driven nudges)

New file: **`packages/engine/src/model-capabilities.ts`**

A plain data table, not a prompt. Keyed by model id (or id prefix), with fields that describe what the model supports:

```ts
export interface ModelCapabilities {
  supportedEffort: EffortLevel[];   // values the model actually accepts
  defaultEffort?: EffortLevel;      // recommended default for this model
  maxThinking?: ThinkingLevel;      // for pi-backed models
  // Future: tool allowlist nudges, context window, etc.
}

export const MODEL_CAPABILITIES: ReadonlyArray<{ match: RegExp; caps: ModelCapabilities }> = [
  { match: /^claude-opus-4-[67]/,   caps: { supportedEffort: ['low','medium','high','xhigh','max'], defaultEffort: 'high' } },
  { match: /^claude-opus-4(\.|-)/,  caps: { supportedEffort: ['low','medium','high'],               defaultEffort: 'high' } },
  { match: /^claude-sonnet-4/,      caps: { supportedEffort: ['low','medium','high','xhigh'],       defaultEffort: 'high' } },
  { match: /^claude-haiku-4/,       caps: { supportedEffort: ['low','medium','high'],               defaultEffort: 'medium' } },
];

export function lookupCapabilities(modelId: string): ModelCapabilities | undefined { ... }

export function clampEffort(modelId: string, requested: EffortLevel | undefined): { value: EffortLevel | undefined; clamped: boolean } { ... }
```

`clampEffort` returns the input when valid, or the highest supported level `<=` requested when not (e.g., `'max'` on Sonnet clamps to `'xhigh'`; `'max'` on Haiku clamps to `'high'`). The `clamped` flag flows to events so the monitor UI can mark it.

This map is the seam for onboarding new models: when Opus 4.8 ships, we edit one entry here; prompts don't change.

### Part 3 - Planner emits per-plan effort/thinking (prompt stays model-agnostic)

**`packages/engine/src/schemas.ts` (line 156, `planFileFrontmatterSchema`):**
- Add optional `agents` field covering every per-plan build-stage agent the planner is allowed to tune:
  ```ts
  agents: z.object({
    builder: agentTuningSchema.optional(),
    reviewer: agentTuningSchema.optional(),
    'review-fixer': agentTuningSchema.optional(),
    evaluator: agentTuningSchema.optional(),
    'doc-updater': agentTuningSchema.optional(),
    'test-writer': agentTuningSchema.optional(),
    tester: agentTuningSchema.optional(),
  }).optional().describe('Per-agent effort/thinking overrides derived from plan complexity'),
  ```
- These seven roles correspond exactly to Group A in Part 4.
- Define `agentTuningSchema = z.object({ effort: effortLevelSchema.optional(), thinking: thinkingConfigSchema.optional(), rationale: z.string().optional() })`.
- Re-export through `planSetSubmissionPlanSchema` (line 308) so the planner's structured output can emit it.

**Planner prompt (located via `loadPrompt('planner', ...)` in `packages/engine/src/agents/planner.ts:173`):**
- Describe the assessment task in purely model-agnostic terms: "For each plan, assess complexity and assign effort/thinking for builder/reviewer/review-fixer/evaluator when the plan is notably harder or easier than a typical change. Omit the field to inherit the global default. Use the full enum (`low`, `medium`, `high`, `xhigh`, `max`) - the engine clamps to what the selected model supports."
- Do not name Opus, Sonnet, Haiku, 4.6, or 4.7. No model-specific guidance in the prompt. If guidance ever needs to vary by model, it belongs in `model-capabilities.ts` (Part 2), not here.

**`packages/engine/src/plan.ts` (lines 135-163, `parsePlanFile`):**
- Read `agents` off frontmatter, validate via the new schema, attach to `PlanFile`. Malformed block logs a warning and is dropped; does not block the build.

**`packages/engine/src/events.ts`:**
- `PlanFile` (line 43): add `agents?: PerPlanAgentTuning`.
- `OrchestrationConfig.plans` entry (line 53): same field, propagated by `parseOrchestrationConfig` (line 178).

### Part 4 - Runtime override + clamping in resolveAgentConfig

**`packages/engine/src/pipeline.ts` (line 492, `resolveAgentConfig`):**
- Add optional `planEntry?: { agents?: PerPlanAgentTuning }` parameter.
- Precedence for `effort`/`thinking`: **planEntry override -> user per-role -> user global -> built-in per-role -> built-in global**. Other fields are unaffected.
- After resolving the raw value, pass it through `clampEffort(resolvedModelId, effort)` from `model-capabilities.ts`. Record `effortClamped: boolean` and `effortOriginal?: EffortLevel` on the returned config so events can surface the clamp.
- Extend `ResolvedAgentConfig` (`config.ts:233`) with the two new fields.

**Complete call-site census.** `resolveAgentConfig` has 18 non-test call sites. They split three ways:

**A. Per-plan build-stage (receive `planEntry` override AND clamp AND event enrichment):**
- pipeline.ts:1340 `builder`
- pipeline.ts:1478 `reviewer`
- pipeline.ts:1530 `evaluator`
- pipeline.ts:1603 `review-fixer`
- pipeline.ts:1687 `doc-updater`
- pipeline.ts:1731 `test-writer`
- pipeline.ts:1783 `tester`

All of these run inside a `BuildStageContext` with `ctx.planId` in scope. Lift `ctx.orchConfig.plans.find(p => p.id === ctx.planId)` (pattern near line 1343) into a single `ctx.planEntry` property populated once per build stage so all seven sites consume the same object.

**B. Compile-time (no plan exists yet - static config + clamp + event enrichment only):**
- pipeline.ts:718 `pipeline-composer`
- pipeline.ts:747 `planner`
- pipeline.ts:887 `plan-reviewer`
- pipeline.ts:888 `plan-evaluator`
- pipeline.ts:960 `architecture-reviewer`
- pipeline.ts:961 `architecture-evaluator`
- pipeline.ts:1025 `module-planner`
- pipeline.ts:1134 `cohesion-reviewer`
- pipeline.ts:1135 `cohesion-evaluator`
- eforge.ts:841 `staleness-assessor`

These run before plan files exist, so the planner's frontmatter cannot reach them. They still benefit from the model-capability clamp and must emit the enriched `agent:start` payload.

**C. Run-level post-build (no plan context - static config + clamp + event enrichment only):**
- eforge.ts:365 `formatter`
- eforge.ts:400 `dependency-detector`
- eforge.ts:568 `validation-fixer`
- eforge.ts:602 `merge-conflict-resolver`
- eforge.ts:661 `prd-validator`
- eforge.ts:700 `gap-closer`
- agents/gap-closer.ts:55 `gap-closer` (nested call; same treatment as 700)

These pass their `resolveAgentConfig` call through unchanged except the new `planEntry` parameter stays `undefined`. Clamping and event enrichment apply uniformly.

**Summary of what every call site gets:**

| Behavior                       | Group A (per-plan) | Group B (compile) | Group C (run-level) |
| ------------------------------ | :----------------: | :---------------: | :-----------------: |
| planEntry override             | yes                | n/a (no plans)    | n/a                 |
| model-capability clamp         | yes                | yes               | yes                 |
| enriched `agent:start` payload | yes                | yes               | yes                 |

The only structural change to non-Group-A sites is passing `undefined` for the new parameter; no behavior regression.

### Part 5 - Emit effort/thinking on agent:start events

**`packages/engine/src/events.ts` (line 230, `agent:start`):**
- Extend payload to include `effort?: EffortLevel`, `thinking?: ThinkingConfig`, `effortClamped?: boolean`, `effortOriginal?: EffortLevel`, `effortSource?: 'planner' | 'role-config' | 'global-config' | 'default'`.

**Both backends** (`backends/pi.ts`, `backends/claude-sdk.ts`):
- When yielding `agent:start`, include the resolved effort/thinking/source fields. The values are already available in the call path (they were passed into the backend's `run()` via `AgentRunOptions`).

### Part 6 - Monitor UI: surface decisions in stage hover

**`packages/monitor-ui/src/lib/reducer.ts` (lines 12-26, `AgentThread`):**
- Add `effort?: string`, `thinking?: string`, `effortClamped?: boolean`, `effortOriginal?: string`, `effortSource?: string`.
- In the `agent:start` handler (around line 263), populate these from the new event fields.

**`packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` (lines 827-868, `PlanRow` tooltip):**
- Under the existing model line (851), add rendering for effort and thinking when present:
  - `effort` with a small source badge (`planner` | `config` | `default`) and a clamp indicator when `effortClamped` is true (e.g., "xhigh (clamped from max)").
  - `thinking` rendered as a short phrase for `{ type: 'enabled', budgetTokens }` / `'adaptive'` / `'disabled'`.
- Follow the existing tooltip pattern (opacity-50 / text-[10px] for secondary text). Use shadcn/ui primitives already in place; no new components needed.

### Part 7 - Tests

**`test/agent-wiring.test.ts`:**
- planEntry override wins over per-role config.
- Missing planEntry falls back to current behavior.
- `'xhigh'` and `'max'` flow through to `StubBackend` options verbatim on claude-sdk when the model supports them.
- Pi backend maps `'max' -> 'xhigh'` and `'xhigh' -> 'xhigh'`.
- `clampEffort` clamps `'max'` to `'xhigh'` on a Sonnet-shaped model id and to `'high'` on a Haiku-shaped id, with `clamped: true` reflected in the resolved config.

**`test/plan.test.ts`:**
- Round-trip: planner frontmatter with `agents:` block -> `parsePlanFile` -> `OrchestrationConfig` -> `resolveAgentConfig` produces expected precedence + clamp behavior.

**`test/model-capabilities.test.ts` (new):**
- Unit tests for `lookupCapabilities` and `clampEffort` across known model ids plus an unknown id (passthrough without clamp).

No backend implementation tests (per AGENTS.md, those are integration-level).

## Scope

### In scope

- Widening `effortLevelSchema` to `['low', 'medium', 'high', 'xhigh', 'max']`
- Rewriting Pi backend `mapThinkingConfig` and `mapEffortLevel` to cover pi-ai's full range
- Widening `pi.thinkingLevel` enum in PiConfig to pi-ai's full range
- New `packages/engine/src/model-capabilities.ts` with data-driven capability/clamp map
- Extending `planFileFrontmatterSchema` with optional `agents` tuning block (seven roles: builder, reviewer, review-fixer, evaluator, doc-updater, test-writer, tester)
- Model-agnostic planner prompt additions for complexity assessment
- `parsePlanFile` reading and validating the `agents` frontmatter block
- `PlanFile` and `OrchestrationConfig` event types gaining `agents` field
- `resolveAgentConfig` gaining `planEntry` parameter with precedence: planEntry override -> user per-role -> user global -> built-in per-role -> built-in global
- Model-capability clamping after effort resolution with `effortClamped` and `effortOriginal` on `ResolvedAgentConfig`
- Lifting `ctx.orchConfig.plans.find(...)` into a `ctx.planEntry` property for all 7 Group A call sites
- Enriched `agent:start` event payload with effort, thinking, clamped, original, and source fields
- Monitor UI `AgentThread` fields and `agent:start` handler updates
- Monitor UI tooltip rendering for effort/thinking/source/clamp in `PlanRow`
- Tests in `agent-wiring.test.ts`, `plan.test.ts`, and new `model-capabilities.test.ts`

### Critical files

- `packages/engine/src/config.ts` - schema widening + `ResolvedAgentConfig` additions
- `packages/engine/src/backends/backend.ts` - `EffortLevel` type
- `packages/engine/src/backends/pi.ts` - full mapping rewrite, event enrichment
- `packages/engine/src/backends/claude-sdk.ts` - event enrichment only
- `packages/engine/src/model-capabilities.ts` (new) - data-driven capability/clamp map
- `packages/engine/src/schemas.ts` - `planFileFrontmatterSchema` + submission schema
- `packages/engine/src/events.ts` - `PlanFile`, `OrchestrationConfig`, `agent:start` payload
- `packages/engine/src/plan.ts` - parsers
- `packages/engine/src/pipeline.ts` - `resolveAgentConfig` signature + clamp + 17 call sites (7 per-plan get `ctx.planEntry`; 10 compile/run-level pass `undefined`)
- `packages/engine/src/eforge.ts` - 7 run-level `resolveAgentConfig` call sites (pass `undefined` for `planEntry`; still get clamp + enriched events)
- `packages/engine/src/agents/gap-closer.ts:55` - nested gap-closer call site, same treatment
- `packages/engine/src/agents/planner.ts` + planner prompt template - model-agnostic assessment instructions
- `packages/monitor-ui/src/lib/reducer.ts` - `AgentThread` fields + `agent:start` handler
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` - tooltip content
- `test/agent-wiring.test.ts`, `test/plan.test.ts`, `test/model-capabilities.test.ts`

### Out of scope

- `AGENT_ROLE_DEFAULTS` (pipeline.ts:409) - built-in defaults stay empty for effort/thinking so user config and planner overrides remain visible.
- Pi `thinkingLevel` semantics beyond widening the enum - no remap of existing user configs.
- Backend profile YAMLs under `eforge/backends/` - they keep `effort: high` as the default; users opt into `xhigh`/`max` explicitly.
- CHANGELOG - release flow owns that.
- Plugin-side skill changes - CLI/MCP surfaces don't expose effort/thinking; config-file, planner-output, and monitor-hover are the touchpoints.
- Backend implementation tests (per AGENTS.md, those are integration-level).

## Acceptance Criteria

1. `pnpm type-check && pnpm test` passes - schema, mapping, clamp, and resolution tests all green.
2. `pnpm build` compiles successfully.
3. Integration sanity: a PRD mixing a trivial plan (rename a variable) with a hard plan (refactor an abstraction), run via `pnpm dev -- build <prd>.md` on the claude-sdk profile, produces plan files where the hard plan has `agents.builder.effort: xhigh` (or `max`) and the trivial plan omits or downgrades effort. `agent:start` event payloads (via daemon log tail or monitor SSE stream) include `effort`, `thinking`, and `effortSource`.
4. Monitor UI: hovering a builder stage during a run shows effort, thinking, and source under the model line. On a run against a non-Opus-4.6+ model where the planner asked for `'max'`, the clamp indicator ("xhigh (clamped from max)") renders.
5. Pi backend: swapping to a Pi backend profile and re-running confirms `'max' -> 'xhigh'` mapping reaches pi-ai's `thinkingLevel` without throwing, and the monitor reflects the mapped value.
6. Manual plan-file override: editing a plan's frontmatter `agents.builder.effort` and re-running the build from the existing `orchestration.yaml` produces the user override winning, with the monitor showing `effortSource` reflecting the override source (not `planner`).
7. `clampEffort` clamps `'max'` to `'xhigh'` on Sonnet-shaped model ids, to `'high'` on Haiku-shaped model ids, and passes through on Opus 4.6/4.7-shaped model ids, all with correct `clamped` flag.
8. Malformed `agents` block in plan frontmatter logs a warning and is dropped without blocking the build.
9. All 18 non-test `resolveAgentConfig` call sites emit enriched `agent:start` payloads (Group A with planEntry override, Groups B and C with `undefined` planEntry but still receiving clamp and event enrichment).
10. No model-specific names (Opus, Sonnet, Haiku, version numbers) appear in any prompt text; model-specific behavior is confined to `model-capabilities.ts`.
