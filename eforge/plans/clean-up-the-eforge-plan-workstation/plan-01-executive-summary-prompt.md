---
id: plan-01-executive-summary-prompt
name: Executive Summary Prompt and Regression Coverage
branch: clean-up-the-eforge-plan-workstation/plan-01-executive-summary-prompt
---

# Executive Summary Prompt and Regression Coverage

## Architecture Context

The eforge-plan planning draft prompt lives in the engine prompt bundle, but the generated session-plan content is owned by the eforge-plan extension and the `@eforge-build/input` session-plan adapter. Current persistence, rendering, and normalization support for `## Executive Summary` exists; this plan closes the remaining prompt-specific gap and locks the behavior with focused assertions.

## Implementation

### Overview

Tighten the planning draft prompt so `summary` for session-plan creation drafts explicitly covers the four review anchors required by the source: changed surfaces, intended direction, out-of-scope boundaries, and validation/build confidence. Extend existing focused tests instead of rewriting the already-present executive-summary UI, persistence, or build-source flow.

### Key Decisions

1. Keep prompt edits minimal and additive: retain the existing `summary` contract and append explicit content requirements for session-plan creation drafts.
2. Reuse current tests that already exercise persistence, plan-detail rendering, legacy fallback, progressive disclosure, and build-source normalization; add missing prompt assertions for the new required terms.
3. Do not move eforge-plan prompt ownership out of `packages/engine/src/prompts/`.

## Scope

### In Scope

- Update `packages/engine/src/prompts/eforge-plan-planning-draft.md` so summary guidance names changed surfaces, intended direction, out-of-scope boundaries, and validation/build confidence.
- Extend `test/prompts.test.ts` to assert those exact prompt concepts.
- Audit existing tests in `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts`, `test/normalize-build-source.test.ts`, and `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-summary.test.tsx`; add only missing assertions if the current coverage does not satisfy the source.

### Out of Scope

- Replacing the plan-detail editor.
- Changing session-plan storage format.
- Moving eforge-plan prompts out of the engine prompt bundle.

## Files

### Modify

- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — expand the `summary` output-contract bullet with the four required executive-summary anchors.
- `test/prompts.test.ts` — assert prompt content includes changed surfaces, intended direction, out-of-scope boundaries, and validation/build confidence guidance.
- `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts` — add bounded assertions only if the existing persistence/build-source assertions miss a source criterion.
- `test/normalize-build-source.test.ts` — add bounded assertions only if the existing normalization assertions miss executive-summary inclusion or ordering.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail-summary.test.tsx` — add bounded assertions only if current fallback/progressive-disclosure coverage misses a source criterion.

## Verification

- [ ] `pnpm vitest run test/prompts.test.ts` passes and includes assertions for all four summary anchors.
- [ ] Existing executive-summary tests still prove persistence, plan-detail rendering, legacy fallback, progressive disclosure, and build-source normalization.
- [ ] `packages/engine/src/prompts/eforge-plan-planning-draft.md` contains the phrases or equivalent explicit requirements for changed surfaces, intended direction, out-of-scope boundaries, and validation/build confidence.
