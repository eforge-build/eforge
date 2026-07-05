---
title: Adaptive Source-Localization Rescoping for Planner Compiler
created: 2026-07-04
---

# Adaptive Source-Localization Rescoping for Planner Compiler

## Problem / Motivation

Improve the bounded planner compiler so repository exploration failures do not silently degrade into broad, low-confidence plans. When the read-only repository exploration agent cannot submit useful localization hints before exhausting its budget, it should return a structured outcome explaining unresolved needs and suggested rescoping signals. The compiler should use that outcome to deterministically split or refine atom scopes, rerun bounded localization/exploration on smaller scopes, and fail closed with actionable diagnostics if localization remains unresolved.

This keeps the current architecture intact: repository access remains confined to the exploration/localization phase; atom planners and reducers remain tool-less; final decomposition decisions remain compiler-owned and bounded rather than agent-authored. The goal is to reduce costly downstream thrashing, vague plan boundaries, broad ownership, and review-cycle failures caused by under-localized upstream plans.

Recent builds showed a repeated failure mode:

- The compiler collapsed cross-cutting PRDs into a single `atom-root` because criterion count and source-byte thresholds were under current limits.
- Repository exploration exhausted its read-only tool budget without submitting hints.
- The compiler continued with degraded/no hints.
- Planning-quality review had to repair broad ownership, vague plan bodies, empty validation gates, and weak traceability.
- One downstream build failed after expensive implementation/review cycles on cross-cutting client event/schema/projection issues.

The current soft-degrade behavior is too optimistic for cross-cutting or low-localization-confidence work. Exploration exhaustion is a strong signal that the current atom scope is too broad or ambiguous for reliable planning.

## Goal

Make repository exploration degradation actionable rather than warning-only by adding a structured exploration outcome path, using bounded compiler-owned rescoping to revise atom scope, and failing closed with diagnostics when trustworthy planning inputs cannot be produced. The intended outcome is to reduce downstream implementation/review thrash caused by vague or overbroad plan boundaries while preserving the current architecture.

Detailed goals:

- Make repository exploration degradation actionable rather than a warning-only condition.
- Add a structured exploration outcome path for unresolved localization and rescoping feedback.
- Let the compiler deterministically revise atom scope from bounded feedback.
- Rerun localization/exploration on smaller, better-scoped units when appropriate.
- Fail closed with diagnostics when bounded rescoping cannot produce trustworthy planning inputs.
- Reduce downstream implementation/review thrash caused by vague or overbroad plan boundaries.

## Approach

### Architecture constraints

- Repository access remains confined to the exploration/localization phase.
- Atom planners and reducers remain tool-less.
- Final decomposition decisions remain compiler-owned and bounded rather than agent-authored.

### Structured exploration outcome

Replace the single-success `submit_exploration_hints` tool with a single unified `submit_exploration_outcome` tool whose payload can represent both success and inability to localize. No compatibility alias: the tool is engine-internal, registered by `exploration-agent.ts`, never exposed outside the compiler path, and this repo does not carry backward-compat cruft.

Conceptual tool payload:

```json
{
  "status": "completed | needs-rescope | budget-exhausted | ambiguous",
  "projectHints": [],
  "unresolvedNeeds": [
    {
      "needId": "...",
      "criterionIds": ["ac-001"],
      "aspectIds": ["ac-001:interface:route"],
      "reason": "<shared localization-issue vocabulary - see below>",
      "attemptedQueries": ["..."],
      "candidatePaths": ["..."],
      "suggestedSplitKeys": ["client-contract", "monitor-projection"]
    }
  ],
  "rescopeHints": [
    {
      "kind": "subsystem | interface | evidence-path | criterion-group | source-need",
      "key": "...",
      "criterionIds": ["ac-001"],
      "aspectIds": ["..."],
      "rationale": "..."
    }
  ],
  "notes": "..."
}
```

The exact schema should be bounded, TypeBox-owned, and small enough for stable event/diagnostic projection. Echoed `needId`, `criterionIds`, and `aspectIds` values must be validated against the known deterministic needs/criteria for the scope; unknown ids are dropped with a diagnostic rather than rejected wholesale.

#### Shared classification vocabulary

The `reason` values on unresolved needs must not become a second, parallel taxonomy. The source-localization repair loop already classifies reduce gaps into an `issueKind` set in `source-localization-repair.ts`:

- `missing-owner-path`
- `missing-contract-evidence`
- `missing-entrypoint-evidence`
- `missing-config-evidence`
- `missing-consumer-surface-evidence`
- `directory-only-evidence`
- `missing-materialized-source`
- `localization-ambiguity`

Extract that vocabulary into a shared contracts module, extend it with the exploration-specific `too-broad` and `tool-budget` reasons, and have both the exploration outcome schema and the repair-loop classifier consume it, so diagnostics, rescoping, and repair all speak the same language.

#### Budget-exhaustion submit mechanism

Today `exploration-agent.ts` aborts the agent run the moment tool uses exceed `maxToolUses`, so an exhausted agent never gets the chance to submit anything. The structured outcome requires changing budget enforcement:

- When the read-only tool budget is reached, do not abort immediately. Instead, subsequent tool results and a final nudge tell the agent: "budget exhausted - call `submit_exploration_outcome` now with your best partial evidence." Only the submit tool is honored from that point; further read-only tool calls are rejected with the same nudge, bounded by the existing `maxTurns` ceiling.
- If the agent still finishes without submitting, the compiler synthesizes a deterministic `budget-exhausted` outcome from what it knows: unresolved need ids from the deterministic localization baseline, tool-use count, and no rescope hints. Downstream rescoping logic always receives a structured outcome, never a bare degradation flag.
- `satisfaction-gate-agent.ts` shares the same budget/one-shot-submit pattern; apply the same grace-turn enforcement there for consistency, without changing the gate's fail-open semantics.

### Compiler-owned adaptive rescoping

When exploration returns `needs-rescope`, `budget-exhausted`, or `ambiguous`, the compiler should not continue directly with no hints for risky work. Instead it should:

1. Record structured diagnostics for the degraded scope.
2. Derive rescope groups deterministically from:
   - unresolved source need ids
   - criterion ids and aspect ids
   - interface keys
   - subsystem hints
   - evidence paths
   - candidate owner paths when available
   - bounded `rescopeHints` from exploration
3. Rebuild the atom graph or split affected atoms into smaller units.
4. Rerun deterministic localization and bounded exploration for affected scopes.
5. Preserve successful hints/outputs for unaffected scopes.
6. Cap attempts and total exploration budget.

Layering: exploration runs in the compile-stage orchestrator, `compile-stage-integration.ts`, one layer above `runBoundedPlannerCompiler`, and the compiler derives its own atom graph internally. The rescope loop therefore lives in the stage-integration layer, in a new module alongside `compile-stage-integration.ts`, not in `compiler-runner.ts`. Rescope decisions are expressed as deterministic rescope directives: `derivePlanningAtomGraph` gains an optional directives input, and the same directives are threaded into `runBoundedPlannerCompiler` so the stage layer and the compiler derive the identical revised graph. Per-scope exploration reruns add a scope filter to the needs list in the exploration prompt and account tool uses against a cross-run ledger so the total budget cap holds across attempts.

Timing: adaptive rescoping is pre-map only. The existing reduce-gap repair loop, `source-localization-repair.ts`, is untouched; the failure mode this work targets, broad `atom-root` plus no hints, occurs before map planning ever runs.

### Escalation policy

Exploration degradation should be severity-aware:

- If source is simple and deterministic localization is already high-confidence, emit a warning and proceed.
- If the source is cross-cutting, has many global localization needs, low-confidence localization, broad directory-only evidence, or prior rescope attempts, run adaptive rescoping.
- If rescoping is exhausted and critical source needs remain unresolved, fail compile with incomplete diagnostics instead of producing vague executable plans.

Risk classification reuses existing deterministic signals rather than inventing new heuristics: the exploration-skip high-confidence share, `EXPLORATION_SKIP_HIGH_CONFIDENCE_SHARE`, currently `0.6`, in `exploration-contracts.ts`; per-record `SourceLocalizationConfidence`; and subsystem diversity exceeding `maxSubsystemsPerUnit` while the graph is collapsed to a single `atom-root`. A degraded scope is risky when the exploration outcome is non-completed and at least one of the following is true:

- the high-confidence share is below the skip threshold;
- the root atom spans more subsystems than `maxSubsystemsPerUnit`;
- unresolved needs carry interface keys.

"Critical" unresolved needs, the fail-closed trigger, are those tied to criteria with interface keys or contract/entrypoint need kinds. New limits, including max rescope attempts and total exploration tool budget across attempts, follow the existing default + maxima pattern in `compile-resilience/planning-decomposition-limits.ts`.

Budget sizing: the per-scope exploration tool budget is not a flat number. It scales with the scope's unresolved-need count as `min(base + perNeed * scopeNeedCount, configuredMax)`, so a 3-need scope and a cross-cutting 50-need scope no longer share the same envelope. The existing `planningUnitMaxLocalExplorationToolUses` config key keeps its meaning as the per-scope clamp, with default `24` and maximum `256`, preserving the current per-project override lever without a breaking config change; `base` and `perNeed` are new limits following the same default + maxima pattern. The agent's turn ceiling must scale with the derived budget, roughly `budget / 2` turns, floored at the current default, since a fixed turn cap would silently bind before a scaled budget does. The total cross-run ledger defaults to a small multiple, 2-3x, of the initial scope's derived budget, so rescoping's answer to an exhausted scope is "narrow and retry" rather than "raise the flat number". A bigger flat budget still degrades silently when it runs out; adaptive rescoping degrades gracefully at any budget.

Making the atom-graph collapse gate consider signals beyond criterion count and source bytes deliberately reverses part of the small-PRD collapse decision, so it must stay conditional on a degraded exploration outcome. A small PRD with clean localization still collapses to one atom exactly as today.

### Diagnostics and observability

Compiler diagnostics should expose:

- original atom count and revised atom count
- exploration outcome status and tool-use count
- unresolved need ids and reasons
- rescope attempt count and limit
- generated split groups and rationale
- which atoms were rerun or preserved
- remaining low-confidence or unresolved localization
- whether compile proceeded, repaired, or failed closed

No new event wire variants. Rescope progress and warnings reuse the existing `planning:progress` / `planning:warning` events, detailed state goes into the compiler diagnostics artifact, and when rescoping produces a revised graph the existing `planning:map-reduce:atoms` snapshot is re-emitted before map planning starts. This is safe because it already fires before map today. Event wire shapes remain owned by `@eforge-build/client`.

The rescope section of the diagnostics artifact must fit the existing constraints in `compiler-diagnostics.ts`: the versioned schema, the total byte cap, and the progressive compaction ladder. The new section needs its own compaction pass so a large rescope history cannot crowd out coverage/repair data.

### Code impact

Likely areas:

- `packages/engine/src/planner-compiler/exploration-contracts.ts`
  - Add the structured `submit_exploration_outcome` schema and validation, replacing the hints-only submission schema.
- `packages/engine/src/planner-compiler/exploration-agent.ts`
  - Replace the completion tool.
  - Change budget enforcement to the grace-turn model, submit-only after exhaustion, with a synthesized `budget-exhausted` fallback outcome.
  - Keep read-only repository tools and bounded tool-use behavior.
  - Add per-scope need filtering, need-count-derived budget sizing with a matching turn-ceiling scale, and the cross-run tool-use ledger.
- `packages/engine/src/planner-compiler/satisfaction-gate-agent.ts`
  - Apply the same grace-turn budget enforcement; fail-open semantics are unchanged.
- New shared classification module, for example `packages/engine/src/planner-compiler/localization-issue-contracts.ts`
  - Shared issue-kind vocabulary consumed by the exploration outcome schema, the rescope classifier, and the repair loop.
- New stage-integration-layer module, for example `packages/engine/src/planner-compiler/adaptive-rescope.ts`
  - Orchestrate bounded rescope attempts around `resolveExplorationHints`; `compile-stage-integration.ts` is already 225 lines and all files must stay under 600.
- `packages/engine/src/planner-compiler/compile-stage-integration.ts`
  - Invoke the rescope loop.
  - Thread rescope directives into the compiler call.
- `packages/engine/src/planner-compiler/atom-graph.ts`
  - Accept optional deterministic rescope directives in `derivePlanningAtomGraph`.
  - Split affected atoms accordingly.
  - The collapse gate override applies only under a degraded exploration outcome.
- `packages/engine/src/planner-compiler/compiler-runner.ts`
  - Accept rescope directives on `runBoundedPlannerCompiler` input and pass them to atom-graph derivation.
  - Do not put rescope orchestration here.
- `packages/engine/src/planner-compiler/source-localization-repair.ts`
  - Consume the shared classification vocabulary; repair semantics are unchanged.
- `packages/engine/src/planner-compiler/compiler-diagnostics.ts` and `compiler-diagnostics-contracts.ts`
  - Surface rescope attempts, unresolved needs, split rationale, and fail-closed outcomes.
  - Add a compaction pass for the rescope section.
- `packages/engine/src/compile-resilience/planning-decomposition-limits.ts`
  - Add new limits: max rescope attempts, per-scope budget scaling terms (`base`, `perNeed`), and the total cross-run budget multiplier, using the default + maxima pattern.
  - `planningUnitMaxLocalExplorationToolUses` keeps its meaning as the per-scope clamp.
- No changes to `packages/client/src/events/*`; existing `planning:*` events suffice.
- Tests under `test/` for graph splitting, exploration outcome handling, grace-turn budget enforcement, compiler diagnostics, and bounded rescope behavior, extending `planning-exploration-agent.test.ts`, `planning-atom-graph.test.ts`, `planning-compiler-stage-integration.test.ts`, and `planning-compiler-diagnostics.test.ts` with `StubHarness` scripted tool calls.

### Validation plan

- Unit-test exploration outcome schema acceptance/rejection, including unknown-id dropping with diagnostics.
- Unit-test grace-turn budget enforcement: read-only tool calls after exhaustion are rejected with the submit nudge, a submit call is still honored, and a no-submit finish yields the synthesized `budget-exhausted` outcome.
- Unit-test per-scope budget derivation: small and large need counts produce proportionally different budgets, the configured clamp holds, the turn ceiling scales with the derived budget, and the cross-run ledger caps total tool uses across rescope attempts.
- Unit-test deterministic rescope grouping from representative unresolved needs.
- Unit-test that simple/high-confidence sources can still proceed with warning-only degradation.
- Unit-test that risky degraded sources trigger rescoping and produce more than one atom when split signals warrant it.
- Integration-test a synthetic cross-cutting PRD where exploration returns `budget-exhausted`; verify compile reruns smaller scopes and does not produce broad ownership artifacts.
- Integration-test rescope exhaustion; verify compile fails closed with actionable diagnostics.
- Regression-test that atom planners/reducers receive no repository tools.
- Run `pnpm type-check`, targeted `pnpm test`, and `pnpm maintainability:check`.

### Resolved decisions

Formerly open questions were resolved against the current code:

- `submit_exploration_hints` is replaced outright by the unified `submit_exploration_outcome` tool. No compatibility alias, because it is an engine-internal tool and there should be no backward-compat cruft.
- Risky-scope thresholds reuse existing deterministic signals: exploration-skip high-confidence share, per-record localization confidence, and subsystem diversity vs `maxSubsystemsPerUnit`, as described in the escalation policy.
- Adaptive rescoping is pre-map only. The reduce-gap repair loop keeps its current trigger and semantics; unifying the two mechanisms is out of scope.
- There is no new Console surface. Rescope observability is existing `planning:*` events, the compiler diagnostics artifact, and re-emitted `planning:map-reduce:atoms` snapshots.

## Scope

### In scope

- Structured exploration outcomes for completed localization, unresolved localization, rescoping needs, budget exhaustion, and ambiguity.
- A unified `submit_exploration_outcome` tool replacing the hints-only submission path.
- Shared localization issue classification vocabulary consumed by exploration outcome schema, rescope classification, and source-localization repair.
- Submit-only grace behavior after read-only tool budget exhaustion in repository exploration.
- A deterministic synthesized `budget-exhausted` outcome when the agent finishes without submitting.
- The same grace-turn budget enforcement pattern for `satisfaction-gate-agent.ts`, while keeping fail-open semantics unchanged.
- Compiler-owned adaptive rescoping in the compile-stage integration layer before map planning.
- Deterministic rescope directives threaded into `derivePlanningAtomGraph` and `runBoundedPlannerCompiler` so the stage layer and compiler derive the same revised graph.
- Per-scope reruns of deterministic localization and bounded exploration for affected scopes only.
- Preservation of successful hints/outputs for unaffected scopes.
- Explicit attempt limits, total exploration budget limits, per-scope need-count-derived budget sizing, matching turn-ceiling scaling, and a cross-run tool-use ledger.
- Severity-aware escalation using existing deterministic localization and subsystem-diversity signals.
- Fail-closed compile behavior with incomplete diagnostics when bounded rescoping cannot resolve critical source needs.
- Diagnostics for rescope attempts, unresolved needs, split rationale, preserved/rerun atoms, remaining low confidence, and fail-closed/proceeded/repaired outcomes.
- Reuse of existing `planning:progress`, `planning:warning`, and `planning:map-reduce:atoms` events without introducing new event wire variants.
- Tests for graph splitting, exploration outcome handling, grace-turn budget enforcement, compiler diagnostics, and bounded rescope behavior.

### Out of scope

- Do not give atom planners or reducers direct repository tools.
- Do not let the exploration agent directly author final plans or orchestration.
- Do not hard-code eforge-specific package layouts into generic compiler defaults.
- Do not make exploration unbounded or allow indefinite rescoping loops.
- Do not replace the existing source-localization repair loop; extend the compile-time path that feeds it.
- Do not put rescope orchestration in `compiler-runner.ts`.
- Do not change the trigger or semantics of the reduce-gap repair loop in `source-localization-repair.ts`.
- Do not add new event wire variants.
- Do not add a new Console surface.
- Do not change `packages/client/src/events/*`, because existing `planning:*` events suffice.

## Acceptance Criteria

- When repository exploration exhausts its tool budget without successful localization, the agent can submit a schema-valid structured outcome instead of only failing to call the hints tool: budget exhaustion enters a submit-only grace mode rather than aborting the run.
- If the agent still finishes without submitting, a deterministic synthesized `budget-exhausted` outcome is recorded so downstream rescoping always receives a structured outcome.
- The compiler records machine-readable diagnostics for exploration outcomes, including unresolved needs, reasons, attempted query context, and tool-use count.
- For risky degraded scopes, the compiler derives smaller atom scopes deterministically from source needs, criteria/aspects, interface keys, subsystem hints, evidence paths, and bounded rescope hints.
- Adaptive rescoping reruns localization/exploration only for affected scopes and preserves successful outputs for unaffected scopes where applicable.
- Rescoping is bounded by explicit attempt and budget limits; exhausted rescoping fails closed with diagnostics rather than generating vague executable plans.
- Atom planners and reducers remain tool-less; repository access remains limited to deterministic compiler internals and the read-only exploration phase.
- The exploration agent never directly authors final plan modules, orchestration, or dependencies; it only reports localization/rescope evidence.
- Cross-cutting PRDs with degraded exploration no longer silently proceed as a single broad `atom-root` unless deterministic localization confidence is already sufficient.
- Tests cover successful hints, budget-exhausted outcomes, ambiguous outcomes, deterministic atom splitting, bounded exhaustion, diagnostics, and preservation of unaffected atom outputs.