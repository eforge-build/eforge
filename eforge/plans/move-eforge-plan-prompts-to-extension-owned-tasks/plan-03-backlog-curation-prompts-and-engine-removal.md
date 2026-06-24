---
id: plan-03-backlog-curation-prompts-and-engine-removal
name: Backlog Curation Contributions and Engine Removal
branch: move-eforge-plan-prompts-to-extension-owned-tasks/plan-03-backlog-curation-prompts-and-engine-removal
agents:
  builder:
    effort: high
    rationale: Completes the boundary refactor by moving curation map/reduce prompt
      assets, validation, and repair behavior out of engine code.
  reviewer:
    effort: high
    rationale: Final removal must prove no hidden engine fallbacks remain while
      preserving curation behavior.
---

# Backlog Curation Contributions and Engine Removal

## Architecture Context

After plan-02, normal eforge-plan planning flows use owner-scoped contributions, but backlog-curation map/reduce and legacy engine files still carry eforge-plan prompt ownership. This plan moves item-audit and reducer prompts plus their submit/validation/repair behavior into the eforge-plan extension, updates the daemon map/reduce runner to invoke those registered contributions through the same generic runner path, removes the old engine prompt assets/runners, and adds package assertions for the new asset surface.

## Implementation

### Overview

Move the two curation prompt templates into eforge-plan assets, implement `backlog-item-audit` and `backlog-reducer` task contributions, update daemon map/reduce orchestration to resolve and run those contributions, and delete all eforge-plan prompt files and eforge-plan agent-task code from `packages/engine/src`.

### Key Decisions

1. **Map/reduce orchestration remains daemon/extension-layer work.** The daemon can coordinate packets, cache hits, progress, reducer repair, and provider hooks, but every model-facing prompt and custom tool used by curation comes from eforge-plan contributions.
2. **No engine eforge-plan compatibility fallback.** Removing old prompt files and engine runners is required; tests must fail if `loadPrompt('eforge-plan...')` or eforge-plan prompt assets reappear in `packages/engine/src/agents` or `packages/engine/src/prompts`.
3. **Package assertions guard prompt assets.** The eforge-plan package must include the three markdown prompt assets in npm pack dry-run output.
4. **Source audit is a migration artifact.** The audit documents original prompt files and old selection/loading paths, and the implementation uses it only to verify relocation/removal.

## Scope

### In Scope

- Move `eforge-plan-backlog-curation-item-audit.md` and `eforge-plan-backlog-curation-reducer.md` to eforge-plan-owned prompt assets.
- Declare `backlog-item-audit` and `backlog-reducer` task contributions from eforge-plan.
- Move item-audit submit tool, packet/finding validation, reducer no-tool configuration, reducer validation/repair, reducer input compaction, and bounded needs-input behavior out of engine code.
- Update daemon map/reduce runner to invoke owner-scoped contribution ids for item audit and reducer attempts.
- Remove all three eforge-plan markdown prompts from `packages/engine/src/prompts/`.
- Remove or replace eforge-specific engine agent-task files with generic code only.
- Add source audit documentation and boundary tests.
- Update eforge-plan packaging tests and package metadata to include prompt assets.

### Out of Scope

- Redesigning backlog curation schemas.
- Changing curation patch apply semantics.
- Changing recommendation model semantics.
- Adding engine allowlists, prompt-prefix scanners, or eforge-plan branches.

## Files

### Create

- `eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-item-audit.md` — exact moved copy of the item-audit prompt.
- `eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-reducer.md` — exact moved copy of the reducer prompt.
- `eforge/extensions/eforge-plan/backlog-curation-agent-tasks.ts` — curation contribution declarations, item-audit submit tool, finding validation, reducer resolver, reducer validation/repair behavior, reducer prompt input compaction, and bounded needs-input result helpers.
- `eforge/extensions/eforge-plan/prompt-source-audit.md` — source audit listing the three original prompt files plus every old code path that selected or loaded those prompt templates.
- `eforge/extensions/eforge-plan/__tests__/prompt-assets.test.ts` — asserts prompt files exist in extension-owned source, package metadata includes `prompts/`, npm pack dry-run includes all three markdown assets, and engine prompt directory no longer contains eforge-plan prompt files.
- `test/engine-agent-task-boundary.test.ts` — scans `packages/engine/src/agents` and `packages/engine/src/prompts` for forbidden eforge-plan prompt loads/files while allowing unrelated docs/tests outside engine.

### Modify

- `eforge/extensions/eforge-plan/agent-task-contributions.ts` — export/register `backlog-item-audit` and `backlog-reducer` alongside the planning contributions.
- `eforge/extensions/eforge-plan/index.ts` — register the two curation task contributions.
- `eforge/extensions/eforge-plan/package.json` — include `prompts/` in package `files`.
- `eforge/extensions/eforge-plan/tsup.config.ts` — add asset-copy or postbuild assertions only if needed for local build output; do not inline markdown into engine assets.
- `eforge/extensions/eforge-plan/__tests__/package-publication.test.ts` — assert package `files` and npm pack dry-run contain all three prompt markdown files and still exclude TypeScript sources/tests.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert the final eforge-plan registration includes `planning-draft`, `session-plan-creation`, `plan-revision`, `recommendation-refresh`, `backlog-item-audit`, and `backlog-reducer`.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-prompt-contract.test.ts` — read the planning prompt from the extension asset path.
- `packages/monitor/src/routes/extensions/backlog-curation-map-reduce-runner.ts` — replace imports from `@eforge-build/engine/agents/backlog-curation-map-reduce` with generic owner-scoped contribution execution for item audit and reducer attempts; keep cache/progress/provider hook orchestration.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — remove eforge-plan owner-name checks from curation routing; route structured map/reduce sources through declared contribution ids and generic resolution.
- `packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts` and `packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-daemon.test.ts` — assert item and reducer prompts come from extension-owned contribution assets, raw source sentinels stay out of prompts, reducer repair still runs once, cancellation still stops queued item audits, and no generic planning fallback is invoked for map/reduce.
- `test/extension-backlog-curation-map-reduce.test.ts` — move or rewrite engine-level curation runner tests into eforge-plan/monitor contribution tests; remove imports from engine eforge-specific runners.
- `test/extension-planning-task.test.ts` — remove engine eforge-plan runner imports or replace with extension-owned planning contribution tests from plan-02.
- `test/prompts.test.ts` — remove `loadPrompt('eforge-plan-planning-draft', ...)` coverage and use extension asset rendering where prompt text assertions remain.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — delete.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-item-audit.md` — delete.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-reducer.md` — delete.
- `packages/engine/src/agents/extension-planning-task.ts` — delete or replace with a product-agnostic compatibility export that contains no eforge-plan ids; prefer deleting all imports.
- `packages/engine/src/agents/extension-planning-submit-tools.ts` — delete after moved tools compile from eforge-plan.
- `packages/engine/src/agents/backlog-curation-map-reduce.ts` — delete after daemon curation runner uses contributions.

## Source Audit Content Requirements

The audit file must document:

- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — original model-facing planning, revision, session-plan creation, recommendation, and generic curation prompt.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-item-audit.md` — original map item-audit prompt.
- `packages/engine/src/prompts/eforge-plan-backlog-curation-reducer.md` — original map/reduce reducer prompt.
- `packages/engine/src/agents/extension-planning-task.ts` — old planning prompt selection/loading path.
- `packages/engine/src/agents/backlog-curation-map-reduce.ts` — old item-audit and reducer prompt selection/loading paths plus old eforge-plan submit/repair behavior.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — old task-kind and map/reduce dispatch path.
- `packages/monitor/src/routes/extensions/backlog-curation-map-reduce-runner.ts` — old imports of engine curation runners.
- eforge-plan actions that currently select the planning task kind: `agent-task-actions.ts`, `recommendation-refresh.ts`, `backlog-curation-actions.ts`, and `plan-revision-actions.ts`.

## Verification

- [ ] `find packages/engine/src/prompts -maxdepth 1 -name 'eforge-plan-*.md'` prints no files.
- [ ] `rg "loadPrompt\('eforge-plan|loadPrompt\(\"eforge-plan" packages/engine/src` prints no matches.
- [ ] `rg "eforge-plan" packages/engine/src/agents` prints no matches except test fixture comments if any are explicitly allowlisted in `test/engine-agent-task-boundary.test.ts`.
- [ ] `eforge/extensions/eforge-plan/prompts/eforge-plan-planning-draft.md` exists and contains `Submit exactly once. Do not finish with prose.`
- [ ] `eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-item-audit.md` exists and contains `You are auditing exactly one validated backlog item`.
- [ ] `eforge/extensions/eforge-plan/prompts/eforge-plan-backlog-curation-reducer.md` exists and contains `Do not use repository, filesystem, shell, network, or mutation tools`.
- [ ] eforge-plan registration tests find contribution ids `planning-draft`, `session-plan-creation`, `plan-revision`, `recommendation-refresh`, `backlog-item-audit`, and `backlog-reducer`.
- [ ] Backlog item-audit contribution runs with `tools: 'read-only'` and custom tools `submit_eforge_plan_backlog_item_finding` plus progress.
- [ ] Backlog reducer contribution runs with `tools: 'none'` and custom tools `submit_eforge_plan_planning_result` plus progress.
- [ ] Reducer repair performs exactly one second attempt after invalid reducer validation and returns a bounded `needs-input` result when the repair also fails.
- [ ] Daemon map/reduce tests show no raw `gitDelta`, `fullImplementationAudit`, raw item bodies, or legacy source text in item or reducer prompts.
- [ ] npm pack dry-run for `@eforge-build/eforge-plan` includes the three prompt markdown assets.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/prompt-assets.test.ts eforge/extensions/eforge-plan/__tests__/package-publication.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-daemon.test.ts test/engine-agent-task-boundary.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.