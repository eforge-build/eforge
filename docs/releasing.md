# Releasing eforge

This document describes the maintainer release process for the npm packages in this monorepo.

## Release model

- `main` is the release branch.
- `main` should always be in a releasable state.
- Releases are created by annotated tags named `vX.Y.Z`.
- Pushing a `v*` tag triggers the npm publish workflow.
- Published packages move in lockstep from the version in `packages/eforge/package.json`.
- Normal releases publish to the default npm dist-tag (`latest`).

There is intentionally no `develop` branch. Feature work should land through short-lived branches and PRs into `main`.

## Versioning policy

eforge is currently pre-1.0. Until 1.0:

- patch releases are intended for backwards-compatible bug fixes
- minor releases may include breaking changes
- breaking changes should be called out clearly in release notes and docs

The supported public surface should stay explicit. CLI behavior, config files, daemon APIs, extension APIs, package exports, and input artifact formats may mature at different rates; document instability where users may depend on it.

## Standard release flow

Use the project-local Pi maintainer extension:

```text
/dev release
```

The wizard:

1. Starts from a clean checkout of `main`.
2. Runs the release check suite (`build`, `type-check`, `test`, `docs:check`, `docs:build`).
3. Creates a `release/vX.Y.Z` branch.
4. Generates release notes from commits since the previous tag.
5. Updates and commits `CHANGELOG.md`.
6. Runs `pnpm release patch|minor|major --no-tag` to commit the lockstep version bump without tagging.
7. Opens a PR to `main` and enables auto-merge.
8. After the PR merges, tags the merged `main` commit.
9. Pushes only `refs/tags/vX.Y.Z`.
10. Creates the GitHub Release from the changelog notes.

If Pi exits before the PR merges, run:

```text
/dev release-finalize vX.Y.Z
```

Pushing the `v*` tag triggers the **Publish to npm** GitHub Actions workflow. The workflow runs `pnpm publish-all`, which propagates the lockstep version, builds, type-checks, tests, and publishes public packages with npm trusted publishing.

Afterward, verify the release:

- confirm the GitHub Actions workflow passed
- confirm npm shows the expected package versions
- confirm the GitHub Release exists
- sanity-check installation with `npx @eforge-build/eforge --help` or an equivalent smoke test

## Prereleases and npm dist-tags

When the project needs public release candidates, use SemVer prerelease versions and publish them under a non-`latest` npm dist-tag, for example:

```text
v0.9.0-beta.1 -> next
v0.9.0-rc.1   -> next
```

Do not publish prereleases to `latest` unless intentionally promoting them as stable.

## Release branches and hotfixes

Do not create release branches for ordinary releases. If users need a critical fix on an older supported line, create a branch for that line, cherry-pick the fix, and tag from that branch:

```bash
git checkout -b release/0.8 v0.8.6
# cherry-pick/apply fix
git tag -a v0.8.7 -m "v0.8.7"
git push origin release/0.8 v0.8.7
```

Use this only when there is a real need to support an older release line; otherwise keep releases flowing from `main`.

## Recommended repository protections

Before broader adoption, configure GitHub protections so the release process remains safe:

- protect `main`
- require CI before merge
- require maintainer approval for PRs
- restrict or protect `v*` tag creation
- ensure publish workflows run only from the canonical repository
- keep npm trusted publishing/OIDC enabled

These protections make tag-triggered publishing safe while keeping the day-to-day workflow simple.
