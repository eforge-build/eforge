---
title: Fix planner prompt to stop encouraging test-only plans and include test stage guidance
created: 2026-03-27
status: pending
---



# Fix planner prompt to stop encouraging test-only plans and include test stage guidance

## Problem / Motivation

The planner creates redundant test-only plans (e.g. `plan-02-tests`) instead of including `test-cycle` in the main plan's build stages. Two root causes:

1. `planner.md` line 97-98 explicitly suggests "Source changes first (plan-01), then test updates (plan-02)" as a "common split pattern."
2. The `formatProfileGenerationSection()` in `src/engine/agents/planner.ts` only has Stage Customization guidance for `doc-update` - no mention of `test-cycle`, `test-write`, or when to include test stages.

The tester/test-writer agents exist and are fully registered (`test-write`, `test`, `test-fix`, `test-cycle` stages in `pipeline.ts`) but the planner never considers them because the profile generation prompt doesn't mention them.

## Goal

The planner should (a) stop creating separate test-only plans and (b) start including `test-cycle` in build stage configs for plans with testable behavior.

## Approach

Two changes, both scoped to the planner:

### 1. Update `src/engine/prompts/planner.md` (line 97-98)

- Replace the "Split large plans" common split pattern that suggests "test updates (plan-02)" with guidance that tests belong in the same plan via `test-cycle`.
- Add an explicit anti-pattern: "Do NOT create separate test-only plans. Tests are validated and fixed by the tester agent during test-cycle - include test-cycle in the plan's build stages instead."
- Keep the critical rule about not splitting type changes from consumers.

### 2. Update `src/engine/agents/planner.ts` — `formatProfileGenerationSection()`

In the "Stage Customization" section (around line 120-128), add test stage guidance parallel to the existing `doc-update` guidance:

- **Adding `test-cycle`** - When the plan has testable behavior (new features, bug fixes, refactors that change behavior, changes to files with corresponding test files), include `test-cycle` after `implement`. Examples:
  - `[implement, test-cycle, review-cycle]`
  - Parallelized: `[implement, [test-cycle, review-cycle]]`
  - Explain that the tester agent runs tests, classifies failures as test bugs vs production bugs, and fixes test bugs automatically.
- **TDD with `test-write`** - For well-specified features with clear acceptance criteria, use `test-write` before `implement`: `[test-write, implement, test-cycle]`.
- **Omitting test stages** - Skip for config changes, simple refactors with no behavioral change, doc-only work, or dependency updates.

## Scope

**In scope:**
- `src/engine/prompts/planner.md`
- `src/engine/agents/planner.ts`

**Out of scope:**
- `pipeline.ts` - no changes needed
- Tester agents - no changes needed
- Test stage implementations - already correct

## Acceptance Criteria

1. `planner.md` no longer suggests test-only plans as a split pattern.
2. `formatProfileGenerationSection()` includes `test-cycle` and `test-write` guidance.
3. `pnpm build` passes.
4. `pnpm type-check` passes.
5. Existing tests pass.
