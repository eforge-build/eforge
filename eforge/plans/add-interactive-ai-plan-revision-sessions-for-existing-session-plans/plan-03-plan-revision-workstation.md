---
id: plan-03-plan-revision-workstation
name: Add the Plans tab Revise with AI panel, thread hook/rendering, patch
  preview/apply UX, stale/clarification states, frontend fixtures, bridge
  support, UI tests, and workstation build verification.
branch: add-interactive-ai-plan-revision-sessions-for-existing-session-plans/plan-revision-workstation
---

# Plan Revision Workstation

## Architecture Reference

This module implements the architecture sections **Module: `plan-revision-workstation`**, **End-to-end control flow**, **Extension action contract**, **Apply semantics**, and the Plans-tab portions of **Scope**.

Key constraints from architecture:
- The workstation owns the first-party **Revise with AI** UX for flat session plans only; plan-set revision is excluded from V1.
- The UI communicates only through `window.eforge.invokeAction` via `getBridge()` and registered eforge-plan actions; it must not use raw HTTP, private Console imports, or extension-private storage paths.
- Persisted daemon task result types come from `@eforge-build/client/browser`. The UI may define extension action projection types, but it must not re-declare the `planRevisionTurn` task result shape.
- Plan revision apply is explicit and selected. The UI calls `apply-plan-revision-turn` with selected section dimensions and confirmation flags; it never calls `set-session-plan-section` as an AI-apply shortcut.
- Answer-only revision turns render assistant text with no mutation controls. Patch-bearing turns render before/after section previews and selected-section apply controls.
- `needs-input` revision turns reuse the top-level planning task clarification result; the workstation renders structured questions and sends answers through `retry-plan-revision-turn` as a linked redraft.
- Stale, not-applicable, failed, cancelled, queued, and running task states must be visible in the revision thread.
- Applying a revision refreshes the loaded plan/readiness projection through existing `PlanDetailCard` callbacks. It does not mark ready, hand off, enqueue, or mutate backlog state.
- Keep `mock-data.ts` below the file-size ceiling by putting revision-specific fixtures in a new module and importing them from `bridge.ts`.

## Scope

### In Scope
- Add a **Revise with AI** entry point/panel to `PlanDetailCard` for flat session plans.
- Add a workstation hook that creates/resumes a revision session, loads the thread, polls linked queued/running turns, starts new turns, cancels turns, retries failed/cancelled turns, redrafts clarification turns, and applies selected sections.
- Render a revision thread with user messages, assistant messages, task status/progress, task errors, applied section markers, missing-task stale reasons, and timestamps.
- Render answer-only `planRevisionTurn` results without an apply button.
- Render patch-bearing `planRevisionTurn` results as selectable section previews with current/proposed content, rationale, advisory metadata/open-question/skipped-dimension text, apply guidance, and explicit in-app confirmation.
- Render `needs-input` results as structured clarification questions with answer fields and optional steering, then start a linked redraft through `retry-plan-revision-turn`.
- Surface stale and not-applicable apply results in the panel and avoid plan/readiness refresh callbacks for those result kinds.
- Add frontend action projection types and import the shared `planRevisionTurn` type from `@eforge-build/client/browser`.
- Add stateful mock bridge support and local fixtures for answer-only, patch, stale-apply, clarification, retry, and applied-turn states.
- Add workstation component/hook tests for answer-only turns, patch previews, selected-section apply, readiness refresh callbacks, stale apply warnings, clarification redraft, and action isolation.
- Update workstation asset/contract tests so the production bundle contains the revision UI and action ids while retaining the no-raw-HTTP/no-private-storage guarantees.
- Run the workstation build to regenerate `eforge/extensions/eforge-plan/workstation-assets/plans/*` during verification.

### Out of Scope
- Backend action schemas/handlers, revision store, fingerprint computation, and adapter-backed writes.
- Shared client task schema changes, engine submit-tool handling, prompt changes, and monitor output-section counting.
- README, `docs/extensions.md`, generated docs/reference artifacts, and Pi/Claude consumer-surface checks.
- Session plan-set revision UI.
- Metadata or skipped-dimension mutation from revision patches.
- New CLI, MCP, Pi, or Claude plugin commands/skills.
- Generic extension chat runtime, daemon-owned chat transcripts, mutation-capable agent tools, build enqueueing, ready marking, or handoff from the revision panel.

## Implementation Approach

### Overview

Implement the feature as a focused Plans-tab UI layer over the backend revision action contract. `PlanDetailCard` will render a collapsible **Revise with AI** panel for flat plans. The panel owns its hook instance for the current `plan.session`; the hook calls backend revision actions through the shared bridge, keeps a `PlanRevisionSessionProjection` in React state, polls the session projection while any linked turn is queued/running, and exposes command functions for submit/cancel/retry/redraft/apply.

The UI will split responsibilities across small files:

1. `use-plan-revision-session.ts` handles action calls, polling, busy/loading state, toasts, apply-result handling, and `onApply`/`onRefresh` callbacks.
2. `plan-revision-panel.tsx` renders the collapsible panel, user message form, state summary chips, and top-level controls.
3. `plan-revision-thread.tsx` renders per-turn status, user/assistant messages, clarification forms, failed/cancelled retry controls, and delegates patch previews.
4. `plan-revision-patch-preview.tsx` renders selected-section before/after previews and in-app apply confirmation.
5. `plan-revision-view-model.ts` contains pure helpers for status counts, chronological rendering, result classification, section lookup, and default selected sections.

The panel calls only the revision-specific actions. Section writes stay behind `apply-plan-revision-turn`; existing manual section editing remains in `SectionEditor`/readiness flows.

### Key Decisions

1. **Use a collapsible panel inside `PlanDetailCard`.** The Plans detail card already owns readiness, metadata, lifecycle, sections, and handoff. A collapsible panel keeps revision controls discoverable without crowding the section list.
2. **Initialize lazily.** The panel starts/resumes the revision session when the user opens/submits in the panel, not merely when a plan detail renders. This avoids storage writes for read-only plan inspection.
3. **Poll the revision session projection, not individual daemon tasks.** `get-plan-revision-session` already joins stored turns to owner-scoped task records, so the UI uses one projection shape for initial load, reload, polling, and post-mutation updates.
4. **Represent apply feedback per turn.** The hook stores the last `apply-plan-revision-turn` result keyed by `turnId`/`taskId` so stale and not-applicable messages render next to the relevant preview.
5. **Default-select all proposed sections but allow per-section selection.** This makes patch application fast for small patches while preserving the requirement to apply only selected dimensions.
6. **Render before/after cards instead of computing a line diff.** Current plan sections are available in `plan.sections`; before/after preview satisfies V1 patch preview without adding a diff library.
7. **Display metadata/skipped-dimension patch fields as advisory text only.** V1 backend apply is section-only, so the UI must not present metadata/skipped-dimension checkboxes or imply those fields will mutate.
8. **Reuse existing styling primitives.** Use `CollapsiblePanel`, `Button`, `Textarea`, `Badge`, `Card`, `SafeMarkdown`, `formatRelativeTime`, `shortTaskId`, and dimension helpers to match existing workstation patterns.
9. **Keep mock revision fixtures separate.** `mock-data.ts` is near the 600-line implementation ceiling. New revision fixture state and action simulators belong in `fixtures/mock-plan-revisions.ts`.
10. **Do not import backend schema files into the browser bundle.** Action projection types live in `types.ts`; only shared daemon/client task result types come from `@eforge-build/client/browser`.

## Files

### Create
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-view-model.ts` — pure helpers for turn ordering, running/ready/failed/needs-input counts, result classification, patch section extraction, current-section lookup via `sectionContent()`, and default selected-section state.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.ts` — React hook for `start-plan-revision-session`, `get-plan-revision-session`, `start-plan-revision-turn`, `retry-plan-revision-turn`, `cancel-plan-revision-turn`, and `apply-plan-revision-turn`; includes polling and toast/error handling.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-panel.tsx` — collapsible **Revise with AI** panel with session start/resume, message form, refresh control, active-turn disablement, status chips, and thread rendering.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-thread.tsx` — turn list renderer for user messages, task badges, running progress, assistant narrative, answer-only state, failed/cancelled retry controls, missing-task messages, and clarification redraft forms.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-patch-preview.tsx` — patch preview/apply component with selectable sections, current/proposed `SafeMarkdown` previews, rationale, advisory metadata/skipped-dimension display, apply guidance, confirmation, stale/not-applicable result alerts, and applied-section badges.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-plan-revisions.ts` — stateful mock revision sessions and bridge helpers for list/get/start session/start turn/retry/cancel/apply, covering answer-only, patch, stale, clarification, retry, and applied fixtures.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-view-model.test.ts` — unit tests for pure helpers, including chronological ordering, running counts, result classification, and section content lookup for `acceptance-criteria` vs `acceptance criteria` keys.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/use-plan-revision-session.test.tsx` — hook tests for action payloads, polling/reload behavior, apply result handling, stale/not-applicable handling, and no direct section/handoff/ready actions.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-revision-panel.test.tsx` — component tests for Plan detail integration, answer-only rendering, patch preview/selected apply, stale warning, clarification answers/redraft, failed retry, and readiness refresh callbacks.

### Modify
- `eforge/extensions/eforge-plan/workstation-src/plans/src/types.ts` — import the shared plan-revision turn type from `@eforge-build/client/browser`, add `planRevisionTurn?: PlanRevisionTurnResult` to `PlanningTaskResult`, and add frontend revision action projection/apply-result types in a durable region `[region: plan-revision-workstation, durable plan-revision-types block near PlanningAgentTaskRecord/PlanDetail projection types]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/bridge.ts` — import `mock-plan-revisions` helpers and route the seven revision action ids through the mock bridge `[region: plan-revision-workstation, mock fixture imports plus switch cases for plan revision actions]`.
- `eforge/extensions/eforge-plan/workstation-src/plans/src/views/plans/plan-detail.tsx` — import `PlanRevisionPanel` and render it for flat plans after metadata/readiness controls and before the section list, passing `plan`, `readiness`, `onApply`, and `onRefresh` `[region: plan-revision-workstation, PlanDetailCard revision panel slot]`.
- `eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` — add revision action ids/source-file constants and assertions that the source/bundle contain **Revise with AI**, `planRevisionTurn`, revision action ids, `previewAcknowledged`, and `confirmApply`, while retaining no `fetch`, no `XMLHttpRequest`, and no `.eforge/storage/extensions` assertions.

## Detailed Design Notes

### Frontend types

Add a semantic region in `types.ts` for revision projections. The block should include:

- `PlanRevisionTurnResult` type alias to `EforgePlanPlanningPlanRevisionTurn` from `@eforge-build/client/browser`.
- `PlanRevisionSectionHash` with `{ dimension: string; sha256: string }`.
- `PlanRevisionTurnProjection` with stored turn fields (`turnId`, `taskId`, parent/retry/redraft ids, `userMessage`, `basePlanFingerprint`, `baseSectionHashes`, timestamps, `appliedSections`) plus optional `task?: PlanningAgentTaskRecord`, `available?: boolean`, and `staleReason?: string`.
- `PlanRevisionSessionProjection` with `threadId`, `targetSession`, timestamps, optional `dismissedAt`/`summary`, optional `path`/`plan`/`readiness`/`sourceRefs`/`lifecycle`, and `turns`.
- `PlanRevisionApplyOutput` union for `kind: 'applied' | 'stale' | 'not-applicable'` matching the backend plan.
- `PlanRevisionRedraftAnswer` with `{ questionId?: string; prompt?: string; answer: string }`.

The existing local `PlanningTaskResult` interface should gain `planRevisionTurn?: PlanRevisionTurnResult` but not duplicate the fields of that result.

### Hook behavior

`usePlanRevisionSession({ session, onApply, onRefresh })` should expose:

- `revisionSession`, `loading`, `busy`, `initialized`, `lastApplyByTurn`, `hasRunningTurn`.
- `ensureSession()` calling `start-plan-revision-session` and storing the returned projection.
- `reload({ includePlan?: boolean })` calling `get-plan-revision-session` after initialization.
- `submit(message)` trimming non-empty input, ensuring the session exists, then calling `start-plan-revision-turn` with `{ session, message }`.
- `cancel(turn)` calling `cancel-plan-revision-turn` with `{ session, turnId }`.
- `retry(turn)` calling `retry-plan-revision-turn` with `{ session, turnId }` for failed/cancelled turns.
- `redraft(turn, answers, steering)` calling `retry-plan-revision-turn` with `{ session, turnId, answers, steering }` for `needs-input` turns.
- `apply(turn, sections)` calling `apply-plan-revision-turn` with `{ session, turnId, sections, previewAcknowledged: true, confirmApply: true }`.

For apply results:

- `kind: 'applied'`: update `lastApplyByTurn`, call `onApply({ plan, readiness })`, call `onRefresh()`, then reload the revision session with `includePlan: true`.
- `kind: 'stale'`: update `lastApplyByTurn`, show an error/warning toast containing `session`, and do not call `onApply()`.
- `kind: 'not-applicable'`: update `lastApplyByTurn`, show an error/warning toast, and do not call `onApply()`.

Polling runs every 1600ms while any turn task status is `queued` or `running`; each poll calls `get-plan-revision-session`. Polling stops when no linked turns are queued/running or when the component unmounts.

### Panel and thread behavior

The panel should:

- Render a `CollapsiblePanel` with title `Revise with AI`, a `Bot` icon, and summary chips for running turns, patch-ready turns, needs-input turns, failed turns, and applied sections.
- Provide a `Start or resume revision session` button before initialization and a `Refresh revision thread` button after initialization.
- Provide a textarea labelled for asking questions/change requests and a submit button labelled `Send to AI`.
- Disable submit while `busy`, `loading`, or `hasRunningTurn` is true. Show a short text explaining that V1 allows one running turn per plan.
- Render turns chronologically for chat-style reading even though backend storage returns newest-first.

Each turn should render:

- User message text and task/status metadata.
- Running progress from `task.metadata.progressMessage` and `task.metadata.sectionProgress`.
- Failed/cancelled error text and a `Retry with preserved context` action.
- Completed `needs-input` result with summary, rationale, question list, per-question answer fields, optional steering field, and `Answer and redraft` action.
- Completed `planRevisionTurn.assistantMessage` through `SafeMarkdown`.
- Citations/evidence as compact labels/excerpts when present.
- Answer-only state when no structured patch sections exist.
- Patch preview for structured sections.
- Applied markers from `turn.appliedSections`/`turn.appliedAt`.

### Patch preview behavior

For each proposed section:

- Use the dimension helpers in `dimensions.ts` to label sections and read current content from `plan.sections`.
- Render current content and proposed content in separate cards/details. If the current section is empty, show `No current content for this dimension.`
- Show section `rationale` when present.
- Use checkboxes for section selection. Initial selection includes every proposed section not already present in `turn.appliedSections`.
- The apply button requires at least one selected section and uses a two-click in-app confirmation (`Apply selected revisions` then `Confirm apply selected revisions`).
- The apply action sends only selected dimensions.
- Display `applyGuidance`, `noPatchReason`, `proposedPatch.metadata.openQuestions`, and `proposedPatch.skippedDimensions` as read-only advisory text.
- Display stale/not-applicable apply results returned by the hook next to the preview, including the target `session` and fingerprint fields when present.

### Mock bridge and fixtures

`fixtures/mock-plan-revisions.ts` should export functions used only by `bridge.ts`:

- `startOrResumeMockPlanRevisionSession(input)`.
- `listMockPlanRevisionSessions(input)`.
- `getMockPlanRevisionSession(input)`.
- `startMockPlanRevisionTurn(input)`.
- `retryMockPlanRevisionTurn(input)`.
- `cancelMockPlanRevisionTurn(input)`.
- `applyMockPlanRevisionTurn(input)`.

The fixture module should seed or synthesize:

- An answer-only completed turn with `assistantMessage` and no `proposedPatch`.
- A patch-bearing completed turn proposing `scope` and `acceptance-criteria` sections.
- A stale apply response for a known stale task/turn.
- A completed `needs-input` turn with two clarification questions.
- A failed/cancelled turn that can be retried.
- An applied turn with `appliedSections` and `appliedAt`.

The mock `applyMockPlanRevisionTurn()` should return `kind: 'applied'` with `mockMutationResult()` for fresh selected sections, `kind: 'stale'` for stale fixtures, and `kind: 'not-applicable'` for answer-only/needs-input fixtures. It should update fixture `appliedSections` for fresh applies so local UI state reflects the applied marker after reload.

## Testing Strategy

### Unit Tests
- `plan-revision-view-model.test.ts`:
  - Chronological helper reverses newest-first turns into ascending `createdAt` order.
  - Status summary helper counts queued/running, failed, patch-ready, needs-input, and applied turns from mixed fixtures.
  - Result classifier returns `answer`, `patch`, `needs-input`, `failed`, `running`, and `unavailable` for representative turn/task shapes.
  - Section lookup returns the same body for `acceptance-criteria` when plan sections use `acceptance criteria` keys.
  - Default selected sections exclude sections already listed in `turn.appliedSections`.

- `use-plan-revision-session.test.tsx`:
  - `ensureSession()` invokes `start-plan-revision-session` with `{ session }` once for an uninitialized session.
  - `submit('Why this scope?')` invokes `start-plan-revision-turn` with the trimmed message and updates hook state from the returned projection.
  - A running turn causes polling through `get-plan-revision-session`; a terminal projection stops further polling after timers advance.
  - `apply(turn, ['scope'])` invokes `apply-plan-revision-turn` with `previewAcknowledged: true`, `confirmApply: true`, and `sections: ['scope']`.
  - `kind: 'applied'` calls `onApply()` with returned `plan`/`readiness` and calls `onRefresh()` once.
  - `kind: 'stale'` stores the apply result and leaves `onApply()` uncalled.
  - Hook action history contains no `set-session-plan-section`, `set-session-plan-ready`, or `handoff-session-plan` calls.

### Integration Tests
- `plan-revision-panel.test.tsx`:
  - Rendering `PlanDetailCard` for a flat plan exposes a `Revise with AI` panel; submitting an answer-only question invokes `start-plan-revision-turn` and renders the assistant message.
  - The answer-only test asserts no `set-session-plan-section` action is invoked.
  - A patch-bearing turn renders proposed `scope` and `acceptance-criteria` previews.
  - Selecting only `scope` and confirming apply invokes `apply-plan-revision-turn` with `sections: ['scope']`.
  - Applying a fresh patch updates the parent callback with returned readiness and triggers a refresh callback.
  - A stale apply response renders a stale warning naming the target session and fingerprint values, and no parent apply callback fires.
  - A `needs-input` turn renders structured clarification questions; entering answers and optional steering invokes `retry-plan-revision-turn` with `answers` and `steering`.
  - A failed/cancelled turn renders retry controls; clicking retry invokes `retry-plan-revision-turn` with the linked `turnId`.
  - The component action history contains no `handoff-session-plan`, `set-session-plan-ready`, or build enqueue action ids.

- `workstation-assets.test.ts` updates:
  - Source and built bundle contain `Revise with AI`, `planRevisionTurn`, and each revision action id.
  - Source and built bundle contain `previewAcknowledged` and `confirmApply` for revision apply.
  - Source and built bundle do not contain `fetch(`, `XMLHttpRequest`, or `.eforge/storage/extensions`.
  - Mock bridge source contains a `case` for each revision action id and imports `mock-plan-revisions` helpers.

## Verification

- [ ] `PlanDetailCard` renders a `Revise with AI` panel for flat `PlanDetail` inputs.
- [ ] `PlanSetDetailCard` renders no `Revise with AI` panel.
- [ ] `types.ts` exports `PlanRevisionTurnResult` as an alias of the shared client/browser type.
- [ ] `PlanningTaskResult` includes an optional `planRevisionTurn` property.
- [ ] `types.ts` exports `PlanRevisionSessionProjection`, `PlanRevisionTurnProjection`, `PlanRevisionApplyOutput`, and `PlanRevisionRedraftAnswer` inside the `plan-revision-types` region.
- [ ] The mock bridge contains cases for `start-plan-revision-session`, `list-plan-revision-sessions`, `get-plan-revision-session`, `start-plan-revision-turn`, `retry-plan-revision-turn`, `cancel-plan-revision-turn`, and `apply-plan-revision-turn`.
- [ ] The revision panel submit flow invokes `start-plan-revision-turn` with the selected `session` and trimmed `message`.
- [ ] The revision panel disables new message submission while a linked turn has status `queued` or `running`.
- [ ] A running linked turn displays `task.metadata.progressMessage` when present.
- [ ] An answer-only `planRevisionTurn` displays `assistantMessage` and no apply button.
- [ ] A patch-bearing `planRevisionTurn` displays `scope` and `acceptance-criteria` preview rows when both sections are present.
- [ ] Confirming apply with only `scope` selected sends `sections: ['scope']` to `apply-plan-revision-turn`.
- [ ] Revision apply sends `previewAcknowledged: true` and `confirmApply: true`.
- [ ] Fresh apply calls the parent plan/readiness callback with the `plan` and `readiness` returned by `apply-plan-revision-turn`.
- [ ] Fresh apply calls the parent refresh callback once.
- [ ] Stale apply displays the returned `session`, `basePlanFingerprint`, and `currentPlanFingerprint`.
- [ ] Stale apply leaves the parent plan/readiness callback uncalled.
- [ ] A `needs-input` result displays all `clarificationQuestions` returned by the task result.
- [ ] Clarification redraft sends an `answers` array with each non-empty answer and its question prompt.
- [ ] Failed and cancelled turns render a retry control that invokes `retry-plan-revision-turn`.
- [ ] Workstation tests assert no revision UI path invokes `set-session-plan-section`, `set-session-plan-ready`, `handoff-session-plan`, or a build enqueue action id.
- [ ] `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-data.ts` remains at or below its current 575-line count.
- [ ] `eforge/extensions/eforge-plan/workstation-src/plans/src/fixtures/mock-plan-revisions.ts` contains fixture states for answer-only, patch, stale-apply, clarification, retry, and applied turns.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation test -- plan-revision` exits 0.
- [ ] `pnpm --filter @eforge-build/eforge-plan-workstation type-check` exits 0.
- [ ] `pnpm build:eforge-plan-workstation` exits 0.
- [ ] `eforge/extensions/eforge-plan/workstation-assets/plans/index.js` exists after `pnpm build:eforge-plan-workstation`.
- [ ] `pnpm vitest run eforge/extensions/eforge-plan/__tests__/workstation-assets.test.ts` exits 0.
- [ ] Root `pnpm type-check` exits 0.
- [ ] Root `pnpm test` exits 0.
- [ ] Root `pnpm maintainability:check` exits 0.

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
