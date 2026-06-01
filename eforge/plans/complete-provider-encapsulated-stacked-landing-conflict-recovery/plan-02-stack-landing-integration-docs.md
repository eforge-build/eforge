---
id: plan-02-stack-landing-integration-docs
name: Stack Landing Integration and Documentation
branch: complete-provider-encapsulated-stacked-landing-conflict-recovery/plan-02-stack-landing-integration-docs
agents:
  builder:
    effort: high
    rationale: Integrates the provider recovery helper into stacked landing while
      preserving non-recoverable failure semantics, state persistence,
      validation behavior, and documentation updates.
  reviewer:
    effort: high
    rationale: Landing state transitions, provider encapsulation, and docs/reference
      generation need close review to avoid regressions in stacked and
      non-stacked PR landing.
---

# Stack Landing Integration and Documentation

## Architecture Context

Plan 1 provides the provider-neutral recovery boundary and recovery helper. This plan wires that helper into the stacked `landing.action: pr` path around `provider.restackBranch(...)`, passes the existing merge resolver and validation command context from the orchestrator phase, updates docs, and regenerates reference artifacts.

`executeStackLanding` remains provider-agnostic. It may ask the adapter to classify a failure, delegate to `recoverLandingConflict`, and decide whether to submit or fail landing state. It must not call git-spice continue/abort commands or hard-code git-spice argv.

## Implementation

### Overview

When `provider.restackBranch` fails, emit the existing provider command failure event, classify the provider error, and attempt recovery only for provider-classified recoverable conflicts. On successful recovery, continue to `provider.submitBranch`. On failed recovery, persist failed stack layer landing state with an actionable recovery reason. Non-recoverable restack failures keep the existing failed landing path.

### Key Decisions

1. Recovery is attempted only when `classification.kind === 'recoverable-conflict'`, `classification.recoverable === true`, and the provider exposes the recovery methods required by the helper.
2. The original failed restack provider command event remains visible before recovery lifecycle events.
3. Successful recovery does not persist a terminal landing state. The existing submit success path remains the only path that writes `landing.status: 'complete'` and layer `status: 'landed'`.
4. Failed recovery writes the same durable failed landing state shape as existing restack failures, with a reason prefixed by `Restack conflict recovery failed:` and including abort outcome text when abort ran.
5. Post-recovery validation runs before `submitBranch` only when validation commands are available from the phase context.

## Scope

### In Scope

- Add recovery-related options to `StackLandingOptions`.
- Integrate `recoverLandingConflict` in the `provider.restackBranch` catch block.
- Capture async-generator return values from the recovery helper while yielding every recovery event.
- Pass `ctx.mergeResolver`, deduplicated post-merge/validation commands, `ctx.postMergeCommandTimeoutMs`, and `ctx.signal` from `stackLanding(ctx)` into `executeStackLanding`.
- Preserve existing failed landing behavior for non-recoverable restack failures.
- Preserve submit and auto-merge behavior after successful recovery.
- Add `test/stack-runtime-landing.test.ts` coverage for successful recovery, failed recovery, non-recoverable restack failure, and validation failure after recovery while respecting its no-growth ceiling.
- Update stacked PR and troubleshooting documentation, plus Claude Code/Pi stack skill guidance where they describe manual conflict recovery.
- Regenerate documentation/reference artifacts after event schema and doc source changes.

### Out of Scope

- Provider recovery during `eforge stack sync`.
- Non-stacked `landing.action: pr` changes.
- Queue recovery analyst changes.
- Additional stack providers.
- Broad daemon HTTP API changes unrelated to the event schema/reference update.

## Files

### Create

- None expected. If the existing `test/stack-runtime-landing.test.ts` cannot stay at or below the no-growth ceiling after shrinkage, create a small helper fixture file only; the recovery success and failure assertions must remain in `test/stack-runtime-landing.test.ts` to satisfy the source requirement.

### Modify

- `packages/engine/src/stacking/landing.ts` — import `recoverLandingConflict`, add recovery options, replace local provider event helpers with shared helpers when plan 1 created them, classify restack failures, consume the recovery helper, persist failed recovery state, and proceed to submit only after successful recovery.
- `packages/engine/src/orchestrator/phases.ts` — pass the merge resolver, validation commands, timeout, and abort signal into `executeStackLanding` from `stackLanding(ctx)` without disturbing artifact metadata update behavior already present on current main.
- `test/stack-runtime-landing.test.ts` — update stubs for optional recovery methods; add success/failure recovery assertions; retain non-recoverable restack failure coverage; shrink redundant existing assertions enough to remain at or below `scripts/agent-maintainability-baseline.json` ceiling 1302.
- `web/content/docs/stacking.md` — mention automatic provider-encapsulated recovery for recoverable stacked PR landing restack conflicts, including deterministic temporary plan-ID marker cleanup before resolver fallback.
- `web/content/docs/troubleshooting.md` — distinguish automatic stacked landing recovery from manual `eforge stack sync` conflict recovery.
- `docs/stacking.md` — mirror the stacked landing recovery semantics in the repository docs.
- `eforge-plugin/skills/stack/stack.md` — clarify that the manual conflict flow is for stack sync and that stacked PR landing attempts automatic provider-encapsulated recovery first.
- `eforge-plugin/.claude-plugin/plugin.json` — bump the Claude Code plugin version because the stack skill changes.
- `packages/pi-eforge/skills/eforge-stack/SKILL.md` — keep Pi stack guidance in sync with the Claude Code stack skill clarification.
- `web/content/reference/events.md` — regenerate if event docs are generated from plan 1 schema changes.
- `web/public/reference/events.md` — regenerate if event docs are generated from plan 1 schema changes.
- `web/public/schemas/events.schema.json` — regenerate after new recovery lifecycle event schemas land.
- `web/public/docs/stacking.md` — regenerate from `web/content/docs/stacking.md`.
- `web/public/docs/troubleshooting.md` — regenerate from `web/content/docs/troubleshooting.md`.
- `web/public/llms-full.txt` — regenerate if docs generation changes it.

## Implementation Notes

- Add `StackLandingOptions` fields along these lines:
  - `mergeResolver?: MergeResolver`
  - `postRecoveryValidationCommands?: string[]`
  - `validationTimeoutMs?: number`
  - `signal?: AbortSignal`
  - `maxConflictRecoveryAttempts?: number`
- In the restack catch block, use this flow:
  1. Emit `stack:provider:command` from the thrown command error when metadata is present.
  2. Call `provider.classifyError?.(mergeWorktreePath, err)` inside a guarded try/catch.
  3. If classification is absent, non-recoverable, or not `recoverable-conflict`, run the existing failed landing persistence path unchanged.
  4. If classification is recoverable, manually iterate `recoverLandingConflict(...)` so every yielded event is yielded and the final `LandingConflictRecoveryResult` return value is captured.
  5. If the result has `recovered: true`, continue to `provider.submitBranch`.
  6. If the result has `recovered: false`, persist layer `status: 'failed'` and landing `status: 'failed'` with a reason beginning `Restack conflict recovery failed:`.
- Do not use `for await` alone when the recovery result is needed; `for await` discards the async-generator return value.
- The failed-recovery reason must include abort outcome text when `abortAttempted` is true, for example `abort succeeded` or `abort failed`.
- In `stackLanding(ctx)`, compute validation commands with `Array.from(new Set([...(ctx.postMergeCommands ?? []), ...(ctx.validateCommands ?? [])]))` and pass an empty array when none exist.
- Keep auto-merge and PR metadata editing behavior unchanged after a recovered restack and successful submit.
- Keep non-PR stacked actions (`merge`, `leave`) and non-stacked PR landing behavior unchanged.
- Because this plan changes `eforge-plugin/skills/stack/stack.md`, bump `eforge-plugin/.claude-plugin/plugin.json` in the same implementation branch.

## Documentation Notes

Document these user-visible semantics:

- During stacked `landing.action: pr`, eforge attempts automatic recovery for provider-classified recoverable branch restack conflicts.
- Recovery first resolves deterministic temporary plan-ID region marker conflicts, then falls back to the merge-conflict resolver agent when deterministic cleanup leaves unmerged files.
- The provider owns continue/abort commands; orchestration records provider commands as events without hard-coding git-spice argv.
- Manual recovery remains required for non-recoverable provider failures, failed automatic recovery, and `eforge stack sync` conflicts.

## Verification

- [ ] `pnpm exec vitest run test/stack-runtime-landing.test.ts` proves a recoverable restack conflict recovery calls `provider.submitBranch` and emits a complete `stack:landing:update`.
- [ ] `pnpm exec vitest run test/stack-runtime-landing.test.ts` proves a failed restack conflict recovery does not call `provider.submitBranch`.
- [ ] `pnpm exec vitest run test/stack-runtime-landing.test.ts` proves failed recovery persists a stack layer with `status: 'failed'`, `landing.status: 'failed'`, and a reason beginning `Restack conflict recovery failed:`.
- [ ] `pnpm exec vitest run test/stack-runtime-landing.test.ts` proves non-recoverable restack failures emit no stack recovery lifecycle events and preserve the existing failed landing path.
- [ ] `pnpm exec vitest run test/stack-runtime-landing.test.ts` proves post-recovery validation failure prevents submit and persists failed landing state.
- [ ] `pnpm exec vitest run test/merge-conflict-resolver.test.ts` exits 0 after reusing `MergeResolver` for provider conflict fallback.
- [ ] `pnpm docs:check` exits 0 after `pnpm docs:generate` updates generated docs and reference artifacts.
- [ ] `pnpm maintainability:check` exits 0 with `test/stack-runtime-landing.test.ts` at or below 1302 lines.
- [ ] `git diff -- eforge-plugin/.claude-plugin/plugin.json eforge-plugin/skills/stack/stack.md` shows a plugin version bump alongside the stack skill change.