# eforge-dev Pi extension

Project-local maintainer workflow extension for developing eforge itself.

This extension is intentionally separate from the published `@eforge-build/pi-eforge` integration. The published extension owns user-facing eforge commands (`/eforge:*`). This project-local extension owns repository-specific maintainer workflows under `/dev`.

## Commands

```text
/dev              Open the maintainer cockpit overlay
/dev branch       Create or switch to a short-lived feature branch
/dev checks       Run build, type-check, test, docs:check, and docs:build
/dev pr           Show PR-readiness summary
/dev restart      Build from source and restart the local eforge daemon
/dev release      Guided main-only release flow
/dev plan         Prefill /eforge:plan for the published pi-eforge flow
/dev refresh      Refresh footer/widget status
```

## Policy helpers

- Shows current branch and dirty status in the Pi footer.
- Shows a warning widget when working on `main`.
- Injects a reminder into the agent context when on `main`.
- Asks for confirmation before `edit`/`write` tool calls on `main`.
- Asks for confirmation before guarded bash commands on `main`, including release/publish/tag/push commands.

These are local UX guardrails only. GitHub branch/tag protections and CI remain the hard enforcement layer.
