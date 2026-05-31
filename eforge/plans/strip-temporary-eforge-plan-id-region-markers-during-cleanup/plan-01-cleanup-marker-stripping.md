---
id: plan-01-cleanup-marker-stripping
name: Cleanup Marker Stripping
branch: strip-temporary-eforge-plan-id-region-markers-during-cleanup/plan-01-cleanup-marker-stripping
agents:
  builder:
    effort: high
    rationale: The implementation combines whole-line marker parsing, git staging,
      and non-fatal cleanup behavior; a careful builder pass reduces the risk of
      deleting code or changing cleanup commit semantics.
  reviewer:
    effort: high
    rationale: Review must verify that only temporary marker comment lines are
      stripped, semantic markers remain, and cleanup failures stay non-fatal.
---

# Cleanup Marker Stripping

## Architecture Context

`packages/engine/src/cleanup.ts` is the single plan-file cleanup implementation used by normal landing through `runCleanup` in `packages/engine/src/landing.ts` and by stacked PR landing through `packages/engine/src/stacking/landing.ts`. Cleanup already removes plan files and optional PRD provenance artifacts, stages those removals, and commits through `forgeCommit()`.

Temporary region markers with slugs such as `plan-NN-*` are build-coordination comments. Durable semantic markers documented in `docs/llm-friendly-code.md` remain supported for large-file organization. The new cleanup behavior must strip only temporary marker comment lines, never the code between those markers.

## Implementation

### Overview

Add a focused region-marker cleanup helper and call it from `cleanupPlanFiles` before the existing cleanup commit. The helper must expose a pure string transform for unit tests and a repository transform that scans tracked JavaScript/TypeScript-family files, rewrites files with removed temporary marker lines, stages those rewrites, and returns a summary.

### Key Decisions

1. Match only whole-line temporary marker comments whose slug matches `plan-\d{2}-...`; keep inline comments, semantic marker slugs, and all non-marker content.
2. Scan tracked files with `git ls-files -z` so cleanup does not rewrite untracked scratch output.
3. Filter to supported source extensions (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`) and skip generated/vendor path segments such as `node_modules`, `dist`, `.git`, `.eforge`, `.next`, `coverage`, `.turbo`, `out`, and `build`.
4. Stage marker-stripped files with `git add -- <paths>` before the existing `forgeCommit()` call; keep the existing cleanup commit subjects unless a test requires a subject update.
5. Catch marker-cleanup failures inside `cleanupPlanFiles`, emit a `planning:progress` event, and continue to the existing plan/PRD cleanup commit when those removals have already been staged. Keep the outer cleanup `try/catch` so plan-file cleanup failures remain non-fatal and still pair `cleanup:start` with `cleanup:complete`.

## Scope

### In Scope

- Create a deterministic marker-stripping helper for temporary plan-ID eforge region markers.
- Wire marker stripping into `cleanupPlanFiles` after plan/PRD deletions are staged and before the cleanup commit.
- Stage marker-stripped tracked source files so the cleanup commit includes marker removals.
- Preserve durable semantic eforge region markers.
- Add unit and integration coverage for string stripping, repository stripping, cleanup commit inclusion, JSX marker removal, semantic marker preservation, and marker-cleanup failure handling.
- Update builder/planner prompt policy and the LLM-friendly code policy to distinguish temporary build markers from durable semantic markers.

### Out of Scope

- Removing code inside any region.
- Removing semantic non-plan region markers.
- Adding user configuration for marker cleanup.
- Changing daemon API, monitor UI, or landing action behavior beyond the shared cleanup path.

## Files

### Create

- `packages/engine/src/region-marker-cleanup.ts` — export `stripTemporaryEforgeRegionMarkerLines(content: string): string` and `stripTemporaryEforgeRegionMarkers(cwd: string): Promise<TemporaryEforgeRegionMarkerCleanupSummary>`.
- `test/region-marker-cleanup.test.ts` — cover the pure helper, repository helper, and `cleanupPlanFiles` integration with real temporary git repositories.

### Modify

- `packages/engine/src/cleanup.ts` — import and call the repository helper, stage marker-stripped files before `forgeCommit`, emit non-fatal progress on marker cleanup failure, and retain paired cleanup events.
- `packages/engine/src/prompts/builder.md` — state that plan/module-ID region markers in shared files are temporary build-coordination comments stripped during successful cleanup.
- `packages/engine/src/prompts/module-planner.md` — state that shared-file region declarations are build-coordination instructions, not permanent source organization.
- `packages/engine/src/prompts/planner.md` — align the architecture-planner language with the temporary marker lifecycle and durable semantic marker distinction.
- `docs/llm-friendly-code.md` — split the policy into durable semantic markers and temporary `plan-\d{2}-...` build-coordination markers; document that cleanup strips the temporary marker lines and that `pnpm maintainability:check` validates marker balance without requiring plan-ID markers to remain.

## Implementation Details

### Marker matching

The pure helper must remove these whole-line forms when the slug matches `plan-\d{2}-...`:

- Line comments: `// --- eforge:region <temporary-plan-slug> ---`
- Line comments: `// --- eforge:endregion <temporary-plan-slug> ---`
- JSX comments: `{/* --- eforge:region <temporary-plan-slug> --- */}`
- JSX comments: `{/* --- eforge:endregion <temporary-plan-slug> --- */}`

The implementation may also support plain block-comment marker lines, but it must not remove inline trailing comments or strings that merely contain marker text.

### Test-source grep discipline

Because the final plan set validates that no tracked source line matches `eforge:(end)?region plan-[0-9]{2}-`, tests must build marker fixture strings from smaller pieces rather than embedding a literal matching marker line in the test source. For example, split the `eforge:` + `region` token or split the `plan-` + `01-example` slug in source code, then join them at runtime.

### Repository helper summary

Return a summary with at least:

- `filesScanned`
- `filesChanged`
- `markersRemoved`
- `changedFiles`

Use the summary in tests. A success progress event is optional; no success event is required.

### Cleanup integration tests

Use real temporary git repositories, following existing patterns in `test/prd-artifact.test.ts`:

1. Create and commit a plan directory plus a tracked source file containing temporary marker lines and semantic marker lines.
2. Run `cleanupPlanFiles` and drain all events.
3. Assert the source file no longer contains the temporary marker lines, still contains semantic markers, and still contains the code that was between the removed markers.
4. Assert the last cleanup commit includes both the plan-file deletion and the source-file modification.
5. Create a tracked dangling `.ts` symlink or equivalent tracked source read failure, run `cleanupPlanFiles`, and assert the event stream includes `cleanup:start`, a `planning:progress` event for temporary marker cleanup failure, and `cleanup:complete` without throwing.

## Verification

- [ ] `stripTemporaryEforgeRegionMarkerLines` returns content without constructed whole-line temporary `region` and `endregion` line comments.
- [ ] `stripTemporaryEforgeRegionMarkerLines` returns content without constructed whole-line JSX temporary `region` and `endregion` comments.
- [ ] Code lines between removed marker comments remain byte-for-byte in the returned content.
- [ ] Marker comments whose slug does not match `plan-\d{2}-...` remain in the returned content.
- [ ] Repository cleanup rewrites and stages a tracked `.ts` or `.tsx` file that contains temporary marker lines.
- [ ] `cleanupPlanFiles` produces a cleanup commit whose name-status output includes a deleted plan file and a modified source file when temporary marker lines are present.
- [ ] `cleanupPlanFiles` emits `cleanup:start` and `cleanup:complete` and does not throw when marker cleanup hits a tracked source read failure.
- [ ] Existing non-git cleanup failure behavior still emits a non-fatal `planning:progress` event in `test/stack-landing-cleanup.test.ts`.
- [ ] `packages/engine/src/prompts/builder.md` contains the temporary build-coordination marker lifecycle language.
- [ ] `docs/llm-friendly-code.md` contains separate language for durable semantic markers and temporary `plan-\d{2}-...` markers.
- [ ] `pnpm exec vitest run test/region-marker-cleanup.test.ts test/prd-artifact.test.ts test/stack-landing-cleanup.test.ts test/agent-maintainability-check.test.ts` exits 0 after this plan.