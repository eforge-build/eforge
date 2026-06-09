# Planning Task Contract

## Architecture Reference

This module implements the **Planning task wire contract** section from the architecture and the `planning-task-contract` module breakdown.

Key constraints from architecture:
- The shared task wire shape is owned by `@eforge-build/client`; extension modules must consume these exported schemas/types instead of defining a second curation result contract.
- The daemon/engine remains a read-only single-shot task runner; this module adds structured output support only and performs no backlog or recommendation mutations.
- Generated curation output must be structured and fail closed: malformed `backlogCurationDraft` payloads are rejected by the client schema and engine submit tool before a completed task record is written.
- The new first-party task result is feature-gated by `DAEMON_API_VERSION` because the workstation will rely on it.
- Existing recommendation refresh, session-plan creation draft, needs-input, and section-progress contracts must continue to validate.

## Scope

### In Scope

- Add `backlogCurationDraft` to extension planning task requested output sections.
- Add TypeBox schemas and exported TypeScript types for the structured backlog curation draft wire shape.
- Add a ready planning task result variant containing `backlogCurationDraft`, with optional `recommendations` in the same result.
- Count `backlogCurationDraft` as an output-bearing section in client helper logic and daemon task metadata.
- Extend the engine planning task submit tool input schema with `backlogCurationDraft`.
- Update the planning task prompt with curation-specific output guidance and low-noise/evidence constraints.
- Bump `DAEMON_API_VERSION` to 63 and update hard-coded version tests/rationale.
- Add client, engine, and daemon route/service tests for valid and malformed curation drafts.

### Out of Scope

- Building curation source text or fingerprints.
- Adding the `backlog-curation` workflow purpose, `analyze-all-backlog` action, retry/redraft behavior, or apply actions.
- Validating backlog IDs, statuses, dependencies, epic links, preconditions, or recommendation references against project storage.
- Writing backlog records, recommendation models, or recommendation freshness sidecars.
- Workstation UI, mock data, bundle assets, and README updates.
- Storage migration from `.backlog` to private extension storage.

## Implementation Approach

### Overview

Add the curation draft as an additive extension planning task output. Start at the client contract so every runtime consumes the same TypeBox schemas and inferred types. Then wire the schema into the engine submit tool and prompt. Finally update daemon task output counting because completed task metadata is part of the first-party task monitor contract.

The client schema will validate structure only. Domain validation that needs current backlog state remains in the later `curation-workflow` module. This keeps the daemon read-only and prevents this module from importing extension storage/domain code.

### Key Decisions

1. **Define curation schemas in `packages/client/src/extension-agent-tasks.ts`.** This keeps the curation draft wire shape next to the existing planning task request/result schemas and makes the exported TypeScript types available through the existing `export *` entries.
2. **Use a structural schema, not extension-domain validation.** The schema requires IDs, record kind literals, precondition hashes, structured metadata patches, section operations, and preview arrays; the extension apply path will validate status values, references, stale preconditions, evidence requirements, and low-noise semantics against current storage.
3. **Add a curation-ready result variant without changing existing ready variants.** A curation-only result must validate when it has `summary`, `assumptionsOpenQuestions`, and `backlogCurationDraft`. Results may also include `recommendations`; existing recommendation-only and session-plan creation results keep their current shape.
4. **Keep top-level needs-input scoped to session-plan creation.** Curation-specific unresolved cases live inside `backlogCurationDraft.needsInput`; the top-level `decision: 'needs-input'` variant remains the existing session-plan creation fallback and must not accept output sections.
5. **Import the client curation schema in the engine submit tool.** The submit tool advertises the same `backlogCurationDraft` structure the daemon persists, and the handler still calls `parseEforgePlanPlanningDraftResult` as the final authority.
6. **Update daemon `outputSectionCount`.** The Plan with AI monitor uses sanitized metadata, so completed curation-only tasks must report one output section instead of zero.

## Files

### Create

- `packages/client/src/__tests__/extension-agent-task-curation-draft.test.ts` — focused contract tests for curation requested output sections, valid curation results, exported helper behavior, and malformed curation payload rejection.

### Modify

- `packages/client/src/extension-agent-tasks.ts` — add `backlogCurationDraft` requested output literal; define/export curation draft schemas and inferred types; add the ready result variant; keep the needs-input variant output-free; update `hasEforgePlanPlanningDraftOutputSection`.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` from 62 to 63 with a v63 rationale naming `backlogCurationDraft`, the requested output section, result field, and first-party workstation gate.
- `packages/client/src/__tests__/extension-agent-tasks.test.ts` — update the hard-coded API version assertion/rationale source checks; keep existing route and session-plan creation assertions intact.
- `test/daemon-api-version.test.ts` — update the hard-coded version test to 63 with a test name mentioning the backlog curation draft contract.
- `packages/engine/src/agents/extension-planning-task.ts` — import `EforgePlanPlanningBacklogCurationDraftSchema`; add optional `backlogCurationDraft` to `planningDraftSubmissionToolSchema`; keep `parseEforgePlanPlanningDraftResult` as the submit handler validation gate.
- `packages/engine/src/prompts/eforge-plan-planning-draft.md` — document `backlogCurationDraft` as an output section, instruct agents to preserve `sourceFingerprint`, emit structured arrays, use curation `needsInput`/`skipped` arrays for per-record cases, avoid mutation claims, and require durable evidence for shipped/superseded/stale claims.
- `test/extension-planning-task.test.ts` — add engine tests that a valid curation draft submission returns as the task result, the custom submit tool schema exposes `backlogCurationDraft`, the prompt includes curation guidance, and a malformed curation draft submission is rejected without task completion.
- `packages/monitor/src/routes/extensions/agent-task-service.ts` — include `backlogCurationDraft` in `countOutputSections` so completed curation-only tasks persist `metadata.outputSectionCount: 1`.
- `packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts` — add route/service coverage for completing a curation draft task and for a malformed curation draft submission producing a failed task record with no `result`.

No files in the architecture Shared File Registry are modified by this module, so no `[region: planning-task-contract, ...]` annotations are required.

## Contract Details

### Client curation schema

Add exported TypeBox schemas using the `EforgePlanPlanning...` naming convention:

- `EforgePlanPlanningBacklogCurationRecordKindSchema`: union of `item` and `epic`.
- `EforgePlanPlanningBacklogCurationPreconditionSchema`: `id`, `kind`, required `bodySha256`, optional `sourceFingerprint`, optional `updated`, optional `recordSha256`.
- `EforgePlanPlanningBacklogCurationMetadataPatchSchema`: optional `status`, `priority`, `tags`, `depends_on`, `epic` as string or null, `last_checked`, and `stale_after`.
- `EforgePlanPlanningBacklogCurationSectionOperationSchema`: `heading`, `action` as `replace` or `append`, and `content`.
- `EforgePlanPlanningBacklogCurationRecordPatchSchema`: `id`, `kind`, `precondition`, optional `metadata`, optional `sectionOperations`, optional `rationale`, optional `evidence`.
- `EforgePlanPlanningBacklogCurationRecheckSchema`: `id`, `kind`, `precondition`, `last_checked`, `stale_after`, optional `rationale`.
- `EforgePlanPlanningBacklogCurationSkippedSchema`: optional `id`, optional `kind`, required `reason`.
- `EforgePlanPlanningBacklogCurationNeedsInputSchema`: optional `id`, optional `kind`, required `question`, optional `reason`.
- `EforgePlanPlanningBacklogCurationDraftSchema`: `schemaVersion: 1`, required `sourceFingerprint`, optional `generatedAt`, required `summary`, `itemChanges`, `epicChanges`, `noOpRechecks`, `skipped`, and `needsInput` arrays.

Use `additionalProperties: false` on all curation objects. Use non-empty string constraints for IDs, hashes, source fingerprints, headings, reasons, and questions. Leave status/priority vocabulary and reference validation to `curation-workflow`.

Export inferred types for every exported schema needed by downstream modules, especially `EforgePlanPlanningBacklogCurationDraft`, `EforgePlanPlanningBacklogCurationRecordPatch`, `EforgePlanPlanningBacklogCurationRecheck`, `EforgePlanPlanningBacklogCurationSkipped`, and `EforgePlanPlanningBacklogCurationNeedsInput`.

### Result variant

Update `EforgePlanPlanningDraftResultSchema` so these cases validate:

- Curation-only ready result: common fields plus `backlogCurationDraft`.
- Curation plus recommendations ready result: common fields plus `backlogCurationDraft` and `recommendations`.
- Existing recommendation-only, handoff, plan draft, playbook, session-plan patch, ready session-plan creation draft, and needs-input results.

Do not add `backlogCurationDraft` to the top-level needs-input variant. Add it to `hasEforgePlanPlanningDraftOutputSection` so a curation-only result returns `true`.

### Engine submit tool and prompt

The submit tool schema in `extension-planning-task.ts` must include an optional `backlogCurationDraft` property using the exported client schema. The tool handler remains unchanged apart from accepting the new field through the parser: invalid submissions return `Submission rejected: ...` and leave `submitted` unset, which causes the task to fail if the agent does not resubmit a valid result.

The prompt must add a curation bullet under ready outputs and include explicit instructions:

- Use `backlogCurationDraft` when the requested output sections include it.
- Preserve the provided source fingerprint exactly.
- Emit structured `itemChanges`, `epicChanges`, `noOpRechecks`, `skipped`, and `needsInput` arrays; use empty arrays when a category has no entries.
- For materially unchanged records, use `noOpRechecks` rather than body or metadata patches except `last_checked`/`stale_after`.
- Do not claim that records were written; the extension applies validated patches later.
- Do not mark work shipped, superseded, or stale without durable evidence text in the relevant patch.

### API version

Set `DAEMON_API_VERSION` to 63. The rationale must state that the bump gates the first-party `backlogCurationDraft` requested output/result contract for daemon-owned eforge-plan planning tasks.

## Testing Strategy

### Unit Tests

- Client schema tests for requested output section parsing, valid curation-only results, valid curation-plus-recommendations results, `hasEforgePlanPlanningDraftOutputSection`, strict `additionalProperties: false`, invalid record kind rejection, missing precondition hash rejection, and missing required draft arrays rejection.
- Existing client tests for session-plan creation drafts and needs-input decisions remain in place to catch regressions in result union ordering.
- Engine runner tests for accepted curation submissions, rejected malformed curation submissions, submit tool input schema exposure, and prompt guidance.

### Integration Tests

- Monitor route/service test for a completed curation-only task with `metadata.outputSectionCount` equal to `1`.
- Monitor route/service test for a malformed curation draft submission that ends as `status: 'failed'` and has no persisted `result`.

### Regression Tests

- Existing recommendation refresh and session-plan creation task tests continue to pass without changing their expected payloads.
- API version tests assert `DAEMON_API_VERSION === 63` in both client and top-level daemon version suites.

## Verification

- [ ] `safeParseExtensionAgentTaskStartRequest` accepts `requestedOutputSections: ['backlogCurationDraft', 'recommendations']`.
- [ ] `safeParseExtensionAgentTaskStartRequest` rejects an unsupported requested output literal.
- [ ] `parseEforgePlanPlanningDraftResult` returns a result containing `backlogCurationDraft.schemaVersion === 1` for a valid curation-only payload.
- [ ] `safeParseEforgePlanPlanningDraftResult` returns `success: true` for a result containing both `backlogCurationDraft` and `recommendations`.
- [ ] `safeParseEforgePlanPlanningDraftResult` returns `success: false` when a curation record precondition omits `bodySha256`.
- [ ] `safeParseEforgePlanPlanningDraftResult` returns `success: false` when a curation object contains an undeclared property.
- [ ] `hasEforgePlanPlanningDraftOutputSection` returns `true` for a curation-only result.
- [ ] `runEforgePlanPlanningDraftTask` returns a valid curation draft result from the submit tool.
- [ ] `runEforgePlanPlanningDraftTask` throws a non-submission error when the only submit tool call carries a malformed curation draft.
- [ ] The engine submit tool input schema includes `properties.backlogCurationDraft`.
- [ ] The planning task prompt text contains `backlogCurationDraft`, `sourceFingerprint`, and durable evidence guidance.
- [ ] A completed daemon-owned curation-only task record has `metadata.outputSectionCount === 1`.
- [ ] A daemon-owned task with a malformed curation draft submission reaches `status === 'failed'` and has `result === undefined`.
- [ ] `DAEMON_API_VERSION` equals `63`.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test -- packages/client/src/__tests__/extension-agent-task-curation-draft.test.ts packages/client/src/__tests__/extension-agent-tasks.test.ts test/extension-planning-task.test.ts packages/monitor/src/__tests__/routes-extension-agent-tasks.test.ts test/daemon-api-version.test.ts` exits 0.
