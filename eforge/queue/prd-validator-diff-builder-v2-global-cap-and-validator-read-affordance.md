---
title: PRD Validator Diff Builder v2: Global Cap and Validator Read Affordance
created: 2026-04-14
---

# PRD Validator Diff Builder v2: Global Cap and Validator Read Affordance

## Problem / Motivation

This change adds v2 enhancements to the PRD validator diff builder (`packages/engine/src/prd-validator-diff.ts`), which is itself being introduced by an in-flight build. This change depends on that v1 work landing first.

The v1 design (per-file diff budget, no global cap, no validator prompt affordance) fixes the reported "alphabetical cliff" failure but leaves two edge cases that can still starve the PRD validator of signal:

1. **No global ceiling.** A large changeset where every file is individually under the per-file budget can still produce a multi-megabyte rendered diff that blows out the validator's model context entirely.
2. **A single legitimately large implementation file gets summarized.** If a genuine 30 KB `src/whatever.ts` is the PRD's main deliverable, it hits the per-file budget and the validator sees only `[summarized: +900 -0]` - no way to inspect the content.

Fixing these two together keeps v1's "no exclude lists, no magic truncation cliff" property while bounding total input and giving the validator an escape hatch for the one-big-file case.

## Goal

- `buildPrdValidatorDiff` enforces a configurable **global byte ceiling** (default `500_000` bytes, exposed as `globalBudgetBytes` in `BuildPrdDiffOptions`) on `totalBytes` of the rendered output.
- The PRD validator's prompt documents the `[summarized: ...]` marker and explicitly permits (but does not encourage) the validator to use its existing `Read` tool against its `cwd` to fetch fuller content for any summarized file it cares about.
- Tracing distinguishes per-file-budget demotions from global-cap demotions so we can see which mechanism fired in real runs.

## Approach

### Diff builder (`packages/engine/src/prd-validator-diff.ts`)

After the existing per-file render pass:

1. Compute `totalBytes` from `files[].body`.
2. If `totalBytes <= globalBudgetBytes`, no change.
3. Otherwise, among files that are **not already summarized** by the per-file budget, sort by `body.length` descending, then `file.path` ascending (deterministic tiebreaker for test stability).
4. Iterate that sorted list; for each file, replace its `body` with the same stat-only summary string the per-file path uses (but tag it with a distinct marker, e.g. `[summarized: status=<S> +<add> -<del>, demoted by global cap]` vs. the per-file marker `[summarized: ..., per-file diff omitted (<bytes> bytes)]`). Track the demotion in a new field.
5. Stop as soon as cumulative `totalBytes` is under the cap.

Update `BuildPrdDiffResult` to expose:
- `globalBudgetBytes` (the resolved value used)
- `summarizedByPerFileBudget: number`
- `summarizedByGlobalCap: number`
- Keep existing `summarizedCount` as the sum, for backwards-compatible callers.

The rendered `renderedText` is the same shape as v1, just produced from the post-demotion file list.

### Call site (`packages/engine/src/eforge.ts`, around the `prdValidator` closure)

Pass `summarizedByPerFileBudget` and `summarizedByGlobalCap` through to `prdSpan.setInput(...)` alongside the existing fields so tracing shows the breakdown.

### Validator prompt

In the prompt template used by `runPrdValidator` (`packages/engine/src/agents/prd-validator.ts` loads it via `loadPrompt('prd-validator', ...)`), add a short paragraph near the top of the diff section - not at the top of the prompt - with neutral wording along these lines:

> Some files appear with a marker of the form `[summarized: ...]` instead of a full diff, either because the individual file exceeded the per-file budget or because the total diff exceeded the global cap. The files are present in your working directory. If understanding a specific summarized file is necessary to assess PRD coverage, you may Read it directly; otherwise prefer the summary.

Wording is deliberately permissive rather than prescriptive to avoid reflex reads on every lockfile. Do not add any new tools or bump `maxTurns` - the validator already runs with `tools: 'coding'` and `maxTurns: 15`, which is sufficient for occasional targeted reads.

## Scope

**In scope:**
- Changes to `packages/engine/src/prd-validator-diff.ts` (add global cap pass, extend result type).
- Tracing-only change in `packages/engine/src/eforge.ts` (pass new fields to `prdSpan`).
- One prompt template edit for `prd-validator`.
- One new test for the global cap path in `test/prd-validator-diff.test.ts`.

**Out of scope:**
- Bumping `maxTurns`. We leave it at 15 on purpose; bumping preemptively loses the signal that something is wrong if real runs actually hit the ceiling. Track turns used via existing tracing and revisit if p95 approaches the cap.
- Giving the validator new tools. It already has `coding` tools.
- Restructuring the validator into a multi-step or tool-use-driven agent. That is a larger redesign, deliberately deferred.
- Any changes to `maxChangedLinesBeforeSummary`, `perFileBudgetBytes`, or the existing per-file path - those land in v1.

## Acceptance Criteria

1. `pnpm type-check` and `pnpm test` green.
2. `BuildPrdDiffOptions` accepts `globalBudgetBytes` with default `500_000`.
3. `BuildPrdDiffResult` exposes `summarizedByPerFileBudget` and `summarizedByGlobalCap`; `summarizedCount` equals their sum.
4. New test: construct N files each under `perFileBudgetBytes` but together over `globalBudgetBytes`; assert the largest-by-body files are demoted first with the `demoted by global cap` marker, the smallest remain verbatim, and `totalBytes` of the post-demotion result is `<= globalBudgetBytes`.
5. Existing v1 tests continue to pass unchanged (per-file budget, binary handling, no-changes short-circuit, alphabetical-cliff regression).
6. `prdSpan` input fields include `summarizedByPerFileBudget` and `summarizedByGlobalCap` (verified by reading the tracing output for a test run).
7. The `prd-validator` prompt template contains the new `[summarized: ...]` paragraph; neutral wording verified by inspection.
8. Re-running the failing eval scenario (`workspace-api-excursion-engagement`, variant `claude-sdk`) after both v1 and v2 have landed shows validator completion percent > 0 and matches the balanced variant's outcome.
