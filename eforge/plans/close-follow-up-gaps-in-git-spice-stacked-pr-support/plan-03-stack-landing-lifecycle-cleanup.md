---
id: plan-03-stack-landing-lifecycle-cleanup
name: Stack Landing Lifecycle Status and Cleanup
branch: close-follow-up-gaps-in-git-spice-stacked-pr-support/plan-03-stack-landing-lifecycle-cleanup
agents:
  builder:
    effort: high
    rationale: Coordinates stack runtime persistence, landing phase ordering,
      cleanup extraction, provider failure handling, and monitor projections.
---

# Stack Landing Lifecycle Status and Cleanup

## Architecture Context

Stacked PR landing currently records landing state without advancing the layer status, and git-spice PR submission bypasses the generic pre-publication cleanup path in `landing.ts`. After plan-01 and plan-02, this plan uses canonical landing actions and the artifact registry while fixing stack-specific lifecycle gaps.

## Implementation

### Overview

Make stack layer status transitions reflect landing outcomes, share generic cleanup before git-spice submission, prevent duplicate PR publication after successful git-spice submission, and update monitor/client projections for the resulting statuses.

### Key Decisions

1. Landing and layer status updates occur in one state-lock critical section.
2. Successful stack PR submission persists `landing.status: complete` and layer `status: landed`.
3. Provider failures persist `landing.status: failed` and layer `status: failed`.
4. Generic cleanup is extracted into a reusable pre-publication helper and invoked once before both `gh pr create` and `git-spice branch submit`.

## Scope

### In Scope
- Add or replace a stack-state helper that updates `landing`, `status`, and `updatedAt` atomically.
- Use `markStackLayerFailed()` or replace it with the new atomic helper; remove dead helper code if no caller remains.
- Update stack PR success/failure, non-PR stack actions, and pre-landing skips to produce coherent layer statuses.
- Extract reusable cleanup from `packages/engine/src/landing.ts` and call it from stacked PR landing before `provider.submitBranch`.
- Preserve the duplicate-PR guard: successful git-spice submission sets landing success so generic finalize does not run `gh pr create`.
- Update live reducer/projection tests so monitor-visible stack layers transition from `built` to `landed`, `merged`, or `failed` as events arrive.

### Out of Scope
- New stack providers.
- Automated post-merge restack/sync.
- Artifact registry schema changes beyond consuming plan-02 helpers.

## Files

### Create
- `test/stack-landing-cleanup.test.ts` or extend existing landing/provider tests — asserts cleanup-before-submit and single-publication behavior.

### Modify
- `packages/engine/src/stacking/state.ts` — add atomic status+landing update helper and update schema/tests if status semantics change.
- `packages/engine/src/stacking/landing.ts` — call shared cleanup before submit, persist success/failure statuses, and emit `stack:landing:update` events matching persisted state.
- `packages/engine/src/landing.ts` — export or extract reusable pre-publication cleanup without changing generic merge/PR/leave behavior.
- `packages/engine/src/orchestrator/phases.ts` — pass cleanup options to stack landing and handle canonical success/failure state after git-spice submission.
- `packages/client/src/events.schemas.ts` — update stack/landing event schema only if event payloads gain fields or status values.
- `packages/monitor-ui/src/lib/daemon-reducer.ts` and/or `packages/monitor-ui/src/lib/reducer/*` — project stack landing updates into layer statuses for live state.
- `packages/monitor-ui/src/lib/__tests__/daemon-reducer.test.ts` and `packages/monitor-ui/src/components/stack/__tests__/stack-layers-card.test.tsx` — verify visible layer status and PR URL projection.
- `test/stack-state.test.ts`, `test/stack-runtime-landing.test.ts`, `test/git-spice-provider.test.ts`, `test/stack-artifact-recording.test.ts` — update or add PR success, provider failure, merge action, leave action, and pre-landing skip cases.

## Verification

- [ ] `updateStackLayerLanding` replacement persists `landing.status: complete` and layer `status: landed` for stack PR success.
- [ ] Provider `trackBranch` failure persists layer `status: failed` and `landing.status: failed` with the redacted reason.
- [ ] Provider `submitBranch` failure persists layer `status: failed` and `landing.status: failed` with the redacted reason.
- [ ] Stack merge and leave actions produce terminal layer statuses that are not `built`.
- [ ] Stacked PR landing emits cleanup events before the provider submit command event when cleanup is enabled.
- [ ] Cleanup runs one time for stacked PR landing.
- [ ] Successful git-spice submission does not call generic `gh pr create`.
- [ ] Monitor reducer tests show `stack:landing:update` complete changes the layer status from `built` to `landed` and preserves PR URL.
