---
title: Eval Signal Enrichment + Analysis Skill
created: 2026-03-28
status: pending
---

# Eval Signal Enrichment + Analysis Skill

## Problem / Motivation

The `build:evaluate:complete` event currently emits only `{ accepted: number, rejected: number }`, even though parsed verdicts (with `file`, `action`, `reason`) are already available in `builder.ts` at line 189. This means the eval harness lacks the data it needs for reviewer calibration analysis. Additionally, there is no structured guidance for Claude Code to analyze eval results - no framework for reasoning about patterns, no safeguards against over-correction when proposing changes based on eval data.

## Goal

Two independent changes: (1) enrich the `build:evaluate:complete` event to carry verdict details so the eval harness can analyze reviewer calibration, and (2) create a project-scoped analysis skill that guides Claude Code through eval result analysis with anti-bias gating rules.

## Approach

### 1. Enrich `build:evaluate:complete` event

Add an optional `verdicts` field to the `build:evaluate:complete` event type in `src/engine/events.ts`:

```typescript
| { type: 'build:evaluate:complete'; planId: string; accepted: number; rejected: number; verdicts?: Array<{ file: string; action: 'accept' | 'reject' | 'review'; reason: string }> }
```

The field is optional so existing consumers aren't broken.

In `src/engine/agents/builder.ts` at line 193 where the event is yielded, include the parsed verdicts:

```typescript
yield {
  timestamp: new Date().toISOString(),
  type: 'build:evaluate:complete',
  planId: plan.id,
  accepted,
  rejected,
  verdicts: verdicts.map(v => ({ file: v.file, action: v.action, reason: v.reason })),
};
```

The `verdicts` variable is already in scope from `parseEvaluationBlock` at line 189.

Apply the same enrichment to plan-level evaluate events (`plan:evaluate:complete`, `plan:architecture:evaluate:complete`, `plan:cohesion:evaluate:complete`) if the verdict data is available in those code paths.

### 2. Create analysis skill at `.claude/skills/eval-analysis/`

Create the skill directory with a `skill.md` file.

**Skill description:** "Analyze eval results to identify patterns and propose improvements with anti-bias gating." Should trigger on user requests like "/eval-analysis", "analyze eval results", "what do the evals show".

**Skill prompt content - the methodology:**

The skill prompt should instruct Claude Code to:

1. **Check for recent eval runs** via `eval_runs` MCP tool. If none exist or results are stale, offer to kick off a run via `eval_run`.

2. **Pull observations** via `eval_observations` for the most recent run. These are the programmatic detector outputs - review calibration, cost efficiency, profile selection, temporal regression.

3. **For each notable observation** (warning or attention severity):
   - Pull detailed data via `eval_scenario_detail` for affected scenarios
   - Read the relevant eforge prompt file or config section to understand current behavior
   - Reason about root cause - not just the symptom

4. **When proposing changes, follow the five gating rules:**

   **Rule 1: Never recommend reducing sensitivity.** If a reviewer has high false-positive rate, don't suggest "be more lenient." Investigate which issue categories are being rejected and whether the prompt conflates style preferences with correctness. The fix is improving signal quality, not lowering the bar.

   **Rule 2: Never recommend shifting a threshold in one direction.** If the planner over-selects expedition, don't suggest "bias toward excursion." Examine the criteria for ambiguity. The fix is clarity, not counter-pressure.

   **Rule 3: Always require a counter-scenario.** Every proposed config or prompt change must include a new eval scenario that would detect over-correction. No change without a regression guard.

   **Rule 4: Prefer scenario additions over behavior changes.** Priority: new eval scenario > config change > prompt change > "just investigate."

   **Rule 5: Respect confidence thresholds.** Ground truth signals (pass/fail) are actionable at N=1. Structural signals (tokens, cost, ratios) need N>=3 runs to separate signal from LLM variance. Semantic signals (was this review issue correct?) always need human judgment. Don't recommend prompt changes based on a single run.

5. **For the regression gate:** When applying a change, offer to run evals before (baseline) and after (candidate) via `eval_run` MCP tool, then compare via `eval_results` with the `compare` parameter.

6. **Present findings conversationally.** Lead with the most significant observations. For each, show: the data, the root cause hypothesis, and the proposed action (with counter-scenario if applicable). Ask the user what they want to dig into or act on.

## Scope

**In scope:**

- Adding optional `verdicts` field to `build:evaluate:complete` event type
- Including parsed verdicts in the event yield in `builder.ts`
- Applying the same enrichment to `plan:evaluate:complete`, `plan:architecture:evaluate:complete`, and `plan:cohesion:evaluate:complete` events if verdict data is available in those code paths
- Creating `.claude/skills/eval-analysis/skill.md` with the full methodology and gating rules

**Key files:**

| File | Change |
|------|--------|
| `src/engine/events.ts` | Add optional `verdicts` to evaluate:complete events |
| `src/engine/agents/builder.ts` | Include parsed verdicts in evaluate:complete event yield |
| `src/engine/agents/plan-evaluator.ts` | Same enrichment for plan/architecture/cohesion evaluate events (if verdict data available) |
| `.claude/skills/eval-analysis/skill.md` | New - analysis skill with gating rules |

**Out of scope:**

N/A

## Acceptance Criteria

- The `build:evaluate:complete` event type in `src/engine/events.ts` includes an optional `verdicts` field typed as `Array<{ file: string; action: 'accept' | 'reject' | 'review'; reason: string }>`.
- The event yield in `src/engine/agents/builder.ts` (around line 193) includes the parsed verdicts array from `parseEvaluationBlock`.
- Plan-level evaluate events (`plan:evaluate:complete`, `plan:architecture:evaluate:complete`, `plan:cohesion:evaluate:complete`) include verdict data where available in `plan-evaluator.ts`.
- The `verdicts` field is optional so existing consumers are not broken.
- The existing test suite passes with no regressions from the event type change.
- Building eforge, running a scenario, and inspecting the monitor DB shows `build:evaluate:complete` events containing a `verdicts` array.
- `.claude/skills/eval-analysis/skill.md` exists with the full methodology and all five anti-bias gating rules.
- The skill triggers on user requests like "/eval-analysis", "analyze eval results", "what do the evals show".
- The skill instructs Claude Code to use MCP tools (`eval_runs`, `eval_observations`, `eval_scenario_detail`, `eval_run`, `eval_results`) appropriately.
- Invoking the analysis skill in a Claude Code session confirms it uses MCP tools to pull data and follows the gating rules in its reasoning.
