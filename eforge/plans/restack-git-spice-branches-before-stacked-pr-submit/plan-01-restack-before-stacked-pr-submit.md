---
id: plan-01-restack-before-stacked-pr-submit
name: Restack Before Stacked PR Submit
branch: restack-git-spice-branches-before-stacked-pr-submit/plan-01-restack-before-stacked-pr-submit
---

# Restack Before Stacked PR Submit

## Architecture Context

Stacked PR landing is implemented by `executeStackLanding` in `packages/engine/src/stacking/landing.ts`. The helper already owns the provider command sequence, `stack:provider:command` emission, durable stack layer landing updates, PR URL discovery, and PR auto-merge follow-up. The provider boundary already exposes `restackBranch(cwd)`, and `GitSpiceAdapter.restackBranch` already invokes `git-spice branch restack` in the checked-out worktree.

This plan keeps the change inside stacked PR landing. `stackLanding(ctx)` already returns when no stack context/provider exists and returns before `executeStackLanding` for non-PR landing actions, so non-stacked builds and merge/leave workflows remain outside the provider command path.

## Implementation

### Overview

Add one required provider step to stacked PR landing: after optional cleanup completes and before `provider.submitBranch(mergeWorktreePath)`, call `provider.restackBranch(mergeWorktreePath)` and emit its `stack:provider:command` event. If restack fails, persist the stack layer as failed, emit a failed landing update, and return without submitting.

### Key Decisions

1. Use `provider.restackBranch(mergeWorktreePath)` rather than `restackStack` or `performStackSync`. Landing operates on the single artifact branch checked out in the merge worktree.
2. Place restack after cleanup. Cleanup can create a final commit after branch tracking, so restack must see the final branch tip that submit will use.
3. Reuse the existing provider command event helpers and failure semantics from track/submit. Restack failure is a provider landing failure and must not fall through to submit.
4. Do not add the optional submit retry in this plan. The required fix is deterministic and the acceptance criteria target pre-submit restack plus failure handling.

## Scope

### In Scope

- Add pre-submit `restackBranch` in `executeStackLanding` for stacked PR landing.
- Emit `stack:provider:command` for successful branch restack.
- Emit a failed `stack:provider:command` when restack throws a provider command error with command metadata.
- Persist failed stack layer landing state when restack throws.
- Stop before `submitBranch` when restack throws.
- Update focused Vitest coverage for provider command ordering, cleanup ordering, restack failure, non-PR skip behavior, and existing git-spice adapter coverage.

### Out of Scope

- Non-stacked PR workflows.
- Direct merge workflows.
- Leave workflows.
- Stack-wide restack or sync during single-artifact landing.
- Manual `eforge stack sync` daemon or CLI changes.
- Runtime-dependent git-spice end-to-end reproduction.
- Submit retry after a restack-related submit error.

## Files

### Create

None.

### Modify

- `packages/engine/src/stacking/landing.ts` — insert the branch restack step after optional cleanup and before submit; update comments/step numbering to reflect `track -> cleanup -> restack -> submit -> PR URL discovery -> persistence -> auto-merge`; use the same failed landing persistence and event emission semantics as track and submit failures.
- `test/stack-runtime-landing.test.ts` — update successful PR command tests for `trackBranch -> restackBranch -> submitBranch`; assert provider command event order includes branch restack; add restack failure tests for generic errors and `GitSpiceCommandError`; assert submit is not called when restack fails; include `restackBranch` in non-PR provider-called guards.
- `test/stack-landing-cleanup.test.ts` — update cleanup-before-submit expectations so cleanup progress occurs before restack and restack occurs before submit; assert cleanup-enabled provider command order is track, restack, submit with cleanup progress between track and restack.

## Implementation Notes

- A minimal implementation can mirror the existing track/submit try/catch blocks:
  - declare `let restackResult: ProviderCommandResult;`
  - call `await provider.restackBranch(mergeWorktreePath)` after the cleanup block;
  - `yield stackProviderCommandEvent(providerName, branch, restackResult)` on success;
  - on failure, yield `stackProviderCommandEventFromError(...)` when available, redact the error message, call `updateStackLayerStatusAndLanding(cwd, prdId, 'failed', { action: landingAction, status: 'failed', reason, startedAt, completedAt: failedAt })`, yield `stack:landing:update` with `status: 'failed'`, then `return`.
- Keep PR URL discovery based on `submitResult.stdout`; restack output is not a PR URL source.
- Keep PR auto-merge execution after successful submit and landing persistence.
- If extracting a local helper for provider failure handling reduces duplication, keep it private to `landing.ts` and preserve emitted event fields.

## Verification

- [ ] `executeStackLanding` invokes `trackBranch`, then `restackBranch`, then `submitBranch` in the merge worktree for PR landing without cleanup.
- [ ] `stack:provider:command` events for PR landing without cleanup have args in this order: `['branch', 'track', '--base', '<base>']`, `['branch', 'restack']`, `['branch', 'submit']`.
- [ ] With cleanup enabled, a cleanup progress event appears after track and before restack, and restack appears before submit.
- [ ] When `restackBranch` throws a generic `Error`, `executeStackLanding` emits a failed `stack:landing:update` and does not call `submitBranch`.
- [ ] When `restackBranch` throws `GitSpiceCommandError`, `executeStackLanding` emits a `stack:provider:command` event with the restack args and non-zero exit code before the failed landing update.
- [ ] Failed restack persists the stack layer with `status: 'failed'`, `landing.status: 'failed'`, a non-empty `landing.reason`, and `landing.completedAt`.
- [ ] Non-PR direct calls to `executeStackLanding` do not call `trackBranch`, `restackBranch`, or `submitBranch`.
- [ ] Existing PR URL discovery, landing persistence, and auto-merge tests continue to pass after the extra provider command event is added.
- [ ] `pnpm exec vitest run test/stack-runtime-landing.test.ts test/stack-landing-cleanup.test.ts test/git-spice-provider.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
