---
id: plan-01-live-dependency-projection
name: Live Queue Dependency Projection
branch: queue-dependency-visibility-and-override-controls/plan-01-live-dependency-projection
agents:
  builder:
    effort: high
    rationale: This plan edits the oversized client event registry under a no-growth
      ceiling and coordinates engine-emitted event metadata with Console
      projection tests.
---

# Live Queue Dependency Projection

## Architecture Context

Queue dependency visibility is driven by daemon events projected through `@eforge-build/client`'s `eventRegistry`; Console derives its project-state projector registry from that client registry. REST and `stream:hello` snapshots already load `QueueItem.dependsOn` from queue frontmatter, so this plan makes live queue events carry and preserve the same dependency metadata.

`packages/client/src/event-registry.ts` is a legacy oversized file with a no-growth ceiling. Move queue projection logic into a focused helper file and keep registry edits bounded.

## Implementation

### Overview

Add optional `dependsOn` metadata to `queue:prd:discovered`, emit it from queue discovery code, and project it into live Console state. Add a defensive `daemon:scheduler:dependency-blocked` projector so scheduler blocked events patch existing child rows even if discovery metadata was missed.

### Key Decisions

1. `queue:prd:discovered.dependsOn` uses the client/Console camelCase `dependsOn` wire field while preserving `depends_on` as the PRD frontmatter field.
2. Discovery events are the primary source for dependency metadata; scheduler blocked events union `blockedBy` into an existing queue item's `dependsOn` as a defensive patch.
3. Queue projector helpers live outside `event-registry.ts` so the oversized registry shrinks instead of growing beyond its baseline ceiling.

## Scope

### In Scope

- Add optional `dependsOn?: string[]` to `queue:prd:discovered` event schema.
- Emit `dependsOn` from both queue discovery paths when PRD frontmatter contains `depends_on`.
- Update live queue projectors for `enqueue:complete`, `queue:prd:discovered`, and `daemon:scheduler:dependency-blocked` to merge queue items without dropping existing dependency metadata.
- Add client and Console projection/selector tests for live dependency visibility and stack grouping.

### Out of Scope

- Dependency override routes or UI controls.
- Changing REST queue projection shape.
- Pi, MCP, or CLI queue-control tools.

## Files

### Create

- `packages/client/src/event-projections/queue.ts` — focused queue projection helpers used by `eventRegistry`.
- `packages/console-ui/src/lib/selectors/__tests__/queue-dependency-live-projection.test.ts` — selector/reducer regression for live dependency-linked queue state without growing `now-selectors.test.ts` past the test cap.

### Modify

- `packages/client/src/events/queue-events.ts` — add optional `dependsOn` to `queue:prd:discovered`.
- `packages/client/src/event-registry.ts` — import queue projector helpers; replace inline enqueue/discovery projectors; add `daemon:scheduler:dependency-blocked` projector while reducing total line count.
- `packages/engine/src/queue/scheduler.ts` — include `dependsOn` from `prd.frontmatter.depends_on ?? []` on every `queue:prd:discovered` event.
- `packages/engine/src/eforge.ts` — include `dependsOn` on the legacy queue discovery event without increasing the file line count.
- `packages/client/src/__tests__/events-schemas.test.ts` — cover queue projection merging and dependency-blocked projection.
- `packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts` — cover `queue:prd:discovered` schema acceptance with `dependsOn`.
- `test/queue-scheduler-policy.test.ts` — assert scheduler discovery emits `dependsOn` from PRD frontmatter.
- `packages/console-ui/src/__tests__/project-state.test.ts` — cover reducer projection for discovered/dependency-blocked queue metadata if the new selector test does not exercise reducer state directly.
- `web/content/reference/events.md` and `web/public/reference/events.md` — update generated event reference only if `pnpm docs:check` reports drift.

## Verification

- [ ] `safeParseEforgeEvent` accepts `queue:prd:discovered` with `dependsOn: ['parent-prd']`.
- [ ] Replaying `queue:prd:discovered` into an empty projectable state returns a queue item whose `dependsOn` equals `['parent-prd']`.
- [ ] Replaying `daemon:scheduler:dependency-blocked` against a state containing `child-prd` returns a queue item whose `dependsOn` contains every `blockedBy` id and preserves existing dependency ids.
- [ ] Replaying live parent/child queue events into Console state lets `selectNowQueueStacks` return one stack containing both ids.
- [ ] `QueueScheduler` emits `queue:prd:discovered.dependsOn` from `depends_on` frontmatter.
- [ ] `packages/client/src/event-registry.ts` remains at or below its baseline no-growth ceiling.