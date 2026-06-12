# Client/Engine Task Contract

## Architecture Reference

This module implements the architecture sections **Client task contract (`@eforge-build/client`)**, **Bounded task input contract**, **Module: `client-engine-task-contract`**, and the shared portions of **Quality attributes and test strategy**.

Key constraints from architecture:
- Persisted extension agent task result variants, requested-output literals, and exported node/browser types must live in `@eforge-build/client` and be reused by engine, monitor, extension backend, and workstation code.
- Reuse the existing `eforge-plan.planning-draft` task kind; do not add a new daemon task kind for revision turns.
- The daemon task runner remains single-shot and read-only (`tools: 'read-only'`); no daemon-owned chat transcript or mutation-capable agent tools are added.
- `planRevisionTurn` is an output-bearing result section; top-level `decision: "needs-input"` remains the only clarification result variant.
- `hasEforgePlanPlanningDraftOutputSection()` and monitor metadata counting must count `planRevisionTurn` as one output section.
- `packages/client/src/extension-agent-tasks.ts` is already 599 lines, so this module must split focused schemas into new modules before adding the revision-turn variant.

## Scope

### In Scope
- Add the shared `planRevisionTurn` requested-output literal and result field to the extension agent task contract.
- Export node/browser schemas and types for plan revision turn payloads through the existing `@eforge-build/client` public barrels.
- Refactor backlog-curation/common schemas out of `packages/client/src/extension-agent-tasks.ts` so the barrel remains under the 600-line implementation ceiling after the new variant is added.
- Extend the engine submit tool schema and final parsing path to accept `planRevisionTurn` results.
- Update the eforge-plan planning draft prompt with bounded plan-revision-turn guidance: answer-only turns, patch-bearing turns, clarification via `needs-input`, base fingerprint copying, and non-mutation language.
- Count completed `planRevisionTurn` results in daemon task metadata (`outputSectionCount`).
- Add client schema, engine StubHarness, prompt/submit-tool, and monitor metadata tests for answer-only, patch-bearing, needs-input, and malformed revision-turn cases.
- Bump the daemon API version because first-party workstation code will depend on the additive task contract.

### Out of Scope
- eforge-plan revision session storage, action schemas, action handlers, action registration, apply semantics, fingerprint computation, and backend tests.
- Plans tab UI, workstation bridge/fixtures, generated workstation assets, and UI tests.
- README, `docs/extensions.md`, generated reference docs, and Pi/Claude integration-surface documentation.
- Session plan-set revision UX.
- Any new CLI, MCP, Claude plugin, or Pi command/skill.

## Implementation Approach

### Overview

Implement the shared contract first, then update the two daemon execution surfaces that consume it.

1. Split the large client contract file by moving backlog-curation schemas and shared scalar schemas into focused modules under `packages/client/src/extension-agent-tasks/`.
2. Add a new `plan-revision.ts` schema module and re-export its schemas/types through `packages/client/src/extension-agent-tasks.ts` so existing imports from `@eforge-build/client` and `@eforge-build/client/browser` keep working.
3. Add `planRevisionTurn` to requested-output parsing, final result validation, `hasEforgePlanPlanningDraftOutputSection()`, the engine submit tool, prompt instructions, and monitor output-section counting.
4. Add tests before or alongside implementation so invalid payloads fail through the same parse path that persists completed task records.
5. Bump `DAEMON_API_VERSION` from 64 to 65 and update the version-history test text to mention the new requested-output section and result field.

### Key Decisions

1. **Use a dedicated result field instead of overloading `sessionPlanPatch`.** `planRevisionTurn` carries assistant narrative plus optional structured patch data, so answer-only turns can be valid output-bearing task results without fake mutations.
2. **Keep `needs-input` top-level and output-free.** A clarification result for a revision turn uses the existing `decision: "needs-input"` branch with `clarificationQuestions` and `rationale`; it must not include `planRevisionTurn` or any other output section.
3. **Use `string` for section dimensions in the shared schema.** No shared flat-plan dimension literal exists in `@eforge-build/client`. The backend module will validate selected apply dimensions against the adapter-loaded flat plan before writing.
4. **Validate fingerprints syntactically only in this module.** The shared result contract requires 64-character lowercase sha256 hex strings for `basePlanFingerprint` and per-section hashes. The extension backend module owns deterministic fingerprint calculation and stale-apply comparison.
5. **Import the plan revision schema into the engine submit tool.** The engine must not re-declare the plan revision object shape in a second TypeBox definition; using the client schema keeps submit-tool validation aligned with persisted task record validation.
6. **Feature-gate with the daemon API version.** The first-party workstation will call `requestedOutputSections: ['planRevisionTurn']` and read completed `result.planRevisionTurn`, so stale daemons must fail version verification.

## Files

### Create
- `packages/client/src/extension-agent-tasks/common.ts` — shared TypeBox primitives for extension-agent planning task schemas, including `EforgePlanPlanningSha256HexSchema`, non-empty strings, and any private helpers needed by moved sub-schemas.
- `packages/client/src/extension-agent-tasks/backlog-curation.ts` — moved backlog-curation schemas and static types currently embedded in `extension-agent-tasks.ts`; re-export all public backlog-curation schema/type names that existing consumers import from `@eforge-build/client`.
- `packages/client/src/extension-agent-tasks/plan-revision.ts` — new `EforgePlanPlanningPlanRevisionTurnSchema` plus nested schemas/types for base section hashes, proposed section edits, metadata guidance, skipped dimension guidance, and citations.
- `packages/client/src/__tests__/extension-agent-task-plan-revision.test.ts` — focused client contract tests for requested-output parsing, answer-only results, patch-bearing results, completed record round trips, and invalid revision-turn payload rejection.
- `test/extension-planning-task-plan-revision.test.ts` — focused engine StubHarness tests for read-only revision tasks, submit-tool schema exposure, answer-only outputs, patch-bearing outputs, top-level needs-input outputs, malformed revision payload rejection, and prompt guidance.
- `packages/monitor/src/__tests__/routes-extension-agent-task-plan-revision.test.ts` — focused monitor/service test that starts a real extension agent task with a stub harness returning `planRevisionTurn` and asserts completed metadata reports one output section.

### Modify
- `packages/client/src/extension-agent-tasks.ts` — refactor to import/re-export moved backlog-curation/common schemas, add the `planRevisionTurn` requested-output literal, add `planRevisionTurn` to output fields and the required-output union branch, export plan revision types, and update `hasEforgePlanPlanningDraftOutputSection()` `[region: client-engine-task-contract, top-level imports/exports plus requested-output/result/output-helper sections]`.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` to 65 and prepend version-history text for the first-party `planRevisionTurn` requested-output/result contract.
- `packages/client/src/__tests__/extension-agent-tasks.test.ts` — update the daemon API version test name, expected version number, and source-comment assertions to include `planRevisionTurn` while retaining the prior backlog-curation/session-plan-creation assertions.
- `packages/engine/src/agents/extension-planning-task.ts` — import `EforgePlanPlanningPlanRevisionTurnSchema` and add an optional `planRevisionTurn` field to `planningDraftSubmissionToolSchema` so the custom submit tool rejects malformed revision payloads before completion `[region: client-engine-task-contract, submit-tool schema imports and properties]`.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — add `planRevisionTurn` to the output-section guidance and add a revision-turn guidance section covering answer-only messages, structured section edits, exact base fingerprint echoing, clarification via `needs-input`, and no mutation claims `[region: client-engine-task-contract, output contract and revision guidance]`.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — add `planRevisionTurn` to `countOutputSections()` so completed revision turns set `metadata.outputSectionCount` to `1` `[region: client-engine-task-contract, countOutputSections helper]`.

## Contract Details

The new `EforgePlanPlanningPlanRevisionTurnSchema` must include these fields:
- `schemaVersion`: literal `1`.
- `targetSession`: non-empty string.
- `assistantMessage`: non-empty string.
- `basePlanFingerprint`: lowercase sha256 hex string.
- `baseSectionHashes`: optional array of `{ dimension, sha256 }` objects.
- `proposedPatch`: optional object with optional `sections`, `metadata.openQuestions`, and `skippedDimensions` fields.
- `proposedPatch.sections`: optional non-empty array of `{ dimension, content, rationale? }` objects.
- `citations`: optional array of `{ label, excerpt?, path?, url? }` objects.
- `applyGuidance`: optional string.
- `noPatchReason`: optional string.

Parsing rules to preserve:
- A result containing only common fields plus `planRevisionTurn` is a valid ready output result.
- A result containing `decision: "needs-input"`, `clarificationQuestions`, and `rationale` is valid and `hasEforgePlanPlanningDraftOutputSection()` returns `false` for it.
- A `needs-input` result with `planRevisionTurn`, `sessionPlanPatch`, or any other output field is rejected by `safeParseEforgePlanPlanningDraftResult()`.
- A `planRevisionTurn` with an invalid fingerprint, empty assistant message, missing target session, missing section content, or extra nested properties is rejected.

## Testing Strategy

### Unit Tests
- Client contract tests in `extension-agent-task-plan-revision.test.ts`:
  - `safeParseExtensionAgentTaskStartRequest()` accepts `requestedOutputSections: ['planRevisionTurn']` with `existingSessionPlan` populated.
  - `parseEforgePlanPlanningDraftResult()` accepts an answer-only `planRevisionTurn` with `noPatchReason` and no `proposedPatch`.
  - `safeParseExtensionAgentTaskRecord()` accepts a completed record whose `result.planRevisionTurn` is answer-only.
  - `parseEforgePlanPlanningDraftResult()` accepts a patch-bearing `planRevisionTurn` with `scope` and `acceptance-criteria` section edits, `baseSectionHashes`, `citations`, and `applyGuidance`.
  - A completed record with a patch-bearing result round trips through `JSON.stringify`/`JSON.parse` and `parseExtensionAgentTaskRecord()` with the same `targetSession` and section count.
  - Invalid fingerprints, empty `assistantMessage`, missing section `content`, and unexpected nested properties produce `success === false` from the safe parse helper.
  - `hasEforgePlanPlanningDraftOutputSection()` returns `true` for answer-only and patch-bearing revision turns.
  - `hasEforgePlanPlanningDraftOutputSection()` returns `false` for top-level needs-input clarification results.

### Integration Tests
- Engine StubHarness tests in `extension-planning-task-plan-revision.test.ts`:
  - A revision answer-only submission completes and `harness.calls[0].tools` equals `'read-only'`.
  - The submit tool input schema contains a `planRevisionTurn` property.
  - The rendered prompt contains `planRevisionTurn`, `basePlanFingerprint`, answer-only guidance, structured patch guidance, and non-mutation guidance.
  - A patch-bearing revision submission completes with two proposed sections.
  - A top-level needs-input submission completes with `decision === 'needs-input'` and one clarification question.
  - A malformed revision submission returns a submission rejection tool result and the task generator throws the non-submission error after the agent fails to submit a valid replacement.
- Monitor route/service test in `routes-extension-agent-task-plan-revision.test.ts`:
  - A real `ExtensionAgentTaskService` run with a stub harness persists a completed revision-turn task record with `metadata.outputSectionCount === 1` and the original `result.planRevisionTurn.targetSession`.

## Verification

- [ ] `packages/client/src/extension-agent-tasks.ts` remains at or below 600 lines.
- [ ] `packages/client/src/extension-agent-tasks/plan-revision.ts` exports `EforgePlanPlanningPlanRevisionTurnSchema` and `EforgePlanPlanningPlanRevisionTurn`.
- [ ] `@eforge-build/client` exports the plan revision schemas/types from the node entrypoint.
- [ ] `@eforge-build/client/browser` exports the plan revision schemas/types from the browser entrypoint.
- [ ] `safeParseExtensionAgentTaskStartRequest({ kind: 'eforge-plan.planning-draft', input: { topic: 'x', requestedOutputSections: ['planRevisionTurn'] } })` returns `success: true`.
- [ ] A completed task record containing an answer-only `result.planRevisionTurn` parses with `safeParseExtensionAgentTaskRecord()`.
- [ ] A completed task record containing a patch-bearing `result.planRevisionTurn` parses with `safeParseExtensionAgentTaskRecord()`.
- [ ] `parseExtensionAgentTaskRecord(JSON.parse(JSON.stringify(record))).result.planRevisionTurn.targetSession` equals the original target session in the round-trip test.
- [ ] A `planRevisionTurn` result with `basePlanFingerprint: 'not-a-sha'` returns `success: false` from `safeParseEforgePlanPlanningDraftResult()`.
- [ ] `hasEforgePlanPlanningDraftOutputSection()` returns `true` for `planRevisionTurn` results.
- [ ] `hasEforgePlanPlanningDraftOutputSection()` returns `false` for top-level `needs-input` results.
- [ ] `runEforgePlanPlanningDraftTask()` completes for an answer-only revision-turn submission and records `tools: 'read-only'`.
- [ ] `runEforgePlanPlanningDraftTask()` completes for a patch-bearing revision-turn submission with `scope` and `acceptance-criteria` edits.
- [ ] `runEforgePlanPlanningDraftTask()` completes for a top-level `needs-input` revision clarification submission.
- [ ] A malformed revision-turn submission is rejected by the submit tool and does not produce a completed engine result.
- [ ] Completed daemon task metadata reports `outputSectionCount: 1` for a revision-turn result.
- [ ] `DAEMON_API_VERSION` equals `65`.
- [ ] `pnpm vitest run packages/client/src/__tests__/extension-agent-task-plan-revision.test.ts packages/client/src/__tests__/extension-agent-tasks.test.ts test/extension-planning-task-plan-revision.test.ts packages/monitor/src/__tests__/routes-extension-agent-task-plan-revision.test.ts` exits 0.
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
