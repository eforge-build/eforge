---
name: dependency-update
description: Update workspace dependencies and validate the repo
scope: project-team
mode: autonomous
---

## Goal

Update this pnpm workspace’s dependencies using the repo’s current package-manager conventions, then make any minimal compatibility fixes needed so the project remains healthy.

## Out of scope

- Do not change product behavior beyond dependency compatibility fixes.
- Do not perform broad refactors unrelated to dependency updates.
- Do not bump package publish versions unless required by existing repo tooling.
- Do not change the configured package manager away from pnpm.

## Acceptance criteria

- Dependencies are updated using the workspace-aware pnpm workflow appropriate for this repo.
- `package.json` files and `pnpm-lock.yaml` are updated consistently.
- Workspace/internal `workspace:*` dependencies remain intact.
- Supply-chain sanity checks are performed for dependency changes, including:
  - review `package.json` and `pnpm-lock.yaml` diffs for unexpected new packages
  - run `pnpm audit` when available
  - inspect newly introduced, major-version, or otherwise suspicious packages for lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`), repository/maintainer changes, and unexpected native/build behavior
  - use package-diff tooling such as `npm diff --diff <pkg>@<old> --diff <pkg>@<new>` when a changed package looks risky or high-impact
- Required validation passes:
  - `pnpm build`
  - `pnpm type-check`
  - `pnpm test`
- Any dependency-related breakages are fixed with minimal, targeted changes.
- The final summary identifies notable dependency updates and any compatibility fixes made.

## Notes for the planner

This repo is a pnpm monorepo with `packageManager` declared in the root `package.json`. Prefer pnpm-native commands such as `pnpm update -r` / the current best-practice equivalent for this repo. Inspect the workspace and lockfile before choosing whether to update only lockfile-resolved versions or package ranges. Keep changes mechanical and validation-focused.

Treat dependency updates as a supply-chain-sensitive workflow. This repo restricts allowed dependency build scripts via `pnpm.onlyBuiltDependencies`; do not expand that list casually. If an update introduces a package that needs install/build scripts, document why it is expected and safe. Flag suspicious signs in the final summary rather than silently accepting them: unexpected new transitive dependencies, package ownership/repository changes, lifecycle scripts, obfuscated/minified package contents, native binaries, or unusually large diffs.
