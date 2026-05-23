---
title: Add Shared Landing Gate UX for Autonomous Playbook Runs
created: 2026-05-23
profile: gpt-claude-combo
---

# Add Shared Landing Gate UX for Autonomous Playbook Runs

## Problem / Motivation

Autonomous playbook runs currently enqueue directly through the playbook run path and can bypass the branch-aware landing gates used by `/eforge:build`. This means a playbook run from `main` may silently inherit the configured/default landing action without requiring the user to explicitly confirm or select whether the completed build should open a PR, merge locally, or leave the branch.

## Goal

Make `/eforge:playbook run` use the same landing decision/safety flow as `/eforge:build`, with a clean DRY implementation. Autonomous playbook runs should require an explicit landing choice in the Pi UI before enqueueing, and that choice should be persisted into the queued PRD so the daemon/engine lands the build accordingly.

## Approach

- Add `onSuccess` support to the playbook run API/request path (`PlaybookRunRequest`, client helpers, MCP/Pi tool schemas, daemon route) and pass it through to `enqueuePrd(...)` so it is written to queue frontmatter.
- Extract the current Pi trunk/landing prompt logic from `packages/pi-eforge/extensions/eforge/index.ts` into a shared helper module, for example `landing-gate.ts`.
- Have both `eforge_build` and native `/eforge:playbook run` call the shared helper instead of duplicating trunk/branch policy logic.
- Support two call modes:
  - Current build behavior that prompts only when needed for unsafe trunk local-merge.
  - Playbook behavior that explicitly asks the user to choose `issue-pr`, `merge-to-base-branch`, or `leave-branch` before enqueueing.
- Preserve daemon headless behavior: daemon validates/persists `onSuccess`; engine remains the authoritative final trunk-safety backstop.
- Keep Pi and Claude plugin/MCP surfaces in sync per project convention.
- Requested build profile: `gpt-claude-combo`.

## Scope

In scope:

- Pi native playbook run UX.
- Shared Pi landing-gate helper.
- Playbook run API/client/MCP schema propagation for `onSuccess`.
- Skill/docs updates for Pi and Claude plugin parity.
- Tests for helper behavior and API propagation.

Out of scope:

- Changing engine landing semantics beyond existing safety enforcement.
- Adding daemon-side interactive prompts.
- Changing planning-mode playbook investigation flow except documentation as needed.

## Acceptance Criteria

- `/eforge:playbook run <autonomous-playbook>` in Pi presents an explicit landing choice before enqueueing.
- Choosing `issue-pr`, `merge-to-base-branch`, or `leave-branch` passes that choice through to queued PRD frontmatter as `onSuccess`.
- If `merge-to-base-branch` is selected on trunk while `build.allowLocalMergeToTrunk` is false, the same trunk-safety gate/remediation used by `/eforge:build` is applied.
- `/eforge:build` continues to use the same landing gate behavior it has today, but via the shared helper.
- The daemon playbook-run route validates `onSuccess` and passes it to `enqueuePrd(...)` without interactive behavior.
- Pi extension tool schema, Claude MCP proxy schema, client route types/helpers, and playbook skills/docs are updated in sync.
- Tests cover shared landing helper logic and playbook-run `onSuccess` propagation to enqueue/queue metadata.
