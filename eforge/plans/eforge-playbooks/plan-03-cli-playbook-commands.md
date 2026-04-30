---
id: plan-03-cli-playbook-commands
name: "CLI: eforge playbook commands and eforge play shortcut"
branch: eforge-playbooks/cli
---

# CLI: eforge playbook commands and eforge play shortcut

## Architecture Context

The `eforge` CLI is registered with `commander` in `packages/eforge/src/cli/index.ts`. Each top-level command uses `program.command(...).action(...)` and delegates to daemon HTTP via `@eforge-build/client` typed helpers — the CLI never re-implements daemon logic. Queue rendering lives in `packages/eforge/src/cli/display.ts` (`renderQueueList`).

This plan exposes the playbook surface area to scripts and power users. The slash-command skill in plan-04 is the documented user-facing surface; the CLI is a parallel scriptable surface that the skill itself also calls in some branches (e.g. Run with `--after`).

## Implementation

### Overview

1. **New `eforge playbook` command** in `packages/eforge/src/cli/playbook.ts` with subcommands implemented as a single-command-with-positional-action (matches the existing eforge CLI style — top-level commands take an action string rather than commander subcommands). Required actions:
   - `eforge playbook list` — calls `apiPlaybookList`, renders via a new `renderPlaybookList` helper showing `name`, `description`, `[source]`, and full shadow chain (e.g. `shadows project-team, user`).
   - `eforge playbook new` — non-interactive scaffold for scripts: takes `--scope`, `--name`, `--description`, `--from <file>` for body content. Skill consumers call `apiPlaybookSave` directly.
   - `eforge playbook edit <name>` — opens the resolved playbook in `$EDITOR`; on save, validates via `apiPlaybookValidate`; on success, writes via `apiPlaybookSave` to the same tier the file was loaded from. Refuses to launch if `$EDITOR` is unset and prints guidance.
   - `eforge playbook run <name> [--after <queue-id>]` — calls `apiPlaybookEnqueue` with `name` and optional `afterQueueId`. The PRD's CLI primitive for piggyback. Prints the resulting queue id.
   - `eforge playbook promote <name>` — calls `apiPlaybookPromote`, then runs `git add` on the new path so the user's next commit picks it up. Prints the destination path.
   - `eforge playbook demote <name>` — calls `apiPlaybookDemote`; does not stage (the file is now gitignored).
2. **`eforge play` shortcut** — register `program.command('play <name>')` as an alias that delegates to `eforge playbook run <name>` with the same flag surface (`--after`).
3. **Display module** (`packages/eforge/src/cli/display.ts`) — add `renderPlaybookList` that aligns columns and uses `chalk` for source labels (matching `renderQueueList`'s style). Indented queue rendering for piggyback children is deferred to plan-05; this plan does not change `renderQueueList`.
4. **Wire into the top-level program** in `packages/eforge/src/cli/index.ts` by importing and calling the registration function from `playbook.ts` (mirrors how queue/profile/config commands are registered today).
5. **Error handling** — daemon errors surface as non-zero exit codes with the daemon's `error` message printed to stderr; mirrors how `eforge enqueue` handles daemon failures.

### Key Decisions

1. **CLI is a thin client.** Every action calls a daemon helper from plan-02; no engine imports. This keeps the CLI cheap to maintain and ensures a single validation/persistence path.
2. **`edit` uses `$EDITOR` round-trip.** Scriptable, terminal-friendly, and matches Unix convention. The conversational section-by-section walk lives in the skill (plan-04), not the CLI.
3. **`promote` stages with `git add`.** The PRD acceptance criterion specifically calls for staging-for-commit; we do not commit, just stage, leaving the user in control of the commit message. (Mirrors `eforge config` writes which also stay out of `forgeCommit`.)
4. **`eforge play` is a true alias, not a separate code path.** It delegates to `eforge playbook run` so the two surfaces cannot drift.

## Scope

### In Scope
- `eforge playbook list / new / edit / run / promote / demote` commands.
- `eforge play <name>` shortcut delegating to `playbook run`.
- `renderPlaybookList` display helper with source and shadow rendering.
- Validation round-trip on `edit` save.
- Argument-parsing tests.

### Out of Scope
- Conversational menu / handheld UX (plan-04).
- Queue-list nesting for piggyback (plan-05).
- Wait-for-build conversational matcher (plan-05; CLI accepts a literal `--after <queue-id>` only).

## Files

### Create
- `packages/eforge/src/cli/playbook.ts` — command registration and action handlers for all six actions; calls `apiPlaybook*` helpers.
- `test/cli-playbook.test.ts` — argument parsing for each subcommand (action dispatch, required vs optional flags, `--after` propagation through `eforge play`); uses commander's testable interface, no daemon round-trip required (the helpers are mocked at the import boundary or invoked against a stub daemon as the existing CLI tests do).

### Modify
- `packages/eforge/src/cli/index.ts` — import and register the playbook command and the `play` shortcut.
- `packages/eforge/src/cli/display.ts` — add `renderPlaybookList`; adjust shared styling helpers if needed.

## Verification

- [ ] `pnpm type-check` passes.
- [ ] `pnpm test` passes; CLI parsing tests cover all six actions and the `play` alias.
- [ ] `eforge playbook list` against a fixture with three-tier playbooks prints each name once, with `[source]` labels and `shadows project-team, user`-style chain notes when applicable.
- [ ] `eforge playbook run docs-sync --after q-abc` causes the daemon to persist a PRD with `dependsOn: ['q-abc']` (verified via `eforge queue list`).
- [ ] `eforge play docs-sync --after q-abc` produces the same observable result as `eforge playbook run docs-sync --after q-abc`.
- [ ] `eforge playbook promote tech-debt-sweep` moves the file from `.eforge/playbooks/` to `eforge/playbooks/` and the new path is staged (`git diff --cached --name-only` includes it).
- [ ] `eforge playbook edit <name>` rejects an invalid edit with the daemon's validation errors and leaves the on-disk file unchanged.
- [ ] `eforge playbook edit` exits non-zero with a clear message when `$EDITOR` is unset.
