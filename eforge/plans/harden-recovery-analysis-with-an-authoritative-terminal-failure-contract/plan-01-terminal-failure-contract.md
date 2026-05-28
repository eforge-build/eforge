---
id: plan-01-terminal-failure-contract
name: Authoritative Terminal Failure Contract and Recovery Precedence
branch: harden-recovery-analysis-with-an-authoritative-terminal-failure-contract/plan-01-terminal-failure-contract
agents:
  builder:
    effort: high
    rationale: Cross-cutting schema, engine emission, DB recovery synthesis, and
      maintainability line-ceiling constraints require careful coordination
      without broad rewrites.
  reviewer:
    effort: high
    rationale: Review must verify event contract compatibility, fallback precedence,
      partial semantics, and line-ceiling compliance across oversized legacy
      files.
  tester:
    effort: high
    rationale: Regression coverage needs synthetic monitor DB histories plus live
      event emission checks for terminal failure precedence.
---

# Authoritative Terminal Failure Contract and Recovery Precedence

## Architecture Context

Recovery summaries are reconstructed from monitor DB event history when a queued build fails. The current heuristic can select an old errored `agent:stop` even after that plan later completed/merged and post-merge validation passed. The durable fix is to add a typed run-level terminal failure event, emit it once when the engine finalizes a failed build phase, and make recovery prefer that authoritative event before using legacy inference.

Project constraints:

- Event schemas live in `packages/client/src/events.schemas.ts`; engine types re-export client types.
- Active-run monitor recording persists all run-correlated events, so a new build terminal event emitted before `phase:end` will be present in `monitor.db` for recovery.
- Oversized baseline files (`packages/engine/src/eforge.ts`, `packages/client/src/events.schemas.ts`, `packages/client/src/event-registry.ts`, `packages/engine/src/orchestrator/phases.ts`, `test/recovery.test.ts`) must not grow beyond their current `noGrowthCeiling`. Use helper extraction and line-neutral edits in these files.
- Keep old-run reconstruction available, but mark it inferred with `partial: true` and `authoritative: false`.

## Implementation

### Overview

Add a `build:terminal-failure` event carrying a typed terminal failure envelope with the required scope taxonomy. Update `EforgeEngine.build()` to track terminal failure evidence while draining orchestrator events and emit exactly one authoritative event before the failed `phase:end`. Update recovery synthesis so it first maps the authoritative event into `BuildFailureSummary`, then falls back to legacy event inference. In fallback inference, add landing/artifact detection before the stale `agent:stop` fallback, reconstruct current plan statuses, and ignore errored agent stops superseded by later `completed`/`merged` plan state.

### Key Decisions

1. Use event type `build:terminal-failure` with a nested `failure` envelope.
   - Rationale: the event is run-level and not tied to a real plan; a nested envelope is reusable for summary mapping and future consumers.

2. Define `TerminalFailureScopeSchema` in `packages/client/src/events.schemas.ts` with exactly these literals: `plan`, `post-merge-validation`, `prd-validation`, `acceptance-validation`, `landing`, `artifact-recording`, `daemon`, `compile`, `unknown`.
   - Rationale: this matches the observed failure classes and prevents collapsing distinct validation gates.

3. Preserve `BuildFailureSummary.terminalFailure.stage` and `eventType`, while adding optional `scope`, `message`, `authoritative`, `sourceEventId`, `sourceEventType`, `planId`, and pass/fail evidence fields.
   - Rationale: existing sidecar/UI consumers can keep reading `stage`, while new consumers can read the authoritative contract.

4. Emit the authoritative terminal event from `EforgeEngine.build()` immediately before the failed `phase:end` event.
   - Rationale: `build()` already observes the full orchestrator stream and final `{ status, summary }`; this avoids adding another state store.

5. Implement runtime failure tracking in a new helper file instead of expanding `eforge.ts`.
   - Rationale: `eforge.ts` is over 1,000 lines and has a no-growth ceiling.

6. Add new regression test files instead of growing `test/recovery.test.ts` for large fixtures.
   - Rationale: `test/recovery.test.ts` also has a no-growth ceiling; only make line-neutral edits there for changed partial expectations if existing assertions conflict.

## Scope

### In Scope

- Shared terminal failure scope/envelope schemas and exported TypeScript types.
- `build:terminal-failure` event schema and event-registry entry.
- Runtime terminal failure tracking and single authoritative event emission for failed builds.
- Recovery mapping that prefers the authoritative event.
- Legacy fallback inference for artifact-recording, landing, post-merge validation, PRD validation, acceptance validation, and stale agent-stop supersession.
- Partial propagation from `synthesizeFromEvents()` through `buildFailureSummary()`.
- Sidecar Markdown/JSON rendering for scope/stage, message, landing status, validation commands, and partial summary evidence.
- Regression tests for authoritative precedence, old-run fallback, observed artifact-recording sequence, scope taxonomy, and non-plan `failingPlans` behavior.

### Out of Scope

- Monitor DB schema migrations.
- Replacing monitor event recording or run status storage.
- Console UI recovery screen redesign.
- Queue apply-recovery semantic changes beyond consuming improved summary fields.
- New landing workflows or artifact registry behavior not required for terminal failure diagnosis.

## Files

### Create

- `packages/engine/src/terminal-failure.ts` — runtime helpers to classify observed build events, retain the latest terminal failure evidence, and produce a `build:terminal-failure` event with `authoritative: true`.
- `packages/engine/src/recovery/terminal-failure-history.ts` — monitor DB reconstruction helpers for authoritative terminal event lookup, current plan-status reconstruction, validation command extraction, landing extraction, fallback artifact/landing detection, and stale agent-stop filtering.
- `packages/client/src/__tests__/terminal-failure-event.test.ts` — schema and registry tests for `TerminalFailureScopeSchema`, `build:terminal-failure`, and exported parsing behavior.
- `test/recovery-terminal-failure.test.ts` — recovery regression tests with synthetic monitor DB fixtures for authoritative precedence and legacy fallback artifact-recording diagnosis.

### Modify

- `packages/client/src/events.schemas.ts` — add terminal failure scope/envelope schemas, export derived types, extend `BuildFailureSummary.terminalFailure`, and add the `build:terminal-failure` event variant. Keep net line count at or below the baseline by reusing schema constants and condensing nearby inline object definitions where needed.
- `packages/client/src/events.ts` — re-export terminal failure types and schemas.
- `packages/client/src/index.ts` — re-export terminal failure types/schemas from the client package.
- `packages/client/src/browser.ts` — re-export terminal failure types/schemas if the browser barrel mirrors the main event exports.
- `packages/client/src/event-registry.ts` — register `build:terminal-failure` as a session-scoped event with a concise summary. Keep net line count at or below baseline.
- `packages/engine/src/events.ts` — re-export terminal failure types/schemas for engine imports.
- `packages/engine/src/eforge.ts` — instantiate the terminal failure tracker in `build()`, feed it observed orchestrator events, and emit one `build:terminal-failure` event before failed `phase:end`. Use line-neutral edits by replacing existing repeated status/summary classification blocks with helper calls where practical.
- `packages/engine/src/recovery/event-history.ts` — prefer authoritative terminal events; otherwise call helper functions for legacy inference. Add artifact-recording/landing/post-merge-validation branches before `agent:stop`, and ignore stale agent stops for plans later marked `completed` or `merged`.
- `packages/engine/src/recovery/failure-summary.ts` — preserve `eventFragment.partial === true` instead of only setting `partial` when no fragment exists.
- `packages/engine/src/recovery/sidecar.ts` — render terminal failure `scope` and `message` when present, and render a Markdown partial-summary warning when `summary.partial === true` even if the verdict is not partial.
- `packages/engine/src/recovery/recommendation.ts` — confirm non-plan terminal failures with no real `failingPlans` remain deterministic `manual`; adjust only if a new synthetic failing plan would otherwise be misclassified.
- `test/recovery.test.ts` — make minimal line-neutral assertion updates for new partial propagation, if existing tests expect monitor-DB fallback summaries to omit `partial`.
- `test/recovery-recommendation.test.ts` — add or adjust a compact test only if recommendation behavior changes for non-plan terminal failures.
- `test/stack-artifact-recording.test.ts` — add a compact assertion only if `recordArtifact()` fixture coverage is needed for the new terminal failure tracker; prefer `test/recovery-terminal-failure.test.ts` for larger fixtures.

## Implementation Details

### Terminal failure envelope

Define the shared envelope with these fields:

- `scope`: required enum with `plan | post-merge-validation | prd-validation | acceptance-validation | landing | artifact-recording | daemon | compile | unknown`.
- `message`: required string.
- `authoritative`: required boolean.
- `sourceEventType`: optional string.
- `sourceEventId`: optional integer for DB reconstruction.
- `sourceEventTimestamp`: optional string for live event provenance.
- `planId`: optional string; set only for genuine current plan-scoped failures.
- `phaseSummary` and `phaseStatus`: optional strings.
- `landing`: optional object with `status`, `action`, `reason`.
- `validationPassed`, `prdValidationPassed`, `acceptanceValidationPassed`: optional booleans.

`build:terminal-failure` must include `runId` plus `failure: TerminalFailureEnvelope`.

### Runtime tracking

In `packages/engine/src/terminal-failure.ts`, expose a helper such as:

- `createBuildTerminalFailureTracker(runId: string)` or a small class.
- `observe(event: EforgeEvent): void` to update evidence from:
  - `plan:build:failed` → `scope: plan`, `planId`, `message: event.error`.
  - `validation:complete` with `passed: false` → `scope: post-merge-validation`.
  - `prd_validation:complete` with `passed: false` → `scope: prd-validation`.
  - `acceptance_validation:complete` with failed/unknown evidence → `scope: acceptance-validation`.
  - `daemon:error` with `source: stack:artifact-recording` → `scope: artifact-recording`.
  - other `daemon:error` → `scope: daemon` unless a more precise terminal event follows.
  - `landing:skipped` after a failed status or landing-related summary → enrich `landing` and, when no more precise artifact/validation evidence exists, use `scope: landing`.
  - `stack:landing:update` with `status: failed` → `scope: landing`.
- `toEvent(status, summary): EforgeEvent | undefined` to emit only for failed builds and only once.

Use precedence so `artifact-recording` and `landing` can supersede earlier plan/agent evidence when they occur later in the build stream.

### Recovery synthesis precedence

In `synthesizeFromEvents()`:

1. Locate the latest failed `phase:end` for the run.
2. Query `build:terminal-failure` rows for the run at or before that phase end; if present, map the latest one into a `BuildFailureSummary` fragment with `partial` omitted or `false`, and `terminalFailure.authoritative: true`.
3. Reconstruct current plans from latest `plan:status:change`, `plan:error:*`, `plan:merge:complete`, and test/tool-use rows for both authoritative and fallback paths.
4. If no authoritative event exists, run fallback inference and set `partial: true` plus `terminalFailure.authoritative: false`.
5. Fallback precedence before agent-stop:
   - failed post-merge validation (`validation:complete passed=false`) → `scope/stage: post-merge-validation`.
   - failed PRD validation → `prd-validation`.
   - failed acceptance validation with clean PRD validation → `acceptance-validation`.
   - `daemon:error source=stack:artifact-recording` → `artifact-recording`, message from the daemon error, include latest validation command results and landing evidence.
   - failed/skipped landing evidence from `landing:skipped` or `stack:landing:update` → `landing` when validation gates passed and phase failed at landing.
   - stale-agent fallback only after filtering out any plan whose latest status is `completed` or `merged` after the errored `agent:stop`.
6. If all errored agent stops are superseded and no precise fallback exists, return an `unknown` terminal failure fragment using the failed phase summary instead of reviving stale plan failure evidence.

### Summary mapping rules

- For non-plan terminal failures, set `failingPlan.planId` to a synthetic compatibility ID matching the scope, such as `artifact-recording` or `landing`.
- Do not add synthetic non-plan entries to `failingPlans`.
- Populate `failingPlans` only from real current failed/blocked plan statuses or genuine plan-scoped terminal failures.
- Preserve successful plan states in `plans` so completed/merged evidence appears in sidecars.
- Include final validation command rows for the final validation attempt when the terminal failure occurs after validation.
- Include `landing.status: skipped` when `landing:skipped` exists.

## Verification

- [ ] `safeParseEforgeEvent()` accepts a `build:terminal-failure` event for every required scope literal and rejects a scope outside the required enum.
- [ ] `eventRegistry['build:terminal-failure']` exists and returns a summary containing the terminal failure scope.
- [ ] A failed `EforgeEngine.build()` event stream contains exactly one `build:terminal-failure` event before the failed `phase:end` event.
- [ ] `buildFailureSummary()` maps an authoritative `build:terminal-failure` event to `summary.terminalFailure.authoritative === true` and ignores an older misleading `agent:stop` error.
- [ ] Legacy fallback without a `build:terminal-failure` event returns `summary.partial === true` and `summary.terminalFailure.authoritative === false`.
- [ ] The observed sequence fixture returns `summary.terminalFailure.stage` or `scope` equal to `artifact-recording`, includes the daemon artifact-recording message, includes final validation command successes, includes `landing.status === 'skipped'`, and leaves `failingPlans` empty.
- [ ] A stale errored `agent:stop` for a plan later marked `completed` or `merged` is absent from `summary.failingPlan` and `summary.failingPlans`.
- [ ] Fallback taxonomy tests produce distinct stages/scopes for `post-merge-validation`, `prd-validation`, and `acceptance-validation`.
- [ ] Recovery sidecar Markdown contains `Terminal Failure`, the artifact-recording scope/stage, the terminal message, and `Landing Status` for the artifact-recording fixture.
- [ ] `pnpm exec vitest run packages/client/src/__tests__/terminal-failure-event.test.ts test/recovery-terminal-failure.test.ts test/recovery.test.ts test/recovery-recommendation.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

## Database Migration

No migration. The new terminal failure record is stored as a normal event row in the existing `events` table.