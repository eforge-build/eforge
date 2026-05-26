---
id: plan-02-selector-dedup-and-run-grouping
name: Selector Deduplication, Display Labels, and Run Grouping
branch: polish-console-ui-state-branding-density-naming-and-theme-tokens/plan-02-selector-dedup-and-run-grouping
agents:
  builder:
    effort: high
    rationale: Selector changes affect Now, Queue, Runs, and Activity view models
      and require deterministic merge and grouping rules.
---

# Selector Deduplication, Display Labels, and Run Grouping

## Architecture Context

Selector code is the boundary for Console-only state normalization. Daemon wire shapes remain owned by `@eforge-build/client/browser`; this plan derives UI labels, dedup keys, and run groups without adding daemon fields or importing engine code.

## Implementation

### Overview

Consume the label foundation across Console selectors, deduplicate Now attention items by underlying PRD/session/run identity, and coalesce enqueue/build run rows for the same plan set within a five-minute window.

### Key Decisions

1. Deduplicate after collecting all candidate attention entries so existing candidate rules can stay isolated while the final result enforces one visible item per underlying PRD/session/run key.
2. Merge attention severity with an explicit ordering: `critical > warning > info`.
3. Derive run coalescing keys from normalized planSet slugs, not displayed titles, so title-vs-slug pairs group deterministically.
4. Preserve `selectActiveSessionIds` behavior by leaving it outside `selectRunGroups`; grouping changes cannot remove active session discovery.

## Scope

### In Scope

- Apply `selectPrdDisplayLabel` in Now, Queue, Runs, and Activity selectors where plan set, PRD slug, title, or identifier strings become user-facing labels.
- Deduplicate `selectNowAttentionItems` output by stable PRD/session/run key and keep hidden-count math based on the deduplicated list.
- Add unit coverage for duplicated failed queue/run attention entries and worst-severity merge.
- Update `selectRunGroups` to coalesce enqueue and build runs sharing a normalized planSet slug when their `startedAt` values are no more than five minutes apart.
- Use `pluralize` for `planCountLabel` so `1 plan` and `2 plans` render exactly.
- Add unit coverage for within-window coalescing, outside-window separation, failed enqueue rollup status, and plan-count labels.
- Keep selector tests using handcrafted data objects cast through `unknown` when SDK types require fields unrelated to the test.

### Out of Scope

- Rendering Runs filter controls and day sections; those are implemented in plan 04.
- Removing Now status cards or Queue attention sections; those are implemented in plan 03.
- Daemon-side fixes for markdown body leaking into planSet/title fields.

## Files

### Modify

- `packages/console-ui/src/lib/selectors/now.ts` — normalize labels in Now models and deduplicate attention entries with severity merging.
- `packages/console-ui/src/lib/selectors/queue.ts` — expose normalized queue display labels or helper fields for Queue UI consumption without mutating wire items.
- `packages/console-ui/src/lib/selectors/runs.ts` — implement normalized planSet grouping, five-minute coalescing, pluralized `planCountLabel`, and label projection.
- `packages/console-ui/src/lib/selectors/activity.ts` — normalize PRD/plan-set identifier display strings in activity row models while preserving raw event JSON.
- `packages/console-ui/src/lib/selectors/index.ts` — export new selector helpers/types needed by UI components.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — add attention dedup and severity-merge cases.
- `packages/console-ui/src/__tests__/runs-selectors.test.ts` — add coalescing, non-coalescing, failed rollup, and plan-count label cases.
- `packages/console-ui/src/__tests__/activity-selectors.test.ts` — update expectations if normalized PRD labels change row identifiers.
- `packages/console-ui/src/__tests__/queue-selectors.test.ts` — update or add display-label expectations for queue rows.

## Verification

- [ ] A Now selector fixture containing a failed queue item with a recovery verdict, a duplicate failed queue candidate for the same PRD, and a failed run for the same PRD produces one attention item.
- [ ] A Now selector fixture with duplicate keys and mixed severities returns the worst severity using `critical > warning > info`.
- [ ] `selectRunGroups` merges an `enqueue` run and a `build` run with matching normalized planSet slugs when start times differ by no more than five minutes.
- [ ] `selectRunGroups` does not merge matching planSet runs when start times differ by more than five minutes.
- [ ] A coalesced group containing a failed enqueue run has status `failed`.
- [ ] `metadata.planCount === 1` produces `planCountLabel === "1 plan"`.
- [ ] `metadata.planCount === 2` produces `planCountLabel === "2 plans"`.
- [ ] No file under `packages/console-ui/src/` imports from `@eforge-build/engine`.
- [ ] No non-test source file under `packages/console-ui/src/` contains a quoted `/api/` literal.
- [ ] `pnpm --filter @eforge-build/console-ui test now-selectors runs-selectors` exits 0.
- [ ] `pnpm --filter @eforge-build/console-ui type-check` exits 0.