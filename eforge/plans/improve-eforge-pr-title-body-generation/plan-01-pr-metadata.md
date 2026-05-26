---
id: plan-01-pr-metadata
name: Deterministic PR Metadata for Direct and Stacked Landings
branch: improve-eforge-pr-title-body-generation/plan-01-pr-metadata
---

# Deterministic PR Metadata for Direct and Stacked Landings

## Architecture Context

eforge commit messages intentionally include `Models-Used:` and `Co-Authored-By:` trailers for traceability. Direct PR creation currently uses `gh pr create --fill`, and stacked PR creation uses git-spice `branch submit --fill`, so GitHub-visible PR descriptions can become raw commit-log dumps with repeated trailers. The engine already has the inputs needed to render reviewer-facing PR metadata: `OrchestrationConfig`, artifact branch, base branch, and the build `ModelTracker`.

This plan keeps commit trailers unchanged and changes only PR metadata creation/editing. The engine continues to emit events rather than writing to stdout.

## Implementation

### Overview

Add a shared PR metadata renderer and thread its output into direct PR creation and stacked PR post-processing. Direct PRs must use `gh pr create --title ... --body-file ...` instead of `--fill`. Existing direct PR fallback must still return the existing URL and must attempt to repair title/body metadata. Stacked PRs must keep the git-spice submit flow and then best-effort edit the discovered PR URL via `gh pr edit`.

### Key Decisions

1. **Render metadata in a shared engine module.** Create `packages/engine/src/pr-metadata.ts` with a `PullRequestMetadata` type and `renderPullRequestMetadata()` function. This keeps direct and stacked PR metadata consistent.
2. **Use temp body files, not inline `--body`.** `gh pr create` and `gh pr edit` must receive `--body-file <tempfile>` to avoid command-line length and quoting issues. Delete the temp directory in a `finally` block.
3. **Do not expose raw trailer labels in PR bodies.** The renderer may use `ModelTracker.toTrailer()` internally, but the body must label the summary as `Models used` and must not include literal `Models-Used:` or `Co-Authored-By:` lines.
4. **Stacked metadata edit is non-fatal.** After git-spice creates or updates the PR and a URL is discovered, a failed `gh pr edit` must emit a diagnostic `planning:progress` event and allow stack landing to complete.
5. **Existing direct PR metadata repair is best-effort after URL discovery.** When `gh pr create` fails but `gh pr view` finds an existing URL, call the shared edit helper with deterministic metadata before returning the URL. If the edit fails, preserve the existing behavior of returning the URL.

## Scope

### In Scope

- Add `packages/engine/src/pr-metadata.ts`.
- Generate deterministic PR title/body from `OrchestrationConfig`, artifact branch, base branch, and optional `ModelTracker`.
- Include in the PR body:
  - plan set name from `config.name`
  - description from `config.description` when non-empty
  - mode from `config.mode`
  - base branch
  - artifact branch
  - plan list from `config.plans`
  - a single `Models used` summary when the tracker has recorded models
- Update direct PR creation in `worktree-ops.ts`, `worktree-manager.ts`, and `landing.ts` to pass explicit metadata and avoid `--fill`.
- Add a shared `editPullRequest` helper using `gh pr edit <selector> --title <title> --body-file <tempfile>`.
- Update existing direct PR fallback to attempt metadata repair with `editPullRequest` after `gh pr view` returns the URL.
- Update stacked PR landing to edit the discovered PR URL with deterministic metadata after git-spice submit and PR URL discovery.
- Emit a non-fatal diagnostic event when stacked metadata editing fails after PR creation/update succeeded.
- Add tests for direct create argv/body-file content, existing direct PR metadata edit, stacked metadata edit, and stacked metadata edit failure.
- Preserve `forgeCommit` and `composeCommitMessage` trailer behavior.

### Out of Scope

- Removing or changing `Co-Authored-By:` commit attribution.
- Removing or changing `Models-Used:` commit trailers.
- Replacing git-spice stack submission or removing git-spice `--fill`.
- Adding new event variants or changing client schemas.
- Changing PR auto-merge behavior.
- Updating plugin or Pi commands; no command surface changes are part of this plan.

## Files

### Create

- `packages/engine/src/pr-metadata.ts` — Defines `PullRequestMetadata`, renderer inputs, and deterministic title/body rendering.
- Optional `test/pr-metadata.test.ts` — Unit tests for renderer output if the builder chooses to isolate renderer assertions from landing integration tests.

### Modify

- `packages/engine/src/worktree-ops.ts` — Add temp body-file helper, update `createPullRequest()` signature to require metadata, replace `--fill` with `--title` and `--body-file`, and add `editPullRequest()`.
- `packages/engine/src/worktree-manager.ts` — Extend `issuePr()` options to accept metadata; pass metadata to `createPullRequest()`; on existing PR fallback, call `editPullRequest()` with the found URL before returning it, preserving URL return when edit fails.
- `packages/engine/src/landing.ts` — Render PR metadata from `opts.config`, `featureBranch`, `baseBranch`, and `opts.modelTracker`; pass it to `worktreeManager.issuePr()`.
- `packages/engine/src/orchestrator/phases.ts` — For stacked PR landing, render metadata using `ctx.config`, `ctx.stackContext.branch`, `ctx.stackContext.baseBranch ?? ctx.config.baseBranch`, and `ctx.modelTracker`; pass it to `executeStackLanding()`.
- `packages/engine/src/stacking/landing.ts` — Accept optional PR metadata; after PR URL discovery, call `editPullRequest()` when both URL and metadata are present; emit `planning:progress` and continue if editing fails.
- `test/landing-actions.test.ts` — Extend the fake `gh` shim to log `pr create` and `pr edit` args and copy body-file contents before deletion; assert direct create uses `--title`/`--body-file`, does not use `--fill`, and body content excludes raw trailers; assert existing PR fallback attempts `gh pr edit` after URL discovery.
- `test/stack-runtime-landing.test.ts` or `test/stack-landing-cleanup.test.ts` — Add fake `gh` coverage for successful stacked metadata edit and non-fatal edit failure diagnostic after PR URL discovery.
- `test/git-spice-provider.test.ts` — Keep existing git-spice `--fill` assertions unless git-spice command support is changed; this plan expects the submit flow to remain unchanged.
- `test/git-forge-commit.test.ts`, `test/model-tracker.test.ts`, and existing model tracker tests — No production changes expected, but keep them passing to prove commit trailers remain unchanged.

## Metadata Renderer Requirements

Use a deterministic markdown body similar to:

```markdown
## Summary
<config.description or config.name>

## Build metadata
- Plan set: `<config.name>`
- Mode: `<config.mode>`
- Base branch: `<baseBranch>`
- Artifact branch: `<featureBranch>`

## Plans
- `<plan.id>` — <plan.name>

## Models used
<comma-separated model IDs, or omit this section when no model usage is available>
```

The exact markdown can vary, but tests must verify the required fields appear and trailer labels do not appear. If `config.description` is empty, fall back to `config.name` in the summary. The title must be deterministic, must include the plan set name or description, and must avoid newline characters.

## Verification

- [ ] `gh pr create` invocations in tests include `--title` followed by the generated title.
- [ ] `gh pr create` invocations in tests include `--body-file` followed by a file path whose contents the fake `gh` shim copies before temp cleanup.
- [ ] `gh pr create` invocations in tests do not include `--fill`.
- [ ] Direct PR body-file content in tests contains `Plan set:`, `test-set`, `Base branch:`, `main`, `Artifact branch:`, and `plan-01`.
- [ ] Direct PR body-file content in tests does not contain `Co-Authored-By:`.
- [ ] Direct PR body-file content in tests does not contain `Models-Used:`.
- [ ] Direct PR body-file content in tests contains one `Models used` summary when the test tracker records at least one model.
- [ ] Existing direct PR fallback returns `https://github.com/test/repo/pull/42` when `gh pr create` fails and `gh pr view` finds the PR.
- [ ] Existing direct PR fallback test records a `gh pr edit https://github.com/test/repo/pull/42 --title ... --body-file ...` invocation.
- [ ] Stacked PR landing tests preserve provider calls in this order: `trackBranch`, `restackBranch`, `submitBranch`.
- [ ] Stacked PR landing test records `gh pr edit <discovered-url> --title ... --body-file ...` after submit output contains the PR URL.
- [ ] Stacked PR landing emits `stack:landing:update` with `status: complete` when metadata edit succeeds.
- [ ] Stacked PR landing emits `stack:landing:update` with `status: complete` and a `planning:progress` diagnostic containing `PR metadata` or `metadata update` when `gh pr edit` fails.
- [ ] Existing tests still prove `forgeCommit` appends `Co-Authored-By: forged-by-eforge <noreply@eforge.build>`.
- [ ] Existing tests still prove `composeCommitMessage()` appends `Models-Used:` when `ModelTracker` is non-empty.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.