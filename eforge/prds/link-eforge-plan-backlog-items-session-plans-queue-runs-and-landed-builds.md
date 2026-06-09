---
title: Link eforge-plan Backlog Items, Session Plans, Queue Runs, and Landed Builds
created: 2026-06-09
---

# Link eforge-plan Backlog Items, Session Plans, Queue Runs, and Landed Builds

## Problem / Motivation

The eforge-plan extension now has important foundations:

- Trace sidecars under `.eforge/storage/extensions/eforge-plan/traces/`.
- Lifecycle event hooks in `eforge/extensions/eforge-plan/lifecycle.ts`.
- Recommendation freshness/status sidecars from PR #177.
- AI session-plan creation drafts.
- Explicit `handoff-session-plan` enqueue behavior.

The remaining user-visible workflow is still fragmented.

Current inspected evidence:

- `.backlog/items/backlog-2026-06-05-link-backlog-items-session-plans-queue-runs-and-landed-build.md` narrows the active scope to richer run/PR/landing UX, epic progress, and partial-completion semantics after recommendation freshness shipped.
- `eforge/extensions/eforge-plan/trace-store.ts` stores promoted session plans, queue PRDs, build runs, build sessions, landing results, and last event metadata, but `summarizeTrace` only exposes coarse active booleans/reasons.
- `eforge/extensions/eforge-plan/kanban.ts` uses `activeTraceReasons` to move cards into the in-progress lane, but cards do not show a durable lifecycle chain or PR/landing outcome detail.
- `eforge/extensions/eforge-plan/session-plan-view-model.ts` projects session plans without source backlog, queue, run, PR, landing, or epic linkage detail.
- `eforge/extensions/eforge-plan/planner-orchestration.ts` applies AI session-plan creation drafts through the session-plan adapter, but the current creation-draft apply path does not appear to write source item/epic metadata or upsert promoted-session trace sidecars from the workflow selection.

User-visible gap: a user can promote or create a plan, hand it off, observe a build land, and see stale/fresh recommendations, but the workstation still lacks a coherent backlog → session plan → queue/run → PR/landing → shipped/partial evidence model across individual items, multi-item plans, and epics.

## Goal

Build the next lifecycle-linkage slice as an extension-owned feature, using existing daemon/client events and eforge-plan private storage.

The desired outcome is a coherent backlog → session plan → queue/run → PR/landing → shipped/partial evidence model across individual items, multi-item plans, and epics.

## Approach

### Implementation targets

- `eforge/extensions/eforge-plan/planner-orchestration.ts`
  - When applying `sessionPlanCreationDraft`, look up the task workflow entry by task id and use its preserved selection to resolve source items/epics/recommendation.
  - Write source linkage into the created session plan through adapter-safe load/write helpers or a focused metadata helper.
  - Upsert promoted-session trace sidecars for each resolved source item without accepting source ids from arbitrary agent output.

- `eforge/extensions/eforge-plan/session-plan-metadata.ts`
  - Add a helper for safe eforge-plan source metadata on session-plan frontmatter, for example `eforge_plan.source_item_ids`, `source_epic_ids`, `source_recommendation_ref`, and `promoted_at`.
  - Preserve existing profile, agent profile, and open-question behavior.

- `eforge/extensions/eforge-plan/trace-store.ts`, `backlog-domain.ts`, and `schema.ts`
  - Add focused projection types/helpers for lifecycle stage, link rows, PR/landing refs, partial/failure evidence, and epic/source aggregation.
  - Keep sidecar updates idempotent and additive so existing trace files remain readable.
  - Keep TypeBox schemas JSON-safe and maintain additionalProperties discipline.

- `eforge/extensions/eforge-plan/lifecycle.ts`
  - Reuse existing event correlation, bootstrap, and recommendation stale marking.
  - Tighten status mutation so failed/skipped/PR-open evidence records trace data without marking items shipped.
  - Ensure partial multi-source behavior is explicit and tested.

- `eforge/extensions/eforge-plan/board-actions.ts`, `kanban.ts`, and `session-plan-view-model.ts`
  - Include lifecycle link projections in `list-board` and `list-planning-artifacts` outputs.
  - Derive epic progress and plan lifecycle details from backlog items plus trace summaries.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts`
  - Add frontend types for lifecycle link rows, epic progress, plan source refs, and PR/landing display data.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/backlog/item-card.tsx`
  - Render compact lifecycle chips/timeline rows instead of only notes and active-trace reasons.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx`
  - Add source backlog/epic and lifecycle evidence panels near readiness/handoff controls.

- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` and `bridge.ts`
  - Add mock multi-item, partial, PR-open, merged, and failed lifecycle examples.

- `eforge/extensions/eforge-plan/README.md`
  - Document lifecycle linkage storage, projections, AI creation-draft linking, partial-completion semantics, and recommendation freshness interaction.

- Tests near:
  - `eforge/extensions/eforge-plan/__tests__/lifecycle.test.ts`
  - `eforge/extensions/eforge-plan/__tests__/planner-orchestration.test.ts`
  - `eforge/extensions/eforge-plan/__tests__/session-plan-actions.test.ts`
  - `eforge/extensions/eforge-plan/__tests__/registration.test.ts`
  - `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts`
  - `test/eforge-plan-workstation.test.ts`

### Design decisions

1. Use workflow selection as trusted source linkage for AI-created plans.
   - The AI result should draft section content only.
   - Source item ids, epic ids, and recommendation refs should come from the extension-owned planning task workflow index or deterministic promotion selection resolver.
   - This prevents arbitrary agent output from linking unrelated backlog work.

2. Keep linkage extension-owned and projection-first.
   - Trace sidecars and session-plan frontmatter can hold durable linkage evidence.
   - Workstation actions expose JSON-safe projections.
   - The workstation should invoke extension actions and should not read `.eforge/storage/extensions/eforge-plan` files directly.

3. Treat epics as derived progress unless an explicit epic status action exists.
   - Epic progress should aggregate linked item/trace states such as planned, active, PR-open, merged, shipped, failed, and partial.
   - Avoid automatically marking an epic shipped until all open linked source items are closed or a future explicit action confirms it.

4. Preserve conservative item status mutation.
   - Confirmed merge or auto-merge evidence can mark a correlated item shipped.
   - PR-open, failed, skipped, cancelled, and ambiguous evidence should update traces and UI but should not close backlog items.

5. Make partial completion visible, not silent.
   - For multi-item or epic plans, mixed source states should project a `partial` plan/epic lifecycle state with per-item evidence rows.
   - The UI should make it obvious which linked items landed, failed, remain active, or still lack landing evidence.

6. Reuse recommendation freshness rather than start autonomous refresh tasks.
   - Lifecycle hooks should continue marking recommendations stale with bounded reasons.
   - The workstation refresh affordance should use existing daemon-owned planning task actions and explicit apply, not background AI work from lifecycle hooks.

7. Prefer existing client/event contracts.
   - If any new daemon data is truly needed, route constants and wire shapes must come from `@eforge-build/client`.
   - Do not inline `/api/...` paths or redefine daemon run/queue wire interfaces in monitor or workstation code.

### Architecture impact

This slice strengthens the intended architecture boundary: the engine remains headless and emits typed events; eforge-plan owns planning workflow UX, private linkage metadata, and workstation projections; daemon/client session-plan routes remain compatibility plumbing.

Expected architecture effects:

- Session plans created from eforge-plan become durable linkage anchors, not just Markdown drafts.
- Trace sidecars become the canonical extension-owned correlation store for backlog item lifecycle evidence.
- Workstation actions become the supported read boundary for lifecycle views.
- Recommendation freshness source fingerprints can include richer trace summaries without exposing private storage.
- Pi/Claude integrations can remain thin because generic extension contribution/action surfaces expose the richer state.

Avoid architecture drift:

- Do not add scheduler/auto-mode logic to lifecycle hooks.
- Do not move planning UX into the engine or built-in Console pages.
- Do not bypass extension actions with direct frame-to-daemon private calls.
- Do not duplicate daemon run/queue wire types outside `@eforge-build/client` if a daemon API touch becomes unavoidable.

### Documentation impact

Update first-party eforge-plan docs and mock workstation notes.

Documentation updates:

- `eforge/extensions/eforge-plan/README.md` should explain the complete lifecycle chain: backlog item/epic or recommendation selection → session plan → explicit handoff → queue PRD/build run/build session → PR/merge/auto-merge evidence → item/epic progress projection.
- Document where durable private linkage metadata lives and which artifacts remain built-in workflow artifacts: trace sidecars under `.eforge/storage/extensions/eforge-plan/traces/`, recommendations under `.eforge/storage/extensions/eforge-plan/recommendations/`, session plans under `.eforge/session-plans/`.
- Document AI creation-draft linking semantics and the rule that source ids come from the preserved workflow selection, not from arbitrary model output.
- Document partial-completion behavior for multi-item and epic plans, including when items are automatically marked shipped and when only trace evidence/progress changes.
- Document that recommendation freshness is stale-marked by correlated lifecycle updates and refreshed by explicit user action/application.
- If public docs mention eforge-plan workstation lifecycle behavior, regenerate docs artifacts with `pnpm docs:generate` or the repository's docs check flow.

### Risks

- Trace schema drift risk: adding rich lifecycle projections directly to persisted sidecars can make old trace files hard to read. Prefer additive fields and normalization helpers with tests for old/minimal sidecars.
- Partial-completion risk: multi-source correlation can over-close items if shared landing evidence is treated as item-specific. Keep status mutation conservative and show partial progress when evidence differs by source.
- UI complexity risk: item cards and plan details can become noisy. Use compact chips with expandable details/timelines.
- Source-linking risk: AI creation drafts currently create session plans through adapter operations. Adding source metadata must not let agent-authored output spoof unrelated item ids.
- Recommendation freshness risk: richer trace summaries can cause source fingerprint churn. Keep fingerprints stable, sorted, and compact.
- Maintainability risk: eforge-plan files are already broad. Use focused helper modules and maintain region markers in large files; avoid growing oversized files unnecessarily.
- Boundary risk: querying daemon runs directly from the workstation would duplicate Console/daemon contracts. Prefer trace-derived projection and typed client helpers only if needed.

### Assumptions and validation

| Assumption | Current evidence | Validation path | Impact if wrong |
| --- | --- | --- | --- |
| AI creation-draft apply can recover selection context from the planning task workflow index. | `agent-task-actions.ts` records `selection`, `requestedOutputSections`, and session/type/depth in `.eforge/storage/extensions/eforge-plan/planning-tasks/index.json`. | Add planner-orchestration tests that apply a creation draft from item, epic, and recommendation selections and assert session-plan metadata plus trace sidecars. | If unavailable, the creation-draft apply input needs a trusted selection payload from the workstation. |
| Existing lifecycle events contain enough queue/run/PR/landing evidence for the first UX slice. | `lifecycle.ts` already handles enqueue, queue PRD, session, landing, and auto-merge event types and records queue/build/landing trace entries. | Add simulated lifecycle event tests for queue, run, PR-open, merge, auto-merge, failed, skipped, and ambiguous cases. | If insufficient, add the smallest typed client/daemon event fields via `@eforge-build/client`. |
| Epic progress can be derived from linked item statuses and traces. | Backlog items already carry `epic`; trace sidecars store `epicId`; board building already loads items, epics, recommendations, and traces together. | Add projection tests for an epic with mixed candidate/planned/active/shipped/failed evidence. | If not enough, add explicit epic trace sidecars or frontmatter metadata in a later slice. |
| Recommendation freshness should remain explicit-refresh. | README and existing code describe durable task monitoring and explicit apply; PR #177 shipped stale marking and refresh workflow. | Verify `get-recommendations`, `list-board`, and workstation refresh tests still pass after richer trace projections. | If users require automatic refresh, plan a separate auto-mode/scheduling slice after lifecycle linkage is dependable. |
| Session-plan frontmatter can carry eforge-plan source metadata safely. | `@eforge-build/input` session plan schema is passthrough and `promote.ts` already writes `eforge_plan` metadata for deterministic promotion. | Load/write a session plan with `eforge_plan` metadata through adapter helpers and assert it round-trips. | If passthrough is not reliable, add explicit typed metadata support in `@eforge-build/input`. |

## Scope

### In scope

- Preserve source linkage when backlog work becomes a session plan, including AI `sessionPlanCreationDraft` application from item, epic, or recommendation selections.
- Add or refine trace/projection helpers that derive a lifecycle chain per item and aggregate lifecycle progress for session plans and epics.
- Expose richer trace summaries in eforge-plan action outputs so the workstation can render session-plan, queue PRD, build/run/session, PR URL, merge/auto-merge, failed/skipped, and last-event evidence without reading private files directly.
- Surface lifecycle chips/timelines in the Backlog tab item cards and the Plans tab detail view.
- Add an epic-level progress projection for linked items, including counts by backlog status and lifecycle evidence stage.
- Define conservative partial-completion semantics for multi-item and epic-to-plan handoffs: per-item confirmed landing can mark only that item shipped; shared plan/queue/run evidence can mark plan/epic progress partial without forcing every source item shipped unless the landing evidence is unambiguously shared by all sources.
- Keep PR #177 recommendation freshness behavior wired to correlated lifecycle changes and ensure new source/linkage changes participate in the recommendation source fingerprint.
- Update eforge-plan README and tests.

### Out of scope

- Auto-mode backlog draining, unattended enqueueing, scheduling, or background AI refresh from lifecycle hooks.
- Removing Console compatibility routes or built-in daemon/client session-plan plumbing.
- Raw extension-owned HTTP routes or private Console imports from the workstation frame.
- Pi/Claude hardcoded `/eforge:plan` behavior changes beyond generic extension action visibility.
- Broad monitor DB or daemon HTTP API redesign unless investigation proves existing lifecycle events cannot carry enough evidence.

## Acceptance Criteria

- Applying an `eforge-plan.planning-draft` result with `sessionPlanCreationDraft` for an item selection writes `.eforge/session-plans/<session>.md`.
- Applying an `eforge-plan.planning-draft` result with `sessionPlanCreationDraft` for an item selection writes `eforge_plan.source_item_ids` frontmatter.
- Applying an `eforge-plan.planning-draft` result with `sessionPlanCreationDraft` for an item selection upserts `promotedSessionPlans` trace entries for each selected item.
- Applying an `eforge-plan.planning-draft` result with `sessionPlanCreationDraft` for a recommendation ref records the resolved source item ids in session-plan metadata and trace sidecars.
- Applying an `eforge-plan.planning-draft` result with `sessionPlanCreationDraft` for a recommendation ref records the resolved source epic ids in session-plan metadata and trace sidecars.
- Applying an `eforge-plan.planning-draft` result with `sessionPlanCreationDraft` for a recommendation ref records the source recommendation ref in session-plan metadata and trace sidecars.
- Applying an `eforge-plan.planning-draft` result never trusts model-authored source item ids.
- Tests prove source linkage for an `eforge-plan.planning-draft` result comes from the stored workflow selection.
- `list-board` returns JSON-safe lifecycle link projections for linked items.
- `list-board` lifecycle link projections include session plan evidence for linked items.
- `list-board` lifecycle link projections include queue PRD evidence for linked items.
- `list-board` lifecycle link projections include build run evidence for linked items.
- `list-board` lifecycle link projections include build session evidence for linked items.
- `list-board` lifecycle link projections include PR URL evidence for linked items.
- `list-board` lifecycle link projections include landing status evidence for linked items.
- `list-board` lifecycle link projections include last-event evidence for linked items.
- `list-board` lifecycle link projections include affected backlog item ids for linked items.
- `list-planning-artifacts` or `show-session-plan` returns source backlog refs for a linked session plan.
- `list-planning-artifacts` or `show-session-plan` returns lifecycle evidence for a linked session plan.
- A simulated `landing:complete` event with `action: "pr"` records PR-open evidence.
- A simulated `landing:complete` event with `action: "pr"` leaves correlated backlog item status active.
- A simulated `landing:complete` event with `action: "merge"` and `commitSha` marks only unambiguously landed correlated item ids shipped.
- A simulated failed `queue:prd:complete` event records trace evidence.
- A simulated failed `queue:prd:complete` event does not mark correlated items shipped.
- A simulated failed `queue:prd:complete` event does not mark correlated items stale.
- A simulated failed `queue:prd:complete` event does not mark correlated items superseded.
- A simulated skipped `queue:prd:complete` event records trace evidence.
- A simulated skipped `queue:prd:complete` event does not mark correlated items shipped.
- A simulated skipped `queue:prd:complete` event does not mark correlated items stale.
- A simulated skipped `queue:prd:complete` event does not mark correlated items superseded.
- A multi-item projection with mixed shipped and non-shipped source items returns a partial plan lifecycle state.
- An epic-linked projection with mixed shipped and non-shipped source items returns a partial epic lifecycle state.
- A multi-item projection with mixed shipped and non-shipped source items returns per-item evidence rows.
- An epic-linked projection with mixed shipped and non-shipped source items returns per-item evidence rows.
- Backlog item cards in the eforge-plan workstation render lifecycle chips or an expandable lifecycle panel for active linked work.
- Backlog item cards in the eforge-plan workstation render lifecycle chips or an expandable lifecycle panel for PR-open linked work.
- Backlog item cards in the eforge-plan workstation render lifecycle chips or an expandable lifecycle panel for merged linked work.
- Backlog item cards in the eforge-plan workstation render lifecycle chips or an expandable lifecycle panel for failed linked work.
- Session plan detail in the eforge-plan workstation renders source backlog refs before the handoff controls.
- Session plan detail in the eforge-plan workstation renders source epic refs before the handoff controls.
- Session plan detail in the eforge-plan workstation renders queue evidence before the handoff controls.
- Session plan detail in the eforge-plan workstation renders run evidence before the handoff controls.
- Session plan detail in the eforge-plan workstation renders PR evidence before the handoff controls.
- Session plan detail in the eforge-plan workstation renders landing evidence before the handoff controls.
- Recommendation freshness remains stale after correlated lifecycle updates until a valid recommendation refresh/apply path marks it fresh.
- `eforge/extensions/eforge-plan/README.md` documents lifecycle linkage.
- `eforge/extensions/eforge-plan/README.md` documents AI creation-draft source linking.
- `eforge/extensions/eforge-plan/README.md` documents partial completion.
- `eforge/extensions/eforge-plan/README.md` documents recommendation freshness interaction.
- `pnpm test -- eforge-plan` exits 0 after the lifecycle linkage tests run.
- `pnpm type-check` exits 0 after the new action output and workstation types compile.
- `pnpm maintainability:check` exits 0 with balanced region markers and no file-size ratchet violations.