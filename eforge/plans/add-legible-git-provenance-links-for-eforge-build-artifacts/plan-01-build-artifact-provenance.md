---
id: plan-01-build-artifact-provenance
name: Build Artifact Provenance Links
branch: add-legible-git-provenance-links-for-eforge-build-artifacts/plan-01-build-artifact-provenance
agents:
  builder:
    effort: high
    rationale: The change crosses landing, stacked PR metadata, git-history lookup,
      commit-message composition, tests, and docs; careful sequencing avoids
      branch-relative provenance links.
  reviewer:
    effort: high
    rationale: Review needs to verify Git command behavior, PR body rendering, and
      trailer ordering across direct and stacked landing paths.
  tester:
    effort: high
    rationale: The core behavior depends on temp-repo Git history and gh shims;
      targeted test execution is required.
---

# Build Artifact Provenance Links

## Architecture Context

Eforge already commits build-facing source artifacts into the artifact branch, then `cleanupPlanFiles()` can delete those files from `HEAD`. This plan makes that preserved branch history legible by rendering commit-pinned artifact references in PR bodies and, where engine-generated commit context is available, in commit trailers before `Models-Used` and `Co-Authored-By`.

Key constraints from the codebase:

- `packages/engine/src/pr-metadata.ts` is the shared renderer for direct and stacked PR metadata and must continue stripping raw `Models-Used:` and `Co-Authored-By:` trailer labels from PR bodies.
- `packages/engine/src/landing.ts` runs cleanup before direct PR publication, so provenance collection for direct PRs can run after cleanup and before `issuePr()`.
- `packages/engine/src/orchestrator/phases.ts` passes metadata into `executeStackLanding()`, while `packages/engine/src/stacking/landing.ts` performs stacked cleanup inside the stacked landing helper. The stacked path needs a lazy metadata hook or equivalent so provenance can be collected after stacked cleanup and before `gh pr edit`.
- `forgeCommit()` remains the single attribution appender. Do not move `Co-Authored-By` logic out of `packages/engine/src/git.ts`.
- The durable guarantee is Git history, not the final tree. Provenance links must use a commit SHA plus path, never a branch-relative path.

## Implementation

### Overview

Add a small provenance module that discovers source-document artifact commits, renders fallback `git show <sha>:<path>` references, resolves GitHub blob URLs from configured remotes when possible, and exposes commit-trailer text for engine-generated commits. Thread those references into PR metadata for direct and stacked PR publication. Update documentation to describe the cleanup and merge-strategy tradeoff.

### Key Decisions

1. Use `git log --diff-filter=AM --format=%H -1 -- <path>` for each artifact path so cleanup deletion commits are excluded.
2. Discover plan artifact paths from Git history under `eforge/plans/{planSet}` rather than assuming only top-level plan files exist; include `orchestration.yaml` and compiled `.md` plan files.
3. Render GitHub links only when a GitHub remote URL can be parsed from `git remote get-url origin`; otherwise render the host-agnostic fallback ``git show <sha>:<path>``.
4. Keep PR metadata best-effort: missing provenance commits omit only that row or section and never fail landing.
5. If commit-message provenance is emitted, use stable trailer lines such as `Eforge-Source-PRD: <sha>:<path>` and `Eforge-Source-Plan: <sha>:<path>` before `Models-Used`. `forgeCommit()` then appends `Co-Authored-By` last.
6. Do not create a durable manifest or database. All required data is derived from known artifact paths and Git history.

## Scope

### In Scope

- Build artifact provenance types and Git lookup helpers for PRD, orchestration, and compiled plan artifact references.
- GitHub remote parsing for common HTTPS, `git+https`, SSH scp-like, and `ssh://git@github.com/...` remote URL forms.
- `## Eforge provenance` rendering in shared PR metadata.
- Direct PR metadata collection after cleanup and before PR creation/editing.
- Stacked PR metadata collection after stacked cleanup and before metadata editing.
- Best-effort commit provenance trailers for engine-generated merge/final commits when artifact references are available without fragile global state.
- Documentation updates for session-plan privacy, cleaned artifacts, preserved branch history, and squash/rebase tradeoffs.
- Unit and integration tests listed below.

### Out of Scope

- Persisting a provenance manifest or database.
- Adding console-ui provenance browsing.
- Checking `.eforge/session-plans/` into Git.
- Guaranteeing provenance through squash or rebase workflows.
- Rewriting agent-authored prompt commit instructions unless needed for a narrow trailer-ordering test.
- Changing the default landing strategy.

## Files

### Create

- `packages/engine/src/provenance.ts` — Artifact reference types, Git history lookup, GitHub remote parsing, fallback `git show` rendering, PR row helpers, and optional provenance trailer builders.
- `test/provenance.test.ts` — Unit and temp-repo tests for non-deletion commit lookup, `git show` recovery, GitHub URL rendering, fallback rendering, path ordering, and missing-artifact best-effort behavior.

### Modify

- `packages/engine/src/pr-metadata.ts` — Add optional provenance references to `PullRequestMetadataInput`; render `## Eforge provenance` with PRD, orchestration, and plan rows; keep raw `Co-Authored-By:` and `Models-Used:` labels out of PR bodies.
- `packages/engine/src/landing.ts` — After direct cleanup and before `renderPullRequestMetadata()`, collect build artifact provenance from `mergeWorktreePath` with `cleanupPrdFilePath`, `cleanupPlanSet`, and `cleanupOutputDir`; pass references into the renderer.
- `packages/engine/src/orchestrator/phases.ts` — For stacked PR landing, pass a lazy metadata factory or equivalent data into `executeStackLanding()` so the helper can collect provenance after stacked cleanup. For final local merge commit messages, use collected references as provenance trailers when available.
- `packages/engine/src/stacking/landing.ts` — Accept and invoke the lazy metadata factory after cleanup and before `gh pr edit`; retain existing `metadata` behavior for callers/tests that provide static metadata.
- `packages/engine/src/worktree-manager.ts` — If provenance trailers are implemented for plan squash/final merge commits, add optional provenance-trailer input to `mergePlan()` and preserve existing call behavior when omitted.
- `packages/engine/src/model-tracker.ts` — Extend `composeCommitMessage()` with optional provenance trailer lines before the `Models-Used` trailer; retain old two-argument behavior.
- `packages/engine/src/git.ts` — Update comments only if needed to document final ordering; do not change `forgeCommit()` attribution behavior unless a test exposes a bug.
- `test/model-tracker.test.ts` and/or `test/git-forge-commit.test.ts` — Add trailer-ordering coverage when provenance trailers are emitted.
- `test/prd-artifact.test.ts` — Add an assertion that the collected latest non-deletion SHA can be used with `git show <sha>:<path>` after cleanup.
- `test/landing-actions.test.ts` — Assert direct PR body includes `## Eforge provenance`, includes the normalized PRD and plan/orchestration references when artifact commits exist, uses commit-pinned or `git show` refs, emits no branch-relative artifact links, and still excludes raw attribution/model trailers.
- `test/stack-runtime-landing.test.ts` — Assert stacked PR metadata editing can include the same provenance section, including the lazy metadata path if implemented.
- `docs/config.md` — Correct PRD provenance text so it says artifacts may be removed from `HEAD` by cleanup and remain recoverable from preserved branch history.
- `docs/architecture.md` — Add the merge-strategy tradeoff: plan branches squash into the artifact branch, final no-ff/preserved history keeps the forge trail, while squash/rebase landing can collapse or discard intermediate provenance commits.
- `README.md` — Update the build-source/queue wording to distinguish local/private session plans, runtime queue files, committed PRD/plan artifacts, cleanup, and preserved-history provenance.
- `web/content/docs/concepts.md` — Public docs source update for session-plan privacy and commit-history provenance.
- `web/content/docs/configuration.md` — Public docs source update for PRD provenance cleanup and landing strategy tradeoffs.
- `web/content/docs/glossary.md` — Public docs source update for PRD provenance definition.

## Implementation Notes

### Provenance helper API

Implement a narrow API similar to:

```ts
export type BuildArtifactKind = 'prd' | 'orchestration' | 'plan';

export interface BuildArtifactProvenanceRef {
  kind: BuildArtifactKind;
  label: string;
  path: string;
  commitSha: string;
  gitShowRef: string;
  webUrl?: string;
}

export async function collectBuildArtifactProvenance(cwd: string, input: {
  planSetName: string;
  outputDir: string;
  prdArtifactPath?: string;
  remote?: string;
}): Promise<BuildArtifactProvenanceRef[]>;
```

Behavior requirements:

- Normalize all returned paths to repository-relative POSIX paths.
- Include the PRD artifact only when `prdArtifactPath` is provided and a latest add/modify commit exists.
- Discover plan-set artifacts from Git history under `${outputDir}/${planSetName}` and include `orchestration.yaml` plus `.md` files.
- Sort rows as PRD, orchestration, then plan files by path.
- Use `git log --diff-filter=AM --format=%H -1 -- <path>` per row.
- Confirm a found row is readable with `git show <sha>:<path>` or equivalent; omit unreadable rows.
- Catch lookup failures at the collection boundary and return already-collected rows or `[]` rather than throwing into landing.

### PR metadata rendering

Render a section like:

```md
## Eforge provenance
- Normalized PRD: [eforge/prds/demo.md](https://github.com/org/repo/blob/<sha>/eforge/prds/demo.md) (`git show <sha>:eforge/prds/demo.md`)
- Orchestration: `git show <sha>:eforge/plans/demo/orchestration.yaml`
- Plan: [eforge/plans/demo/plan-01.md](...)
```

If a web URL is unavailable, render only the fallback command reference. Do not render branch names inside artifact links.

### Commit-message provenance

When adding provenance trailers, keep this order:

```text
<body>

Eforge-Source-PRD: <sha>:<path>
Eforge-Source-Plan: <sha>:<path>
Models-Used: <model-a>, <model-b>
Co-Authored-By: forged-by-eforge <noreply@eforge.build>
```

`composeCommitMessage(body, tracker)` must keep its current output. Add a third optional parameter for provenance trailer strings or an options object in a backward-compatible way, then update only engine-generated commit sites where artifact references are available from existing context.

## Verification

- [ ] `test/provenance.test.ts` proves a file added, modified, deleted, then looked up via `--diff-filter=AM` returns the modify commit and `git show <sha>:<path>` prints the modified content.
- [ ] `test/provenance.test.ts` covers HTTPS, `git+https`, scp-like SSH, and `ssh://git@github.com/...` remotes for GitHub blob URL rendering.
- [ ] `test/provenance.test.ts` covers fallback rendering when the remote is local or unavailable.
- [ ] `test/prd-artifact.test.ts` proves a cleaned PRD artifact can be read with `git show <sha>:<path>` using the collected provenance SHA.
- [ ] `test/landing-actions.test.ts` proves direct PR body text contains `## Eforge provenance` when artifact commits exist.
- [ ] `test/landing-actions.test.ts` proves direct PR provenance includes normalized PRD, `orchestration.yaml`, and compiled plan file references.
- [ ] `test/landing-actions.test.ts` proves direct PR provenance contains no `blob/main/eforge/`, `blob/master/eforge/`, or other branch-relative artifact URL.
- [ ] `test/landing-actions.test.ts` proves direct PR body text contains no raw `Co-Authored-By:` or `Models-Used:` labels.
- [ ] `test/stack-runtime-landing.test.ts` proves stacked PR metadata editing includes the `## Eforge provenance` section when provenance references are supplied or lazily collected.
- [ ] If provenance commit trailers are emitted, `test/model-tracker.test.ts` or `test/git-forge-commit.test.ts` proves provenance trailers precede `Models-Used` and `Co-Authored-By`.
- [ ] `docs/config.md` no longer says `eforge/prds/` files are always retained in the final tree after build completion.
- [ ] Documentation states session plans remain local/private and are not the shared provenance mechanism.
- [ ] Documentation states squash or rebase landing may collapse or discard intermediate eforge provenance commits.
- [ ] `pnpm test -- prd-artifact landing-actions stack-runtime-landing provenance model-tracker git-forge-commit` exits 0.
- [ ] `pnpm type-check` exits 0.
