---
title: Conservatively remove high-confidence low-value automated tests to reduce execution time.
created: 2026-05-24
onSuccess: issue-pr
---

# Conservatively remove high-confidence low-value automated tests to reduce execution time.



## Goal

Reduce automated test execution time by removing tests that are clearly low-value, redundant, brittle, or misleading while preserving meaningful behavioral coverage.

Focus on high-confidence removals only. Prefer no change over risky removal.

## Out of scope

- Do not remove tests that provide unique coverage of important behavior.
- Do not remove regression tests for known historical bugs unless clearly obsolete.
- Do not perform broad test architecture rewrites.
- Do not replace test frameworks or restructure large test suites.
- Do not remove tests solely because they are slow if they provide important unique coverage.

## Acceptance criteria

- Identify and remove only tests with strong evidence of low value, such as:
  - Duplicate coverage already exercised by a clearer or higher-value test.
  - Tests that mostly validate mocks, stubs, or framework/library behavior rather than production behavior.
  - Brittle implementation-detail tests that fail on harmless refactors.
  - Tests for dead, deprecated, unreachable, or removed behavior.
  - Broad snapshots with frequent unrelated churn and little behavioral signal.
  - Low-assertion tests that only check that code does not throw without validating meaningful outcomes.
- Preserve tests covering critical user-visible behavior, edge cases, security-sensitive behavior, data integrity, and known regressions.
- Run the relevant test command after changes.
- Summarize each removed test and the rationale for removal.
- If confidence is uncertain, leave the test in place and mention it as a possible future review candidate.

## Notes for the planner

Be conservative. This playbook should be safe to run autonomously. Favor removing obviously redundant or misleading tests, not making judgment-heavy tradeoffs.
