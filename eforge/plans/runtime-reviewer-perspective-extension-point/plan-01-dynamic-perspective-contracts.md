---
id: plan-01-dynamic-perspective-contracts
name: Dynamic Perspective Contracts and Schema Foundation
branch: runtime-reviewer-perspective-extension-point/plan-01-dynamic-perspective-contracts
agents:
  builder:
    effort: high
    rationale: This plan changes shared wire schemas and public TypeScript types
      consumed across engine, client, monitor, and planning code; a thorough
      pass is needed to avoid type drift.
  reviewer:
    effort: high
    rationale: Schema and API compatibility changes affect daemon/client boundaries
      and need careful review.
---

# Dynamic Perspective Contracts and Schema Foundation

## Architecture Context

Reviewer perspectives are currently represented as the built-in union `code | security | api | docs | test | verify` in client wire schemas, engine config schemas, review heuristics, adaptive review selection, and planning prompts. Runtime extension keys cannot be enumerated at build time, so the shared contract must first accept bounded string perspective identifiers while preserving built-in constants for default heuristics and agent guidance.

## Implementation

### Overview

Introduce a reusable review perspective key contract, loosen review config/event/decision schemas from the closed built-in union to safe strings, and update engine consumers so existing built-in behavior keeps working before extension runtime is wired in the next plan.

### Key Decisions

1. Keep `REVIEW_PERSPECTIVES` as the built-in list for defaults, prompts, examples, and built-in prompt dispatch, but add a string key schema/type for runtime perspective identifiers.
2. Use a single safe slug rule for dynamic perspective keys across client schemas, engine config, plan parsing, and extension validation in later plans. Recommended rule: lowercase slug starting with a letter, containing lowercase letters, digits, and hyphens, with a bounded length such as 1-64 chars.
3. Built-in-only maps in `parallel-reviewer.ts` must be guarded by an `isBuiltInReviewPerspective()` helper rather than casting arbitrary strings into the built-in union.

## Scope

### In Scope

- Add/export a bounded `ReviewPerspectiveKey` string type or schema in `packages/client/src/events.schemas.ts` while retaining `REVIEW_PERSPECTIVES` as built-ins.
- Update `ReviewProfileConfig` in `packages/client/src/types.ts` to use dynamic perspective strings.
- Update `ReviewProfileConfigSchema`, planning decision schemas, build decision schemas, and review lifecycle schemas in `packages/client/src/events.schemas.ts` to accept dynamic perspective keys.
- Update `packages/engine/src/config.ts` and `packages/engine/src/schemas.ts` so config and orchestration parsing accept syntactically valid custom perspective keys.
- Update planner/module-planner/pipeline-composer prompt variables or descriptions that currently say only built-in perspectives are valid; keep guidance that generated plans normally use built-ins unless a project explicitly configures extension keys.
- Refactor `packages/engine/src/review-heuristics.ts` to distinguish built-in perspective literals from dynamic `ReviewPerspective` strings.
- Refactor `packages/engine/src/review-cycle-perspectives.ts` and call sites in `packages/engine/src/pipeline/stages/build-stages.ts` to use dynamic strings for adaptive state while preserving built-in concern inference.
- Update built-in prompt dispatch in `packages/engine/src/agents/parallel-reviewer.ts` so unknown dynamic keys are not indexed into built-in prompt/schema maps before plan 2 adds extension dispatch.
- Update tests that assert invalid custom perspective config, schemas, and decisions.

### Out of Scope

- Executing registered extension reviewer perspectives.
- Extending `ReviewerPerspectiveSpec` with applicability metadata.
- Documentation/examples beyond any prompt text needed for compile-time schema changes.

## Files

### Modify

- `packages/client/src/events.schemas.ts` — add dynamic key schema; update review profile, planning decision, build decision, and review event schemas; export the derived type.
- `packages/client/src/types.ts` — change `ReviewProfileConfig.perspectives` to dynamic perspective keys.
- `packages/client/src/events.ts`, `packages/client/src/index.ts`, `packages/client/src/browser.ts` — keep exports aligned if a new key type/helper is exported.
- `packages/engine/src/config.ts` — replace `z.enum(REVIEW_PERSPECTIVES)` with the shared safe-key validation for review profiles.
- `packages/engine/src/schemas.ts` — replace TypeBox literal union arrays with the dynamic key schema for plan/orchestration review config.
- `packages/engine/src/review-heuristics.ts` — export built-in perspective type/helper and dynamic perspective alias.
- `packages/engine/src/review-cycle-perspectives.ts` — make adaptive selection string-safe while built-in concern inference remains category-based.
- `packages/engine/src/pipeline/stages/build-stages.ts` — remove built-in-only guards that drop dynamic strings in metadata/error tracking.
- `packages/engine/src/agents/parallel-reviewer.ts` — guard built-in prompt/schema lookup; emit a typed diagnostic or skip unknown dynamic keys until extension runtime support is added in plan 2.
- `packages/engine/src/agents/planner.ts`, `packages/engine/src/agents/module-planner.ts`, `packages/engine/src/agents/pipeline-composer.ts` — update perspective guidance strings.
- `packages/monitor-ui/src/components/console/plan-tab.tsx`, `packages/monitor-ui/src/components/plans/build-config.tsx` — verify type compatibility with dynamic strings and adjust annotations if needed.
- `test/parallel-reviewer-perspective-validation.test.ts` — update expectations from closed enum rejection to safe-key acceptance/rejection.
- `test/per-plan-build-config.test.ts`, `test/plan-parsing.test.ts`, `test/decisions.test.ts`, `test/schemas.test.ts`, `packages/client/src/__tests__/events-schemas.test.ts`, `packages/client/src/__tests__/events-wire-parity.test.ts` — add dynamic perspective fixtures and update schema expectations.
- `test/review-cycle-perspectives.test.ts`, `test/review-cycle-adaptive.test.ts` — add cases for dynamic strings preserved by adaptive state.

## Verification

- [ ] `pnpm type-check` exits 0 with `ReviewProfileConfig.perspectives` typed as dynamic strings across client, engine, and monitor packages.
- [ ] Event schema tests accept `plan:build:review:parallel:start`, perspective start/complete/error events, `perspectives-inferred`, and `perspectives-respawned` with a custom key such as `accessibility`.
- [ ] Config/plan parsing tests accept safe custom keys and reject unsafe values containing spaces, uppercase letters, path separators, or shell metacharacters.
- [ ] Existing built-in perspective tests still pass for all six built-ins.
- [ ] Adaptive review tests include a dynamic key and verify it remains in `previousActive`, `issuesByPerspective`, `perspectiveErrors`, and `dropped` arrays without built-in-only filtering.