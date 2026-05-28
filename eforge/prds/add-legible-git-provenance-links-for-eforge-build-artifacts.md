---
title: Add legible Git provenance links for eforge build artifacts
created: 2026-05-28
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Add legible Git provenance links for eforge build artifacts

## Problem / Motivation

Eforge already captures build-facing provenance in Git history by committing the normalized PRD artifact and compiled plan files, then cleaning those files from the final tree. That provenance is valuable but not legible enough to users: PR bodies do not link to the artifact commits, implementation commits do not explicitly point back to the source PRD/plan documents, and documentation currently understates the merge-strategy tradeoff.

Users can choose squash or rebase workflows, but they are not clearly told that doing so may collapse or discard eforge's intermediate provenance commits. Users who preserve branch history still need an easy way to find the source PRD and plan documents after cleanup removes them from `HEAD`.

Evidence reviewed:

- `docs/roadmap.md`: the new Console Workbench direction makes `console-ui` the canonical local-first surface for planning, observing, configuring, and steering builds. Legible provenance supports that direction by making build history inspectable from PRs and later console run details.
- `packages/engine/src/prd-queue.ts`: `materializePrdArtifact()` already writes the build-facing PRD to `eforge/prds/{prdId}.md` and commits it with `build({prdId}): record PRD provenance`. It returns only `artifactRelPath`; it does not return the commit SHA.
- `packages/engine/src/pipeline/git-helpers.ts` and `packages/engine/src/eforge.ts`: plan artifacts are committed with `plan({planSetName}): initial planning artifacts` after the planner writes `eforge/plans/{planSetName}/...`.
- `packages/engine/src/cleanup.ts`: cleanup removes `eforge/plans/{planSet}` and, when provided, the PRD provenance artifact, then commits `cleanup({planSet}): remove plan files and PRD provenance artifact`. Cleanup removes files from the final tree; preserved branch history remains the provenance source.
- `packages/engine/src/git.ts` and `packages/engine/src/model-tracker.ts`: all engine commits go through `forgeCommit()`, which appends `Co-Authored-By`; model-aware commits use `composeCommitMessage()` to append `Models-Used` before the attribution trailer. Additional provenance trailers should be composed in this path without breaking trailer ordering.
- `packages/engine/src/pr-metadata.ts`: PR bodies currently include Summary, Build metadata, Plans, and optional Models used. There is no provenance section with commit-pinned links.
- `packages/engine/src/landing.ts`, `packages/engine/src/stacking/landing.ts`, and `packages/engine/src/worktree-ops.ts`: direct PRs and stacked PRs already use deterministic PR metadata. PR metadata is applied before/while publishing and can be edited for existing PRs.
- `docs/architecture.md`: documents no-ff final merges preserving full branch history, while per-plan branches squash-merge into the feature branch. This means the durable provenance story depends on users preserving the eforge artifact branch history when landing.
- `docs/config.md`: currently says `eforge/prds/` files are retained after build completion, but code cleanup can remove the PRD artifact from the final tree when cleanup is enabled. That doc should be corrected to describe commit-history provenance.

This is a **feature / focused** change: it adds user-visible provenance metadata to commits/PR bodies and updates documentation, but the implementation should be cohesive and does not require delegated module planning.

Recommended profile: `excursion`.

Rationale: this is multi-package engine/docs/test work, but it is a cohesive change around provenance rendering and documentation. A single planner can enumerate the affected paths and acceptance criteria without delegating module planning. Choose `expedition` only if implementation expands into a broader provenance manifest/event/console architecture.

## Goal

Make eforge build provenance legible and durable through commit-pinned PR metadata, optional commit-message provenance, and documentation that clearly explains how provenance survives only when branch history is preserved.

## Approach

Implement a focused provenance layer around existing Git artifact commits and PR metadata rendering.

Key design decisions:

1. Keep session plans local/private. Do not solve team planning by checking `.eforge/session-plans/` into Git. This change concerns build-facing provenance after a session plan is handed off.
2. Treat preserved Git history as the provenance guarantee. Eforge should be honest that squash/rebase workflows are allowed but reduce provenance durability. The product message should be explicit: users own that tradeoff.
3. Use commit-pinned artifact references, never branch-relative links. Links to source docs must target a specific commit SHA and path, because cleanup removes the artifacts from the final tree. Branch links such as `main/path` are incorrect after cleanup.
4. Prefer latest non-deletion artifact commit for source-doc links. After cleanup, `git log -1 -- <path>` points at the deletion commit, so provenance lookup should exclude deletions and select the latest add/modify commit for the artifact path.
5. Render both human and machine-friendly references. PR bodies should show readable Markdown links when a GitHub URL can be resolved, and fallback command references like ``git show <sha>:<path>`` when a web URL cannot be derived. Commit messages should use stable trailers or clearly labeled lines rather than environment-specific URLs.
6. Keep trailer ordering stable. If provenance trailers are added to commit messages, the intended order should be: commit subject/body, provenance trailers, `Models-Used` if present, then `Co-Authored-By` appended by `forgeCommit()`. Existing recovery parsing of `Models-Used` should continue to work.
7. Start with PR body provenance as the primary user-visible surface. It is the highest-value place to make source docs legible during review. Per-commit source trailers are valuable but should not require invasive rewiring if the first implementation can provide accurate PR provenance and documentation.
8. Do not introduce a permanent manifest in the first slice. A provenance manifest may become useful later, but the current artifact graph can be derived from known paths and Git history.
9. Keep provenance collection best-effort. Missing artifact commits should not fail landing; the PR body can omit unavailable rows or show an unavailable note. Build correctness should not depend on provenance decoration.
10. Use existing PR metadata plumbing. Direct PRs already call `renderPullRequestMetadata()` before `issuePr()`, and stacked PR landing already accepts metadata for `gh pr edit`; extend those paths rather than creating a parallel PR body renderer.

Expected code impact:

- Add a small provenance helper module, likely `packages/engine/src/provenance.ts`, for artifact reference types and Git lookup helpers.
- The provenance helper should collect latest non-deletion commits for known build artifact paths using Git commands such as `git log --diff-filter=AM --format=%H -1 -- <path>` so cleanup deletion commits are not used as the source-doc commit.
- The provenance helper should render host-agnostic references like ``git show <sha>:<path>``.
- The provenance helper should render commit-pinned web links like `https://github.com/{owner}/{repo}/blob/{sha}/{path}` when a GitHub repository URL can be resolved cheaply.
- `packages/engine/src/pr-metadata.ts` should extend `PullRequestMetadataInput` with optional provenance references.
- `packages/engine/src/pr-metadata.ts` should render a `## Eforge provenance` section.
- `packages/engine/src/landing.ts` should collect provenance from `mergeWorktreePath` after cleanup and before `issuePr()` so PR body references committed-but-cleaned artifacts.
- `packages/engine/src/orchestrator/phases.ts` and `packages/engine/src/stacking/landing.ts` should pass equivalent provenance metadata to stacked PR metadata editing.
- `packages/engine/src/worktree-ops.ts` probably does not need changes unless GitHub repository URL resolution is placed near PR creation helpers.
- `packages/engine/src/model-tracker.ts` should consider extending `composeCommitMessage()` or adding a sibling composer to append eforge provenance trailers before `Co-Authored-By` while preserving `Models-Used` ordering.
- `packages/engine/src/git.ts` should avoid changing `forgeCommit()` behavior unless necessary; it should remain the single attribution appender.
- `packages/engine/src/pipeline/stages/build-stages.ts`, `packages/engine/src/pipeline/runners.ts`, `packages/engine/src/pipeline/git-helpers.ts`, `packages/engine/src/eforge.ts`, `packages/engine/src/retry.ts`, and `packages/engine/src/evaluation/apply.ts` should be audited for eforge-generated commits.
- Source PRD/plan references should be added to eforge-generated commits only where the relevant artifact context is known and reliable.
- If broad commit-trailer coverage becomes too invasive, keep the first implementation to plan/provenance/cleanup/final PR metadata and leave per-implementation commit trailers as a follow-up explicitly noted in docs.
- `docs/config.md` should correct the PRD provenance section to say artifacts may be cleaned from `HEAD` but remain recoverable from preserved history.
- `docs/architecture.md` should add the merge-strategy tradeoff: no-ff/preserved branch history keeps the forge trail; squash/rebase may collapse or discard intermediate provenance commits.
- `README.md` or public docs should add short user-facing guidance near queue/merge/PR workflow description if appropriate.
- `test/prd-artifact.test.ts` should be extended to assert provenance commit SHAs can be retrieved after cleanup and `git show <sha>:<path>` works.
- `test/landing-actions.test.ts` should be extended to assert direct PR body includes an `Eforge provenance` section and no raw attribution trailers.
- `test/stack-runtime-landing.test.ts` should be extended to assert stacked PR metadata editing preserves/includes provenance when provided.
- Unit tests should be added for provenance link rendering, including GitHub URL resolution and fallback `git show` references.
- Tests for trailer ordering should be added if commit-message provenance trailers are implemented.

Assumptions and validation:

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|---|---|---|---|---|---|
| Cleanup removes artifacts from `HEAD` but preserved branch history keeps them available. | Verified `cleanupPlanFiles()` removes plan dir and PRD artifact; `test/prd-artifact.test.ts` asserts artifact appears in git log history but not `HEAD` after cleanup. | high | low | Add an explicit `git show <sha>:<path>` assertion to the existing test. | If wrong, commit-pinned links would not recover cleaned artifacts. |
| `git log --diff-filter=AM --format=%H -1 -- <path>` can identify the latest readable artifact version after cleanup. | Inferred from Git behavior and verified code currently uses Git log for queue metadata; not yet tested in repo. | medium | low | Add a temp-repo unit test where a file is added, modified, deleted, then lookup returns the modify commit and `git show` succeeds. | PR links could point to deletion commits or stale artifact versions. |
| Direct PR and stacked PR metadata paths can share the same provenance rendering shape. | Verified direct PR path uses `renderPullRequestMetadata()` in `landing.ts`; stacked path accepts `PullRequestMetadata` in `stacking/landing.ts` and applies it via `gh pr edit`. | high | low | Add direct and stacked PR metadata tests. | Provenance could appear in direct PRs but drift in stacked PRs. |
| GitHub web links can be resolved cheaply enough when publishing via `gh`. | PR creation already depends on `gh`; repository URL may be available via `gh repo view` or remote parsing, but exact helper behavior has not been chosen. | medium | low | Prototype URL resolution in unit tests for SSH and HTTPS remote forms; fallback to git-show refs when unavailable. | PR body may need to use fallback references more often than web links. |
| Adding provenance trailers will not break existing commit-trailer parsing. | `Models-Used` parsing searches for the label via regex; `forgeCommit()` appends attribution after the message. Ordering still needs a test if new trailers are added. | medium | low | Add tests for composed commit messages containing provenance trailers, `Models-Used`, and `Co-Authored-By`. | Recovery/model reporting could regress if trailer formatting changes unexpectedly. |
| Documentation currently overstates PRD artifact retention. | `docs/config.md` says `eforge/prds/` files are retained after build completion; code cleanup passes PRD artifact path to `cleanupPlanFiles()` and removes it when cleanup is enabled. | high | low | Update docs and, if needed, mention behavior depends on `build.cleanupPlanFiles`. | Users may misunderstand where provenance lives after cleanup. |
| Per-implementation commit source trailers are useful but may require broader plumbing than PR body provenance. | Commit sites are spread across `build-stages.ts`, `runners.ts`, `evaluation/apply.ts`, retry code, and final merge flows. | high | medium | During implementation, inventory each commit site and decide whether context is available without fragile globals. | Over-scoping could turn a focused provenance improvement into a risky cross-cutting refactor. |

## Scope

In scope:

- Document the provenance model plainly: session plans are local/private; build-facing PRD and compiled plan artifacts are committed temporarily; cleanup removes files from the final tree but not from preserved branch history.
- Document that squash/rebase landing can reduce or erase eforge provenance visibility, while merge-commit/preserved branch history retains the full forge trail.
- Add a structured provenance representation for commit-pinned artifact references, including artifact kind, path, commit SHA, and a host-agnostic `git show <sha>:<path>` reference.
- Make PR metadata render a human-readable `## Eforge provenance` section with commit-pinned links or fallback git-show references for the normalized PRD, orchestration file, and compiled plan files.
- Add provenance trailers/sections to relevant eforge commit messages so implementation/build commits can point back to the source PRD and plan document when that context is available.
- Preserve existing `Models-Used` and `Co-Authored-By` trailer ordering.
- Correct stale docs that imply `eforge/prds/` files are retained in the final tree after cleanup.

Out of scope:

- Checking local session plans into version control.
- Creating a team/shared planning workflow.
- Guaranteeing provenance survives squash/rebase workflows.
- Persisting a separate durable provenance database or manifest outside Git.
- Building `console-ui` provenance browsing in this slice.
- Changing the default landing strategy.

## Acceptance Criteria

- Documentation states that eforge session plans remain local/private and are not the shared provenance mechanism.
- Documentation states that build-facing PRD and plan artifacts are committed temporarily and may be removed from the final tree by cleanup.
- Documentation states that preserving eforge branch history retains the forge provenance trail.
- Documentation states that squash or rebase landing may collapse or discard intermediate eforge provenance commits.
- `docs/config.md` no longer claims that `eforge/prds/` files are always retained in the final tree after build completion.
- Direct PR bodies include a `## Eforge provenance` section when provenance artifact commits are available.
- Direct PR provenance rows reference the normalized PRD artifact with a commit-pinned path or a `git show <sha>:<path>` fallback.
- Direct PR provenance rows reference `orchestration.yaml` with a commit-pinned path or a `git show <sha>:<path>` fallback.
- Direct PR provenance rows reference each compiled plan file with a commit-pinned path or a `git show <sha>:<path>` fallback.
- Stacked PR metadata can include the same `## Eforge provenance` section used by direct PR metadata.
- Provenance link generation never emits branch-relative artifact links for cleaned build artifacts.
- Provenance collection excludes cleanup deletion commits when selecting source-doc artifact commits.
- A temp-repo test proves that a cleaned artifact can be read with `git show <sha>:<path>` using the collected provenance commit SHA.
- Existing PR metadata tests continue to assert that raw `Co-Authored-By:` trailers are absent from PR bodies.
- Existing PR metadata tests continue to assert that raw `Models-Used:` trailers are absent from PR bodies.
- If commit-message provenance trailers are implemented, a test asserts that provenance trailers appear before `Models-Used` and `Co-Authored-By`.
- `pnpm test -- prd-artifact landing-actions stack-runtime-landing` exits 0.
- `pnpm type-check` exits 0.
