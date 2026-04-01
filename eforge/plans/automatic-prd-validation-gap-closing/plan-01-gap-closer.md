---
id: plan-01-gap-closer
name: Automatic PRD Validation Gap Closing
depends_on: []
branch: automatic-prd-validation-gap-closing/gap-closer
---

# Automatic PRD Validation Gap Closing

## Architecture Context

When PRD validation finds gaps between the PRD spec and implementation, the build fails immediately with no recovery attempt. This plan adds a single automatic gap-closing attempt using a new agent that runs inline within `prdValidate`, followed by re-validation via orchestrator sequencing. The pattern mirrors the existing `validationFixer` inline retry in the `validate` phase.

Key constraints:
- One attempt only - a `gapClosePerformed` flag prevents re-entry
- PRD validation is NOT re-run after gap closing - only post-merge validation (type-check, tests) is re-run
- Gap closing is always enabled when `prdFilePath` is provided (no separate config)
- Agent errors in gap closer are non-fatal (caught and continued, AbortError re-thrown)
- The gap closer works directly in the merge worktree

## Implementation

### Overview

Add a `gap-closer` agent (following `validation-fixer.ts` pattern), wire it through the orchestrator/phases pipeline, and handle its events in CLI display and monitor UI. The orchestrator's `execute()` method gains conditional re-validation after `prdValidate` when `gapClosePerformed` is set.

### Key Decisions

1. **Inline in `prdValidate`** - The gap closer runs inside `prdValidate()` rather than as a separate phase. It needs the gaps data from `prd_validation:complete` and is tightly coupled to PRD validation. This follows how `validate()` calls `validationFixer` inline.
2. **Re-validation via orchestrator** - After `prdValidate` sets `gapClosePerformed = true` without failing the build, the orchestrator re-runs `validate()` before `finalize()`. This reuses existing validation logic without duplication.
3. **`GapCloser` callback type on orchestrator** - Like `PrdValidator` and `ValidationFixer`, the gap closer is injected as a callback. The engine creates the closure with backend/tracing wiring.
4. **`maxTurns: 30` with `tools: 'coding'`** - Same configuration as `validation-fixer`, giving the agent enough turns to explore, fix, and commit.

## Scope

### In Scope
- New `gap-closer` agent and prompt template
- `gap_close:start` and `gap_close:complete` event types
- `'gap-closer'` added to `AgentRole` union
- `GapCloser` callback type and orchestrator wiring
- `prdValidate()` modification to call gap closer on gaps
- `gapClosePerformed` flag on `PhaseContext` for re-validation guard
- Orchestrator `execute()` conditional re-validation after `prdValidate`
- CLI display spinner handling for new events
- Monitor UI timeline event card support
- Unit test following `validation-fixer.test.ts` pattern

### Out of Scope
- Multiple gap-closing attempts
- Re-running PRD validation after gap closing
- Separate configuration toggle for gap closing
- Gap closing without PRD validation enabled

## Files

### Create
- `src/engine/agents/gap-closer.ts` - Gap closer agent: `GapCloserOptions` interface and `runGapCloser()` async generator. Follows `validation-fixer.ts` pattern. Accepts backend, cwd, gaps (`PrdValidationGap[]`), prdContent, verbose, abortController. Emits `gap_close:start`, delegates to backend with `tools: 'coding'`, `maxTurns: 30`, emits `gap_close:complete`. Non-fatal error handling (catch all except AbortError).
- `src/engine/prompts/gap-closer.md` - Prompt template with `{{prd}}`, `{{gaps}}`, `{{attribution}}` placeholders. Instructs agent to read each gap, explore relevant files, make minimal targeted changes, run validation commands, and commit all changes.
- `test/gap-closer.test.ts` - Unit test using `StubBackend` and `collectEvents()`. Tests: lifecycle events emitted in order, prompt contains gaps and PRD content, agent runs with `tools: 'coding'` and `maxTurns: 30`, non-fatal error handling, AbortError re-thrown.

### Modify
- `src/engine/events.ts` - Add `'gap-closer'` to `AgentRole` union (line 10). Add `| { type: 'gap_close:start' }` and `| { type: 'gap_close:complete' }` after `prd_validation:complete` (after line 242).
- `src/engine/orchestrator.ts` - Add `GapCloser` callback type after `PrdValidator` type (~line 52): `export type GapCloser = (cwd: string, gaps: PrdValidationGap[]) => AsyncGenerator<EforgeEvent>;`. Add `gapCloser?: GapCloser` to `OrchestratorOptions` (after line 64). Pass `gapCloser` into `PhaseContext` construction (~line 153) and initialize `gapClosePerformed: false`. Modify `execute()` (~lines 158-162): after `yield* prdValidate(ctx)`, add conditional `if ((state.status as string) !== 'failed' && ctx.gapClosePerformed) yield* validate(ctx);` before `finalize`.
- `src/engine/orchestrator/phases.ts` - Add `gapCloser?: GapCloser` and `gapClosePerformed: boolean` to `PhaseContext` interface. Modify `prdValidate()` (~lines 492-513): instead of immediately setting `state.status = 'failed'` when gaps found, check if `ctx.gapCloser` is available. If so, call gap closer via `yield* ctx.gapCloser(ctx.mergeWorktreePath, event.gaps)`, set `ctx.gapClosePerformed = true`, and do NOT fail (skip the entire failure block including `state.completedAt` and `saveState`). If no gap closer or gap closer errors, set failed as before.
- `src/engine/eforge.ts` - Import `runGapCloser` from `./agents/gap-closer.js` and `GapCloser` type. Create gap closer closure after the PRD validator closure (~line 646), gated on `options.prdFilePath` (same condition). The closure reads PRD content, creates a tracing span `'gap-closer'`, wraps `runGapCloser()` with tool tracking. Pass `gapCloser` to `Orchestrator` constructor alongside `prdValidator`.
- `src/cli/display.ts` - Add cases before the `default` exhaustive check (~line 686): `case 'gap_close:start': startSpinner('gap-close', 'Closing PRD validation gaps...'); break;` and `case 'gap_close:complete': succeedSpinner('gap-close', 'Gap closing complete'); break;`.
- `src/monitor/ui/src/components/timeline/event-card.tsx` - Add summary cases in `eventSummary()`: `case 'gap_close:start': return 'Gap closing started';` and `case 'gap_close:complete': return 'Gap closing complete';`.

## Verification

- [ ] `pnpm type-check` passes with zero errors - all exhaustive switches handle `gap_close:start` and `gap_close:complete`
- [ ] `pnpm build` succeeds (tsup bundles without errors)
- [ ] `pnpm test` passes including new `test/gap-closer.test.ts`
- [ ] `test/gap-closer.test.ts` verifies: `gap_close:start` event emitted first, `gap_close:complete` event emitted last, agent runs with `tools: 'coding'` and `maxTurns: 30`, non-fatal errors are swallowed, `AbortError` is re-thrown
- [ ] `AgentRole` union in `src/engine/events.ts` includes `'gap-closer'`
- [ ] `EforgeEvent` union includes `{ type: 'gap_close:start' }` and `{ type: 'gap_close:complete' }`
- [ ] `GapCloser` type is exported from `src/engine/orchestrator.ts` with signature `(cwd: string, gaps: PrdValidationGap[]) => AsyncGenerator<EforgeEvent>`
- [ ] `PhaseContext` in `phases.ts` has `gapCloser?: GapCloser` and `gapClosePerformed: boolean` fields
- [ ] `prdValidate()` calls gap closer when gaps are found and gap closer is available, sets `gapClosePerformed = true`
- [ ] `prdValidate()` does NOT set `state.status = 'failed'` when gap closer runs (defers to re-validation)
- [ ] Orchestrator `execute()` re-runs `validate()` after `prdValidate()` when `ctx.gapClosePerformed` is true and status is not failed
- [ ] Gap closer closure in `eforge.ts` is created only when `options.prdFilePath` is provided
- [ ] CLI display handles `gap_close:start` with spinner and `gap_close:complete` with success
- [ ] Monitor UI `eventSummary()` returns strings for `gap_close:start` and `gap_close:complete`
