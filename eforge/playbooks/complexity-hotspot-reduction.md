---
name: complexity-hotspot-reduction
description: Run a complexity audit, pick top hotspots, and plan focused refactors
scope: project-team
mode: planning
---

## Goal

Run `pnpm complexity:scan` to generate a sorted cognitive-complexity × churn report for the codebase. Read the source code for the top 3 hotspot entries. Produce a session plan whose acceptance criteria are specific, targeted function refactors.

**Decision rule** - apply before drafting the session plan:

- **Single huge function (CC > 500)**: focus the entire session plan on that one function. Do not add unrelated hotspots to the same plan.
- **Otherwise (multiple medium hotspots)**: pick 2-3 hotspots whose combined scope fits a single build session. Prefer hotspots with high churn - the code changes often, so simplifying it pays ongoing dividends.

The goal of planning is to produce a session plan that an eforge build can execute without additional human decision-making. All refactor approaches and CC targets must be decided during planning.

## Out of scope

- Speculative redesigns or architectural rethinks not directly motivated by the complexity score.
- Refactors that change the public API surface of a module or package (function signatures, exported types, protocol compatibility).
- Performance tuning unrelated to complexity reduction.
- Hotspots in `**/test/**`, `**/dist/**`, or `**/node_modules/**` - the scan already excludes these.

## Acceptance criteria

For each hotspot selected for the session plan:

- The refactor approach is explicitly chosen and named (e.g., table-driven dispatch, extract-helper functions, split-by-discriminant, early-return flattening).
- A specific CC target is stated (e.g., "reduce from 924 to ≤ 30 across extracted helpers").
- The session plan's `code-impact` dimension lists every file the refactor will touch.
- No acceptance criterion requires re-running the complexity scan to verify - the criteria describe code structure, not tool output.

## Notes for the planner

**Re-running the scan during planning**: `pnpm complexity:scan` is available at `scripts/scan-complexity.mjs`. Run it to get fresh numbers if you need to verify a hotspot's current score or confirm that a candidate was correctly identified.

**Decision rule reminder**: single CC > 500 outlier - one focused plan for that function only. Otherwise pick 2-3 medium hotspots. Do not try to address the entire table in one session - the payoff comes from depth, not breadth.

**Generic by design**: This playbook was authored to work in any codebase that runs the complexity scan script. The `eforge-plugin-*` skills that surface it must remain generic - do not hard-code file paths, package names, or function names from this repo's current scan output into the playbook itself. Those specifics belong in the seeded session plan, which is generated fresh each time this playbook is run.
