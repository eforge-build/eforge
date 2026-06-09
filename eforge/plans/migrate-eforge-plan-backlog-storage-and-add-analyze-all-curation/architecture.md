# Architecture: Migrate eforge-plan backlog storage and add analyze-all curation

## Vision and goals

`eforge-plan` becomes the canonical local owner for backlog item and epic records while preserving read-through compatibility for existing legacy `.backlog/items` and `.backlog/epics` files. The workstation gains a manual **Analyze all backlog** flow that starts or reuses a daemon-owned read-only planning task, renders a structured preview, requires explicit confirmation, applies validated private-storage backlog mutations, and records recommendation freshness from the post-curation backlog state.

Codebase exploration found that the requirements are not already implemented:

- `eforge/extensions/eforge-plan/markdown-store.ts` currently resolves item and epic paths under `.backlog/...` and writes there.
- The only durable planning workflow purpose is `recommendation-refresh`; there is no `backlog-curation` purpose.
- `packages/client/src/extension-agent-tasks.ts` has no `backlogCurationDraft` requested output section/result field.
- `packages/engine/src/agents/extension-planning-task.ts` and its prompt have no curation-specific output/tool guidance.
- The workstation exposes `refresh-recommendations` but no manual analyze-all control or curation preview/apply UI.

## Core architectural principles

1. **Extension owns side effects.** The daemon/engine remains a read-only single-shot task runner. Backlog and recommendation mutations happen only inside trusted `eforge-plan` actions after validation.
2. **Private storage is canonical, legacy storage is compatibility input.** Private item/epic records override same-ID legacy records. Writes never create or rewrite `.backlog/items` or `.backlog/epics` files.
3. **Storage migration is centralized.** Keep call sites on `readBacklogItem`, `listBacklogItems`, `writeBacklogItem`, etc.; implement private/legacy behavior in storage helpers, not path rewrites across consumers.
4. **Generated curation is structured and fail-closed.** The planning task must submit a typed `backlogCurationDraft`; malformed output is rejected by the client schema/engine tool before persistence, and apply revalidates before writes.
5. **Validate before writing.** Apply must read current visible records, check preconditions, compute prospective records in memory, validate IDs/dependencies/recommendations against that prospective state, and only then write private records.
6. **Recommendation freshness is post-apply.** When curation includes recommendations, write them only after backlog writes and record freshness against the post-write fingerprint. Validation failures leave the previous recommendation model unchanged.
7. **Low-noise curation.** Rechecks that find no material change may update only `last_checked` and `stale_after`. Evidence sections are for durable signal, not speculative comments.
8. **No build queue coupling.** Analyze-all and curation apply never enqueue builds and carry no `build-queue` side effect.

## Shared data model and contracts

### Backlog storage model

Canonical paths become:

- `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md`
- `.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md`

Legacy compatibility paths remain read-only inputs:

- `.backlog/items/<id>.md`
- `.backlog/epics/<id>.md`

Storage helpers should expose:

- `resolveBacklogItemPath(cwd, id)` / `resolveBacklogEpicPath(cwd, id)` as canonical private paths.
- New explicit legacy helpers such as `resolveLegacyBacklogItemPath` / `resolveLegacyBacklogEpicPath`.
- Read/list helpers that merge private + legacy with private precedence.
- Snapshot helpers for curation preconditions, e.g. `{ record, origin: 'private' | 'legacy', path, updated?, bodySha256, recordSha256 }`.
- Import/copy helpers that copy legacy records into private storage only when the private ID does not already exist.

All path helpers must preserve the existing safe-id checks and SDK path-containment behavior. List/parse paths must assert safe frontmatter IDs, not only write paths. Markdown parse/serialize helpers must preserve the existing frontmatter/body schema and keep existing backlog status/type exports available.

### Planning task wire contract

Add an additive first-party feature-gated contract to `@eforge-build/client`:

- Requested output section literal: `backlogCurationDraft`.
- Result field: `backlogCurationDraft`.
- Result variant: a ready result containing `backlogCurationDraft`, optionally with `recommendations`.
- `hasEforgePlanPlanningDraftOutputSection` must count `backlogCurationDraft` as output.
- Bump `DAEMON_API_VERSION` and the hard-coded daemon API version tests because the first-party workstation will rely on the new task result.

`planning-task-contract` owns the wire schemas and exported TypeScript types in `packages/client/src/extension-agent-tasks.ts`. `curation-workflow` owns extension-side domain validation and apply helpers over those types; it must not define a divergent planning-task wire shape. `workstation-curation-ui` consumes the same serialized task result through the existing bridge/workflow data and may define view-model types derived from the wire type, but not a conflicting result schema.

Recommended curation draft shape:

```ts
interface BacklogCurationDraft {
  schemaVersion: 1;
  sourceFingerprint: string;
  generatedAt?: string;
  summary: string[];
  itemChanges: BacklogCurationRecordPatch[];
  epicChanges: BacklogCurationRecordPatch[];
  noOpRechecks: BacklogCurationRecheck[];
  skipped: BacklogCurationSkipped[];
  needsInput: BacklogCurationNeedsInput[];
}

type BacklogCurationRecordKind = 'item' | 'epic';

interface BacklogCurationPrecondition {
  id: string;
  kind: BacklogCurationRecordKind;
  sourceFingerprint?: string;
  updated?: string;
  bodySha256: string;
  recordSha256?: string;
}

interface BacklogCurationMetadataPatch {
  status?: string; // validated against existing backlog status exports for the record kind
  priority?: string;
  tags?: string[];
  depends_on?: string[];
  epic?: string | null;
  last_checked?: string;
  stale_after?: string;
}

interface BacklogCurationSectionOperation {
  heading: string;
  action: 'replace' | 'append';
  content: string;
}

interface BacklogCurationRecordPatch {
  id: string;
  kind: BacklogCurationRecordKind;
  precondition: BacklogCurationPrecondition;
  metadata?: BacklogCurationMetadataPatch;
  sectionOperations?: BacklogCurationSectionOperation[];
  rationale?: string;
  evidence?: string[];
}

interface BacklogCurationRecheck {
  id: string;
  kind: BacklogCurationRecordKind;
  precondition: BacklogCurationPrecondition;
  last_checked: string;
  stale_after: string;
  rationale?: string;
}

interface BacklogCurationSkipped {
  id?: string;
  kind?: BacklogCurationRecordKind;
  reason: string;
}

interface BacklogCurationNeedsInput {
  id?: string;
  kind?: BacklogCurationRecordKind;
  question: string;
  reason?: string;
}
```

Patch metadata should be structured, not raw Markdown:

- Allowed metadata fields: `status`, `priority`, `tags`, `depends_on`, `epic`, `last_checked`, `stale_after`.
- Body changes are section operations such as `{ heading, action: 'replace' | 'append', content }`.
- `noOpRechecks` may set only `last_checked` and `stale_after`.
- Substantive status/dependency/body changes must include concise `rationale`; closed-status or shipped/superseded/stale changes must include durable evidence text.

### Curation source and fingerprint

Add a curation-specific source builder instead of reusing `boundedSourceText` directly. The current generic bounder can drop items after 25 entries, which conflicts with analyze-all. The curation source must preserve one entry per open item and epic, all IDs, and all precondition hashes; it may truncate long section bodies, trace details, and roadmap excerpts, but it must not silently omit open record IDs.

The curation source should include:

- Visible open item snapshots, including origin and precondition hashes.
- Visible open epic snapshots.
- Dependencies/blockers.
- Roadmap evidence.
- Trace summaries/lifecycle evidence.
- Existing recommendation summary/model when available.
- `sourceFingerprint` derived from the same visible canonical private+legacy backlog projection used for recommendations, plus curation source schema version/precondition data if needed.

### Apply contract

Extend `apply-planning-agent-task-result` with `applyBacklogCurationDraft` (or an equivalent explicit selection object) and return:

- counts of applied item patches, epic patches, and no-op rechecks;
- changed item/epic IDs;
- skipped/needs-input summaries;
- optional recommendation write/status details when recommendations were included.

Apply flow:

1. Fetch completed task and workflow entry.
2. Require entry purpose `backlog-curation` for curation apply.
3. Parse/revalidate `backlogCurationDraft`.
4. Verify source fingerprint and per-record preconditions against current visible records.
5. Validate item IDs, epic IDs, status values, dependency references, epic links, and recommendation references against the prospective post-curation state.
6. If any validation fails, throw a validation error before any backlog or recommendation writes.
7. Write changed items/epics through private storage helpers only.
8. If recommendations are included, write the private recommendation model and record status with the post-write source fingerprint.
9. If no recommendations are included, derive/mark freshness only when fingerprint-relevant curation changes occurred; metadata-only no-op rechecks must not create artificial stale recommendation drift.

## Integration contracts

### Module dependency graph

The module graph is intentionally acyclic:

- `storage-foundation` has no dependency on later modules and produces migrated storage helpers/snapshots.
- `planning-task-contract` has no dependency on extension implementation modules and produces the shared planning-task wire schema.
- `curation-workflow` depends on `storage-foundation` for visible backlog reads/private writes and on `planning-task-contract` for `backlogCurationDraft` request/result types.
- `workstation-curation-ui` depends on the action/workflow contracts exposed by `curation-workflow` and on the serialized task result shape from `planning-task-contract`; backend modules must not import workstation code.
- `docs-assets-validation` runs last and depends on the settled behavior and generated UI bundle; it must not introduce new runtime contracts.

### Shared File Registry

| File | Modules | Region strategy |
| --- | --- | --- |
| `eforge/extensions/eforge-plan/index.ts` | `storage-foundation`, `curation-workflow` | Storage owns existing backlog action descriptions/returned path semantics and legacy import action registration. Curation owns analyze-all action registration, workstation allowed-action additions, and contribution controls. Use non-overlapping exact edits or temporary plan-ID regions if both modules add new action blocks. |
| `eforge/extensions/eforge-plan/__tests__/registration.test.ts` | `storage-foundation`, `curation-workflow` | Storage updates write/read action sets and assertions for import/private paths. Curation updates action ID lists/side-effect assertions for analyze-all and curation apply. Keep separate expectation blocks by action ID. |
| `eforge/extensions/eforge-plan/README.md` | `docs-assets-validation` only | Other modules should not edit README; leave storage/curation behavior documentation to docs-assets-validation after code contracts settle. |
| `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` | `workstation-curation-ui` only | UI module owns source/bundle guard assertions for analyze-all and curation preview. |

#### Region declarations

**`eforge/extensions/eforge-plan/index.ts`**:

- `storage-foundation`: existing `capture-item`, `upsert-epic`, `update-item`, `promote-*`, and input-source description/path edits; optional `import-legacy-backlog` action block near existing backlog actions. If adding a block, use the compiled plan slug region around only the new action definition/registration.
- `curation-workflow`: imports and action block for `analyze-all-backlog` and any curation apply action; console contribution button/form; workstation `allowedActions` entries. Use a separate compiled plan slug region after recommendation/planner action imports and near refresh/planning contribution controls.

**`eforge/extensions/eforge-plan/__tests__/registration.test.ts`**:

- `storage-foundation`: append/import action side-effect expectations in the constants near existing backlog action IDs.
- `curation-workflow`: append analyze/apply side-effect expectations near refresh/planning task IDs.

If a module planner discovers another file must be modified by more than one module, it must update this registry before emitting module plans.

## Technical decisions and rationale

1. **Use `createEforgeProjectPaths(...).extensionStoragePath('project-local', ['backlog', ...])` for canonical paths.** This matches trace/recommendation/planning-task private storage and inherits extension SDK containment checks.
2. **Keep exported storage helper names stable.** Consumers such as board projection, promotion, input-source, lifecycle bootstrap, recommendation fingerprints, and planner context already call helpers; changing helper behavior avoids broad call-site rewrites.
3. **Add focused curation modules instead of expanding `schema.ts` heavily.** `schema.ts` is already near the maintainability cap. Prefer files such as `backlog-curation-schemas.ts`, `backlog-curation-source.ts`, `backlog-curation-apply.ts`, and `backlog-curation-actions.ts` with durable semantic region markers when over 300 lines. Existing backlog status/type exports must remain available after adding these schemas.
4. **Generalize refresh/reuse patterns without changing recommendation-only behavior.** `analyze-all-backlog` should follow `refresh-recommendations` patterns for source fingerprinting, exclusive start chains, workflow index recording, and cancel-on-index-write-failure, but recommendation refresh tests must keep passing unchanged.
5. **Completed curation tasks are reusable for the same fingerprint.** Unlike recommendation refresh, curation has a preview/apply step. Reusing queued/running/completed current-fingerprint tasks prevents duplicate drafts and returns the existing preview until it is applied or removed.
6. **Do not trust agent-authored source IDs beyond the structured draft and preserved workflow context.** Apply validates every referenced ID against current visible storage and curation preconditions.
7. **Keep UI storage-path free.** Backend actions may return private relative paths, but workstation source and built bundles must not hard-code `.eforge/storage/extensions/...` or import private Console APIs.

## Module breakdown

### 1. `storage-foundation`

Implement canonical private backlog storage and legacy read-through/import compatibility.

Primary files:

- `eforge/extensions/eforge-plan/markdown-store.ts`
- `eforge/extensions/eforge-plan/backlog-domain.ts` if snapshot/hash helpers need domain types
- `eforge/extensions/eforge-plan/index.ts` for existing action path descriptions/outputs and import action registration
- `eforge/extensions/eforge-plan/__tests__/storage.test.ts`
- possibly a new focused storage test file under `eforge/extensions/eforge-plan/__tests__/`

Key requirements:

- Canonical path helpers resolve under `.eforge/storage/extensions/eforge-plan/backlog/...`.
- Legacy path helpers resolve under `.backlog/...` for compatibility only.
- Reads/lists merge private+legacy with private precedence.
- Parse and serialize the existing Markdown/frontmatter schema unchanged, including safe frontmatter ID validation.
- Preserve existing backlog status/type exports while adding any snapshot/hash domain helpers.
- Writes/update-frontmatter write private files only, copying visible legacy body/frontmatter when updating a legacy-only record.
- Explicit import/copy helpers/actions copy legacy records to private storage, skip duplicate private IDs, and do not delete legacy files.
- Board, promotion, input-source, lifecycle, recommendation, and planner consumers continue working through existing helper exports.

### 2. `planning-task-contract`

Extend the daemon-owned extension planning task contract for structured curation output.

Primary files:

- `packages/client/src/extension-agent-tasks.ts`
- `packages/client/src/api-version-const.ts`
- `test/daemon-api-version.test.ts`
- `packages/client/src/__tests__/extension-agent-tasks.test.ts`
- `packages/client/src/__tests__/extension-agent-task-creation-draft.test.ts` if shared assertions need updating
- `packages/engine/src/agents/extension-planning-task.ts`
- `packages/engine/src/prompts/eforge-plan-planning-draft.md`
- `test/extension-planning-task.test.ts`

Key requirements:

- Add `backlogCurationDraft` requested output section and result schema/type exports.
- Extend the engine custom submit tool schema and prompt guidance.
- Reject malformed curation task submissions before task completion/persistence.
- Preserve existing session-plan creation and needs-input task behavior.
- Bump daemon API version and tests with a concise v63 rationale.

### 3. `curation-workflow`

Add analyze-all start/reuse, workflow purpose support, curation source building, apply validation, private writes, and post-curation recommendation freshness.

Primary files:

- New focused modules under `eforge/extensions/eforge-plan/` for curation source/apply/actions/schemas
- `eforge/extensions/eforge-plan/planning-agent-task-schemas.ts`
- `eforge/extensions/eforge-plan/planning-task-workflow-store.ts`
- `eforge/extensions/eforge-plan/agent-task-actions.ts`
- `eforge/extensions/eforge-plan/recommendation-refresh.ts` only if shared start/reuse utilities are extracted
- `eforge/extensions/eforge-plan/planner-orchestration.ts`
- `eforge/extensions/eforge-plan/recommendation-status.ts`
- `eforge/extensions/eforge-plan/recommendations-store.ts` if validating recommendations against prospective IDs requires reusable helpers
- `eforge/extensions/eforge-plan/index.ts`
- `eforge/extensions/eforge-plan/__tests__/recommendation-refresh-actions.test.ts` only to prove unchanged behavior if touched
- New/updated curation action tests under `eforge/extensions/eforge-plan/__tests__/`

Key requirements:

- Add workflow purpose `backlog-curation`.
- Add `analyze-all-backlog` action that starts or reuses a current-fingerprint daemon task requesting `['backlogCurationDraft', 'recommendations']`.
- Ensure existing planning-task lifecycle actions (retry, redraft, cancel, remove, and apply, or their current equivalents) accept `backlog-curation` workflow entries with the same semantics as recommendation-refresh tasks.
- Retry/redraft preserve and refresh curation source metadata like recommendation refresh does.
- Cancel/remove remain task/workflow lifecycle operations only and do not mutate backlog records, recommendations, or build queues.
- Extend apply path for curation drafts with validation-first semantics and private-only writes.
- Validate stale preconditions, IDs, dependencies, statuses, epic links, body section operations, low-noise rechecks, and recommendation references.
- Ensure failures do not write backlog records or recommendations.
- Ensure successful curation+recommendations writes recommendations/status using the post-apply fingerprint.
- Ensure analyze-all and apply carry no build queue side effects.

### 4. `workstation-curation-ui`

Expose analyze-all in the Backlog workstation, render curation task previews, and apply through existing `window.eforge.invokeAction` workflows.

Primary files:

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/use-planning-task-workflows.ts`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog-view.tsx`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/recommendations-panel.tsx`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/plan-with-ai-panel.tsx`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-card.tsx`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/planning-task-result-preview.tsx`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts`
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts`
- Workstation source tests under `workstation-src/plans/src/**`
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts`

Key requirements:

- Add a clear **Analyze all backlog** control that invokes `analyze-all-backlog` through the bridge.
- Extend the workflow hook with `analyzeAllBacklog()` and keep all action invocation through `bridge.invokeAction`.
- Label `backlog-curation` tasks in Plan with AI.
- Surface retry, redraft, cancel, remove, and apply controls for `backlog-curation` tasks through the same bridge path used by recommendation-refresh tasks.
- Render read-only previews for item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, and generated recommendations.
- Require two explicit in-app confirmation steps before applying curation.
- Ensure recommendations and backlog panels handle curation running/completed/validation-error states without raw fetches or private Console imports.
- Extend mocks with curation tasks/results and bridge cases.
- Keep bundle/source tests asserting no raw `fetch`, no private Console imports, and no private storage path leakage.

### 5. `docs-assets-validation`

Synchronize user-facing docs, README contract tests, generated workstation assets, and final validation gates.

Primary files:

- `eforge/extensions/eforge-plan/README.md`
- `eforge/extensions/eforge-plan/__tests__/readme-contract.test.ts`
- `eforge/extensions/eforge-plan/workstation-assets/plans/*` generated by `pnpm build:eforge-plan-workstation`
- Any drift tests that assert `.backlog/items` or `.backlog/epics` are canonical

Key requirements:

- Document private item/epic storage and legacy read-through/import semantics.
- Document analyze-all action(s), task monitor behavior, preview/apply confirmation, non-goals, no enqueueing, no shipped-without-evidence rule, and post-curation recommendation freshness.
- Keep `.backlog/recommendations.json` documented as unsupported legacy recommendation storage.
- Update README contract tests away from `.backlog/items`/`.backlog/epics` as canonical storage.
- Rebuild workstation assets after UI changes.

## Quality attributes

- **Safety:** stale preconditions and invalid references fail before writes; malformed generated output is rejected by schemas.
- **Compatibility:** existing legacy records remain visible until explicitly imported or superseded by private records.
- **Determinism:** merged listings sort deterministically and private duplicate precedence is test-covered.
- **Boundedness:** curation source preserves all record IDs/preconditions while truncating long text; it does not silently omit open records.
- **Maintainability:** keep new implementation files under 600 lines; add durable semantic region markers for large files over 300 lines; avoid growing near-cap files such as `schema.ts` when a focused module is better.
- **No API drift:** route constants and daemon wire shapes remain in `@eforge-build/client`; additive first-party task contract changes bump `DAEMON_API_VERSION`.

## Validation commands

Run after all modules merge:

```bash
pnpm build:eforge-plan-workstation
pnpm type-check
pnpm test
pnpm maintainability:check
```
