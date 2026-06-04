---
id: plan-01-stacked-pr-landing-freshness
name: Stacked PR Landing Remote Base Freshness
branch: fix-stacked-pr-landing-remote-base-sync-for-git-spice/plan-01-stacked-pr-landing-freshness
agents:
  builder:
    effort: high
    rationale: Landing control flow must preserve existing git-spice provider
      ordering, restack conflict recovery, state persistence, freshness retry
      semantics, and file-size constraints in a 575-line existing module.
---

# Stacked PR Landing Remote Base Freshness

## Architecture Context

Stacked PR landing is provider-boundary code: orchestration calls `StackProviderAdapter` methods and emits `stack:provider:command` events from returned provider metadata. Direct non-stacked PRs already use a separate base-sync path; this plan adds the stacked equivalent without reusing direct PR publication or changing manual whole-stack sync.

`packages/engine/src/stacking/landing.ts` is close to the 600-line implementation cap, so move reusable landing base/freshness helpers into a new stacking-internal module before adding the sync/retry cycle. Keep all git-spice command execution behind `provider.syncRepo`, `provider.trackBranch`, `provider.restackBranch`, `provider.retargetBranch`, and `provider.submitBranch`.

## Implementation

### Overview

Add a landing-time remote-base sync and freshness proof for `executeStackLanding(...)` when `landingAction === 'pr'`:

1. Run the existing effective-base preflight/repair.
2. Call `provider.syncRepo(mergeWorktreePath)` and emit its provider command event.
3. Track the branch against the effective base.
4. Run cleanup once when configured.
5. Run branch restack with the existing recoverable-conflict recovery path.
6. Re-run the landing base preflight/repair in case the parent base disappeared during landing.
7. Fetch the latest remote effective base and prove that fetched commit is an ancestor of `HEAD`.
8. If the proof reports a stale head, retry `syncRepo` + branch restack + proof once.
9. Call `provider.submitBranch(...)` only after freshness is proven.

### Key Decisions

1. **Provider-boundary sync:** Use `provider.syncRepo(...)` for `git-spice repo sync`; do not add git-spice argv literals outside the adapter.
2. **Remote proof via existing base-repair primitives:** Use `fetchRemoteBranchHeadCommit(...)`, `resolveRefCommit(...)`, and `isAncestor(...)` from `base-repair.ts` to prove the fetched remote effective base commit is contained in `HEAD`.
3. **Retry only stale ancestry results:** Retry when the fetched remote base is not an ancestor of `HEAD`. Fail immediately for fetch/query failures or unresolved `HEAD` because eforge cannot prove freshness.
4. **Cleanup remains single-shot:** Cleanup runs once before the first branch restack; stale-base retries run only sync/restack/freshness.
5. **Maintainability cap:** Move the current landing base-decision/preflight helpers out of `landing.ts` so the landing module remains under the 600-line cap after adding the new flow.

## Scope

### In Scope

- Stacked `landing.action: pr` flow in `executeStackLanding(...)`.
- `git-spice repo sync` provider event before branch restack and submit.
- Post-restack remote effective-base ancestor proof against `HEAD`.
- One bounded stale-base retry of sync/restack/freshness before failing.
- Failed `stack:landing:update` persistence for sync, restack, and freshness failures.
- Provider-command event forwarding for sync, restack, and freshness-proof failures when command metadata is available.
- Preservation of recoverable restack conflict recovery and non-recoverable restack failure behavior.
- Targeted stack landing runtime tests and helper fixtures.
- Documentation updates for architecture and stacking docs.

### Out of Scope

- Direct non-stacked PR base-sync changes.
- Manual `eforge stack sync` behavior changes.
- Whole-stack restack during landing.
- Plugin, Pi package, daemon route, or client API changes.
- Database migrations.

## Files

### Create

- `packages/engine/src/stacking/landing-base.ts` — Internal landing base-decision, preflight/repair, metadata, and freshness-proof helpers extracted from `landing.ts` plus a new remote-base freshness check result type.
- `test/stack-runtime-landing-freshness.test.ts` — Focused tests for sync failure, stale-base retry success, and stale-base retry exhaustion.

### Modify

- `packages/engine/src/stacking/landing.ts` — Import extracted base helpers, call `provider.syncRepo(...)` after preflight and before tracking, wrap branch restack/final preflight/freshness in a bounded retry loop, skip submit on sync/restack/freshness failure, and keep recovery behavior for provider-classified restack conflicts.
- `test/stack-runtime-landing-helpers.ts` — Add reusable local-git fixtures for a remote `origin/main`, an artifact branch containing the remote base, and helper utilities to advance the remote base in freshness tests.
- `test/stack-runtime-landing-pr.test.ts` — Update provider-call and event-order expectations to include `repo sync` before `branch restack` and `branch submit`.
- `test/stack-runtime-landing-failures.test.ts` — Add/update fail-closed assertions for `syncRepo` failure, restack failure command counts, recoverable conflict success after freshness proof, and submit skipping after non-recoverable restack failures.
- `test/stack-runtime-landing-metadata-preflight.test.ts` — Seed remote-base git fixtures for successful PR landing tests and update preflight repair command-order assertions to include `repo sync`.
- `test/stack-runtime-landing-auto-merge.test.ts` — Seed remote-base git fixtures before successful stacked PR landing and auto-merge assertions.
- `test/stack-runtime-landing-url-persistence.test.ts` — Seed remote-base git fixtures so URL persistence tests reach submit after freshness proof.
- `test/stack-runtime-landing-provenance.test.ts` — Add local remote setup for metadata/provenance landing tests so freshness proof passes before `gh pr edit`.
- `test/stack-landing-cleanup.test.ts` — Seed a local remote-base repo for cleanup tests and update provider ordering comments/assertions for the new `repo sync` event.
- `test/artifact-finalization.test.ts` — Ensure stacked finalization fixtures have `origin/main` so stack landing freshness proof passes before artifact finalization assertions.
- `docs/architecture.md` — Replace the current statement that stacked PR landing lacks direct PR base sync with the new provider sync + freshness proof behavior.
- `docs/stacking.md` — Document automatic landing-time sync/freshness and contrast it with manual `eforge stack sync` whole-stack maintenance.

## Implementation Notes

- Keep `StackLandingBaseMetadata` available from `landing.ts` for the existing `metadataFactory` option by re-exporting or importing the extracted type.
- The freshness helper must fetch the configured remote (`stackContext.trunkRemote ?? 'origin'`) for `baseDecision.effectiveBaseBranch`, resolve `HEAD`, then call `isAncestor(mergeWorktreePath, fetchedBaseSha, headSha)`.
- The failure reason for retry exhaustion must include the remote/base branch and enough commit context to identify that the fetched base is not an ancestor of `HEAD`.
- Use `stackProviderCommandEventFromError(...)` for sync, restack, and freshness-proof failures when the thrown error carries command metadata.
- Do not repeat cleanup on stale-base retries.
- Do not call `provider.submitBranch(...)` until the freshness helper returns `kind: 'fresh'`.
- Keep `provider.submitBranch(...)` error handling unchanged after the freshness gate.

## Verification

- [ ] `executeStackLanding(...)` emits a `stack:provider:command` with `args: ['repo', 'sync']` before the first `args: ['branch', 'restack']` and before `args` containing `submit`.
- [ ] A `syncRepo` throwing fixture emits `stack:landing:update` with `status: 'failed'`, persists `landing.status === 'failed'`, and leaves the `submitBranch` call count at `0`.
- [ ] A freshness-proof command failure fixture carrying command metadata emits a `stack:provider:command` event before a failed `stack:landing:update` and leaves the `submitBranch` call count at `0`.
- [ ] A fixture where `origin/main` advances after the first restack calls `syncRepo` at least twice, calls `restackBranch` at least twice, and emits `stack:landing:update` with `status: 'complete'` after `git merge-base --is-ancestor <advanced-main> HEAD` exits `0`.
- [ ] A fixture where `origin/main` remains ahead after all attempts emits `stack:landing:update` with `status: 'failed'` and leaves the `submitBranch` call count at `0`.
- [ ] Recoverable restack conflict recovery emits `stack:landing:conflict:recovery:complete`, then submits the branch after freshness proof passes.
- [ ] Non-recoverable restack failure emits `stack:landing:update` with `status: 'failed'` and leaves the `submitBranch` call count at `0`.
- [ ] `docs/architecture.md` states that stacked PR landing runs provider repo sync, branch restack, and remote-base freshness proof before submit.
- [ ] `docs/stacking.md` distinguishes automatic landing-time sync/freshness from manual `eforge stack sync`.
- [ ] `pnpm maintainability:check` exits `0`.
- [ ] `pnpm type-check` exits `0`.
- [ ] `pnpm test -- stack-runtime-landing` exits `0`.
