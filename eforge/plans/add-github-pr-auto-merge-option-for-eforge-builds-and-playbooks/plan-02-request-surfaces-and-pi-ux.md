---
id: plan-02-request-surfaces-and-pi-ux
name: Daemon, CLI, MCP, and Pi Auto-Merge Selection
branch: add-github-pr-auto-merge-option-for-eforge-builds-and-playbooks/plan-02-request-surfaces-and-pi-ux
agents:
  builder:
    effort: high
    rationale: This plan updates multiple consumer-facing request paths and must
      preserve explicit true, explicit false, and omitted override semantics.
---

# Daemon, CLI, MCP, and Pi Auto-Merge Selection

## Architecture Context

After plan-01, the engine and client contracts can represent per-run PR auto-merge intent. This plan wires the intent through daemon HTTP routes, CLI/MCP tools, native Pi tools, and the shared Pi landing selector used by `/eforge:build` and autonomous `/eforge:playbook run`.

## Implementation

### Overview

Add `landingAutoMerge` request support and expose “Open PR and enable auto-merge” in Pi selectors when `landing.pr.autoMerge` permits it. Preserve omission semantics for “Use project default”: when the user selects project default, do not send `landingAction` or `landingAutoMerge`.

### Key Decisions

1. CLI flags use paired booleans: `--landing-auto-merge` and `--no-landing-auto-merge`. The `--no-...` form is necessary to disable auto-merge when project policy is `always`.
2. MCP and Pi tool schemas expose `landingAutoMerge?: boolean` alongside `landingAction?: 'pr' | 'merge' | 'leave'`.
3. Pi selector values use an internal synthetic choice, for example `pr-auto-merge`, and return `{ landingAction: 'pr', landingAutoMerge: true }`.
4. Plain “Open PR” returns `{ landingAction: 'pr', landingAutoMerge: false }` when policy is `always` so users can explicitly opt out; with `ask`, plain PR can omit or send false, but tests must assert the engine receives a false/omitted value that does not enable auto-merge.
5. Daemon routes validate `landingAutoMerge` as a boolean, reject explicit `true` when resolved policy is `never`, and reject `landingAutoMerge: true` when the effective landing action is not `pr` with a 400 diagnostic.

## Scope

### In Scope

- CLI flags and in-process/delegated enqueue plumbing.
- MCP proxy schemas and request bodies for build enqueue and playbook run.
- Daemon `/api/enqueue` and `/api/playbook/run` validation and forwarding.
- Native Pi `eforge_build` and `eforge_playbook` tool schemas and request bodies.
- Shared Pi landing policy model and landing gate result type extended with auto-merge choices.
- `/eforge:build` skill-argument propagation from native command handler.
- `/eforge:playbook run` immediate, delayed, and fallback enqueue body propagation.
- Tests for CLI flags, daemon validation, Pi menu policy, build command args, and playbook body propagation.

### Out of Scope

- Engine auto-merge execution and event schemas, completed in plan-01.
- User-facing markdown docs and generated reference docs, handled in plan-03.

## Files

### Create

- None expected.

### Modify

- `packages/monitor/src/server.ts` — parse `landingAutoMerge` on `/api/enqueue` and `/api/playbook/run`; validate boolean type, effective `pr` action requirement, and `landing.pr.autoMerge !== 'never'` for explicit true; pass `--landing-auto-merge` or `--no-landing-auto-merge` to workers/enqueue helpers as needed.
- `packages/eforge/src/cli/landing-options.ts` — add helpers for resolving paired auto-merge flags into `boolean | undefined`, and enforce conflict handling when both true and false forms are somehow present.
- `packages/eforge/src/cli/index.ts` — add `--landing-auto-merge` / `--no-landing-auto-merge` to `enqueue`, `build`, queue run/exec paths that accept landing options; pass the resolved boolean to `engine.enqueue`, `engine.runQueue`, `runOrDelegate`, and queue child worker options.
- `packages/eforge/src/cli/run-or-delegate.ts` — add `landingAutoMerge?: boolean` to build options; include it in daemon `apiEnqueue` bodies and in-process `engine.enqueue` / `engine.runQueue` calls.
- `packages/eforge/src/cli/mcp-proxy.ts` — add `landingAutoMerge?: boolean` to `eforge_build` and `eforge_playbook` schemas and request bodies.
- `packages/pi-eforge/extensions/eforge/landing-policy.ts` — add `PrAutoMergePolicy = 'ask' | 'always' | 'never'`, include policy/effective default descriptions, and add PR auto-merge choices to normal and remediation menus when policy permits.
- `packages/pi-eforge/extensions/eforge/landing-gate.ts` — load `resolved.landing.pr.autoMerge`, return `landingAutoMerge?: boolean`, map synthetic `pr-auto-merge` choice, and enforce non-interactive guard errors for explicit true under policy `never`.
- `packages/pi-eforge/extensions/eforge/build-command.ts` — detect `--landing-auto-merge`, `--no-landing-auto-merge`, and `landingAutoMerge` as explicit landing overrides; append both `--landing-action pr` and `--landing-auto-merge` when the selector chooses PR auto-merge.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — include `landingAutoMerge` in immediate, delayed, and fallback `apiPlaybookRunIfRunning` bodies.
- `packages/pi-eforge/extensions/eforge/index.ts` — add `landingAutoMerge` to `eforge_build` and `eforge_playbook` tool schemas/descriptions; include it in daemon request bodies after the landing gate.
- `test/cli-landing-options.test.ts` — add paired flag resolution tests for omitted, true, false, and conflicting auto-merge inputs.
- `test/playbook-api.test.ts` — add daemon route tests for persisting `landing_auto_merge`, rejecting invalid non-boolean values, rejecting explicit true under policy `never`, delayed `afterQueueId`, and fallback behavior if covered in this file.
- `test/pi-landing-policy.test.ts` — cover `ask`, `always`, and `never` menu shapes, including protected-trunk remediation choices and absence of auto-merge when policy is `never`.
- `test/pi-build-command.test.ts` — cover command output for PR auto-merge selection and explicit auto-merge argument bypass.
- `test/pi-playbook-commands.test.ts` — cover `landingAutoMerge` in immediate, delayed, and fallback enqueue request bodies.
- Existing CLI/MCP tests such as `test/cli-playbook.test.ts` — update if they assert exact schema/body shapes.

## Verification

- [ ] `resolveAndValidateLandingAutoMergeFlags({ landingAutoMerge: true })` returns `true` and the false form returns `false`.
- [ ] `eforge build <source> --landing-action pr --landing-auto-merge` sends `{ landingAction: 'pr', landingAutoMerge: true }` to the daemon path when a daemon lockfile is present.
- [ ] `/api/enqueue` returns 400 for `{ landingAction: 'merge', landingAutoMerge: true }`.
- [ ] `/api/playbook/run` enqueues a PRD whose frontmatter contains `landing: pr` and `landing_auto_merge: true` when both fields are supplied.
- [ ] Pi `buildLandingMenuModel` with `autoMergePolicy: 'ask'` includes both `pr` and `pr-auto-merge` choices.
- [ ] Pi `buildLandingMenuModel` with `autoMergePolicy: 'never'` excludes `pr-auto-merge` in normal and remediation choices.
- [ ] Native `/eforge:playbook run` fallback after stale `afterQueueId` preserves `landingAutoMerge: true` in the second enqueue body.
