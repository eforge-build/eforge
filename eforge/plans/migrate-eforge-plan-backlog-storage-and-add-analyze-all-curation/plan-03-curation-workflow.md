---
id: plan-03-curation-workflow
name: Analyze-all backlog curation backend actions, workflow purpose, source
  fingerprints, validation-first apply, and recommendation freshness.
branch: migrate-eforge-plan-backlog-storage-and-add-analyze-all-curation/curation-workflow
---

# Curation Workflow

## Architecture Reference

This module implements the **Apply contract**, **Curation source and fingerprint**, and `curation-workflow` entry from the architecture's module dependency graph.

Key constraints from architecture:
- The daemon/engine remains a read-only single-shot planning task runner; all backlog and recommendation mutations happen inside trusted `eforge-plan` actions after validation.
- Curation uses the shared `@eforge-build/client` `backlogCurationDraft` wire contract produced by `planning-task-contract`; this module must not define a conflicting task result shape.
- Visible backlog reads use migrated storage helpers from `storage-foundation`, including private+legacy merged snapshots with private precedence.
- Analyze-all starts or reuses a daemon-owned planning task for the current curation source fingerprint and requests `['backlogCurationDraft', 'recommendations']`.
- Applying a curation draft validates source fingerprints, per-record preconditions, IDs, statuses, dependencies, epic links, section operations, evidence requirements, and recommendation references before any writes.
- Curation writes item and epic Markdown records through private-storage helpers only; legacy `.backlog/items` and `.backlog/epics` files stay untouched.
- Recommendation freshness is recorded after curation writes and against the post-apply backlog fingerprint when recommendations are included.
- Analyze-all and curation apply never enqueue builds.

## Scope

### In Scope

- Add the `backlog-curation` durable planning task workflow purpose.
- Add an `analyze-all-backlog` action that builds a curation source, starts or reuses a current-fingerprint daemon task, records workflow metadata, and requests structured curation plus recommendations.
- Add curation-specific source projection and fingerprint code that preserves one entry per visible open item and open epic, including precondition hashes from storage snapshots.
- Extend retry/redraft planning task actions so `backlog-curation` tasks preserve purpose, requested outputs, current source fingerprints, and curation redraft context.
- Extend apply selection with `applyBacklogCurationDraft` and require literal confirmation flags in action input.
- Add validation-first curation apply that can mutate supported metadata fields, append durable evidence, apply section operations, update no-op recheck metadata, and write private item/epic records.
- Validate generated recommendations against the prospective post-curation item/epic ID sets before writing backlog records.
- Write generated recommendations and recommendation status sidecar after successful curation writes when recommendations are present.
- Mark existing recommendations stale after successful fingerprint-relevant curation writes when no generated recommendations are applied.
- Mark applied curation workflow entries so future analyze-all calls do not reuse a completed task after its draft has been applied.
- Add backend tests for analyze start/reuse, workflow purpose behavior, retry/redraft metadata, curation validation, private-only writes, recommendation freshness, and no build queue calls.

### Out of Scope

- Storage migration itself, legacy import helpers, or read-through precedence rules beyond consuming the helpers from `storage-foundation`.
- Planning task wire/schema changes inside `packages/client` or engine submit-tool/prompt changes; `planning-task-contract` owns those.
- Workstation UI controls, preview rendering, two-click UI state, mocks, and bundled assets; `workstation-curation-ui` owns those.
- README updates, README contract changes, and final bundle rebuild; `docs-assets-validation` owns those.
- Scheduled curation, stale-triggered curation, unattended apply, build enqueueing, plan-set generation, or core Console Plans changes.

## Implementation Approach

### Overview

Implement curation as focused extension modules and keep existing planning task actions as thin dispatch points.

1. `backlog-curation-source.ts` builds the analyze-all source packet and source fingerprint from migrated backlog snapshots, roadmap evidence, trace summaries, dependencies, blockers, and the current recommendation model.
2. `backlog-curation-actions.ts` owns the manual `analyze-all-backlog` action, task start/reuse logic, workflow entry creation, and start-index failure cancellation.
3. `backlog-curation-apply.ts` owns validation-first apply. It reads the completed task result, parses the shared client curation schema, checks workflow purpose and source fingerprints, computes prospective records in memory, validates all references, writes private backlog files, then applies recommendations/status.
4. Existing `agent-task-actions.ts` delegates retry/redraft/apply special cases to curation helpers while preserving recommendation-only and session-plan task behavior.
5. Existing `planner-orchestration.ts` keeps the public `applyCompletedPlanningAgentTaskResult` entry point but calls the new curation apply helper when the caller selects `applyBacklogCurationDraft`.

The source builder must not call `boundedSourceText` because that helper drops items after 25 entries. Curation source text may truncate long section bodies and roadmap excerpts, but it must retain every visible open item and open epic ID plus every precondition hash.

### Key Decisions

1. **Use workflow purpose to gate curation apply.** `applyBacklogCurationDraft` requires a workflow entry whose `purpose` is `backlog-curation`. A curation task's generated recommendations cannot be applied through standalone `applyRecommendations` because they are meant to describe the post-curation backlog state.
2. **Use two literal confirmation flags in the backend input.** Add `applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true }`. The workstation module collects these in two UI steps; the backend schema rejects missing or false flags.
3. **Reuse queued, running, and unapplied completed curation tasks for the same fingerprint.** Reusing completed drafts avoids duplicate previews. Successful apply records `appliedAt` on the workflow entry, and analyze-all skips applied entries.
4. **Compute validation and prospective records before writes.** The apply helper reads all visible item/epic snapshots, validates current fingerprint/preconditions, applies metadata and section operations to in-memory copies, validates normalized records and recommendation references, and only then writes private files.
5. **Add exact-record private write helpers only if storage lacks them.** Curation needs deletion semantics for `epic: null` and exact body replacement. If `storage-foundation` already exposes an exact private write helper, use it. Otherwise add small helpers to `markdown-store.ts` that serialize the provided frontmatter/body exactly to the canonical private path while preserving existing schema validation.
6. **Treat no-op rechecks separately from material patches.** `noOpRechecks` may update only `last_checked` and `stale_after` and must not set `updated`, body sections, evidence, status, dependencies, tags, priority, or epic links. Materially unchanged records represented as `itemChanges`/`epicChanges` are rejected.
7. **Evidence is append-only unless the draft also carries durable evidence text.** Closed status transitions (`shipped`, `stale`, `superseded`) and `Evidence` section changes require non-empty `evidence` entries. Apply appends durable evidence bullets to the `Evidence` section instead of trusting implicit prose.
8. **Recommendation freshness uses post-write state.** When recommendations are included, apply writes backlog records first, then writes recommendations and calls `recordPlannerRecommendationAppliedForSourceFingerprint(cwd, postApplyFingerprint, 'apply-backlog-curation-draft')`. If recommendations are absent, apply compares pre/post recommendation fingerprints and calls `markRecommendationsStaleForBacklogMutation` only when the recommendation fingerprint changed.

## Files

### Create

- `eforge/extensions/eforge-plan/backlog-curation-schemas.ts` — TypeBox schemas and exported types for `analyze-all-backlog` action input/output plus curation apply result projection pieces that are not task wire schemas.
- `eforge/extensions/eforge-plan/backlog-curation-source.ts` — curation source projection, source fingerprint computation, bounded section/roadmap/trace summaries, and curation redraft context helpers.
- `eforge/extensions/eforge-plan/backlog-curation-apply.ts` — validation-first apply pipeline, prospective record construction, precondition checks, reference validation, section operation application, private writes, recommendation write/status update, and applied-entry marking.
- `eforge/extensions/eforge-plan/backlog-curation-actions.ts` — `analyzeAllBacklogAction`, task start/reuse helpers, exclusive start chain, workflow entry builder, and record-or-cancel behavior.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts` — source/fingerprint tests proving all open IDs and preconditions are retained.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts` — action-runtime tests for analyze-all start/reuse metadata, workflow purpose, retry/redraft preservation, and no build queue calls.
- `eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts` — action-runtime and direct helper tests for curation apply validation, private-only writes, stale failure behavior, recommendation reference validation, and post-apply freshness.

### Modify

- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts` — add curation action/apply schema integration.
  - Extend `PlanningTaskWorkflowEntrySchema.purpose` from `recommendation-refresh` to a union including `backlog-curation`.
  - Add optional `appliedAt` to workflow entries so analyze-all can skip completed drafts after apply.
  - Add `ApplyPlanningAgentTaskBacklogCurationSelectionSchema` with literal `previewAcknowledged: true` and `confirmApply: true`.
  - Add `applyBacklogCurationDraft` to `ApplyPlanningAgentTaskResultInputSchema`.
  - Extend `ApplyPlanningAgentTaskResultOutputSchema` with optional `backlogCuration` details and `applied.backlogCuration` counts while preserving existing output fields.
  - Keep existing exported status/type aliases available.

- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts` — add curation workflow helpers.
  - Export `BACKLOG_CURATION_WORKFLOW_PURPOSE = 'backlog-curation'`.
  - Export `isBacklogCurationWorkflowEntry`, `listBacklogCurationWorkflowEntries`, and `findBacklogCurationWorkflowEntry`.
  - Add `markPlanningTaskWorkflowEntryApplied(cwd, taskId, appliedAt)` that updates one existing entry under the same serialized index write lock.
  - Keep recommendation-refresh helpers unchanged.

- `eforge/extensions/eforge-plan/agent-task-actions.ts` — delegate curation retry/redraft/apply cases and preserve purpose metadata.
  - Import `buildBacklogCurationSource`, `buildBacklogCurationRedraftContext`, and `isBacklogCurationWorkflowEntry` helpers.
  - In retry, use curation source text/fingerprint when the parent purpose is `backlog-curation`.
  - In redraft, allow `backlog-curation` parents that either completed with `backlogCurationDraft` or completed with needs-input clarification questions; include steering/answers in the curation redraft context.
  - In `startLinkedTask`, preserve `parent.purpose` for both recommendation refresh and backlog curation.
  - Update `assertApplySelection` to accept `applyBacklogCurationDraft` and reject curation apply combined with unrelated output selections.

- `eforge/extensions/eforge-plan/planner-orchestration.ts` — route curation apply through the new helper while keeping existing planner apply behavior.
  - Import `applyBacklogCurationDraftFromTask`.
  - Load the workflow entry once when applying task output.
  - If `applyBacklogCurationDraft` is selected, call the curation apply helper and return the extended output.
  - If the workflow entry purpose is `backlog-curation`, reject standalone `applyRecommendations`, handoff, session-plan patch, or creation-draft apply selections.
  - Keep recommendation-refresh source fingerprint resolution behavior unchanged for recommendation-only tasks.

- `eforge/extensions/eforge-plan/recommendation-status.ts` — expose reusable reference validation for prospective records.
  - Add `validateRecommendationReferencesAgainstIds(model, itemIds, epicIds)` and make existing `validateRecommendationReferences(cwd, model)` delegate to it.
  - Keep error shape as `ExtensionActionInputValidationError` so curation apply reference failures surface as `invalid-input`.
  - Use bounded exact edits; this file is already over 300 lines.

- `eforge/extensions/eforge-plan/recommendations-store.ts` — export any parser/helper needed by curation apply without duplicating model validation.
  - Reuse `parseRecommendationModel` for generated recommendations before prospective-reference validation.
  - Keep `writeRecommendations` as the final write path so the persisted model still passes existing storage validation.

- `eforge/extensions/eforge-plan/markdown-store.ts` — add exact private record writers only if storage-foundation did not already add an equivalent helper `[region: curation-workflow, after existing private write/update helpers or inside the durable storage write region]`.
  - Proposed exports: `replaceBacklogItemRecord(cwd, id, frontmatter, body)` and `replaceBacklogEpicRecord(cwd, id, frontmatter, body)`.
  - Each helper validates safe ID, normalizes the record, serializes with existing frontmatter order, and writes only to `resolveBacklogItemPath` / `resolveBacklogEpicPath`.
  - Registry note: this file is not listed in the architecture Shared File Registry, but storage-foundation also modifies it. Because curation depends on storage-foundation, this is a post-dependency non-overlapping edit. If parallel builders need markers, use:

```ts
// --- eforge:region plan-03-curation-workflow ---
export async function replaceBacklogItemRecord(/* ... */) {
  // exact private-record write helper owned by curation-workflow
}
// --- eforge:endregion plan-03-curation-workflow ---
```

- `eforge/extensions/eforge-plan/index.ts` — register curation actions and expose them to trusted surfaces `[region: curation-workflow, imports/action registration near planner/recommendation actions; Console contribution controls near refresh-recommendations; workstation allowedActions entries]`.
  - Import `backlogCurationActions` or `analyzeAllBacklogAction`.
  - Register `analyze-all-backlog` after recommendation/planning actions.
  - Add a Console contribution action button or form titled `Analyze all backlog` that invokes `analyze-all-backlog`.
  - Add `analyze-all-backlog` to workstation `allowedActions`.
  - Do not add build queue side effects.

```ts
// --- eforge:region plan-03-curation-workflow ---
for (const action of backlogCurationActions) eforge.registerAction(action);
// --- eforge:endregion plan-03-curation-workflow ---
```

- `eforge/extensions/eforge-plan/__tests__/registration.test.ts` — update action ID and side-effect assertions for curation `[region: curation-workflow, action ID/side-effect expectations near refresh/planning task IDs]`.
  - Add `analyze-all-backlog` to expected action IDs.
  - Add `analyze-all-backlog` to write/daemon-state action sets and assert it lacks `build-queue`.
  - Assert `apply-planning-agent-task-result` output schema includes `backlogCuration` and confirmation selection fields.
  - Keep storage-foundation import action expectations in separate blocks.

- `eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts` — update only if retry/redraft shared helper changes require a regression assertion; recommendation-only refresh start/reuse/apply expectations must remain unchanged.

- `eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts` — add curation-specific workflow tests for retry/redraft/apply selection and keep existing session-plan/recommendation tests intact.

### Do Not Modify

- `packages/client/src/extension-agent-tasks.ts`, `packages/engine/src/agents/extension-planning-task.ts`, and engine planning prompts — owned by `planning-task-contract`.
- Workstation source and bundled assets — owned by `workstation-curation-ui` and `docs-assets-validation`.
- `eforge/extensions/eforge-plan/README.md` and `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts` — owned by `docs-assets-validation`.
- Core Console Plans packages.

## Helper Design Details

### Curation source packet

`buildBacklogCurationSource(cwd, redraft?)` returns:

```ts
interface BacklogCurationSourceBuild {
  sourceFingerprint: string;
  sourceText: string;
  source: Record<string, unknown>;
}
```

The serialized source packet contains:

- `schemaVersion: 1`.
- `purpose: 'backlog-curation'`.
- `sourceFingerprint`.
- `generatedAt`.
- `openItems`: one entry per visible open item snapshot, sorted by ID.
- `openEpics`: one entry per visible open epic snapshot, sorted by ID.
- `preconditions`: item/epic ID, origin, relative path, `updated`, `bodySha256`, and `recordSha256`.
- `dependencies` and `blockers` from `dependencyProjection` / `blockerRiskProjection`.
- `traceSummaries` from `readPlannerTraceSummaries` for all open item IDs.
- `roadmapEvidence` from `docs/roadmap.md`, bounded by excerpt count and string length.
- `recommendations`: `{ exists, modelSummary, modelHash }` from private recommendation storage.
- `truncation`: counts of truncated section strings, roadmap excerpts, and trace details.

Fingerprint computation uses canonical JSON over:

- `schemaVersion`.
- `recommendationSourceProjection` from `buildRecommendationSourceProjection(cwd)`.
- visible open item/epic snapshot preconditions.
- current recommendation model hash.

Long Markdown section values are truncated per string, but no open item or open epic entry is removed. If the final JSON still exceeds the target source-text budget, drop long `sections`/trace detail fields and keep ID/precondition arrays instead of slicing records.

### Analyze-all action

`analyze-all-backlog` behavior:

1. Abort early if `ctx.signal.aborted`.
2. Build curation source and source fingerprint.
3. Serialize start/reuse operations per `(cwd, sourceFingerprint)` to avoid duplicate daemon starts.
4. Read workflow index and inspect existing `backlog-curation` entries with the same source fingerprint.
5. Reuse queued, running, or completed task records when `entry.appliedAt` is absent.
6. Ignore failed, cancelled, missing, and applied entries.
7. Start a new daemon task with:

```ts
{
  kind: 'eforge-plan.planning-draft',
  input: {
    topic: 'Analyze and curate all open eforge-plan backlog records.',
    sourceText,
    requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
    includeRoadmap: true
  }
}
```

8. Record a workflow entry with `purpose: 'backlog-curation'`, empty selection, requested output sections, `includeRoadmap: true`, `sourceFingerprint`, and timestamps.
9. If index recording fails, cancel the newly started daemon task before rethrowing.
10. Return JSON-safe `{ task, entry, sourceFingerprint, reused?: true }`.

### Curation apply pipeline

`applyBacklogCurationDraftFromTask(cwd, task, input, entry)` performs:

1. Verify the task is a completed eforge-plan planning draft with a result.
2. Verify `entry.purpose === 'backlog-curation'` and `entry.sourceFingerprint` exists.
3. Parse `result.backlogCurationDraft` with `EforgePlanPlanningBacklogCurationDraftSchema` from `@eforge-build/client`.
4. Require `draft.sourceFingerprint === entry.sourceFingerprint`.
5. Rebuild current curation source and require `current.sourceFingerprint === draft.sourceFingerprint`.
6. Read current visible item/epic snapshots and build maps by ID.
7. Validate every patch/recheck:
   - item IDs and epic IDs pass `assertSafeBacklogId`;
   - array membership matches `itemChanges`, `epicChanges`, or `noOpRechecks` kind;
   - `precondition.id`, `precondition.kind`, `bodySha256`, optional `recordSha256`, optional `updated`, and optional `sourceFingerprint` match the current snapshot;
   - no duplicate target appears across item patches, epic patches, and no-op rechecks;
   - status values are in existing `BACKLOG_STATUSES`;
   - `depends_on` values reference known prospective item IDs;
   - item `epic` values reference known prospective epic IDs or `null` to remove the link;
   - epic patches reject item-only `epic` metadata;
   - section headings are non-empty single-line headings and operations are `replace` or `append`;
   - material patches include non-empty `rationale`;
   - closed-status transitions and `Evidence` section changes include non-empty `evidence` entries.
8. Build prospective item/epic frontmatter/body in memory, including section operations and evidence appends.
9. Normalize prospective records with existing backlog normalization helpers.
10. If generated recommendations are present, parse them and validate references against prospective item/epic ID sets before any write.
11. Write item and epic records through exact private storage helpers.
12. If recommendations are present, compute the post-write recommendation source fingerprint, write recommendations, and record the recommendation status sidecar with `lastRefreshedBy: 'apply-backlog-curation-draft'`.
13. If recommendations are absent and the recommendation fingerprint changed, mark existing recommendations stale for `backlog-curation` with changed IDs.
14. Mark the workflow entry `appliedAt`.
15. Return counts, changed IDs, rechecked IDs, skipped/needs-input arrays, and optional recommendation output/status.

Validation errors throw `ExtensionActionInputValidationError` with field paths such as `backlogCurationDraft.itemChanges[0].metadata.depends_on[1]` so callers receive `invalid-input` responses.

### Section operation semantics

- `replace` replaces the content under an existing `##`-through-`######` heading with the same title. If the heading is missing, it appends a new `## <heading>` section at the end.
- `append` appends content to an existing section separated by one blank line. If the heading is missing, it appends a new `## <heading>` section.
- Heading matching is case-sensitive after trimming surrounding whitespace.
- Operations never change the top-level `# Title` heading.
- Evidence entries are appended as bullets under `## Evidence` after explicit section operations.

## Testing Strategy

### Unit Tests

- Curation source includes all visible open item IDs when more than 25 items exist.
- Curation source includes all visible open epic IDs when more than 10 epics exist.
- Curation source records item/epic `origin`, `relativePath`, `bodySha256`, `recordSha256`, and `updated` preconditions from storage snapshots.
- Curation source fingerprint changes when an open item body, metadata field used by recommendation fingerprints, roadmap evidence, trace summary, or recommendation model changes.
- Curation section operation helpers replace existing sections, append to existing sections, create missing sections, and leave the top-level title untouched.
- Curation apply validation rejects duplicate targets, malformed headings, unknown statuses, unknown dependencies, unknown epic links, stale preconditions, missing material-change rationale, and missing closed-status evidence before writing files.
- Recommendation reference validation against prospective records rejects unknown item/epic references before backlog writes.
- No-op rechecks update only `last_checked` and `stale_after` and do not set `updated`.

### Integration Tests

- `analyze-all-backlog` starts a daemon task with requested output sections `['backlogCurationDraft', 'recommendations']`, records `purpose: 'backlog-curation'`, includes a 64-character source fingerprint, and carries no `build-queue` side effect.
- `analyze-all-backlog` reuses queued, running, and unapplied completed curation tasks for the same fingerprint.
- `analyze-all-backlog` starts a new task for failed, cancelled, missing, different-fingerprint, and applied completed entries.
- Retry of a curation workflow entry starts a linked task with `purpose: 'backlog-curation'`, current source fingerprint, and curation requested output sections.
- Redraft of a completed curation task with steering starts a linked task whose source text includes prior curation summary plus the steering text.
- Applying a valid curation draft writes only private backlog item/epic files and leaves legacy files byte-for-byte unchanged.
- Applying a stale curation draft returns `invalid-input` and leaves backlog files plus `recommendations/current.json` unchanged.
- Applying a draft with invalid dependency or recommendation references returns `invalid-input` and leaves backlog files plus recommendation storage unchanged.
- Applying curation with recommendations writes the private recommendation model and records a fresh status sidecar whose `lastAppliedSourceFingerprint` equals the post-apply fingerprint.
- Applying no-op rechecks without recommendations leaves an existing fresh recommendation status fresh when `computeRecommendationSourceFingerprint` does not change.
- Applying substantive curation without recommendations marks existing recommendations stale when `computeRecommendationSourceFingerprint` changes.
- Applying a curation task through standalone `applyRecommendations` returns a handler error or invalid-input response and leaves recommendation storage unchanged.
- Analyze-all and curation apply tests pass with a `buildQueue.enqueue` implementation that throws on invocation.

### Regression Tests

- Existing recommendation refresh tests still pass with unchanged recommendation-only requested output sections and source fingerprint behavior.
- Existing session-plan creation task apply, retry, redraft, cancel, remove, and list tests still pass.
- Existing recommendation reference validation tests still pass through the refactored `validateRecommendationReferencesAgainstIds` helper.
- Registration tests prove `analyze-all-backlog` is present, `apply-planning-agent-task-result` exposes curation apply selection/output fields, and neither action has a `build-queue` side effect.

### Targeted Commands

```bash
pnpm test -- eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts
pnpm type-check
```

Later modules and final validation run the full expedition commands.

## Verification

- [ ] `PlanningTaskWorkflowEntrySchema` accepts `purpose: 'backlog-curation'` and optional `appliedAt`.
- [ ] `AnalyzeAllBacklogOutputSchema` validates an output with `task`, `entry`, `sourceFingerprint`, and optional `reused`.
- [ ] `ApplyPlanningAgentTaskResultInputSchema` rejects `applyBacklogCurationDraft` unless `previewAcknowledged` is `true` and `confirmApply` is `true`.
- [ ] `ApplyPlanningAgentTaskResultOutputSchema` validates an output containing `backlogCuration` counts and changed IDs.
- [ ] `buildBacklogCurationSource` returns one `openItems` entry for each visible open item in a 30-item fixture.
- [ ] `buildBacklogCurationSource` returns one `openEpics` entry for each visible open epic in a 12-epic fixture.
- [ ] Each curation source item and epic entry contains `bodySha256` and `recordSha256` matching the storage snapshot helper output.
- [ ] `analyze-all-backlog` starts a daemon task whose request includes `requestedOutputSections: ['backlogCurationDraft', 'recommendations']`.
- [ ] The workflow entry written by `analyze-all-backlog` has `purpose: 'backlog-curation'` and a 64-character hexadecimal `sourceFingerprint`.
- [ ] `analyze-all-backlog` returns `reused: true` for a queued same-fingerprint curation task.
- [ ] `analyze-all-backlog` returns `reused: true` for a running same-fingerprint curation task.
- [ ] `analyze-all-backlog` returns `reused: true` for an unapplied completed same-fingerprint curation task.
- [ ] `analyze-all-backlog` starts a new task when the same-fingerprint completed entry has `appliedAt`.
- [ ] Retry from a curation workflow entry writes a child entry with `parentTaskId`, `purpose: 'backlog-curation'`, and current `sourceFingerprint`.
- [ ] Redraft from a completed curation task with steering writes a child entry with `purpose: 'backlog-curation'` and source text containing the steering text.
- [ ] `apply-planning-agent-task-result` rejects `applyBacklogCurationDraft` when the workflow entry purpose is not `backlog-curation`.
- [ ] `apply-planning-agent-task-result` rejects standalone `applyRecommendations` for a `backlog-curation` workflow entry.
- [ ] Applying a valid item patch updates `status`, `priority`, `tags`, `depends_on`, `epic`, `last_checked`, and `stale_after` in the private item file.
- [ ] Applying a valid epic patch updates `status`, `priority`, `tags`, `depends_on`, `last_checked`, and `stale_after` in the private epic file.
- [ ] Applying `metadata.epic: null` removes the item epic link from the private item frontmatter.
- [ ] Applying a section `replace` operation changes only the targeted Markdown section body.
- [ ] Applying a section `append` operation preserves existing section content and appends the generated content after a blank line.
- [ ] Applying a no-op recheck changes only `last_checked` and `stale_after` for that record.
- [ ] A stale `bodySha256` precondition returns `invalid-input` and leaves private backlog files unchanged.
- [ ] A stale `recordSha256` precondition returns `invalid-input` and leaves private backlog files unchanged.
- [ ] An unknown dependency reference returns `invalid-input` and leaves private backlog files unchanged.
- [ ] An unknown recommendation item or epic reference returns `invalid-input` and leaves private backlog files plus `recommendations/current.json` unchanged.
- [ ] A closed-status patch without evidence returns `invalid-input` and leaves private backlog files unchanged.
- [ ] A successful curation apply writes no `.backlog/items` files.
- [ ] A successful curation apply writes no `.backlog/epics` files.
- [ ] A successful curation apply leaves pre-existing legacy item and epic files byte-for-byte unchanged.
- [ ] Curation apply with generated recommendations writes `.eforge/storage/extensions/eforge-plan/recommendations/current.json`.
- [ ] Curation apply with generated recommendations writes `recommendations/status.json` with `lastRefreshedBy: 'apply-backlog-curation-draft'` and no source drift when the post-apply fingerprint matches.
- [ ] Curation apply without generated recommendations marks existing recommendations stale when the recommendation source fingerprint changes.
- [ ] Curation no-op recheck apply without generated recommendations leaves an existing fresh recommendation sidecar fresh when the recommendation source fingerprint stays the same.
- [ ] Successful curation apply records `appliedAt` on the workflow entry.
- [ ] `analyze-all-backlog` and curation apply tests pass with `buildQueue.enqueue` configured to throw.
- [ ] `pnpm test -- eforge/extensions/eforge-plan/__tests__/backlog-curation-source.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-actions.test.ts eforge/extensions/eforge-plan/__tests__/backlog-curation-apply.test.ts eforge/extensions/eforge-plan/__tests__/planner-agent-task-actions.test.ts eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts eforge/extensions/eforge-plan/__tests__/registration.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "auto",
    "perspectives": ["code", "test"],
    "maxRounds": 1,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
