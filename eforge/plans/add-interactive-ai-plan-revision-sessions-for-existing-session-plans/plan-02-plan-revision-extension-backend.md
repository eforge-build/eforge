---
id: plan-02-plan-revision-extension-backend
name: Implement eforge-plan-owned revision-session storage, action
  schemas/actions, fingerprinted context/apply orchestration, registration, and
  backend tests.
branch: add-interactive-ai-plan-revision-sessions-for-existing-session-plans/plan-revision-extension-backend
---

# Plan Revision Extension Backend

## Architecture Reference

This module implements the architecture sections **Revision session storage contract**, **Extension action contract**, **Fingerprint and result-validation contract**, **Bounded task input contract**, **Apply semantics**, and **Module: `plan-revision-extension-backend`**.

Key constraints from architecture:
- eforge-plan owns revision-session thread/index state and apply metadata under extension-private project-local storage; the daemon owns only single-shot task records.
- Reuse the existing `eforge-plan.planning-draft` task kind with `requestedOutputSections: ['planRevisionTurn']`; do not add daemon chat state or a new task kind.
- Revision tasks must use read-only daemon agent execution. Extension actions start tasks through `ctx.agentTasks`; they do not import provider SDKs or `AgentHarness`.
- Persisted task result shapes come from `@eforge-build/client`; this module imports `planRevisionTurn` schemas/types and does not re-declare daemon task result interfaces.
- Apply is explicit, section-only in V1, adapter-backed, and guarded by a full-plan base fingerprint. A stale apply writes zero session-plan sections.
- Flat session plans only. Session plan-set revision UX and child-plan coordination are outside this module.
- Keep `planner-orchestration.ts` below the 600-line implementation ceiling by adding a focused `plan-revision-orchestration.ts`.

## Scope

### In Scope
- Add extension-private revision-session storage at `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json`.
- Add schemas and TypeScript types for revision-session actions, persisted revision index entries, turn projections, and apply results.
- Add revision actions:
  - `start-plan-revision-session`
  - `list-plan-revision-sessions`
  - `get-plan-revision-session`
  - `start-plan-revision-turn`
  - `retry-plan-revision-turn`
  - `cancel-plan-revision-turn`
  - `apply-plan-revision-turn`
- Compute deterministic full-plan fingerprints and per-section hashes from adapter-loaded flat session plans.
- Build bounded plan-revision task context with current plan detail, raw existing plan markdown, readiness, source/lifecycle summaries, recent thread context, user message, and optional redraft context.
- Start one linked read-only daemon task per user message using `requestedOutputSections: ['planRevisionTurn']`.
- Persist thread turns with task ids, parent/retry/redraft linkage, base fingerprints, applied metadata, and timestamps.
- Join stored turns to owner-scoped daemon task records for list/get/start/retry/cancel projections.
- Validate completed task records, revision-turn target session, stored base fingerprint, selected dimensions, and current full-plan fingerprint before applying sections.
- Apply only selected structured patch sections through `createSessionPlanningWorkflowAdapter().flat.setSection()`, refresh readiness, and record applied section metadata.
- Register the new actions and expose them through the planning workstation `allowedActions` list.
- Add backend tests for storage fallback/ordering, action registration, start/list/get/cancel/retry/redraft, stale apply blocking, selected section apply, and zero ready/handoff/enqueue side effects.

### Out of Scope
- Shared client task contract, engine submit-tool handling, prompt changes, and monitor output-section counting. Those are owned by `client-engine-task-contract`.
- Plans tab UI, workstation hooks/components/fixtures, and generated workstation assets. Those are owned by `plan-revision-workstation`.
- README, `docs/extensions.md`, generated reference docs, and Pi/Claude consumer-surface checks. Those are owned by `docs-reference-boundary`.
- Session plan-set revision UX.
- Metadata or skipped-dimension mutation from revision patches in V1.
- Automatic `set-session-plan-ready`, `handoff-session-plan`, queue enqueueing, backlog mutation, or build execution from a revision apply.
- Generic extension chat APIs, extension-supplied prompt templates, or daemon-owned conversation memory.

## Implementation Approach

### Overview

Implement the backend in three focused layers:

1. **Schemas and storage**: Add plan-revision schemas to `planning-agent-task-schemas.ts` and a new `plan-revision-store.ts` that mirrors the atomic, missing/malformed-safe behavior of `planning-task-workflow-store.ts`.
2. **Orchestration helpers**: Add `plan-revision-orchestration.ts` for deterministic fingerprints, bounded task context construction, task-result validation, allowed-dimension checks, projection helpers, and adapter-backed section apply.
3. **Action handlers and registration**: Add `plan-revision-actions.ts`, wire it into `index.ts`, and update registration tests. Handlers call the store/orchestration helpers, use `ctx.agentTasks` for daemon records, and return JSON-safe action projections.

The store persists one active thread per flat `targetSession` in V1. `start-plan-revision-session` first loads the flat plan, then creates or resumes the thread, so a missing/non-flat target never leaves an orphan revision record. Turn-start actions serialize per `(cwd, targetSession)` with an in-process chain so two concurrent submissions cannot both pass the active-turn check before either records a turn.

### Key Decisions

1. **Create a separate revision index instead of extending the planning task workflow index.** Planning task workflow entries are selection-oriented and apply-oriented for backlog/recommendation flows. Revision threads need target-session linkage, ordered turns, base fingerprints, and applied section metadata.
2. **Use one active thread per target session for V1.** This keeps the Plans tab model simple while the persisted shape (`threadId`, `targetSession`, `turns`) remains thread-ready for future named-thread support.
3. **Hash one canonical backend projection for start and apply.** `computeFlatPlanFingerprint()` must hash `canonicalJson(projectSessionPlan(plan))`; both turn start and apply call the same helper. This avoids false stale/non-stale decisions caused by different serializers.
4. **Store full-plan fingerprints and per-section hashes.** V1 apply blocks on the full-plan fingerprint. Per-section hashes are stored and exposed for preview/debugging and future narrower conflict handling.
5. **Validate dimensions against the current flat plan before writing.** Allowed dimensions are the union of `selectDimensions(plan).required`, `selectDimensions(plan).optional`, skipped dimension names, and existing body section headings normalized to kebab-case.
6. **Return stale/not-applicable apply results instead of throwing for user-actionable revision states.** Stale current-plan fingerprints return `kind: 'stale'`; answer-only turns, needs-input tasks, missing patches, mismatched target sessions, mismatched stored fingerprints, invalid task linkage, and invalid selected sections return `kind: 'not-applicable'` with zero writes.
7. **Use `retry-plan-revision-turn` for both retry and clarification redraft.** Plain retries preserve the parent user message and set `retryOfTaskId`; clarification answers/steering require a completed top-level `needs-input` parent and set `redraftOfTaskId` plus `parentTaskId`.
8. **Keep apply section-only.** `planRevisionTurn.proposedPatch.metadata` and `skippedDimensions` are preserved in the task result and can be shown by the UI, but this module does not mutate metadata or skipped-dimension state.
9. **Do not expose new integration commands or deep links.** The action surface is for the first-party planning workstation iframe through `allowedActions`, not Pi/Claude/CLI/MCP user commands.

### Store Contract

`plan-revision-store.ts` must export these capabilities:

- `resolvePlanRevisionIndexPath(cwd)` returning `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json`.
- `readPlanRevisionIndex(cwd)` returning `{ schemaVersion: 1, sessions: [] }` for missing, invalid JSON, or schema-invalid storage; non-ENOENT filesystem errors are rethrown.
- `ensurePlanRevisionSession(cwd, targetSession, now?)` creating a thread with `crypto.randomUUID()` when none exists, or returning the existing target-session thread.
- `recordPlanRevisionTurn(cwd, targetSession, turn)` adding/replacing a turn by `turnId`/`taskId`, updating `updatedAt`, and preserving newest-first order.
- `markPlanRevisionTurnApplied(cwd, targetSession, turnRef, appliedAt, appliedSections)` recording `appliedAt` and a sorted unique `appliedSections` list.
- `findPlanRevisionSession(index, { session?, threadId? })`, `findPlanRevisionTurn(session, { turnId?, taskId? })`, and `listPlanRevisionSessions(index, { includeDismissed? })`.

Writes must be atomic via temp file + `rename()` and serialized per index path with the same write-chain pattern used by `planning-task-workflow-store.ts`. Ordering is newest-first by `updatedAt` for sessions and newest-first by `createdAt` for turns, with `threadId`/`turnId` deterministic tie-breakers.

### Action Contract Details

Add schemas in `planning-agent-task-schemas.ts` for:

- `PlanRevisionIndexSchema`, `PlanRevisionSessionEntrySchema`, `PlanRevisionTurnEntrySchema`.
- `PlanRevisionTurnProjectionSchema` with stored turn fields plus optional imported `ExtensionAgentTaskRecordSchema`, `available`, and `staleReason`.
- `PlanRevisionSessionProjectionSchema` with stored session fields, `turns`, and optional flat plan detail fields (`plan`, `readiness`, `path`, `sourceRefs`, `lifecycle`).
- Inputs/outputs for every revision action.
- `ApplyPlanRevisionTurnOutputSchema` as a union of:
  - `{ kind: 'applied', session, taskId, appliedSections, readiness, plan, path }`
  - `{ kind: 'stale', session, taskId, basePlanFingerprint, currentPlanFingerprint, message }`
  - `{ kind: 'not-applicable', session, taskId, message }`

Recommended input constraints:

- All `session`, `threadId`, `turnId`, and messages are non-empty strings.
- `start-plan-revision-turn.message` uses `MAX_PLANNING_AGENT_USER_GOAL_LENGTH` as its maximum.
- `get-plan-revision-session` accepts exactly one of `session` or `threadId` plus optional `includePlan`.
- `retry-plan-revision-turn`, `cancel-plan-revision-turn`, and `apply-plan-revision-turn` accept exactly one of `taskId` or `turnId`.
- `apply-plan-revision-turn.sections` is a non-empty unique string array and requires literal `previewAcknowledged: true` and `confirmApply: true`.
- `retry-plan-revision-turn.answers` entries are `{ questionId?: string; prompt?: string; answer: non-empty string }`.

### Orchestration Details

`plan-revision-orchestration.ts` should contain the backend-only logic that would otherwise bloat `planner-orchestration.ts`:

- `loadFlatPlanRevisionTarget(cwd, session)` loads the flat plan through `createSessionPlanningWorkflowAdapter().flat.load()`, reads raw markdown from `loaded.path`, builds source refs/lifecycle with `projectSessionPlanSourceRefs()` and `projectSessionPlanLifecycle()`, and returns `projectSessionPlanDetail()`.
- `computeFlatPlanFingerprint(plan)` hashes `canonicalJson(projectSessionPlan(plan))` with `sha256()` from `markdown-store-support.ts`.
- `computeFlatSectionHashes(plan)` returns sorted `{ dimension, sha256 }` for every allowed dimension, hashing the current content string for that dimension.
- `buildPlanRevisionSourceText(params)` uses `boundedSourceText()` and includes `purpose: 'plan-revision-turn'`, `targetSession`, `basePlanFingerprint`, `baseSectionHashes`, plan/readiness/path/sourceRefs/lifecycle, bounded recent turns, `userMessage`, and optional redraft context.
- `buildRecentRevisionTurnContext(ctx, sessionEntry, limit = 6)` joins recent stored turns to daemon task records, includes task status, assistant messages for valid `planRevisionTurn` results, needs-input questions for clarification results, and applied section metadata, and ignores missing daemon records with a stale reason.
- `resolveCompletedRevisionTurnResult(task, storedTurn, targetSession)` parses the completed planning draft result with the client result parser/schema, validates `planRevisionTurn.targetSession`, and validates `planRevisionTurn.basePlanFingerprint === storedTurn.basePlanFingerprint`.
- `validateSelectedRevisionSections(plan, turnResult, selectedSections)` checks that every selected section is present in `planRevisionTurn.proposedPatch.sections` and in the allowed flat-plan dimension set.
- `applySelectedRevisionSections(cwd, session, turnResult, sections)` calls `planning.flat.setSection()` once per selected dimension, then `planning.flat.readiness()`, then projects the updated plan with `projectSessionPlan()`.

`start-plan-revision-turn` and `retry-plan-revision-turn` must pass both:

```ts
input: {
  topic: derivedRevisionTopic,
  session,
  planningType: loaded.plan.planning_type,
  planningDepth: loaded.plan.planning_depth,
  existingSessionPlan: rawPlanMarkdown,
  sourceText,
  requestedOutputSections: ['planRevisionTurn'],
}
```

### Action Handler Details

`plan-revision-actions.ts` should:

- Define `PLAN_REVISION_REQUESTED_OUTPUT_SECTIONS = ['planRevisionTurn'] as const`.
- Use a per-session start chain to serialize `start-plan-revision-turn` and `retry-plan-revision-turn`.
- Reuse or create the target revision session before recording a turn.
- Reject a new turn when any stored turn for the session has a daemon task status of `queued` or `running`.
- Start the daemon task before writing the turn; if turn recording fails, cancel the just-started task and rethrow the storage error.
- Resolve turns by `turnId` or `taskId` from the stored session before cancel/retry/apply.
- Delegate cancel to `ctx.agentTasks.cancel(taskId, reason)` and return the refreshed session projection.
- For apply, fetch the completed daemon task, validate it, compute the current fingerprint, return `kind: 'stale'` before any write when fingerprints differ, otherwise write selected sections and mark the turn applied.
- Wrap action outputs with `toJsonSafeObject()`.

## Files

### Create
- `eforge/extensions/eforge-plan/plan-revision-store.ts` — atomic extension-private revision-session index storage with missing/malformed fallback, newest-first ordering, session/turn lookup helpers, turn recording, and applied metadata updates.
- `eforge/extensions/eforge-plan/plan-revision-orchestration.ts` — flat-plan loading/projection, lifecycle/source summary gathering, deterministic fingerprint/hash helpers, bounded task-context construction, task-result validation, allowed-dimension validation, and adapter-backed selected-section apply helpers.
- `eforge/extensions/eforge-plan/plan-revision-actions.ts` — revision action definitions and handlers for start/list/get/start-turn/retry/cancel/apply.
- `eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts` — storage path, missing storage fallback, malformed storage fallback, atomic read/write behavior, newest-first session ordering, newest-first turn ordering, and applied metadata tests.
- `eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts` — dispatch-level backend tests for revision-session actions, linked task starts, bounded source context, cancellation, retry, clarification redraft, stale apply blocking, section apply, and zero ready/handoff/enqueue side effects.

### Modify
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — add plan-revision persisted index schemas, action input/output schemas, and exported static types in a durable `// --- eforge:region plan-revision-schemas ---` block `[region: plan-revision-extension-backend, plan-revision-schemas block after existing planning task workflow schemas and before exported type list]`.
- `eforge/extensions/eforge-plan/index.ts` — import `planRevisionActions`, register them after session-plan actions, and append all implemented revision action ids to the planning workstation `allowedActions` list `[region: plan-revision-extension-backend, imports/registerAction loop/allowedActions entries]`.
- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — add revision action ids to the expected registration list, side-effect classification sets, daemon-state set, and workstation `allowedActions` assertions.

## Testing Strategy

### Unit Tests
- `plan-revision-store.test.ts`:
  - `resolvePlanRevisionIndexPath()` ends with `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json`.
  - Missing storage reads as `{ schemaVersion: 1, sessions: [] }`.
  - Invalid JSON reads as an empty index.
  - Schema-invalid JSON reads as an empty index.
  - Recording two sessions returns sessions ordered by descending `updatedAt`.
  - Recording two turns returns turns ordered by descending `createdAt`.
  - Marking a turn applied stores `appliedAt` and sorted unique `appliedSections`.
  - Re-reading after writes returns the same thread ids, task ids, fingerprints, and applied metadata.

- `plan-revision-orchestration` coverage through unit tests or action tests:
  - `computeFlatPlanFingerprint()` returns a 64-character lowercase sha256 hex string.
  - Changing a flat plan section changes the fingerprint.
  - `computeFlatSectionHashes()` includes `scope` and `acceptance-criteria` when those dimensions are selected/covered.
  - Invalid selected dimensions produce a not-applicable apply result with zero writes.

### Integration Tests
- `registration.test.ts`:
  - Registered actions include all seven revision action ids.
  - The planning workstation `allowedActions` array contains all seven revision action ids.
  - Side effects match the action contract: list/get are local-read only; start-turn/retry/cancel include daemon-state; apply includes local-read/local-write and excludes build-queue.

- `plan-revision-actions.test.ts` with `dispatchExtensionAction()` and temporary projects:
  - `start-plan-revision-session` for an existing flat `session` creates a thread and returns plan/readiness/path fields.
  - `start-plan-revision-turn` starts `eforge-plan.planning-draft` with `requestedOutputSections: ['planRevisionTurn']`, `existingSessionPlan`, current `planningType`, current `planningDepth`, and source context containing `purpose`, `targetSession`, `basePlanFingerprint`, `baseSectionHashes`, `readiness`, and `userMessage`.
  - The stored turn links the daemon task id, user message, base fingerprint, and target session thread.
  - A second turn submission while a linked task is `queued` or `running` returns a handler error and does not call `ctx.agentTasks.start()`.
  - `list-plan-revision-sessions` returns persisted thread state after a new registry load.
  - `get-plan-revision-session` joins stored turns to daemon task records and preserves missing-task stale reasons without dropping the stored turn.
  - `cancel-plan-revision-turn` resolves by `turnId` and by `taskId`, delegates to `ctx.agentTasks.cancel()`, and returns the refreshed projection.
  - Plain `retry-plan-revision-turn` starts a new linked task with `retryOfTaskId` and preserved parent user message.
  - Clarification redraft through `retry-plan-revision-turn` requires a completed top-level `needs-input` parent, includes prior questions plus user answers/steering in source context, and stores `redraftOfTaskId` plus `parentTaskId`.
  - Applying an answer-only `planRevisionTurn` returns `kind: 'not-applicable'` and leaves the markdown file unchanged.
  - Applying a patch-bearing turn after a manual plan edit returns `kind: 'stale'`, includes the target `session`, includes base/current fingerprints, and leaves the markdown file unchanged.
  - Applying a fresh patch-bearing turn with selected `['scope']` writes only the `scope` section, leaves unselected `acceptance-criteria` unchanged, refreshes readiness in the output, and records `appliedSections: ['scope']`.
  - Revision apply leaves `plan.status` unchanged, does not call `ctx.buildQueue.enqueue()`, does not invoke `handoff-session-plan`, and does not mutate backlog item status.
  - Apply with a task id not linked to the target thread, a target-session mismatch, a stored/result fingerprint mismatch, or a missing selected section returns `kind: 'not-applicable'` and leaves the markdown file unchanged.

## Verification

- [ ] `plan-revision-store.ts` resolves `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json`.
- [ ] Missing revision storage reads as an empty schema-version-1 index.
- [ ] Malformed revision storage reads as an empty schema-version-1 index.
- [ ] Revision sessions list newest-first by `updatedAt`.
- [ ] Revision turns list newest-first by `createdAt`.
- [ ] `planning-agent-task-schemas.ts` exports `StartPlanRevisionSessionInputSchema`, `ListPlanRevisionSessionsInputSchema`, `GetPlanRevisionSessionInputSchema`, `StartPlanRevisionTurnInputSchema`, `RetryPlanRevisionTurnInputSchema`, `CancelPlanRevisionTurnInputSchema`, `ApplyPlanRevisionTurnInputSchema`, and `ApplyPlanRevisionTurnOutputSchema`.
- [ ] `start-plan-revision-session` is registered by `eforge/extensions/eforge-plan/index.ts`.
- [ ] `list-plan-revision-sessions` is registered by `eforge/extensions/eforge-plan/index.ts`.
- [ ] `get-plan-revision-session` is registered by `eforge/extensions/eforge-plan/index.ts`.
- [ ] `start-plan-revision-turn` is registered by `eforge/extensions/eforge-plan/index.ts`.
- [ ] `retry-plan-revision-turn` is registered by `eforge/extensions/eforge-plan/index.ts`.
- [ ] `cancel-plan-revision-turn` is registered by `eforge/extensions/eforge-plan/index.ts`.
- [ ] `apply-plan-revision-turn` is registered by `eforge/extensions/eforge-plan/index.ts`.
- [ ] The planning workstation `allowedActions` array contains every registered revision action id.
- [ ] `start-plan-revision-turn` sends `requestedOutputSections: ['planRevisionTurn']` to `ctx.agentTasks.start()`.
- [ ] `start-plan-revision-turn` sends `existingSessionPlan` containing the target flat plan markdown.
- [ ] `start-plan-revision-turn` stores a turn with `taskId`, `userMessage`, `basePlanFingerprint`, `baseSectionHashes`, and `createdAt`.
- [ ] Concurrent queued/running turns for one target session are rejected before a new daemon task starts.
- [ ] `retry-plan-revision-turn` stores `retryOfTaskId` for plain retries.
- [ ] Clarification redraft stores `redraftOfTaskId` and `parentTaskId`.
- [ ] Clarification redraft source context includes user answers.
- [ ] `cancel-plan-revision-turn` calls `ctx.agentTasks.cancel()` with the linked task id.
- [ ] Fresh apply of selected `scope` writes the generated `scope` content to the flat session plan.
- [ ] Fresh apply of selected `scope` leaves an unselected generated `acceptance-criteria` section out of the markdown file.
- [ ] Fresh apply returns `kind: 'applied'`, the target `session`, selected `appliedSections`, `plan`, `readiness`, and `path`.
- [ ] Stale apply returns `kind: 'stale'`, the target `session`, `basePlanFingerprint`, and `currentPlanFingerprint`.
- [ ] Stale apply leaves the flat session-plan markdown unchanged.
- [ ] Answer-only revision turns return `kind: 'not-applicable'` from apply.
- [ ] Invalid task linkage returns `kind: 'not-applicable'` from apply.
- [ ] Apply leaves `plan.status` unchanged.
- [ ] Apply does not call `ctx.buildQueue.enqueue()`.
- [ ] Apply does not create a handoff output or queue source path.
- [ ] Apply does not mutate backlog item statuses.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/plan-revision-store.test.ts eforge/extensions/eforge-plan/__tests__/plan-revision-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["api", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
