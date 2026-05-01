---
title: Split `doc-updater` into `doc-author` + `doc-syncer`
created: 2026-05-01
---

# Split `doc-updater` into `doc-author` + `doc-syncer`

## Problem / Motivation

The PRD validator on the running build flagged that Plan 02 promised `docs/config.md` and a profile-authoring guide, but no `docs/` files appear in the changed-file list. Investigation showed two underlying problems with today's `doc-updater` agent:

1. **It conflates two jobs.** Its prompt is plan-driven (read the plan, find existing docs that reference what the plan changes, edit them). But the same prompt forbids creating new files — so when a plan promises new docs (like `docs/config.md`), the agent can't deliver them.
2. **Stage doesn't commit.** When `doc-update` runs sequentially, its edits are left unstaged and either get blended into a later stage's diff or silently lost. (Today's saving grace is a `chore(...): post-parallel-group auto-commit` step in `runners.ts:212-222` that only fires when `doc-update` is in a parallel group.)

## Goal

Replace the single `doc-updater` agent with two purpose-built agents — `doc-author` (plan-driven authoring, can create new docs, runs in parallel with `implement`) and `doc-syncer` (implementation-driven sync of existing docs against the post-implement diff, runs sequentially after `implement`) — so plans get full doc coverage and each doc stage owns its own commit.

## Approach

The right shape is **two agents**:

- **`doc-author`** — plan-driven authoring. Reads the plan as the spec, can create new doc files the plan names, runs in parallel with `implement` because it doesn't need code to exist yet.
- **`doc-syncer`** — implementation-driven sync. Reads the diff between the pre-implement HEAD and the current HEAD, finds existing docs that drifted from the new code (renamed APIs, moved files, changed flag names), edits them. Runs sequentially after `implement`. Cannot create new files.

Both are needed for full doc coverage; planners pick which to include based on the plan's content. Both fully replace `doc-updater` — no backward-compat alias.

### 1. Two new agents

**New files:**

- `packages/engine/src/agents/doc-author.ts`
- `packages/engine/src/prompts/doc-author.md`
- `packages/engine/src/agents/doc-syncer.ts`
- `packages/engine/src/prompts/doc-syncer.md`

**`doc-author` runner** (mirrors `doc-updater.ts` but with a new summary tag):

- Takes `{ harness, cwd, planId, planContent }` plus passthrough config.
- Loads `doc-author` prompt with `{plan_id, plan_content}`.
- Parses `<doc-author-summary count="N" created="..." updated="...">` from output (count = total files touched).
- Yields `plan:build:doc-author:start` and `plan:build:doc-author:complete` events with `docsAuthored: number`.
- Stage will call `forgeCommit()` after — agent's prompt keeps the "no git commands" rule so the stage owns commit semantics (matches sharded-implement coordinator pattern at `build-stages.ts:504-505`).

**`doc-author` prompt** key differences from `doc-updater.md`:

- Drops the "Only update existing documentation - do not create new documentation files" constraint.
- Adds explicit instruction: "If the plan names new documentation files in scope, create them. If the plan describes existing docs that need updates, update them."
- Keeps "No git commands" — stage commits.
- Replaces summary tag: `<doc-author-summary count="N">`.

**`doc-syncer` runner** signature:

```ts
interface DocSyncerOptions {
  harness, cwd, planId, planContent, verbose, abortController, maxTurns
  preImplementCommit: string;  // captured in implement stage at build-stages.ts:385-389
}
```

- Captures `git diff <preImplementCommit>..HEAD --stat` and full diff before invoking the agent.
- Loads `doc-syncer` prompt with `{plan_id, plan_content, diff_summary, diff}`.
- Parses `<doc-sync-summary count="N">`.
- Events: `plan:build:doc-sync:start` / `plan:build:doc-sync:complete` with `docsSynced: number`.

**`doc-syncer` prompt** key shape:

- Job: "Find existing documentation that references symbols, paths, APIs, or configuration changed in the diff below, and update those docs to match the new state."
- Inputs: plan body (for context on intent) + diff (source of truth for what actually changed).
- Edits-only, no file creation.
- Same "No git commands" rule.

### 2. Two new build stages, one removed

`packages/engine/src/pipeline/stages/build-stages.ts`:

- **Remove** the `doc-update` stage registration (lines 589-623).
- **Add `doc-author` stage** — wraps `runDocAuthor`, predecessors none (so it can run parallel with `implement`), stage-level `forgeCommit("docs(<planId>): author documentation")` gated on `hasUnstagedChanges()`.
- **Add `doc-sync` stage** — wraps `runDocSyncer`, `predecessors: ['implement']`, must run sequentially. Captures `ctx.preImplementCommit` (already populated at `build-stages.ts:385-389`) and passes it to the agent. Stage commits with `docs(<planId>): sync documentation with implementation`.

Both stages use `composeCommitMessage(msg, ctx.modelTracker)` for the `Models-Used:` trailer and stage spans/trackers exactly like the sharded-implement coordinator.

### 3. Touch-up `runners.ts:212-222` post-parallel-group auto-commit

Now that `doc-author` commits its own output, the post-parallel-group auto-commit catch-all is redundant for the doc case. Two options:

- **Keep it** as a defense-in-depth safety net for any future parallel stage that forgets to commit.
- **Remove the comment reference to doc-update** at line 212 (`// After parallel group, commit any uncommitted changes (e.g., from doc-update)`).

Recommend keeping the auto-commit logic but updating the comment to drop the doc-update example, since the catch-all is genuinely useful and removing it would require auditing every future parallel stage.

### 4. Update agent role registry / config schema

`packages/engine/src/events.ts:11` — `AgentRole` union: replace `'doc-updater'` with `'doc-author' | 'doc-syncer'`.

`packages/engine/src/events.ts:210-211` — replace:
```ts
| { type: 'plan:build:doc-update:start'; planId: string }
| { type: 'plan:build:doc-update:complete'; planId: string; docsUpdated: number }
```
with the four new events (`doc-author:start/complete`, `doc-sync:start/complete`).

`packages/engine/src/schemas.ts:259` — replace `'doc-updater'` entry with `'doc-author'` and `'doc-syncer'` agent tuning entries.

`packages/engine/src/config.ts:40` — replace `'doc-updater'` in the role list with both new roles.

`packages/engine/src/pipeline/agent-config.ts:35,65` — replace `'doc-updater': 'planning'` tier mapping with `'doc-author': 'implementation'` and `'doc-syncer': 'implementation'` (both are file-writing agents, belong to implementation tier, matching the existing skill-docs description). Default `maxTurns` (line 65): `{ maxTurns: 20 }` for both.

### 5. Update planner prompts

These prompts currently coach planners to use `doc-update`. They need to coach for the new two-agent split.

`packages/engine/src/prompts/planner.md` — lines 344, 410, 441, 456-459. Replace:
- Stage list: drop `doc-update`, add `doc-author`, `doc-sync`.
- Examples: `[[implement, doc-author], doc-sync, review-cycle]` for plans that author new docs and need post-implement sync; `[implement, doc-sync, review-cycle]` for plans that only sync existing docs; `[[implement, doc-author], review-cycle]` for plans that only author new docs.
- Coaching: "Use `doc-author` (parallel with `implement`) when the plan specifies new documentation files. Use `doc-sync` (after `implement`) when the implementation will change symbols/paths/APIs/flags that existing docs reference. Most user-facing changes need both."

`packages/engine/src/prompts/module-planner.md` — lines 143, 163, 166, 168. Same updates.

`packages/engine/src/prompts/pipeline-composer.md` — lines 45, 47, 56, 59. Update the example `[["implement", "doc-update"], "review-cycle"]` and the predecessor-rule explanation. The new `doc-sync` stage *does* declare `implement` as a predecessor, so the parallel-group rule example needs updating to reference `doc-author` instead.

### 6. Update consumer code (UI, CLI display, tests)

`packages/eforge/src/cli/display.ts` — replace any `doc-updater`/`docUpdated` rendering with the two new event types.

`packages/monitor-ui/src/lib/reducer.ts` — same.

`packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — pipeline visualization references; both new stages need labels in the timeline.

`test/doc-updater-wiring.test.ts` — rename to `doc-agents-wiring.test.ts`, expand to cover both agents using `StubHarness` (matches `test/agent-wiring.test.ts` pattern). Verify:
- `doc-author` produces `plan:build:doc-author:complete` with the right `docsAuthored` count.
- `doc-author` stage commits via `forgeCommit` when files are touched, no commit when count is 0.
- `doc-syncer` receives the diff in its prompt and produces `doc-sync:complete`.
- `doc-syncer` stage commits behavior same as above.

### 7. Update skill docs (consumer-facing)

Per AGENTS.md "keep eforge-plugin/ and packages/pi-eforge/ in sync":

- `eforge-plugin/skills/config/config.md:57,59` — replace `doc-updater` in the implementation-tier role list with `doc-author` and `doc-syncer`.
- `packages/pi-eforge/skills/eforge-config/SKILL.md:59,61` — same.

Bump `eforge-plugin/.claude-plugin/plugin.json` version (per AGENTS.md). Don't bump `packages/pi-eforge/package.json` version (release flow owns it).

## Scope

### In scope

**Critical files:**

- `packages/engine/src/pipeline/stages/build-stages.ts` — remove doc-update stage, add doc-author + doc-sync
- `packages/engine/src/agents/doc-author.ts` (new), `packages/engine/src/agents/doc-syncer.ts` (new)
- `packages/engine/src/prompts/doc-author.md` (new), `packages/engine/src/prompts/doc-syncer.md` (new)
- `packages/engine/src/agents/doc-updater.ts`, `packages/engine/src/prompts/doc-updater.md` — delete after migration
- `packages/engine/src/events.ts` — `AgentRole` + event-type unions
- `packages/engine/src/schemas.ts`, `packages/engine/src/config.ts`, `packages/engine/src/pipeline/agent-config.ts` — role/tier tables
- `packages/engine/src/prompts/planner.md`, `module-planner.md`, `pipeline-composer.md` — coaching
- `packages/eforge/src/cli/display.ts`, `packages/monitor-ui/src/lib/reducer.ts`, `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — UI labels
- `test/doc-updater-wiring.test.ts` — rename + expand
- `eforge-plugin/skills/config/config.md`, `packages/pi-eforge/skills/eforge-config/SKILL.md` — role lists
- `eforge-plugin/.claude-plugin/plugin.json` — version bump

### Out of scope

- **No backward-compat alias** for `doc-updater`. Both new agents fully replace it.
- **Do not bump** `packages/pi-eforge/package.json` version (release flow owns it).

## Acceptance Criteria

1. **Type check + tests**: `pnpm type-check && pnpm test` pass. The renamed `doc-agents-wiring.test.ts` exercises both new agents and stage-level commit behavior, verifying:
   - `doc-author` produces `plan:build:doc-author:complete` with the right `docsAuthored` count.
   - `doc-author` stage commits via `forgeCommit` when files are touched, no commit when count is 0.
   - `doc-syncer` receives the diff in its prompt and produces `doc-sync:complete`.
   - `doc-syncer` stage commits behavior same as above.
2. **Live build**: enqueue a small PRD that names a new doc file (e.g., "add `docs/example.md` describing the foo flag") and changes an internal symbol that an existing doc references. Use a pipeline like `[[implement, doc-author], doc-sync, review-cycle]`. Confirm:
   - `docs/example.md` is created, committed in the `docs(<planId>): author documentation` commit.
   - The existing doc that referenced the renamed symbol is updated, committed in the `docs(<planId>): sync documentation with implementation` commit.
   - `git log` shows both commits with `Models-Used:` and `Co-Authored-By: forged-by-eforge` trailers.
3. **PRD validator**: re-run a build similar to the original failed one (with `docs/config.md` as a deliverable). Confirm the validator no longer flags missing `docs/` files because `doc-author` now creates them.
4. **Monitor UI**: confirm pipeline visualization renders `doc-author` and `doc-sync` stages with their respective counts in the stage hover (per the user's "Surface runtime agent decisions in monitor UI" memory).
5. **Sequential safety**: enqueue a plan with `[implement, doc-sync]` (no parallel group). Confirm `doc-sync`'s edits get committed by the stage itself, not the post-parallel-group auto-commit (which won't fire for sequential stages).
