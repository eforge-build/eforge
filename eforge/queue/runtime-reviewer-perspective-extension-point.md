---
title: Runtime Reviewer Perspective Extension Point
created: 2026-05-18
profile: gpt-claude-combo
---

# Runtime Reviewer Perspective Extension Point

## Problem / Motivation

Schaake OS epic `a579562d-fb09-4177-9a80-3438d046cca5` is in progress and asks for a safer stage-like extension API for custom reviewer perspectives. Validation providers and arbitrary compile/build stage registration are explicitly out of scope.

Eforge already captures `registerReviewerPerspective` registrations from native TypeScript extensions, but they are explicitly runtime-deferred. Extension authors can register a perspective for provenance, yet the review engine never selects it, reviewer agents never receive its prompt fragment, and docs/skills correctly warn that it does not execute.

The gap matters because reviewer perspectives are a high-value, safer alternative to arbitrary custom build stages: teams want domain-specific review lenses such as accessibility, privacy, performance, design-system compliance, i18n, or migration safety without letting extensions mutate orchestration state or define arbitrary stage behavior.

Affected users:

- Extension authors using `/eforge:extend` or direct TypeScript modules.
- Teams relying on review-cycle quality gates and monitor/CLI observability.
- Maintainers of the engine/event schema/monitor surfaces who need coherent representation for dynamic perspective names.

Why now: roadmap and PRD identify EXTEND_12A as the next limited stage-like API after core extension runtime, profile routing, policy gates, and input transformers. The existing typed contract provides a natural starting point but needs runtime wiring, bounded applicability, and docs/examples.

Classification: this is a **feature / focused** change. It adds a new runtime-supported extension capability and changes engine, SDK/docs, event schemas, and UI/CLI representation. It is cohesive enough for one plan set; delegated module planning does not appear necessary.

Evidence reviewed:

- `docs/roadmap.md` lists native TypeScript extensions as an active roadmap direction and specifically calls out limited stage-like APIs such as custom reviewer perspectives.
- `docs/prd/typescript-extensibility.md` defines EXTEND_12A as the reviewer perspective extension-point slice and EXTEND_12B as separate validation-provider work. It recommends delivering docs/examples with each capability and avoiding full custom stage registration.
- `packages/extension-sdk/src/api.ts`, `packages/extension-sdk/src/hooks.ts`, `packages/engine/src/extensions/types.ts`, and `packages/engine/src/extensions/recorder.ts` already expose and capture `registerReviewerPerspective`, but the runtime is not wired. Current `ReviewerPerspectiveSpec` is only `{ key, label, promptFragment }`.
- `docs/extensions.md` and `docs/extensions-api.md` currently state `registerReviewerPerspective` is deferred at runtime. `/eforge:extend` skills in both `packages/pi-eforge/skills/eforge-extend/SKILL.md` and `eforge-plugin/skills/extend/extend.md` likewise classify reviewer perspectives as runtime-deferred.
- Built-in review perspective handling is currently closed over the built-in union `code | security | api | docs | test | verify`: `packages/engine/src/review-heuristics.ts`, `packages/client/src/events.schemas.ts`, `packages/engine/src/agents/parallel-reviewer.ts`, `packages/engine/src/review-cycle-perspectives.ts`, and `packages/engine/src/pipeline/stages/build-stages.ts`.
- The review cycle emits `plan:build:review:parallel:*` events and `plan:build:decision` decisions for `review-strategy`, `perspectives-inferred`, and adaptive `perspectives-respawned`. Monitor UI and CLI already render perspective names in generic string-like places, but the wire schema uses the closed `ReviewPerspectiveSchema` for start/complete events and decisions.
- Runtime registry plumbing already exists in `EforgeEngine` for extension loading and passes subsets to scheduler/orchestrator for profile routers and policy gates. `BuildStageContext` does not currently carry `NativeExtensionRegistry` reviewer perspective registrations to build stages.
- Management/diagnostics projection already counts `reviewerPerspectives` in `packages/engine/src/extensions/projector.ts`, and tests assert registration capture in `test/extension-loader.test.ts` and replay summaries in `test/extension-replay.test.ts`.

## Goal

Promote `registerReviewerPerspective` from deferred/provenance-only to a runtime-supported extension point for post-build `review-cycle` parallel reviews.

Extension authors should be able to define bounded, observable, domain-specific reviewer perspectives that run alongside built-in perspectives without enabling arbitrary custom build stages, validation providers, state mutation, or orchestration changes.

## Approach

### High-level design

1. **Keep reviewer perspectives as a high-level review API, not stages.**
   - Decision: Extension perspectives contribute reviewer-agent prompt context and applicability metadata only. They do not register new build/compile stages, write files directly, mutate pipeline state, or alter merge/evaluation behavior.
   - Rationale: Matches the PRD guardrail and epic acceptance criteria for bounded, safer stage-like behavior.

2. **Extend `ReviewerPerspectiveSpec` with metadata and bounded applicability.**
   - Decision: Evolve the spec toward:
     - `key: string` — stable unique key, restricted to a safe slug pattern and reserved built-in names rejected unless explicitly allowed as impossible/unsupported.
     - `label: string`
     - `description: string`
     - `promptFragment: string`
     - `appliesTo?: ReviewerPerspectiveApplicability` or function with a read-only context.
   - Preferred applicability shape: a declarative rule object where possible (`fileGlobs`, `categories`, `paths`, `extensions`, `minChangedFiles`, `minChangedLines`, etc.) plus, if needed, a function receiving a read-only snapshot. If a function is allowed, execute it timeout-bounded/fail-open and emit diagnostics on throw/timeout/invalid result.
   - Rationale: Declarative rules are easier to validate, display, and test; a bounded function preserves flexibility without exposing mutable engine state.

3. **Use dynamic perspective keys in runtime/event surfaces.**
   - Decision: Treat perspective identifiers as strings matching the same safe key pattern in runtime events and review config, while keeping `REVIEW_PERSPECTIVES` as built-in constants for default rules and docs.
   - Rationale: Extension keys cannot be known at TypeBox compile time. A closed union blocks coherent events and UI once custom perspectives exist.

4. **Preserve built-in perspective behavior and prompts.**
   - Decision: Built-in perspectives continue to use current prompt files and specialized schema YAML (`reviewer-code`, `reviewer-security`, etc.). Extension perspectives use a generic reviewer prompt/schema with the extension prompt fragment appended in a provenance section naming extension, key, label, and description.
   - Rationale: Avoids forcing every extension perspective to define a full schema; keeps existing built-in behavior stable.

5. **Selection semantics are additive and observable.**
   - Decision: Review stage computes built-in applicable perspectives as today, then adds extension perspectives whose rules apply. Explicit `review.perspectives` should be honored if it includes extension keys; unknown keys should be diagnosed and skipped or fail planning according to existing config validation policy.
   - Rationale: Auto-application gives immediate value without needing planner/composer agents to know dynamic extension names. Explicit config support gives advanced users deterministic control.

6. **Diagnostics/events should show provenance, but not require UI-specific engine logic.**
   - Decision: Emit existing `plan:build:review:parallel:*` events with string perspectives; add decision metadata for extension perspectives in `perspectives-inferred` or a new companion decision/event such as `extension:reviewer-perspective:applied` if provenance cannot fit cleanly. Include `extensionName`, `extensionPath`, `key`, `label`, and applicability rationale where practical.
   - Rationale: Engine emits typed events; consumers render. Provenance helps users understand why a custom reviewer ran.

7. **Failure policy: fail-open for applicability/prompt-resolution failures; reviewer execution errors remain per-perspective errors.**
   - Decision: If an extension applicability rule fails, emit a diagnostic and do not include that perspective for the round. If the reviewer agent for an included extension perspective fails, emit `plan:build:review:parallel:perspective:error` as today.
   - Rationale: Reviewer perspectives should improve quality, not unexpectedly block builds unless they produce review issues that existing evaluator/fixer flow handles.

8. **Adaptive respawn should support dynamic strings.**
   - Decision: `selectNextReviewPerspectives` should operate on string perspective keys and preserve extension perspectives when they produced prior issues or overlap with evaluator file verdicts via their applicability rules. If overlap cannot be recomputed, keep extension perspectives with prior issues and otherwise allow them to drop.
   - Rationale: Maintains current adaptive review behavior while avoiding brittle built-in-only type guards.

9. **Docs and `/eforge:extend` must be updated in both integrations.**
   - Decision: Change runtime-deferred caveats to runtime-supported guidance, document security/trust, applicability rules, event visibility, and include a new example.
   - Rationale: Project convention requires `packages/pi-eforge/` and `eforge-plugin/` to stay in sync for consumer-facing behavior.

### Runtime and schema assumptions

Assumptions and unknowns tracked for validation:

- Assumption: event schemas can move from a closed built-in perspective union to bounded string keys while retaining built-in constants for docs/type ergonomics. This is cheap to validate via type-check/schema tests and has medium compatibility impact.
- Assumption: applicability rules can be implemented as pure read-only predicates over a bounded context (changed files/categories/diff stats/plan metadata) and executed fail-open with diagnostics, without exposing engine state mutation. This needs design/test validation but follows existing extension timeout/diagnostic patterns.
- Unknown: whether planning/composer agents should be taught to select extension perspectives in `review.perspectives`, or whether extension perspectives should only be auto-applied by applicability rules in the review stage. The safer initial direction is auto-application plus visibility in diagnostics, avoiding planner dependence on dynamic extension names.

### Likely code impact

- SDK public contract:
  - `packages/extension-sdk/src/hooks.ts` currently defines `ReviewerPerspectiveSpec` as `{ key, label, promptFragment }` only.
  - `packages/extension-sdk/src/api.ts` says runtime is not wired.
  - `packages/extension-sdk/src/index.ts` may need exports if new context/helper types are added.
- Engine extension registration validation:
  - `packages/engine/src/extensions/types.ts` mirrors the minimal spec.
  - `packages/engine/src/extensions/recorder.ts` validates only `key`, `label`, and `promptFragment`; should validate description/applicability shape and reject invalid/duplicate/built-in-conflicting keys.
  - `packages/engine/src/extensions/projector.ts` currently exposes only counts, not detailed perspective metadata; list/show diagnostics may need richer projection if accepted.
- Review perspective model and heuristics:
  - `packages/engine/src/review-heuristics.ts` defines the closed built-in `ReviewPerspective` union and category rules.
  - `packages/engine/src/review-cycle-perspectives.ts` adapts perspectives across rounds and currently assumes the built-in union.
  - Need a representation that distinguishes built-in vs extension perspective but can still flow through arrays and map keys.
- Review execution:
  - `packages/engine/src/agents/parallel-reviewer.ts` maps perspective names to prompt files and schema getters. Extension perspectives need prompt composition from the extension `promptFragment`, likely using a generic review issue schema and maybe the base `reviewer` prompt plus a provenance section.
  - `packages/engine/src/pipeline/stages/build-stages.ts` calls `runParallelReview` and tracks perspective metadata with built-in-only type guards. It will need dynamic string-safe tracking.
  - `packages/engine/src/pipeline/types.ts`, `packages/engine/src/eforge.ts`, and possibly `packages/engine/src/pipeline/runners.ts` need to carry `extensionRegistry` or just reviewer perspective registrations into build stage context.
- Event wire schema and types:
  - `packages/client/src/events.schemas.ts` exports `REVIEW_PERSPECTIVES` and `ReviewPerspectiveSchema` as a closed union. Dynamic extension perspective keys likely require using a bounded string schema for event fields and review config while retaining built-in constants.
  - Decision schemas for `perspectives-inferred` and `perspectives-respawned` currently use closed perspective arrays.
  - `packages/client/src/__tests__/events*.test.ts` likely need schema/wire-parity updates.
- Plan/review config parsing:
  - `packages/engine/src/schemas.ts`, `packages/engine/src/plan.ts`, `test/plan-parsing.test.ts`, and related composer tests likely assume closed perspective values.
- CLI/monitor representation:
  - `packages/eforge/src/cli/display.ts` prints perspective names from review events and should handle extension names/provenance gracefully.
  - `packages/monitor-ui/src/lib/reducer/*`, `packages/monitor-ui/src/lib/decision-format.ts`, `packages/monitor-ui/src/components/pipeline/*`, and timeline/event-card components already mostly display perspective strings, but type/schema assumptions and detail rendering may need updates.
- Extension docs/authoring UX:
  - `docs/extensions.md`
  - `docs/extensions-api.md`
  - `examples/extensions/README.md`
  - a new `examples/extensions/reviewer-perspective.ts`
  - `packages/pi-eforge/skills/eforge-extend/SKILL.md`
  - `eforge-plugin/skills/extend/extend.md`
- Tests:
  - Extend `test/extension-loader.test.ts` for spec validation/duplicate behavior.
  - Add runtime tests, probably near `test/review-cycle-adaptive.test.ts` or a new `test/extension-reviewer-perspective-runtime.test.ts`, using `StubHarness` to assert extension prompts route to reviewer runs and events include the dynamic perspective.
  - Add schema tests for dynamic perspective keys and no regression for built-ins.

Evidence-backed conclusion: the change is cross-cutting but cohesive around a single review-stage extension point. It should avoid adding new orchestration phases and reuse existing extension loader, registry, review-cycle, event, and monitor pathways.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Dynamic perspective keys require loosening the closed built-in TypeBox union in event/config schemas. | Verified `packages/client/src/events.schemas.ts` uses a closed `ReviewPerspectiveSchema`; engine heuristics also use a closed union. | High | Low | Update schema/tests and run `pnpm type-check` / relevant Vitest suites. | If wrong, extension keys may fail event validation or config parsing at runtime. |
| A bounded read-only applicability context is sufficient for useful custom perspectives. | PRD examples and use cases mostly depend on changed files/categories; current `computeReviewThresholdSnapshot` and `categorizeFiles` already provide file/line/category inputs. | Medium | Medium | Implement representative example (`accessibility` for TSX/UI files) and runtime tests; document limits. | If too weak, users may fall back to unsafe agent hooks or request arbitrary stage APIs. |
| Applicability functions, if supported, can be timeout-bounded and fail-open using existing extension diagnostic patterns. | Existing event hooks, agent hooks, profile routers, and policy gates already use timeout/failure diagnostics. Reviewer applicability runtime does not exist yet. | Medium | Medium | Reuse/abstract timeout helpers if available; add tests for throw/timeout/invalid return. | If wrong, review selection may become flaky or block builds unexpectedly. |
| Planner/composer does not need dynamic extension awareness for initial runtime value. | Current review stage can infer perspectives from changed files; PRD accepts visibility in planning/diagnostics/monitor, not necessarily planner-chosen perspectives. | Medium | Low | Ship auto-applicability and explicit `review.perspectives`; optionally add planning diagnostics of registered perspectives. | If wrong, users may expect generated plans to explicitly name extension perspectives. |
| Existing monitor/CLI rendering mostly handles perspective names as strings once schema types accept them. | Code search shows monitor and CLI frequently join/display `event.perspectives` and `event.perspective`; reducer tests already use non-built-in string `correctness` for an error event. | Medium | Low | Run monitor UI tests and add dynamic perspective fixtures. | If wrong, UI may compile-fail or omit details for extension perspectives. |
| Extension perspective prompts can safely use generic review issue schema rather than custom schemas. | Built-in reviewer has a generic `reviewer.md` + `getReviewIssueSchemaYaml`; specialized built-ins have per-perspective schemas. Extension spec does not currently include schema customization. | Medium | Low | StubHarness test that a custom prompt runs and `parseReviewIssues` can parse output. | If wrong, custom perspectives may produce lower-quality/less-typed issues; schema customization may become a follow-up. |
| Passing reviewer perspective registrations into build stage context is the narrowest runtime plumbing. | `EforgeEngine` already stores full `extensionRegistry`; build context currently lacks it while scheduler/orchestrator receive subsets for other extension features. | High | Low | Extend `PipelineContext`/`BuildStageContext` with a `Pick<NativeExtensionRegistry, 'reviewerPerspectives'>` and type-check. | If wrong, wiring may need broader refactor but still localized to pipeline context. |

No low-confidence/high-impact assumptions remain unresolved. The main design risk is the exact applicability API shape; it is bounded by tests/docs and can start with declarative rules plus an optional function only if implementable safely.

### Profile signal

Recommended profile: **Excursion**.

Rationale: This is a cross-cutting feature spanning SDK contracts, engine review runtime, event schemas, CLI/monitor representation, tests, examples, and docs. However, the work is cohesive around one extension point and can be planned as a single sequential dependency chain: contract/schema foundation → engine runtime wiring → consumer rendering/docs/tests. It does not require independent module planners or expedition-scale delegated architecture planning. Errand is too small because schema/runtime/UI/docs interactions need plan review.

## Scope

### In scope

- Promote `registerReviewerPerspective` from deferred/provenance-only to runtime-supported for post-build `review-cycle` parallel reviews.
- Extend the SDK/engine `ReviewerPerspectiveSpec` with description and bounded applicability rules while preserving or migrating the existing `{ key, label, promptFragment }` shape.
- Wire loaded `reviewerPerspectives` from `NativeExtensionRegistry` into build-stage review execution.
- Allow extension perspective keys to participate in review perspective selection alongside built-ins when either:
  - explicitly configured in `review.perspectives`, or
  - selected by their applicability rules during auto inference.
- Compose reviewer prompts for extension perspectives using a generic reviewer prompt/schema plus the extension prompt fragment and provenance metadata.
- Emit coherent events/decisions for dynamic perspectives, including extension provenance where practical, and update CLI/monitor rendering to display them without treating them as invalid.
- Update diagnostics/list/show/test summaries so registered reviewer perspectives are visible with useful metadata.
- Update `docs/extensions.md`, `docs/extensions-api.md`, `examples/extensions/README.md`, and both `/eforge:extend` skill files to say reviewer perspectives are runtime-supported and explain limitations.
- Add a reviewer-perspective example extension.
- Add focused tests for registration validation, applicability, runtime review dispatch, events/schema, and UI/CLI formatting where relevant.

### Out of scope

- `registerValidationProvider` runtime execution (EXTEND_12B).
- Arbitrary compile/build stage registration.
- Approval workflows or stateful/mutating applicability decisions.
- Planner/composer architecture overhaul. If dynamic planner selection is risky, the initial implementation may auto-apply extension perspectives by applicability rules and document explicit `review.perspectives` support.
- Sandboxing untrusted extension code. Existing trust model remains the boundary; applicability contexts should be read-only but extensions are still trusted code.

## Acceptance Criteria

- Extension authors can register reviewer perspectives with `key`, `label`, `description`, `promptFragment`, and bounded applicability rules.
- Invalid reviewer perspective registrations are rejected or diagnosed with stable extension diagnostics, including invalid keys, missing fields, duplicate keys, and built-in key conflicts.
- Registered reviewer perspectives are visible in extension list/show/validate/test summaries with enough metadata to understand key, label, description, extension provenance, and applicability shape.
- During `review-cycle`, applicable extension perspectives can run alongside built-in perspectives when review is parallelized or explicitly configured.
- Extension reviewer prompts include the extension prompt fragment and provenance, and built-in reviewer prompts continue to behave as before.
- Applicability evaluation receives only read-only/bounded context and cannot mutate engine state through documented contracts; failures/timeouts are observable and fail open.
- Review lifecycle events and build decision events accept and display extension perspective keys coherently; monitor UI and CLI do not reject or hide dynamic perspective names.
- Adaptive review-cycle perspective selection handles extension perspective keys without dropping them due to built-in-only type guards.
- Docs (`docs/extensions.md`, `docs/extensions-api.md`, examples README) and both `/eforge:extend` skill files describe reviewer perspectives as runtime-supported and explain limitations/security.
- A reviewer-perspective example extension is added and referenced by docs/skills.
- Tests cover SDK/loader validation, runtime selection/applicability, prompt dispatch with `StubHarness`, event schema acceptance for dynamic keys, and at least one CLI/monitor formatting path.
- Validation providers and arbitrary compile/build stage registration remain deferred/out of scope.
