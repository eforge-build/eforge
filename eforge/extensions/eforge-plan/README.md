# eforge-plan Extension

`eforge-plan` is a reference extension for curating a project-local backlog and promoting selected backlog items into normal eforge build inputs. It is intentionally dogfoodable: project teams can keep lightweight planning records in the repository, render a derived kanban board, promote work into session plans, and correlate later eforge lifecycle events back to the originating backlog item.

The extension does not replace session plans, playbooks, or normalized build-source preprocessing. It produces ordinary build-source Markdown and `.eforge/session-plans/<session>.md` artifacts that the existing eforge engine can consume.

## Trust model

Extensions run as project-team code. Install and enable `eforge-plan` only in repositories where you trust the extension source and the team-maintained backlog content.

`eforge-plan` is not a sandbox boundary. Actions can read and write project-local files, and the lifecycle hooks update extension-owned sidecars. The Console workstation is served from packaged browser assets whose files are covered by the extension trust hash. Review extension changes with the same care as build tooling, scripts, or other automation that runs in the repository.

Private planning state is stored under `.eforge/storage/extensions/eforge-plan/`. Treat that directory as local/private project metadata: it can include backlog records, recommendation models, roadmap steering, lifecycle traces, accepted-analysis baselines, revision annotations, and AI task workflow indexes. Do not assume it is safe to publish without review.

## Install and manage

`eforge-plan` is published as the first-party npm package `@eforge-build/eforge-plan`. The package declares `eforge.extension.name: "eforge-plan"` and loads from the compiled runtime entrypoint `./dist/index.js`.

```bash
# Install from npm into the default local scope (.eforge/extensions/)
eforge extension install @eforge-build/eforge-plan

# Install from a local package directory or packed tarball after building
eforge extension install ./eforge/extensions/eforge-plan
eforge extension install ./eforge/extensions/eforge-plan/eforge-build-eforge-plan-<version>.tgz

# Install into the project/team scope and trust the reviewed artifact
eforge extension install @eforge-build/eforge-plan --scope project --trust
```

Scope behavior follows normal extension management rules:

- `local` (default) installs under `.eforge/extensions/` and loads without a project/team trust record.
- `project` installs under `eforge/extensions/`; each user must inspect and run `eforge extension trust eforge-plan`, or install/update with `--trust`, before it loads.
- `user` installs under the user eforge config directory and is trusted for that user.

Common lifecycle commands:

```bash
eforge extension validate eforge-plan
eforge extension trust eforge-plan
eforge extension reload
eforge extension show eforge-plan

eforge extension update eforge-plan
eforge extension update eforge-plan --version latest
eforge extension update eforge-plan --version 0.9.0

eforge extension remove eforge-plan
```

`--version <specifier>` is for npm-installed extensions and may be a version, range, or dist-tag understood by npm. Local directory and tarball installs update from their recorded sidecar source rather than from a registry version specifier. Updating a project/team install changes the reviewed hash; update with `--trust` after inspection or run `eforge extension trust eforge-plan` again before reloading.

The npm artifact contains the compiled runtime in `dist/`, the generated workstation bundle in `workstation-assets/plans/`, `README.md`, `LICENSE`, and package metadata. Source-only workstation files, tests, and development config are not part of the runtime artifact.

## Enable

After adding, installing, or changing the extension, validate, trust when required, and reload it from the repository root:

```bash
eforge extension validate eforge-plan
eforge extension trust eforge-plan
eforge extension reload
```

Run `eforge extension show eforge-plan` to confirm the registered actions, integration commands, deep links, Console workstation, and input source.

## Declared capabilities

The directory extension manifest declares two stable first-party capabilities:

- `eforge.plan.planning-workstation` version `1.0.0` — the extension owns the rich planning workstation UI.
- `eforge.plan.planning-mode-playbook` version `1.0.0` — planning-mode playbook hosts may depend on this capability before offering planning continuation.

Planning entry is exposed through generic extension contribution discovery. Hosts can list/invoke the `eforge-plan:open-planning-entry` action or integration command, or follow the action-backed `eforge-plan:planning-workstation` deep link. All return or point at the workstation URL `/console/workstations/eforge-plan%3Aplanning-workstation`.

## Usage

Registered action IDs can be invoked by hosts that expose extension actions:

- `capture-item` example input: `{ "title": "Add import preview", "claim": "Users need to inspect imports before enqueue.", "evidence": "Support tickets mention import mistakes.", "tags": ["ux"], "priority": "high", "epic": "planning", "dependsOn": [], "acceptanceCriteria": "Preview renders changed files and can be cancelled." }`
- `update-item` example input: `{ "id": "add-import-preview", "status": "planned", "priority": "high", "tags": ["ux", "ready"], "evidenceNotes": "Validated with design review.", "recheckNotes": "Recheck after first import flow lands.", "dependsOn": ["import-parser"], "epic": "planning" }`
- `promote-item` example input: `{ "itemId": "add-import-preview", "status": "active", "session": "2026-06-05-add-import-preview", "profile": "excursion" }`
- `render-board-markdown` example input: `{ "includeArchive": false }`
- `list-board-compact` example input: `{ "epic": "planning", "limit": 20, "offset": 0 }`; returns bounded open item summaries by default plus lane counts, total/open/closed counts, pagination metadata, and epic counts without full board payloads. Closed lanes are lazy: request them explicitly with inputs such as `{ "lane": "done", "includeClosed": true, "limit": 20, "offset": 0 }` or `{ "lane": "archive", "includeClosed": true, "includeArchive": true }`.
- `get-item` example input: `{ "id": "add-import-preview" }`; returns one item with compact dependency/dependent summaries, lifecycle evidence rows, and Markdown sections. The workstation calls this lazily when a detail drawer opens. Pass `includeBody: true` only when raw item Markdown is needed.
- `get-epic` example input: `{ "id": "planning", "limit": 20, "offset": 0 }`; returns one epic with paginated compact item summaries. Pass `includeBody: true` only when raw epic Markdown is needed.
- `search-items` example input: `{ "query": "import preview", "status": "planned", "limit": 20 }`; searches by id/title/tags/epic with bounded compact output. Pass `searchBody: true` only when Markdown body search is needed.
- `list-planning-artifacts` example input: `{ "includeSubmitted": false, "includeBoard": false }`; returns planning artifacts only by default (`artifacts`, `plans`, and `planSets`) without rich board data. Submitted flat plans and submitted plan sets are omitted unless `includeSubmitted: true`; legacy callers that intentionally need the old rich board field may pass `includeBoard: true` with `includeArchive`/`epic` filters.
- `show-session-plan` example input: `{ "session": "2026-06-05-add-import-preview" }`
- `show-session-plan-set` example input: `{ "planSetId": "import-workflow" }`
- `create-session-plan` example input: `{ "session": "2026-06-05-add-import-preview", "topic": "Add import preview", "planningType": "feature", "planningDepth": "focused", "profile": "excursion", "agentProfile": "frontend" }`
- `set-session-plan-section` example input: `{ "session": "2026-06-05-add-import-preview", "dimension": "scope", "content": "Implement preview rendering and cancel handling." }`
- `check-session-plan-readiness` example input: `{ "session": "2026-06-05-add-import-preview" }`
- `set-session-plan-ready` example input: `{ "session": "2026-06-05-add-import-preview" }`; returns `kind: "not-ready"` instead of mutating when required dimensions or acceptance criteria checks fail.
- `handoff-session-plan` example input: `{ "session": "2026-06-05-add-import-preview" }`; requires the plan to be ready and `status: ready`, then enqueues the session plan through the daemon build queue.
- `get-recommendations` reads the private recommendation model and returns the server-derived recommendation freshness view (`missing`, `fresh`, or `stale`), compatibility status/stale reason metadata, the private storage paths, and any active recommendation refresh task.
- `put-recommendations` validates item/epic references and writes the private recommendation model, then records a fresh status sidecar for the current backlog fingerprint with `lastRefreshedBy: "put-recommendations"`; it does not create an accepted-analysis git baseline.
- `get-roadmap-state` example input: `{ "includeLocalFocusContent": true }`; reads private local-focus roadmap state, configured shared-source metadata, discovered conventional context such as `docs/roadmap.md`, conflicts, assumptions, and truncation metadata.
- `update-roadmap-state` example input: `{ "localFocusContent": "# Focus\n\nShip local roadmaps.\n", "expectedLocalFocusSha256": "..." }`; writes only private local-focus roadmap content and/or shared-source configuration under extension storage. Shared-source paths are normalized before storage; disabled sources remain metadata only. Configured shared project files are read-only context and are not rewritten.
- `analyze-all-backlog` example inputs: `{ "scanMode": "delta" }` (default) or `{ "scanMode": "full-implementation-audit" }`; starts or reuses an active daemon-owned backlog curation task for the selected scan mode without doing source assembly inside the short action request. `delta` is the normal workstation default and focuses on bounded changes since the accepted-analysis baseline. `full-implementation-audit` is an explicit opt-in mode for a broader audit across open backlog items; it may take longer and use more context, is comprehensive over open items, and is still bounded by configured caps plus available git/PR history. The task requests both `backlogCurationDraft` and `recommendations` output and does not enqueue builds. Its background curation source includes a bounded top-level `gitDelta` projection (`gitDelta.baseline.commit`, `gitDelta.baseline.time`, `gitDelta.baseline.source`, `gitDelta.currentHead`, `gitDelta.scannedCommitCount`, scanned commits, scan caps, coverage, diagnostics, and deterministic affected item candidates with matched signals) plus bounded git/PR history shipped or superseded evidence alongside lifecycle trace evidence. Full-audit previews additionally expose server-provided audit coverage, caps, diagnostics, evidence source, and confidence metadata. Git-delta diagnostics include `baseline-missing`, `baseline-invalid-sidecar`, `baseline-unreachable`, `baseline-shallow`, `git-unavailable`, `git-command-failed`, `scan-cap-truncated`, and `pr-enrichment-unavailable`; missing, invalid, unreachable, shallow, and no-git baseline states are fallback or unavailable coverage, not complete git-delta coverage. Full-audit cap fields include `fileScanCount`, `fileBytes`, `evidencePerItem`, `pathsPerCategory`, `excerptBytes`, `diagnosticCount`, `gitCommitScanCount`, and `prEnrichmentCount`; full-audit diagnostics include `file-scan-cap-truncated`, `file-read-failed`, `git-history-unavailable`, `pr-enrichment-unavailable`, and `evidence-cap-truncated`. Full-audit diagnostics are warning/info preview metadata, not reasons to hide the preview. The optional PR enrichment through `gh` is fail-closed and not required; it uses the GitHub CLI (`gh pr view`) when available and authenticated, may perform network access, so unavailable `gh`, unauthenticated access, timeouts, or command failures leave bounded git-only candidate evidence in place instead of failing the task. Deterministic matching considers item ids, titles, slugs, changed paths, branch hints, PR numbers/titles/bodies/files, merge subjects, and bounded excerpts. This is the primary workstation path for refreshing recommendations because normal confirmed curation applies the generated recommendation model against the post-curation backlog state; curation-only apply intentionally discards generated recommendations.
- `refresh-recommendations` example input: `{}`; starts or reuses a daemon-owned recommendation-only planning task for the current open backlog and roadmap-context fingerprint. This action remains available as a lower-level/API compatibility path and is allowed for roadmap refresh flows.
- `import-legacy-backlog` example input: `{ "kind": "all" }`; copies validated legacy `.backlog` item and epic records into private eforge-plan backlog storage, skips IDs that already exist privately, and leaves legacy files in place.
- `promote-selection` example input: `{ "itemIds": ["add-import-preview"], "status": "active" }`; also accepts `{ "recommendationRef": "next-one" }` or `{ "epicId": "planning" }` selectors.
- `prepare-planner-context` example input: `{ "itemIds": ["add-import-preview"], "includeRoadmap": true }`; returns JSON-safe selected/open backlog items, epics, recommendations, dependency/blocker context, roadmap context, and relevant trace summaries.
- `apply-planner-result` example input: `{ "recommendations": { "schemaVersion": 1, "activeWork": [], "readyCandidates": [{ "itemId": "add-import-preview" }], "recommendedNextSequence": [{ "itemId": "add-import-preview", "rationale": "Ready and high priority." }], "safeParallelizableGroups": [], "blockedChains": [], "rationaleAndAssumptions": ["Import preview is unblocked."] } }` or `{ "handoffDraft": { "selection": { "itemIds": ["add-import-preview"], "status": "active" } } }`; applies only structured recommendation models and promotion selections.
- `start-planning-agent-task` example input: `{ "userGoal": "Find the safest next import-preview work", "itemIds": ["add-import-preview"], "includeRoadmap": true }`; prepares bounded planner context, then starts a daemon-owned `eforge-plan.planning-draft` task. `userGoal` is optional: when omitted, the AI-first flow derives the goal from the selection (`itemIds`, `epicId`, or `recommendationRef`), e.g. `{ "itemIds": ["add-import-preview"] }`, `{ "epicId": "planning" }`, or `{ "recommendationRef": "next-one" }`. Callers that plan an explicit ready subset from a recommendation lane may send `{ "itemIds": ["add-import-preview"], "sourceRecommendationRef": "lane-one" }` to keep provenance without using `recommendationRef` as the selector.
- `get-planning-agent-task` example input: `{ "taskId": "task_123" }`; returns the daemon task record for polling status and result data.
- `cancel-planning-agent-task` example input: `{ "taskId": "task_123" }`; requests cancellation through the daemon-owned task API.
- `list-planning-agent-tasks` example input: `{}`; projects the durable planning task workflow index and joins owner-scoped daemon task records so the monitor can discover, poll, retry, and redraft tasks across reloads.
- `retry-planning-agent-task` example input: `{ "taskId": "task_123" }`; starts a new planning task reusing the preserved request context (selection, requested output sections, planning settings) of a prior task.
- `redraft-planning-agent-task` example input: `{ "taskId": "task_123", "answers": ["Target the import-preview milestone."], "steering": "Keep the scope to the preview rail only." }`; starts a linked redraft of a completed needs-input task, carrying the prior summary and clarification questions plus the user's answers or steering.
- `apply-planning-agent-task-result` example input: `{ "taskId": "task_123", "applyRecommendations": true, "applySessionPlanDrafts": [{ "session": "2026-06-05-add-import-preview", "sections": ["scope", "acceptance-criteria"] }] }`; fetches a completed planning-draft task and writes only the selected recommendation, handoff, or session-plan draft portions through the same safe mutation paths used by the non-agent planner actions. To apply a ready session-plan creation draft instead, pass `applySessionPlanCreationDraft`, e.g. `{ "taskId": "task_123", "applySessionPlanCreationDraft": {} }`, which writes the generated session plan through `applySessionPlanCreationDraft`. To apply a backlog curation draft, pass `applyBacklogCurationDraft` with both literal confirmation flags, e.g. `{ "taskId": "task_123", "applyBacklogCurationDraft": { "previewAcknowledged": true, "confirmApply": true } }`; this selection cannot be combined with unrelated apply selections. Preview and apply use the same prospective `recommendationProjection`: draft status changes are applied in memory, closed targets are removed, draft-active/planned targets may be repositioned, and unknown, closed, empty, or `wrong-lane` references block normal curation apply. Users may explicitly apply curation only while discarding generated recommendations by adding `"applyCurationOnly": true`, e.g. `{ "taskId": "task_123", "applyBacklogCurationDraft": { "previewAcknowledged": true, "confirmApply": true, "applyCurationOnly": true } }`. Raw generated task output remains preserved as provenance. Normal curation apply writes only `recommendationProjection.effectiveRecommendations`; curation-only apply omits `backlogCuration.recommendations` and returns `backlogCuration.recommendationsSkipped` with reason `apply-curation-only` plus projection validation details.
- `start-plan-revision-session` example input: `{ "session": "2026-06-05-add-import-preview" }`; creates or resumes a private revision thread for an existing flat session plan and returns plan/readiness details.
- `list-plan-revision-sessions` example input: `{ "includePlan": true }`; lists persisted revision threads joined to owner-scoped daemon task records. Annotation arrays are included only when `includePlan` is true.
- `get-plan-revision-session` example input: `{ "session": "2026-06-05-add-import-preview" }`; returns one revision thread by session or `threadId`, including persisted annotations.
- `create-plan-revision-annotation` example input: `{ "session": "2026-06-05-add-import-preview", "body": "Clarify the rollout constraint.", "target": { "kind": "selection", "dimension": "scope", "capturedText": "Existing scope text", "quoteContext": { "exact": "Existing scope text" } } }`; persists a bounded semantic/quote-context annotation for a flat session-plan revision session. Durable targets require captured text and quote context; DOM-offset-only targets are rejected.
- `update-plan-revision-annotation`, `delete-plan-revision-annotation`, `resolve-plan-revision-annotation`, and `dismiss-plan-revision-annotation` mutate existing revision annotations and return the updated session projection with annotations.
- `start-plan-revision-turn` example input: `{ "session": "2026-06-05-add-import-preview", "message": "Tighten the scope section." }`; starts one read-only `eforge-plan.planning-draft` task with `requestedOutputSections: ["planRevisionTurn"]` against the current flat plan fingerprint. Annotation-driven turns may also pass `annotationIds`, `includeOpenAnnotations`, and `steering`; selected/open annotations and steering are snapshotted onto the durable turn before the task starts. Selected annotation IDs must still be unresolved, and open-annotation-only requests require at least one unresolved annotation.
- `retry-plan-revision-turn` example input: `{ "session": "2026-06-05-add-import-preview", "turnId": "turn_123" }`; retries a linked turn, or redrafts a completed needs-input turn when `answers` or `steering` are provided, preserving the parent annotation snapshot when present.
- `cancel-plan-revision-turn` example input: `{ "session": "2026-06-05-add-import-preview", "turnId": "turn_123", "reason": "Superseded." }`; cancels the linked daemon task.
- `apply-plan-revision-turn` example input: `{ "session": "2026-06-05-add-import-preview", "turnId": "turn_123" }`; writes all structured section patches from the completed revision turn through adapter-backed section mutations, applies any resolved open questions from the patch metadata to the plan's `open_questions`, resolves referenced open annotations from the turn snapshot, then refreshes readiness. The workstation calls this automatically as soon as a turn produces a patch, so there is no separate section-selection or apply-confirmation step. Apply is idempotent: re-applying an already-applied turn returns `kind: "applied"` without rewriting the plan or changing annotation resolution timestamps. Answer-only, mismatched, invalid-patch, needs-input, failed, or cancelled turns return `kind: "not-applicable"` without writing session-plan sections or resolving annotations.

Integration command IDs are `open-planning-entry`, `render-board`, `promote-item`, and `promote-selection`. Deep-link IDs are `planning-workstation`, `board`, `promote`, and `promote-selection`; they dispatch `open-planning-entry`, `render-board-markdown`, `promote-item`, and `promote-selection` respectively. The planning entry action returns the eforge-plan workstation route `/console/workstations/eforge-plan%3Aplanning-workstation`. The input-source URI form is:

```text
eforge://input/eforge-plan/<itemId>
```

For example, enqueue `eforge://input/eforge-plan/add-import-preview` to compile that backlog item into build-source Markdown.

## Storage model

`eforge-plan` uses project-local storage only:

- `.eforge/storage/extensions/eforge-plan/backlog/items/<id>.md` stores canonical backlog items.
- `.eforge/storage/extensions/eforge-plan/backlog/epics/<id>.md` stores canonical epics.
- `.backlog/items/<id>.md` and `.backlog/epics/<id>.md` are legacy read-through and explicit import inputs.
- `.eforge/session-plans/<session>.md` stores promoted session-plan artifacts.
- `.eforge/storage/extensions/eforge-plan/traces/<itemId>.json` stores lifecycle trace sidecars as extension-owned private metadata.
- `.eforge/storage/extensions/eforge-plan/recommendations/current.json` stores the project-local private recommendation model used by recommendation and planner actions.
- `.eforge/storage/extensions/eforge-plan/recommendations/status.json` stores the private derived recommendation status sidecar. It records freshness timestamps, the source fingerprint used when recommendations were last applied, the mutation path that last refreshed recommendations, and a bounded history of structured stale reasons.
- `.eforge/storage/extensions/eforge-plan/analysis-baseline/current.json` stores the schema-versioned accepted-analysis baseline when one has been recorded after a successful accepted backlog-curation apply or preserved recommendation-refresh apply with a source fingerprint. The sidecar records `acceptedAt`, `taskId`, mode-aware `passKind` values such as `backlog-curation:delta` or `backlog-curation:full-implementation-audit`, `sourceFingerprint`, `git.headCommit`, `git.headCommittedAt`, coverage (`complete`, `fallback`, or `unavailable`), and diagnostics, and is used by analyze-all source assembly to decide whether git-delta coverage is complete, fallback, or unavailable. Manual `put-recommendations` writes update recommendation freshness only and do not create an accepted-analysis git baseline. Missing, invalid, unreachable, shallow, or no-git baseline states are loaded as diagnostics and produce fallback or unavailable coverage labels, not complete git-delta coverage. Baseline metadata is not encoded into backlog item or epic bodies, recommendation model JSON, or legacy `.backlog/recommendations.json`.
- `.eforge/storage/extensions/eforge-plan/backlog-curation-sources/<sourceFingerprint>.json` stores server-generated backlog curation preview metadata for a curation source fingerprint, such as `scanMode`, `gitDelta`, and optional `fullImplementationAudit` coverage, caps, diagnostics, and evidence summaries used by the workstation preview.
- `.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md` stores the editable developer-local focus roadmap used as local steering context.
- `.eforge/storage/extensions/eforge-plan/roadmaps/config.json` stores configured shared roadmap source metadata with normalized project-relative paths. Shared project roadmap files remain read-only context; disabled entries remain metadata only and conventional files such as `docs/roadmap.md` may be discovered as non-canonical shared context when not enabled as configured sources.
- `.eforge/storage/extensions/eforge-plan/planning-tasks/index.json` stores the extension-owned durable planning workflow index used by the "Plan with AI" monitor for AI planning task discovery, polling, retry, redraft context, recommendation refresh task discovery, mode-labeled backlog curation task discovery, and applied curation markers across reloads.
- `.eforge/storage/extensions/eforge-plan/plan-revisions/index.json` stores private revision-session threads for existing flat session plans, including annotations, turn/task links, annotation snapshots, base fingerprints, section hashes, retry/redraft linkage, and applied section metadata.

The extension never reads or writes legacy `.backlog/recommendations.json`; recommendation state lives only in private extension storage. Backlog records, trace sidecars, recommendation files, backlog curation source preview sidecars, planning task workflow records, and plan revision session records are private extension storage; session plans are public build inputs under `.eforge/session-plans/`.

Backlog item and epic files are Markdown documents with frontmatter. Legacy `.backlog` item and epic files remain readable compatibility input when no private record has the same ID, and private records take precedence over same-ID legacy records. Writes from capture, update, upsert, and promotion helpers target private backlog storage only; legacy item and epic files are not deleted or rewritten by default. The `import-legacy-backlog` action is an explicit copy/import operation that skips IDs already present in private storage and leaves legacy files in place. The existing safe-id and path-containment checks apply to private backlog reads/writes and legacy compatibility/import reads. The item body remains the durable human-authored planning record; update actions preserve body content while changing supported frontmatter fields, including `evidence_notes` and `recheck_notes`.

Recommendation freshness is derived by comparing stored recommendation/source fingerprint data in `current.json` and `status.json` against the current or prospective source fingerprint of open backlog items, epics, dependency/blocker context, roadmap context, and trace summaries for current open backlog items. Trace summaries preserve historical sidecar rows, but their active fields are projected only from current editable plan evidence, live queue/run/build evidence, current PR-open/landing evidence, or explicit `active` backlog status rather than from durable sidecar rows alone:

| State | Meaning |
| --- | --- |
| `missing` | No private recommendation model exists at `.eforge/storage/extensions/eforge-plan/recommendations/current.json`, and no stale status sidecar has been recorded. |
| `fresh` | `current.json` exists and `status.json` matches the current recommendation source fingerprint with no stale reasons. |
| `stale` | A stale sidecar exists, or `current.json` exists but the sidecar is missing/invalid, records stale reasons, or its last-applied fingerprint differs from the current source fingerprint. |

Deterministic git-delta matching considers item ids, titles, slugs, changed paths, branch hints, PR numbers/titles/bodies/files, merge subjects, and bounded excerpts. Strong closed-status patches use exact evidence prefixes: `Shipped evidence: lifecycle trace — `, `Shipped evidence: inferred from git/PR history — `, `Superseded evidence: lifecycle trace — `, and `Superseded evidence: inferred from git/PR history — `. Ambiguous closure evidence is routed to skipped or needs-input rather than status changes with exact prefixes `Ambiguous shipped candidate: needs input — ` and `Ambiguous superseded candidate: needs input — `.

The status sidecar and action outputs expose `freshAt`, `staleSince`, `lastRefreshedBy`, and structured `reasons` entries. Lifecycle stale reasons include `eventType`, affected `itemIds`, `correlationKind` (`single`, `multi`, or `bootstrapped`), `timestamp`, and a bounded `summary`; compatibility fields such as `code`, `message`, `refs`, `sourceFingerprint`, `lastAppliedSourceFingerprint`, `state`, and `staleReasons` remain available for existing consumers. Persisted reason history is deduplicated for exact repeats and trimmed to the latest 20 entries. A correlated lifecycle event can therefore make recommendations stale before `current.json` exists; in that case `get-recommendations` returns stale freshness with `recommendations: null` instead of creating or backfilling a model.

Lifecycle hooks are invalidators only. After a lifecycle event has been correlated to one or more backlog items and trace/status sidecars have been updated, the hook records structured stale metadata and invalidates recommendation freshness. Uncorrelated or ambiguous lifecycle events do not dirty recommendation freshness, and lifecycle hooks never start daemon-owned agent tasks or host-specific planning commands. Freshness is restored only through explicit recommendation apply or refresh paths: confirmed `applyBacklogCurationDraft` output from the primary `analyze-all-backlog` flow when it includes generated recommendations, `refresh-recommendations` as a lower-level recommendation-only path, `apply-planner-result`, `apply-planning-agent-task-result`, or `put-recommendations`.

Recommendation model writes validate references before changing storage: `put-recommendations`, `apply-planner-result`, `apply-planning-agent-task-result`, and confirmed `applyBacklogCurationDraft` output reject unknown `itemId`/`epicIds` references, closed item/epic recommendation references, and empty safe-parallelizable group `itemIds`. Generated recommendations from a backlog curation draft are projected against the prospective post-curation backlog state before preview validation and apply validation: proposed item/epic status changes are applied in memory, closed targets are removed, draft-active targets are moved to `activeWork`, draft-planned targets can move from `activeWork` to `readyCandidates`, and curation-specific placement validation reports `wrong-lane` issues. Backlog curation task list entries can include preview-time generated recommendation validation and `recommendationProjection` metadata so the workstation can show `effectiveRecommendations`, removed/repositioned targets, and invalid generated recommendation references before apply; backend apply repeats validation and remains authoritative. Raw generated task output remains preserved as provenance; the effective prospective projection is what preview displays and normal apply writes. Validation, reference, and curation precondition failures leave the existing `current.json`, status sidecar, and accepted-analysis baseline unchanged; there are no partial writes. Successful writes update `current.json` first, then derive freshness from the applied source fingerprint. When curation output includes generated recommendations, confirmed `applyBacklogCurationDraft` writes private backlog records first, writes only the effective projected recommendation model after validation succeeds, records freshness against the post-apply/post-curation backlog fingerprint with `lastRefreshedBy: "apply-backlog-curation-draft"`, and records an accepted-analysis baseline when the draft has a source fingerprint. Curation-only apply writes backlog changes, skips recommendation writes, returns projection metadata, records the accepted backlog-curation baseline when the draft has a source fingerprint, and leaves discarded generated recommendations unfresh rather than labeling them fresh. A preserved `recommendation-refresh` workflow entry applied through `apply-planning-agent-task-result` records an accepted-analysis baseline when the entry has a source fingerprint; direct `apply-planner-result` and `put-recommendations` do not. If the recommendation fingerprint has drifted by the time the model is applied, `apply-planning-agent-task-result` can return stale status with a `source-fingerprint-drift` reason instead of fresh. Fresh status records `lastRefreshedBy` as `put-recommendations`, `apply-planner-result`, `apply-planning-agent-task-result`, or `apply-backlog-curation-draft`, depending on the action that applied the model.

## Kanban semantics

The board is derived from backlog status, dependency state, and trace evidence. Lanes are not separate storage locations.

| Lane | Meaning |
| --- | --- |
| `inbox` | Candidate items that need triage or refinement. |
| `ready` | Planned items without unresolved blockers. |
| `blocked` | Items with unresolved dependencies or other blocking evidence. |
| `in-progress` | Active items or items with active trace evidence from current editable plans, live queue/run/build rows, or active PR/landing rows. Historical submitted session-plan rows do not move a candidate item into this lane by themselves. |
| `done` | Shipped items. |
| `archive` | Stale or superseded items. |

Statuses are `candidate`, `planned`, `active`, `shipped`, `stale`, and `superseded`. Promotion never marks an item `shipped`; it marks the item `active` by default, or leaves it `planned` when requested by the action input.

## Actions

The extension registers backlog, board, recommendation, roadmap, planner-orchestration, plan-revision, and planning-workstation actions. Agent-facing compact reads declare output profiles (`get-item` as `agent-compact`; `get-epic`, `search-items`, and `list-board-compact` as `agent-paginated`), `render-board-markdown` declares `markdown`, and the compatibility full-board payload declares `debug-rich`.

| Action | Purpose | Side effects |
| --- | --- | --- |
| `list-board` | Compatibility/debug read that returns epics, items, lanes, blocked reasons, recommendation status (including missing/fresh/stale), optional recommendation summary, trace summaries, and lifecycle projections as JSON-safe data. Kanban cards include canonical `linkRows`, `failureEvidence`, and `lifecycleState`; the board also exposes aggregate `lifecycleLinks` and `epicProgress`. The workstation does not use this rich action on its hot path. | `local-read` |
| `list-board-compact` | Return bounded compact item summaries, lane counts, total/open/closed counts, pagination metadata, and epic counts. It is open-first by default: closed `done`/`archive` cards are omitted from `items` until callers explicitly request a closed lane with `includeClosed` (and `includeArchive` for archive reads). | `local-read` |
| `get-item` | Return one backlog item detail with Markdown sections, lifecycle rows, and compact dependency/dependent summaries. Raw body output is opt-in through `includeBody`. | `local-read` |
| `get-epic` | Return one backlog epic detail with Markdown sections plus paginated compact item summaries. Raw body output is opt-in through `includeBody`. | `local-read` |
| `search-items` | Search compact item summaries by text, epic, status, lane, or tags with `limit`/`offset` pagination. Body search is opt-in through `searchBody`. | `local-read` |
| `render-board-markdown` | Return `{ markdown }` for host or Console display, including visible recommendation freshness notes when recommendations are fresh or stale. | `local-read` |
| `capture-item` | Create a visible backlog item in private eforge-plan storage from title, claim, evidence, tags, priority, epic, and dependencies. | `local-write` |
| `upsert-epic` | Create or update a visible backlog epic in private eforge-plan storage without duplicating item membership lists. | `local-write` |
| `update-item` | Update visible item status, priority, tags, evidence/recheck notes, dependencies, and epic link in private storage while preserving body content. | `local-write` |
| `import-legacy-backlog` | Copy validated legacy `.backlog` item and/or epic records into private eforge-plan backlog storage, skipping IDs that already exist privately and leaving legacy files in place. | `local-read`, `local-write` |
| `promote-item` | Write a session plan, update trace evidence, and set item status to `active` or `planned` through private backlog metadata updates. | `local-write` |
| `promote-selection` | Promote selected visible item IDs, a recommendation ref, or an epic into one session plan using the same build-source synthesis path and private backlog metadata updates. | `local-write` |
| `get-recommendations` | Read `.eforge/storage/extensions/eforge-plan/recommendations/current.json`, derive the server freshness view from `.eforge/storage/extensions/eforge-plan/recommendations/status.json`, and return summary, compatibility status, freshness view data, plus any active refresh task. | `local-read` |
| `put-recommendations` | Validate recommendation item/epic references and write `.eforge/storage/extensions/eforge-plan/recommendations/current.json`, then update the status sidecar for the current source fingerprint with `lastRefreshedBy: "put-recommendations"`; it does not create an accepted-analysis git baseline. | `local-write` |
| `get-roadmap-state` | Read private local-focus roadmap state, configured shared-source metadata, discovered conventional context, conflicts, assumptions, truncation metadata, and storage paths. | `local-read` |
| `update-roadmap-state` | Update private local-focus roadmap content and/or configured shared-source metadata. It validates configured paths stay within the project, stores normalized project-relative paths, ignores disabled sources during projection, and never writes the configured shared project files themselves. | `local-read`, `local-write` |
| `analyze-all-backlog` | Start or reuse an active daemon-owned backlog curation planning task for input `{ "scanMode": "delta" }` or `{ "scanMode": "full-implementation-audit" }`. Delta is the default. Full implementation audit is a visible opt-in from the workstation, may take longer and use more context, and is comprehensive over open backlog items while remaining bounded by caps and available git/PR history. It records a durable workflow entry with purpose `backlog-curation`, requests `backlogCurationDraft` plus `recommendations`, and defers all-open-backlog source assembly to the background task so the workstation action returns quickly. The background source includes bounded `gitDelta` baseline/current-HEAD metadata (`baseline-missing`, `baseline-invalid-sidecar`, `baseline-unreachable`, `baseline-shallow`, `git-unavailable`, `git-command-failed`, `scan-cap-truncated`, and `pr-enrichment-unavailable` diagnostics), fallback/unavailable coverage labels for missing, unreachable, shallow, or no-git baselines, and affected item candidates in the curation source and source fingerprint, reuses the same scanned git records for bounded git/PR shipped or superseded evidence alongside lifecycle trace evidence, and optional PR enrichment through `gh` fails closed and is not required, leaving bounded candidate evidence in place instead of failing the task. Normal confirmed apply writes curation changes first, then writes the effective prospective recommendation projection and refreshes recommendations from the post-curation backlog state, so this is the primary workstation refresh path; curation-only apply discards generated recommendations when explicitly requested. Successful accepted curation apply records the private analysis baseline when a source fingerprint is available. | `local-read`, `local-write`, `daemon-state`, `network` |
| `refresh-recommendations` | Start or reuse a daemon-owned recommendation-only planning task for the current source fingerprint. It records a durable workflow entry with purpose `recommendation-refresh` and does not apply generated output automatically. This lower-level action remains registered and is allowed for roadmap refresh flows. | `local-read`, `local-write`, `daemon-state` |
| `prepare-planner-context` | Prepare JSON-safe backlog, epic, recommendation, dependency/blocker, roadmap context, and relevant trace summaries for external AI planning orchestration. | `local-read` |
| `apply-planner-result` | Apply validated structured planner recommendation updates and/or handoff drafts through private recommendation storage and `promote-selection`. | `local-write` |
| `start-planning-agent-task` | Prepare planner context, then ask the daemon-owned agent task service to run one `eforge-plan.planning-draft` task for an explicit user goal or a goal derived from the backlog selection (`itemIds`, `epicId`, or `recommendationRef`). | `local-read`, `local-write`, `daemon-state` |
| `get-planning-agent-task` | Return the daemon task record for one planning task id. | `local-read` |
| `cancel-planning-agent-task` | Delegate cancellation of one planning task to the daemon-owned task service. | `local-write` |
| `list-planning-agent-tasks` | Project the durable planning task workflow index and join owner-scoped daemon task records for discovery, polling, retry, and redraft across reloads. Backlog curation previews are fetched separately through `preview-backlog-curation-task`. | `local-read` |
| `retry-planning-agent-task` | Start a new planning task reusing the preserved request context of a prior task. | `local-read`, `local-write`, `daemon-state` |
| `redraft-planning-agent-task` | Start a linked redraft of a completed needs-input task, carrying prior summary/questions plus the user's clarification answers or steering. | `local-read`, `local-write`, `daemon-state` |
| `apply-planning-agent-task-result` | Apply selected output from a completed planning-draft task through validated recommendation storage, handoff promotion helpers, session-plan section adapters, `applySessionPlanCreationDraft` for ready creation drafts, or `applyBacklogCurationDraft` for confirmed backlog curation drafts; `applyBacklogCurationDraft.applyCurationOnly` applies valid curation while discarding generated recommendations. | `local-write` |
| `start-plan-revision-session` | Create or resume a private revision thread for an existing flat session plan and return its plan/readiness projection. | `local-read`, `local-write` |
| `list-plan-revision-sessions` | List private revision threads joined to owner-scoped daemon task records, optionally including current flat plan detail. | `local-read` |
| `get-plan-revision-session` | Return one private revision thread by target session or thread id, joined to daemon task records and including annotations. | `local-read` |
| `create-plan-revision-annotation` | Persist a bounded semantic/quote-context annotation for an existing flat session-plan revision session. | `local-read`, `local-write` |
| `update-plan-revision-annotation` | Update an annotation body and/or semantic target for an existing flat session-plan revision session. | `local-read`, `local-write` |
| `delete-plan-revision-annotation` | Delete one persisted plan revision annotation. | `local-read`, `local-write` |
| `resolve-plan-revision-annotation` | Manually mark one plan revision annotation resolved. | `local-read`, `local-write` |
| `dismiss-plan-revision-annotation` | Mark one plan revision annotation dismissed so it is no longer treated as open context. | `local-read`, `local-write` |
| `start-plan-revision-turn` | Start one read-only `eforge-plan.planning-draft` task for a user revision message or annotation-driven request, requesting only `planRevisionTurn` output and recording the base plan fingerprint plus any annotation snapshot. | `local-read`, `local-write`, `daemon-state` |
| `retry-plan-revision-turn` | Retry a linked revision turn or redraft a completed needs-input turn from clarification answers while preserving parent linkage and annotation snapshots. | `local-read`, `local-write`, `daemon-state` |
| `cancel-plan-revision-turn` | Delegate cancellation of one linked revision task to the daemon-owned task service. | `local-write`, `daemon-state` |
| `apply-plan-revision-turn` | Write all structured section patches from a completed revision turn, resolve referenced open annotations, and refresh readiness; apply is idempotent, and answer-only, mismatched, invalid-patch, needs-input, failed, or cancelled turns write no sections or annotation resolution. | `local-read`, `local-write` |
| `list-planning-artifacts` | Return flat session plans and session plan sets using stable artifact keys such as `plan:<session>` and `plan-set:<planSetId>`. The default response is artifact-only (`artifacts`, `plans`, and `planSets`) and omits rich board data for workstation startup. Plan artifacts include lifecycle/source fields when available: `sourceRefs.sourceItemIds`, `sourceRefs.sourceEpicIds`, `lifecycleState`, `itemRows`, `linkRows`, and `failureEvidence`. Legacy callers may request the optional rich `board` field with `includeBoard: true`; otherwise use `list-board` for intentional debug-rich board reads. | `local-read` |
| `show-session-plan` | Return a flat session-plan detail view with frontmatter metadata, body, readiness detail, absolute path, top-level `sourceRefs` (`sourceItemIds`, `sourceEpicIds`), and `lifecycle` (`lifecycleState`, `itemRows`, `linkRows`, `failureEvidence`). | `local-read` |
| `show-session-plan-set` | Return a plan-set detail projection with manifest summary, validation detail, directory paths, manifest path, and anchor content when present. | `local-read` |
| `create-session-plan` | Write `.eforge/session-plans/<session>.md` using the shared session-planning workflow format. | `local-write` |
| `set-session-plan-section` | Replace a named planning dimension section in a flat session plan. Duplicate headings for that dimension are collapsed to one section. | `local-write` |
| `update-session-plan-metadata` | Update session-plan metadata fields that are not exposed through section editing, such as `profile`, `agent_profile`, and `open_questions`. | `local-write` |
| `select-session-plan-dimensions` | Update the selected planning dimensions for a flat session plan. | `local-write` |
| `check-session-plan-readiness` | Run adapter-backed readiness and acceptance-criteria diagnostics without mutating the file. | `local-read` |
| `set-session-plan-ready` | Mark a plan `ready` only when required dimensions are covered and readiness diagnostics pass; otherwise return a structured `not-ready` result. | `local-write` |
| `delete-session-plan` | Remove a flat session plan from active planning lists by marking it `abandoned`; the Markdown file is retained for audit/recovery. | `local-write` |
| `handoff-session-plan` | Verify readiness and `status: ready`, then enqueue the session plan through the daemon build queue. If enqueue fails, return a structured failure with the manual `eforge build <path>` fallback command. | `local-read`, `local-write`, `daemon-state`, `build-queue` |

## Promotion flow

`promote-item` and `promote-selection` are the primary handoffs. They read source backlog item and related epic/dependency context, synthesize build-source Markdown, write a normal session-plan artifact, and record the promotion in the trace sidecar. `promote-selection` supports multi-source promotion from a recommended item, recommended group, epic, or user-selected item set while preserving the same session-plan helper and trace behavior.

```mermaid
flowchart TD
  Item[Visible backlog item] --> Synthesize[Shared synthesis helper]
  Epic[Visible backlog epic] --> Synthesize
  Deps[Dependency context] --> Synthesize
  Synthesize --> Plan[.eforge/session-plans/session.md]
  Synthesize --> Trace[.eforge/storage/extensions/eforge-plan/traces/item.json]
  Plan --> Engine[Existing eforge session-plan workflow]
```

Generated session plans include frontmatter compatible with the existing session-plan workflow, including `session`, `topic`, `status`, `planning_type`, `planning_depth`, dimension fields, `open_questions`, and `profile`. The body includes Context, Scope, Assumptions, Design Decisions, Acceptance Criteria, Source Backlog Evidence, Source Epic Evidence, and Dependency Context.

When assumptions or acceptance criteria are missing, generated Markdown includes explicit guidance instead of silently pretending the item is ready.

## Input-source URI

The extension also registers direct input-source adapter `eforge-plan`:

```text
eforge://input/eforge-plan/<itemId>
```

The adapter compiles the backlog item into ordinary build-source Markdown using the same synthesis helper as promotion. The output includes the item claim, evidence, assumptions or missing-assumption guidance, and acceptance criteria or missing-criteria guidance.

The adapter requires the input transform context to resolve visible eforge-plan backlog records from `ctx.cwd`. If invoked without context, it returns instructional Markdown explaining that `eforge-plan` requires an input-source context rather than reading from `process.cwd()`.

## Annotation revision workflow

Plan revision sessions let users improve existing flat session plans without replacing the underlying planning workflow. Start or resume a session with `start-plan-revision-session`, then capture annotations from selected text, a focused block, a section, or whole-plan content in the Plans tab. Selection annotations store bounded quote context and semantic target metadata so the revision turn can reason about the intended location even if nearby text changes; DOM offsets are not accepted as durable annotation targets. When exact targeting is not possible, the workstation exposes fallback controls for section-level or whole-plan annotations.

Unresolved annotations remain visible in the plan detail view and can be edited, deleted, manually resolved, or dismissed. Annotation-driven revision turns snapshot the selected annotation IDs, optional open annotations, steering text, plan fingerprint, and relevant section hashes before the daemon-owned planning task starts. The daemon source context carries structured annotation targets, including kind, dimension, and quote context; oversized fallback context keeps selected/open counts and bounded body/target previews instead of dropping annotation semantics. That snapshot is the context used for retry/redraft so later annotation edits do not silently change the historical turn.

When a completed revision turn includes valid section patches, the workstation auto-applies every patch through the same adapter-backed section mutation path used by manual edits, refreshes readiness, and resolves only the referenced open annotations from the turn snapshot. Answer-only, mismatched, needs-input, failed, or cancelled turns do not write plan sections and do not auto-resolve annotations; invalid-patch turns do not write plan sections and do not auto-resolve annotations. Apply is idempotent, and revision apply never marks a plan ready, hands it off, enqueues a build, or mutates backlog state.

## Roadmap steering workflow

The Roadmap workstation combines private local focus with read-only shared roadmap context. Editable local steering lives at `.eforge/storage/extensions/eforge-plan/roadmaps/local-focus.md`; shared-source configuration lives at `.eforge/storage/extensions/eforge-plan/roadmaps/config.json` with normalized project-relative paths. Enabled configured shared sources and discovered conventional files such as `docs/roadmap.md` are read as non-canonical context only; disabled configured sources stay as metadata and do not suppress conventional discovery. `eforge-plan` does not silently rewrite shared roadmap files.

Planner context and recommendation freshness include the private local focus roadmap, configured shared sources, discovered conventional context, assumptions, conflicts, and truncation metadata. Changing local focus or configured roadmap context can make recommendations stale even when backlog items are unchanged. The workstation can save local-focus edits, start or reuse a roadmap-driven `refresh-recommendations` task, and reload derived freshness from the saved roadmap state.

## Console and host surfaces

The Console System contribution is declarative and uses only the closed renderer set supported by the Console:

- `text`
- `markdown`
- `status-badge`
- `link`
- `action-button`
- `action-form`

The contribution includes board summary content, status badges, and action-backed controls for listing or rendering the board, reading recommendations, reading or updating roadmap state, refreshing recommendations, analyzing all backlog records, promoting an item or selection, preparing planner context, applying structured planner results, capturing an item, updating an item, and importing legacy backlog records. Dynamic board content is surfaced by invoking `render-board-markdown`; the top-level contribution does not read the filesystem directly.

Host integrations register commands and action-backed deep links for board rendering, promotion workflows, and generic planning entry. Planning-mode playbook hosts should discover or invoke the `eforge-plan:open-planning-entry` contribution, or open the `eforge-plan:planning-workstation` deep link, instead of hard-coding host-specific planning commands.

The planning workstation appears under `/console/workstations` as an extension-owned `frameBundle` rooted at `workstation-assets/plans` with `index.js` as its entrypoint. Browser assets are built from the TypeScript/React Vite app in `workstation-src/plans`, use local shadcn-style components owned by the extension, and are served through the daemon-owned frame/asset contract. They do not import parent Console React components, private Console routes, `packages/console-ui/src`, or `@/` aliases.

The workstation is view-first and deep-linkable. Its initial Backlog refresh uses `list-board-compact` with a bounded limit, then loads recommendations, roadmap state with local-focus content, and planning artifacts independently. Planning artifact startup calls `list-planning-artifacts` with `includeBoard: false`, so Plans data omits rich board data by default and Backlog board data comes only from `list-board-compact`. Detail drawers lazily call `get-item`, and closed `done`/`archive` lanes are loaded only when the user selects the closed filter or expands a closed lane rail. The rich `list-board` action remains registered for compatibility/debug use but is not in the workstation `allowedActions` surface. Agent and coding-host reads should prefer `list-board-compact`, `search-items`, `get-item`, `get-epic`, or `render-board-markdown`; host integrations render `{ markdown }` directly and summarize/truncate oversized rich JSON with warnings, identity fields, counts, omitted counts, and continuation hints. Use `list-board` only for intentional compatibility/debug inspection, preferably through raw CLI `--json` or a UI/workstation path where a large payload is expected.

The workstation exposes a collapsible **Roadmap workstation** panel above its tabs plus two tabbed views. The roadmap panel shows local focus, configured shared context, discovered conventional context, conflicts, assumptions, truncation metadata, recommendation freshness, and active recommendation refresh progress. It edits only the private local focus roadmap through `update-roadmap-state`; shared project roadmap files remain read-only context. After saved roadmap edits, the panel can start or reuse `refresh-recommendations` and then reload workstation data so recommendation freshness reflects the saved roadmap state.

- **Backlog** renders the derived kanban with Lane / Epic / Recommended grouping, status filters (`all`, `ready`, `blocked`, `review`, `closed`), free-text and epic filters, compact lifecycle chips (`Plan`, `Queue`, `Run`, `PR open`, `Merged`, `Failed`, or `Partial`), expandable lifecycle evidence rows, and a next-up recommendations rail with blocked chains and rationale. The lifecycle panel shows action-projected session, queue, run, PR, landing, timestamp, branch/commit, and affected-item evidence without reading private trace storage or daemon routes directly. The recommendations panel uses the enriched `get-recommendations` response to show server-derived missing/fresh/stale freshness, structured stale reason metadata, and active refresh task status; it does not infer `fresh` from the presence of a recommendation model. Missing or stale recommendations direct users to **Analyze all backlog** in the Plan with AI panel; normal confirmed curation apply refreshes recommendations from the post-curation backlog state, while explicit curation-only apply discards generated recommendations. The recommendations panel does not expose a separate recommendation-only refresh control; roadmap-only recommendation refresh is exposed from the Roadmap workstation panel. Selecting ready items exposes a single **Promote to a build plan** action that starts AI session-plan generation for the ready subset of the selection (blocked, closed, and non-ready items are excluded, and the action is disabled when no ready items remain); recommendation cards and groups start the same AI planning workflow by item ids or recommendation ref. Safe parallelizable groups are planning guidance only. There is no deterministic workstation promotion path and no prompt-input box: the AI promotion derives its goal from the selection. Recommendations stay in the AI workflow rather than calling `promote-selection`.
- **Plans** lists session plans and plan sets and renders a structured detail view. Flat plans show source backlog item refs, source epic refs, lifecycle evidence for queue/run/PR/landing state, partial per-item progress rows when only some linked items are shipped, an actionable readiness checklist (missing dimensions open inline section editors backed by `set-session-plan-section`; acceptance-criteria diagnostics offer a revise affordance; an unselected plan offers a dimension-selection form backed by `select-session-plan-dimensions`), editable metadata backed by `update-session-plan-metadata`, a two-step delete action backed by `delete-session-plan`, rendered dimension sections with selection/block/section/whole-plan annotation controls, unresolved annotation cards, and a **Revise with AI** panel for answer-only or auto-applied section-patch revision turns. Plan sets render their children by relationship strategy (`parallel` as a grid; `sequential` and `dag` as a numbered ordered list, with `dag` also surfacing each child's `dependsOn`) plus a validation summary.

Because the workstation runs as a cross-origin sandboxed iframe (`sandbox="allow-scripts"`, opaque origin), it has no shared History and cannot open native `window.confirm`/modal dialogs. The Console host owns the URL: the active sub-path and query are carried on `/console/workstations/<id>/<subPath>?<query>` and synced to the iframe over a token-authed `postMessage` bridge without remounting the frame. Mutations that need confirmation (such as handoff) use a two-step in-app confirmation instead of a browser dialog.

### Workstation UI development

The workstation has a frontend development loop independent of eforge builds:

```bash
pnpm dev:eforge-plan-workstation          # mock bridge / fixture data
pnpm dev:eforge-plan-workstation:daemon   # auto-detect or start daemon, then proxy /api to it
pnpm build:eforge-plan-workstation
```

`dev:eforge-plan-workstation` runs the Vite app with a mock `window.eforge.invokeAction` bridge and fixture data for rapid UI iteration. `dev:eforge-plan-workstation:daemon` reads the project daemon lockfile, starts the daemon when needed, sets `VITE_EFORGE_DAEMON_URL` automatically, and launches the same Vite app against live daemon data; Vite proxies `/api` to the daemon so local-only action security still sees same-origin requests. Production Console rendering uses the built files in `workstation-assets/plans`.

`workstation-assets/` is a generated artifact and is gitignored - do not commit it. The workstation package is part of the pnpm workspace, and the `@eforge-build/eforge-plan` package build first builds the shared client package, then regenerates the workstation assets before compiling the runtime entrypoints in `dist/`; `workstation-assets.test.ts` also builds it on demand when it is missing. The package artifact includes the built workstation bundle, so rebuild before packing or installing the extension in another project. Rebuilding changes the extension trust hash; re-trust and reload the Console after a rebuild.

The workstation can browse backlog-derived board data, roadmap source status, recommendation summary/status data, active recommendation refresh status, epics, flat session plans, and session plan sets; edit the private local focus roadmap and refresh recommendations from saved roadmap changes; create, edit, or delete session plans; update metadata and selected dimensions; run readiness checks; mark ready plans; start AI session-plan generation from selected ready backlog items or recommendations through **Promote to a build plan**; start or reuse all-backlog curation through `analyze-all-backlog` in default `delta` mode or explicit `full-implementation-audit` mode to curate records and refresh recommendations together; monitor durable planning tasks in the **Plan with AI** panel; capture semantic revision annotations from rendered plan selections, focused blocks, sections, or whole-plan content; edit, delete, resolve, or dismiss unresolved annotations; start annotation-driven turns with selected/open annotation context; start, retry, cancel, and auto-apply section-only AI revision turns for existing flat session plans in the **Revise with AI** panel; and enqueue ready session plans after an explicit two-step handoff confirmation. The Plan with AI panel is a durable task monitor rather than a prompt box: on load it lists indexed tasks through `list-planning-agent-tasks`, polls running tasks, and renders running progress with current/covered/remaining section progress, failed tasks with a retry control that reuses preserved workflow context, needs-input tasks with clarification questions plus answer/steering inputs that start a linked redraft, recommendation refresh workflow entries, backlog curation workflow entries, and ready session-plan creation drafts with a preview. Generated output stays read-only until an explicit two-step in-app confirmation applies a creation draft, recommendations, handoff drafts, session-plan sections, or a backlog curation draft; structured backlog curation drafts are validated task output and do not write backlog records by themselves. Completed backlog curation tasks render a preview before mutation with a scan-mode label, item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, server-provided recommendation freshness, git-delta baseline/head coverage and diagnostics, full-audit coverage/caps/diagnostics/evidence source/confidence when supplied by the server, effective generated recommendations, and any invalid generated recommendation reference details. Full implementation audit previews warn that the audit may take longer and use more context, and that coverage is bounded by caps and available git/PR history. Evidence preview labels distinguish `Shipped evidence: lifecycle trace`, `Shipped evidence: inferred from git/PR history`, `Superseded evidence: lifecycle trace`, `Superseded evidence: inferred from git/PR history`, PR identifiers, commit identifiers, `Ambiguous shipped candidate: needs input`, and `Ambiguous superseded candidate: needs input`; full-audit evidence source and confidence chips are rendered only from server preview metadata, and the preview uses proposed draft wording until a curation entry has actually been applied. Generated recommendation previews use the server-provided prospective `recommendationProjection`: item/epic ids proposed as closed by the curation draft are removed, draft-active/planned targets may be repositioned, effective counts come from `effectiveRecommendations`, and placement issues can appear as `wrong-lane` validation before the user confirms apply. No-op rechecks are freshness-only and should stay rare: the prompt tells agents to omit already-fresh unchanged records, the preview collapses no-op details by default, and apply skips no-op rechecks for records whose `stale_after` date is still in the future, reporting the skipped count as `skippedFreshRechecks` in the apply result. Curation apply requires two in-app confirmation steps and invokes `apply-planning-agent-task-result` with `applyBacklogCurationDraft.previewAcknowledged` and `applyBacklogCurationDraft.confirmApply` both set to `true`. Invalid generated recommendations block normal curation apply; users may explicitly apply curation only while discarding generated recommendations by also sending `applyBacklogCurationDraft.applyCurationOnly: true`. Analyze-all and curation apply do not enqueue builds, submit session plans, or mark records shipped or superseded without durable status-specific evidence. Applying a creation draft refreshes the Plans artifact list. For AI session-plan creation drafts, source backlog item ids and epic ids are trusted only from the preserved workflow selection captured before the agent ran, not from agent-authored output. Backlog cards open a detail drawer where status, priority, and epic membership can be edited directly through `update-item` (an empty epic selection clears the link); lanes stay derived, so the drawer flags items whose unresolved dependencies will keep them in Blocked regardless of status. Revision turns can be answer-only, can produce a patch preview that the workstation applies automatically, or can return top-level `needs-input` clarification questions that the user answers through a linked retry/redraft. When a turn produces a patch the workstation auto-applies every proposed section: writes go through adapter-backed section mutations, apply resolved open questions from the patch metadata to the plan's `open_questions`, refresh readiness afterward, and record applied-section markers, with no section-selection or apply-confirmation step. Apply is idempotent, so a re-applied turn does not rewrite the plan. While a revision turn is running the workstation locks plan edits and further revision requests until it completes. Revision apply does not mark a plan ready, hand off, enqueue a build, or mutate backlog state; handoff remains separate.

All reads and mutations go through `window.eforge.invokeAction` and the workstation manifest's `allowedActions` list. The allowlist includes roadmap state reads/writes and recommendation refresh, but no longer includes `list-board` or `promote-selection`.

## Trace sidecars

Trace sidecars live under `.eforge/storage/extensions/eforge-plan/traces/<itemId>.json`. They are extension-owned private metadata resolved through the SDK's extension storage helper, and they correlate backlog items with eforge lifecycle evidence.

Trace-owned data includes:

- promoted session plans keyed by session id;
- queued PRD records keyed by PRD id;
- build runs keyed by run id and session id;
- build sessions keyed by session id;
- landing results keyed by feature branch or commit SHA;
- last observed lifecycle event metadata.

Sidecar updates are idempotent and use stable keys such as `session`, `prdId`, `sessionId`, `runId`, `featureBranch`, and `commitSha`. Sidecar rows are durable audit evidence, not authoritative activity state: session-plan rows are active only when the row status is nonterminal and the current editable flat session-plan list still contains that session, so submitted session-plan rows are historical. Completed queue/build rows and terminal landing rows remain visible evidence but do not produce active trace reasons or nonterminal lifecycle states.

## Lifecycle linkage

The extension registers hooks for enqueue, queue PRD, session, landing, and auto-merge lifecycle events:

- `enqueue:start`
- `enqueue:complete`
- `queue:prd:start`
- `queue:prd:complete`
- `session:start`
- `session:end`
- `landing:complete`
- `landing:auto-merge:complete`

Correlation can use promoted session-plan paths, input-source ids, `enqueue:complete.id`, `queue:prd:complete.prdId`, and event envelope `sessionId` or `runId` values. Shared promoted-plan evidence can correlate one lifecycle event to multiple source item traces when those items were promoted together into the same session plan, PRD, build, or landing flow.

The supported linkage chain is backlog item or epic selection → generated `.eforge/session-plans/<session>.md` → explicit handoff to the build queue → queue PRD and run/session evidence → PR or landing evidence → correlated item and epic progress. The trace sidecars are the durable private join records for this chain, while workstation actions project compact public rows for the Backlog and Plans tabs. Those projections keep historical rows in `linkRows`, PR refs, landing refs, and source fingerprints, but derive active reasons and nonterminal lifecycle states only from a current editable session plan, live queue/run/build evidence, current PR-open/landing evidence, or explicit `active` backlog status; submitted session-plan traces alone do not mark items active or planned.

Lifecycle status mutation is conservative:

- PR-open, failed, skipped, cancelled, and ambiguous evidence updates trace evidence and UI lifecycle rows but does not close backlog items or mark them `shipped`; ambiguous correlations are left unmutated and do not update trace or UI lifecycle rows unless resolved as a supported multi-source correlation.
- `landing:complete` with a `prUrl` and no merge confirmation records PR evidence and leaves the item active.
- `landing:complete` with confirmed local merge evidence may mark only correlated item ids `shipped`.
- `landing:auto-merge:complete` may mark only correlated item ids `shipped`.
- Unrelated ambiguous correlation writes no backlog status mutation. Diagnostic trace evidence is recorded for all traces in a shared multi-source promoted-plan correlation, but unrelated ambiguous matches are left unmutated.
- Mixed multi-item or epic evidence projects a `partial` lifecycle state with per-item rows when only some correlated item ids have confirmed shipped evidence.

## Planning workstation boundary

Planning artifact semantics are owned by `@eforge-build/input` through `createSessionPlanningWorkflowAdapter()`. The extension action handlers use that adapter for flat session-plan and plan-set reads, mutations, readiness checks, acceptance-criteria diagnostics, path containment, and plan-set validation.

Daemon and client session-plan and session plan-set routes remain compatibility plumbing for Pi, Claude, CLI, daemon clients, and other tools. The extension workstation uses extension actions instead of raw extension-owned HTTP routes or private Console APIs.

The handoff flow is an explicit build-queue submission. After confirming the plan is ready and has `status: ready`, `handoff-session-plan` calls the daemon-owned build queue with `.eforge/session-plans/<session>.md` and returns the spawned enqueue worker session id, pid, auto-build state, path, and readiness detail. If queue submission is unavailable or fails, it returns `kind: "enqueue-failed"` with the manual `eforge build <path>` fallback command instead of silently reporting success.

Planner orchestration is action-first: `prepare-planner-context` prepares bounded JSON-safe context packets including roadmap context and relevant trace summaries, and `apply-planner-result` accepts structured recommendation models or handoff drafts. It does not accept raw Markdown or arbitrary filesystem paths from planner output, and handoff drafts use the existing `promote-selection` path.

`eforge-plan` can also start daemon-owned planning agent tasks through `ctx.agentTasks`. The extension owns backlog state, recommendation storage, session-plan draft application, plan revision storage, annotation snapshots/resolution, section-only apply semantics, backlog curation application, and the final apply semantics; the daemon owns agent execution, status, cancellation, and task records. `start-planning-agent-task` always builds a bounded context packet with `prepare-planner-context` before starting an `eforge-plan.planning-draft` task; `analyze-all-backlog` starts or reuses an active daemon-owned read-only `backlog-curation` planning task for `delta` or `full-implementation-audit` scan mode, requests `backlogCurationDraft` plus `recommendations`, and defers all-open-backlog curation source assembly to that background task before the planner runs. Plan with AI monitor labels curation tasks and supports retry, redraft, cancel, remove, and apply. The task result is read-only until the user previews it and explicitly chooses which recommendations, handoff drafts, session-plan draft sections, or backlog curation draft to apply. Completed curation task previews include item changes, epic changes, no-op rechecks, skipped cases, needs-input cases, generated recommendations, scan-mode labels, closure-evidence preview labels, prospective recommendation projection metadata, preview-time invalid generated recommendation references, and full-audit coverage/caps/diagnostics/evidence source/confidence when supplied by the server. Full-audit previews warn that the audit may take longer and use more context while remaining bounded by caps and available git/PR history. No-op recheck details are collapsed in the preview and apply ignores already-fresh records, so curation drafts do not rewrite the whole backlog just to refresh dates. Invalid generated recommendations block normal curation apply, but users may explicitly apply curation only while discarding generated recommendations with `applyCurationOnly`. Applying generated output does not enqueue a build, mark backlog items shipped or superseded without durable status-specific evidence, or submit session plans; the separate confirmed handoff action enqueues a ready session plan.

The AI planning flow is durable but bounded. The workstation can start tasks from backlog selections and recommendations, monitor indexed tasks across reloads, poll running tasks, cancel, retry failed tasks with preserved context, answer needs-input clarifications to start a linked redraft, start/reuse recommendation refresh tasks for stale or missing recommendation state, start/reuse active all-backlog curation tasks in the selected scan mode, start linked plan revision turns for existing flat session plans through **Revise with AI**, and preview and explicitly apply ready creation, revision, or curation drafts. Structured backlog curation draft task output is validated and stored as task output but does not write backlog records by itself. Applying generated output never enqueues a build, marks backlog items shipped or superseded without durable status-specific evidence, or submits session plans; users must explicitly confirm handoff on a ready plan to enqueue. It still does not provide an open-ended multi-turn chat UI, autonomous backlog draining, or automatic application of generated content.

Parent-Console plugins, direct React loading into the parent Console, private Console imports/routes, raw extension-owned HTTP routes, daemon-owned chat state, a generic daemon-owned chat runtime, multi-turn AI chat UI, scheduling, stale-triggered execution, unattended mutation, auto-mode backlog draining, automatic queue selection, unattended enqueueing, queue orchestration, plan-set generation from recommendations, legacy `.backlog/recommendations.json` import/export, and promotion into a bundled/core distribution remain unsupported. General extension-owned AI chat runtime support is not implemented by this extension.
