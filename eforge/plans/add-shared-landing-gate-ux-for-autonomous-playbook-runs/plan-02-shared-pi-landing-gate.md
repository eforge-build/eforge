---
id: plan-02-shared-pi-landing-gate
name: Shared Pi Landing Gate UX for Build and Playbook Run
branch: add-shared-landing-gate-ux-for-autonomous-playbook-runs/plan-02-shared-pi-landing-gate
---

# Shared Pi Landing Gate UX for Build and Playbook Run

## Architecture Context

The Pi extension currently keeps trunk landing remediation inside `packages/pi-eforge/extensions/eforge/index.ts` for the `eforge_build` tool, while the native `/eforge:playbook run` command enqueues autonomous playbooks without a landing decision. This plan extracts reusable Pi landing-gate behavior and applies it to both flows. The daemon remains headless and the engine remains the final trunk-safety backstop.

## Implementation

### Overview

Create a shared Pi landing-gate helper that supports two modes: the existing build mode, which prompts only when `merge-to-base-branch` would land directly on trunk without opt-in, and an explicit playbook mode, which asks the user to choose `issue-pr`, `merge-to-base-branch`, or `leave-branch` before enqueueing an autonomous playbook. The playbook choice is included in every `apiPlaybookRunIfRunning` call, including the fallback path when a selected upstream queue item has already finished.

### Key Decisions

1. Extract UI/config/branch logic from `index.ts` into `landing-gate.ts`, while keeping pure decision helpers in `trunk-landing.ts` or moving them only if imports stay acyclic.
2. Preserve the exact build remediation choices: use `issue-pr` for this run, update `eforge/config.yaml` with `build.allowLocalMergeToTrunk: true`, or cancel.
3. In explicit playbook mode, persist a returned action for all non-cancel outcomes. If the user selects `merge-to-base-branch` on unsafe trunk and then chooses the config-update remediation, return `onSuccess: "merge-to-base-branch"` plus `configUpdated: true` so the queued PRD records the explicit choice.
4. Keep planning-mode playbooks on the existing skill-delegation path before any landing or active-build dependency prompts.
5. Update Pi and Claude playbook skills together and bump the Claude plugin version because plugin files change.

## Scope

### In Scope

- Shared Pi landing-gate helper with build and explicit-playbook modes.
- `eforge_build` refactor to use the helper while preserving existing responses.
- Native `/eforge:playbook run` autonomous flow that prompts for a landing action before enqueue.
- Trunk-safety remediation when explicit playbook selection is `merge-to-base-branch` on protected trunk.
- Skill documentation updates for Pi and Claude plugin parity.
- Tests for helper decisions and native playbook command propagation.

### Out of Scope

- Daemon-side prompts.
- Engine landing behavior changes.
- Planning-mode playbook investigation changes beyond documentation wording.
- Pi package version changes.

## Files

### Create

- `packages/pi-eforge/extensions/eforge/landing-gate.ts` — shared landing-gate helper used by `eforge_build` and native playbook run.

### Modify

- `packages/pi-eforge/extensions/eforge/trunk-landing.ts` — keep or extend pure landing-policy functions used by the helper; add explicit-choice decision helpers if that keeps tests independent from Pi UI.
- `packages/pi-eforge/extensions/eforge/index.ts` — replace the inline `promptForTrunkLandingIfNeeded` implementation with the shared helper and keep `eforge_build` response shape (`cancelled`, `configUpdated`, selected `onSuccess`).
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — after confirming the selected playbook is autonomous, call the shared helper in explicit mode, cancel on user cancellation, pass `onSuccess` to `apiPlaybookRunIfRunning`, and reuse the same `onSuccess` on the immediate-enqueue fallback after stale `afterQueueId`.
- `test/pi-trunk-landing-policy.test.ts` — add pure helper coverage for explicit playbook choices and unsafe-trunk remediation decisions.
- `test/pi-playbook-commands.test.ts` — add native-command tests proving autonomous playbooks prompt for landing, pass selected `onSuccess`, cancel before enqueue when the landing prompt is cancelled, and continue to skip landing prompts for planning-mode playbooks.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — document that autonomous runs require choosing `issue-pr`, `merge-to-base-branch`, or `leave-branch`, and include `onSuccess` in `eforge_playbook { action: "run" }` examples.
- `eforge-plugin/skills/playbook/playbook.md` — mirror the playbook skill updates with MCP tool syntax.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the plugin version.

## Verification

- [ ] Native `/eforge:playbook run <autonomous>` in Pi shows a landing-action selection before any enqueue request.
- [ ] Selecting `leave-branch` causes `apiPlaybookRunIfRunning` to receive `{ name: "...", onSuccess: "leave-branch" }`.
- [ ] Selecting `merge-to-base-branch` on trunk with `allowLocalMergeToTrunk: false` opens the same remediation choices used by `eforge_build`.
- [ ] Choosing the config-update remediation writes `build.allowLocalMergeToTrunk: true`, reloads the extension best-effort, and enqueues with `onSuccess: "merge-to-base-branch"`.
- [ ] Choosing cancel in either landing prompt makes zero `apiPlaybookRunIfRunning` calls.
- [ ] Planning-mode playbooks still delegate to `/skill:eforge-playbook run <name>` before queue or landing prompts.
- [ ] Pi and Claude playbook skill files pass `node scripts/check-skill-parity.mjs`.
- [ ] `pnpm type-check` completes with zero TypeScript errors.
- [ ] `pnpm test -- pi-trunk-landing-policy pi-playbook-commands` completes with zero failing tests.
