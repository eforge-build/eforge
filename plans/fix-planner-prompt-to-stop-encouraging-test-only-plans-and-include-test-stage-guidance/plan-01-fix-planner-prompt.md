---
id: plan-01-fix-planner-prompt
name: Fix Planner Prompt and Profile Generation Test Stage Guidance
depends_on: []
branch: fix-planner-prompt-to-stop-encouraging-test-only-plans-and-include-test-stage-guidance/fix-planner-prompt
---

# Fix Planner Prompt and Profile Generation Test Stage Guidance

## Architecture Context

The planner agent uses two sources of instructions: a static prompt template (`src/engine/prompts/planner.md`) and a dynamically generated section from `formatProfileGenerationSection()` in `src/engine/agents/planner.ts`. Both need updates to stop encouraging test-only plans and to add test stage awareness.

The static prompt already has comprehensive test stage guidance in the "Per-Plan Build and Review Configuration" section (lines 346-358). The problem is a contradictory suggestion on line 100 and missing test stage guidance in the dynamic Stage Customization section.

## Implementation

### Overview

Two targeted text edits:
1. Replace the test-only plan split pattern in `planner.md` with anti-pattern guidance
2. Add `test-cycle` and `test-write` stage guidance to the Stage Customization section in `formatProfileGenerationSection()`

### Key Decisions

1. Keep the "Split large plans" section structure intact - only replace the problematic bullet point and add an anti-pattern note
2. Mirror the existing `doc-update` guidance pattern (Adding/Omitting/When) for test stages in the Stage Customization section
3. Reference `test-cycle` and `test-write` with concrete stage array examples, matching the style already used in the Per-Plan Build and Review Configuration section

## Scope

### In Scope
- `src/engine/prompts/planner.md` line 100: replace test-only plan split pattern
- `src/engine/agents/planner.ts` `formatProfileGenerationSection()`: add test stage guidance after `doc-update` guidance

### Out of Scope
- `planner.md` "Per-Plan Build and Review Configuration" section (already has correct guidance)
- Pipeline stage implementations
- Tester agent code
- Any other prompt files

## Files

### Modify
- `src/engine/prompts/planner.md` - Replace line 100's "test updates (plan-02)" split pattern with anti-pattern guidance that directs users to use `test-cycle` in build stages instead. Add an explicit "Do NOT create separate test-only plans" bullet.
- `src/engine/agents/planner.ts` - In `formatProfileGenerationSection()`, add three new paragraphs to the Stage Customization section (after the `doc-update` guidance, before the Parallel groups paragraph): guidance for adding `test-cycle`, TDD with `test-write`, and when to omit test stages. Follow the same bold-label pattern used by the `doc-update` paragraphs.

## Verification

- [ ] `planner.md` line 100 no longer contains "test updates (plan-02)" as a split pattern
- [ ] `planner.md` contains explicit anti-pattern note about not creating separate test-only plans
- [ ] `formatProfileGenerationSection()` output includes `test-cycle` guidance with example stage array
- [ ] `formatProfileGenerationSection()` output includes `test-write` TDD guidance with example stage array
- [ ] `formatProfileGenerationSection()` output includes guidance on when to omit test stages
- [ ] `pnpm build` exits with code 0
- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` passes with no new failures
