---
title: Strip Temporary Eforge Plan-ID Region Markers During Cleanup
created: 2026-05-31
---

# Strip Temporary Eforge Plan-ID Region Markers During Cleanup

## Problem / Motivation

Temporary eforge region markers have accumulated in tracked source files even though their associated plan files are later removed. Plan-id markers are useful during builds for coordinating parallel/shared-file edits, but once plan files are removed, `plan-\d{2}-...` slugs lose useful meaning and create source noise.

Evidence gathered:

- `docs/llm-friendly-code.md` currently describes `// --- eforge:region <slug> ---` markers as long-lived structure for large files and says `pnpm maintainability:check` validates balance.
- `packages/engine/src/prompts/builder.md` instructs build agents to wrap additions to shared files in markers matching the plan/module id.
- `packages/engine/src/prompts/planner.md` says architecture planners declare shared-file regions but do not write marker comments directly; module planners/builders later emit precise region boundaries.
- `packages/engine/src/cleanup.ts` only removes generated plan files and optional PRD provenance artifacts, then commits the removal. It does not inspect changed source files or strip marker comments.
- Cleanup is invoked through `runCleanup` in `packages/engine/src/landing.ts`; stacked PR landing reuses the same cleanup path from `packages/engine/src/stacking/landing.ts`.
- Tests covering cleanup behavior include `test/prd-artifact.test.ts` and `test/stack-landing-cleanup.test.ts`; maintainability marker balance tests live in `test/agent-maintainability-check.test.ts`.
- A repository scan found 150 distinct region slugs, including 130 slugs matching `plan-\d{2}-...` across 173 files. This validates the user’s observation that ephemeral plan-id markers have accumulated in tracked source.
- Roadmap alignment: this is not a roadmap feature, but it supports the Integration & Maturity goal by reducing generated build artifacts leaking into maintained source.

Current interpretation:

- Plan-id markers are useful during a build for coordinating parallel/shared-file edits.
- Once plan files are removed, plan-id slugs lose useful meaning and create source noise.
- Semantic markers such as `types`, `path-normalization`, and `provenance-collection` may still be useful durable structure and should not be stripped by a cleanup pass unless policy changes explicitly require that.

## Goal

Implement automatic cleanup of temporary eforge region marker comment lines whose slug is a run-scoped plan/module id, and perform a one-time cleanup of existing tracked source markers that match that temporary form.

The cleanup must remove only marker comment lines, preserve all code inside marked regions, preserve semantic/durable non-plan markers, and include marker stripping in the existing successful-build cleanup commit.

## Approach

Add a deterministic marker-stripping implementation and wire it into the existing cleanup path before the cleanup commit created by `cleanupPlanFiles`.

Primary implementation targets:

- `packages/engine/src/cleanup.ts`
  - Import and call a marker-cleanup helper during `cleanupPlanFiles`, after plan/PRD deletions are staged and before `forgeCommit`.
  - Ensure marker-stripped files are staged with `git add` before the cleanup commit.
  - Keep cleanup non-fatal semantics: failures emit `planning:progress` and still pair `cleanup:start` / `cleanup:complete`.

- New focused helper, likely `packages/engine/src/region-marker-cleanup.ts`
  - Export a pure content helper such as `stripTemporaryEforgeRegionMarkerLines(content)` for unit tests.
  - Export a repo helper such as `stripTemporaryEforgeRegionMarkers(cwd)` that scans tracked source files via `git ls-files -z`, filters supported JS/TS extensions, skips generated/vendor directories, rewrites only changed files, stages those files, and returns a small summary for optional progress/debug use.
  - Match temporary marker lines using whole-line patterns for JS/TS line comments and JSX/TSX block-comment marker lines whose slug matches `plan-\d{2}-...`.
  - Preserve non-temporary slugs and all non-marker content.

- `packages/engine/src/prompts/builder.md`
  - Clarify that plan/module-id markers in shared files are temporary build-coordination markers and are removed by successful cleanup.

- `packages/engine/src/prompts/module-planner.md` and/or `packages/engine/src/prompts/planner.md`
  - Clarify that plan/module-region declarations are for build coordination, not permanent source organization.

- `docs/llm-friendly-code.md`
  - Split policy language into durable semantic region markers vs temporary build-coordination markers.
  - Document that cleanup strips `plan-\d{2}-...` markers and maintainability checks validate balance but do not require plan-id markers to remain.

- Tests
  - Add `test/region-marker-cleanup.test.ts` or extend existing cleanup tests.
  - Cover pure stripping behavior, preservation of semantic markers, JSX marker removal, and integration with `cleanupPlanFiles` in a real temporary git repo.

- Existing code cleanup
  - Remove tracked marker comment lines whose slug matches `plan-\d{2}-...` across implementation/test/source files.
  - Leave semantic markers in place.

Additional evidence:

- `cleanupPlanFiles` is the single plan-file cleanup implementation used by normal and stacked landing paths.
- Existing tests already exercise `cleanupPlanFiles` through real git repositories (`test/prd-artifact.test.ts`).
- A scan found 130 plan-like slugs across 173 files, so the one-time cleanup should be treated as a broad mechanical source edit and verified with `rg "eforge:(end)?region plan-\d{2}-"`.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| `plan-\d{2}-...` slugs are temporary plan/module identifiers, not durable maintainability sections. | Builder/module-planner prompts use plan/module ids for shared-file coordination; user confirmed screenshot marker includes a plan id whose plan file is later removed. Repo scan found many `plan-\d{2}-...` markers accumulated after prior builds. | High | Low | Review generated plan examples if needed; inspect current `.eforge` plan artifacts during an active build. | If wrong, cleanup could remove intentionally durable markers. Scope mitigates by stripping only marker lines and preserving code. |
| Semantic non-plan slugs should remain supported as durable maintainability markers. | `docs/llm-friendly-code.md` describes region markers for large-file logical sections; repository contains non-plan slugs such as `types`, `path-normalization`, and `provenance-collection`. | High | Low | Run `rg "eforge:(end)?region (types|path-normalization|provenance-collection)"`. | If wrong, durable markers might also be noise, but preserving them is safer than removing too much. |
| Scanning tracked JS/TS source files is sufficient for automated cleanup. | Maintainability script scans JS/TS implementation/test files; observed markers are in TypeScript/TSX/JS-family files. | Medium | Low | Run a broader `rg "eforge:(end)?region plan-\d{2}-"` after implementation to find missed comments in markdown or other file types. | If wrong, some plan-id markers remain outside scanned source files; acceptance criteria require a repo-wide search after the one-time cleanup. |
| Removing marker lines cannot change runtime behavior. | Markers are comments (`//` or JSX block comments) and do not wrap code in preprocessor directives. | High | Low | Unit tests compare output content; run type-check/test suite after cleanup. | If wrong due to unusual syntax/comment placement, type-check/tests fail. |
| Cleanup should remain non-fatal. | Existing `cleanupPlanFiles` catches cleanup errors and emits `planning:progress`; stacked landing tests assert cleanup failure does not block submit. | High | Low | Keep marker cleanup inside the existing try/catch and update/add tests around non-fatal behavior if needed. | If wrong, landing reliability regresses by failing a build after implementation succeeds. |
| The one-time existing-code cleanup can be broad and mechanical. | The user explicitly requested a cleanup pass of existing code; `maintainability:check` only checks marker balance and does not enforce marker presence. | High | Low | Run marker search before/after cleanup and `pnpm maintainability:check`. | If wrong, diff could be large; review can confirm only marker comment lines were removed. |

Recommended profile: **Excursion**.

Rationale: this is a focused maintenance change, but it crosses engine cleanup behavior, prompt/docs policy, tests, and a broad mechanical source cleanup. A single cohesive plan can cover the implementation and validation without delegated module planning, so Expedition is unnecessary. Errand is too small because the cleanup helper and tests need careful scoping to avoid removing durable semantic markers.

## Scope

In scope:

- Add a deterministic marker-stripping implementation that removes only marker comment lines and preserves the code inside the marked regions.
- Treat slugs matching `plan-\d{2}-...` as temporary build-coordination markers.
- Preserve semantic/durable region markers such as `types`, `path-normalization`, or other non-`plan-\d{2}-...` slugs.
- Wire marker stripping into the existing successful-build cleanup path so it runs before the cleanup commit created by `cleanupPlanFiles`.
- Stage files changed by marker stripping so the cleanup commit includes source-marker removal along with plan/PRD cleanup.
- Update prompt/docs policy to distinguish temporary build-coordination markers from durable maintainability markers.
- Add tests that prove temporary markers are stripped, durable markers are preserved, and `cleanupPlanFiles` includes marker stripping.
- Remove existing `plan-\d{2}-...` eforge region marker comment lines from the repository as part of this change.

Out of scope:

- Removing code inside regions.
- Removing semantic non-plan region markers.
- Changing shared-file planning/cohesion behavior beyond clarifying marker lifecycle.
- Introducing user-facing configuration for marker cleanup in this pass.
- Changing the daemon API or monitor UI.

## Acceptance Criteria

- `stripTemporaryEforgeRegionMarkerLines` removes whole-line start-marker comments whose slug matches `plan-\d{2}-...` from JavaScript/TypeScript content.
- `stripTemporaryEforgeRegionMarkerLines` removes whole-line end-marker comments whose slug matches `plan-\d{2}-...` from JavaScript/TypeScript content.
- `stripTemporaryEforgeRegionMarkerLines` removes whole-line JSX marker comments whose slug matches `plan-\d{2}-...`.
- `stripTemporaryEforgeRegionMarkerLines` preserves all non-marker code lines between removed marker comments.
- `stripTemporaryEforgeRegionMarkerLines` preserves marker comments whose slug does not match `plan-\d{2}-...`.
- `cleanupPlanFiles` stages tracked source files after removing temporary plan-id marker comments.
- `cleanupPlanFiles` cleanup commits include marker comment removals when temporary plan-id marker comments are present in tracked source files.
- `cleanupPlanFiles` preserves existing non-fatal cleanup behavior when marker cleanup fails.
- `cleanupPlanFiles` preserves existing non-fatal cleanup behavior when plan-file cleanup fails.
- `packages/engine/src/prompts/builder.md` states that plan/module-id region markers are temporary build-coordination comments removed during successful cleanup.
- `docs/llm-friendly-code.md` distinguishes durable semantic region markers from temporary `plan-\d{2}-...` build-coordination markers.
- A repository-wide search for `eforge:(end)?region plan-\d{2}-` returns zero tracked source marker lines after the one-time cleanup pass.
- `pnpm maintainability:check` exits 0.
- `pnpm test -- region-marker-cleanup prd-artifact stack-landing-cleanup agent-maintainability-check` exits 0, or the implemented equivalent targeted Vitest command exits 0 for the affected tests.
- `pnpm type-check` exits 0.
