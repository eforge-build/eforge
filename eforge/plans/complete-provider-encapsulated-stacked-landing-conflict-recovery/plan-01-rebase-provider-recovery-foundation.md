---
id: plan-01-rebase-provider-recovery-foundation
name: Rebase Provider Recovery Foundation
branch: complete-provider-encapsulated-stacked-landing-conflict-recovery/plan-01-rebase-provider-recovery-foundation
agents:
  builder:
    effort: high
    rationale: Ports the prior provider-neutral recovery foundation onto the current
      main branch, adds provider APIs, subprocess-backed git-spice methods, new
      event variants, and focused tests while avoiding stale branch changes.
  reviewer:
    effort: high
    rationale: Provider API and event-schema changes need careful review for
      provider encapsulation, wire compatibility, and fixed-argv subprocess
      handling.
---

# Rebase Provider Recovery Foundation

## Architecture Context

The current working branch is based on current `main` and does not contain the prior foundation commit `edfda088c303f732404c5046ee7c03a6abc5879d`. That old branch is stale relative to current `main`; `git diff main..eforge/provider-encapsulated-stacked-landing-conflict-recovery` includes many unrelated deletions from features that landed after the old branch point. Rebase only the provider-recovery foundation concepts and code paths onto the current tree. Do not cherry-pick the full old branch.

This plan restores the provider-neutral boundary, git-spice implementation, recovery helper, lifecycle events, and focused tests. Plan 2 wires the helper into `executeStackLanding` and updates user-facing docs.

## Recorded Finding

See [`foundation-failure-investigation.md`](foundation-failure-investigation.md) for the investigation record. The original foundation failure was caused by an evaluator run that produced no verdicts while review-fixer changes remained uncommitted; after the successor rebase, no remaining foundation defect was found.

## Implementation

### Overview

Add provider-neutral interrupted-operation types and optional adapter methods, implement those methods in `GitSpiceAdapter`, create shared provider-command event helpers, create the landing conflict recovery helper, register new recovery lifecycle events, and add targeted tests.

### Key Decisions

1. `executeStackLanding` and recovery orchestration call provider-neutral methods only: `classifyError`, `getInterruptedOperation`, `continueInterruptedOperation`, and `abortInterruptedOperation`. Only `GitSpiceAdapter` owns git-spice continue/abort argv.
2. New recovery adapter methods remain optional on `StackProviderAdapter`; recovery only runs when the provider classifies the error as a recoverable conflict and exposes the required methods.
3. `landing-conflict-recovery.ts` owns engine policy: deterministic marker-only conflict cleanup first, existing `MergeResolver` fallback second, unmerged-file verification before provider continuation, bounded attempts, optional validation after continuation, and provider abort on active-operation failure.
4. Add lifecycle events because `stack:provider:command` records subprocesses but not recovery policy stages.
5. When porting from `edfda088`, remove temporary `plan-01-provider-recovery-foundation` region markers. Use durable semantic region markers only where the maintainability policy requires markers in large files.

## Scope

### In Scope

- Confirm the prior plan-01 failure marker by inspecting the old plan artifacts/commit and running the targeted foundation tests after rebasing; record in the build summary whether a reproducible foundation defect was found.
- Provider-neutral recovery types and optional methods on `StackProviderAdapter`.
- Git-spice classification for recoverable `branch restack` conflicts, plus tooling/auth/network/provider/unknown failure classification.
- Git-spice interrupted-operation discovery from git state.
- Git-spice provider-owned continue and abort methods returning `ProviderCommandResult`.
- Shared `stack:provider:command` event helpers for successful provider results and provider command errors.
- `recoverLandingConflict(...)` helper with deterministic temporary plan-ID marker conflict handling, merge resolver fallback, unmerged-file verification, bounded retries, validation events, and provider abort.
- Recovery lifecycle event schemas, event registry entries, monitor/console ignored-event exhaustiveness updates, and wire-parity tests.
- Focused provider and recovery-helper tests.

### Out of Scope

- Calling `recoverLandingConflict` from `executeStackLanding`.
- Non-stacked `landing.action: pr` behavior.
- Stack sync recovery behavior.
- Additional stack providers.
- Queue recovery analyst changes.

## Files

### Create

- `packages/engine/src/stacking/provider-events.ts` — shared helpers to convert `ProviderCommandResult` and provider command errors into redacted `stack:provider:command` events.
- `packages/engine/src/stacking/landing-conflict-recovery.ts` — async-generator recovery helper and `LandingConflictRecoveryOptions` / `LandingConflictRecoveryResult` types.
- `test/landing-conflict-recovery.test.ts` — focused tests for deterministic marker cleanup, merge resolver fallback, unmerged-file gating, abort, bounded attempts, and post-recovery validation.

### Modify

- `packages/engine/src/stacking/provider.ts` — add `StackProviderErrorKind`, `StackProviderOperationKind`, `StackProviderConflictKind`, `StackProviderErrorClassification`, `StackProviderInterruptedOperation`, and optional recovery methods.
- `packages/engine/src/stacking/git-spice.ts` — add conflict/auth/network/tooling classification, interrupted operation discovery, and `rebase continue` / `rebase abort` provider-owned methods using fixed argv through existing `run(...)`.
- `packages/engine/src/stacking/index.ts` — export provider recovery types, `recoverLandingConflict`, recovery result/options types, and provider command helpers only when useful to tests or plan 2.
- `packages/client/src/events.schemas.ts` — add `stack:landing:conflict:detected`, `stack:landing:conflict:recovery:start`, `stack:landing:conflict:recovery:complete`, and `stack:landing:conflict:recovery:failed` variants plus provider operation/conflict kind schemas.
- `packages/client/src/event-registry.ts` — add persisted session registry entries and summaries for the four recovery lifecycle events without exceeding the no-growth ceiling.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — add the new stack recovery events to the ignored list unless the implementation adds a dedicated reducer.
- `packages/monitor-ui/src/lib/reducer/index.ts` — add the new stack recovery events to the ignored list unless the implementation adds a dedicated reducer.
- `test/git-spice-provider.test.ts` — add classification and continue/abort argv coverage.
- `test/stack-events.test.ts` — add schema acceptance/rejection coverage for the new recovery lifecycle events.
- `packages/client/src/__tests__/events-wire-parity.test.ts` — add representative valid and invalid payloads for new recovery events.
- `packages/client/src/__tests__/events-schemas.test.ts` — add spot checks for new recovery events if the existing generated-style coverage does not already cover them.

## Implementation Notes

- Use `git show edfda088c303f732404c5046ee7c03a6abc5879d:<path>` only as a reference for relevant files. Do not merge unrelated changes from `eforge/provider-encapsulated-stacked-landing-conflict-recovery`.
- `GitSpiceAdapter.classifyError(cwd, err)` must classify `GitSpiceNotAvailableError` as `tooling` and `GitSpiceCommandError` from `['branch', 'restack']` as `recoverable-conflict` only when diagnostics mention conflict/rebase continuation or `git diff --name-only --diff-filter=U` reports unmerged files.
- Auth-like diagnostics must classify as `auth`; network-like diagnostics must classify as `network`; generic restack errors without unmerged paths must not classify as `recoverable-conflict`.
- `getInterruptedOperation(...)` must return `undefined` when there are no unmerged files. When active, it reads `git branch --show-current`, `git diff --name-only --diff-filter=U`, and `git diff`.
- `recoverLandingConflict(...)` must emit `stack:landing:conflict:detected` once operation details are available, emit `stack:landing:conflict:recovery:start` for each attempt, emit `stack:provider:command` for provider continue/abort results, emit complete/failed lifecycle events, and return a `LandingConflictRecoveryResult` as the async-generator return value.
- The helper must verify `git diff --name-only --diff-filter=U` is empty before calling `provider.continueInterruptedOperation(...)`.
- If deterministic cleanup changes files, stage them with `git add -- <changedFiles>` through `retryOnLock` before checking unmerged files again.
- If deterministic cleanup leaves unmerged files and `mergeResolver` is present, adapt to `MergeConflictInfo` with `stackContext.branch`, `stackContext.baseBranch ?? 'main'`, unmerged file names, and provider conflict diff.
- If recovery fails while an interrupted operation is active and `provider.abortInterruptedOperation` exists, call it and include abort attempted/succeeded state in the failed event and returned result.
- If post-recovery validation fails after provider continuation finished, return failure with `abortAttempted: false` because no interrupted operation remains active.

## Verification

- [ ] `pnpm exec vitest run test/git-spice-provider.test.ts` includes a `GitSpiceAdapter.classifyError` case returning `recoverable-conflict` for `branch restack` conflict diagnostics.
- [ ] `pnpm exec vitest run test/git-spice-provider.test.ts` includes a `GitSpiceAdapter.classifyError` case returning `recoverable-conflict` for `branch restack` when unmerged files exist.
- [ ] `pnpm exec vitest run test/git-spice-provider.test.ts` includes a generic restack error case that does not return `recoverable-conflict` when unmerged files are absent.
- [ ] `pnpm exec vitest run test/git-spice-provider.test.ts` proves `continueInterruptedOperation` returns args `['rebase', 'continue']` and `abortInterruptedOperation` returns args `['rebase', 'abort']`.
- [ ] `pnpm exec vitest run test/landing-conflict-recovery.test.ts` proves a temporary plan-ID marker-only conflict reaches provider continue with zero merge resolver calls.
- [ ] `pnpm exec vitest run test/landing-conflict-recovery.test.ts` proves the merge resolver fallback runs when deterministic cleanup leaves unmerged files.
- [ ] `pnpm exec vitest run test/landing-conflict-recovery.test.ts` proves provider continue is not called while `git diff --name-only --diff-filter=U` reports files.
- [ ] `pnpm exec vitest run test/landing-conflict-recovery.test.ts` proves failed recovery calls provider abort when abort is exposed and an interrupted operation remains active.
- [ ] `pnpm exec vitest run test/landing-conflict-recovery.test.ts` proves attempts stop at the configured max attempt count.
- [ ] `pnpm exec vitest run test/stack-events.test.ts packages/client/src/__tests__/events-wire-parity.test.ts` accepts valid new recovery lifecycle events and rejects payloads missing required identifiers.
- [ ] `pnpm maintainability:check` exits 0 with no temporary `plan-01-provider-recovery-foundation` marker lines in source.