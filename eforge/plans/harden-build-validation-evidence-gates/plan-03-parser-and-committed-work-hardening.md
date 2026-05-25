---
id: plan-03-parser-and-committed-work-hardening
name: Reviewer Parser and Committed Work Hardening
branch: harden-build-validation-evidence-gates/plan-03-parser-and-committed-work-hardening
agents:
  builder:
    effort: high
    rationale: Tightens fail-closed parser contracts and git state semantics that
      can affect build success.
  tester:
    effort: high
    rationale: Parser fixture churn and git-state tests need careful edge-case validation.
---

# Reviewer Parser and Committed Work Hardening

## Architecture Context

Build reviewers already use strict XML parsing, but planning, architecture, and cohesion reviewers still use the legacy fail-open parser. Built-on-merge plan merging also rejects dirty work but allows clean no-op success. This plan closes those remaining evidence gaps.

## Implementation

### Overview

Tighten strict XML parsing, migrate planning review agents to strict behavior or document an explicit advisory-only exception in code/tests, and enforce committed changes for built-on-merge plans using the recorded `baseSha`. Intentional no-op plans require the waiver config added in plan-01.

### Key Decisions

1. Keep the legacy `parseReviewIssues()` function only for explicitly named compatibility use; strict reviewers use `parseReviewIssuesStrict()`.
2. Enforce the terminal-block contract: exactly one `<review-issues>` block and only whitespace after its closing tag.
3. Treat a present but non-numeric `line` attribute as a contract violation.
4. Use `managed.baseSha` versus `HEAD` for built-on-merge no-op detection after drift recovery and dirty-work checks.
5. If `allowNoCommittedChanges` is configured, emit a `planning:progress` waiver message and continue; otherwise throw during merge so the plan fails before validation and artifact recording.

## Scope

### In Scope

- Tighten `parseReviewIssuesStrict()` for trailing prose and invalid optional numeric attributes.
- Rename or annotate the legacy parser so future use sites are intentional.
- Migrate `plan-reviewer`, `architecture-reviewer`, and `cohesion-reviewer` to strict parser behavior, or add explicit advisory-only handling with tests if a builder finds their outputs must remain non-blocking.
- Update tests and fixtures for build reviewer, parallel reviewer, plan reviewer, architecture reviewer, and cohesion reviewer.
- Add built-on-merge committed-diff enforcement to `WorktreeManager.mergePlan()`.
- Wire `validationPolicy.allowNoCommittedChanges` into merge behavior through `executePlans()` / `mergePlan()` options.
- Add tests for dirty work, clean no-op without waiver, clean no-op with waiver, and successful committed diff.
- Assert artifact recording is not reached for dirty or no-op failures.

### Out of Scope

- Replacing XML output with JSON.
- Changing review issue categories.
- Enforcing no-op detection for dedicated worktree squash merges unless existing merge behavior already exposes the same check.
- UI rendering.

## Files

### Modify

- `packages/engine/src/agents/reviewer.ts` — strict parser terminal semantics, invalid `line` handling, and legacy parser naming/comment updates.
- `packages/engine/src/agents/parallel-reviewer.ts` — adjust to any strict parser return shape changes.
- `packages/engine/src/agents/plan-reviewer.ts` — use strict parsing or explicit tested advisory exception.
- `packages/engine/src/agents/architecture-reviewer.ts` — use strict parsing or explicit tested advisory exception.
- `packages/engine/src/agents/cohesion-reviewer.ts` — use strict parsing or explicit tested advisory exception.
- `packages/engine/src/worktree-manager.ts` — compare `managed.baseSha` to `HEAD` / `baseSha..HEAD`, reject no committed diff unless waived, and keep dirty-work rejection first.
- `packages/engine/src/orchestrator/phases.ts` — pass no-committed-change waiver options into `mergePlan()` and emit waiver progress messages.
- `test/xml-parsers.test.ts` — add strict trailing prose and invalid line attribute tests; update fixtures that no longer satisfy terminal semantics.
- `test/plan-reviewer.test.ts` or nearest existing planning-reviewer test file — add missing/malformed XML behavior for plan reviewer.
- `test/architecture-reviewer.test.ts` or nearest existing architecture-reviewer test file — add missing/malformed XML behavior for architecture reviewer.
- `test/cohesion-reviewer.test.ts` or nearest existing cohesion-reviewer test file — add missing/malformed XML behavior for cohesion reviewer.
- `test/orchestration-logic.test.ts` — add built-on-merge no committed diff and waiver coverage.
- `test/stack-artifact-recording.test.ts` — assert no artifact registry write after no-op merge failure.

## Verification

- [ ] `parseReviewIssuesStrict('...<review-issues></review-issues> trailing')` returns `valid:false` with a synthetic critical issue.
- [ ] `parseReviewIssuesStrict()` returns `valid:false` when an issue has `line="abc"`.
- [ ] Build reviewer and parallel reviewer tests still produce parsed issues for valid terminal XML.
- [ ] Planning, architecture, and cohesion reviewer malformed-output tests match the chosen strict-or-advisory policy.
- [ ] A built-on-merge plan with dirty files fails with the existing dirty-work error before no-op checks run.
- [ ] A built-on-merge plan with `HEAD === baseSha` fails merge without `allowNoCommittedChanges`.
- [ ] A built-on-merge plan with `HEAD === baseSha` succeeds only when `allowNoCommittedChanges` and `noCommittedChangesReason` are configured.
- [ ] Artifact recording is not called for dirty-work or no-committed-diff failures.