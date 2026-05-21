# Contributing to eforge

Thanks for your interest in eforge. The project is still young and moving quickly, so the contribution process is intentionally lightweight.

> **Current status:** the maintainer may not be actively accepting unsolicited issues or PRs at all times. This workflow documents the intended public development process and is the model maintainers use for their own work.

## Development model

eforge uses trunk-based development:

- `main` is the only long-lived development branch.
- `main` should remain releasable.
- Work happens on short-lived branches created from `main`.
- Pull requests target `main`.
- There is no `develop` branch.

Use focused branch names, for example:

```text
feat/release-smoke-tests
fix/daemon-status-output
docs/releasing-policy
refactor/profile-routing
```

For local eforge planning/build sessions, prefer working from a feature branch rather than directly on `main`:

```bash
git checkout main
git pull --ff-only
git checkout -b feat/my-change
# plan/build/review/test here
```

This keeps `main` clean, makes generated changes easy to review, and makes it safe to abandon experimental work.

## Before opening a PR

Run the relevant checks locally:

```bash
pnpm build
pnpm type-check
pnpm test
pnpm docs:check
```

If your change affects the public docs site, also run:

```bash
pnpm docs:build
```

If your change affects generated reference docs, run:

```bash
pnpm docs:generate
```

and commit the generated changes.

## Pull request expectations

A good PR should include:

- a clear description of the problem and solution
- tests or an explanation of why tests are not applicable
- documentation updates for user-facing behavior changes
- notes about breaking changes, migrations, or operational impact

Keep PRs as small and coherent as practical. Large architecture or behavior changes should usually start with discussion before implementation.

## Release branches

Do not create release branches for normal work. Releases are cut from `main` by maintainers. A `release/X.Y` branch may be created later only when the project needs to patch an older supported release line.

See [docs/releasing.md](docs/releasing.md) for the maintainer release process.
