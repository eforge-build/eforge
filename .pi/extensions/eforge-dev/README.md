# eforge-dev Pi extension

Project-local maintainer workflow extension for developing eforge itself.

This extension is intentionally separate from the published `@eforge-build/pi-eforge` integration. The published extension owns user-facing eforge commands (`/eforge:*`). This project-local extension owns repository-specific maintainer workflows under `/dev`.

Generic branch/check/PR landing workflows now also live in the shared `git-workflow` Pi extension from `pi-dotfiles` and are available as `/git ...`, configured by `.pi/git-workflow.json`. `/dev` keeps the eforge maintainer cockpit and eforge-specific release/restart/event-tail flows.

## Commands

```text
/dev              Open the maintainer cockpit panel
/dev branch       Delegate to shared /git branch
/dev checks       Delegate to shared /git checks
/dev pr           Delegate to shared /git pr
/dev land         Delegate to shared /git land
/dev restart      Build from source and restart the local eforge daemon
/dev release      Guided protected-main release flow: PR, auto-merge, then tag merged main
/dev release-finalize vX.Y.Z
                  After a release PR merges, tag main and push only the tag
/dev plan         Invoke the generic eforge-plan planning entry for the published pi-eforge flow
/dev tail-events [type|all] [limit] [plan=<id>] [run=<id>]
                  Live-tail eforge monitor events from .eforge/monitor.db
/dev tail-extension-events [name] [limit]
                  Preset live-tail for extension runtime events
/dev refresh      Refresh footer/widget status
```

Use `/git branch` directly for branch creation/switching. `/dev branch` remains a compatibility shim that forwards to `/git branch`.

## Event tails

`/dev tail-events` opens a live panel of recent monitor events. Pass a type/prefix, limit, plan id, or run id to filter:

```text
/dev tail-events
/dev tail-events agent 50
/dev tail-events plan:build:* plan=plan-02-api-cli
/dev tail-events all 100 run=21652686-793a-4d61-b311-8bb2760a6d45
```

`/dev tail-extension-events` is a preset for recent `extension:*` events. Pass an extension name to filter, for example:

```text
/dev tail-extension-events eforge-guardrails
/dev tail-extension-events eforge-guardrails 50
/dev tail-extension-events all 100
```

These are local dogfooding helpers. If they prove useful, a more polished version may eventually belong in the published `packages/pi-eforge` integration.

## Policy helpers

- Shows current branch and dirty status in the Pi footer.
- Shows an informational widget when working on `main`.
- Injects a non-blocking note into the agent context when on `main`.
- Does not block or require confirmation for edits/commands solely because the current branch is `main`; local developers are assumed to know what they are doing.

## Release flow

`/dev release` no longer pushes directly to protected `main`. It creates a `release/vX.Y.Z` branch, generates release notes, updates `CHANGELOG.md`, runs `pnpm release <bump> --no-tag`, opens a PR to `main`, enables auto-merge, waits optionally, then tags the merged `main` commit and pushes only `refs/tags/vX.Y.Z` to trigger npm publish. Finalization also creates the GitHub Release from the changelog notes.

If Pi exits before the PR merges, run `/dev release-finalize vX.Y.Z` after the PR has merged to tag, push the tag, and create the GitHub Release.

These are local UX helpers only. GitHub branch/tag protections and CI remain the hard enforcement layer.
