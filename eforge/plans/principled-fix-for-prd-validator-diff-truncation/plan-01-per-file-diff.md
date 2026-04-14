---
id: plan-01-per-file-diff
name: Per-file budgeted PRD validator diff
depends_on: []
branch: principled-fix-for-prd-validator-diff-truncation/per-file-diff
---

# Per-file budgeted PRD validator diff

## Architecture Context

`packages/engine/src/eforge.ts` (~L626-670) currently builds the PRD validator's diff input by running a single `git diff baseBranch...HEAD` and slicing the resulting string at 80,000 bytes. Because `git diff` emits hunks in alphabetical path order, large alphabetically-early files (notably `package-lock.json`) can push implementation code past the cliff, leaving the validator to see only planning docs and lockfile noise. This is the exact failure observed in eval run `2026-04-14T00-20-00` / variant `claude-sdk`.

The fix is structural: replace the monolithic sliced string with a per-file, individually-budgeted diff. Each changed file is either fully present or replaced with an explicit `[summarized: ...]` marker line. There is no global byte cliff, so no file can be silently starved by an earlier file's size.

Diff construction moves out of `eforge.ts` into a new unit-testable module `packages/engine/src/prd-validator-diff.ts`, so we can exercise the edge cases (binary files, oversized diffs, alphabetical regression case) on a programmatically-built scratch git repo.

## Implementation

### Overview

1. Add `packages/engine/src/prd-validator-diff.ts` exporting `buildPrdValidatorDiff(opts)` along with `DiffFile`, `BuildPrdDiffOptions`, and `BuildPrdDiffResult` types matching the source document's interface exactly.
2. Replace the 80K-slice block in `packages/engine/src/eforge.ts` (~L636-645) with a call to `buildPrdValidatorDiff`; pass `renderedText` as the `diff` argument to `runPrdValidator`; record `totalBytes`, `summarizedCount`, and file count on the `prdSpan`.
3. Add `test/prd-validator-diff.test.ts` using vitest, building scratch git repos in tmp directories in `beforeEach` (no committed fixtures; follows the "no mocks, real code" testing convention in AGENTS.md).
4. Verify `runPrdValidator`'s prompt location — if it hard-codes "full diff below," soften the wording to mention the `[summarized: ...]` marker and that the validator can read files from its cwd. If the prompt does not hard-code that phrasing, this is a no-op (per source: "may be no-op").

### Key Decisions

1. **Per-file budget, no global truncation.** Every changed file either appears verbatim or is replaced with a one-line `[summarized: status=<S> +<add> -<del>, per-file diff omitted (<bytes> bytes)]` marker. Removes the byte cliff by construction.
2. **Binary + oversized detection by signal, not allowlist.** `git diff --numstat` reports binary files as `- -`; large files exceed the per-file byte or line thresholds. Lockfiles fall naturally into the oversized bucket without being named. No exclude list is added.
3. **NUL-delimited enumeration.** Use `git diff --name-status -z` and `git diff --numstat -z` so paths with spaces or unusual characters are handled correctly.
4. **Planning docs left in.** Per the source (option 1), the plan output directory is not filtered. Revisit only if validator accuracy suffers; that is explicitly out of scope for this plan.
5. **Defaults match the source.** `perFileBudgetBytes = 20_000`, `maxChangedLinesBeforeSummary = 2000`, `maxBuffer: 100 * 1024 * 1024` on per-file git diff calls.
6. **Diff construction is pure w.r.t. eforge state.** The new module takes `{ cwd, baseRef, perFileBudgetBytes?, maxChangedLinesBeforeSummary? }` and returns a structured result — no tracing, no config lookups inside. `eforge.ts` owns the span and records fields from the returned result.

## Scope

### In Scope

- New `packages/engine/src/prd-validator-diff.ts` with `buildPrdValidatorDiff` and the three exported types.
- Edit to `packages/engine/src/eforge.ts` (~L636-645) replacing the slice with a call to the new builder; span records `totalBytes`, `summarizedCount`, file count.
- New `test/prd-validator-diff.test.ts` with six cases: small changeset verbatim; one file over byte budget summarized, others verbatim; one file over changed-lines threshold summarized; binary file name-only; no changes empty result; alphabetical-regression case (large early file does not hide later real code).
- Minimal wording tweak to `runPrdValidator`'s prompt if and only if it hard-codes "full diff below" (read-only verification step, edit only if needed).

### Out of Scope

- No exclude list for lockfiles, generated files, or planning docs.
- No global byte budget / magic global truncation number.
- No new tools granted to the validator (file read / bash). Deferred as a later enhancement per source document.
- No re-running of the eval scenario as part of this plan; that is an acceptance-level verification the user performs, not a build step.
- No changes to the gap-closer diff construction (`packages/engine/src/eforge.ts` ~L673+) — out of scope; source targets the validator only.

## Files

### Create

- `packages/engine/src/prd-validator-diff.ts` — exports `DiffFile`, `BuildPrdDiffOptions`, `BuildPrdDiffResult`, and `async function buildPrdValidatorDiff(opts)`. Implementation runs `git diff --name-status -z` + `git diff --numstat -z` against `baseRef...HEAD`, zips them into `DiffFile[]`, then for each file runs `git diff baseRef...HEAD -- <path>` with `maxBuffer: 100 * 1024 * 1024`. Applies per-file decision: binary → name-only line; `body.length > perFileBudgetBytes` or `added + deleted > maxChangedLinesBeforeSummary` → one-line `[summarized: ...]` marker with a `diff --git a/<path> b/<path>` header; otherwise the full per-file diff. Concatenates the `--name-status`/`--numstat` summary table followed by the per-file bodies into `renderedText`. Returns `{ summary, files, renderedText, totalBytes, summarizedCount }`.
- `test/prd-validator-diff.test.ts` — vitest suite. `beforeEach` uses `mkdtemp` + `execa`/`node:child_process` to `git init`, set user config, make a base commit, branch, make changes, commit, then call `buildPrdValidatorDiff({ cwd, baseRef: 'main' })`. Cases enumerated in "In Scope" above.

### Modify

- `packages/engine/src/eforge.ts` — replace lines ~636-645 (`const { stdout } = await exec('git', ['diff', ...])` through the 80K slice assignment) with `const built = await buildPrdValidatorDiff({ cwd: validatorCwd, baseRef: orchConfig.baseBranch }); if (!built.renderedText.trim()) return; const diff = built.renderedText;`. Update the `prdSpan.setInput({ prdLength, diffLength })` call to also record `totalBytes: built.totalBytes, summarizedCount: built.summarizedCount, fileCount: built.files.length`. Add the `import { buildPrdValidatorDiff } from './prd-validator-diff.js';` at the top alongside existing imports.
- `packages/engine/src/agents/prd-validator.ts` (or wherever the validator prompt lives — confirm location during implementation) — conditional edit only: if the prompt hard-codes "full diff below" or equivalent phrasing, soften to mention that oversized files appear with a `[summarized: ...]` marker and invite reading from `cwd`. If no such wording exists, leave untouched (no-op).

## Verification

- [ ] `pnpm type-check` passes with zero errors.
- [ ] `pnpm test` passes, including the new `test/prd-validator-diff.test.ts` suite.
- [ ] `test/prd-validator-diff.test.ts` contains a case where the changeset includes an alphabetically-early file larger than 80,000 bytes plus an alphabetically-later source file; the test asserts the later file's full diff body appears in `renderedText`.
- [ ] `test/prd-validator-diff.test.ts` contains a case where a binary file (committed as raw bytes with a null byte) appears in `files` with `binary: true`, `added: -1`, `deleted: -1`, and its `body` contains no diff hunk content.
- [ ] `test/prd-validator-diff.test.ts` contains a case where a file's per-file diff exceeds `perFileBudgetBytes` (override to a small value like 500); the test asserts that file's `summarized` is `true` and its `body` contains the substring `[summarized:`.
- [ ] `test/prd-validator-diff.test.ts` contains a case where a file's changed-line count exceeds `maxChangedLinesBeforeSummary` (override to a small value like 10); the test asserts `summarized: true` for that file.
- [ ] `test/prd-validator-diff.test.ts` contains a case where the base and head are identical; the test asserts `files.length === 0` and `renderedText.trim() === ''`.
- [ ] `packages/engine/src/eforge.ts` contains no occurrence of the literal `80_000` or `80000` or `stdout.slice(0, 80` in the prd validator closure.
- [ ] `packages/engine/src/eforge.ts` prd validator closure calls `buildPrdValidatorDiff` with `cwd: validatorCwd` and `baseRef: orchConfig.baseBranch` and passes `built.renderedText` as the `diff` field to `runPrdValidator`.
- [ ] `packages/engine/src/eforge.ts` prd validator closure records `totalBytes`, `summarizedCount`, and `fileCount` on the `prdSpan` input.
- [ ] `packages/engine/src/prd-validator-diff.ts` exports match the source document: `DiffFile`, `BuildPrdDiffOptions`, `BuildPrdDiffResult`, `buildPrdValidatorDiff`.
- [ ] `buildPrdValidatorDiff` uses `git diff --name-status -z` and `git diff --numstat -z` for enumeration (grep the implementation for `-z`).
- [ ] Per-file `git diff` calls in `buildPrdValidatorDiff` pass `maxBuffer: 100 * 1024 * 1024`.
- [ ] Default values in `BuildPrdDiffOptions` are `perFileBudgetBytes = 20_000` and `maxChangedLinesBeforeSummary = 2000`.
