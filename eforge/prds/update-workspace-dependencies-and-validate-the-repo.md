---
title: Update workspace dependencies and validate the repo
created: 2026-05-28
landing: pr
---

# Update workspace dependencies and validate the repo



## Goal

Update this pnpm workspace's dependencies using the repo's current package-manager conventions, then make any minimal compatibility fixes needed so the project remains healthy.

## Out of scope

- Do not change product behavior beyond dependency compatibility fixes.
- Do not perform broad refactors unrelated to dependency updates.
- Do not bump package publish versions unless required by existing repo tooling.
- Do not change the configured package manager away from pnpm.

## Acceptance criteria

- Dependencies are updated using this repo's workspace-aware pnpm workflow.
- `package.json` files and `pnpm-lock.yaml` are updated consistently.
- Workspace/internal `workspace:*` dependencies remain intact.
- A tracked dependency-update evidence artifact is added or updated in the implementation diff.
- The tracked dependency-update evidence artifact records `pnpm audit` exit status.
- The tracked dependency-update evidence artifact records `pnpm audit` findings.
- The tracked dependency-update evidence artifact records manifest diff-review conclusions.
- The tracked dependency-update evidence artifact records lockfile diff-review conclusions.
- The tracked dependency-update evidence artifact records whether unexpected new packages were found.
- The tracked dependency-update evidence artifact records lifecycle-script inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records repository inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records maintainer inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records native/build-behavior inspection for newly introduced, major-version, or suspicious package changes.
- The tracked dependency-update evidence artifact records `npm diff` review conclusions for risky or high-impact package changes.
- The tracked dependency-update evidence artifact states that no package changes required `npm diff` when no risky or high-impact package changes are present.
- `pnpm build` exits 0.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- Any dependency-related breakages are fixed with minimal, targeted changes.

## Notes for the planner

This repo is a pnpm monorepo with `packageManager` declared in the root `package.json`. Prefer pnpm-native commands such as `pnpm update -r` / the current best-practice equivalent for this repo. Inspect the workspace and lockfile before choosing whether to update only lockfile-resolved versions or package ranges. Keep changes mechanical and validation-focused.

Treat dependency updates as a supply-chain-sensitive workflow. This repo restricts allowed dependency build scripts via `pnpm.onlyBuiltDependencies`; do not expand that list casually. If an update introduces a package that needs install/build scripts, document why it is expected and safe. Flag suspicious signs in the tracked evidence artifact rather than silently accepting them: unexpected new transitive dependencies, package ownership/repository changes, lifecycle scripts, obfuscated/minified package contents, native binaries, or unusually large diffs.
