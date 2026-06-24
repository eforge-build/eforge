---
id: plan-04-recommendation-actionability-server
name: Server Recommendation Actionability and Duplicate Guards
branch: clean-up-the-eforge-plan-workstation/plan-04-recommendation-actionability-server
agents:
  builder:
    effort: high
    rationale: This plan introduces an extension-owned projection that joins
      recommendation models, session plans, workflow tasks, and lifecycle
      traces, then reuses it for direct action duplicate guards.
  reviewer:
    effort: high
    rationale: The server projection changes action wire shapes and
      duplicate-prevention behavior, requiring careful API and test review.
---

# Server Recommendation Actionability and Duplicate Guards

## Architecture Context

The engine and daemon remain input/build infrastructure; eforge-plan owns workstation planning workflow decisions. Recommendation actionability must therefore be computed inside the eforge-plan extension from extension-owned session plans, workflow indexes, and lifecycle traces. The workstation renders that projection, and direct action calls use the same server evidence to fail closed.

## Implementation

### Overview

Add a server-derived recommendation actionability projection to `get-recommendations`, including lifecycle state, reason codes/messages, and associated links for planned or in-process work. Reuse the same logic in `start-planning-agent-task` to reject duplicate planning for selected work already covered by a session plan, active planning task, queued/building trace, active build session, or open PR trace.

### Key Decisions

1. Keep stored recommendation JSON backward compatible: do not write actionability fields into `current.json`; return actionability as an additive `get-recommendations` projection.
2. Use fail-closed duplicate guards for direct `start-planning-agent-task` calls: if any selected item is non-actionable, throw a user-action error before `ctx.agentTasks.start()`.
3. Include evidence links in rejection details and `get-recommendations` output so stale or surprising suppression can be inspected.
4. For safe-parallel recommendation groups, compute per-item actionability plus group-level `actionableItemIds` and `suppressedItemIds`; a mixed group remains partially actionable only for the server-reported actionable subset.

## Scope

### In Scope

- Define recommendation actionability schemas/types for state, reason code/message, lifecycle state, associated links, and per-lane/per-entry projections.
- Compute actionability from flat session plans, submitted session plans, active planning task workflow entries, queue/build/build-session traces, and PR-open traces.
- Return actionability metadata from `get-recommendations` when recommendations exist.
- Reject duplicate `start-planning-agent-task` calls when selected items are already planned or in process.
- Add unit/action tests for each lifecycle category named in the source.
- Update eforge-plan README action docs for server-derived actionability and duplicate guard behavior.

### Out of Scope

- Expanding engine scheduling.
- Changing daemon queue semantics.
- Replacing recommendation generation.
- Writing actionability metadata into recommendation storage.

## Files

### Create

- `eforge/extensions/eforge-plan/recommendation-actionability.ts` — shared extension-owned projection and duplicate-guard helper.
- `eforge/extensions/eforge-plan/__tests__/recommendation-actionability.test.ts` — focused actionability tests for planned, submitted, active task, queue, build, build-session, PR-open, and mixed safe-parallel cases.

### Modify

- `eforge/extensions/eforge-plan/schema.ts` — add actionability state, reason, link, and projection schemas/types near the recommendations region.
- `eforge/extensions/eforge-plan/recommendation-status-schemas.ts` — include the additive actionability projection in `GetRecommendationsWithStatusOutputSchema`.
- `eforge/extensions/eforge-plan/recommendation-actions.ts` — compute and return `recommendationActionability` from `get-recommendations`.
- `eforge/extensions/eforge-plan/agent-task-actions.ts` — call the shared guard after planner context resolution and before `ctx.agentTasks.start()`.
- `eforge/extensions/eforge-plan/__tests__/recommendations-store.test.ts` — update output shape expectations for `get-recommendations`.
- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — add direct invocation tests proving duplicate planned and in-process selections do not call `agentTasks.start()` and return a clear user-action failure.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — assert the additive output schema includes actionability metadata.
- `eforge/extensions/eforge-plan/README.md` — document actionability fields, suppression reasons, links, and duplicate guard behavior.

## Verification

- [ ] `get-recommendations` output includes `recommendationActionability` for recommended next entries and safe-parallel groups when a model exists.
- [ ] Actionability metadata includes `state`, reason code/message for non-actionable entries, lifecycle state, and associated links.
- [ ] Tests cover planned session plan, submitted session plan, active planning task, queued trace, building trace, active build-session trace, PR-open trace, and mixed safe-parallel lane cases.
- [ ] A direct `start-planning-agent-task` call for an already planned selection returns an invalid-input/user-action failure and never calls `agentTasks.start()`.
- [ ] A direct `start-planning-agent-task` call for an in-process selection returns an invalid-input/user-action failure and never calls `agentTasks.start()`.
- [ ] Recommendation storage files remain compatible with `BacklogRecommendationModelSchema` and contain no persisted actionability fields.
