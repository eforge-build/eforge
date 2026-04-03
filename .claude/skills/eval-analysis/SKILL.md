---
name: eval-analysis
description: Analyze eval results to understand signal quality and guide prompt/config changes. Use when the user says "eval-analysis", "analyze eval results", "what do the evals show", "eval regression", or asks about eval signal enrichment.
---

# /eval-analysis

Structured methodology for analyzing eforge eval results, identifying signal patterns, and proposing changes with anti-bias safeguards.

## Prerequisites

- The eval harness MCP server must be connected (provides `eval_runs`, `eval_observations`, `eval_scenario_detail`, `eval_run`, `eval_results` tools)
- You should be in or have access to the eforge project codebase

## Workflow

### Step 1: Gather Recent Eval Data

Start by checking what eval data is available:

1. Use `eval_runs` to list recent eval runs. Note run IDs, timestamps, and which scenarios were included.
2. If the user mentions a specific run or comparison, use `eval_results` with the relevant run ID(s).
3. If comparing baseline vs candidate, use `eval_results` with the `compare` parameter to get a structured regression comparison between two runs.

### Step 2: Pull Observations

For runs of interest, use `eval_observations` to get detailed per-scenario observation data. This gives you the raw signal - scores, pass/fail, and any metadata attached to each observation.

Focus on:
- Scenarios with low scores or failures
- Scenarios where scores changed significantly between runs
- Patterns across scenario categories

### Step 3: Drill Into Affected Scenarios

For each scenario showing issues or regressions, use `eval_scenario_detail` to get the full scenario specification - inputs, expected outputs, scoring criteria, and any notes.

This is critical context: you need to understand what the scenario tests before reasoning about why it failed.

### Step 4: Read Relevant Source

Before forming hypotheses about root cause, **always read the relevant eforge prompt or config file** that the failing scenarios exercise. Do not guess at prompt content from memory.

Common locations:
- Agent prompts: `src/engine/prompts/*.md`
- Agent implementations: `src/engine/agents/*.ts`
- Config and defaults: `src/engine/config.ts`
- Schema definitions: `src/engine/schemas.ts`
- Pipeline stages: `src/engine/pipeline.ts`

Understanding the actual prompt/config text is essential for accurate root cause analysis.

### Step 5: Apply Anti-Bias Gating Rules

Before proposing any change based on eval data, check every proposed action against all five gating rules. A proposal that violates any rule must be revised or dropped.

#### Rule 1: Never Reduce Sensitivity

Do not propose changes that would make the system less sensitive to errors, edge cases, or subtle signals. If a scenario is failing because the agent catches something it previously missed, that may be a feature, not a bug. Reducing sensitivity to make numbers go up is a false improvement.

#### Rule 2: Never Shift Threshold in One Direction

Do not propose adjusting a threshold, cutoff, or scoring boundary that only moves it in one direction (e.g., making pass criteria more lenient, or raising a tolerance). Any threshold change must be justified by evidence that the current threshold is wrong in both directions - too strict in some cases AND too lenient in others - or must be accompanied by a new scenario that tests the boundary from the other side.

#### Rule 3: Always Require Counter-Scenario

For any proposed behavior change, identify at least one existing scenario (or propose a new one) that would regress if the change were applied incorrectly. If you cannot identify a counter-scenario, the change is under-constrained and should not be made until one exists. The counter-scenario proves the change is targeted rather than a broad relaxation.

#### Rule 4: Prefer Scenario Additions Over Behavior Changes

When eval results reveal a gap, the first response should be "do we need a new scenario?" not "do we need to change the prompt?" Adding scenarios that capture the desired behavior is lower-risk than modifying prompts or config. Only propose behavior changes when the scenario coverage is already adequate and the root cause is clearly in the prompt/config.

#### Rule 5: Respect Confidence Thresholds

Do not propose changes based on small sample sizes or marginal differences. Require:
- At least 3 observations of a pattern before treating it as signal (not noise)
- A score difference of at least 10% between baseline and candidate to call it a regression or improvement
- If a scenario has high variance across runs, flag it as unreliable rather than acting on its latest result

### Step 6: Formulate Findings

Present findings conversationally with three components for each issue:

1. **Data** - What the eval numbers show. Quote specific scores, scenario names, and run IDs. Show the delta if comparing runs.
2. **Hypothesis** - What you think is causing the observed behavior, grounded in the source you read in Step 4. Be explicit about confidence level (high/medium/low) and what evidence supports or weakens the hypothesis.
3. **Proposed Action** - What to do about it. This must pass all five gating rules. Clearly label whether the action is:
   - **Add scenario** - New eval scenario to improve coverage
   - **Modify prompt/config** - Change to eforge source (with specific file and section)
   - **Investigate further** - Need more data before acting
   - **No action** - Signal is noise or expected behavior

### Step 7: Regression Gate (for candidate comparison)

When comparing a candidate change against a baseline:

1. Use `eval_results` with the `compare` parameter to get the structured comparison.
2. Flag any scenario that regressed by more than 10% as a blocker.
3. For each regression, trace through Steps 3-5 to determine if the regression is:
   - **Real** - The candidate change broke something. Block the change.
   - **Flaky** - The scenario has high variance. Flag but don't block.
   - **Expected** - The candidate intentionally changes behavior the scenario tests. Update the scenario.
4. Summarize with a clear **PASS/BLOCK** recommendation.

### Step 8: Run New Evals (if needed)

If the analysis suggests running a new eval (e.g., after adding scenarios or to get more data):

1. Use `eval_run` to kick off a new run.
2. Wait for completion, then loop back to Step 1 with the new run data.

## Important Reminders

- Always read source before reasoning about root cause (Step 4)
- Every proposed change must pass all five gating rules (Step 5)
- Present findings as data + hypothesis + action (Step 6)
- When in doubt, propose adding scenarios rather than changing behavior (Rule 4)
- Small sample sizes are noise, not signal (Rule 5)
