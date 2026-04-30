---
id: plan-05-piggyback-and-queue-scheduling
name: "Phase 2: piggyback scheduling and queue-list nesting"
branch: eforge-playbooks/piggyback
---

# Phase 2: piggyback scheduling and queue-list nesting

## Architecture Context

PRD `dependsOn` is already parsed and used at plan-orchestration time (`packages/engine/src/prd-queue.ts:190` filters declared deps; `resolveDependencyGraph` orders waves). What does NOT yet exist is queue-level firing: the daemon does not currently watch for an upstream PRD's transition to `completed` and then unblock its `dependsOn` dependents to run.

This plan is the entire Phase 2 deliverable from the PRD: implement upstream-completion-driven scheduling, with skip-on-failure / skip-on-cancel, plus the indented `eforge queue list` UX. Plans 02-04 already persist `dependsOn` correctly; this plan turns that data into observable behavior.

## Implementation

### Overview

1. **Queue dispatcher: piggyback firing** — extend the queue dispatcher in `packages/monitor/src/server.ts` (or its supporting module in `packages/engine/src/prd-queue.ts`, depending on where the dispatch loop lives) so that when a queue entry's status transitions to `completed`, any queued PRDs whose `dependsOn` array references that entry's id become eligible for execution. Implementation:
   - Add a `dependsOn` waiting set: queued PRDs with non-empty unsatisfied `dependsOn` are held in a `waiting` state and not dispatched.
   - On any entry's terminal transition (`completed`, `failed`, `cancelled`), re-evaluate dependents:
     - Upstream `completed` ⇒ remove that id from each dependent's unsatisfied set; once empty, transition the dependent to `pending` so the normal dispatcher picks it up.
     - Upstream `failed` or `cancelled` ⇒ transition each dependent directly to `skipped` with reason `upstream <id> <state>`. The PRD specifies skip on both failure and cancellation; this is the v1 behavior with no override flag.
   - Persistence: the `waiting` and `skipped` states are visible in `eforge queue list` and the monitor UI.
2. **Auto-enqueue, no review gate** — piggybacked playbooks fire their generated plan directly into the build pipeline without an interactive review gate. The PRD justifies this: the user already approved the playbook contents at authoring time; re-asking on every fire defeats the fire-and-forget promise. The dispatcher path for piggyback-triggered PRDs explicitly bypasses any interactive approval prompt.
3. **Indented queue display** — modify `renderQueueList` in `packages/eforge/src/cli/display.ts` so PRDs with non-empty `dependsOn` are rendered indented under their parent. Behavior:
   - Group by parent: each entry whose `dependsOn` references another entry in the listing is printed two spaces in, prefixed with `  ↳ `.
   - Multi-parent entries (rare) are rendered under their first listed dependency.
   - Status colors are unchanged from the existing styling.
   - Apply the same nesting in the monitor UI (`packages/monitor-ui/`) — the UI already has a queue listing component; add `dependsOn` to its render data and indent accordingly using the existing shadcn primitives. Do not introduce custom UI primitives (per CLAUDE.md feedback).
4. **Skill: wait-for-build conversational matcher** — refine the Run branch in both `eforge-plugin/skills/playbook/playbook.md` and `packages/pi-eforge/skills/eforge-playbook/SKILL.md` to:
   - Call `eforge_status` (already in the toolset) to enumerate in-flight builds.
   - List them by title, indexed numerically.
   - Resolve the user's selection to a queue id internally and pass it as `afterQueueId` to `apiPlaybookEnqueue`.
   - Handle ambiguity (multiple titles match the user's free-text mention) by asking the user to pick by number.
   - Confirm the `afterQueueId` mapping back to the user using the title before enqueueing.
   - The user never sees or types a queue id at any point in the dialog.
5. **CLI primitive** — `eforge playbook run <name> --after <queue-id>` was already wired in plan-03; verify here that the daemon now treats the resulting `dependsOn` correctly under all upstream terminal states and that the skill's conversational title-resolution path produces the same downstream behavior.
6. **Tests** — `test/queue-piggyback.test.ts` covers:
   - Upstream `completed` ⇒ dependent transitions from `waiting` to `pending` and is dispatched.
   - Upstream `failed` ⇒ dependent transitions to `skipped` with reason; downstream of the skipped entry also becomes `skipped` recursively.
   - Upstream `cancelled` ⇒ dependent transitions to `skipped` with reason.
   - Multi-dependent fan-out: one upstream with three dependents, all transition correctly.
   - Persistence: `waiting` and `skipped` states survive a daemon restart (mirrors existing recovery test patterns in `test/fixtures/recovery/`).
   - `dependsOn` references an upstream that does not exist in the queue ⇒ the dependent is rejected at enqueue time with a clear error (defensive).

### Key Decisions

1. **Skip on failure AND cancellation, no override flag.** Matches PRD v1 explicitly. The override flag is listed in the PRD's out-of-scope section as a deferred follow-on; we honor that boundary strictly.
2. **Auto-enqueue, no per-fire approval prompt.** Per PRD justification: the playbook was approved at authoring time; an approval-on-every-fire prompt is added as `--approve` only if real demand surfaces. Not implemented here.
3. **Recursive skip propagation.** If an upstream is skipped, its dependents must also skip — otherwise a fan-out chain partially runs against a state that diverged from the user's mental model. This is the safe default and consistent with the PRD's "compounding damage" justification.
4. **Title-based selection in the skill, id-based persistence in the daemon.** Conversational UX uses titles; storage uses ids. The mapping happens once, in the skill, when the user picks the parent.
5. **Monitor UI uses shadcn, not custom primitives.** Per CLAUDE.md feedback for the monitor UI.

## Scope

### In Scope
- Queue-level dispatcher firing on upstream `completed`.
- Skip propagation on upstream `failed` / `cancelled`.
- `waiting` and `skipped` states in queue persistence and rendering.
- `eforge queue list` indented rendering for piggyback children.
- Monitor UI nested queue rendering.
- Skill Run branch conversational wait-for-build matcher.
- Tests covering all terminal-transition paths and persistence across restart.

### Out of Scope
- `--approve` per-fire approval flag (deferred follow-on).
- Override of skip-on-failure (deferred).
- Cross-playbook composition / nested piggyback chains beyond a single level (the dispatcher handles it correctly via recursion, but the conversational UX in the skill assumes flat one-level piggyback).
- Cron / post-merge hook scheduling (Phase 3, deferred).
- Parameterization (Phase 4, deferred).

## Files

### Modify
- `packages/monitor/src/server.ts` — add the dependent-firing logic to the queue dispatcher; on terminal transitions, re-evaluate `dependsOn`-blocked PRDs and either unblock-to-pending (on completed) or skip-with-reason (on failed/cancelled).
- `packages/engine/src/prd-queue.ts` — extend queue state types to include `waiting` and `skipped` reasons; add helpers `findDependents(queue, id)` and `propagateSkip(queue, id, reason)` if the dispatch logic lives here rather than in `server.ts`. Keep responsibility split clean: state transitions in engine, dispatch loop in monitor server.
- `packages/eforge/src/cli/display.ts` — extend `renderQueueList` with indented child rendering using `↳ ` prefix and two-space indent.
- `packages/monitor-ui/src/...` — add nested queue rendering using existing shadcn list/tree primitives (locate the existing queue list component; do not add custom primitives).
- `eforge-plugin/skills/playbook/playbook.md` — refine the Run branch's wait-for-build flow with conversational title-to-id resolution.
- `packages/pi-eforge/skills/eforge-playbook/SKILL.md` — same refinements as the Claude Code skill.
- `packages/pi-eforge/extensions/eforge/playbook-commands.ts` — implement the conversational matcher in the Run handler.
- `eforge-plugin/.claude-plugin/plugin.json` — bump plugin version per AGENTS.md rule.

### Create
- `test/queue-piggyback.test.ts` — covers completion-fires, failure-skips, cancellation-skips, recursive skip propagation, multi-dependent fan-out, restart-persistence, and rejection of dependsOn referencing missing upstream id.

## Verification

- [ ] `pnpm type-check` passes after queue state additions.
- [ ] `pnpm test` passes; new tests in `test/queue-piggyback.test.ts` cover all paths.
- [ ] When a piggybacked PRD's upstream transitions to `completed`, the dependent transitions from `waiting` to `pending` within the next dispatcher tick and runs to completion.
- [ ] When the upstream transitions to `failed`, the dependent transitions to `skipped` with reason `upstream <id> failed`.
- [ ] When the upstream transitions to `cancelled`, the dependent transitions to `skipped` with reason `upstream <id> cancelled`.
- [ ] If the dependent itself has further dependents, those also transition to `skipped` with a propagated reason.
- [ ] Piggybacked PRDs auto-enqueue their generated plan into the build pipeline without invoking an interactive review prompt.
- [ ] `eforge queue list` renders piggybacked entries indented under their parent with the `↳ ` prefix.
- [ ] The monitor UI renders the same nesting using shadcn primitives only.
- [ ] The skill's Run branch enumerates in-flight builds by title, resolves the user's selection to a queue id internally, and the user never types or sees a queue id.
- [ ] `eforge playbook run docs-sync --after <queue-id>` and the skill's conversational path produce identical observable daemon state.
- [ ] `waiting` and `skipped` states survive a daemon restart (asserted via the existing recovery test pattern).
