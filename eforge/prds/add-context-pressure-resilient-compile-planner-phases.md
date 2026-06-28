---
title: Add Context-Pressure Resilient Compile Planner Phases
created: 2026-06-27
---

# Add Context-Pressure Resilient Compile Planner Phases

## Problem / Motivation

The compile planner can spend too many turns inspecting the codebase and reach the hard live-context guard before submitting any plan artifacts.

A captured failure mode involved a repeated compile-planner retry that reached about 179,785 per-turn input tokens against a 178,444 guard after 48 turns, 37 read calls, and 16 bash calls, with no `submit_plan_set` or planning submission.

Existing guard fixes correctly prevent provider context-window failure, but they still terminate compile with no compact evidence, no resumable synthesis input, and only manual scope-reduction guidance. The planner needs phase-level resilience: bounded inspection, preserved compact findings, and continuation from the compact handoff before the hard guard is the only remaining outcome.

## Goal

Implement an engine-level resilience feature for compile planning that splits planner execution into bounded inspection, compact evidence capture, and synthesis/continuation phases.

Prolonged codebase exploration should produce usable artifacts before the hard context guard trips, while existing prompt-source compaction, model-aware guard limits, capped output reserve, guard diagnostics, and hard context failures remain safety nets.

## Approach

- Refactor compile planning into explicit phases or an equivalent state machine:
  - Preparation
  - Bounded inspection
  - Compact evidence capture
  - Synthesis
  - Recovery/fallback
- Add a soft planner context-pressure threshold below the hard guard.
- Transition to compaction/continuation when the soft threshold is crossed during inspection and no plan artifacts exist.
- Enforce inspection budgets based on turn count, tool use, and/or context-pressure soft thresholds below the existing hard guard.
- Derive budgets from the model-aware context limit and output reserve where possible.
- Preserve a compact inspection summary when context pressure grows and no plan artifacts exist.
- Include the following minimum fields in the structured handoff artifact:
  - Source/build identifiers
  - Relevant files
  - Observed facts
  - Important findings
  - Inferred implementation areas
  - Unresolved questions
  - Enough source/build context to synthesize plans without replaying the full transcript
  - Budget/pressure diagnostics
  - Caveats about incomplete inspection
- Restart synthesis from a fresh compact prompt containing the original normalized build source plus the inspection summary.
- Apply tighter tool permissions and budgets during resumed synthesis.
- Clearly require resumed synthesis to submit plan artifacts.
- Update recovery outcome guidance so planner context pressure without artifacts recommends or uses compact-inspection continuation instead of only manual scope reduction.
- Preserve the existing compile scope/context guidance path when the initial source prompt is already oversized before planner tool use.
- Keep the hard live-context guard as the final fail-closed safety net.
- Prefer typed events/artifacts over ad hoc log text so daemon, console, CLI, and extension surfaces can render the same recovery story.
- Add typed recovery/diagnostic events only if needed.
- Keep event wire shapes owned by `packages/client/src/events`.
- Avoid duplicating daemon/client route or event shapes in consumer renderers.
- Avoid expanding this work into wrapper-app scheduling, Auto-drain behavior, or broad host workflow UX.
- Do not fix the underlying queue cleanup backlog item that originally exposed this planner failure.
- Expected implementation areas include:
  - `packages/engine/src` compile-planner orchestration
  - `packages/engine/src` planner prompt construction
  - `packages/engine/src` context-pressure checks
  - `packages/engine/src` model-aware token/reserve handling
  - `packages/engine/src` recovery recommendation construction
  - `packages/engine/src` artifact/session logging
  - `packages/client/src/events` if new typed event variants are needed
  - `test/` StubHarness-driven planner tests
  - `test/` bounded regression fixture for the high-turn inspection scenario
  - Consumer renderers only if new user-visible typed events or recovery messages are introduced
- Implementation must respect existing engine rules:
  - The engine emits events and does not write to stdout.
  - State mutation goes through the existing state mutation entry point.
  - Build-decision events go through the decision helper.
  - New files/functions stay within maintainability limits.
- Main risks are losing critical evidence during compaction, triggering the soft threshold too early or too late, allowing resumed synthesis to continue unbounded tool use, and introducing event-shape drift.
- Risk mitigations should include capped summary fields, threshold tests, strict synthesis budgets, and client-owned event schemas.
- Current token/context accounting is assumed to be reliable enough to drive a soft threshold before the hard guard.
- A compact handoff is assumed to be generatable either progressively from known inspection facts or by a bounded final summarization step before context is too tight.
- One automatic compact-continuation attempt is assumed to be acceptable for compile planning.
- Repeated compact-continuation loops should be capped.
- User-facing documentation changes are only required if new visible diagnostics, recovery labels, or configuration knobs are exposed.

## Scope

### In scope

- Refactor compile planning into explicit phases or an equivalent state machine.
- Enforce inspection budgets based on turn count, tool use, and/or context-pressure soft thresholds below the existing hard guard.
- Preserve a compact inspection summary when context pressure grows and no plan artifacts exist.
- Allow planner synthesis to restart from the compact summary with tighter tool permissions/budgets and a clear requirement to submit plan artifacts.
- Update recovery outcome guidance so planner context pressure without artifacts recommends or uses compact-inspection continuation instead of only manual scope reduction.
- Add regression coverage for prolonged inspection, oversized source prompts, and the Fix Removed Queue Coverage Cleanup failure shape.

### Out of scope

- Relaxing or removing the hard context guard.
- Broad provider-specific context-window changes beyond using existing model-aware limits.
- Wrapper-app scheduling.
- Auto-drain behavior.
- Host workflow orchestration.
- Fixing the underlying queue cleanup backlog item that originally exposed this planner failure.

## Acceptance Criteria

- The compile planner has an explicit bounded inspection phase or equivalent enforcement before final plan synthesis.
- Planner tool use is bounded before reaching the hard live context guard.
- Planner tool-use bounds account for context pressure, turn budget, or both.
- When planner context pressure approaches the configured guard and no plan artifacts exist, eforge preserves a compact inspection summary.
- The compact inspection summary includes relevant files.
- The compact inspection summary includes important findings.
- The compact inspection summary includes unresolved questions.
- The compact inspection summary includes enough source/build context to synthesize plans without replaying the full transcript.
- Planner synthesis can restart from the compact summary without replaying the full tool transcript.
- Resumed planner synthesis uses tighter tool permissions or budgets than the original inspection phase.
- Resumed planner synthesis has an explicit plan-submission objective.
- The recovery outcome for planner context pressure without artifacts recommends compact-inspection continuation or automatically uses compact-inspection continuation.
- Existing prompt-source compaction remains in place as a hard safety net.
- Existing model-aware guard limits remain in place as a hard safety net.
- Existing capped output reserve behavior remains in place as a hard safety net.
- Existing guard diagnostics remain in place as a hard safety net.
- Tests cover a planner that performs prolonged codebase inspection.
- Tests cover pre-hard-guard pressure handling during prolonged planner inspection.
- Tests assert that compact evidence is preserved during pre-hard-guard pressure handling.
- Tests assert that synthesis completes or resumes from the compact inspection summary.
- Tests cover genuinely oversized source prompts.
- Tests assert that genuinely oversized source prompts still fail or recover through the existing compile scope/context guidance.
- A regression fixture or equivalent test represents the Fix Removed Queue Coverage Cleanup compile scenario.
- The Fix Removed Queue Coverage Cleanup regression coverage focuses on high-turn inspection pressure rather than real long-running provider calls.
- Repeated context-guard failures from unbounded planner tool use cannot regress silently.
- A StubHarness scenario exercises a planner that repeatedly reads or runs tools without submitting a plan.
- The StubHarness scenario asserts that the soft pressure path captures a compact summary.
- The StubHarness scenario asserts that synthesis resumes from the compact summary.
- Tests assert that the resumed synthesis prompt does not include the full inspection transcript.
- Tests assert that resumed synthesis can submit plan artifacts.
- New event schemas, if added, are validated for parse/serialization through shared client types.
- Renderer behavior is validated through shared client types if new event schemas are added.
- `pnpm test` exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.