---
id: plan-02-curation-milestones
name: Backlog Curation Source and Map/Reduce Milestones
branch: add-planning-task-activity-logs/plan-02-curation-milestones
agents:
  builder:
    effort: high
    rationale: Instrumentation crosses deferred source assembly, source-first audit
      phases, and map/reduce orchestration without changing curation outputs.
  tester:
    effort: high
    rationale: Milestone tests must avoid brittle high-frequency item ordering while
      confirming the required phase coverage.
---

# Backlog Curation Source and Map/Reduce Milestones

## Architecture Context

Plan 01 adds the activity log contract and daemon append path. This plan uses those hooks to emit meaningful coarse milestones from the long-running backlog curation paths. The activity messages describe orchestration phases only; they must not include raw source text, packet bodies, model output, prompts, or snippets.

## Implementation

### Overview

Thread optional progress/activity callbacks through the eforge-plan backlog curation source provider and emit source-building phase milestones. Add coarse map/reduce milestones around packet preparation, cache scanning, item auditing, reducer execution, validation, and repair attempts. Existing structured `backlogCurationProgress` remains the item-agent summary, while activity entries become a bounded phase history.

### Key Decisions

1. Use the same daemon `progress` callback for source-provider milestones so source assembly and planner execution produce a single task-scoped activity history.
2. Keep milestones coarse and stable: phase names and aggregate counts are acceptable, while per-file paths, source excerpts, item packet JSON, raw prompts, and model transcripts are excluded.
3. Preserve existing progress message strings that current tests or UI summaries rely on, then add new milestone messages around them rather than replacing stable strings unless a test is updated in the same plan.
4. Map/reduce cache activity records aggregate cache hit and miss counts instead of logging every item id. Item-agent progress remains in `backlogCurationProgress.items`.

## Scope

### In Scope

- Source provider callback threading in `eforge-plan` backlog curation source assembly.
- Milestones for starting source assembly, reading backlog records, scanning git delta, classifying evidence, running source-first audit, preparing map/reduce packets, and finishing source metadata preview writes.
- Map/reduce milestones for packet preparation, cache scan start/result, cache hits/misses, auditing item batches, reducing outcomes, validating the draft, and reducer repair attempts.
- Tests that assert required milestone presence without relying on exact high-frequency item ordering.

### Out of Scope

- Changes to backlog curation apply policy, recommendation freshness policy, validation rules, or item audit prompt behavior.
- Storing raw source, raw prompts, model transcripts, packet bodies, or per-token updates.
- Workstation rendering.

## Files

### Create

- None.

### Modify

- `packages/monitor/src/routes/extensions/backlog-curation-map-reduce-runner.ts` — add coarse `options.progress(...)` milestones for packet preparation, cache scan, hit/miss aggregate results, item auditing, reducer execution, validation, and repair attempts.
- `packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts` — assert the new map/reduce milestone messages, cache hit/miss aggregate messages, and repair-attempt message without exact per-item ordering.
- `eforge/extensions/eforge-plan/backlog-curation-source-provider.ts` — accept optional `progress` and `activity` callbacks on provider context and pass a best-effort callback into source assembly.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — extend `BacklogCurationSourceBuildOptions` with an optional activity/progress callback and emit source-building milestones at the required phase boundaries.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — add a source assembly milestone test covering reading backlog records, scanning git delta, classifying evidence, running source-first audit, and preparing map/reduce packets.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts` or `eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts` — add provider-level coverage that the exported source provider forwards callbacks without changing existing start request shapes.

## Verification

- [ ] `buildBacklogCurationSource` invokes the supplied activity/progress callback with `Reading backlog records` before or during record loading.
- [ ] Source assembly emits `Scanning git delta`, `Classifying evidence`, `Running source-first audit`, and `Preparing map/reduce packets` for a normal backlog curation source build.
- [ ] `buildSource` in the source provider accepts contexts with only `{ cwd, input, signal }` and contexts with an added progress/activity callback.
- [ ] `runBacklogCurationMapReduceTask` emits packet preparation, cache scan, aggregate cache hit/miss, auditing, reducing, validating, and repair-attempt milestones across the existing miss, hit, and repair test cases.
- [ ] Map/reduce tests assert milestone presence with `arrayContaining` or equivalent membership checks instead of exact high-frequency item order.
- [ ] Existing curation outputs, reducer inputs, cache behavior, and cancellation expectations from the touched tests remain unchanged.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-analyze-all-regression.test.ts --silent` exits 0.
