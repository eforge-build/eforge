---
id: plan-02-forgecommit-sweep
name: Route every engine commit through forgeCommit()
depends_on: []
branch: hardening-04-engine-emission-hygiene/forgecommit-sweep
---

# Route every engine commit through forgeCommit()

## Architecture Context

`AGENTS.md` states: *All engine commits use `forgeCommit()` from `packages/engine/src/git.ts` — this appends the `Co-Authored-By: forged-by-eforge` trailer. Do not use raw `exec('git', ['commit', ...])` in engine code outside of `git.ts` and `worktree.ts`.*

Three raw `git commit` calls in `packages/engine/src/worktree-ops.ts` bypass this helper, so their commits lack the attribution trailer, breaking attribution queries. This plan widens `forgeCommit()` as needed and replaces every raw commit site. Pipeline already uses `forgeCommit()` for plan artifacts (`pipeline.ts:2075`).

## Implementation

### Overview

1. Widen `forgeCommit()` in `packages/engine/src/git.ts` to support a `reuseMessage: true` mode that runs `git commit --no-edit` while still ensuring the attribution trailer is attached (the existing `MERGE_MSG` file must be rewritten to include the trailer before the `--no-edit` commit runs).
2. Replace each raw `exec('git', ['commit', ...])` call in `packages/engine/src/worktree-ops.ts` with `forgeCommit()`:
   - Line 156: squash-merge commit — `forgeCommit(cwd, commitMessage)`.
   - Line 173: same pattern after conflict resolution — `forgeCommit(cwd, commitMessage)`.
   - Line 292: `git commit --no-edit` after merge conflict resolution — `forgeCommit(repoRoot, undefined, { reuseMessage: true })` (the helper reads and rewrites `MERGE_MSG` then runs `--no-edit`).
3. Keep `retryOnLock()` semantics intact — `forgeCommit()` already retries internally.
4. Add a unit test in `test/git-forge-commit.test.ts` that spins up a temp git repo and asserts every commit produced by `forgeCommit()` (including the `reuseMessage` branch) contains the `Co-Authored-By: forged-by-eforge` trailer.

### Key Decisions

1. **Signature shape**: widen to `forgeCommit(cwd: string, message: string | undefined, options?: { paths?: string[]; reuseMessage?: boolean }): Promise<void>`. When `reuseMessage` is true, `message` is ignored and the helper rewrites `.git/MERGE_MSG` (via `git rev-parse --git-dir`) to append the attribution, then runs `git commit --no-edit`. When `reuseMessage` is false or absent, behavior is identical to today.
2. **Why rewrite `MERGE_MSG`** instead of always passing `-m`: the post-conflict-resolution path specifically wants Git's preserved merge message (including conflict summary), and forcing `-m` would lose that. Appending to `MERGE_MSG` preserves the existing text and guarantees the trailer.
3. **Existing `paths` parameter**: move into the `options` object for consistency. Update the single call site in `pipeline.ts` if it passes paths (currently at line 2075 it does not, so no breaking change).

## Scope

### In Scope
- Widen `forgeCommit()` signature with a `reuseMessage` option.
- Replace 3 raw commit sites in `packages/engine/src/worktree-ops.ts`.
- Add unit test asserting trailer presence for both standard and `reuseMessage` modes.

### Out of Scope
- Console.* removal (plan-01).
- Prompt variable enforcement (plan-03).
- Changes to `pipeline.ts` commit flow beyond any signature ripple from moving `paths` into options (only if the existing call passes `paths`, which it does not).

## Files

### Create
- `test/git-forge-commit.test.ts` — temp-repo integration test: for each commit shape (standard with `-m`, standard with paths, `reuseMessage` after merge), assert the last commit message contains the exact string `Co-Authored-By: forged-by-eforge <noreply@eforge.build>`.

### Modify
- `packages/engine/src/git.ts` — extend `forgeCommit()` to accept `options?: { paths?: string[]; reuseMessage?: boolean }`. When `reuseMessage` is true: resolve `.git/MERGE_MSG` via `git rev-parse --git-dir`, read it, append `\n\n${ATTRIBUTION}` if not already present, write it back, then run `git commit --no-edit`. Keep the existing `retryOnLock` wrapping.
- `packages/engine/src/worktree-ops.ts` — replace the three raw commit calls at lines 156, 173, 292 with `forgeCommit()` invocations. Remove any `retryOnLock` wrapping around those three calls since `forgeCommit()` already retries internally.

## Verification

- [ ] `rg "exec\('git', \['commit'" packages/engine/src` returns zero hits outside `packages/engine/src/git.ts`.
- [ ] `forgeCommit()` signature accepts `{ paths?, reuseMessage? }` options and preserves the existing single-string-message call pattern.
- [ ] `test/git-forge-commit.test.ts` contains one test per commit mode (standard, with paths, reuseMessage) and each asserts the resulting commit message contains `Co-Authored-By: forged-by-eforge <noreply@eforge.build>`.
- [ ] Running a build that triggers a squash-merge (plan-02 branch merge) produces a commit whose `git log -1 --format=%B` output contains the attribution trailer.
- [ ] Running a build that triggers merge-conflict resolution produces a commit whose message contains both the preserved merge message and the attribution trailer.
- [ ] `pnpm test` passes.
- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes.
