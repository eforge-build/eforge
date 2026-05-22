# eforge-dev Pi extension

Project-local maintainer workflow extension for developing eforge itself.

This extension is intentionally separate from the published `@eforge-build/pi-eforge` integration. The published extension owns user-facing eforge commands (`/eforge:*`). This project-local extension owns repository-specific maintainer workflows under `/dev`.

## Commands

```text
/dev              Open the maintainer cockpit overlay
/dev branch       Create or switch to a short-lived feature branch
/dev checks       Run build, type-check, test, docs:check, and docs:build
/dev pr           Show PR-readiness summary
/dev land         Auto-commit with /skill:commit, check, and open a PR, optionally enabling auto-merge after CI passes
/dev restart      Build from source and restart the local eforge daemon
/dev release      Guided protected-main release flow: PR, auto-merge, then tag merged main
/dev release-finalize vX.Y.Z
                  After a release PR merges, tag main and push only the tag
/dev plan         Prefill /eforge:plan for the published pi-eforge flow
/dev refresh      Refresh footer/widget status
```

## Policy helpers

- Shows current branch and dirty status in the Pi footer.
- Shows a warning widget when working on `main`.
- Injects a reminder into the agent context when on `main`.
- Asks for confirmation before `edit`/`write` tool calls on `main`.
- Asks for confirmation before guarded bash commands on `main`, including release/publish/tag/push commands.

## Release flow

`/dev release` no longer pushes directly to protected `main`. It creates a `release/vX.Y.Z` branch, generates release notes, updates `CHANGELOG.md`, runs `pnpm release <bump> --no-tag`, opens a PR to `main`, enables auto-merge, waits optionally, then tags the merged `main` commit and pushes only `refs/tags/vX.Y.Z` to trigger npm publish. Finalization also creates the GitHub Release from the changelog notes.

If Pi exits before the PR merges, run `/dev release-finalize vX.Y.Z` after the PR has merged to tag, push the tag, and create the GitHub Release.

These are local UX guardrails only. GitHub branch/tag protections and CI remain the hard enforcement layer.
