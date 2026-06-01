---
title: Complete Provider-Encapsulated Stacked Landing Conflict Recovery
created: 2026-06-01
---

# Complete Provider-Encapsulated Stacked Landing Conflict Recovery

## Overview

Continue implementation on branch `eforge/provider-encapsulated-stacked-landing-conflict-recovery` after the previous session landed the foundation commit `edfda088` but then blocked `plan-02-landing-integration-docs`.

The previous landed work appears to include provider-neutral recovery types, git-spice conflict classification and continue/abort support, a landing conflict recovery helper, recovery lifecycle events, UI reducers, and focused tests. This successor must validate that foundation, complete the remaining landing integration and documentation work, and ensure the full original acceptance criteria are satisfied.

## Starting Point

Already landed:
- `plan-01-provider-recovery-foundation`: commit `edfda088c303f732404c5046ee7c03a6abc5879d`
- Planning/provenance commits: `a68f735f35a55b2c310fabee0a007a4eef8b7027` and `57bb4824399d8226e7915444f6d59caaa98b7cf3`

The failed/remaining plan is:
- `plan-02-landing-integration-docs`, which was blocked by the failed dependency marker from plan-01 and did not complete.

## Objectives

- Verify the landed foundation is internally consistent and passes type-check/tests.
- Complete `plan-02-landing-integration-docs`.
- Wire provider-encapsulated restack conflict recovery into stacked landing end-to-end.
- Update documentation and generated reference artifacts as needed.
- Preserve provider encapsulation: orchestration must not call git-spice-specific continue or abort commands directly.

## Acceptance Criteria

- [ ] Confirm why `plan-01-provider-recovery-foundation` was marked failed and fix any actual issue in the landed foundation.
- [ ] `StackProviderAdapter` exposes provider-neutral methods for classifying recoverable conflicts and continuing or aborting interrupted provider operations.
- [ ] `GitSpiceAdapter` implements recoverable restack conflict classification without exposing git-spice command details to `executeStackLanding`.
- [ ] `GitSpiceAdapter` implements provider-owned continue and abort methods for interrupted restack operations.
- [ ] Provider continue and abort invocations return `ProviderCommandResult` values that can be emitted as `stack:provider:command` events.
- [ ] `executeStackLanding` attempts landing conflict recovery when `provider.restackBranch` fails with a provider-classified recoverable conflict.
- [ ] `executeStackLanding` does not attempt landing conflict recovery when `provider.restackBranch` fails with a non-conflict provider error.
- [ ] `executeStackLanding` calls `provider.submitBranch` after provider restack conflict recovery completes successfully.
- [ ] `executeStackLanding` does not call `provider.submitBranch` when provider restack conflict recovery fails.
- [ ] Failed provider restack conflict recovery persists stack layer landing state with `status: 'failed'` and an actionable recovery failure reason.
- [ ] Successful provider restack conflict recovery leaves the stack layer landing state to be completed by the normal submit success path.
- [ ] The recovery helper verifies that no unmerged files remain before continuing the interrupted provider operation.
- [ ] The recovery helper attempts provider abort when recovery fails and the provider supports abort.
- [ ] Temporary plan-id marker cleanup conflicts are resolved by a deterministic strategy before invoking the merge-conflict resolver agent.
- [ ] The merge-conflict resolver agent is invoked as a fallback when deterministic strategies do not resolve the provider conflict.
- [ ] Recovery attempts are bounded and stop with a failed landing result when the bound is exceeded.
- [ ] New recovery lifecycle events are defined in `packages/client/src/events.schemas.ts` when event visibility requires new event types.
- [ ] Event registry and wire-parity tests pass for any new recovery lifecycle events.
- [ ] Existing restack failure tests continue to pass for non-recoverable restack failures.
- [ ] `test/git-spice-provider.test.ts` covers provider conflict classification and continue/abort argv construction.
- [ ] `test/stack-runtime-landing.test.ts` covers successful provider-encapsulated restack conflict recovery.
- [ ] `test/stack-runtime-landing.test.ts` covers failed provider-encapsulated restack conflict recovery.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm exec vitest run test/git-spice-provider.test.ts test/stack-runtime-landing.test.ts test/merge-conflict-resolver.test.ts` exits 0.
- [ ] Documentation mentions automatic provider-encapsulated recovery for recoverable stacked PR restack conflicts.
- [ ] Generated reference artifacts are updated if event schemas changed.

## Out of Scope

- Implementing additional stack providers such as Graphite.
- Changing non-stacked `landing.action: pr` behavior.
- Rewriting the existing merge-conflict resolver beyond the adapter or wiring needed here.
- Broad daemon API changes unrelated to event schema/reference updates.
