---
title: Preserve terminal curation findings under reducer byte caps
created: 2026-06-28
---

# Preserve terminal curation findings under reducer byte caps

## Problem / Motivation

`eforge-plan` analyze-all curation can audit source-backed terminal findings and still leave those items open because the reducer input is capped before the reducer sees every outcome.

A reported run audited 20 items and found 9 `shipped` verdicts, but the final `backlogCurationDraft` retained only 14 outcomes and proposed 5 `shipped` closures. Four source-backed shipped items remained open after apply.

This is a data-integrity failure in the map/reduce handoff. Terminal closure findings must be preserved or explicitly surfaced. Users should not see a successful curation draft/apply and reasonably conclude all confirmed closures were applied when terminal outcomes were omitted by a byte cap.

Current reproduction path:

1. Construct a map/reduce reducer input with enough item outcomes to exceed `BACKLOG_CURATION_REDUCER_INPUT_MAX_BYTES` after global-context shrinking.
2. Put large non-terminal/no-op outcomes early in the list and source-backed `shipped` or `superseded` findings late in the list.
3. Call `buildBacklogCurationReducerInput(globalContext, outcomes, generatedAt)` from `eforge/extensions/eforge-plan/backlog-curation-packets.ts`.
4. Observe that the cap loop removes outcomes from the tail and emits only a generic retained-count diagnostic, so late terminal findings disappear from reducer input.
5. Run the reducer/apply path with the capped input. The reducer can only close terminal items that survived truncation; omitted terminal item IDs are not visible as named needs-input or preview/apply warnings.

Root cause:

- Reducer input cap enforcement is byte-count driven and outcome-order dependent.
- After shrinking global context, the current code repeatedly `pop()`s outcomes until the serialized input fits.
- Tail-pop pruning preserves whichever findings happen to appear earlier and drops later outcomes regardless of semantic importance.
- There is no protected class for terminal source-backed findings.
- There is no compaction strategy that reduces lower-value details before dropping closures.
- There is no diagnostic carrying omitted terminal item IDs/verdicts.
- The reducer prompt only sees retained outcomes, so it cannot produce safe patches or honest needs-input rows for omitted terminal findings.
- Preview/apply surfaces display the incomplete draft, making the omission look like a normal completed curation run.

## Goal

Fix the analyze-all backlog curation map/reduce reduction path so source-backed terminal findings (`shipped`/`superseded`) are not lost behind reducer byte-cap truncation.

Terminal closure findings should be retained first or explicitly surfaced by name when a hard cap makes retention impossible.

## Approach

Replace tail-pop pruning in `buildBacklogCurationReducerInput` with deterministic semantic priority and compaction.

When byte pressure exists, retain terminal `change` findings ahead of:

- no-op rechecks
- still-needed/partial notes
- failed/invalid outcomes
- recommendation-only detail
- nonessential diagnostics

Retained terminal findings must stay compact but complete enough for valid reducer output, including:

- item id
- body/source hashes
- verdict
- disposition
- closure roles
- rationale/summary
- compact current-source citations

If terminal findings alone cannot fit, fail closed or emit explicit `needsInput`/split guidance naming every omitted terminal candidate and verdict. The task must not report only a generic “N outcomes dropped” message.

Clarify reducer prompt handling for named omitted-terminal diagnostics. Ensure reducer prompt sanitization/compaction keeps terminal outcomes compact but complete enough for valid patches.

Reuse existing `backlogCurationDraft.needsInput`/`skipped` visibility if sufficient. Add preview schema/UI fields only if named omissions cannot otherwise be surfaced clearly.

Avoid breaking daemon/client APIs unless an additive preview field is required.

## Scope

In scope:

- `eforge-plan` reducer input construction.
- Semantic priority/compaction for capped reducer inputs.
- Reducer prompt and validation expectations.
- Named omission diagnostics for omitted terminal candidates.
- Preview/apply review visibility for excluded terminal candidates.
- Regression tests for capped reducer inputs with late terminal findings.
- Preview/UI tests if new warning fields are introduced.
- Targeted type-check and maintainability validation.

Likely changed files include:

- `eforge/extensions/eforge-plan/backlog-curation-packets.ts`
- reducer prompt/agent-task compaction code
- curation packet/map-reduce tests
- preview code, only if existing draft exception rows are insufficient

Out of scope:

- Changing source-first closure authority.
- Treating git/PR hints as closure authority.
- Adding broader auto-apply workflow behavior.
- Increasing byte caps as the preferred solution.

Assumptions:

- Current source remains the only closure authority for source-first curation.
- Deterministic priority/compaction is preferred over increasing byte caps.
- Existing `backlogCurationDraft.needsInput`/`skipped` visibility should be reused if sufficient.
- Preview schema/UI fields should be added only if named omissions cannot otherwise be surfaced clearly.

## Acceptance Criteria

- `buildBacklogCurationReducerInput(globalContext, outcomes, generatedAt)` does not silently drop source-backed `shipped` findings solely because they appear late in the outcome list.
- `buildBacklogCurationReducerInput(globalContext, outcomes, generatedAt)` does not silently drop source-backed `superseded` findings solely because they appear late in the outcome list.
- Under reducer byte pressure, terminal `change` findings are retained ahead of no-op rechecks.
- Under reducer byte pressure, terminal `change` findings are retained ahead of still-needed/partial notes.
- Under reducer byte pressure, terminal `change` findings are retained ahead of failed/invalid outcomes.
- Under reducer byte pressure, terminal `change` findings are retained ahead of recommendation-only detail.
- Under reducer byte pressure, terminal `change` findings are retained ahead of nonessential diagnostics.
- Retained terminal findings include the item id needed to emit valid closed-status patches.
- Retained terminal findings include body/source hashes needed to emit valid closed-status patches.
- Retained terminal findings include the verdict needed to emit valid closed-status patches.
- Retained terminal findings include the disposition needed to emit valid closed-status patches.
- Retained terminal findings include closure roles needed to emit valid closed-status patches.
- Retained terminal findings include rationale or summary needed to emit valid closed-status patches.
- Retained terminal findings include compact current-source citations needed to emit valid closed-status patches.
- If terminal findings alone cannot fit under the hard cap, the task fails closed or emits explicit `needsInput`/split guidance.
- Any `needsInput`/split guidance for terminal findings that cannot fit names every omitted terminal candidate.
- Any `needsInput`/split guidance for terminal findings that cannot fit names every omitted terminal candidate verdict.
- The task does not report only a generic “N outcomes dropped” message when terminal findings are omitted.
- Preview/apply review makes excluded terminal candidates visible via named `needsInput` rows, named unresolved-exception rows, or an equivalent additive preview warning.
- Users cannot mistake a partial closure draft for a complete apply when excluded terminal candidates exist.
- Regression tests in `eforge/extensions/eforge-plan/__tests__/backlog-curation-packets.test.ts` cover terminal findings late in a capped per-item outcome set.
- Regression tests verify late terminal findings are retained or explicitly surfaced when reducer input is capped.
- Map/reduce runner tests in `packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts` verify the reducer receives protected terminal outcomes.
- Map/reduce runner tests in `packages/monitor/src/__tests__/routes-extension-agent-task-backlog-curation-map-reduce.test.ts` verify named diagnostics are produced for protected terminal outcomes that cannot fit.
- Preview/UI tests are added or adjusted if the implementation introduces new warning fields.
- Existing needs-input/skipped rows render named omissions when no new preview warning fields are introduced.
- Closed-status patches continue to require current-source evidence prefixes/roles.
- Historical git/PR hints remain non-authoritative for closure.
- Targeted vitest coverage for curation packet/reducer/preview tests exits 0.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.