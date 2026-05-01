---
id: plan-01-doc-author-syncer-split
name: Split doc-updater into doc-author and doc-syncer
branch: split-doc-updater-into-doc-author-doc-syncer/main
agents:
  builder:
    effort: high
    rationale: "Coordinated refactor across ~30 files: type-union changes in
      events.ts/config.ts/schemas.ts that ripple into pipeline/agent-config.ts,
      build-stages.ts, two new agent runners, two new prompts, three
      planner-coaching prompts, CLI/monitor-UI consumers, plugin/skill docs,
      plus rename+expand of the wiring test. Type-check spans the full monorepo,
      so all consumers must land together. High effort gives the builder room to
      author two new prompts and methodically update every typed consumer in one
      pass."
  reviewer:
    effort: high
    rationale: The change touches the AgentRole union and the EforgeEvent union —
      both are exhaustively switched on in display.ts and reducer.ts. A
      high-effort review is needed to catch any missed switch arm, stale
      doc-update reference, or drift between the two new agents (parsing-tag
      mismatch, predecessor-rule violation, missing stage-level commit).
---

# Split doc-updater into doc-author and doc-syncer

## Architecture Context

Today's `doc-updater` agent conflates two jobs. Its prompt is plan-driven (read the plan, edit existing docs that reference what the plan changes), but the same prompt forbids creating new files — so when a plan promises a new doc (e.g. `docs/config.md`), the agent cannot deliver it. Worse, when the `doc-update` stage runs sequentially, its edits are left unstaged and either get blended into a later stage's diff or silently lost. Today's saving grace is a `chore(...): post-parallel-group auto-commit` step in `packages/engine/src/pipeline/runners.ts:212-222` that only fires when `doc-update` is in a parallel group.

This plan replaces `doc-updater` with two purpose-built agents — both fully replacing it, with no backward-compat alias — and gives each its own build stage that owns its commit:

- **`doc-author`** — plan-driven authoring. Reads the plan as the spec, can create new doc files the plan names, runs in parallel with `implement` (no `predecessors`). Stage commits with `docs(<planId>): author documentation`.
- **`doc-syncer`** — diff-driven sync. Reads the diff between `ctx.preImplementCommit` and `HEAD`, finds existing docs that drifted (renamed APIs, moved files, changed flag names), edits them. Runs sequentially after `implement` (`predecessors: ['implement']`). Edits-only, cannot create new files. Stage commits with `docs(<planId>): sync documentation with implementation`.

Both stages mirror the sharded-implement coordinator pattern at `packages/engine/src/pipeline/stages/build-stages.ts:504-505`: agent prompt keeps the "No git commands" rule, stage calls `forgeCommit()` gated on `hasUnstagedChanges()`, commit message wrapped in `composeCommitMessage(msg, ctx.modelTracker)` so the `Models-Used:` trailer flows through. Stage spans/trackers follow the existing `doc-update` registration shape at `build-stages.ts:589-623`.

## Implementation

### Overview

The refactor flows from the type system outward:

1. Author the two new agent runners + prompts.
2. Update the engine's role registry (`AgentRole` union, event union, `AGENT_ROLES`, `AGENT_ROLE_TIERS`, `AGENT_ROLE_DEFAULTS`, `planAgentsSchema`).
3. Replace the `doc-update` build stage registration with two new ones.
4. Touch up `runners.ts:212` comment.
5. Update planner / module-planner / pipeline-composer coaching prompts so future planners pick the right two-agent split.
6. Update CLI display, monitor-UI reducer, monitor-UI thread-pipeline component, and graph-status colors.
7. Update consumer-facing skill docs (`eforge-plugin/skills/config/config.md`, `packages/pi-eforge/skills/eforge-config/SKILL.md`) and bump `eforge-plugin/.claude-plugin/plugin.json` version.
8. Update internal docs (`docs/architecture.md`, `docs/config.md`) so they no longer reference the removed `doc-updater` / `doc-update` names.
9. Rename `test/doc-updater-wiring.test.ts` to `test/doc-agents-wiring.test.ts` and expand to cover both agents (plus stage-level commit behavior). Update the half-dozen other tests that still mention `doc-updater` / `doc-update`.
10. Delete the old `packages/engine/src/agents/doc-updater.ts` and `packages/engine/src/prompts/doc-updater.md`.

Because the `AgentRole` union (`packages/engine/src/events.ts:11`) is consumed by every monitor-UI/CLI exhaustive switch and every test that types itself with `AgentRole`, the change is not separable across plans — `pnpm type-check` spans the full monorepo, so all consumers must land in one commit.

### Key Decisions

1. **Two agents, no alias.** Per the PRD, `doc-updater` is removed wholesale. No backward-compat shim — the type union loses the literal, the agent file is deleted, the prompt is deleted, the stage is deregistered.
2. **Both new agents are in the `implementation` tier** (not `planning` like the old `doc-updater`). They write files; the existing skill-docs description for the implementation tier already covers "file-writing agents". Each gets `{ maxTurns: 20 }` in `AGENT_ROLE_DEFAULTS`.
3. **Stage commits, not agent commits.** Both prompts keep the "No git commands" rule. The stage calls `forgeCommit()` after the agent finishes, gated on `hasUnstagedChanges()` and wrapped in `composeCommitMessage()` so the `Models-Used:` trailer is appended. This matches the sharded-implement coordinator pattern.
4. **`doc-syncer` consumes `ctx.preImplementCommit`.** It is already populated at `build-stages.ts:385-389` by the implement stage and threaded through `BuildStageContext` (`packages/engine/src/pipeline/types.ts:66`). The `doc-sync` stage reads it, runs `git diff <preImplementCommit>..HEAD --stat` and the full diff, and passes both into the prompt template as `{diff_summary, diff}` alongside `{plan_id, plan_content}`.
5. **`doc-author` runs parallel with `implement`** (no `predecessors`), so the planner can compose `[[implement, doc-author], doc-sync, review-cycle]`. `doc-syncer` runs sequentially after `implement` (`predecessors: ['implement']`) because it needs the post-implement diff. This matches the `pipeline-composer.md:47` parallel-group rule.
6. **Keep the `runners.ts:212` post-parallel-group auto-commit** as a defense-in-depth safety net for any future parallel stage that forgets to commit. Update only the comment to drop the `doc-update` example.
7. **Summary tags differ per agent** so events stay unambiguous: `<doc-author-summary count="N" created="..." updated="...">` (count = total files touched) and `<doc-sync-summary count="N">`.
8. **Internal engine docs (`docs/architecture.md`, `docs/config.md`) are in scope**, even though the PRD did not enumerate them. They reference `doc-updater` / `doc-update` by name; leaving them stale would defeat the "no backward-compat" intent and create new drift the next doc-syncer run would have to clean up.

## Scope

### In Scope

- New agents: `doc-author` (plan-driven, can create files) and `doc-syncer` (diff-driven, edits only).
- New build stages: `doc-author` (no predecessors, commits `docs(<planId>): author documentation`) and `doc-sync` (predecessors: [implement], commits `docs(<planId>): sync documentation with implementation`).
- Removal of the old `doc-updater` agent, prompt, and `doc-update` stage registration.
- Updates to every consumer of the `AgentRole` union, the `EforgeEvent` doc-update event variants, and the `planAgentsSchema` agent tuning entry.
- Coaching updates in `planner.md`, `module-planner.md`, `pipeline-composer.md` so future planners compose with the new two-agent split.
- Monitor-UI labels: `AGENT_COLORS`, `AGENT_TO_STAGE`, `PipelineStage`, reducer event handling, `graph-status` style entry.
- Skill docs: plugin and pi-eforge config skill docs.
- Plugin version bump (per AGENTS.md).
- Internal engine docs sync (`docs/architecture.md`, `docs/config.md`).
- Test renames and updates: rename `test/doc-updater-wiring.test.ts` → `test/doc-agents-wiring.test.ts`, expand to cover both agents and stage-level commit behavior, update the other test files that mention `doc-updater` / `doc-update` so the suite passes after the rename.

### Out of Scope

- Backward-compat alias for `doc-updater`. Per PRD, both new agents fully replace it.
- Bumping `packages/pi-eforge/package.json` version (release flow owns it; per AGENTS.md).
- CHANGELOG edits (release flow owns it; per the user's `feedback_changelog_managed_by_release` memory).
- New tests for hypothetical edge cases beyond the wiring + stage-commit behavior the acceptance criteria require.

## Files

### Create

- `packages/engine/src/agents/doc-author.ts` — `runDocAuthor(options)` async generator. Mirrors `doc-updater.ts` shape: loads `doc-author` prompt with `{plan_id, plan_content}`, runs harness with `tools: 'coding'`, default `maxTurns: 20`, parses `<doc-author-summary count="N" created="..." updated="...">` from accumulated text, yields `plan:build:doc-author:start` and `plan:build:doc-author:complete` (with `docsAuthored: number`). Non-fatal error handling identical to `doc-updater.ts:68-72`. Re-throws `AbortError`.
- `packages/engine/src/agents/doc-syncer.ts` — `runDocSyncer(options)` async generator. `DocSyncerOptions` extends `SdkPassthroughConfig` with `harness, cwd, planId, planContent, verbose?, abortController?, maxTurns?, preImplementCommit: string`. The runner itself does NOT run git — the stage caller pre-computes `diff_summary` (via `git diff <preImplementCommit>..HEAD --stat`) and `diff` (full diff) and passes them in. Wait — pull diff capture into the runner so the agent contract stays self-contained: in the runner, run `execFile('git', ['diff', '--stat', `${preImplementCommit}..HEAD`], { cwd })` and `execFile('git', ['diff', `${preImplementCommit}..HEAD`], { cwd })` before invoking the agent. Loads `doc-syncer` prompt with `{plan_id, plan_content, diff_summary, diff}`. Parses `<doc-sync-summary count="N">`. Events: `plan:build:doc-sync:start` and `plan:build:doc-sync:complete` (with `docsSynced: number`). Same non-fatal error handling and AbortError re-throw as the other doc agents.
- `packages/engine/src/prompts/doc-author.md` — Job: "Read the plan below as the source of truth for what documentation needs to exist. If the plan names new documentation files in scope, create them. If the plan describes existing docs that need updates, update them." Inputs: `{{plan_id}}`, `{{plan_content}}`. Constraints: no git commands; no changelogs; no generated docs; preserve style for existing files; create new files only when the plan explicitly names them. Output: `<doc-author-summary count="N" created="path/a, path/b" updated="path/c">Brief description.</doc-author-summary>` where `count` is total files touched (created + updated). When nothing was needed, emit `count="0"`.
- `packages/engine/src/prompts/doc-syncer.md` — Job: "Find existing documentation that references symbols, paths, APIs, or configuration changed in the diff below, and update those docs to match the new state." Inputs: `{{plan_id}}`, `{{plan_content}}` (intent context only — not the source of truth), `{{diff_summary}}` (`--stat` output), `{{diff}}` (full diff — the source of truth for what actually changed). Constraints: no git commands; no changelogs; no generated docs; edits-only (no file creation); only touch docs that reference something in the diff; preserve style. Output: `<doc-sync-summary count="N">Brief description.</doc-sync-summary>`.
- `test/doc-agents-wiring.test.ts` — Replaces `test/doc-updater-wiring.test.ts`. Two `describe` blocks, one per agent. Mirrors the existing test patterns (StubHarness, `collectEvents`, `findEvent`). Cases per agent: (a) emits start then complete in order; (b) prompt composition includes the templated inputs (plan_id and plan_content for both; additionally diff_summary and diff for doc-syncer); (c) backend options include `tools: 'coding'` and `maxTurns: 20`; (d) parses count from XML summary (`docsAuthored` / `docsSynced`); (e) `count="0"` parses as 0; (f) missing summary defaults to 0; (g) verbose gating via `isAlwaysYieldedAgentEvent`; (h) verbose mode yields `agent:message`; (i) non-abort errors swallowed, complete still yielded; (j) `AbortError` re-thrown. Plus a stage-level group: a tiny test that exercises the new `doc-author` and `doc-sync` stage registrations end-to-end via the stage registry + a temp-dir git fixture, asserting `forgeCommit` runs when files are touched and is skipped (no commit) when the agent reports `count="0"` and no working-tree changes exist. The stage test follows the `test/agent-wiring.test.ts` real-fixture pattern (no mocks).

### Modify

- `packages/engine/src/events.ts` — (a) Line 11: replace `'doc-updater'` in the `AgentRole` union with `'doc-author' | 'doc-syncer'`. (b) Lines 210-211: replace the two `plan:build:doc-update:*` event variants with four new variants: `'plan:build:doc-author:start' { planId }`, `'plan:build:doc-author:complete' { planId; docsAuthored: number }`, `'plan:build:doc-sync:start' { planId }`, `'plan:build:doc-sync:complete' { planId; docsSynced: number }`.
- `packages/engine/src/config.ts` — Line 40: in the `AGENT_ROLES` const tuple, replace `'doc-updater'` with `'doc-author', 'doc-syncer'`.
- `packages/engine/src/schemas.ts` — Line 259: in `planAgentsSchema`, replace `'doc-updater': agentTuningSchema.optional()` with two entries: `'doc-author': agentTuningSchema.optional()` and `'doc-syncer': agentTuningSchema.optional()`.
- `packages/engine/src/pipeline/agent-config.ts` — (a) Line 35: in `AGENT_ROLE_TIERS`, remove `'doc-updater': 'planning'` and add `'doc-author': 'implementation'` and `'doc-syncer': 'implementation'` (both file-writing agents belong to the implementation tier per the PRD). (b) Line 65: in `AGENT_ROLE_DEFAULTS`, replace `'doc-updater': { maxTurns: 20 }` with `'doc-author': { maxTurns: 20 }` and `'doc-syncer': { maxTurns: 20 }`.
- `packages/engine/src/pipeline/stages/build-stages.ts` — (a) Line 22: replace `import { runDocUpdater } from '../../agents/doc-updater.js';` with imports of `runDocAuthor` and `runDocSyncer` from the two new agent files. (b) Lines 589-623: remove the `doc-update` stage registration entirely. Add two new stage registrations: `doc-author` (no `predecessors`, parallelizable, costHint medium, description "Author plan-specified documentation in parallel with implementation.", whenToUse "When the plan names new documentation files to create, or describes specific docs to update.") and `doc-sync` (`predecessors: ['implement']`, parallelizable false, costHint medium, description "Sync existing documentation against the post-implement diff.", whenToUse "After implementation when changed symbols/paths/APIs/flags may have stale references in existing docs."). Each stage body wraps the matching runner in a `tracing.createSpan` + `createToolTracker` + `withPeriodicFileCheck` block exactly like the removed `doc-update` stage. After the runner completes, gate on `hasUnstagedChanges(ctx.worktreePath)` and call `forgeCommit(ctx.worktreePath, composeCommitMessage(<message>, ctx.modelTracker))` with the appropriate message (`docs(<planId>): author documentation` or `docs(<planId>): sync documentation with implementation`). Both stages call `emitFilesChanged(ctx)` at the end. The `doc-sync` stage reads `ctx.preImplementCommit` and passes it into `runDocSyncer({ ..., preImplementCommit })` — if `preImplementCommit` is missing, skip the agent entirely (no diff to sync against) and yield only the lifecycle pair so the pipeline still emits the events.
- `packages/engine/src/pipeline/runners.ts` — Line 212: update the comment to drop the `doc-update` example. New text: `// After parallel group, commit any uncommitted changes left by stages that didn't self-commit (defense-in-depth)`. Logic itself unchanged — keep the auto-commit as the safety net.
- `packages/engine/src/agents/common.ts` — Line 363: in the `<build-config>` doc-comment example, change `[["implement", "doc-update"], "review-cycle"]` to `[["implement", "doc-author"], "doc-sync", "review-cycle"]`.
- `packages/engine/src/prompts/planner.md` — (a) Line 344: in the available-roles list, replace `doc-updater` with `doc-author` and `doc-syncer` (with one-line descriptions: "`doc-author` - authors plan-specified docs (parallel with implement)" and "`doc-syncer` - syncs existing docs against the post-implement diff (after implement)"). (b) Line 410: change the orchestration.yaml example pipeline `[implement, doc-update]` to `[[implement, doc-author], doc-sync]`. (c) Line 441: in the available-stages list, drop `doc-update` and add `doc-author`, `doc-sync`. (d) Lines 455-459: rewrite the "Doc-update stage guidance" section as "Doc stage guidance" with the three-pipeline coaching from the PRD: `[[implement, doc-author], doc-sync, review-cycle]` for plans that author new docs and need post-implement sync; `[implement, doc-sync, review-cycle]` for plans that only sync existing docs; `[[implement, doc-author], review-cycle]` for plans that only author new docs. Coaching: "Use `doc-author` (parallel with `implement`) when the plan specifies new documentation files. Use `doc-sync` (after `implement`) when the implementation will change symbols/paths/APIs/flags that existing docs reference. Most user-facing changes need both."
- `packages/engine/src/prompts/module-planner.md` — (a) Line 143: change the `<build-config>` example `[["implement", "doc-update"], "review-cycle"]` to `[["implement", "doc-author"], "doc-sync", "review-cycle"]`. (b) Line 163: update the prose example listing `doc-update` to use `doc-author` (parallel with implement) and `doc-sync` (after implement). (c) Lines 165-168: rewrite the doc-update guidance bullets to mirror the planner.md coaching above (when to use which agent, default to including both for user-facing changes).
- `packages/engine/src/prompts/pipeline-composer.md` — (a) Line 45: update the example `[["implement", "doc-update"], "review-cycle"]` to `[["implement", "doc-author"], "doc-sync", "review-cycle"]` and update the parenthetical to reference `doc-author` (the parallel-with-implement agent). (b) Line 47: update the parallel-group-rule example. The new `doc-sync` stage *does* declare `implement` as a predecessor, so an explicit invalid example becomes `[["implement", "doc-sync"]]` (`doc-sync` declares `implement` as predecessor, cannot share its parallel group). The valid example becomes `[["implement", "doc-author"], "doc-sync"]` (`implement` first parallel with `doc-author` because doc-author has no predecessors, then `doc-sync` sequentially). (c) Line 56: update the excursion guidance to mention `doc-author` / `doc-sync` instead of `doc-update`. (d) Line 59: update the user-facing-change guidance to recommend both new stages.
- `packages/eforge/src/cli/display.ts` — Lines 406-418: replace the two `plan:build:doc-update:*` switch arms with four new arms. `plan:build:doc-author:start` sets spinner text `— authoring docs...`. `plan:build:doc-author:complete` updates the spinner to `— ${event.docsAuthored} doc(s) authored` when `docsAuthored > 0`. `plan:build:doc-sync:start` → `— syncing docs...`. `plan:build:doc-sync:complete` → `— ${event.docsSynced} doc(s) synced` when `docsSynced > 0`. The exhaustive-switch `never` default at line 854 will catch any missed event variant at type-check time.
- `packages/monitor-ui/src/lib/types.ts` — Line 23: in the `PipelineStage` type alias, replace `'doc-update'` with `'doc-author' | 'doc-sync'`.
- `packages/monitor-ui/src/lib/reducer.ts` — Lines 202-205: replace the two `plan:build:doc-update:*` cases with four cases (start/complete for each new agent). Same comment intent: doc-author runs in parallel with implement, doc-sync runs after — neither should advance the visible stage status when implement is still in flight, but `doc-sync` should set `state.planStatuses[planId] = 'doc-sync'` on its `start` event since it runs sequentially after implement (otherwise the UI shows a gap). Use the same pattern as the existing test/review status transitions.
- `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` — (a) Line 28: in `AGENT_COLORS`, replace the `doc-updater` entry with `doc-author` and `doc-syncer` entries (use `bg-cyan/30 border-cyan/50` for both to preserve the existing color treatment). (b) Line 106: in `AGENT_TO_STAGE`, replace `'doc-updater': 'doc-update'` with `'doc-author': 'doc-author'` and `'doc-syncer': 'doc-sync'`. Also surface the agent's runtime decisions in the stage-pill hover (per the user's `feedback_surface_runtime_decisions_in_monitor` memory): the new stages should render their counts (`docsAuthored` / `docsSynced`) in the pipeline-stage hover the same way `test:complete`'s `passed` count is rendered.
- `packages/monitor-ui/src/components/graph/graph-status.ts` — Lines 80-86: replace the `doc-update` entry in `STATUS_STYLES` with two entries: `doc-author` and `doc-sync`. Reuse the existing purple color for both.
- `eforge-plugin/skills/config/config.md` — Lines 57 and 59: in the implementation-tier role list, replace `doc-updater` with `doc-author` and `doc-syncer`. Same change in both bullet items (tier tuning bullet and per-role overrides bullet).
- `packages/pi-eforge/skills/eforge-config/SKILL.md` — Lines 59 and 61: identical changes to the plugin skill above. Per AGENTS.md, the two skills must stay in sync.
- `eforge-plugin/.claude-plugin/plugin.json` — Bump `version` from `0.20.1` to `0.21.0` (per AGENTS.md: always bump the plugin version when changing anything in the plugin). The skill change is user-visible in the role lists, so a minor bump is appropriate. Do NOT touch `packages/pi-eforge/package.json` version (release flow owns it).
- `docs/architecture.md` — (a) Line 114: update the build-phase mermaid diagram label from `+ optional: doc-update, test-cycle, validate` to `+ optional: doc-author, doc-sync, test-cycle, validate`. (b) Line 139: replace the `doc-update` row in the build-stages table with two rows: `doc-author` ("Authors plan-specified documentation in parallel with implement") and `doc-sync` ("Syncs existing documentation against the post-implement diff"). (c) Line 144: update the parallel-group example from `[['implement', 'doc-update'], 'review-cycle']` to `[['implement', 'doc-author'], 'doc-sync', 'review-cycle']`. (d) Line 171: in the agent-roles-by-function table's Building row, replace `doc-updater` with `doc-author, doc-syncer`.
- `docs/config.md` — (a) Line 62: update the comment listing implementation-tier roles so `doc-updater` is replaced with `doc-author, doc-syncer`. (b) Line 233: update the role table — replace the `doc-updater` row with `doc-author` (tier `implementation`, description "Plan-driven doc authoring") and `doc-syncer` (tier `implementation`, description "Diff-driven doc sync").
- `test/agent-wiring.test.ts` — (a) Line 906: change `['implement', 'doc-update', 'review-cycle']` to `['implement', 'doc-author', 'doc-sync', 'review-cycle']`. (b) Lines 1158-1177 effort-table: remove the `doc-updater` row from the planning tier; add `doc-author` and `doc-syncer` rows to the implementation tier (`expectedEffort: 'medium'`). Add an explicit comment near the table reminding readers that both new doc agents are in the implementation tier (matches the AGENT_ROLE_TIERS change).
- `test/agent-config.tier-resolution.test.ts` — (a) Line 28 ALL_ROLES tuple: replace `'doc-updater'` with `'doc-author', 'doc-syncer'`. (b) Lines 199-200: replace the `'doc-updater is in planning tier'` test with two tests: `'doc-author is in implementation tier'` and `'doc-syncer is in implementation tier'`, asserting `AGENT_ROLE_TIERS['doc-author']` and `AGENT_ROLE_TIERS['doc-syncer']` both equal `'implementation'`.
- `test/retry.test.ts` — Line 210: replace `'doc-updater'` in the role list with `'doc-author', 'doc-syncer'`.
- `test/pipeline.test.ts` — Line 171: replace `'doc-update'` in `builtinBuildStages` with `'doc-author', 'doc-sync'`.
- `test/lane-awareness.test.ts` — Lines 12-25: update the three test cases that use `'doc-update'`. The first case (`['review', 'doc-update']`) becomes `['review', 'doc-author']` (still no implement → still empty notice). The second case (`['implement', 'doc-update']`) becomes `['implement', 'doc-author']` and the assertion expecting `\`doc-update\`` in the output becomes `\`doc-author\``. The third case (`['implement', 'doc-update', 'lint']`) gets the same treatment.
- `test/per-plan-build-config.test.ts` — Lines 37, 54, 165, 178: replace `[['implement', 'doc-update'], 'review-cycle']` with `[['implement', 'doc-author'], 'doc-sync', 'review-cycle']` in all four locations (test fixtures and assertions paired).
- `test/sharded-build-via-review-cycle.test.ts` — Lines 184-185: replace `['implement', ['doc-update', 'review-cycle']]` with `['implement', ['doc-author', 'review-cycle']]` (`doc-author` has no predecessors so it can share a parallel group with `review-cycle`; `doc-sync` cannot, so it stays out of this fixture).
- `test/orchestration-logic.test.ts` — Lines 811, 823: replace `['implement', ['review', 'doc-update']]` with `['implement', ['review', 'doc-author']]` (test fixture and assertion paired). Note: the original used `doc-update` as a no-predecessor parallel filler — `doc-author` has the same parallel-eligibility shape, so the test stays valid.
- `test/planner-submission.test.ts` — Lines 351, 387: same swap as orchestration-logic.test.ts — `['implement', ['review', 'doc-update']]` becomes `['implement', ['review', 'doc-author']]` in both the fixture and the assertion.

### Delete

- `packages/engine/src/agents/doc-updater.ts` — Removed wholesale; replaced by `doc-author.ts` and `doc-syncer.ts`.
- `packages/engine/src/prompts/doc-updater.md` — Removed wholesale; replaced by `doc-author.md` and `doc-syncer.md`.
- `test/doc-updater-wiring.test.ts` — Renamed to `test/doc-agents-wiring.test.ts` (delete the old file as part of the rename, after the new file is in place).

## Verification

- [ ] `pnpm type-check` exits 0. The exhaustive switches over `EforgeEvent` in `packages/eforge/src/cli/display.ts` (the `never` default at line 853) and the `AgentRole`-keyed `AGENT_COLORS` / `AGENT_TO_STAGE` records in `packages/monitor-ui/src/components/pipeline/thread-pipeline.tsx` compile with the new four event variants and the two new role literals.
- [ ] `pnpm test` exits 0. `test/doc-agents-wiring.test.ts` covers both `runDocAuthor` and `runDocSyncer`: lifecycle order, prompt template inputs (including `diff_summary` and `diff` for doc-syncer), `tools: 'coding'` + `maxTurns: 20`, count parsing for both summary tags, count=0 / missing-summary defaults, verbose gating, AbortError re-throw. The stage-level group asserts that the `doc-author` and `doc-sync` stage registrations call `forgeCommit` exactly once when files are touched and skip the commit when the agent reports `count="0"` and the working tree is clean.
- [ ] No file in the worktree contains the strings `doc-updater` or `doc-update` after merge, except where they appear as historical references inside this plan file or its companion sidecars. (`grep -r 'doc-updater\|doc-update' .` returns only this plan file.)
- [ ] `packages/engine/src/agents/doc-updater.ts` and `packages/engine/src/prompts/doc-updater.md` are absent from the worktree. `test/doc-updater-wiring.test.ts` is absent and `test/doc-agents-wiring.test.ts` is present.
- [ ] `eforge-plugin/.claude-plugin/plugin.json` `version` field is `0.21.0`. `packages/pi-eforge/package.json` `version` field is unchanged from its pre-plan value.
- [ ] The `AgentRole` union in `packages/engine/src/events.ts` contains `'doc-author'` and `'doc-syncer'` and does NOT contain `'doc-updater'`. The `AGENT_ROLES` tuple in `packages/engine/src/config.ts` matches.
- [ ] The `AGENT_ROLE_TIERS` map in `packages/engine/src/pipeline/agent-config.ts` has `'doc-author': 'implementation'` and `'doc-syncer': 'implementation'`. The `AGENT_ROLE_DEFAULTS` map has `{ maxTurns: 20 }` for both.
- [ ] The build-stage registry exposes stages named `doc-author` (no `predecessors`) and `doc-sync` (`predecessors: ['implement']`); querying the registry for `doc-update` returns undefined.
- [ ] `packages/engine/src/pipeline/runners.ts:212` comment no longer mentions `doc-update`; the post-parallel-group auto-commit logic itself is preserved.
